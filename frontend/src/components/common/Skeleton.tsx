import React from 'react'
import clsx from 'clsx'

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tailwind width/height classes or inline style. Defaults to a text line. */
  circle?: boolean
}

/** Shimmering placeholder block. */
export const Skeleton: React.FC<SkeletonProps> = ({ className, circle, style, ...rest }) => (
  <div
    aria-hidden
    className={clsx('skeleton', circle ? 'rounded-full' : 'rounded', className || 'h-4 w-full')}
    style={style}
    {...rest}
  />
)

/** A few stacked lines of text. */
export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({ lines = 3, className }) => (
  <div className={clsx('space-y-2', className)}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className={clsx('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
    ))}
  </div>
)

/**
 * Card-shaped skeleton that mirrors the dashboard widget layout
 * (title row + stat tiles + a body block). Use while stats are null.
 */
export const SkeletonCard: React.FC<{ title?: string; tiles?: number; className?: string; bodyHeight?: number }> = ({
  title,
  tiles = 3,
  className,
  bodyHeight = 96,
}) => (
  <div
    className={clsx('bg-trakend-surface border border-trakend-border rounded-lg p-4', className)}
    role="status"
    aria-label={title ? `Loading ${title}` : 'Loading'}
  >
    <div className="flex items-center justify-between mb-4">
      {title ? (
        <span className="text-base font-semibold text-trakend-text-secondary">{title}</span>
      ) : (
        <Skeleton className="h-5 w-24" />
      )}
      <Skeleton className="h-3 w-32" />
    </div>
    {tiles > 0 && (
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${tiles}, minmax(0, 1fr))` }}>
        {Array.from({ length: tiles }).map((_, i) => (
          <div key={i} className="p-3 bg-trakend-dark rounded border border-trakend-border">
            <Skeleton className="h-2.5 w-12 mx-auto mb-2" />
            <Skeleton className="h-6 w-16 mx-auto" />
          </div>
        ))}
      </div>
    )}
    <Skeleton className="w-full" style={{ height: bodyHeight }} />
  </div>
)

export default Skeleton
