import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatUptime } from '../../utils/formatters'
import { CpuWidget } from './CpuWidget'
import { MemoryWidget } from './MemoryWidget'
import { StorageWidget } from './StorageWidget'
import { GpuWidget } from './GpuWidget'
import { NetworkWidget } from './NetworkWidget'
import { Server, Database, Box } from 'lucide-react'

export const Dashboard: React.FC = () => {
  const stats = useSystemStats()

  return (
    <div className="flex-1 overflow-y-auto bg-trakend-dark">
      <div className="p-8">
        {/* System Overview Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6 hover-lift">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-trakend-text-secondary">Hostname</div>
                <Server size={16} className="text-trakend-accent" />
              </div>
              <div className="text-2xl font-bold text-trakend-text-primary">{stats.hostname}</div>
              <div className="text-xs text-trakend-text-secondary mt-2">Server Identity</div>
            </div>

            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6 hover-lift">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-trakend-text-secondary">OS / Kernel</div>
                <Database size={16} className="text-trakend-accent" />
              </div>
              <div className="text-lg font-bold text-trakend-text-primary">{stats.os}</div>
              <div className="text-xs text-trakend-text-secondary mt-2 font-mono">{stats.kernel}</div>
            </div>

            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6 hover-lift">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-trakend-text-secondary">Uptime</div>
                <svg className="w-4 h-4 text-trakend-success" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="text-xl font-bold text-trakend-success">{formatUptime(stats.uptime)}</div>
              <div className="text-xs text-trakend-text-secondary mt-2">System Running</div>
            </div>

            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6 hover-lift">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-trakend-text-secondary">Containers</div>
                <Box size={16} className="text-trakend-accent" />
              </div>
              <div className="text-2xl font-bold text-trakend-text-primary">{stats.docker.total}</div>
              <div className="text-xs text-trakend-text-secondary mt-2">
                <span className="text-trakend-success">{stats.docker.running}</span> running,{' '}
                <span className="text-trakend-warning">{stats.docker.stopped}</span> stopped
              </div>
            </div>
          </div>
        )}

        {/* Main Widgets Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column */}
          <div className="space-y-8">
            <CpuWidget />
            <MemoryWidget />
          </div>

          {/* Right Column */}
          <div className="space-y-8">
            <StorageWidget />
            <GpuWidget />
          </div>
        </div>

        {/* Network Widget - Full Width */}
        <div className="mt-8">
          <NetworkWidget />
        </div>
      </div>
    </div>
  )
}
