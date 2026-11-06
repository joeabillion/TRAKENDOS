import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal as XTerminal, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, CaseSensitive, Clipboard, Copy, Eraser, Loader2, MousePointerSquareDashed, Regex, Search, WifiOff, X } from 'lucide-react'
import api from '../../utils/api'
import { wsUrl, wsBackoffDelay } from '../../context/WebSocketContext'
import { Button } from '../common/Button'
import { TERMINAL_FONT_STACK } from './terminalSettings'

// ─── Types ────────────────────────────────────────────────────────────────

export type PaneStatus =
  | 'starting' // creating session / first connect
  | 'connected'
  | 'reconnecting' // socket dropped, retrying with backoff
  | 'gone' // backend no longer has the session
  | 'exited' // shell exited (code known)
  | 'error' // could not create a session

export interface PaneInfo {
  status: PaneStatus
  cols: number
  rows: number
  sessionId: string | null
  shell: string
  createdAt: number | null
  exitCode?: number
  attempt?: number
  error?: string
}

export interface TerminalPaneHandle {
  focus: () => void
  fit: () => void
  clear: () => void
  paste: (text: string) => void
  /** Try the async clipboard API; resolves false when unavailable (HTTP / Safari). */
  pasteFromClipboard: () => Promise<boolean>
  copySelection: () => Promise<boolean>
  copyAll: () => Promise<boolean>
  downloadLog: () => void
  toggleSearch: () => void
  reconnectNow: () => void
  startNewSession: () => void
  selectAll: () => void
  getInfo: () => PaneInfo
}

export interface TerminalPaneProps {
  tabId: string
  /** Existing backend session to re-attach to (from localStorage); null = create new. */
  initialSessionId: string | null
  shell: string
  fontSize: number
  copyOnSelect: boolean
  active: boolean
  onInfo: (tabId: string, info: PaneInfo) => void
  onSessionId: (tabId: string, sessionId: string | null) => void
  onTitle: (tabId: string, title: string) => void
  onBell?: (tabId: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function buildTheme(): ITheme {
  return {
    background: cssVar('--color-bg-darker', '#171a1f'),
    foreground: cssVar('--color-text-primary', '#e2e4e9'),
    cursor: cssVar('--color-accent', '#2ab5b2'),
    cursorAccent: cssVar('--color-bg-darker', '#171a1f'),
    selectionBackground: 'rgba(42, 181, 178, 0.35)',
    selectionInactiveBackground: 'rgba(42, 181, 178, 0.2)',
    black: '#1e2128',
    red: '#ff5c7a',
    green: '#2fd3a6',
    yellow: '#ffb547',
    blue: '#5b9dff',
    magenta: '#c57bff',
    cyan: '#2ab5b2',
    white: '#d5d8e0',
    brightBlack: '#6b7084',
    brightRed: '#ff7f96',
    brightGreen: '#5ee6c0',
    brightYellow: '#ffc96e',
    brightBlue: '#82b4ff',
    brightMagenta: '#d7a2ff',
    brightCyan: '#4fd3d0',
    brightWhite: '#ffffff',
  }
}

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function dumpBuffer(term: XTerminal): string {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i)
    if (!line) continue
    lines.push(line.translateToString(true))
  }
  // trim trailing empty lines
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.join('\n')
}

// ─── Component ────────────────────────────────────────────────────────────

/**
 * One terminal tab: owns the xterm instance, its addons, the WebSocket to the
 * backend pty and all reconnect logic. The DOM node stays mounted while the
 * tab exists (hidden when inactive) so xterm never has to re-open.
 */
export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { tabId, initialSessionId, shell, fontSize, copyOnSelect, active, onInfo, onSessionId, onTitle, onBell },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef<string | null>(initialSessionId)
  const shellRef = useRef<string>(shell)
  const createdAtRef = useRef<number | null>(null)
  const attemptRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const unmountedRef = useRef(false)
  const needsReplayRef = useRef(true) // fresh xterm => ask the backend to repaint
  const intentionalCloseRef = useRef(false)
  const copyOnSelectRef = useRef(copyOnSelect)
  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null)

  const [status, setStatusState] = useState<PaneStatus>('starting')
  const [attempt, setAttempt] = useState(0)
  const [exitCode, setExitCodeState] = useState<number | undefined>(undefined)
  const [errorMsg, setErrorMsgState] = useState<string | undefined>(undefined)
  // Mirrors of the above for use inside long-lived closures (ws handlers)
  const statusRef = useRef<PaneStatus>('starting')
  const exitCodeRef = useRef<number | undefined>(undefined)
  const errorRef = useRef<string | undefined>(undefined)
  const setStatus = (s: PaneStatus) => {
    statusRef.current = s
    setStatusState(s)
  }
  const setExitCode = (c: number | undefined) => {
    exitCodeRef.current = c
    setExitCodeState(c)
  }
  const setErrorMsg = (m: string | undefined) => {
    errorRef.current = m
    setErrorMsgState(m)
  }
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchRegex, setSearchRegex] = useState(false)
  const [searchCase, setSearchCase] = useState(false)
  const [searchResult, setSearchResult] = useState<{ index: number; count: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [pasteFallback, setPasteFallback] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pasteTextRef = useRef<HTMLTextAreaElement>(null)

  copyOnSelectRef.current = copyOnSelect

  const publishInfo = useCallback(
    (overrides: Partial<PaneInfo> = {}) => {
      const term = termRef.current
      onInfo(tabId, {
        status: statusRef.current,
        cols: term?.cols ?? 0,
        rows: term?.rows ?? 0,
        sessionId: sessionIdRef.current,
        shell: shellRef.current,
        createdAt: createdAtRef.current,
        exitCode: exitCodeRef.current,
        attempt: attemptRef.current,
        error: errorRef.current,
        ...overrides,
      })
    },
    [onInfo, tabId]
  )

  // Push status changes up to the page (status chip / tab icon)
  useEffect(() => {
    publishInfo()
  }, [status, attempt, exitCode, errorMsg, publishInfo])

  // ── WebSocket plumbing ─────────────────────────────────────────────────

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload))
        return true
      } catch {
        return false
      }
    }
    return false
  }, [])

  const sendResize = useCallback(
    (force = false) => {
      const term = termRef.current
      if (!term) return
      const { cols, rows } = term
      if (!force && lastSentSizeRef.current && lastSentSizeRef.current.cols === cols && lastSentSizeRef.current.rows === rows) return
      if (send({ type: 'terminal:resize', cols, rows })) {
        lastSentSizeRef.current = { cols, rows }
        publishInfo({ cols, rows })
      }
    },
    [send, publishInfo]
  )

  const fit = useCallback(() => {
    const term = termRef.current
    const fitAddon = fitRef.current
    const host = hostRef.current
    if (!term || !fitAddon || !host) return
    if (host.offsetParent === null || host.clientWidth < 50 || host.clientHeight < 30) return // hidden
    try {
      const dims = fitAddon.proposeDimensions()
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
      if (dims.cols !== term.cols || dims.rows !== term.rows) {
        term.resize(Math.max(2, dims.cols), Math.max(1, dims.rows))
      }
    } catch {
      /* ignore while hidden */
    }
  }, [])

  const scheduleFit = useCallback(() => {
    if (resizeDebounceRef.current) clearTimeout(resizeDebounceRef.current)
    resizeDebounceRef.current = setTimeout(() => {
      resizeDebounceRef.current = null
      fit()
    }, 60)
  }, [fit])

  const closeSocket = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }
    const ws = wsRef.current
    wsRef.current = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const connect = useCallback(
    (sessionId: string) => {
      if (unmountedRef.current) return
      closeSocket()
      const term = termRef.current
      const ws = new WebSocket(wsUrl(`/ws/terminal/${sessionId}`))
      wsRef.current = ws

      ws.onopen = () => {
        if (wsRef.current !== ws) return
        attemptRef.current = 0
        setAttempt(0)
        setStatus('connected')
        lastSentSizeRef.current = null
        fit()
        sendResize(true)
        if (needsReplayRef.current) {
          send({ type: 'terminal:replay' })
          needsReplayRef.current = false
        }
        pingTimerRef.current = setInterval(() => send({ type: 'terminal:ping' }), 25000)
      }

      ws.onmessage = (ev) => {
        let msg: any
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        if (!term) return
        switch (msg.type) {
          case 'terminal:data':
            term.write(msg.data)
            break
          case 'terminal:replay':
            if (typeof msg.data === 'string' && msg.data) {
              term.write(msg.data)
            }
            break
          case 'terminal:attached':
            if (typeof msg.created_at === 'number') createdAtRef.current = msg.created_at
            if (typeof msg.shell === 'string') shellRef.current = msg.shell
            publishInfo({ status: 'connected', createdAt: createdAtRef.current, shell: shellRef.current })
            break
          case 'terminal:idle-warning':
            // Text warning is already written into the stream by the backend.
            break
          case 'terminal:exit':
            intentionalCloseRef.current = true
            setExitCode(typeof msg.exitCode === 'number' ? msg.exitCode : 0)
            setStatus('exited')
            term.write(`\r\n\x1b[2m[process exited with code ${msg.exitCode ?? 0}]\x1b[0m\r\n`)
            break
          case 'terminal:error':
            if (msg.message && /not found/i.test(String(msg.message))) {
              intentionalCloseRef.current = true
              sessionIdRef.current = null
              onSessionId(tabId, null)
              setStatus('gone')
            }
            break
          default:
            break
        }
      }

      ws.onclose = (ev) => {
        if (wsRef.current !== ws) return
        wsRef.current = null
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current)
          pingTimerRef.current = null
        }
        if (unmountedRef.current || intentionalCloseRef.current) return
        if (ev.code === 4404) {
          sessionIdRef.current = null
          onSessionId(tabId, null)
          setStatus('gone')
          return
        }
        if (ev.code === 4401 || ev.code === 4403) {
          setErrorMsg('Authentication rejected — sign in again.')
          setStatus('error')
          return
        }
        scheduleReconnect()
      }

      ws.onerror = () => {
        /* onclose follows */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closeSocket, fit, send, sendResize, publishInfo, onSessionId, tabId]
  )

  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current) return
    clearRetry()
    attemptRef.current += 1
    const n = attemptRef.current
    setAttempt(n)
    setStatus('reconnecting')
    const delay = wsBackoffDelay(n)
    retryTimerRef.current = setTimeout(async () => {
      retryTimerRef.current = null
      const sid = sessionIdRef.current
      if (!sid) {
        setStatus('gone')
        return
      }
      try {
        await api.get(`/terminal/sessions/${sid}`)
      } catch (err: any) {
        const code = err?.response?.status
        if (code === 404) {
          sessionIdRef.current = null
          onSessionId(tabId, null)
          setStatus('gone')
          return
        }
        // backend not reachable yet (restarting) — retry with backoff
        scheduleReconnect()
        return
      }
      if (termRef.current) termRef.current.write('\r\n\x1b[2m[reconnected]\x1b[0m\r\n')
      connect(sid)
    }, delay)
  }, [clearRetry, connect, onSessionId, tabId])

  const createSession = useCallback(async () => {
    if (unmountedRef.current) return
    const term = termRef.current
    setStatus('starting')
    setErrorMsg(undefined)
    setExitCode(undefined)
    intentionalCloseRef.current = false
    try {
      fit()
      const { data } = await api.post('/terminal/sessions', {
        name: 'Terminal',
        shell: shellRef.current,
        cols: term?.cols,
        rows: term?.rows,
      })
      if (unmountedRef.current) {
        api.delete(`/terminal/sessions/${data.id}`).catch(() => {})
        return
      }
      sessionIdRef.current = data.id
      createdAtRef.current = data.created_at ?? Date.now()
      if (typeof data.shell === 'string') shellRef.current = data.shell
      onSessionId(tabId, data.id)
      needsReplayRef.current = false // brand-new shell, nothing to replay
      connect(data.id)
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message || 'Unknown error'
      setErrorMsg(message)
      setStatus('error')
      term?.writeln(`\r\n\x1b[31mFailed to create session: ${message}\x1b[0m`)
    }
  }, [connect, fit, onSessionId, tabId])

  const attachOrCreate = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) {
      createSession()
      return
    }
    try {
      const { data } = await api.get(`/terminal/sessions/${sid}`)
      if (unmountedRef.current) return
      createdAtRef.current = data.created_at ?? null
      if (typeof data.shell === 'string') shellRef.current = data.shell
      needsReplayRef.current = true
      intentionalCloseRef.current = false
      connect(sid)
    } catch (err: any) {
      if (unmountedRef.current) return
      if (err?.response?.status === 404) {
        // Server restarted (or idle timeout) — respawn a fresh shell in this tab.
        termRef.current?.writeln('\x1b[2mPrevious session ended on the server — starting a new shell.\x1b[0m')
        sessionIdRef.current = null
        onSessionId(tabId, null)
        createSession()
      } else {
        // Backend unreachable: keep the session id and retry
        scheduleReconnect()
      }
    }
  }, [connect, createSession, onSessionId, scheduleReconnect, tabId])

  // ── xterm setup (once) ────────────────────────────────────────────────

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    unmountedRef.current = false

    const term = new XTerminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      fontFamily: TERMINAL_FONT_STACK,
      fontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: false,
      scrollOnUserInput: true,
      smoothScrollDuration: 0,
      fastScrollModifier: 'alt',
      theme: buildTheme(),
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
      windowOptions: { setWinLines: false },
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode11 = new Unicode11Addon()
    const webLinks = new WebLinksAddon((event, uri) => {
      // plain click opens, same as default, but never steal ctrl-clicks used for selection
      if (event.button === 0) window.open(uri, '_blank', 'noopener,noreferrer')
    })
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(unicode11)
    term.loadAddon(webLinks)
    term.unicode.activeVersion = '11'

    termRef.current = term
    fitRef.current = fitAddon
    searchRef.current = searchAddon

    term.open(host)

    // GPU renderer with graceful fallback to the DOM renderer.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        try {
          webgl.dispose()
        } catch {
          /* ignore */
        }
        webglRef.current = null
      })
      term.loadAddon(webgl)
      webglRef.current = webgl
    } catch {
      webglRef.current = null
    }

    // Search result counter
    const searchDisp = searchAddon.onDidChangeResults((r) => {
      setSearchResult(r.resultCount >= 0 ? { index: r.resultIndex, count: r.resultCount } : null)
    })

    // Input -> backend (single write per paste, bracketed-paste markers untouched)
    const dataDisp = term.onData((data) => {
      send({ type: 'terminal:input', data })
    })
    const binaryDisp = term.onBinary((data) => {
      send({ type: 'terminal:input', data })
    })

    // Local resize -> pty resize (debounced by the ResizeObserver path)
    const resizeDisp = term.onResize(() => {
      sendResize()
    })

    const titleDisp = term.onTitleChange((t) => {
      if (t && t.trim()) onTitle(tabId, t.trim())
    })

    const bellDisp = term.onBell(() => onBell?.(tabId))

    const selDisp = term.onSelectionChange(() => {
      if (!copyOnSelectRef.current) return
      const sel = term.getSelection()
      if (sel && sel.length > 0) void writeClipboard(sel)
    })

    // Keyboard: let the browser handle paste shortcuts natively (one paste, no
    // clipboard permission prompts); intercept copy-with-selection and zoom.
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
      const mod = isMac ? e.metaKey : e.ctrlKey
      const key = e.key

      // Paste: Ctrl+Shift+V (all), Ctrl+V (Linux/Windows), Cmd+V (Mac), Shift+Insert.
      // Returning false stops xterm from sending ^V; the browser fires a native
      // `paste` event on xterm's textarea which xterm turns into one onData call.
      if ((mod && (key === 'v' || key === 'V')) || (e.shiftKey && key === 'Insert')) {
        return false
      }
      // Copy: Ctrl+Shift+C / Cmd+C / Ctrl+Insert always copy; Ctrl+C copies when
      // there is a selection, otherwise sends SIGINT like a real terminal.
      if ((mod && e.shiftKey && (key === 'c' || key === 'C')) || (e.ctrlKey && key === 'Insert')) {
        if (e.type === 'keydown') {
          const sel = term.getSelection()
          if (sel) void writeClipboard(sel)
        }
        return false
      }
      if (mod && !e.shiftKey && (key === 'c' || key === 'C')) {
        const sel = term.getSelection()
        if (sel) {
          if (e.type === 'keydown') {
            void writeClipboard(sel)
            term.clearSelection()
          }
          return false
        }
        return true // no selection -> ^C to the shell
      }
      // Search
      if (e.ctrlKey && e.shiftKey && (key === 'f' || key === 'F')) {
        if (e.type === 'keydown') {
          e.preventDefault()
          setSearchOpen(true)
          setTimeout(() => searchInputRef.current?.focus(), 0)
        }
        return false
      }
      // Font zoom (Ctrl+= / Ctrl+- / Ctrl+0) is handled at page level via a
      // CustomEvent so the setting is shared by every tab.
      if (e.ctrlKey && !e.altKey && (key === '=' || key === '+' || key === '-' || key === '_' || key === '0')) {
        if (e.type === 'keydown') {
          e.preventDefault()
          const dir = key === '0' ? 0 : key === '-' || key === '_' ? -1 : 1
          window.dispatchEvent(new CustomEvent('trakend:terminal-zoom', { detail: dir }))
        }
        return false
      }
      // Tab management shortcuts bubble to the page handler
      if (e.ctrlKey && e.shiftKey && (key === 'T' || key === 't' || key === 'W' || key === 'w')) return false
      if (e.ctrlKey && (key === 'PageUp' || key === 'PageDown')) return false
      return true
    })

    // Right-click: our own menu (copy / paste / select all / clear)
    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
    host.addEventListener('contextmenu', onContext)

    // Fit when the container changes size (sidebar collapse, window resize, fullscreen)
    const ro = new ResizeObserver(() => scheduleFit())
    ro.observe(host)
    const onWinFocus = () => scheduleFit()
    window.addEventListener('focus', onWinFocus)
    // Refit after web fonts finish loading (cell metrics change)
    if ((document as any).fonts?.ready) {
      ;(document as any).fonts.ready.then(() => scheduleFit()).catch(() => {})
    }

    fit()
    term.writeln('\x1b[2mConnecting to Trakend OS…\x1b[0m')
    void attachOrCreate()

    return () => {
      unmountedRef.current = true
      clearRetry()
      closeSocket()
      ro.disconnect()
      window.removeEventListener('focus', onWinFocus)
      host.removeEventListener('contextmenu', onContext)
      if (resizeDebounceRef.current) clearTimeout(resizeDebounceRef.current)
      searchDisp.dispose()
      dataDisp.dispose()
      binaryDisp.dispose()
      resizeDisp.dispose()
      titleDisp.dispose()
      bellDisp.dispose()
      selDisp.dispose()
      try {
        webglRef.current?.dispose()
      } catch {
        /* ignore */
      }
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Font size changes
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (term.options.fontSize !== fontSize) {
      term.options.fontSize = fontSize
      scheduleFit()
    }
  }, [fontSize, scheduleFit])

  // Re-fit + focus when the tab becomes active
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      fit()
      sendResize()
      termRef.current?.focus()
    }, 20)
    return () => clearTimeout(t)
  }, [active, fit, sendResize])

  // Theme follows CSS variables (theme settings page changes them live)
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const obs = new MutationObserver(() => {
      term.options.theme = buildTheme()
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
    return () => obs.disconnect()
  }, [])

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  // ── Search helpers ────────────────────────────────────────────────────

  const searchOpts = useCallback(
    () => ({
      regex: searchRegex,
      caseSensitive: searchCase,
      incremental: true,
      decorations: {
        matchBackground: '#ffb54744',
        matchBorder: '#ffb547',
        matchOverviewRuler: '#ffb547',
        activeMatchBackground: '#2ab5b2aa',
        activeMatchBorder: '#2ab5b2',
        activeMatchColorOverviewRuler: '#2ab5b2',
      },
    }),
    [searchRegex, searchCase]
  )

  const findNext = useCallback(() => {
    if (!searchQuery) return
    searchRef.current?.findNext(searchQuery, searchOpts())
  }, [searchQuery, searchOpts])

  const findPrev = useCallback(() => {
    if (!searchQuery) return
    searchRef.current?.findPrevious(searchQuery, searchOpts())
  }, [searchQuery, searchOpts])

  useEffect(() => {
    if (!searchOpen) {
      searchRef.current?.clearDecorations()
      setSearchResult(null)
      return
    }
    if (searchQuery) searchRef.current?.findNext(searchQuery, { ...searchOpts(), incremental: true })
    else {
      searchRef.current?.clearDecorations()
      setSearchResult(null)
    }
  }, [searchQuery, searchOpen, searchOpts])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    termRef.current?.focus()
  }, [])

  // ── Clipboard / misc actions ───────────────────────────────────────────

  const pasteIntoTerminal = useCallback((text: string) => {
    const term = termRef.current
    if (!term || !text) return
    // term.paste() normalises line endings and adds bracketed-paste markers
    // when the shell has enabled them — exactly like a native paste.
    term.paste(text)
    term.focus()
  }, [])

  const pasteFromClipboard = useCallback(async (): Promise<boolean> => {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        if (text) pasteIntoTerminal(text)
        return true
      }
    } catch {
      /* permission denied or insecure context */
    }
    // HTTP / Safari: clipboard API unavailable — offer a paste box instead.
    setPasteFallback(true)
    setPasteText('')
    setTimeout(() => pasteTextRef.current?.focus(), 0)
    return false
  }, [pasteIntoTerminal])

  const copySelection = useCallback(async () => {
    const sel = termRef.current?.getSelection() || ''
    return writeClipboard(sel)
  }, [])

  const copyAll = useCallback(async () => {
    const term = termRef.current
    if (!term) return false
    return writeClipboard(dumpBuffer(term))
  }, [])

  const downloadLog = useCallback(() => {
    const term = termRef.current
    if (!term) return
    const text = dumpBuffer(term)
    const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    a.href = url
    a.download = `trakend-terminal-${stamp}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [])

  const clear = useCallback(() => {
    const term = termRef.current
    if (!term) return
    term.clear()
    // ask the shell to redraw its prompt line
    send({ type: 'terminal:input', data: '\x0c' })
    term.focus()
  }, [send])

  const reconnectNow = useCallback(() => {
    clearRetry()
    attemptRef.current = 0
    setAttempt(0)
    if (sessionIdRef.current) void attachOrCreate()
    else createSession()
  }, [attachOrCreate, clearRetry, createSession])

  const startNewSession = useCallback(() => {
    clearRetry()
    closeSocket()
    const term = termRef.current
    sessionIdRef.current = null
    onSessionId(tabId, null)
    term?.reset()
    needsReplayRef.current = false
    void createSession()
  }, [clearRetry, closeSocket, createSession, onSessionId, tabId])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => termRef.current?.focus(),
      fit: () => {
        fit()
        sendResize()
      },
      clear,
      paste: pasteIntoTerminal,
      pasteFromClipboard,
      copySelection,
      copyAll,
      downloadLog,
      toggleSearch: () => {
        setSearchOpen((o) => {
          const next = !o
          if (next) setTimeout(() => searchInputRef.current?.focus(), 0)
          else termRef.current?.focus()
          return next
        })
      },
      reconnectNow,
      startNewSession,
      selectAll: () => termRef.current?.selectAll(),
      getInfo: () => ({
        status: statusRef.current,
        cols: termRef.current?.cols ?? 0,
        rows: termRef.current?.rows ?? 0,
        sessionId: sessionIdRef.current,
        shell: shellRef.current,
        createdAt: createdAtRef.current,
        exitCode: exitCodeRef.current,
        attempt: attemptRef.current,
        error: errorRef.current,
      }),
    }),
    [fit, sendResize, clear, pasteIntoTerminal, pasteFromClipboard, copySelection, copyAll, downloadLog, reconnectNow, startNewSession, status, exitCode, attempt, errorMsg]
  )

  // ── Render ────────────────────────────────────────────────────────────

  const overlay =
    status === 'reconnecting' || status === 'gone' || status === 'exited' || status === 'error' || status === 'starting'

  return (
    <div className={clsx('terminal-pane absolute inset-0 flex flex-col', !active && 'invisible pointer-events-none')} aria-hidden={!active}>
      {/* Search bar */}
      {searchOpen && (
        <div className="absolute top-2 right-3 z-20 flex items-center gap-1 bg-trakend-surface border border-trakend-border rounded-lg shadow-xl px-2 py-1.5">
          <Search size={14} className="text-trakend-text-secondary" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.shiftKey ? findPrev() : findNext()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeSearch()
              }
            }}
            placeholder="Find in terminal…"
            className="w-48 !py-0.5 !px-2 text-xs bg-trakend-dark"
            spellCheck={false}
            aria-label="Search terminal"
          />
          <span className="text-[11px] text-trakend-text-secondary w-16 text-center tabular-nums">
            {searchQuery ? (searchResult && searchResult.count > 0 ? `${searchResult.index + 1}/${searchResult.count}` : 'No results') : ''}
          </span>
          <Button size="xs" variant={searchCase ? 'primary' : 'ghost'} iconOnly title="Match case" aria-pressed={searchCase} onClick={() => setSearchCase((v) => !v)} icon={<CaseSensitive size={13} />} />
          <Button size="xs" variant={searchRegex ? 'primary' : 'ghost'} iconOnly title="Regular expression" aria-pressed={searchRegex} onClick={() => setSearchRegex((v) => !v)} icon={<Regex size={13} />} />
          <Button size="xs" variant="ghost" iconOnly title="Previous match (Shift+Enter)" onClick={findPrev} icon={<ArrowUp size={13} />} />
          <Button size="xs" variant="ghost" iconOnly title="Next match (Enter)" onClick={findNext} icon={<ArrowDown size={13} />} />
          <Button size="xs" variant="ghost" iconOnly title="Close (Esc)" onClick={closeSearch} icon={<X size={13} />} />
        </div>
      )}

      {/* xterm host */}
      <div ref={hostRef} className="terminal-host flex-1 min-h-0" />

      {/* Status overlays */}
      {overlay && status !== 'starting' && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center pb-6 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-xl border shadow-2xl bg-trakend-surface/95 backdrop-blur border-trakend-border text-sm">
            {status === 'reconnecting' && (
              <>
                <Loader2 size={16} className="animate-spin text-trakend-warning" />
                <span className="text-trakend-text-primary">
                  Disconnected — reconnecting…{attempt > 1 && <span className="text-trakend-text-secondary"> (attempt {attempt})</span>}
                </span>
                <Button size="xs" variant="secondary" onClick={reconnectNow}>
                  Retry now
                </Button>
              </>
            )}
            {status === 'gone' && (
              <>
                <WifiOff size={16} className="text-trakend-error" />
                <span className="text-trakend-text-primary">This session no longer exists on the server.</span>
                <Button size="xs" variant="primary" onClick={startNewSession}>
                  Start new session
                </Button>
              </>
            )}
            {status === 'exited' && (
              <>
                <span className="text-trakend-text-primary">
                  Shell exited{typeof exitCode === 'number' ? ` (code ${exitCode})` : ''}.
                </span>
                <Button size="xs" variant="primary" onClick={startNewSession}>
                  Start new session
                </Button>
              </>
            )}
            {status === 'error' && (
              <>
                <WifiOff size={16} className="text-trakend-error" />
                <span className="text-trakend-text-primary">{errorMsg || 'Could not start a terminal session.'}</span>
                <Button size="xs" variant="primary" onClick={reconnectNow}>
                  Try again
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[180px] py-1 rounded-lg border border-trakend-border bg-trakend-surface shadow-2xl text-sm"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 220) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuItem icon={<Copy size={14} />} label="Copy" hint="Ctrl+Shift+C" disabled={!termRef.current?.hasSelection()} onClick={() => { void copySelection(); termRef.current?.clearSelection(); setContextMenu(null); termRef.current?.focus() }} />
          <MenuItem icon={<Clipboard size={14} />} label="Paste" hint="Ctrl+Shift+V" onClick={() => { setContextMenu(null); void pasteFromClipboard() }} />
          <MenuItem icon={<MousePointerSquareDashed size={14} />} label="Select all" onClick={() => { termRef.current?.selectAll(); setContextMenu(null) }} />
          <div className="my-1 border-t border-trakend-border" />
          <MenuItem icon={<Search size={14} />} label="Find…" hint="Ctrl+Shift+F" onClick={() => { setContextMenu(null); setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0) }} />
          <MenuItem icon={<Eraser size={14} />} label="Clear screen" onClick={() => { setContextMenu(null); clear() }} />
        </div>
      )}

      {/* Paste fallback (HTTP / no clipboard permission) */}
      {pasteFallback && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setPasteFallback(false) }}>
          <div className="w-full max-w-2xl bg-trakend-surface border border-trakend-border rounded-xl shadow-2xl p-4 flex flex-col gap-3" role="dialog" aria-label="Paste text">
            <div>
              <div className="text-sm font-semibold text-trakend-text-primary">Paste into terminal</div>
              <div className="text-xs text-trakend-text-secondary mt-0.5">
                Clipboard access is blocked by the browser here (insecure HTTP or no permission). Paste below with{' '}
                <kbd>Ctrl</kbd>+<kbd>V</kbd> and send. Multi-line text is sent as a single paste.
              </div>
            </div>
            <textarea
              ref={pasteTextRef}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setPasteFallback(false)
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  pasteText && pasteTextToTerminal()
                }
              }}
              rows={8}
              spellCheck={false}
              className="w-full font-mono text-xs resize-y"
              placeholder="Paste here…"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-trakend-text-secondary">{pasteText.split('\n').length} line(s), {pasteText.length} chars · Ctrl+Enter to send</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPasteFallback(false)}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={!pasteText} onClick={pasteTextToTerminal}>Send to terminal</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  function pasteTextToTerminal() {
    pasteText && termRef.current?.paste(pasteText)
    setPasteFallback(false)
    setPasteText('')
    termRef.current?.focus()
  }
})

const MenuItem: React.FC<{ icon: React.ReactNode; label: string; hint?: string; disabled?: boolean; onClick: () => void }> = ({ icon, label, hint, disabled, onClick }) => (
  <button
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-trakend-text-primary hover:bg-trakend-surface-light disabled:opacity-40 disabled:hover:bg-transparent focus-ring"
  >
    <span className="text-trakend-text-secondary">{icon}</span>
    <span className="flex-1">{label}</span>
    {hint && <span className="text-[10px] text-trakend-text-secondary">{hint}</span>}
  </button>
)

export default TerminalPane
