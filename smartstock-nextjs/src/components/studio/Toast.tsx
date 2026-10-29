'use client';

// A small confirmation pill at the bottom of the screen. Portaled to <body> so a transformed ancestor
// (page transitions) can never trap its fixed position.

import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import type { Toast as ToastData } from './useStudio';
import s from './studio.module.css';

function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(onDone, 3600);
    return () => window.clearTimeout(id);
  }, [toast, onDone]);

  if (!mounted) return null;
  return createPortal(
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      {toast && (
        <div key={toast.id} className={`pointer-events-auto flex items-center gap-2.5 rounded-full bg-ink py-2 pl-2 pr-4 text-[13.5px] font-semibold text-surface shadow-pop ${s.toast}`}>
          <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-ink">
            <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
          {toast.text}
        </div>
      )}
    </div>,
    document.body,
  );
}

export default memo(Toast);
