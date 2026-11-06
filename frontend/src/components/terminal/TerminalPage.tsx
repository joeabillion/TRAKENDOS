import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ChevronDown, ClipboardPaste, Copy, Download, Eraser, Maximize2, Minimize2, Plus, Search, TerminalSquare, X,
  Minus, RotateCcw, MousePointerSquareDashed, Keyboard,
} from 'lucide-react'
import api from '../../utils/api'
import { Button } from '../common/Button'
import { Badge } from '../common/Badge'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { TerminalPane, TerminalPaneHandle, PaneInfo } from './TerminalPane'
import {
  PersistedTab, loadTabs, saveTabs, newTabId, loadFontSize, saveFontSize, clampFontSize, FONT_SIZE_DEFAULT,
  loadCopyOnSelect, saveCopyOnSelect, loadDefaultShell, saveDefaultShell, IDLE_SHELL_PROCESSES,
} from './terminalSettings'

interface ShellOption {
  value: string
  label: string
  cmd: string
}

function formatAge(createdAt: number | null, now: number): string {
  if (!createdAt) return '—'
  const s = Math.max(0, Math.floor((now - createdAt) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export const TerminalPage: React.FC = () => {
  const toast = useToast()
  const confirm = useConfirm()

  const initial = useMemo(() => loadTabs(), [])
  const [tabs, setTabs] = useState<PersistedTab[]>(initial.tabs)
  const [activeTabId, setActiveTabId] = useState<string | null>(initial.activeId)
  const [fontSize, setFontSize] = useState<number>(loadFontSize)
  const [copyOnSelect, setCopyOnSelect] = useState<boolean>(loadCopyOnSelect)
  const [shells, setShells] = useState<ShellOption[]>([{ value: 'auto', label: 'Default (Bash)', cmd: 'auto' }])
  const [defaultShell, setDefaultShell] = useState<string>(loadDefaultShell)
  const [shellMenuOpen, setShellMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [infos, setInfos] = useState<Record<string, PaneInfo>>({})
  const [bells, setBells] = useState<Record<string, boolean>>({})
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [closing, setClosing] = useState<string | null>(null)

  const paneRefs = useRef<Map<string, TerminalPaneHandle | null>>(new Map())
  const rootRef = useRef<HTMLDivElement>(null)
  const shellMenuRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef(tabs)
  const activeRef = useRef(activeTabId)
  tabsRef.current = tabs
  activeRef.current = activeTabId

  const activePane = () => (activeTabId ? paneRefs.current.get(activeTabId) ?? null : null)

  // ── Persistence ──────────────────────────────────────────────────────
  useEffect(() => {
    saveTabs(tabs, activeTabId)
  }, [tabs, activeTabId])

  useEffect(() => {
    saveFontSize(fontSize)
  }, [fontSize])

  useEffect(() => {
    saveCopyOnSelect(copyOnSelect)
  }, [copyOnSelect])

  useEffect(() => {
    saveDefaultShell(defaultShell)
  }, [defaultShell])

  // Session-age ticker
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  // Available shells
  useEffect(() => {
    api
      .get('/terminal/shells')
      .then(({ data }) => {
        if (Array.isArray(data) && data.length) setShells(data)
      })
      .catch(() => {})
  }, [])

  // ── Tab operations ────────────────────────────────────────────────────

  const addTab = useCallback(
    (shell?: string) => {
      const id = newTabId()
      const current = tabsRef.current
      const n = current.length + 1
      const sh = shell || defaultShell
      const label = shells.find((s) => s.value === sh)?.label
      const title = sh === 'auto' || !label ? `Terminal ${n}` : `${label} ${n}`
      setTabs((prev) => [...prev, { id, sessionId: null, title, shell: sh }])
      setActiveTabId(id)
      setShellMenuOpen(false)
    },
    [defaultShell, shells]
  )

  // First visit: open one tab
  useEffect(() => {
    if (tabsRef.current.length === 0) addTab()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reallyCloseTab = useCallback((id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id)
    if (tab?.sessionId) {
      api.delete(`/terminal/sessions/${tab.sessionId}`).catch(() => {})
    }
    paneRefs.current.delete(id)
    setInfos((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      if (activeRef.current === id) {
        const neighbour = next[Math.min(idx, next.length - 1)] || null
        setActiveTabId(neighbour ? neighbour.id : null)
      }
      return next
    })
  }, [])

  const closeTab = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id)
      if (!tab) return
      setClosing(id)
      try {
        let running: string | null = null
        if (tab.sessionId && infos[id]?.status === 'connected') {
          try {
            const { data } = await api.get(`/terminal/sessions/${tab.sessionId}`)
            const proc = String(data?.process || '').toLowerCase()
            if (proc && !IDLE_SHELL_PROCESSES.has(proc)) running = proc
          } catch {
            /* session gone or backend down — nothing to protect */
          }
        }
        if (running) {
          const ok = await confirm({
            title: `Close "${tab.title}"?`,
            message: (
              <>
                <code className="px-1 rounded bg-trakend-dark text-trakend-text-primary">{running}</code> is still running in this
                terminal. Closing the tab will terminate it.
              </>
            ),
            confirmLabel: 'Close tab',
            variant: 'danger',
          })
          if (!ok) return
        }
        reallyCloseTab(id)
      } finally {
        setClosing(null)
      }
    },
    [confirm, infos, reallyCloseTab]
  )

  const switchTab = useCallback((dir: 1 | -1) => {
    const list = tabsRef.current
    if (list.length < 2) return
    const idx = list.findIndex((t) => t.id === activeRef.current)
    const next = list[(idx + dir + list.length) % list.length]
    setActiveTabId(next.id)
  }, [])

  const startRename = (tab: PersistedTab) => {
    setRenamingId(tab.id)
    setRenameValue(tab.title)
  }

  const commitRename = () => {
    if (!renamingId) return
    const title = renameValue.trim()
    if (title) {
      setTabs((prev) => prev.map((t) => (t.id === renamingId ? { ...t, title, customTitle: true } : t)))
      const tab = tabsRef.current.find((t) => t.id === renamingId)
      if (tab?.sessionId) api.patch(`/terminal/sessions/${tab.sessionId}`, { name: title }).catch(() => {})
    }
    setRenamingId(null)
    setTimeout(() => activePane()?.focus(), 0)
  }

  // ── Pane callbacks (stable) ───────────────────────────────────────────

  const handleInfo = useCallback((tabId: string, info: PaneInfo) => {
    setInfos((prev) => {
      const old = prev[tabId]
      if (
        old &&
        old.status === info.status &&
        old.cols === info.cols &&
        old.rows === info.rows &&
        old.sessionId === info.sessionId &&
        old.shell === info.shell &&
        old.createdAt === info.createdAt &&
        old.exitCode === info.exitCode &&
        old.attempt === info.attempt &&
        old.error === info.error
      )
        return prev
      return { ...prev, [tabId]: info }
    })
  }, [])

  const handleSessionId = useCallback((tabId: string, sessionId: string | null) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId && t.sessionId !== sessionId ? { ...t, sessionId } : t)))
  }, [])

  const handleTitle = useCallback((tabId: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId || t.customTitle) return t
        // Shell sends "Trakend: ~/path" via OSC 0 — keep it short
        const clean = title.replace(/^Trakend:\s*/, '').slice(0, 40)
        return clean && clean !== t.title ? { ...t, title: clean } : t
      })
    )
  }, [])

  const handleBell = useCallback((tabId: string) => {
    if (activeRef.current !== tabId) setBells((prev) => ({ ...prev, [tabId]: true }))
  }, [])

  useEffect(() => {
    if (activeTabId && bells[activeTabId]) setBells((prev) => ({ ...prev, [activeTabId]: false }))
  }, [activeTabId, bells])

  // ── Font size ─────────────────────────────────────────────────────────

  const zoom = useCallback((dir: number) => {
    setFontSize((prev) => (dir === 0 ? FONT_SIZE_DEFAULT : clampFontSize(prev + dir)))
  }, [])

  useEffect(() => {
    const onZoom = (e: Event) => zoom((e as CustomEvent<number>).detail)
    window.addEventListener('trakend:terminal-zoom', onZoom)
    return () => window.removeEventListener('trakend:terminal-zoom', onZoom)
  }, [zoom])

  // ── Global keyboard shortcuts (capture phase so xterm never sees them) ──

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rootRef.current) return
      const inPage = rootRef.current.contains(document.activeElement) || document.activeElement === document.body
      if (!inPage) return
      const k = e.key
      if (e.ctrlKey && e.shiftKey && (k === 'T' || k === 't')) {
        e.preventDefault()
        e.stopPropagation()
        addTab()
      } else if (e.ctrlKey && e.shiftKey && (k === 'W' || k === 'w')) {
        e.preventDefault()
        e.stopPropagation()
        if (activeRef.current) void closeTab(activeRef.current)
      } else if (e.ctrlKey && !e.shiftKey && k === 'PageUp') {
        e.preventDefault()
        e.stopPropagation()
        switchTab(-1)
      } else if (e.ctrlKey && !e.shiftKey && k === 'PageDown') {
        e.preventDefault()
        e.stopPropagation()
        switchTab(1)
      } else if (e.ctrlKey && e.shiftKey && (k === 'F' || k === 'f')) {
        e.preventDefault()
        e.stopPropagation()
        activePane()?.toggleSearch()
      } else if (e.ctrlKey && !e.altKey && !e.shiftKey && (k === '=' || k === '+' || k === '-' || k === '0') && !(document.activeElement instanceof HTMLInputElement)) {
        e.preventDefault()
        e.stopPropagation()
        zoom(k === '0' ? 0 : k === '-' ? -1 : 1)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTab, closeTab, switchTab, zoom])

  // ── Fullscreen ────────────────────────────────────────────────────────

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await el.requestFullscreen()
    } catch {
      toast.warning('Fullscreen is not available in this browser')
    }
  }, [toast])

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(!!document.fullscreenElement)
      setTimeout(() => activePane()?.fit(), 50)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close popovers on outside click
  useEffect(() => {
    if (!shellMenuOpen && !settingsOpen) return
    const h = (e: MouseEvent) => {
      if (shellMenuRef.current && !shellMenuRef.current.contains(e.target as Node)) setShellMenuOpen(false)
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [shellMenuOpen, settingsOpen])

  // ── Toolbar actions ───────────────────────────────────────────────────

  const doPaste = async () => {
    const pane = activePane()
    if (!pane) return
    await pane.pasteFromClipboard()
  }

  const doCopyAll = async () => {
    const ok = await activePane()?.copyAll()
    ok ? toast.success('Scrollback copied to clipboard') : toast.error('Clipboard unavailable — use Download log instead')
  }

  const activeInfo = activeTabId ? infos[activeTabId] : undefined
  const statusTone =
    activeInfo?.status === 'connected' ? 'success' : activeInfo?.status === 'reconnecting' || activeInfo?.status === 'starting' ? 'warning' : 'error'
  const statusLabel =
    activeInfo?.status === 'connected'
      ? 'Connected'
      : activeInfo?.status === 'reconnecting'
      ? 'Reconnecting…'
      : activeInfo?.status === 'starting'
      ? 'Starting…'
      : activeInfo?.status === 'gone'
      ? 'Session lost'
      : activeInfo?.status === 'exited'
      ? 'Exited'
      : activeInfo?.status === 'error'
      ? 'Error'
      : '—'

  const currentShellLabel = shells.find((s) => s.value === defaultShell)?.label || 'Default'

  return (
    <div ref={rootRef} className="flex-1 h-full flex flex-col overflow-hidden bg-trakend-darker">
      {/* Tab bar */}
      <div className="flex items-stretch bg-trakend-dark border-b border-trakend-border flex-shrink-0 h-10" role="tablist" aria-label="Terminal tabs">
        <div className="flex items-stretch overflow-x-auto min-w-0 flex-1">
          {tabs.map((tab) => {
            const info = infos[tab.id]
            const isActive = tab.id === activeTabId
            const dot =
              info?.status === 'connected' ? 'bg-trakend-success' : info?.status === 'reconnecting' || info?.status === 'starting' ? 'bg-trakend-warning animate-pulse' : 'bg-trakend-error'
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTabId(tab.id)}
                onDoubleClick={() => startRename(tab)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    void closeTab(tab.id)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setActiveTabId(tab.id)
                  if (e.key === 'F2') startRename(tab)
                }}
                title={`${tab.title}${info?.shell ? ` · ${info.shell}` : ''} — double-click to rename, middle-click to close`}
                className={clsx(
                  'group relative flex items-center gap-2 pl-3 pr-1.5 min-w-[140px] max-w-[240px] border-r border-trakend-border cursor-pointer select-none focus-ring',
                  isActive ? 'bg-trakend-darker text-trakend-text-primary' : 'text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface'
                )}
              >
                {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-trakend-accent" />}
                <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', dot)} aria-hidden />
                {renamingId === tab.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                      e.stopPropagation()
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 !px-1.5 !py-0 h-6 text-xs bg-trakend-surface"
                    aria-label="Tab name"
                  />
                ) : (
                  <span className={clsx('flex-1 min-w-0 truncate text-xs font-medium', bells[tab.id] && 'text-trakend-warning')}>{tab.title}</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void closeTab(tab.id)
                  }}
                  disabled={closing === tab.id}
                  aria-label={`Close ${tab.title}`}
                  className={clsx(
                    'p-1 rounded text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light focus-ring',
                    !isActive && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  )}
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}

          {/* New tab (default shell) + shell picker */}
          <div className="flex items-stretch" ref={shellMenuRef}>
            <button
              onClick={() => addTab()}
              title={`New terminal (${currentShellLabel}) — Ctrl+Shift+T`}
              aria-label="New terminal"
              className="px-2.5 text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface focus-ring"
            >
              <Plus size={16} />
            </button>
            <div className="relative flex items-stretch">
              <button
                onClick={() => setShellMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={shellMenuOpen}
                title="Choose shell"
                className="px-1.5 text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface border-r border-trakend-border focus-ring"
              >
                <ChevronDown size={14} />
              </button>
              {shellMenuOpen && (
                <div role="menu" className="absolute left-0 top-full mt-1 z-50 w-64 py-1 rounded-lg border border-trakend-border bg-trakend-surface shadow-2xl">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-trakend-text-secondary">New terminal with…</div>
                  {shells.map((s) => (
                    <button
                      key={s.value}
                      role="menuitem"
                      onClick={() => addTab(s.value)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left text-trakend-text-primary hover:bg-trakend-surface-light focus-ring"
                    >
                      <span className="flex items-center gap-2">
                        <TerminalSquare size={14} className="text-trakend-text-secondary" />
                        {s.label}
                      </span>
                      <span className="text-[10px] text-trakend-text-secondary font-mono truncate max-w-[110px]">{s.cmd !== 'auto' ? s.cmd : ''}</span>
                    </button>
                  ))}
                  <div className="my-1 border-t border-trakend-border" />
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-trakend-text-secondary">Default for new tabs</div>
                  <div className="px-3 pb-2">
                    <select value={defaultShell} onChange={(e) => setDefaultShell(e.target.value)} className="w-full text-xs !py-1">
                      {shells.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right side: status chip */}
        <div className="hidden md:flex items-center gap-2 px-3 border-l border-trakend-border flex-shrink-0">
          <Badge tone={statusTone} dot pulse={activeInfo?.status === 'connected'} size="xs">
            {statusLabel}
          </Badge>
          {activeInfo && activeInfo.cols > 0 && (
            <span className="text-[11px] font-mono text-trakend-text-secondary tabular-nums" title="Columns × rows">
              {activeInfo.cols}×{activeInfo.rows}
            </span>
          )}
          {activeInfo?.createdAt && (
            <span className="text-[11px] text-trakend-text-secondary tabular-nums" title="Session age">
              {formatAge(activeInfo.createdAt, now)}
            </span>
          )}
          {activeInfo?.shell && <span className="text-[11px] text-trakend-text-secondary font-mono">{activeInfo.shell}</span>}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 h-9 bg-trakend-dark/70 border-b border-trakend-border flex-shrink-0 overflow-x-auto">
        <Button size="xs" variant="ghost" icon={<ClipboardPaste size={13} />} onClick={doPaste} title="Paste (Ctrl+Shift+V / right-click)">
          Paste
        </Button>
        <Button size="xs" variant="ghost" icon={<Copy size={13} />} onClick={doCopyAll} title="Copy entire scrollback">
          Copy all
        </Button>
        <Button size="xs" variant="ghost" icon={<Eraser size={13} />} onClick={() => activePane()?.clear()} title="Clear screen (Ctrl+L)">
          Clear
        </Button>
        <Button size="xs" variant="ghost" icon={<Search size={13} />} onClick={() => activePane()?.toggleSearch()} title="Find (Ctrl+Shift+F)">
          Search
        </Button>
        <Button size="xs" variant="ghost" icon={<Download size={13} />} onClick={() => activePane()?.downloadLog()} title="Download scrollback as .txt">
          Download log
        </Button>

        <div className="w-px h-5 bg-trakend-border mx-1" />

        <div className="flex items-center gap-0.5" title="Font size (Ctrl+= / Ctrl+- / Ctrl+0)">
          <Button size="xs" variant="ghost" iconOnly aria-label="Decrease font size" onClick={() => zoom(-1)} icon={<Minus size={13} />} />
          <button
            onClick={() => zoom(0)}
            className="text-[11px] font-mono text-trakend-text-secondary w-9 text-center tabular-nums hover:text-trakend-text-primary focus-ring rounded"
            title="Reset font size"
          >
            {fontSize}px
          </button>
          <Button size="xs" variant="ghost" iconOnly aria-label="Increase font size" onClick={() => zoom(1)} icon={<Plus size={13} />} />
        </div>

        <div className="w-px h-5 bg-trakend-border mx-1" />

        <div className="relative" ref={settingsRef}>
          <Button size="xs" variant="ghost" icon={<Keyboard size={13} />} onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} title="Options & shortcuts">
            Options
          </Button>
          {settingsOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 w-80 p-3 rounded-lg border border-trakend-border bg-trakend-surface shadow-2xl text-xs space-y-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-trakend-text-primary flex items-center gap-2">
                  <MousePointerSquareDashed size={14} className="text-trakend-text-secondary" /> Copy on select
                </span>
                <input type="checkbox" checked={copyOnSelect} onChange={(e) => setCopyOnSelect(e.target.checked)} />
              </label>
              <div className="border-t border-trakend-border pt-2">
                <div className="text-[10px] uppercase tracking-wider text-trakend-text-secondary mb-1.5">Keyboard shortcuts</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-trakend-text-secondary">
                  <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd></dt><dd>Paste (also Ctrl+V, right-click, Shift+Ins)</dd>
                  <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd></dt><dd>Copy selection (Ctrl+C copies when selected)</dd>
                  <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd></dt><dd>Find in scrollback</dd>
                  <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd></dt><dd>New tab</dd>
                  <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd></dt><dd>Close tab</dd>
                  <dt><kbd>Ctrl</kbd>+<kbd>PgUp</kbd>/<kbd>PgDn</kbd></dt><dd>Previous / next tab</dd>
                  <dt><kbd>Ctrl</kbd>+<kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd></dt><dd>Font bigger / smaller / reset</dd>
                  <dt><kbd>Alt</kbd>+scroll</dt><dd>Fast scroll</dd>
                </dl>
                <p className="mt-2 text-[10px] text-trakend-text-secondary">
                  Some browsers reserve Ctrl+Shift+T/W for their own tabs; use the + button and middle-click when that happens.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {activeInfo && (activeInfo.status === 'gone' || activeInfo.status === 'exited' || activeInfo.status === 'error') && (
          <Button size="xs" variant="primary" icon={<RotateCcw size={13} />} onClick={() => activePane()?.startNewSession()}>
            New session
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          onClick={toggleFullscreen}
          icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        />
      </div>

      {/* Panes — all mounted, only the active one visible */}
      <div className="relative flex-1 min-h-0">
        {tabs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-trakend-text-secondary gap-3">
            <TerminalSquare size={40} className="opacity-30" />
            <div className="text-sm">No terminals open</div>
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => addTab()}>
              New terminal
            </Button>
          </div>
        )}
        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            ref={(h) => {
              paneRefs.current.set(tab.id, h)
            }}
            tabId={tab.id}
            initialSessionId={tab.sessionId}
            shell={tab.shell}
            fontSize={fontSize}
            copyOnSelect={copyOnSelect}
            active={tab.id === activeTabId}
            onInfo={handleInfo}
            onSessionId={handleSessionId}
            onTitle={handleTitle}
            onBell={handleBell}
          />
        ))}
      </div>
    </div>
  )
}

export default TerminalPage
