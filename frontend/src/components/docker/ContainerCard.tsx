import React, { useState } from 'react'
import { MoreVertical, Play, Pause, RotateCw, Trash2, Terminal, Settings } from 'lucide-react'
import { formatPercentage } from '../../utils/formatters'
import { Container } from '../../hooks/useDocker'

interface ContainerCardProps {
  container: Container
  onStart: (id: string) => void
  onStop: (id: string) => void
  onRestart: (id: string) => void
  onRemove: (id: string) => void
  onLogs: (id: string) => void
  onShell: (id: string) => void
  onSettings: (id: string) => void
}

export const ContainerCard: React.FC<ContainerCardProps> = ({
  container,
  onStart,
  onStop,
  onRestart,
  onRemove,
  onLogs,
  onShell,
  onSettings,
}) => {
  const [showMenu, setShowMenu] = useState(false)

  const isRunning = container.status === 'running'
  const statusColor = isRunning ? 'text-trakend-success' : 'text-trakend-error'

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4 hover:border-trakend-accent transition-colors relative group">
      {/* Card Content */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <h3 className="font-semibold text-trakend-text-primary text-sm mb-1">{container.name}</h3>
          <p className="text-xs text-trakend-text-secondary font-mono">{container.image}</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-trakend-surface-light transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreVertical size={16} className="text-trakend-text-secondary" />
          </button>

          {/* Context Menu */}
          {showMenu && (
            <div className="absolute right-0 top-8 bg-trakend-dark border border-trakend-border rounded-lg shadow-lg z-10 min-w-max">
              <button
                onClick={() => {
                  if (isRunning) onStop(container.id)
                  else onStart(container.id)
                  setShowMenu(false)
                }}
                className="w-full text-left px-4 py-2 text-xs text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light transition-colors flex items-center gap-2"
              >
                {isRunning ? <Pause size={14} /> : <Play size={14} />}
                {isRunning ? 'Stop' : 'Start'}
              </button>
              <button
                onClick={() => {
                  onRestart(container.id)
                  setShowMenu(false)
                }}
                className="w-full text-left px-4 py-2 text-xs text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light transition-colors flex items-center gap-2"
              >
                <RotateCw size={14} />
                Restart
              </button>
              <button
                onClick={() => {
                  onLogs(container.id)
                  setShowMenu(false)
                }}
                className="w-full text-left px-4 py-2 text-xs text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light transition-colors flex items-center gap-2"
              >
                <Terminal size={14} />
                Logs
              </button>
              <button
                onClick={() => {
                  onShell(container.id)
                  setShowMenu(false)
                }}
                className="w-full text-left px-4 py-2 text-xs text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light transition-colors flex items-center gap-2"
              >
                <Terminal size={14} />
                Shell
              </button>
              <button
                onClick={() => {
                  onSettings(container.id)
                  setShowMenu(false)
                }}
                className="w-full text-left px-4 py-2 text-xs text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light transition-colors flex items-center gap-2"
              >
                <Settings size={14} />
                Settings
              </button>
              <hr className="border-trakend-border my-1" />
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to remove this container?')) {
                    onRemove(container.id)
                  }
                  setShowMenu(false)
                }}
                className="w-full text-left px-4 py-2 text-xs text-trakend-error hover:bg-trakend-surface-light transition-colors flex items-center gap-2"
              >
                <Trash2 size={14} />
                Remove
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Status Badge */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-trakend-success animate-pulse' : 'bg-trakend-error'}`}></div>
          <span className={`text-xs font-medium uppercase ${statusColor}`}>{container.status}</span>
        </div>
        <div className="text-xs text-trakend-text-secondary">
          {new Date(container.created).toLocaleDateString()}
        </div>
      </div>

      {/* Resource Usage */}
      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div className="bg-trakend-dark rounded p-2">
          <div className="text-trakend-text-secondary">CPU</div>
          <div className="text-trakend-text-primary font-mono">{formatPercentage(container.cpuUsage)}</div>
        </div>
        <div className="bg-trakend-dark rounded p-2">
          <div className="text-trakend-text-secondary">RAM</div>
          <div className="text-trakend-text-primary font-mono">{formatPercentage(container.memoryUsage)}</div>
        </div>
      </div>

      {/* Ports */}
      {container.ports.length > 0 && (
        <div className="border-t border-trakend-border pt-2 text-xs">
          <div className="text-trakend-text-secondary mb-1">Ports</div>
          <div className="space-y-1">
            {container.ports.slice(0, 3).map((port, i) => (
              <div key={i} className="text-trakend-text-primary font-mono">
                {port.hostPort}:{port.containerPort}/{port.protocol}
              </div>
            ))}
            {container.ports.length > 3 && (
              <div className="text-trakend-text-secondary">+{container.ports.length - 3} more</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
