import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Info } from 'lucide-react'
import { Button, ButtonVariant } from './Button'

export interface ConfirmOptions {
  title: React.ReactNode
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' renders a red confirm button; default 'primary'. */
  variant?: 'danger' | 'primary' | 'warning'
  /** If provided, the user must type this exact string to enable confirm. */
  typeToConfirm?: string
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  loading?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

/**
 * Accessible modal confirm dialog. Escape cancels, Enter confirms,
 * focus is trapped on the buttons. Use the `useConfirm()` hook for an
 * imperative `await confirm({...})` that replaces window.confirm.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  typeToConfirm,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const [typed, setTyped] = useState('')
  const confirmRef = useRef<HTMLButtonElement>(null)
  const canConfirm = !typeToConfirm || typed === typeToConfirm

  useEffect(() => {
    if (!open) {
      setTyped('')
      return
    }
    const t = setTimeout(() => confirmRef.current?.focus(), 10)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!loading) onCancel()
      } else if (e.key === 'Enter' && canConfirm && !loading && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        onConfirm()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, canConfirm, loading, onCancel, onConfirm])

  if (!open) return null

  const btnVariant: ButtonVariant = variant === 'danger' ? 'danger' : 'primary'
  const Icon = variant === 'primary' ? Info : AlertTriangle
  const iconTone = variant === 'danger' ? 'text-trakend-error bg-trakend-error/10' : variant === 'warning' ? 'text-trakend-warning bg-trakend-warning/10' : 'text-trakend-accent bg-trakend-accent/10'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel()
      }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={message ? 'confirm-message' : undefined}
        className="w-full max-w-md bg-trakend-surface border border-trakend-border rounded-xl shadow-2xl p-6 animate-[slideUp_0.15s_ease-out]"
      >
        <div className="flex items-start gap-4">
          <div className={clsx('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', iconTone)}>
            <Icon size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-base font-semibold text-trakend-text-primary">
              {title}
            </h2>
            {message && (
              <div id="confirm-message" className="mt-1.5 text-sm text-trakend-text-secondary leading-relaxed">
                {message}
              </div>
            )}
            {typeToConfirm && (
              <div className="mt-4">
                <label className="block text-xs text-trakend-text-secondary mb-1">
                  Type <code className="px-1 rounded bg-trakend-dark text-trakend-text-primary">{typeToConfirm}</code> to continue
                </label>
                <input
                  type="text"
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="w-full text-sm"
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={btnVariant} onClick={onConfirm} loading={loading} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Imperative API ────────────────────────────────────────────────────────

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve })
    })
  }, [])

  const settle = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={!!pending}
        title={pending?.title ?? ''}
        message={pending?.message}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        variant={pending?.variant}
        typeToConfirm={pending?.typeToConfirm}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  )
}

/**
 * `const confirm = useConfirm(); if (!(await confirm({ title: 'Delete?' , variant: 'danger' }))) return`
 * Falls back to window.confirm when used outside a ConfirmProvider so it never throws.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  return (
    ctx ||
    (async (opts) => {
      const text = typeof opts.title === 'string' ? opts.title : 'Are you sure?'
      return window.confirm(text)
    })
  )
}

export default ConfirmDialog
