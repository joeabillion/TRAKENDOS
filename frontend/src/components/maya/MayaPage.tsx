import React, { useEffect, useState, useRef } from 'react'
import { Send, Zap, Search, Cpu, Trash2, AlertCircle, Plus, MessageSquare, X } from 'lucide-react'
import { useMaya, MayaStatus, MayaConversation } from '../../hooks/useMaya'
import { useWebSocket } from '../../context/WebSocketContext'
import { formatRelativeTime } from '../../utils/formatters'
import { GaugeChart } from '../common/GaugeChart'

export const MayaPage: React.FC = () => {
  const { getStatus, investigate, deepScan, optimize, findDuplicates, chat, listConversations, getConversation, deleteConversation } = useMaya()
  const { mayaNotifications } = useWebSocket()
  const [mayaStatus, setMayaStatus] = useState<MayaStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [chatMessage, setChatMessage] = useState('')
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'maya'; message: string }>>([])
  const [conversations, setConversations] = useState<MayaConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Load Maya status
  useEffect(() => {
    const loadStatus = async () => {
      const status = await getStatus()
      setMayaStatus(status)
    }
    loadStatus()
    const interval = setInterval(loadStatus, 10000)
    return () => clearInterval(interval)
  }, [getStatus])

  // Load conversations list
  useEffect(() => {
    loadConversations()
  }, [])

  const loadConversations = async () => {
    const convs = await listConversations()
    setConversations(convs)
  }

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  const handleLoadConversation = async (convId: string) => {
    setActiveConversationId(convId)
    const conv = await getConversation(convId)
    if (conv) {
      setChatHistory(conv.messages.map((m) => ({
        role: m.role === 'user' ? 'user' as const : 'maya' as const,
        message: m.content,
      })))
    }
  }

  const handleNewConversation = () => {
    setActiveConversationId(null)
    setChatHistory([])
  }

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteConversation(convId)
    if (activeConversationId === convId) {
      setActiveConversationId(null)
      setChatHistory([])
    }
    await loadConversations()
  }

  const handleAction = async (action: () => Promise<any>) => {
    setLoading(true)
    try {
      await action()
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async () => {
    if (!chatMessage.trim()) return

    const userMsg = chatMessage
    setChatMessage('')
    setChatHistory((prev) => [...prev, { role: 'user', message: userMsg }])
    setChatHistory((prev) => [...prev, { role: 'maya', message: '...' }])

    try {
      const result = await chat(userMsg, activeConversationId || undefined)
      // Set active conversation from response
      if (result.conversationId && !activeConversationId) {
        setActiveConversationId(result.conversationId)
      }
      setChatHistory((prev) => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        if (lastIdx >= 0 && updated[lastIdx].message === '...') {
          updated[lastIdx] = { role: 'maya', message: result.response }
        } else {
          updated.push({ role: 'maya', message: result.response })
        }
        return updated
      })
      // Refresh conversations list
      await loadConversations()
    } catch {
      setChatHistory((prev) => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        if (lastIdx >= 0 && updated[lastIdx].message === '...') {
          updated[lastIdx] = { role: 'maya', message: 'Sorry, something went wrong. Please try again.' }
        }
        return updated
      })
    }
  }

  return (
    <div className="flex-1 bg-trakend-dark flex flex-col overflow-hidden">
      <div className="flex h-full overflow-hidden">
        {/* Left Panel - Status, Actions, Conversations */}
        <div className="w-72 bg-trakend-surface border-r border-trakend-border flex flex-col overflow-hidden flex-shrink-0">
          {/* Header */}
          <div className="border-b border-trakend-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={20} className="text-trakend-accent" />
              <h1 className="text-lg font-bold text-trakend-text-primary">Maya AI</h1>
              {mayaStatus && (
                <div className="ml-auto flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${mayaStatus.online ? 'bg-trakend-success animate-pulse' : 'bg-trakend-error'}`} />
                  <span className={`text-xs ${mayaStatus.online ? 'text-trakend-success' : 'text-trakend-error'}`}>
                    {mayaStatus.online ? 'Online' : 'Offline'}
                  </span>
                </div>
              )}
            </div>

            {/* Compact health gauge */}
            {mayaStatus && (
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 flex-shrink-0">
                  <GaugeChart value={mayaStatus.healthScore} max={100} size={48} color="var(--color-accent, #2ab5b2)" />
                </div>
                <div className="flex-1 grid grid-cols-2 gap-1">
                  <button onClick={() => handleAction(investigate)} disabled={loading}
                    className="px-2 py-1 text-[10px] rounded bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary transition-colors disabled:opacity-50 truncate">
                    <AlertCircle size={10} className="inline mr-1" />Investigate
                  </button>
                  <button onClick={() => handleAction(deepScan)} disabled={loading}
                    className="px-2 py-1 text-[10px] rounded bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary transition-colors disabled:opacity-50 truncate">
                    <Search size={10} className="inline mr-1" />Scan
                  </button>
                  <button onClick={() => handleAction(optimize)} disabled={loading}
                    className="px-2 py-1 text-[10px] rounded bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary transition-colors disabled:opacity-50 truncate">
                    <Cpu size={10} className="inline mr-1" />Optimize
                  </button>
                  <button onClick={() => handleAction(findDuplicates)} disabled={loading}
                    className="px-2 py-1 text-[10px] rounded bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary transition-colors disabled:opacity-50 truncate">
                    <Trash2 size={10} className="inline mr-1" />Dupes
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Conversations List */}
          <div className="border-b border-trakend-border p-2">
            <button
              onClick={handleNewConversation}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-trakend-accent text-white text-sm hover:bg-opacity-90 transition-colors"
            >
              <Plus size={14} />
              New Conversation
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-2 space-y-1">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleLoadConversation(conv.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors group flex items-center gap-2 ${
                    activeConversationId === conv.id
                      ? 'bg-trakend-accent text-white'
                      : 'text-trakend-text-secondary hover:bg-trakend-surface-light hover:text-trakend-text-primary'
                  }`}
                >
                  <MessageSquare size={12} className="flex-shrink-0" />
                  <span className="flex-1 truncate">{conv.title}</span>
                  <button
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-trakend-error/20 rounded transition-opacity"
                  >
                    <X size={10} />
                  </button>
                </button>
              ))}
              {conversations.length === 0 && (
                <div className="text-center py-6 text-trakend-text-secondary text-xs">
                  No conversations yet
                </div>
              )}
            </div>
          </div>

          {/* Notifications */}
          {mayaNotifications.length > 0 && (
            <div className="border-t border-trakend-border p-2 max-h-32 overflow-y-auto">
              <div className="text-[10px] uppercase tracking-wide text-trakend-text-secondary font-semibold mb-1 px-1">Alerts</div>
              {mayaNotifications.slice(0, 3).map((notif) => (
                <div key={notif.id} className="p-1.5 rounded text-[10px] mb-1 bg-trakend-dark">
                  <span className="font-semibold text-trakend-text-primary">{notif.title}</span>
                  <span className="text-trakend-text-secondary ml-1">{formatRelativeTime(new Date(notif.timestamp))}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Panel - Chat */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Chat History */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {chatHistory.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Zap size={48} className="text-trakend-accent mx-auto mb-4 opacity-50" />
                  <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">Start a Conversation</h2>
                  <p className="text-trakend-text-secondary">Ask Maya for help managing your system</p>
                </div>
              </div>
            ) : (
              chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-3xl px-4 py-3 rounded-lg whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-trakend-accent text-white'
                        : 'bg-trakend-surface text-trakend-text-primary border border-trakend-border'
                    }`}
                  >
                    {msg.message === '...' ? (
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-trakend-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-trakend-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-trakend-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    ) : (
                      <p className="text-sm">{msg.message}</p>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div className="border-t border-trakend-border bg-trakend-surface p-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                placeholder="Ask Maya something..."
                className="flex-1 bg-trakend-dark border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary placeholder-trakend-text-secondary focus:outline-none focus:border-trakend-accent"
              />
              <button
                onClick={handleSendMessage}
                disabled={!chatMessage.trim()}
                className="px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-trakend-accent-dark transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
