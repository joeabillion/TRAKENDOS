import React, { useEffect, useState, useRef } from 'react'
import { Bell, AlertTriangle, Info, CheckCircle, XCircle, X, Menu, Server, Clock, Globe } from 'lucide-react'
import clsx from 'clsx'
import { useWebSocket } from '../../context/WebSocketContext'
import { formatBytes, formatUptime } from '../../utils/formatters'
import { Badge } from './Badge'

interface SystemAlert {
  id: string
  type: 'info' | 'warning' | 'error' | 'success'
  title: string
  message: string
  timestamp: number
  read: boolean
}

interface TopBarProps {
  onToggleSidebar?: () => void
}

/** First non-loopback IPv4 reported by the stats stream. */
function primaryIp(stats: { network?: Array<{ name: string; ip: string }> } | null): string | null {
  if (!stats?.network) return null
  const nic = stats.network.find((n) => n.ip && n.name !== 'lo' && !n.ip.startsWith('127.') && !n.name.startsWith('docker') && !n.name.startsWith('br-') && !n.name.startsWith('veth'))
    || stats.network.find((n) => n.ip && n.name !== 'lo')
  return nic?.ip || null
}

export const TopBar: React.FC<TopBarProps> = ({ onToggleSidebar }) => {
  const { systemStats, connected, reconnecting } = useWebSocket()
  const [alerts, setAlerts] = useState<SystemAlert[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Generate system alerts from stats
  useEffect(() => {
    if (!systemStats) return
    const newAlerts: SystemAlert[] = []

    // High memory usage
    if (systemStats.memory.total > 0) {
      const memPct = (systemStats.memory.used / systemStats.memory.total) * 100
      if (memPct > 90) {
        newAlerts.push({ id: 'mem-high', type: 'error', title: 'High Memory Usage', message: `RAM at ${memPct.toFixed(0)}%`, timestamp: Date.now(), read: false })
      } else if (memPct > 75) {
        newAlerts.push({ id: 'mem-warn', type: 'warning', title: 'Memory Usage Warning', message: `RAM at ${memPct.toFixed(0)}%`, timestamp: Date.now(), read: false })
      }
    }

    // High CPU
    if (systemStats.cpu.usage > 90) {
      newAlerts.push({ id: 'cpu-high', type: 'error', title: 'High CPU Usage', message: `CPU at ${systemStats.cpu.usage.toFixed(0)}%`, timestamp: Date.now(), read: false })
    }

    // Stopped containers
    if (systemStats.docker.stopped > 0) {
      newAlerts.push({ id: 'docker-stopped', type: 'warning', title: 'Containers Stopped', message: `${systemStats.docker.stopped} container(s) not running`, timestamp: Date.now(), read: false })
    }

    // Storage warnings
    if (systemStats.storage) {
      systemStats.storage.forEach((d: any) => {
        if (d.size > 0) {
          const pct = (d.used / d.size) * 100
          if (pct > 90) {
            newAlerts.push({ id: `disk-${d.name}`, type: 'error', title: 'Disk Almost Full', message: `${d.name} at ${pct.toFixed(0)}%`, timestamp: Date.now(), read: false })
          }
        }
        if (d.health && d.health !== 'good') {
          newAlerts.push({ id: `health-${d.name}`, type: 'error', title: 'Disk Health Issue', message: `${d.name}: ${d.health}`, timestamp: Date.now(), read: false })
        }
      })
    }

    // Connection status
    if (!connected) {
      newAlerts.push({ id: 'ws-disconnected', type: 'error', title: 'Connection Lost', message: 'WebSocket disconnected from server', timestamp: Date.now(), read: false })
    }

    // Keep read state from previous alerts
    setAlerts(prev => {
      const readIds = new Set(prev.filter(a => a.read).map(a => a.id))
      return newAlerts.map(a => ({ ...a, read: readIds.has(a.id) }))
    })
  }, [systemStats, connected])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const unreadCount = alerts.filter(a => !a.read).length
  const markAllRead = () => setAlerts(prev => prev.map(a => ({ ...a, read: true })))
  const dismissAlert = (id: string) => setAlerts(prev => prev.filter(a => a.id !== id))

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'error': return <XCircle size={14} className="text-trakend-error flex-shrink-0" />
      case 'warning': return <AlertTriangle size={14} className="text-trakend-warning flex-shrink-0" />
      case 'success': return <CheckCircle size={14} className="text-trakend-success flex-shrink-0" />
      default: return <Info size={14} className="text-trakend-accent flex-shrink-0" />
    }
  }

  const ip = primaryIp(systemStats)

  return (
    <header className="app-topbar bg-trakend-surface border-b border-trakend-border flex items-center justify-between gap-3 px-3 sm:px-4">
      {/* Left: hamburger + System Info */}
      <div className="flex items-center gap-3 sm:gap-5 min-w-0">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            aria-label="Toggle navigation"
            className="lg:hidden p-1.5 -ml-1 rounded text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light focus-ring"
          >
            <Menu size={18} />
          </button>
        )}

        {systemStats ? (
          <>
            <div className="flex items-center gap-1.5 min-w-0" title="Hostname">
              <Server size={13} className="text-trakend-accent flex-shrink-0" />
              <span className="text-sm font-semibold text-trakend-text-primary truncate">{systemStats.hostname}</span>
            </div>

            {ip && (
              <div className="hidden sm:flex items-center gap-1.5" title="Primary IP address">
                <Globe size={13} className="text-trakend-text-secondary flex-shrink-0" />
                <span className="text-xs font-mono text-trakend-text-secondary">{ip}</span>
              </div>
            )}

            <div className="hidden md:flex items-center gap-1.5" title="Uptime">
              <Clock size={13} className="text-trakend-text-secondary flex-shrink-0" />
              <span className="text-xs text-trakend-text-secondary">up {formatUptime(systemStats.uptime)}</span>
            </div>

            <div className="hidden xl:flex items-center gap-4 pl-4 border-l border-trakend-border">
              <div>
                <span className="text-[10px] text-trakend-text-secondary uppercase tracking-wide mr-2">RAM</span>
                <span className="text-xs font-semibold text-trakend-text-primary">
                  {formatBytes(systemStats.memory.used)} / {formatBytes(systemStats.memory.total)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-trakend-text-secondary uppercase tracking-wide mr-2">Containers</span>
                <span className="text-xs font-semibold text-trakend-success">{systemStats.docker.running}</span>
                <span className="text-xs text-trakend-text-secondary">/{systemStats.docker.total}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <div className="skeleton h-3.5 w-28 rounded" />
            <div className="skeleton h-3 w-20 rounded hidden sm:block" />
          </div>
        )}
      </div>

      {/* Right: Bell + Connection */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Notifications Bell */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => { setShowDropdown(!showDropdown); if (!showDropdown) markAllRead() }}
            aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
            aria-haspopup="menu"
            aria-expanded={showDropdown}
            className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-trakend-surface-light transition-colors text-trakend-text-secondary hover:text-trakend-text-primary focus-ring"
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-trakend-error rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                {Math.min(unreadCount, 9)}
              </span>
            )}
          </button>

          {/* Dropdown */}
          {showDropdown && (
            <div className="absolute right-0 top-10 w-80 bg-trakend-surface border border-trakend-border rounded-lg shadow-2xl z-50 overflow-hidden" role="menu">
              <div className="px-4 py-3 border-b border-trakend-border flex items-center justify-between">
                <span className="text-sm font-semibold text-trakend-text-primary">Notifications</span>
                <span className="text-xs text-trakend-text-secondary">{alerts.length} alert{alerts.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {alerts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-trakend-text-secondary">
                    All systems nominal
                  </div>
                ) : (
                  alerts.map(alert => (
                    <div key={alert.id} className="px-4 py-2.5 border-b border-trakend-border/50 hover:bg-trakend-surface-light flex items-start gap-2.5">
                      {getAlertIcon(alert.type)}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-trakend-text-primary">{alert.title}</div>
                        <div className="text-xs text-trakend-text-secondary">{alert.message}</div>
                      </div>
                      <button onClick={() => dismissAlert(alert.id)} aria-label="Dismiss" className="p-0.5 hover:bg-trakend-dark rounded text-trakend-text-secondary focus-ring">
                        <X size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Connection Status */}
        <Badge
          tone={connected ? 'success' : reconnecting ? 'warning' : 'error'}
          dot
          pulse={connected}
          size="xs"
          className={clsx('font-medium')}
          title={connected ? 'Live connection to the server' : reconnecting ? 'Connection lost — retrying' : 'Not connected'}
        >
          <span className="hidden sm:inline">{connected ? 'Connected' : reconnecting ? 'Reconnecting' : 'Offline'}</span>
          {systemStats?.hostname && <span className="hidden lg:inline opacity-70">· {systemStats.hostname}</span>}
        </Badge>
      </div>
    </header>
  )
}
