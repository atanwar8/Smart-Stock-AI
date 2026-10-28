'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useCommodity } from '@/contexts/CommodityContext';
import { cx } from './ui';

// US ZIP code for weather. Every page's weather follows the shared ZIP, which updates once 5 digits are typed.
export default function ZipCodeInput({ compact = false }: { compact?: boolean }) {
  const { selectedZipCode, setSelectedZipCode } = useCommodity();
  const [zip, setZip] = useState(selectedZipCode);
  useEffect(() => setZip(selectedZipCode), [selectedZipCode]);

  const incomplete = zip.length < 5;

  return (
    <label className="block">
      <span className={compact ? 'sr-only' : 'mb-1.5 block text-[12.5px] font-semibold text-ink'}>ZIP code</span>
      <span className="relative block">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
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
            if (digits.length === 5) setSelectedZipCode(digits);
          }}
          // Leaving a half-typed ZIP goes back to the one the weather is showing
          onBlur={() => incomplete && setZip(selectedZipCode)}
          className={cx(
            'tabular border border-line-2 bg-surface pl-9 pr-3 text-ink placeholder:text-faint/80 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/12',
            compact ? 'h-9 w-[112px] rounded-full text-[13px] font-semibold' : 'h-11 w-full rounded-tile text-[14px]'
          )}
        />
      </span>
      {!compact && (
        <span className="mt-1 block text-[12px] text-faint">{incomplete && zip ? 'Enter all 5 digits.' : 'Weather updates as soon as you type 5 digits.'}</span>
      )}
    </label>
  );
}
