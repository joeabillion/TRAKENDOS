import React, { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Terminal as XTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalTab {
  id: string
  title: string
  active: boolean
}

export const TerminalPage: React.FC = () => {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: '0', title: 'Terminal 1', active: true },
  ])
  const [activeTabId, setActiveTabId] = useState('0')
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalsRef = useRef<Map<string, XTerminal>>(new Map())
  const fitsRef = useRef<Map<string, FitAddon>>(new Map())

  // Initialize xterm for a tab
  const initializeTerminal = (tabId: string, container: HTMLElement) => {
    const term = new XTerminal({
      cols: 120,
      rows: 30,
      theme: {
        background: '#2a2a2a',
        foreground: '#e5e5e5',
        cursor: '#ff6b35',
        selection: 'rgba(255, 107, 53, 0.2)',
      },
      fontFamily: '"Monaco", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.5,
      letterSpacing: 0,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(container)

    try {
      fitAddon.fit()
    } catch (e) {
      console.error('Fit error:', e)
    }

    // Write some initial content
    term.writeln('Welcome to Trakend OS Terminal')
    term.writeln('Type your commands below:')
    term.writeln('')
    term.write('$ ')

    // Handle input
    term.onData((data) => {
      if (data === '\r') {
        term.writeln('')
        term.write('$ ')
      } else if (data === '\x7f') {
        term.write('\b \b')
      } else {
        term.write(data)
      }
    })

    // Store terminal and fit addon
    terminalsRef.current.set(tabId, term)
    fitsRef.current.set(tabId, fitAddon)

    // Handle window resize
    const handleResize = () => {
      try {
        fitAddon.fit()
      } catch (e) {
        console.error('Resize fit error:', e)
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      term.dispose()
      terminalsRef.current.delete(tabId)
      fitsRef.current.delete(tabId)
    }
  }

  // Add new tab
  const addTab = () => {
    const newId = Date.now().toString()
    const newTab: TerminalTab = {
      id: newId,
      title: `Terminal ${tabs.length + 1}`,
      active: false,
    }
    setTabs([...tabs, newTab])
    setActiveTabId(newId)
  }

  // Close tab
  const closeTab = (id: string) => {
    const newTabs = tabs.filter((t) => t.id !== id)
    if (newTabs.length === 0) {
      addTab()
    } else if (activeTabId === id) {
      setActiveTabId(newTabs[0].id)
    }
    setTabs(newTabs)
  }

  // Handle active tab change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = ''
      const cleanup = initializeTerminal(activeTabId, containerRef.current)
      return cleanup
    }
  }, [activeTabId])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const fitAddon = fitsRef.current.get(activeTabId)
      if (fitAddon) {
        try {
          fitAddon.fit()
        } catch (e) {
          console.error('Fit error:', e)
        }
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [activeTabId])

  return (
    <div className="flex-1 bg-trakend-surface flex flex-col overflow-hidden">
      {/* Tab Bar */}
      <div className="bg-trakend-dark border-b border-trakend-border flex items-center overflow-x-auto">
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
      <div ref={containerRef} className="flex-1 overflow-hidden bg-trakend-surface" />
    </div>
  )
}
