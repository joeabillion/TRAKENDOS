import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes } from '../../utils/formatters'

export const DiskIOWidget: React.FC = () => {
  const stats = useSystemStats()
  const io = stats?.diskIO

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4 h-full">
      <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">Disk I/O</h3>
      {io ? (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-trakend-text-secondary mb-1">Read</div>
            <div className="text-lg font-bold text-trakend-accent">{formatBytes(io.readBytesPerSec)}/s</div>
            <div className="mt-2 h-2 bg-trakend-dark rounded-full overflow-hidden">
              <div className="h-full bg-trakend-accent rounded-full transition-all" style={{ width: `${Math.min(100, (io.readBytesPerSec / 1048576) * 10)}%` }} />
            </div>
          </div>
          <div>
            <div className="text-xs text-trakend-text-secondary mb-1">Write</div>
            <div className="text-lg font-bold text-trakend-warning">{formatBytes(io.writeBytesPerSec)}/s</div>
            <div className="mt-2 h-2 bg-trakend-dark rounded-full overflow-hidden">
              <div className="h-full bg-trakend-warning rounded-full transition-all" style={{ width: `${Math.min(100, (io.writeBytesPerSec / 1048576) * 10)}%` }} />
            </div>
          </div>
          <div>
            <div className="text-xs text-trakend-text-secondary">Read Ops</div>
            <div className="text-sm font-medium text-trakend-text-primary">{io.readPerSec.toFixed(0)}/s</div>
          </div>
          <div>
            <div className="text-xs text-trakend-text-secondary">Write Ops</div>
            <div className="text-sm font-medium text-trakend-text-primary">{io.writePerSec.toFixed(0)}/s</div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-trakend-text-secondary">No disk I/O data</div>
      )}
    </div>
  )
}
