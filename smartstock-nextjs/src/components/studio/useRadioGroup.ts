'use client';

// Roving-tabindex radio group (WAI-ARIA radio pattern): one tab stop, arrows move and select,
// Home/End jump, disabled items are skipped.

import { useCallback, useRef, type KeyboardEvent } from 'react';

export function useRadioGroup(count: number, selected: number, onSelect: (index: number) => void, isDisabled: (index: number) => boolean = () => false) {
  const refs = useRef<(HTMLElement | null)[]>([]);

  const firstEnabled = () => {
    for (let i = 0; i < count; i++) if (!isDisabled(i)) return i;
    return -1;
  };

  const step = (from: number, dir: 1 | -1) => {
    let i = from;
    for (let n = 0; n < count; n++) {
      i = (i + dir + count) % count;
      if (!isDisabled(i)) return i;
    }
    return from;
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = step(index, 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = step(index, -1);
    else if (e.key === 'Home') next = firstEnabled();
    else if (e.key === 'End') next = step(0, -1);
    else return;
    e.preventDefault();
    if (next < 0) return;
    refs.current[next]?.focus();
    onSelect(next);
  };

  const focusIndex = selected >= 0 && !isDisabled(selected) ? selected : firstEnabled();
  const tabIndexFor = (index: number) => (index === focusIndex ? 0 : -1);
  const setRef = useCallback((index: number) => (el: HTMLElement | null) => {
    refs.current[index] = el;
  }, []);

  return { onKeyDown, tabIndexFor, setRef };
}
