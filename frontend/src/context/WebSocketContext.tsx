import React, { createContext, useContext, useEffect, useRef, useState } from 'react'

export interface SystemStats {
  hostname: string
  os: string
  kernel: string
  uptime: number
  cpu: {
    model: string
    cores: number
    threads: number
    usage: number
    perCoreUsage: number[]
    temperature: number
    clockSpeed: number
  }
  memory: {
    total: number
    used: number
    free: number
    percent: number
    buffered: number
    cached: number
    available: number
    sticks: Array<{
      type: string
      speed: string
      size: number
    }>
    swapTotal?: number
    swapUsed?: number
    swapFree?: number
  }
  storage: Array<{
    name: string
    size: number
    used: number
    temp: number
    health: string
    type: string
    mount: string
    serial: string
    role: string
    readSpeed: number
    writeSpeed: number
  }>
  gpu: Array<{
    id: string
    name: string
    vramTotal: number
    vramUsed: number
    temperature: number
    utilization: number
    driver: string
  }>
  network: Array<{
    name: string
    ip: string
    speed: number
    rxBytes: number
    txBytes: number
    rxSpeed: number
    txSpeed: number
  }>
  docker: {
    running: number
    stopped: number
    total: number
  }
  processes?: {
    total: number
    running: number
    blocked: number
    sleeping: number
    list: Array<{
      pid: number
      name: string
      cpu: number
      mem: number
      memRss: number
      state: string
      user: string
    }>
  }
  diskIO?: {
    readPerSec: number
    writePerSec: number
    readBytesPerSec: number
    writeBytesPerSec: number
  }
  temperatures?: {
    cpu: number
    cpuCores: number[]
    cpuMax: number
    sensors: Array<{
      chip: string
      label: string
      type: string
      value: number
      unit: string
    }>
  }
  dockerContainers?: Array<{
    id: string
    name: string
    image: string
    state: string
    status: string
    ports: string[]
  }>
}

export interface DockerEvent {
  type: 'container' | 'image'
  action: string
  id: string
  data?: Record<string, unknown>
}

export interface LogEntry {
  timestamp: string
  severity: 'info' | 'warning' | 'error' | 'debug'
  source: string
  message: string
  details?: string
}

export interface MayaNotification {
  id: string
  type: 'info' | 'warning' | 'error' | 'success'
  title: string
  message: string
  action?: {
    label: string
    handler: () => void
  }
  timestamp: number
  read: boolean
}

interface WebSocketContextType {
  connected: boolean
  /** True after the first disconnect while we are retrying. */
  reconnecting: boolean
  /** Current retry attempt (0 when connected). */
  reconnectAttempt: number
  systemStats: SystemStats | null
  logs: LogEntry[]
  mayaNotifications: MayaNotification[]
  sendCommand: (command: string, payload?: Record<string, unknown>) => void
  /** Force an immediate reconnect attempt (used by the "Retry now" button). */
  reconnectNow: () => void
  subscribeToDockerEvents: (callback: (event: DockerEvent) => void) => () => void
  subscribeToLogs: (callback: (log: LogEntry) => void) => () => void
  subscribeToMayaNotifications: (callback: (notif: MayaNotification) => void) => () => void
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined)

/** Backoff schedule: 1s, 2s, 4s, 8s, then capped at 15s. Retries forever. */
export const WS_BACKOFF_BASE_MS = 1000
export const WS_BACKOFF_MAX_MS = 15000
export function wsBackoffDelay(attempt: number): number {
  return Math.min(WS_BACKOFF_MAX_MS, WS_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt - 1)))
}

/**
 * Build a WebSocket URL for a backend channel and append the auth token as
 * `?token=<jwt>` — the upgrade handler in the backend verifies it.
 *
 *   wsUrl('/ws/stats')                -> ws://host/ws/stats?token=...
 *   wsUrl(`/ws/terminal/${id}`)       -> ws://host/ws/terminal/<id>?token=...
 */
export function wsUrl(path: string, extraParams?: Record<string, string>): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = localStorage.getItem('auth-token') || ''
  const params = new URLSearchParams({ token, ...(extraParams || {}) })
  const sep = path.includes('?') ? '&' : '?'
  return `${protocol}//${window.location.host}${path}${sep}${params.toString()}`
}

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [mayaNotifications, setMayaNotifications] = useState<MayaNotification[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const everConnectedRef = useRef(false)
  const unmountedRef = useRef(false)

  const dockerEventCallbacksRef = useRef<Set<(event: DockerEvent) => void>>(new Set())
  const logCallbacksRef = useRef<Set<(log: LogEntry) => void>>(new Set())
  const mayaCallbacksRef = useRef<Set<(notif: MayaNotification) => void>>(new Set())

  const connectWebSocket = () => {
    if (unmountedRef.current) return
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return

    try {
      const ws = new WebSocket(wsUrl('/ws/stats'))

      ws.onopen = () => {
        setConnected(true)
        setReconnecting(false)
        setReconnectAttempt(0)
        reconnectAttemptsRef.current = 0
        everConnectedRef.current = true

        // Subscribe to system stats
        sendCommandViaWs(ws, 'subscribe', { channels: ['system-stats', 'logs', 'docker', 'maya'] })
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handleMessage(data)
        } catch (e) {
          console.error('Failed to parse message:', e)
        }
      }

      ws.onerror = () => {
        // onclose follows; reconnect is scheduled there
      }

      ws.onclose = (ev) => {
        if (wsRef.current === ws) wsRef.current = null
        setConnected(false)
        // 4401/4403 are used by the backend for auth failures on upgrade
        if (ev.code === 4401 || ev.code === 4403 || ev.code === 1008) {
          localStorage.removeItem('auth-token')
          window.location.reload()
          return
        }
        scheduleReconnect()
      }

      wsRef.current = ws
    } catch (e) {
      console.error('Failed to create WebSocket:', e)
      scheduleReconnect()
    }
  }

  const scheduleReconnect = () => {
    if (unmountedRef.current) return
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    reconnectAttemptsRef.current++
    const attempt = reconnectAttemptsRef.current
    setReconnecting(true)
    setReconnectAttempt(attempt)
    const delay = wsBackoffDelay(attempt)
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null
      connectWebSocket()
    }, delay)
  }

  const reconnectNow = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
      try { wsRef.current.close() } catch { /* ignore */ }
      wsRef.current = null
    }
    connectWebSocket()
  }

  const handleMessage = (data: Record<string, unknown>) => {
    const type = data.type as string

    if (type === 'system-stats') {
      setSystemStats(data.payload as SystemStats)
    } else if (type === 'docker-event') {
      const event = data.payload as DockerEvent
      dockerEventCallbacksRef.current.forEach((cb) => cb(event))
    } else if (type === 'log') {
      const logEntry = data.payload as LogEntry
      setLogs((prev) => [...prev.slice(-99), logEntry])
      logCallbacksRef.current.forEach((cb) => cb(logEntry))
    } else if (type === 'maya-notification') {
      const notif = data.payload as MayaNotification
      setMayaNotifications((prev) => [...prev, notif])
      mayaCallbacksRef.current.forEach((cb) => cb(notif))
    }
  }

  const sendCommandViaWs = (ws: WebSocket, command: string, payload?: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ command, payload }))
    }
  }

  const sendCommand = (command: string, payload?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendCommandViaWs(wsRef.current, command, payload)
    } else {
      console.warn('WebSocket not connected')
    }
  }

  const subscribeToDockerEvents = (callback: (event: DockerEvent) => void) => {
    dockerEventCallbacksRef.current.add(callback)
    return () => {
      dockerEventCallbacksRef.current.delete(callback)
    }
  }

  const subscribeToLogs = (callback: (log: LogEntry) => void) => {
    logCallbacksRef.current.add(callback)
    return () => {
      logCallbacksRef.current.delete(callback)
    }
  }

  const subscribeToMayaNotifications = (callback: (notif: MayaNotification) => void) => {
    mayaCallbacksRef.current.add(callback)
    return () => {
      mayaCallbacksRef.current.delete(callback)
    }
  }

  // Connect on mount; reconnect promptly when the tab regains focus / network returns
  useEffect(() => {
    unmountedRef.current = false
    connectWebSocket()

    const onOnline = () => reconnectNow()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !wsRef.current) reconnectNow()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      unmountedRef.current = true
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [])

  const value: WebSocketContextType = {
    connected,
    reconnecting,
    reconnectAttempt,
    systemStats,
    logs,
    mayaNotifications,
    sendCommand,
    reconnectNow,
    subscribeToDockerEvents,
    subscribeToLogs,
    subscribeToMayaNotifications,
  }

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>
}

export const useWebSocket = () => {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider')
  }
  return context
}
