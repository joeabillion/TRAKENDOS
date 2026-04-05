import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes } from '../../utils/formatters'

export const SwapWidget: React.FC = () => {
  const stats = useSystemStats()
  const mem = stats?.memory
  const swapTotal = mem?.swapTotal || 0
  const swapUsed = mem?.swapUsed || 0
  const swapFree = mem?.swapFree || 0
  const swapPercent = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4 h-full">
      <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">Swap</h3>
      {swapTotal > 0 ? (
        <div>
          <div className="flex items-end justify-between mb-2">
            <div>
              <div className="text-2xl font-bold text-trakend-text-primary">{swapPercent.toFixed(1)}%</div>
              <div className="text-xs text-trakend-text-secondary">used</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-trakend-text-secondary">{formatBytes(swapUsed)} / {formatBytes(swapTotal)}</div>
              <div className="text-xs text-trakend-text-secondary">{formatBytes(swapFree)} free</div>
            </div>
          </div>
          <div className="h-3 bg-trakend-dark rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${swapPercent > 80 ? 'bg-trakend-error' : swapPercent > 50 ? 'bg-trakend-warning' : 'bg-trakend-accent'}`}
              style={{ width: `${swapPercent}%` }}
            />
          </div>
          {/* Memory breakdown */}
          {mem && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-trakend-text-secondary">Buffered</span>
                <div className="font-medium text-trakend-text-primary">{formatBytes(mem.buffered)}</div>
              </div>
              <div>
                <span className="text-trakend-text-secondary">Cached</span>
                <div className="font-medium text-trakend-text-primary">{formatBytes(mem.cached)}</div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-trakend-text-secondary">No swap configured</div>
      )}
    </div>
  )
}
