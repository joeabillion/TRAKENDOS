import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'

export const DockerContainersWidget: React.FC = () => {
  const stats = useSystemStats()
  const containers = stats?.dockerContainers || []
  const running = containers.filter(c => c.state === 'running')
  const stopped = containers.filter(c => c.state !== 'running')

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4 h-full overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-trakend-text-primary">Docker Containers</h3>
        <div className="flex gap-2 text-xs">
          <span className="text-trakend-success">{running.length} running</span>
          {stopped.length > 0 && <span className="text-trakend-text-secondary">{stopped.length} stopped</span>}
        </div>
      </div>
      {containers.length > 0 ? (
        <div className="space-y-1">
          {containers.map(c => (
            <div key={c.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-trakend-dark/30 border-b border-trakend-border/20">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.state === 'running' ? 'bg-trakend-success' : 'bg-trakend-text-secondary'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-trakend-text-primary truncate">{c.name}</div>
                <div className="text-[10px] text-trakend-text-secondary truncate">{c.image}</div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className={`text-[10px] font-medium ${c.state === 'running' ? 'text-trakend-success' : 'text-trakend-text-secondary'}`}>
                  {c.state}
                </div>
                {c.ports.length > 0 && (
                  <div className="text-[10px] text-trakend-text-secondary truncate max-w-[100px]">{c.ports.join(', ')}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-trakend-text-secondary">No containers</div>
      )}
    </div>
  )
}
