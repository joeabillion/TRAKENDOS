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
    sticks: Array<{
      type: string
      speed: string
      size: number
    }>
  }
  storage: Array<{
    name: string
    size: number
    used: number
    temp: number
    health: string
    type: string
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
  systemStats: SystemStats | null
  logs: LogEntry[]
  mayaNotifications: MayaNotification[]
  sendCommand: (command: string, payload?: Record<string, unknown>) => void
  subscribeToDoctorEvents: (callback: (event: DockerEvent) => void) => () => void
  subscribeToLogs: (callback: (log: LogEntry) => void) => () => void
  subscribeToMayaNotifications: (callback: (notif: MayaNotification) => void) => () => void
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined)

const RECONNECT_INTERVAL = 3000
const MAX_RECONNECT_ATTEMPTS = 5

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connected, setConnected] = useState(false)
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [mayaNotifications, setMayaNotifications] = useState<MayaNotification[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const dockerEventCallbacksRef = useRef<Set<(event: DockerEvent) => void>>(new Set())
  const logCallbacksRef = useRef<Set<(log: LogEntry) => void>>(new Set())
  const mayaCallbacksRef = useRef<Set<(notif: MayaNotification) => void>>(new Set())

  const getWsUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/ws/stats`
  }

  const connectWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const ws = new WebSocket(getWsUrl())

      ws.onopen = () => {
        console.log('WebSocket connected')
        setConnected(true)
        reconnectAttemptsRef.current = 0

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

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
      }

      ws.onclose = () => {
        console.log('WebSocket disconnected')
        setConnected(false)
        attemptReconnect()
      }

      wsRef.current = ws
    } catch (e) {
      console.error('Failed to create WebSocket:', e)
      attemptReconnect()
    }
  }

  const attemptReconnect = () => {
    if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current++
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log(`Reconnecting... (attempt ${reconnectAttemptsRef.current})`)
        connectWebSocket()
      }, RECONNECT_INTERVAL)
    }
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

  const subscribeToDoctorEvents = (callback: (event: DockerEvent) => void) => {
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

  // Connect on mount
  useEffect(() => {
    connectWebSocket()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  const value: WebSocketContextType = {
    connected,
    systemStats,
    logs,
    mayaNotifications,
    sendCommand,
    subscribeToDoctorEvents,
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
