import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'

export const ProcessesWidget: React.FC = () => {
  const stats = useSystemStats()
  const procs = stats?.processes

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4 h-full overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-trakend-text-primary">Processes</h3>
        {procs && (
          <div className="flex gap-3 text-xs text-trakend-text-secondary">
            <span>{procs.total} total</span>
            <span className="text-trakend-success">{procs.running} running</span>
            {procs.blocked > 0 && <span className="text-trakend-error">{procs.blocked} blocked</span>}
          </div>
        )}
      </div>
      {procs && procs.list.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-trakend-text-secondary border-b border-trakend-border">
              <th className="text-left py-1 pr-2">PID</th>
              <th className="text-left py-1 pr-2">Name</th>
              <th className="text-right py-1 pr-2">CPU%</th>
              <th className="text-right py-1 pr-2">MEM%</th>
              <th className="text-left py-1">User</th>
            </tr>
          </thead>
          <tbody>
            {procs.list.map((p) => (
              <tr key={p.pid} className="border-b border-trakend-border/30 hover:bg-trakend-dark/30">
                <td className="py-1 pr-2 text-trakend-text-secondary font-mono">{p.pid}</td>
                <td className="py-1 pr-2 text-trakend-text-primary truncate max-w-[150px]">{p.name}</td>
                <td className="py-1 pr-2 text-right">
                  <span className={p.cpu > 50 ? 'text-trakend-warning' : p.cpu > 80 ? 'text-trakend-error' : 'text-trakend-text-primary'}>
                    {p.cpu.toFixed(1)}
                  </span>
                </td>
                <td className="py-1 pr-2 text-right text-trakend-text-primary">{p.mem.toFixed(1)}</td>
                <td className="py-1 text-trakend-text-secondary truncate max-w-[80px]">{p.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-xs text-trakend-text-secondary">No process data</div>
      )}
    </div>
  )
}
