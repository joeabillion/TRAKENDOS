import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastOptions {
  type?: ToastType
  title?: string
  /** ms before auto-dismiss. 0 = sticky. Defaults: 3500 (4s for errors). */
  duration?: number
  action?: { label: string; onClick: () => void }
}

export interface Toast extends ToastOptions {
  id: number
  message: string
  type: ToastType
}

interface ToastApi {
  toast: (message: string, opts?: ToastOptions) => number
  success: (message: string, opts?: ToastOptions) => number
  error: (message: string, opts?: ToastOptions) => number
  warning: (message: string, opts?: ToastOptions) => number
  info: (message: string, opts?: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

let nextId = 1

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const t = timers.current.get(id)
    if (t) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }, [])

  const toast = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      const id = nextId++
      const type = opts.type || 'info'
      const duration = opts.duration ?? (type === 'error' ? 5000 : 3500)
      setToasts((prev) => [...prev.slice(-4), { ...opts, id, message, type }])
      if (duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), duration))
      }
      return id
    },
    [dismiss]
  )

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), [])

  const api: ToastApi = {
    toast,
    success: (m, o) => toast(m, { ...o, type: 'success' }),
    error: (m, o) => toast(m, { ...o, type: 'error' }),
    warning: (m, o) => toast(m, { ...o, type: 'warning' }),
    info: (m, o) => toast(m, { ...o, type: 'info' }),
    dismiss,
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={18} className="text-trakend-success" />,
  error: <AlertCircle size={18} className="text-trakend-error" />,
  warning: <AlertTriangle size={18} className="text-trakend-warning" />,
  info: <Info size={18} className="text-trakend-accent" />,
}

const BORDERS: Record<ToastType, string> = {
  success: 'border-l-trakend-success',
  error: 'border-l-trakend-error',
  warning: 'border-l-trakend-warning',
  info: 'border-l-trakend-accent',
}

const ToastViewport: React.FC<{ toasts: Toast[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null
  return (
    <div
      className="fixed bottom-4 right-4 z-[110] flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))] pointer-events-none"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.type === 'error' ? 'alert' : 'status'}
          className={clsx(
            'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg shadow-2xl border border-trakend-border border-l-4 bg-trakend-surface text-sm',
            'animate-[slideUp_0.18s_ease-out]',
            BORDERS[t.type]
          )}
        >
          <span className="flex-shrink-0 mt-px">{ICONS[t.type]}</span>
          <div className="min-w-0 flex-1">
            {t.title && <div className="font-semibold text-trakend-text-primary">{t.title}</div>}
            <div className={clsx('break-words', t.title ? 'text-trakend-text-secondary' : 'text-trakend-text-primary')}>{t.message}</div>
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onClick()
                  onDismiss(t.id)
                }}
                className="mt-1.5 text-xs font-medium text-trakend-accent hover:underline focus-ring rounded"
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
            className="p-1 -m-1 rounded text-trakend-text-secondary hover:text-trakend-text-primary focus-ring"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Shared notification API. Falls back to console when no provider is mounted. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (ctx) return ctx
  const noop = (m: string) => {
    console.warn('[toast]', m)
    return 0
  }
  return { toast: noop, success: noop, error: noop, warning: noop, info: noop, dismiss: () => {} }
}

export default ToastProvider
