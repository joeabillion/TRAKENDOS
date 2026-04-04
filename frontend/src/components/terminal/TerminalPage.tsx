import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import { Terminal as XTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import api from '../../utils/api'

interface TerminalTab {
  id: string
  sessionId: string | null
  title: string
}

export const TerminalPage: React.FC = () => {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalsRef = useRef<Map<string, XTerminal>>(new Map())
  const fitsRef = useRef<Map<string, FitAddon>>(new Map())
  const wsRef = useRef<Map<string, WebSocket>>(new Map())

  const getWsUrl = (sessionId: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/terminal/${sessionId}`
  }

  // Create a backend PTY session and connect via WebSocket
  const createSession = useCallback(async (tabId: string, container: HTMLElement) => {
    const term = new XTerminal({
      cols: 120,
      rows: 30,
      theme: {
        background: getComputedStyle(document.documentElement).getPropertyValue('--color-dark').trim() || '#1a1d2e',
        foreground: '#e5e5e5',
        cursor: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#2dd4bf',
        selection: 'rgba(45, 212, 191, 0.2)',
      },
      fontFamily: '"JetBrains Mono", "Monaco", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(container)

    try { fitAddon.fit() } catch {}

    terminalsRef.current.set(tabId, term)
    fitsRef.current.set(tabId, fitAddon)

    term.writeln('\x1b[36mConnecting to Trakend OS...\x1b[0m')

    try {
      // Create a backend PTY session
      const { data } = await api.post('/terminal/sessions', { name: `Terminal` })
      const sessionId = data.id

      // Update tab with session ID
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, sessionId } : t))

      // Connect WebSocket to the PTY session
      const ws = new WebSocket(getWsUrl(sessionId))
      wsRef.current.set(tabId, ws)

      ws.onopen = () => {
        // Send initial resize
        ws.send(JSON.stringify({ type: 'terminal:resize', cols: term.cols, rows: term.rows }))
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'terminal:data') {
            term.write(msg.data)
          }
        } catch {}
      }

      ws.onerror = () => {
        term.writeln('\r\n\x1b[31mConnection error\x1b[0m')
      }

      ws.onclose = () => {
        term.writeln('\r\n\x1b[33mSession ended\x1b[0m')
      }

      // Forward terminal input to backend PTY
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal:input', data }))
        }
      })

      // Forward resize events
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal:resize', cols, rows }))
        }
      })

    } catch (err: any) {
      term.writeln(`\r\n\x1b[31mFailed to create session: ${err?.response?.data?.error || err?.message || 'Unknown error'}\x1b[0m`)
      term.writeln('\x1b[33mNote: Terminal requires node-pty on the server.\x1b[0m')
    }

    return () => {
      const ws = wsRef.current.get(tabId)
      if (ws) { ws.close(); wsRef.current.delete(tabId) }
      term.dispose()
      terminalsRef.current.delete(tabId)
      fitsRef.current.delete(tabId)
    }
  }, [])

  // Add new tab
  const addTab = useCallback(() => {
    const newId = Date.now().toString()
    const tabNum = tabs.length + 1
    const newTab: TerminalTab = { id: newId, sessionId: null, title: `Terminal ${tabNum}` }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newId)
  }, [tabs.length])

  // Close tab
  const closeTab = useCallback((id: string) => {
    // Close WebSocket and destroy backend session
    const ws = wsRef.current.get(id)
    if (ws) { ws.close(); wsRef.current.delete(id) }
    const tab = tabs.find(t => t.id === id)
    if (tab?.sessionId) {
      api.delete(`/terminal/sessions/${tab.sessionId}`).catch(() => {})
    }

    const newTabs = tabs.filter(t => t.id !== id)
    setTabs(newTabs)
    if (activeTabId === id) {
      setActiveTabId(newTabs.length > 0 ? newTabs[0].id : null)
    }
  }, [tabs, activeTabId])

  // Auto-create first tab
  useEffect(() => {
    if (tabs.length === 0) addTab()
  }, [])

  // Initialize terminal when active tab changes
  useEffect(() => {
    if (!activeTabId || !containerRef.current) return
    // Don't reinitialize if terminal already exists
    if (terminalsRef.current.has(activeTabId)) {
      // Re-attach existing terminal
      containerRef.current.innerHTML = ''
      const term = terminalsRef.current.get(activeTabId)!
      term.open(containerRef.current)
      const fit = fitsRef.current.get(activeTabId)
      if (fit) try { fit.fit() } catch {}
      return
    }
    containerRef.current.innerHTML = ''
    const cleanup = createSession(activeTabId, containerRef.current)
    return () => { cleanup.then(fn => fn?.()) }
  }, [activeTabId, createSession])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (activeTabId) {
        const fit = fitsRef.current.get(activeTabId)
        if (fit) try { fit.fit() } catch {}
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [activeTabId])

  return (
    <div className="flex-1 bg-trakend-surface flex flex-col overflow-hidden h-full">
      {/* Tab Bar */}
      <div className="bg-trakend-dark border-b border-trakend-border flex items-center overflow-x-auto flex-shrink-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 border-r border-trakend-border cursor-pointer transition-colors ${
              activeTabId === tab.id
                ? 'bg-trakend-accent text-white'
                : 'bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary'
            }`}
          >
            <span className="text-sm font-medium">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="p-1 rounded hover:bg-black/20 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        ))}

        {/* Add Tab Button */}
        <button
          onClick={addTab}
          className="flex items-center gap-2 px-4 py-3 text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface transition-colors ml-auto flex-shrink-0"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Terminal Container */}
      <div ref={containerRef} className="flex-1 overflow-hidden bg-trakend-dark" />
    </div>
  )
}
