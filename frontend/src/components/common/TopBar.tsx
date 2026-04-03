import React, { useEffect, useState } from 'react'
import { Bell, Download, ArrowUpCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWebSocket } from '../../context/WebSocketContext'
import { formatBytes, formatUptime } from '../../utils/formatters'
import api from '../../utils/api'

interface UpdateStatus {
  currentVersion: string
  hasUpdate: boolean
  latestVersion: string
  lastChecked: number
}

export const TopBar: React.FC = () => {
  const { systemStats, mayaNotifications, connected } = useWebSocket()
  const [unreadCount, setUnreadCount] = useState(0)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const unread = mayaNotifications.filter((n) => !n.read).length
    setUnreadCount(unread)
  }, [mayaNotifications])

  // Check update status on mount and every 5 minutes
  useEffect(() => {
    const fetchUpdateStatus = async () => {
      try {
        const res = await api.get('/updates/status')
        setUpdateStatus(res.data)
      } catch {
        // Silently fail — update check is non-critical
      }
    }
    fetchUpdateStatus()
    const interval = setInterval(fetchUpdateStatus, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="h-16 bg-trakend-surface border-b border-trakend-border flex items-center justify-between px-6">
      {/* Left: System Info */}
      <div className="flex items-center gap-8">
        {systemStats && (
          <>
            <div className="flex items-center gap-4">
              <div>
                <div className="text-xs text-trakend-text-secondary uppercase tracking-wide">Hostname</div>
                <div className="text-sm font-semibold text-trakend-text-primary">{systemStats.hostname}</div>
              </div>
            </div>

            <div className="h-8 w-px bg-trakend-border"></div>

            <div className="flex items-center gap-4">
              <div>
                <div className="text-xs text-trakend-text-secondary uppercase tracking-wide">Uptime</div>
                <div className="text-sm font-semibold text-trakend-text-primary">
                  {formatUptime(systemStats.uptime)}
                </div>
              </div>
            </div>

            <div className="h-8 w-px bg-trakend-border"></div>

            <div className="flex items-center gap-4">
              <div>
                <div className="text-xs text-trakend-text-secondary uppercase tracking-wide">Memory</div>
                <div className="text-sm font-semibold text-trakend-text-primary">
                  {formatBytes(systemStats.memory.used)} / {formatBytes(systemStats.memory.total)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Right: Actions and Status */}
      <div className="flex items-center gap-4">
        {/* Update indicator */}
        <button
          onClick={() => navigate('/settings')}
          className={`relative flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            updateStatus?.hasUpdate
              ? 'bg-trakend-accent/10 text-trakend-accent hover:bg-trakend-accent/20 border border-trakend-accent/30'
              : 'hover:bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary'
          }`}
          title={
            updateStatus?.hasUpdate
              ? `Update available: ${updateStatus.latestVersion}`
              : `Current: ${updateStatus?.currentVersion || 'checking...'}`
          }
        >
          {updateStatus?.hasUpdate ? (
            <>
              <ArrowUpCircle size={18} className="animate-bounce" />
              <span className="text-xs font-semibold">Update Available</span>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-trakend-accent rounded-full animate-ping" />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-trakend-accent rounded-full" />
            </>
          ) : (
            <>
              <Download size={18} />
              <span className="text-xs">v{updateStatus?.currentVersion || '...'}</span>
            </>
          )}
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => navigate('/maya')}
            className="relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-trakend-surface-light transition-colors text-trakend-text-secondary hover:text-trakend-text-primary"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-0 right-0 w-5 h-5 bg-trakend-error rounded-full text-white text-xs flex items-center justify-center font-bold">
                {Math.min(unreadCount, 9)}
              </span>
            )}
          </button>
        </div>

        {/* Connection Status */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-trakend-surface-light">
          <div
            className={`w-2 h-2 rounded-full ${connected ? 'bg-trakend-success animate-pulse' : 'bg-trakend-error'}`}
          ></div>
          <span className="text-xs text-trakend-text-secondary">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </div>
  )
}
