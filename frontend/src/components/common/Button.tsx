import React from 'react'
import clsx from 'clsx'
import { Loader2 } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Optional leading icon. Hidden while loading (spinner takes its place). */
  icon?: React.ReactNode
  /** Render as a square icon-only button (uses `title` / `aria-label` for text). */
  iconOnly?: boolean
  fullWidth?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-trakend-accent text-white border border-transparent hover:bg-trakend-accent-dark shadow-sm',
  secondary:
    'bg-trakend-surface-light text-trakend-text-primary border border-trakend-border hover:border-trakend-text-secondary hover:bg-trakend-surface',
  danger:
    'bg-trakend-error/15 text-trakend-error border border-trakend-error/40 hover:bg-trakend-error hover:text-white',
  ghost:
    'bg-transparent text-trakend-text-secondary border border-transparent hover:bg-trakend-surface-light hover:text-trakend-text-primary',
}

const SIZES: Record<ButtonSize, { btn: string; icon: number; iconOnly: string }> = {
  xs: { btn: 'h-6 px-2 text-[11px] gap-1 rounded', icon: 12, iconOnly: 'h-6 w-6' },
  sm: { btn: 'h-8 px-3 text-xs gap-1.5 rounded-md', icon: 14, iconOnly: 'h-8 w-8' },
  md: { btn: 'h-9 px-4 text-sm gap-2 rounded-lg', icon: 16, iconOnly: 'h-9 w-9' },
  lg: { btn: 'h-11 px-5 text-sm gap-2 rounded-lg', icon: 18, iconOnly: 'h-11 w-11' },
}

/**
 * Standard button. Disables itself and shows a spinner while `loading`.
 * Always renders a visible keyboard focus ring.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'secondary', size = 'md', loading = false, icon, iconOnly = false, fullWidth, className, children, disabled, type = 'button', ...rest },
    ref
  ) => {
    const s = SIZES[size]
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={clsx(
          'inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
          'transition-colors duration-150 focus-ring',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
          VARIANTS[variant],
          iconOnly ? clsx(s.iconOnly, 'rounded-md p-0') : s.btn,
          fullWidth && 'w-full',
          className
        )}
        {...rest}
      >
        {loading ? (
          <Loader2 size={s.icon} className="animate-spin flex-shrink-0" aria-hidden />
        ) : (
          icon && <span className="flex-shrink-0 inline-flex items-center">{icon}</span>
        )}
        {!iconOnly && children}
      </button>
    )
  }
)
Button.displayName = 'Button'

export default Button
