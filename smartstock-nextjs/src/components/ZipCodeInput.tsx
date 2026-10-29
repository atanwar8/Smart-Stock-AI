'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useCommodityActions, useCommodityState } from '@/contexts/CommodityContext';
import { useDebouncedCallback } from '@/lib/hooks';
import { cx } from './ui';

// US ZIP code for weather. Every page's weather follows the shared ZIP. The change is debounced so
// editing a ZIP digit by digit doesn't fire a weather request for every intermediate value.
export default function ZipCodeInput({ compact = false }: { compact?: boolean }) {
  const { selectedZipCode } = useCommodityState();
  const { setSelectedZipCode } = useCommodityActions();
  const [zip, setZip] = useState(selectedZipCode);
  useEffect(() => setZip(selectedZipCode), [selectedZipCode]);
  const commit = useDebouncedCallback((digits: string) => setSelectedZipCode(digits), 450);

  const incomplete = zip.length < 5;

  return (
    <label className="block">
      <span className={compact ? 'sr-only' : 'mb-1.5 block text-[12.5px] font-semibold text-ink'}>ZIP code</span>
      <span className="relative block">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <input
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          placeholder="ZIP"
          aria-invalid={incomplete}
          value={zip}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 5);
            setZip(digits);
            if (digits.length === 5) commit(digits);
          }}
          // Leaving a half-typed ZIP goes back to the one the weather is showing
          onBlur={() => incomplete && setZip(selectedZipCode)}
          className={cx(
            'tabular border border-line-2 bg-surface pl-8 pr-3 font-mono text-ink placeholder:text-faint/80 focus:border-accent/60 focus:outline-none focus:ring-4 focus:ring-accent/10',
            compact ? 'h-8 w-[96px] rounded-full text-[12.5px]' : 'h-11 w-full rounded-tile text-[14px]'
          )}
        />
      </span>
      {!compact && (
        <span className="mt-1 block text-[12px] text-faint">{incomplete && zip ? 'Enter all 5 digits.' : 'Weather updates as soon as you type 5 digits.'}</span>
      )}
    </label>
  );
}
