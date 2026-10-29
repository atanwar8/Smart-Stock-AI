'use client';

import type { ReactNode } from 'react';
import { useInView } from './hooks';

// Charts below the fold mount only when they scroll near the viewport, so the first paint stays light
export function LazyMount({ height, children, className, night = false }: { height: number; children: ReactNode; className?: string; night?: boolean }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={className} style={{ minHeight: height }}>
      {seen ? children : <div aria-hidden="true" className={night ? 'shimmer-night rounded-tile' : 'shimmer rounded-tile'} style={{ height }} />}
    </div>
  );
}

export default LazyMount;
