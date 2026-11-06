import React from 'react'
import clsx from 'clsx'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'accent'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  size?: 'xs' | 'sm'
  /** Show a small status dot before the label. */
  dot?: boolean
  /** Animate the dot (e.g. "live" / "connected"). */
  pulse?: boolean
  icon?: React.ReactNode
}

const TONES: Record<BadgeTone, { wrap: string; dot: string }> = {
  neutral: { wrap: 'bg-trakend-surface-light text-trakend-text-secondary border-trakend-border', dot: 'bg-trakend-text-secondary' },
  success: { wrap: 'bg-trakend-success/10 text-trakend-success border-trakend-success/30', dot: 'bg-trakend-success' },
  warning: { wrap: 'bg-trakend-warning/10 text-trakend-warning border-trakend-warning/30', dot: 'bg-trakend-warning' },
  error: { wrap: 'bg-trakend-error/10 text-trakend-error border-trakend-error/30', dot: 'bg-trakend-error' },
  info: { wrap: 'bg-trakend-info/10 text-trakend-info-light border-trakend-info/30', dot: 'bg-trakend-info' },
  accent: { wrap: 'bg-trakend-accent/10 text-trakend-accent border-trakend-accent/30', dot: 'bg-trakend-accent' },
}

export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', size = 'sm', dot, pulse, icon, className, children, ...rest }) => {
  const t = TONES[tone]
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'xs' ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-xs',
        t.wrap,
        className
      )}
      {...rest}
    >
      {dot && <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', t.dot, pulse && 'animate-pulse')} />}
      {icon && <span className="inline-flex flex-shrink-0">{icon}</span>}
      {children}
    </span>
  )
}

/** Map common status strings to a tone so pages don't each reinvent the table. */
export function toneForStatus(status: string | undefined | null): BadgeTone {
  const s = (status || '').toLowerCase()
  if (['running', 'healthy', 'valid', 'connected', 'ok', 'good', 'passed', 'mounted', 'completed', 'active', 'online'].includes(s)) return 'success'
  if (['degraded', 'warning', 'invalid', 'paused', 'building', 'checking', 'rebuilding', 'starting', 'stopping', 'reconnecting', 'new'].includes(s)) return 'warning'
  if (['error', 'failed', 'failing', 'critical', 'missing', 'disconnected', 'offline'].includes(s)) return 'error'
  if (['info', 'debug'].includes(s)) return 'info'
  return 'neutral'
}

export default Badge
