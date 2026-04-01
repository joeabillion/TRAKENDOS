import React from 'react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatSpeed } from '../../utils/formatters'

export const NetworkWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats || !stats.network || stats.network.length === 0) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <div className="text-sm text-trakend-text-secondary">No network interfaces</div>
      </div>
    )
  }

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">Network</h3>

      <div className="space-y-4">
        {stats.network.map((iface, i) => {
          // Generate mock historical data for sparkline
          const mockData = Array.from({ length: 20 }, (_, idx) => ({
            rx: Math.random() * iface.rxSpeed * 1000,
            tx: Math.random() * iface.txSpeed * 1000,
          }))

          return (
            <div key={i} className="p-4 bg-trakend-dark rounded border border-trakend-border">
              {/* Interface Header */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold text-trakend-text-primary">{iface.name}</div>
                  <div className="text-xs text-trakend-text-secondary">{iface.ip}</div>
                </div>
                <div className="text-right text-xs text-trakend-text-secondary">
                  <div>Speed: {iface.speed} Mbps</div>
                </div>
              </div>

              {/* Traffic Chart */}
              <div className="mb-3 h-16 -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={mockData}>
                    <Area
                      type="monotone"
                      dataKey="rx"
                      stackId="1"
                      stroke="none"
                      fill="#ff6b35"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="tx"
                      stackId="1"
                      stroke="none"
                      fill="#3273dc"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Current Stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded bg-trakend-accent"></div>
                  <div>
                    <div className="text-trakend-text-secondary">Download</div>
                    <div className="text-trakend-text-primary font-mono">{formatSpeed(iface.rxSpeed)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded bg-trakend-info"></div>
                  <div>
                    <div className="text-trakend-text-secondary">Upload</div>
                    <div className="text-trakend-text-primary font-mono">{formatSpeed(iface.txSpeed)}</div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
