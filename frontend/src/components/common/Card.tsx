import React from 'react'
import clsx from 'clsx'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Remove body padding (for tables / terminals that manage their own). */
  flush?: boolean
  /** Make the card fill its parent height (flex column). */
  fill?: boolean
}

/**
 * Standard surface container used by every page: header / body / footer.
 *
 * <Card>
 *   <CardHeader title="CPU" subtitle="..." actions={<Button .../>} />
 *   <CardBody>...</CardBody>
 *   <CardFooter>...</CardFooter>
 * </Card>
 */
export const Card: React.FC<CardProps> = ({ className, flush, fill, children, ...rest }) => (
  <div
    className={clsx(
      'bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden',
      fill && 'flex flex-col h-full min-h-0',
      flush && 'card-flush',
      className
    )}
    {...rest}
  >
    {children}
  </div>
)

export interface CardHeaderProps {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  /** Smaller header for dense widgets. */
  compact?: boolean
  children?: React.ReactNode
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, subtitle, icon, actions, className, compact, children }) => (
  <div
    className={clsx(
      'flex items-start justify-between gap-4 border-b border-trakend-border',
      compact ? 'px-4 py-2' : 'px-4 py-3',
      className
    )}
  >
    <div className="flex items-center gap-2 min-w-0">
      {icon && <span className="text-trakend-accent flex-shrink-0 inline-flex">{icon}</span>}
      <div className="min-w-0">
        {title && (
          <h3 className={clsx('font-semibold text-trakend-text-primary truncate', compact ? 'text-sm' : 'text-base')}>
            {title}
          </h3>
        )}
        {subtitle && <div className="text-xs text-trakend-text-secondary truncate">{subtitle}</div>}
        {children}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
  </div>
)

export const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement> & { flush?: boolean; scroll?: boolean }> = ({
  className,
  flush,
  scroll,
  children,
  ...rest
}) => (
  <div
    className={clsx(!flush && 'p-4', scroll && 'flex-1 min-h-0 overflow-auto', className)}
    {...rest}
  >
    {children}
  </div>
)

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div
    className={clsx('px-4 py-3 border-t border-trakend-border bg-trakend-dark/40 flex items-center gap-2', className)}
    {...rest}
  >
    {children}
  </div>
)

export default Card
