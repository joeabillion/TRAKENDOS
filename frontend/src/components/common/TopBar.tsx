import React, { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWebSocket } from '../../context/WebSocketContext'
import { formatBytes, formatUptime } from '../../utils/formatters'

export const TopBar: React.FC = () => {
  const { systemStats, mayaNotifications, connected } = useWebSocket()
  const [unreadCount, setUnreadCount] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    const unread = mayaNotifications.filter((n) => !n.read).length
    setUnreadCount(unread)
  }, [mayaNotifications])

  return (
    <div className="h-12 bg-trakend-surface border-b border-trakend-border flex items-center justify-between px-6">
      {/* Left: System Info */}
      <div className="flex items-center gap-6">
        {systemStats && (
          <>
            <div>
              <span className="text-xs text-trakend-text-secondary uppercase tracking-wide mr-2">Host</span>
              <span className="text-sm font-semibold text-trakend-text-primary">{systemStats.hostname}</span>
            </div>

            <div className="h-6 w-px bg-trakend-border"></div>

            <div>
              <span className="text-xs text-trakend-text-secondary uppercase tracking-wide mr-2">Uptime</span>
              <span className="text-sm font-semibold text-trakend-text-primary">
                {formatUptime(systemStats.uptime)}
              </span>
            </div>

            <div className="h-6 w-px bg-trakend-border"></div>

            <div>
              <span className="text-xs text-trakend-text-secondary uppercase tracking-wide mr-2">RAM</span>
              <span className="text-sm font-semibold text-trakend-text-primary">
                {formatBytes(systemStats.memory.used)} / {formatBytes(systemStats.memory.total)}
              </span>
            </div>

            <div className="h-6 w-px bg-trakend-border"></div>

            <div>
              <span className="text-xs text-trakend-text-secondary uppercase tracking-wide mr-2">Containers</span>
              <span className="text-sm font-semibold text-trakend-success">{systemStats.docker.running}</span>
              <span className="text-sm text-trakend-text-secondary">/{systemStats.docker.total}</span>
            </div>
          </>
        )}
      </div>

      {/* Right: Bell + Connection */}
      <div className="flex items-center gap-3">
        {/* Notifications Bell */}
        <button
          onClick={() => navigate('/maya')}
          className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-trakend-surface-light transition-colors text-trakend-text-secondary hover:text-trakend-text-primary"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-trakend-error rounded-full text-white text-[10px] flex items-center justify-center font-bold">
              {Math.min(unreadCount, 9)}
            </span>
          )}
        </button>

        {/* Connection Status */}
        <div className="flex items-center gap-2 px-2 py-1 rounded bg-trakend-surface-light">
          <div
            className={`w-2 h-2 rounded-full ${connected ? 'bg-trakend-success animate-pulse' : 'bg-trakend-error'}`}
          ></div>
          <span className="text-xs text-trakend-text-secondary">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </div>
  )
}
