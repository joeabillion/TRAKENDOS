import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Filter, Download, RefreshCw } from 'lucide-react'
import api from '../../utils/api'

interface LogEntry {
  id: string
  timestamp: number
  level: string
  source: string
  message: string
  metadata?: string
  pattern_detected?: string
}

interface LogStats {
  total: number
  byLevel: Record<string, number>
  bySource: Record<string, number>
}

export const LogsPage: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [level, setLevel] = useState<string>('')
  const [source, setSource] = useState<string>('')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: '200' }
      if (level) params.level = level
      if (source) params.source = source
      if (search) params.search = search
      const { data } = await api.get('/logs', { params })
      setLogs(data)
    } catch (err) {
      console.error('Failed to fetch logs:', err)
    } finally {
      setLoading(false)
    }
  }, [level, source, search])

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await api.get('/logs/stats')
      setStats(data)
    } catch {}
  }, [])

  // Initial load + refresh
  useEffect(() => {
    fetchLogs()
    fetchStats()
  }, [fetchLogs, fetchStats])

  // Auto-refresh every 5s
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => { fetchLogs(); fetchStats() }, 5000)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, fetchLogs, fetchStats])

  const handleExport = () => {
    const params = new URLSearchParams()
    if (level) params.set('level', level)
    if (source) params.set('source', source)
    window.open(`/api/logs/export?${params.toString()}`, '_blank')
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleString()
  }

  const getLevelColor = (lv: string) => {
    switch (lv) {
      case 'ERROR': case 'CRITICAL': return 'text-trakend-error'
      case 'WARN': return 'text-trakend-warning'
      case 'INFO': return 'text-trakend-accent'
      case 'DEBUG': return 'text-trakend-text-secondary'
      default: return 'text-trakend-text-primary'
    }
  }

  const getLevelBg = (lv: string) => {
    switch (lv) {
      case 'ERROR': case 'CRITICAL': return 'bg-red-900/30'
      case 'WARN': return 'bg-yellow-900/30'
      case 'INFO': return 'bg-teal-900/30'
      case 'DEBUG': return 'bg-trakend-surface'
      default: return 'bg-trakend-surface'
    }
  }

  const sources = stats && stats.bySource ? Object.keys(stats.bySource).filter(s => stats.bySource[s] > 0) : []

  return (
    <div className="flex-1 bg-trakend-dark h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-trakend-surface border-b border-trakend-border p-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-trakend-text-primary">System Logs</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                autoRefresh ? 'bg-trakend-accent text-white' : 'bg-trakend-dark text-trakend-text-secondary border border-trakend-border'
              }`}
            >
              <RefreshCw size={13} className={autoRefresh ? 'animate-spin' : ''} />
              {autoRefresh ? 'Live' : 'Paused'}
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-trakend-dark text-trakend-text-secondary border border-trakend-border hover:text-trakend-text-primary"
            >
              <Download size={13} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-trakend-text-secondary" />
            <select
              value={level}
              onChange={e => setLevel(e.target.value)}
              className="bg-trakend-dark border border-trakend-border rounded px-3 py-1 text-sm text-trakend-text-primary"
            >
              <option value="">All Levels</option>
              <option value="CRITICAL">Critical</option>
              <option value="ERROR">Error</option>
              <option value="WARN">Warning</option>
              <option value="INFO">Info</option>
              <option value="DEBUG">Debug</option>
            </select>
          </div>

          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className="bg-trakend-dark border border-trakend-border rounded px-3 py-1 text-sm text-trakend-text-primary"
          >
            <option value="">All Sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-48 bg-trakend-dark border border-trakend-border rounded px-3 py-1 text-sm text-trakend-text-primary"
          />
        </div>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="bg-trakend-surface border-b border-trakend-border px-4 py-2 flex gap-4 text-xs flex-shrink-0">
          <div><span className="text-trakend-text-secondary">Total: </span><span className="font-bold text-trakend-text-primary">{stats.total}</span></div>
          <div><span className="text-trakend-text-secondary">Critical: </span><span className="font-bold text-trakend-error">{stats.byLevel.CRITICAL || 0}</span></div>
          <div><span className="text-trakend-text-secondary">Errors: </span><span className="font-bold text-trakend-error">{stats.byLevel.ERROR || 0}</span></div>
          <div><span className="text-trakend-text-secondary">Warnings: </span><span className="font-bold text-trakend-warning">{stats.byLevel.WARN || 0}</span></div>
          <div><span className="text-trakend-text-secondary">Info: </span><span className="font-bold text-trakend-accent">{stats.byLevel.INFO || 0}</span></div>
          <div><span className="text-trakend-text-secondary">Debug: </span><span className="font-bold text-trakend-text-secondary">{stats.byLevel.DEBUG || 0}</span></div>
        </div>
      )}

      {/* Logs Table */}
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {loading ? (
          <div className="flex items-center justify-center h-full text-trakend-text-secondary">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-trakend-text-secondary text-center">
              <p className="text-lg mb-2">No logs found</p>
              <p className="text-xs">System events will appear here as they occur.</p>
            </div>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-trakend-dark">
              <tr className="border-b border-trakend-border text-trakend-text-secondary">
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-left font-medium">Level</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-trakend-border/30 hover:bg-trakend-surface/50 transition-colors">
                  <td className="px-3 py-1.5 text-trakend-text-secondary whitespace-nowrap">{formatTime(log.timestamp)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${getLevelBg(log.level)} ${getLevelColor(log.level)}`}>
                      {log.level}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="px-1.5 py-0.5 bg-trakend-dark rounded text-trakend-text-secondary">{log.source}</span>
                  </td>
                  <td className="px-3 py-1.5 text-trakend-text-primary">{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
