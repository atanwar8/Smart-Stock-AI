import { Skeleton, SkeletonCard } from '../ui';

// Shown while a section's code chunk downloads; shaped like the page it stands in for
export default function PageSkeleton({ variant = 'page' }: { variant?: 'overview' | 'page' }) {
  return (
    <div role="status" aria-label="Loading section">
      <div className="mb-8 space-y-3">
        <Skeleton className="h-3 w-40 rounded-full" />
        <Skeleton className="h-12 w-[min(420px,80%)] rounded-[14px]" />
        <Skeleton className="h-4 w-[min(560px,95%)] rounded-full" />
      </div>
      {variant === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <SkeletonCard night className="lg:col-span-7" bodyClassName="h-56" />
          <SkeletonCard className="lg:col-span-5" bodyClassName="h-56" />
          <SkeletonCard className="lg:col-span-4" bodyClassName="h-44" />
          <SkeletonCard className="lg:col-span-4" bodyClassName="h-44" />
          <SkeletonCard className="lg:col-span-4" bodyClassName="h-44" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonCard className="lg:col-span-2" bodyClassName="h-64" />
          <SkeletonCard bodyClassName="h-64" />
        </div>
      )}
    </div>
  );
}
