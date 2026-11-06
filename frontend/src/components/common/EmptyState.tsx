import React from 'react'
import clsx from 'clsx'
import { AlertTriangle, Inbox } from 'lucide-react'

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  /** Error styling (red icon, error border). */
  error?: boolean
  compact?: boolean
  className?: string
}

/** Consistent empty / error placeholder used by every list and widget. */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, error, compact, className }) => (
  <div
    role={error ? 'alert' : undefined}
    className={clsx(
      'flex flex-col items-center justify-center text-center rounded-lg border border-dashed',
      error ? 'border-trakend-error/40 bg-trakend-error/5' : 'border-trakend-border bg-trakend-surface/40',
      compact ? 'px-4 py-6 gap-1.5' : 'px-6 py-12 gap-2',
      className
    )}
  >
    <div className={clsx('mb-1', error ? 'text-trakend-error' : 'text-trakend-text-secondary opacity-60')}>
      {icon ?? (error ? <AlertTriangle size={compact ? 24 : 36} /> : <Inbox size={compact ? 24 : 36} />)}
    </div>
    <div className={clsx('font-medium', error ? 'text-trakend-error' : 'text-trakend-text-primary', compact ? 'text-sm' : 'text-base')}>
      {title}
    </div>
    {description && (
      <div className={clsx('text-trakend-text-secondary max-w-md', compact ? 'text-xs' : 'text-sm')}>{description}</div>
    )}
    {action && <div className="mt-3">{action}</div>}
  </div>
)

export default EmptyState
