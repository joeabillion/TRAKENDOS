import React from 'react'
import { HardDrive } from 'lucide-react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes, formatTemperature, formatPercentage, formatSpeed } from '../../utils/formatters'

export const StorageWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats || !stats.storage || stats.storage.length === 0) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <div className="text-sm text-trakend-text-secondary">Loading storage data...</div>
      </div>
    )
  }

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">Storage</h3>

      <div className="space-y-4">
        {stats.storage.map((drive, i) => {
          const usagePercent = (drive.used / drive.size) * 100
          const healthColor =
            drive.health === 'good' ? 'text-trakend-success' : drive.health === 'warning' ? 'text-trakend-warning' : 'text-trakend-error'

          return (
            <div key={i} className="p-4 bg-trakend-dark rounded border border-trakend-border">
              {/* Drive Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <HardDrive size={18} className="text-trakend-accent" />
                  <div>
                    <div className="font-semibold text-trakend-text-primary">{drive.name}</div>
                    <div className="text-xs text-trakend-text-secondary">
                      {drive.type.toUpperCase()} • {formatBytes(drive.size)}
                    </div>
                  </div>
                </div>
                <div className={`font-semibold text-sm ${healthColor}`}>{drive.health.toUpperCase()}</div>
              </div>

              {/* Usage Bar */}
              <div className="mb-3">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="text-trakend-text-secondary">
                    {formatBytes(drive.used)} / {formatBytes(drive.size)}
                  </span>
                  <span className="text-trakend-accent font-semibold">{formatPercentage(usagePercent)}</span>
                </div>
                <div className="w-full h-2 bg-trakend-border rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      usagePercent > 90
                        ? 'bg-trakend-error'
                        : usagePercent > 70
                          ? 'bg-trakend-warning'
                          : 'bg-trakend-success'
                    }`}
                    style={{ width: `${usagePercent}%` }}
                  ></div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-trakend-text-secondary">Temperature</div>
                  <div className="text-trakend-text-primary font-mono">{formatTemperature(drive.temp)}</div>
                </div>
                <div>
                  <div className="text-trakend-text-secondary">Read</div>
                  <div className="text-trakend-text-primary font-mono">{formatSpeed(drive.readSpeed)}</div>
                </div>
                <div>
                  <div className="text-trakend-text-secondary">Write</div>
                  <div className="text-trakend-text-primary font-mono">{formatSpeed(drive.writeSpeed)}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
