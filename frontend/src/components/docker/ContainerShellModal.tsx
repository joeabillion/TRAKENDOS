import React, { useEffect, useRef, useCallback } from 'react'
import { X, Terminal as TerminalIcon } from 'lucide-react'
import { Terminal as XTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useDocker } from '../../hooks/useDocker'

interface ContainerShellModalProps {
  containerId: string
  containerName: string
  onClose: () => void
}

export const ContainerShellModal: React.FC<ContainerShellModalProps> = ({
  containerId,
  containerName,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const { execContainer } = useDocker()

  const getWsUrl = (execId: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/docker-exec/${execId}`
  }

  const initTerminal = useCallback(async () => {
    if (!containerRef.current) return

    const term = new XTerminal({
      cols: 120,
      rows: 30,
      theme: {
        background: getComputedStyle(document.documentElement).getPropertyValue('--color-dark').trim() || '#1a1d2e',
        foreground: '#e5e5e5',
        cursor: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#2dd4bf',
      },
      fontFamily: '"JetBrains Mono", "Monaco", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    try { fitAddon.fit() } catch {}

    termRef.current = term
    fitRef.current = fitAddon

    // Paste handler
    const pasteToTerminal = (text: string) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminal:input', data: text }))
      }
    }

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (e.type === 'keydown') {
          navigator.clipboard?.readText().then(pasteToTerminal).catch(() => {})
        }
        return false
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (e.type === 'keydown') {
          const sel = term.getSelection()
          if (sel) {
            navigator.clipboard?.writeText(sel).catch(() => {})
            return false
          }
        }
      }
      return true
    })

    containerRef.current.addEventListener('paste', (e: Event) => {
      const clipboardEvent = e as ClipboardEvent
      const text = clipboardEvent.clipboardData?.getData('text')
      if (text) {
        e.preventDefault()
        pasteToTerminal(text)
      }
    })

    term.writeln('\x1b[36mConnecting to container...\x1b[0m')

    try {
      // Create exec session
      const execId = await execContainer(containerId)
      if (!execId) {
        term.writeln('\x1b[31mFailed to create exec session. Container may not be running.\x1b[0m')
        return
      }

      // Connect WebSocket
      const ws = new WebSocket(getWsUrl(execId))
      wsRef.current = ws

      ws.onopen = () => {
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

      // Forward input
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal:input', data }))
        }
      })

      // Forward resize
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal:resize', cols, rows }))
        }
      })
    } catch (err: any) {
      term.writeln(`\r\n\x1b[31mFailed: ${err?.message || 'Unknown error'}\x1b[0m`)
    }
  }, [containerId, execContainer])

  useEffect(() => {
    initTerminal()

    const handleResize = () => {
      if (fitRef.current) try { fitRef.current.fit() } catch {}
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
      if (termRef.current) { termRef.current.dispose(); termRef.current = null }
    }
  }, [initTerminal])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-trakend-dark border-b border-trakend-border">
        <div className="flex items-center gap-2 text-trakend-text-primary">
          <TerminalIcon size={18} className="text-trakend-accent" />
          <span className="font-medium">Shell — {containerName}</span>
          <span className="text-xs text-trakend-text-secondary">({containerId.substring(0, 12)})</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-trakend-surface text-trakend-text-secondary hover:text-trakend-text-primary transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Terminal */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  )
}
