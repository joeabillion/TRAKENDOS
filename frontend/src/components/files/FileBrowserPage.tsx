import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  FolderOpen, File, HardDrive, ChevronRight,
  ArrowUp, RefreshCw, Search, Trash2, Copy, Scissors,
  Edit3, Eye, FolderPlus, FilePlus, MoreVertical,
  Grid, List, Filter, X, Lock,
  Database, Shield, Zap, Server, Upload, Download
} from 'lucide-react'
import api from '../../utils/api'
import clsx from 'clsx'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { Button } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Skeleton } from '../common/Skeleton'

interface UploadJob {
  id: number
  name: string
  progress: number // 0..100
  status: 'uploading' | 'done' | 'error'
  error?: string
}

// ── Types ──

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modified: string
  created: string
  permissions: string
  owner: string
  group: string
  extension: string
  hidden: boolean
  readable: boolean
  writable: boolean
  protected?: boolean
}

interface DirectoryListing {
  path: string
  parent: string | null
  entries: FileEntry[]
  totalFiles: number
  totalDirs: number
  totalSize: number
}

interface PhysicalDrive {
  id: string
  device: string
  model: string
  serial: string
  size_bytes: number
  size_human: string
  transport: string
  rpm: number
  temperature: number
  health: 'healthy' | 'warning' | 'failing' | 'failed' | 'unknown'
  smart_passed: boolean
  role: 'data' | 'parity' | 'parity2' | 'cache' | 'hot_spare' | 'unassigned'
  slot?: number
  filesystem?: string
  mount_point?: string
  usage_bytes?: number
  spin_state: string
  power_on_hours: number
  reallocated_sectors: number
}

// ── Helpers ──

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getFileIcon(entry: FileEntry): React.ReactNode {
  if (entry.type === 'directory') return <FolderOpen size={18} className="text-trakend-accent" />
  const ext = entry.extension
  if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp'].includes(ext))
    return <File size={18} className="text-purple-400" />
  if (['.mp4', '.mkv', '.avi', '.mov', '.wmv'].includes(ext))
    return <File size={18} className="text-pink-400" />
  if (['.mp3', '.flac', '.wav', '.ogg', '.aac'].includes(ext))
    return <File size={18} className="text-green-400" />
  if (['.zip', '.tar', '.gz', '.7z', '.rar', '.bz2'].includes(ext))
    return <File size={18} className="text-yellow-400" />
  if (['.js', '.ts', '.py', '.sh', '.json', '.yaml', '.yml', '.xml', '.html', '.css'].includes(ext))
    return <File size={18} className="text-blue-400" />
  if (['.log', '.txt', '.md', '.conf', '.cfg', '.ini'].includes(ext))
    return <File size={18} className="text-trakend-text-secondary" />
  return <File size={18} className="text-trakend-text-secondary" />
}

// ── Main Component ──

export const FileBrowserPage: React.FC = () => {
  const toast = useToast()
  const confirm = useConfirm()
  const [currentPath, setCurrentPath] = useState('/')
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [allDrives, setAllDrives] = useState<PhysicalDrive[]>([])
  const [arrayState, setArrayState] = useState<string>('stopped')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [showHidden, setShowHidden] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [clipboard, setClipboard] = useState<{ paths: string[]; action: 'copy' | 'cut' } | null>(null)
  const [showPreview, setShowPreview] = useState<{ path: string; content: string; size: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showNewDialog, setShowNewDialog] = useState<'file' | 'folder' | null>(null)
  const [newName, setNewName] = useState('')
  // Keyboard cursor (index into listing.entries) and shift-range anchor
  const [cursor, setCursor] = useState<number>(-1)
  const anchorRef = useRef<number>(-1)
  const [editingPath, setEditingPath] = useState(false)
  const [pathDraft, setPathDraft] = useState('')
  const pathInputRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<UploadJob[]>([])
  const [uploadHover, setUploadHover] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // ── Data loading ──

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true)
    setError('')
    setSearchResults(null)
    setSelectedItems(new Set())
    try {
      const res = await api.get('/files/list', { params: { path: dirPath, hidden: showHidden } })
      setListing(res.data)
      setCurrentPath(res.data.path)
      setCursor(-1)
      anchorRef.current = -1
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load directory')
    } finally {
      setLoading(false)
    }
  }, [showHidden])

  const loadDrives = useCallback(async () => {
    try {
      const [drivesRes, statusRes] = await Promise.all([
        api.get('/array/drives'),
        api.get('/array/summary').catch(() => null)
      ])
      setAllDrives(drivesRes.data || [])
      if (statusRes?.data?.config?.state) setArrayState(statusRes.data.config.state)
    } catch { /* ignore */ }
  }, [])

  // Get display label for a drive (persistent numbered names based on slot)
  const getDriveLabel = (drive: PhysicalDrive): string => {
    // Use slot from DB for persistent naming
    if (drive.role === 'parity') return 'Parity'
    if (drive.role === 'parity2') return 'Parity 2'
    if (drive.role === 'cache') return 'Cache'
    if (drive.role === 'data' && drive.slot && drive.slot > 0) return `Disk ${drive.slot}`
    // Fallback for unmounted/unassigned
    if (drive.mount_point === '/data') return 'Data'
    if (drive.mount_point) {
      const name = drive.mount_point.split('/').pop() || drive.device
      return name.charAt(0).toUpperCase() + name.slice(1)
    }
    return drive.model || drive.device
  }

  useEffect(() => {
    loadDrives()
  }, [])

  useEffect(() => {
    loadDirectory(currentPath)
  }, [showHidden])

  // ── Navigation ──

  const navigate = (path: string) => {
    loadDirectory(path)
  }

  const goUp = () => {
    if (listing?.parent) navigate(listing.parent)
  }

  const breadcrumbs = currentPath.split('/').filter(Boolean)

  // ── Search ──

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return }
    try {
      const res = await api.get('/files/search', { params: { path: currentPath, query: searchQuery } })
      setSearchResults(res.data)
    } catch { /* ignore */ }
  }

  // ── File operations ──

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    type === 'success' ? toast.success(msg) : toast.error(msg)
  }

  const handleDelete = async (paths: string[]) => {
    // Check if any selected items are protected
    const protectedItems = listing?.entries.filter(e => paths.includes(e.path) && e.protected) || []
    if (protectedItems.length > 0) {
      notify(`Cannot delete protected system files: ${protectedItems.map(e => e.name).join(', ')}`, 'error')
      return
    }
    const ok = await confirm({
      title: `Delete ${paths.length} item${paths.length === 1 ? '' : 's'}?`,
      message: (
        <>
          <span>This cannot be undone.</span>
          <ul className="mt-2 max-h-32 overflow-auto text-xs font-mono space-y-0.5">
            {paths.slice(0, 8).map(p => <li key={p} className="truncate">{p}</li>)}
            {paths.length > 8 && <li>…and {paths.length - 8} more</li>}
          </ul>
        </>
      ),
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    for (const p of paths) {
      try {
        await api.post('/files/delete', { path: p })
      } catch (err: any) {
        notify(`Failed to delete: ${err?.response?.data?.error}`, 'error')
        return
      }
    }
    notify(`Deleted ${paths.length} item(s)`)
    loadDirectory(currentPath)
  }

  const handleCopy = () => {
    if (selectedItems.size === 0) return
    setClipboard({ paths: Array.from(selectedItems), action: 'copy' })
    notify(`${selectedItems.size} item(s) copied`)
  }

  const handleCut = () => {
    if (selectedItems.size === 0) return
    setClipboard({ paths: Array.from(selectedItems), action: 'cut' })
    notify(`${selectedItems.size} item(s) cut`)
  }

  const handlePaste = async () => {
    if (!clipboard) return
    for (const src of clipboard.paths) {
      const name = src.split('/').pop()
      const dest = `${currentPath}/${name}`
      try {
        if (clipboard.action === 'copy') {
          await api.post('/files/copy', { src, dest })
        } else {
          await api.post('/files/rename', { oldPath: src, newPath: dest })
        }
      } catch (err: any) {
        notify(`Failed: ${err?.response?.data?.error}`, 'error')
        return
      }
    }
    notify(`Pasted ${clipboard.paths.length} item(s)`)
    setClipboard(null)
    loadDirectory(currentPath)
  }

  const handleRename = async (oldPath: string, newName: string) => {
    const dir = oldPath.substring(0, oldPath.lastIndexOf('/'))
    const newPath = `${dir}/${newName}`
    try {
      await api.post('/files/rename', { oldPath, newPath })
      notify('Renamed')
      loadDirectory(currentPath)
    } catch (err: any) {
      notify(`Failed: ${err?.response?.data?.error}`, 'error')
    }
    setRenameTarget(null)
  }

  const handleCreate = async (type: 'file' | 'folder', name: string) => {
    const fullPath = `${currentPath}/${name}`
    try {
      if (type === 'folder') {
        await api.post('/files/mkdir', { path: fullPath })
      } else {
        await api.post('/files/create', { path: fullPath })
      }
      notify(`Created ${type}: ${name}`)
      loadDirectory(currentPath)
    } catch (err: any) {
      notify(`Failed: ${err?.response?.data?.error}`, 'error')
    }
    setShowNewDialog(null)
    setNewName('')
  }

  const handlePreview = async (path: string) => {
    try {
      const res = await api.get('/files/read', { params: { path } })
      setShowPreview(res.data)
    } catch (err: any) {
      notify(`Cannot preview: ${err?.response?.data?.error}`, 'error')
    }
  }

  const toggleSelect = (path: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /**
   * Explorer-style selection: plain click selects one, Ctrl/Cmd toggles,
   * Shift selects the range from the anchor.
   */
  const selectWithModifiers = (index: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const entries = listing?.entries || []
    const entry = entries[index]
    if (!entry || entry.protected) return
    setCursor(index)
    if (e.shiftKey && anchorRef.current >= 0) {
      const [a, b] = [Math.min(anchorRef.current, index), Math.max(anchorRef.current, index)]
      const range = entries.slice(a, b + 1).filter(en => !en.protected).map(en => en.path)
      setSelectedItems(prev => (e.ctrlKey || e.metaKey ? new Set([...prev, ...range]) : new Set(range)))
      return
    }
    anchorRef.current = index
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(entry.path)
    } else {
      setSelectedItems(new Set([entry.path]))
    }
  }

  const openEntry = (entry: FileEntry) => {
    if (entry.protected) return
    if (entry.type === 'directory') navigate(entry.path)
    else handlePreview(entry.path)
  }

  // Close context menu on outside click / Escape / scroll
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  // Scroll the keyboard cursor into view
  useEffect(() => {
    if (cursor < 0 || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // ── Editable breadcrumb ──
  const startEditPath = () => {
    setPathDraft(currentPath)
    setEditingPath(true)
    setTimeout(() => { pathInputRef.current?.focus(); pathInputRef.current?.select() }, 0)
  }
  const commitPath = () => {
    const p = pathDraft.trim()
    setEditingPath(false)
    if (p && p !== currentPath) navigate(p.startsWith('/') ? p : `/${p}`)
  }

  // ── Uploads (drag-drop onto the file list or the Upload button) ──
  const uploadFiles = (files: FileList | File[], targetDir: string = currentPath) => {
    const list = Array.from(files)
    if (list.length === 0) return
    list.forEach(file => {
      const id = Date.now() + Math.random()
      setUploads(prev => [...prev, { id, name: file.name, progress: 0, status: 'uploading' }])
      const form = new FormData()
      form.append('path', targetDir)
      form.append('file', file, file.name)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/files/upload?path=${encodeURIComponent(targetDir)}`)
      const token = localStorage.getItem('auth-token')
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return
        const pct = Math.round((ev.loaded / ev.total) * 100)
        setUploads(prev => prev.map(u => u.id === id ? { ...u, progress: pct } : u))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploads(prev => prev.map(u => u.id === id ? { ...u, progress: 100, status: 'done' } : u))
          if (targetDir === currentPath) loadDirectory(currentPath)
          setTimeout(() => setUploads(prev => prev.filter(u => u.id !== id)), 4000)
        } else {
          let msg = `Upload failed (${xhr.status})`
          try { msg = JSON.parse(xhr.responseText)?.error || msg } catch { /* ignore */ }
          if (xhr.status === 404 || xhr.status === 405) msg = 'This server build has no file upload endpoint (POST /api/files/upload).'
          setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: msg } : u))
          toast.error(`${file.name}: ${msg}`)
        }
      }
      xhr.onerror = () => {
        setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: 'Network error' } : u))
        toast.error(`${file.name}: network error during upload`)
      }
      xhr.send(form)
    })
  }

  const downloadEntry = (entry: FileEntry) => {
    const token = localStorage.getItem('auth-token') || ''
    // The download route checks the Authorization header; fall back to a tokenised GET
    window.open(`/api/files/download?path=${encodeURIComponent(entry.path)}&token=${encodeURIComponent(token)}`, '_blank')
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c') { e.preventDefault(); handleCopy() }
        if (e.key === 'x') { e.preventDefault(); handleCut() }
        if (e.key === 'v') { e.preventDefault(); handlePaste() }
        if (e.key === 'a') {
          e.preventDefault()
          if (listing) setSelectedItems(new Set(listing.entries.map(e => e.path)))
        }
      }
      if (e.key === 'Delete' && selectedItems.size > 0) {
        e.preventDefault()
        handleDelete(Array.from(selectedItems))
      }
      if (e.key === 'F2' && selectedItems.size === 1) {
        e.preventDefault()
        const path = Array.from(selectedItems)[0]
        const entry = listing?.entries.find(e => e.path === path)
        if (entry) { setRenameTarget(path); setRenameValue(entry.name) }
      }
      if (e.key === 'Escape') {
        setSelectedItems(new Set())
        setContextMenu(null)
        setShowPreview(null)
        setEditingPath(false)
      }
      if (e.key === 'Backspace' && listing?.parent && !showPreview) {
        e.preventDefault()
        goUp()
      }
      // Arrow / Enter navigation over the visible listing
      const entries = listing?.entries || []
      if (entries.length > 0 && !showPreview && !showNewDialog && !renameTarget) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const cols = viewMode === 'grid' ? Math.max(1, Math.floor((listRef.current?.clientWidth || 800) / 132)) : 1
          const step = e.key === 'ArrowDown' ? cols : -cols
          const next = cursor < 0 ? 0 : Math.max(0, Math.min(entries.length - 1, cursor + step))
          selectWithModifiers(next, { shiftKey: e.shiftKey, ctrlKey: false, metaKey: false })
        } else if (viewMode === 'grid' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault()
          const next = cursor < 0 ? 0 : Math.max(0, Math.min(entries.length - 1, cursor + (e.key === 'ArrowRight' ? 1 : -1)))
          selectWithModifiers(next, { shiftKey: e.shiftKey, ctrlKey: false, metaKey: false })
        } else if (e.key === 'Home') {
          e.preventDefault(); selectWithModifiers(0, { shiftKey: e.shiftKey, ctrlKey: false, metaKey: false })
        } else if (e.key === 'End') {
          e.preventDefault(); selectWithModifiers(entries.length - 1, { shiftKey: e.shiftKey, ctrlKey: false, metaKey: false })
        } else if (e.key === 'Enter') {
          const target = cursor >= 0 ? entries[cursor] : (selectedItems.size === 1 ? entries.find(en => selectedItems.has(en.path)) : undefined)
          if (target) { e.preventDefault(); openEntry(target) }
        } else if (e.key === ' ' && cursor >= 0) {
          e.preventDefault(); toggleSelect(entries[cursor].path)
        }
      }
      if (e.key === 'l' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); startEditPath() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedItems, clipboard, listing, cursor, viewMode, showPreview, showNewDialog, renameTarget])

  // Drag & drop state
  const [draggedPaths, setDraggedPaths] = useState<string[]>([])
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const handleDragStart = (e: React.DragEvent, entry: FileEntry) => {
    const paths = selectedItems.has(entry.path) ? Array.from(selectedItems) : [entry.path]
    setDraggedPaths(paths)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', paths.join('\n'))
  }

  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types || []).includes('Files')

  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = isFileDrag(e) ? 'copy' : 'move'
    setDropTarget(targetPath)
  }

  const handleDragLeave = () => {
    setDropTarget(null)
  }

  const handleDrop = async (e: React.DragEvent, targetDir: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    setUploadHover(false)
    // Files dragged in from the OS -> upload
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files, targetDir)
      return
    }
    if (draggedPaths.length === 0) return

    for (const src of draggedPaths) {
      const name = src.split('/').pop()
      const dest = `${targetDir}/${name}`
      if (src === dest || src === targetDir) continue
      try {
        await api.post('/files/rename', { oldPath: src, newPath: dest })
      } catch (err: any) {
        notify(`Failed to move: ${err?.response?.data?.error}`, 'error')
        break
      }
    }
    notify(`Moved ${draggedPaths.length} item(s)`)
    setDraggedPaths([])
    loadDirectory(currentPath)
  }

  // ── Render ──

  return (
    <div className="flex-1 bg-trakend-dark h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="bg-trakend-surface border-b border-trakend-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        {/* Navigation */}
        <Button size="sm" variant="ghost" iconOnly aria-label="Up one level (Backspace)" title="Up one level (Backspace)" onClick={goUp} disabled={!listing?.parent} icon={<ArrowUp size={18} />} />
        <Button size="sm" variant="ghost" iconOnly aria-label="Refresh" title="Refresh" onClick={() => loadDirectory(currentPath)} loading={loading} icon={<RefreshCw size={18} />} />

        {/* Breadcrumb (click the empty area or Ctrl+L to type a path) */}
        <div
          className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto text-sm h-8 px-2 rounded-md border border-transparent hover:border-trakend-border cursor-text"
          onClick={(e) => { if (e.target === e.currentTarget) startEditPath() }}
          title="Click to edit path (Ctrl+L)"
        >
          {editingPath ? (
            <input
              ref={pathInputRef}
              value={pathDraft}
              onChange={e => setPathDraft(e.target.value)}
              onBlur={commitPath}
              onKeyDown={e => {
                if (e.key === 'Enter') commitPath()
                if (e.key === 'Escape') setEditingPath(false)
                e.stopPropagation()
              }}
              className="w-full !py-0.5 !px-2 font-mono text-sm bg-trakend-dark"
              spellCheck={false}
              aria-label="Path"
            />
          ) : (
            <>
              <button onClick={() => navigate('/')} className="text-trakend-text-secondary font-medium hover:text-trakend-accent focus-ring rounded px-0.5">/</button>
              {breadcrumbs.map((seg, i) => {
                const fullPath = '/' + breadcrumbs.slice(0, i + 1).join('/')
                return (
                  <React.Fragment key={i}>
                    <ChevronRight size={14} className="text-trakend-text-secondary flex-shrink-0" />
                    <button
                      onClick={() => navigate(fullPath)}
                      className={clsx(
                        'whitespace-nowrap hover:text-trakend-accent focus-ring rounded px-0.5',
                        i === breadcrumbs.length - 1 ? 'text-trakend-text-primary font-medium' : 'text-trakend-text-secondary'
                      )}
                    >{seg}</button>
                  </React.Fragment>
                )
              })}
              <span className="flex-1 min-w-[2rem] h-full" onClick={startEditPath} />
            </>
          )}
        </div>

        {/* Search */}
        <div className="flex items-center gap-1 bg-trakend-dark rounded-lg px-3 py-1.5">
          <Search size={16} className="text-trakend-text-secondary" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search files..."
            className="bg-transparent text-sm text-trakend-text-primary outline-none w-40"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchResults(null) }}>
              <X size={14} className="text-trakend-text-secondary" />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 border-l border-trakend-border pl-3">
          <button onClick={() => setShowNewDialog('folder')} className="p-2 rounded hover:bg-trakend-surface-light text-trakend-text-secondary" title="New Folder">
            <FolderPlus size={18} />
          </button>
          <button onClick={() => setShowNewDialog('file')} className="p-2 rounded hover:bg-trakend-surface-light text-trakend-text-secondary focus-ring" title="New File" aria-label="New file">
            <FilePlus size={18} />
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded hover:bg-trakend-surface-light text-trakend-text-secondary focus-ring" title="Upload files (or drag them into the list)" aria-label="Upload files">
            <Upload size={18} />
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }} />
          {selectedItems.size > 0 && (
            <>
              <button onClick={handleCopy} className="p-2 rounded hover:bg-trakend-surface-light text-trakend-text-secondary" title="Copy">
                <Copy size={18} />
              </button>
              <button onClick={handleCut} className="p-2 rounded hover:bg-trakend-surface-light text-trakend-text-secondary" title="Cut">
                <Scissors size={18} />
              </button>
              <button onClick={() => handleDelete(Array.from(selectedItems))}
                className="p-2 rounded hover:bg-red-900/30 text-trakend-error" title="Delete">
                <Trash2 size={18} />
              </button>
            </>
          )}
          {clipboard && (
            <button onClick={handlePaste}
              className="px-3 py-1.5 rounded bg-trakend-accent text-white text-xs font-medium">
              Paste ({clipboard.paths.length})
            </button>
          )}
        </div>

        {/* View toggles */}
        <div className="flex items-center gap-1 border-l border-trakend-border pl-3">
          <button onClick={() => setShowHidden(!showHidden)}
            className={clsx('p-2 rounded text-xs', showHidden ? 'bg-trakend-accent text-white' : 'text-trakend-text-secondary hover:bg-trakend-surface-light')}
            title="Show hidden files">
            <Filter size={18} />
          </button>
          <button onClick={() => setViewMode('list')}
            className={clsx('p-2 rounded', viewMode === 'list' ? 'bg-trakend-surface-light text-trakend-text-primary' : 'text-trakend-text-secondary')}>
            <List size={18} />
          </button>
          <button onClick={() => setViewMode('grid')}
            className={clsx('p-2 rounded', viewMode === 'grid' ? 'bg-trakend-surface-light text-trakend-text-primary' : 'text-trakend-text-secondary')}>
            <Grid size={18} />
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Drive tree sidebar — always visible */}
        <div className="w-64 bg-trakend-surface border-r border-trakend-border overflow-y-auto flex-shrink-0">
          <div className="p-3 text-xs font-semibold text-trakend-text-secondary uppercase tracking-wider flex items-center gap-2">
            <Server size={14} /> Array Drives
          </div>

          {/* Array-assigned drives organized by role */}
          {(() => {
            const assignedDrives = allDrives.filter(d => d.role === 'parity' || d.role === 'parity2' || d.role === 'data' || d.role === 'cache')
            const parityDrives = assignedDrives.filter(d => d.role === 'parity' || d.role === 'parity2').sort((a, b) => {
              // Parity first, then Parity 2
              if (a.role === 'parity') return -1
              if (b.role === 'parity') return 1
              return 0
            })
            const dataDrives = assignedDrives.filter(d => d.role === 'data').sort((a: PhysicalDrive, b: PhysicalDrive) => (a.slot || 0) - (b.slot || 0))
            const cacheDrives = assignedDrives.filter(d => d.role === 'cache')
            const groups: { label: string; drives: PhysicalDrive[]; icon: React.ReactNode }[] = []
            if (parityDrives.length > 0) groups.push({ label: 'Parity', drives: parityDrives, icon: <Shield size={14} className="text-yellow-400" /> })
            if (dataDrives.length > 0) groups.push({ label: 'Data Drives', drives: dataDrives, icon: <Database size={14} className="text-trakend-accent" /> })
            if (cacheDrives.length > 0) groups.push({ label: 'Cache', drives: cacheDrives, icon: <Zap size={14} className="text-purple-400" /> })

            return groups.map(group => (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-[10px] font-bold text-trakend-text-secondary uppercase tracking-widest flex items-center gap-1.5 border-b border-trakend-border/30">
                  {group.icon} {group.label}
                </div>
                {group.drives.map(drive => {
                  const label = getDriveLabel(drive)
                  const isMounted = !!drive.mount_point
                  const usagePercent = drive.size_bytes > 0 && drive.usage_bytes
                    ? Math.round((drive.usage_bytes / drive.size_bytes) * 100) : 0
                  const isActive = isMounted && drive.mount_point && currentPath.startsWith(drive.mount_point)

                  return (
                    <button
                      key={drive.id}
                      onClick={() => isMounted && drive.mount_point ? navigate(drive.mount_point) : undefined}
                      disabled={!isMounted}
                      onDragOver={isMounted && drive.mount_point ? (e: React.DragEvent) => handleDragOver(e, drive.mount_point!) : undefined}
                      onDragLeave={isMounted ? handleDragLeave : undefined}
                      onDrop={isMounted && drive.mount_point ? (e: React.DragEvent) => handleDrop(e, drive.mount_point!) : undefined}
                      title={!isMounted ? (arrayState === 'running' || arrayState === 'degraded' ? 'Drive is not mounted' : 'Start the array to access drives') : undefined}
                      className={clsx(
                        'w-full text-left px-3 py-2 border-b border-trakend-border/20 transition-colors',
                        isMounted ? 'hover:bg-trakend-surface-light cursor-pointer' : 'opacity-50 cursor-not-allowed',
                        isActive && 'bg-trakend-accent/10 border-l-2 border-l-trakend-accent',
                        isMounted && drive.mount_point && dropTarget === drive.mount_point && 'ring-1 ring-trakend-accent bg-trakend-accent/10'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <HardDrive size={14} className={clsx('flex-shrink-0', isActive ? 'text-trakend-accent' : 'text-trakend-text-secondary')} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <span className={clsx('text-sm font-medium truncate', isActive ? 'text-trakend-accent' : 'text-trakend-text-primary')}>{label}</span>
                            <span className={clsx('text-[10px] font-medium px-1 rounded',
                              drive.health === 'healthy' ? 'text-green-400' :
                              drive.health === 'warning' ? 'text-yellow-400' :
                              'text-red-400'
                            )}>
                              {drive.health === 'healthy' ? 'OK' : drive.health.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[10px] text-trakend-text-secondary truncate">{drive.model}</div>
                          <div className="text-[10px] text-trakend-text-secondary truncate">{drive.size_human}</div>
                          {isMounted && drive.usage_bytes !== undefined && (
                            <div className="mt-1">
                              <div className="h-1 bg-trakend-dark rounded-full overflow-hidden">
                                <div
                                  className={clsx('h-full rounded-full', usagePercent > 90 ? 'bg-trakend-error' : usagePercent > 70 ? 'bg-trakend-warning' : 'bg-trakend-accent')}
                                  style={{ width: `${usagePercent}%` }}
                                />
                              </div>
                              <div className="text-[10px] text-trakend-text-secondary mt-0.5">{usagePercent}% used</div>
                            </div>
                          )}
                          {!isMounted && (
                            <div
                              className="text-[10px] text-red-400 mt-0.5 cursor-help"
                              title={arrayState === 'running' || arrayState === 'degraded'
                                ? 'The array is running but this drive has no mount point. Open the Array page and use "Reconcile mounts".'
                                : 'The array is stopped, so no data drives are mounted. Start the array to browse this drive.'}
                            >
                              {arrayState === 'running' || arrayState === 'degraded' ? 'Not mounted' : 'Array stopped'}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ))
          })()}

          {/* Quick links */}
          <div className="px-3 py-1.5 mt-2 text-[10px] font-bold text-trakend-text-secondary uppercase tracking-widest border-b border-trakend-border/30 flex items-center gap-1.5">
            <FolderOpen size={14} className="text-trakend-text-secondary" /> Quick Access
          </div>
          {['/', '/data', '/data/shares', '/data/backups', '/mnt/disks', '/tmp'].map(p => (
            <button key={p} onClick={() => navigate(p)}
              onDragOver={(e: React.DragEvent) => handleDragOver(e, p)}
              onDragLeave={handleDragLeave}
              onDrop={(e: React.DragEvent) => handleDrop(e, p)}
              className={clsx(
                'w-full text-left px-3 py-1.5 text-xs text-trakend-text-secondary hover:bg-trakend-surface-light hover:text-trakend-text-primary flex items-center gap-2',
                currentPath === p && 'bg-trakend-surface-light text-trakend-text-primary',
                dropTarget === p && 'ring-1 ring-trakend-accent bg-trakend-accent/10'
              )}>
              <ChevronRight size={10} className="text-trakend-text-secondary" />
              {p}
            </button>
          ))}
        </div>

        {/* File list — right panel (also a drop zone for uploads) */}
        <div
          ref={listRef}
          className={clsx('flex-1 overflow-auto relative outline-none', uploadHover && 'ring-2 ring-inset ring-trakend-accent')}
          tabIndex={0}
          onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setUploadHover(true) } }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setUploadHover(false) }}
          onDrop={(e) => { if (isFileDrag(e)) { e.preventDefault(); setUploadHover(false); uploadFiles(e.dataTransfer.files) } }}
        >
          {uploadHover && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-trakend-accent/10">
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-surface border border-trakend-accent text-sm text-trakend-text-primary shadow-xl">
                <Upload size={16} className="text-trakend-accent" /> Drop to upload into <span className="font-mono">{currentPath}</span>
              </div>
            </div>
          )}

          {uploads.length > 0 && (
            <div className="sticky top-0 z-10 bg-trakend-surface border-b border-trakend-border px-4 py-2 space-y-1.5">
              {uploads.map(u => (
                <div key={u.id} className="flex items-center gap-3 text-xs">
                  <Upload size={12} className={u.status === 'error' ? 'text-trakend-error' : 'text-trakend-accent'} />
                  <span className="truncate flex-1 text-trakend-text-primary">{u.name}</span>
                  {u.status === 'error' ? (
                    <span className="text-trakend-error truncate max-w-[50%]" title={u.error}>{u.error}</span>
                  ) : (
                    <>
                      <div className="w-40 h-1.5 bg-trakend-dark rounded-full overflow-hidden">
                        <div className={clsx('h-full rounded-full transition-all', u.status === 'done' ? 'bg-trakend-success' : 'bg-trakend-accent')} style={{ width: `${u.progress}%` }} />
                      </div>
                      <span className="w-10 text-right tabular-nums text-trakend-text-secondary">{u.status === 'done' ? 'done' : `${u.progress}%`}</span>
                    </>
                  )}
                  <button onClick={() => setUploads(prev => prev.filter(x => x.id !== u.id))} aria-label="Dismiss" className="text-trakend-text-secondary hover:text-trakend-text-primary focus-ring rounded"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="m-4">
              <EmptyState compact error title="Could not open this location" description={error}
                action={<Button size="sm" variant="secondary" onClick={() => loadDirectory(currentPath)}>Retry</Button>} />
            </div>
          )}

          {loading && !listing && (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
            </div>
          )}

          {/* Search results */}
          {searchResults ? (
            <div className="p-4">
              <div className="text-sm text-trakend-text-secondary mb-3">
                {searchResults.length} result(s) for "{searchQuery}"
                <button onClick={() => setSearchResults(null)} className="ml-2 text-trakend-accent hover:underline">Clear</button>
              </div>
              {searchResults.map((r: any, i: number) => (
                <button key={i}
                  onClick={() => r.type === 'directory' ? navigate(r.path) : handlePreview(r.path)}
                  className="w-full text-left flex items-center gap-3 px-3 py-2 rounded hover:bg-trakend-surface-light">
                  {r.type === 'directory' ? <FolderOpen size={16} className="text-trakend-accent" /> : <File size={16} className="text-trakend-text-secondary" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-trakend-text-primary truncate">{r.name}</div>
                    <div className="text-xs text-trakend-text-secondary truncate">{r.path}</div>
                  </div>
                  <span className="text-xs text-trakend-text-secondary">{formatSize(r.size)}</span>
                </button>
              ))}
            </div>
          ) : !listing && !loading ? (
            <div className="p-6 h-full flex items-center justify-center">
              <EmptyState icon={<HardDrive size={40} />} title="Select a drive to browse" description="Choose a drive from the sidebar or use Quick Access." />
            </div>
          ) : listing && (
            <>
              {/* Status bar */}
              <div className="px-4 py-2 bg-trakend-surface/50 border-b border-trakend-border/50 text-xs text-trakend-text-secondary flex items-center gap-4">
                <span>{listing.totalDirs} folder(s)</span>
                <span>{listing.totalFiles} file(s)</span>
                <span>{formatSize(listing.totalSize)}</span>
                {selectedItems.size > 0 && <span className="text-trakend-accent">{selectedItems.size} selected</span>}
              </div>

              {viewMode === 'list' ? (
                /* List view */
                <table className="w-full">
                  <thead className="bg-trakend-surface/30 sticky top-0">
                    <tr className="text-xs text-trakend-text-secondary uppercase tracking-wider">
                      <th className="w-8 px-2 py-2">
                        <input
                          type="checkbox"
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedItems(new Set(listing.entries.map(e => e.path)))
                            } else {
                              setSelectedItems(new Set())
                            }
                          }}
                          checked={selectedItems.size === listing.entries.length && listing.entries.length > 0}
                          className="rounded"
                        />
                      </th>
                      <th className="text-left px-2 py-2">Name</th>
                      <th className="text-right px-2 py-2 w-24">Size</th>
                      <th className="text-left px-2 py-2 w-44">Modified</th>
                      <th className="text-left px-2 py-2 w-24">Perms</th>
                      <th className="text-left px-2 py-2 w-20">Owner</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {listing.entries.map((entry, index) => (
                      <tr
                        key={entry.path}
                        data-index={index}
                        onClick={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') selectWithModifiers(index, e) }}
                        draggable={!entry.protected}
                        onDragStart={!entry.protected ? (e => handleDragStart(e, entry)) : undefined}
                        onDragOver={entry.type === 'directory' && !entry.protected ? (e => handleDragOver(e, entry.path)) : undefined}
                        onDragLeave={entry.type === 'directory' && !entry.protected ? handleDragLeave : undefined}
                        onDrop={entry.type === 'directory' && !entry.protected ? (e => handleDrop(e, entry.path)) : undefined}
                        className={clsx(
                          'border-b border-trakend-border/30 group',
                          !entry.protected && 'hover:bg-trakend-surface-light/50 cursor-pointer',
                          entry.protected && 'opacity-50 cursor-default',
                          selectedItems.has(entry.path) && !entry.protected && 'bg-trakend-accent/10',
                          cursor === index && 'outline outline-1 outline-trakend-accent/60 -outline-offset-1',
                          dropTarget === entry.path && !entry.protected && 'ring-2 ring-trakend-accent bg-trakend-accent/10'
                        )}
                        onDoubleClick={() => openEntry(entry)}
                        onContextMenu={e => { e.preventDefault(); if (!entry.protected) setContextMenu({ x: e.clientX, y: e.clientY, entry }) }}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={selectedItems.has(entry.path) && !entry.protected}
                            onChange={() => !entry.protected && toggleSelect(entry.path)}
                            disabled={entry.protected}
                            className="rounded"
                            onClick={e => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {renameTarget === entry.path && !entry.protected ? (
                            <input
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleRename(entry.path, renameValue)
                                if (e.key === 'Escape') setRenameTarget(null)
                              }}
                              onBlur={() => setRenameTarget(null)}
                              autoFocus
                              className="bg-trakend-dark text-trakend-text-primary text-sm px-2 py-0.5 rounded border border-trakend-accent outline-none"
                            />
                          ) : (
                            <div className={clsx('flex items-center gap-2', entry.protected && 'opacity-50')}>
                              {getFileIcon(entry)}
                              <span className={clsx(
                                'text-sm',
                                entry.type === 'directory' ? 'text-trakend-accent font-medium' : 'text-trakend-text-primary',
                                entry.hidden && 'opacity-60'
                              )}>
                                {entry.name}
                              </span>
                              {entry.type === 'symlink' && <span className="text-xs text-trakend-text-secondary">(link)</span>}
                              {entry.protected && <Lock size={12} className="text-gray-500 flex-shrink-0" />}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right text-sm text-trakend-text-secondary">
                          {entry.type === 'file' ? formatSize(entry.size) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-sm text-trakend-text-secondary">{formatDate(entry.modified)}</td>
                        <td className="px-2 py-1.5 text-xs text-trakend-text-secondary font-mono">{entry.permissions}</td>
                        <td className="px-2 py-1.5 text-xs text-trakend-text-secondary">{entry.owner}</td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={e => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, entry }) }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-trakend-surface text-trakend-text-secondary">
                            <MoreVertical size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                /* Grid view */
                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {listing.entries.map((entry, index) => (
                    <div
                      key={entry.path}
                      data-index={index}
                      draggable={!entry.protected}
                      onDragStart={!entry.protected ? (e => handleDragStart(e, entry)) : undefined}
                      onDragOver={entry.type === 'directory' && !entry.protected ? (e => handleDragOver(e, entry.path)) : undefined}
                      onDragLeave={entry.type === 'directory' && !entry.protected ? handleDragLeave : undefined}
                      onDrop={entry.type === 'directory' && !entry.protected ? (e => handleDrop(e, entry.path)) : undefined}
                      className={clsx(
                        'p-3 rounded-lg text-center cursor-pointer hover:bg-trakend-surface-light group border border-transparent',
                        selectedItems.has(entry.path) && 'bg-trakend-accent/10 border-trakend-accent/30',
                        cursor === index && 'border-trakend-accent/60',
                        dropTarget === entry.path && 'ring-2 ring-trakend-accent bg-trakend-accent/10'
                      )}
                      onDoubleClick={() => openEntry(entry)}
                      onClick={(e) => selectWithModifiers(index, e)}
                      onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, entry }) }}
                    >
                      <div className="flex justify-center mb-2">
                        {entry.type === 'directory'
                          ? <FolderOpen size={32} className="text-trakend-accent" />
                          : <File size={32} className="text-trakend-text-secondary" />
                        }
                      </div>
                      <div className="text-xs text-trakend-text-primary truncate">{entry.name}</div>
                      {entry.type === 'file' && (
                        <div className="text-xs text-trakend-text-secondary mt-0.5">{formatSize(entry.size)}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {listing.entries.length === 0 && !error && (
                <div className="p-6">
                  <EmptyState icon={<FolderOpen size={36} />} title="This folder is empty" description="Drag files here to upload, or create a new file or folder from the toolbar." />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          role="menu"
          className="fixed bg-trakend-surface border border-trakend-border rounded-lg shadow-xl py-1 z-50 min-w-48"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 280) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.entry.type === 'directory' && (
            <button onClick={() => { navigate(contextMenu.entry.path); setContextMenu(null) }}
              className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
              <FolderOpen size={14} /> Open
            </button>
          )}
          {contextMenu.entry.type === 'file' && (
            <>
              <button onClick={() => { handlePreview(contextMenu.entry.path); setContextMenu(null) }}
                className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
                <Eye size={14} /> Preview
              </button>
              <button onClick={() => { downloadEntry(contextMenu.entry); setContextMenu(null) }}
                className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
                <Download size={14} /> Download
              </button>
            </>
          )}
          {!contextMenu.entry.protected && (
            <button onClick={() => {
              setRenameTarget(contextMenu.entry.path)
              setRenameValue(contextMenu.entry.name)
              setContextMenu(null)
            }}
              className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
              <Edit3 size={14} /> Rename
            </button>
          )}
          <button onClick={() => {
            setClipboard({ paths: [contextMenu.entry.path], action: 'copy' })
            notify('Copied')
            setContextMenu(null)
          }}
            className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
            <Copy size={14} /> Copy
          </button>
          {!contextMenu.entry.protected && (
            <button onClick={() => {
              setClipboard({ paths: [contextMenu.entry.path], action: 'cut' })
              notify('Cut')
              setContextMenu(null)
            }}
              className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
              <Scissors size={14} /> Cut
            </button>
          )}
          {!contextMenu.entry.protected ? (
            <>
              <div className="border-t border-trakend-border my-1" />
              <button onClick={() => {
                handleDelete([contextMenu.entry.path])
                setContextMenu(null)
              }}
                className="w-full text-left px-4 py-2 text-sm text-trakend-error hover:bg-red-900/20 flex items-center gap-2">
                <Trash2 size={14} /> Delete
              </button>
            </>
          ) : (
            <>
              <div className="border-t border-trakend-border my-1" />
              <div className="px-4 py-2 text-xs text-gray-500 flex items-center gap-2">
                <Lock size={12} /> Protected system file
              </div>
            </>
          )}
        </div>
      )}

      {/* New file/folder dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-trakend-surface rounded-xl p-6 w-96 shadow-2xl border border-trakend-border">
            <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">
              New {showNewDialog === 'folder' ? 'Folder' : 'File'}
            </h3>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newName && handleCreate(showNewDialog, newName)}
              placeholder={showNewDialog === 'folder' ? 'Folder name...' : 'File name...'}
              autoFocus
              className="w-full bg-trakend-dark text-trakend-text-primary px-4 py-2.5 rounded-lg border border-trakend-border outline-none focus:border-trakend-accent"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setShowNewDialog(null); setNewName('') }}
                className="px-4 py-2 text-sm text-trakend-text-secondary hover:text-trakend-text-primary">
                Cancel
              </button>
              <button
                onClick={() => newName && handleCreate(showNewDialog, newName)}
                disabled={!newName}
                className="px-4 py-2 text-sm bg-trakend-accent text-white rounded-lg disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File preview modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
          <div className="bg-trakend-surface rounded-xl w-full max-w-4xl max-h-full flex flex-col shadow-2xl border border-trakend-border">
            <div className="flex items-center justify-between px-4 py-3 border-b border-trakend-border">
              <div className="text-sm text-trakend-text-primary font-medium truncate flex-1">
                {showPreview.path}
                <span className="ml-2 text-trakend-text-secondary font-normal">({formatSize(showPreview.size)})</span>
              </div>
              <button onClick={() => setShowPreview(null)} className="p-1 rounded hover:bg-trakend-surface-light">
                <X size={18} className="text-trakend-text-secondary" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-sm text-trakend-text-primary font-mono leading-relaxed whitespace-pre-wrap">
              {showPreview.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
