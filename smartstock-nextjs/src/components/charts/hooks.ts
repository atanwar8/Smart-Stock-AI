'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Width of an element, kept current with ResizeObserver so charts redraw crisply at any size */
export function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => {
      // Round so sub-pixel layout jitter doesn't re-render the chart
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.current.observe(node);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width] as const;
}

/** True once the element has scrolled near the viewport; stays true (mount once, never unmount) */
export function useInView<T extends HTMLElement>(rootMargin = '200px') {
  const [seen, setSeen] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback(
    (node: T | null) => {
      observer.current?.disconnect();
      if (!node || seen) return;
      if (typeof IntersectionObserver === 'undefined') {
        setSeen(true);
        return;
      }
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setSeen(true);
            observer.current?.disconnect();
          }
        },
        { rootMargin }
      );
      observer.current.observe(node);
    },
    [rootMargin, seen]
  );
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, seen] as const;
}
