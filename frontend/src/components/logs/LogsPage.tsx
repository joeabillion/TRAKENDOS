import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Download, RefreshCw, ChevronsDown, Pause, Play, Search, X, ScrollText, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import api from '../../utils/api'
import { Button } from '../common/Button'
import { Badge, BadgeTone } from '../common/Badge'
import { EmptyState } from '../common/EmptyState'
import { Skeleton } from '../common/Skeleton'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'

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

const LEVELS: { value: string; label: string; tone: BadgeTone }[] = [
  { value: 'CRITICAL', label: 'Critical', tone: 'error' },
  { value: 'ERROR', label: 'Error', tone: 'error' },
  { value: 'WARN', label: 'Warning', tone: 'warning' },
  { value: 'INFO', label: 'Info', tone: 'accent' },
  { value: 'DEBUG', label: 'Debug', tone: 'neutral' },
]

const ROW_HEIGHT = 30 // px — fixed row height makes windowing trivial
const OVERSCAN = 12
const PAGE_SIZE = 500

function levelTone(lv: string): BadgeTone {
  return LEVELS.find((l) => l.value === lv)?.tone || 'neutral'
}

/** Wrap case-insensitive matches of `q` in <mark>. */
function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text
  const parts: React.ReactNode[] = []
  let rest = text
  let key = 0
  let i = idx
  while (i >= 0 && parts.length < 60) {
    parts.push(rest.slice(0, i))
    parts.push(
      <mark key={key++} className="bg-trakend-warning/40 text-trakend-text-primary rounded-sm px-px">
        {rest.slice(i, i + q.length)}
      </mark>
    )
    rest = rest.slice(i + q.length)
    i = rest.toLowerCase().indexOf(q.toLowerCase())
  }
  parts.push(rest)
  return parts
}

export const LogsPage: React.FC = () => {
  const toast = useToast()
  const confirm = useConfirm()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Multi-select level chips; empty = all
  const [levels, setLevels] = useState<Set<string>>(new Set())
  const [source, setSource] = useState<string>('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [follow, setFollow] = useState(true)
  const [live, setLive] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const programmaticScroll = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const fetchLogs = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: String(PAGE_SIZE) }
      // Backend supports a single level filter; with one chip selected we let it filter,
      // otherwise we filter client-side below.
      if (levels.size === 1) params.level = Array.from(levels)[0]
      if (source) params.source = source
      if (debouncedSearch) params.search = debouncedSearch
      const { data } = await api.get('/logs', { params })
      // Oldest first so "follow" means the bottom
      const list: LogEntry[] = Array.isArray(data) ? [...data] : []
      list.sort((a, b) => a.timestamp - b.timestamp)
      setLogs(list)
      setError(null)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to fetch logs')
    } finally {
      setLoading(false)
    }
  }, [levels, source, debouncedSearch])

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await api.get('/logs/stats')
      setStats(data)
    } catch {
      /* non-fatal */
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchLogs()
    fetchStats()
  }, [fetchLogs, fetchStats])

  useEffect(() => {
    if (!live) return
    const t = setInterval(() => {
      fetchLogs()
      fetchStats()
    }, 5000)
    return () => clearInterval(t)
  }, [live, fetchLogs, fetchStats])

  // Client-side level filter when several chips are active
  const visible = useMemo(() => {
    if (levels.size <= 1) return logs
    return logs.filter((l) => levels.has(l.level))
  }, [logs, levels])

  // Viewport measurement for windowing
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    setViewportH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // Follow tail: stick to the bottom when new rows arrive
  useEffect(() => {
    if (!follow) return
    const el = scrollerRef.current
    if (!el) return
    programmaticScroll.current = true
    el.scrollTop = el.scrollHeight
    requestAnimationFrame(() => {
      programmaticScroll.current = false
    })
  }, [visible.length, follow, viewportH])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    if (programmaticScroll.current) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2
    // Scrolling up pauses following; reaching the bottom resumes it
    if (!atBottom && follow) setFollow(false)
    else if (atBottom && !follow) setFollow(true)
  }

  const jumpToBottom = () => {
    setFollow(true)
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const toggleLevel = (lv: string) => {
    setLevels((prev) => {
      const next = new Set(prev)
      next.has(lv) ? next.delete(lv) : next.add(lv)
      return next
    })
  }

  const handleExport = () => {
    const params = new URLSearchParams()
    if (levels.size === 1) params.set('level', Array.from(levels)[0])
    if (source) params.set('source', source)
    params.set('token', localStorage.getItem('auth-token') || '')
    window.open(`/api/logs/export?${params.toString()}`, '_blank')
  }

  const handleClear = async () => {
    const ok = await confirm({
      title: 'Clear old logs?',
      message: 'Entries older than 30 days are deleted from the log database. This does not affect system journal files.',
      confirmLabel: 'Clear',
      variant: 'danger',
    })
    if (!ok) return
    setClearing(true)
    try {
      const { data } = await api.post('/logs/clear', { daysOld: 30 })
      toast.success(`Removed ${data?.deletedCount ?? 0} old entries`)
      fetchLogs()
      fetchStats()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to clear logs')
    } finally {
      setClearing(false)
    }
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const sources = stats?.bySource ? Object.keys(stats.bySource).filter((s) => stats.bySource[s] > 0).sort() : []

  // Windowing math
  const total = visible.length
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIdx = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN)
  const rows = visible.slice(startIdx, endIdx)

  return (
    <div className="flex-1 bg-trakend-dark h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-trakend-surface border-b border-trakend-border px-4 py-3 flex-shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-trakend-text-primary flex items-center gap-2">
              <ScrollText size={18} className="text-trakend-accent" /> System Logs
            </h1>
            {stats && (
              <div className="text-xs text-trakend-text-secondary">
                {stats.total.toLocaleString()} entries · showing {visible.length.toLocaleString()}
                {total >= PAGE_SIZE && ` (latest ${PAGE_SIZE})`}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={live ? 'primary' : 'secondary'}
              icon={live ? <Pause size={13} /> : <Play size={13} />}
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
              title={live ? 'Pause auto-refresh' : 'Resume auto-refresh (every 5s)'}
            >
              {live ? 'Live' : 'Paused'}
            </Button>
            <Button
              size="sm"
              variant={follow ? 'primary' : 'secondary'}
              icon={<ChevronsDown size={13} />}
              onClick={() => (follow ? setFollow(false) : jumpToBottom())}
              aria-pressed={follow}
              title="Follow tail — keep the newest entries in view"
            >
              Follow
            </Button>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={loading && logs.length > 0} onClick={() => { fetchLogs(); fetchStats() }}>
              Refresh
            </Button>
            <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={handleExport}>
              Export CSV
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} loading={clearing} onClick={handleClear} title="Delete entries older than 30 days">
              Clear old
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Filter by level">
            {LEVELS.map((lv) => {
              const active = levels.has(lv.value)
              const count = stats?.byLevel?.[lv.value] || 0
              return (
                <button
                  key={lv.value}
                  onClick={() => toggleLevel(lv.value)}
                  aria-pressed={active}
                  className={clsx('rounded-full focus-ring transition-opacity', !active && levels.size > 0 && 'opacity-50')}
                  title={`${active ? 'Hide' : 'Show only'} ${lv.label}`}
                >
                  <Badge tone={lv.tone} dot={active} className={clsx(active && 'ring-1 ring-current')}>
                    {lv.label}
                    {count > 0 && <span className="opacity-70 tabular-nums">{count}</span>}
                  </Badge>
                </button>
              )
            })}
            {levels.size > 0 && (
              <button onClick={() => setLevels(new Set())} className="text-xs text-trakend-text-secondary hover:text-trakend-text-primary ml-1 focus-ring rounded">
                clear
              </button>
            )}
          </div>

          <select value={source} onChange={(e) => setSource(e.target.value)} className="!py-1 text-xs" aria-label="Filter by source">
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s} ({stats?.bySource[s]})
              </option>
            ))}
          </select>

          <div className="relative flex-1 min-w-[12rem] max-w-md">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-trakend-text-secondary pointer-events-none" />
            <input
              type="search"
              placeholder="Search messages…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full !pl-8 !py-1 text-xs"
              aria-label="Search logs"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-trakend-text-secondary hover:text-trakend-text-primary focus-ring rounded">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-[11rem_6rem_8rem_1fr] gap-2 px-4 py-1.5 text-[11px] uppercase tracking-wide text-trakend-text-secondary border-b border-trakend-border bg-trakend-dark flex-shrink-0 font-medium">
        <span>Time</span>
        <span>Level</span>
        <span>Source</span>
        <span>Message</span>
      </div>

      {/* Windowed list */}
      <div ref={scrollerRef} onScroll={onScroll} className="flex-1 overflow-y-auto font-mono text-xs relative" role="log" aria-live="off">
        {loading && logs.length === 0 ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 14 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6">
            <EmptyState error title="Could not load logs" description={error} action={<Button variant="secondary" onClick={fetchLogs}>Retry</Button>} />
          </div>
        ) : total === 0 ? (
          <div className="p-6 h-full flex items-center justify-center">
            <EmptyState
              icon={<ScrollText size={36} />}
              title={search || levels.size || source ? 'No matching log entries' : 'No logs yet'}
              description={search || levels.size || source ? 'Try widening the filters.' : 'System events will appear here as they occur.'}
              action={(search || levels.size || source) ? <Button size="sm" variant="secondary" onClick={() => { setSearch(''); setLevels(new Set()); setSource('') }}>Reset filters</Button> : undefined}
            />
          </div>
        ) : (
          <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
            {rows.map((log, i) => {
              const index = startIdx + i
              const tone = levelTone(log.level)
              return (
                <div
                  key={log.id ?? index}
                  className={clsx(
                    'absolute left-0 right-0 grid grid-cols-[11rem_6rem_8rem_1fr] gap-2 items-center px-4 border-b border-trakend-border/30 hover:bg-trakend-surface/60',
                    tone === 'error' && 'bg-trakend-error/5'
                  )}
                  style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                  title={log.metadata ? String(log.metadata) : undefined}
                >
                  <span className="text-trakend-text-secondary whitespace-nowrap tabular-nums">{formatTime(log.timestamp)}</span>
                  <span>
                    <Badge tone={tone} size="xs">
                      {log.level}
                    </Badge>
                  </span>
                  <span className="truncate text-trakend-text-secondary">{log.source}</span>
                  <span className="truncate text-trakend-text-primary" title={log.message}>
                    {highlight(log.message, debouncedSearch)}
                    {log.pattern_detected && (
                      <Badge tone="warning" size="xs" className="ml-2 align-middle">
                        {log.pattern_detected}
                      </Badge>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {!follow && total > 0 && (
          <div className="sticky bottom-3 flex justify-center pointer-events-none">
            <Button size="xs" variant="primary" icon={<ChevronsDown size={12} />} onClick={jumpToBottom} className="pointer-events-auto shadow-xl">
              Jump to newest
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default LogsPage
