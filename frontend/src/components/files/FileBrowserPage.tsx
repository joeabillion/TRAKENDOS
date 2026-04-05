import React, { useEffect, useState, useCallback } from 'react'
import {
  FolderOpen, File, HardDrive, ChevronRight, ChevronDown,
  ArrowUp, RefreshCw, Search, Plus, Trash2, Copy, Scissors,
  Edit3, Download, Eye, FolderPlus, FilePlus, MoreVertical,
  Home, Grid, List, Filter, X, AlertCircle, Check, Lock,
  Database, Shield, Zap, Server
} from 'lucide-react'
import api from '../../utils/api'
import clsx from 'clsx'

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

interface DiskMount {
  device: string
  mountpoint: string
  fstype: string
  size: number
  used: number
  available: number
  usePercent: number
  label: string
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
  const [currentPath, setCurrentPath] = useState('/')
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [mounts, setMounts] = useState<DiskMount[]>([])
  const [allDrives, setAllDrives] = useState<PhysicalDrive[]>([])
  const [showDriveOverview, setShowDriveOverview] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [showHidden, setShowHidden] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [clipboard, setClipboard] = useState<{ paths: string[]; action: 'copy' | 'cut' } | null>(null)
  const [showPreview, setShowPreview] = useState<{ path: string; content: string; size: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showNewDialog, setShowNewDialog] = useState<'file' | 'folder' | null>(null)
  const [newName, setNewName] = useState('')
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

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
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load directory')
    } finally {
      setLoading(false)
    }
  }, [showHidden])

  const loadMounts = useCallback(async () => {
    try {
      const res = await api.get('/files/mounts')
      setMounts(res.data)
    } catch { /* ignore */ }
  }, [])

  const loadDrives = useCallback(async () => {
    try {
      const res = await api.get('/array/drives')
      setAllDrives(res.data || [])
    } catch { /* ignore */ }
  }, [])

  // Get display label for a drive (matches array page labeling)
  const getDriveLabel = (drive: PhysicalDrive): string => {
    if (drive.role === 'parity' || drive.role === 'parity2') return drive.role === 'parity2' ? 'Parity 2' : 'Parity'
    if (drive.role === 'cache') return 'Cache'
    if (drive.role === 'data' && drive.slot) return `Disk ${drive.slot}`
    if (drive.mount_point === '/data') return 'Data'
    if (drive.mount_point) {
      const name = drive.mount_point.split('/').pop() || drive.device
      return name.charAt(0).toUpperCase() + name.slice(1)
    }
    return drive.model || drive.device
  }

  // Get array label for a mount based on mountpoint (for sidebar)
  const getArrayLabel = (mount: DiskMount): { label: string; role: string } => {
    // Try to find matching physical drive
    const matchedDrive = allDrives.find(d => d.mount_point === mount.mountpoint || d.device === mount.device)
    if (matchedDrive) {
      return { label: getDriveLabel(matchedDrive), role: matchedDrive.role }
    }
    const mp = mount.mountpoint
    if (mp === '/mnt/disks/cache') return { label: 'Cache', role: 'cache' }
    const diskMatch = mp.match(/\/mnt\/disks\/disk(\d+)/)
    if (diskMatch) return { label: `Disk ${diskMatch[1]}`, role: 'data' }
    if (mp === '/data') return { label: 'Data', role: 'unassigned' }
    if (mp === '/') return { label: 'System', role: 'unassigned' }
    return { label: mount.label || mp.split('/').pop() || mp, role: 'unassigned' }
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'parity': return <Shield size={24} className="text-yellow-400" />
      case 'cache': return <Zap size={24} className="text-purple-400" />
      case 'data': return <Database size={24} className="text-trakend-accent" />
      default: return <HardDrive size={24} className="text-trakend-text-secondary" />
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'parity': return 'border-yellow-500/30 hover:border-yellow-500/60'
      case 'cache': return 'border-purple-500/30 hover:border-purple-500/60'
      case 'data': return 'border-trakend-accent/30 hover:border-trakend-accent/60'
      default: return 'border-trakend-border hover:border-trakend-text-secondary/50'
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'parity': return 'bg-yellow-900/30 text-yellow-400 border-yellow-700/30'
      case 'cache': return 'bg-purple-900/30 text-purple-400 border-purple-700/30'
      case 'data': return 'bg-trakend-accent/10 text-trakend-accent border-trakend-accent/30'
      default: return 'bg-trakend-surface text-trakend-text-secondary border-trakend-border'
    }
  }

  useEffect(() => {
    loadMounts()
    loadDrives()
  }, [])

  useEffect(() => {
    loadDirectory(currentPath)
  }, [showHidden])

  // ── Navigation ──

  const navigate = (path: string) => {
    setShowDriveOverview(false)
    loadDirectory(path)
  }

  const goToDriveOverview = () => {
    setShowDriveOverview(true)
    setListing(null)
    setError('')
    loadMounts()
    loadDrives()
  }

  const goUp = () => {
    if (listing?.parent) navigate(listing.parent)
  }

  const breadcrumbs = currentPath.split('/').filter(Boolean)

  // ── Search ──

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return }
    setSearchLoading(true)
    try {
      const res = await api.get('/files/search', { params: { path: currentPath, query: searchQuery } })
      setSearchResults(res.data)
    } catch { /* ignore */ }
    setSearchLoading(false)
  }

  // ── File operations ──

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 3000)
  }

  const handleDelete = async (paths: string[]) => {
    // Check if any selected items are protected
    const protectedItems = listing?.entries.filter(e => paths.includes(e.path) && e.protected) || []
    if (protectedItems.length > 0) {
      notify(`Cannot delete protected system files: ${protectedItems.map(e => e.name).join(', ')}`, 'error')
      return
    }
    if (!confirm(`Delete ${paths.length} item(s)? This cannot be undone.`)) return
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

  // Close context menu on click
  useEffect(() => {
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

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
      }
      if (e.key === 'Backspace' && listing?.parent) {
        e.preventDefault()
        goUp()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedItems, clipboard, listing])

  // Drag & drop state
  const [draggedPaths, setDraggedPaths] = useState<string[]>([])
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const handleDragStart = (e: React.DragEvent, entry: FileEntry) => {
    const paths = selectedItems.has(entry.path) ? Array.from(selectedItems) : [entry.path]
    setDraggedPaths(paths)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', paths.join('\n'))
  }

  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(targetPath)
  }

  const handleDragLeave = () => {
    setDropTarget(null)
  }

  const handleDrop = async (e: React.DragEvent, targetDir: string) => {
    e.preventDefault()
    setDropTarget(null)
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
      {/* Notification */}
      {notification && (
        <div className={clsx(
          'absolute top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2',
          notification.type === 'success' ? 'bg-trakend-success text-white' : 'bg-trakend-error text-white'
        )}>
          {notification.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {notification.msg}
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-trakend-surface border-b border-trakend-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        {/* Navigation */}
        <button onClick={showDriveOverview ? undefined : goUp} disabled={showDriveOverview || !listing?.parent}
          className="p-2 rounded hover:bg-trakend-surface-light disabled:opacity-30 text-trakend-text-secondary">
          <ArrowUp size={18} />
        </button>
        <button onClick={goToDriveOverview} className="p-2 rounded hover:bg-trakend-surface-light text-trakend-text-secondary" title="Drives Overview">
          <HardDrive size={18} />
        </button>
        <button onClick={() => loadDirectory(currentPath)} className="p-2 rounded hover:bg-trakend-surface-light text-trakend-text-secondary">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto text-sm">
          <button onClick={goToDriveOverview} className="text-trakend-text-secondary hover:text-trakend-accent font-medium">Drives</button>
          {!showDriveOverview && breadcrumbs.map((seg, i) => {
            const fullPath = '/' + breadcrumbs.slice(0, i + 1).join('/')
            return (
              <React.Fragment key={i}>
                <ChevronRight size={14} className="text-trakend-text-secondary flex-shrink-0" />
                <button
                  onClick={() => navigate(fullPath)}
                  className={clsx(
                    'whitespace-nowrap hover:text-trakend-accent',
                    i === breadcrumbs.length - 1 ? 'text-trakend-text-primary font-medium' : 'text-trakend-text-secondary'
                  )}
                >{seg}</button>
              </React.Fragment>
            )
          })}
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
          <button onClick={() => setShowNewDialog('file')} className="p-2 rounded hover:bg-trakend-surface-light text-trakend-text-secondary" title="New File">
            <FilePlus size={18} />
          </button>
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
        {/* Drive sidebar — hidden during drive overview */}
        {!showDriveOverview && (
          <div className="w-56 bg-trakend-surface border-r border-trakend-border overflow-y-auto flex-shrink-0">
            <div className="p-3 text-xs font-semibold text-trakend-text-secondary uppercase tracking-wider cursor-pointer hover:text-trakend-accent" onClick={goToDriveOverview}>← All Drives</div>
            {mounts.filter(m => m.mountpoint !== '/' && m.mountpoint !== '/boot' && m.mountpoint !== '/boot/efi').map((m, i) => {
              const info = getArrayLabel(m)
              return (
                <button
                  key={i}
                  onClick={() => navigate(m.mountpoint)}
                  onDragOver={e => handleDragOver(e, m.mountpoint)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, m.mountpoint)}
                  className={clsx(
                    'w-full text-left px-3 py-2.5 hover:bg-trakend-surface-light border-b border-trakend-border/50',
                    currentPath.startsWith(m.mountpoint) && 'bg-trakend-surface-light',
                    dropTarget === m.mountpoint && 'ring-2 ring-trakend-accent bg-trakend-accent/10'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <HardDrive size={16} className="text-trakend-accent flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-trakend-text-primary truncate">{info.label}</div>
                      <div className="text-xs text-trakend-text-secondary truncate">{m.mountpoint}</div>
                      <div className="mt-1 h-1.5 bg-trakend-dark rounded-full overflow-hidden">
                        <div
                          className={clsx('h-full rounded-full', m.usePercent > 90 ? 'bg-trakend-error' : m.usePercent > 70 ? 'bg-trakend-warning' : 'bg-trakend-accent')}
                          style={{ width: `${m.usePercent}%` }}
                        />
                      </div>
                      <div className="text-xs text-trakend-text-secondary mt-0.5">
                        {formatSize(m.used)} / {formatSize(m.size)}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
            {/* Quick links */}
            <div className="p-3 text-xs font-semibold text-trakend-text-secondary uppercase tracking-wider mt-2">Quick Access</div>
            {['/', '/data', '/data/shares', '/data/backups', '/mnt/disks', '/tmp'].map(p => (
              <button key={p} onClick={() => navigate(p)}
                onDragOver={e => handleDragOver(e, p)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, p)}
                className={clsx(
                  'w-full text-left px-3 py-2 text-sm text-trakend-text-secondary hover:bg-trakend-surface-light hover:text-trakend-text-primary',
                  dropTarget === p && 'ring-2 ring-trakend-accent bg-trakend-accent/10'
                )}>
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Drive Overview Landing Page */}
        {showDriveOverview ? (
          <div className="flex-1 overflow-auto p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-trakend-text-primary flex items-center gap-3">
                <Server size={24} className="text-trakend-accent" />
                All Drives
              </h2>
              <p className="text-sm text-trakend-text-secondary mt-1">
                {allDrives.length} drive(s) detected. Click a mounted drive to browse files.
              </p>
            </div>

            {/* Assigned / Array Drives */}
            {(() => {
              // Hide root/boot system partitions — keep /data since it's usable storage
              const HIDDEN_MOUNTS = new Set(['/', '/boot', '/boot/efi'])
              const visibleDrives = allDrives.filter(d => !d.mount_point || !HIDDEN_MOUNTS.has(d.mount_point))
              const parityDrives = visibleDrives.filter(d => d.role === 'parity' || d.role === 'parity2')
              const dataDrives = visibleDrives.filter(d => d.role === 'data').sort((a, b) => (a.slot || 0) - (b.slot || 0))
              const cacheDrives = visibleDrives.filter(d => d.role === 'cache')
              const unassignedDrives = visibleDrives.filter(d => d.role === 'unassigned' || d.role === 'hot_spare')
              const orderedDrives = [...parityDrives, ...dataDrives, ...cacheDrives, ...unassignedDrives]

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {orderedDrives.map((drive) => {
                    const label = getDriveLabel(drive)
                    const isMounted = !!drive.mount_point
                    const usagePercent = drive.size_bytes > 0 && drive.usage_bytes
                      ? Math.round((drive.usage_bytes / drive.size_bytes) * 100) : 0
                    const freeBytes = drive.size_bytes - (drive.usage_bytes || 0)

                    return (
                      <button
                        key={drive.id}
                        onClick={() => isMounted && drive.mount_point ? navigate(drive.mount_point) : undefined}
                        disabled={!isMounted}
                        onDragOver={isMounted && drive.mount_point ? (e => handleDragOver(e, drive.mount_point!)) : undefined}
                        onDragLeave={isMounted ? handleDragLeave : undefined}
                        onDrop={isMounted && drive.mount_point ? (e => handleDrop(e, drive.mount_point!)) : undefined}
                        className={clsx(
                          'text-left bg-trakend-surface rounded-xl border-2 p-5 transition-all duration-200 group',
                          isMounted ? 'hover:shadow-lg hover:shadow-black/20 cursor-pointer' : 'opacity-60 cursor-default',
                          getRoleColor(drive.role),
                          isMounted && drive.mount_point && dropTarget === drive.mount_point && 'ring-2 ring-trakend-accent bg-trakend-accent/10'
                        )}
                      >
                        {/* Header */}
                        <div className="flex items-start justify-between mb-3">
                          <div className="p-2.5 rounded-lg bg-trakend-dark">
                            {getRoleIcon(drive.role)}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border', getRoleBadgeColor(drive.role))}>
                              {drive.role === 'data' ? 'Data' : drive.role === 'parity' ? 'Parity' : drive.role === 'parity2' ? 'Parity 2' : drive.role === 'cache' ? 'Cache' : drive.role === 'hot_spare' ? 'Hot Spare' : 'Unassigned'}
                            </span>
                            {!isMounted && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-700/30">Not Mounted</span>
                            )}
                          </div>
                        </div>

                        {/* Name + device info */}
                        <h3 className={clsx('text-lg font-bold transition-colors', isMounted ? 'text-trakend-text-primary group-hover:text-trakend-accent' : 'text-trakend-text-secondary')}>
                          {label}
                        </h3>
                        <div className="text-xs text-trakend-text-secondary mt-0.5 truncate" title={drive.model}>
                          {drive.model}
                        </div>
                        <div className="text-xs text-trakend-text-secondary font-mono truncate mt-0.5">
                          {drive.device}{drive.mount_point ? ` → ${drive.mount_point}` : ''}
                        </div>

                        {/* Usage bar (only for mounted drives with usage data) */}
                        {isMounted && drive.usage_bytes !== undefined ? (
                          <div className="mt-3">
                            <div className="flex justify-between text-xs text-trakend-text-secondary mb-1">
                              <span>{formatSize(drive.usage_bytes)} used</span>
                              <span>{formatSize(freeBytes > 0 ? freeBytes : 0)} free</span>
                            </div>
                            <div className="h-2 bg-trakend-dark rounded-full overflow-hidden">
                              <div
                                className={clsx(
                                  'h-full rounded-full transition-all duration-500',
                                  usagePercent > 90 ? 'bg-trakend-error' : usagePercent > 70 ? 'bg-trakend-warning' : 'bg-trakend-accent'
                                )}
                                style={{ width: `${usagePercent}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-xs mt-1">
                              <span className="text-trakend-text-secondary">{drive.filesystem?.toUpperCase() || '?'}</span>
                              <span className={clsx('font-semibold', usagePercent > 90 ? 'text-trakend-error' : usagePercent > 70 ? 'text-trakend-warning' : 'text-trakend-accent')}>
                                {usagePercent}%
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 text-xs text-trakend-text-secondary">
                            {drive.filesystem ? drive.filesystem.toUpperCase() : 'No filesystem'} • {drive.size_human}
                          </div>
                        )}

                        {/* Footer: health + temp */}
                        <div className="mt-3 pt-2 border-t border-trakend-border/50 flex items-center justify-between">
                          <span className={clsx('text-xs font-medium px-1.5 py-0.5 rounded',
                            drive.health === 'healthy' ? 'bg-green-500/20 text-green-400' :
                            drive.health === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                            drive.health === 'failing' || drive.health === 'failed' ? 'bg-red-500/20 text-red-400' :
                            'bg-gray-500/20 text-gray-400'
                          )}>
                            {drive.health.toUpperCase()}
                          </span>
                          <div className="flex items-center gap-2 text-xs text-trakend-text-secondary">
                            {drive.temperature > 0 && (
                              <span className={drive.temperature > 50 ? 'text-orange-400' : ''}>{drive.temperature}°C</span>
                            )}
                            <span>{drive.transport.toUpperCase()}</span>
                            <span>{drive.rpm > 0 ? `${drive.rpm} RPM` : 'SSD'}</span>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })()}

            {/* Quick access section */}
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-trakend-text-secondary uppercase tracking-wider mb-3">Quick Access</h3>
              <div className="flex flex-wrap gap-2">
                {['/data', '/data/shares', '/data/backups', '/mnt/disks', '/tmp'].map(p => (
                  <button key={p} onClick={() => navigate(p)}
                    className="px-4 py-2 rounded-lg bg-trakend-surface border border-trakend-border text-sm text-trakend-text-secondary hover:text-trakend-text-primary hover:border-trakend-accent/50 transition-colors">
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
        /* File list */
        <div className="flex-1 overflow-auto">
          {error && (
            <div className="m-4 p-3 rounded-lg bg-red-900/20 border border-trakend-error/30 text-trakend-error text-sm flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {/* Search results */}
          {searchResults ? (
            <div className="p-4">
              <div className="text-sm text-trakend-text-secondary mb-3">
                {searchResults.length} result(s) for "{searchQuery}"
                <button onClick={() => setSearchResults(null)} className="ml-2 text-trakend-accent hover:underline">Clear</button>
              </div>
              {searchResults.map((r, i) => (
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
                    {listing.entries.map(entry => (
                      <tr
                        key={entry.path}
                        draggable
                        onDragStart={e => handleDragStart(e, entry)}
                        onDragOver={entry.type === 'directory' ? (e => handleDragOver(e, entry.path)) : undefined}
                        onDragLeave={entry.type === 'directory' ? handleDragLeave : undefined}
                        onDrop={entry.type === 'directory' ? (e => handleDrop(e, entry.path)) : undefined}
                        className={clsx(
                          'border-b border-trakend-border/30 hover:bg-trakend-surface-light/50 cursor-pointer group',
                          selectedItems.has(entry.path) && 'bg-trakend-accent/10',
                          dropTarget === entry.path && 'ring-2 ring-trakend-accent bg-trakend-accent/10'
                        )}
                        onDoubleClick={() => entry.type === 'directory' ? navigate(entry.path) : handlePreview(entry.path)}
                        onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, entry }) }}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={selectedItems.has(entry.path)}
                            onChange={() => toggleSelect(entry.path)}
                            className="rounded"
                            onClick={e => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {renameTarget === entry.path ? (
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
                            <div className="flex items-center gap-2">
                              {getFileIcon(entry)}
                              <span className={clsx(
                                'text-sm',
                                entry.type === 'directory' ? 'text-trakend-accent font-medium' : 'text-trakend-text-primary',
                                entry.hidden && 'opacity-60'
                              )}>
                                {entry.name}
                              </span>
                              {entry.type === 'symlink' && <span className="text-xs text-trakend-text-secondary">(link)</span>}
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
                  {listing.entries.map(entry => (
                    <div
                      key={entry.path}
                      draggable
                      onDragStart={e => handleDragStart(e, entry)}
                      onDragOver={entry.type === 'directory' ? (e => handleDragOver(e, entry.path)) : undefined}
                      onDragLeave={entry.type === 'directory' ? handleDragLeave : undefined}
                      onDrop={entry.type === 'directory' ? (e => handleDrop(e, entry.path)) : undefined}
                      className={clsx(
                        'p-3 rounded-lg text-center cursor-pointer hover:bg-trakend-surface-light group border border-transparent',
                        selectedItems.has(entry.path) && 'bg-trakend-accent/10 border-trakend-accent/30',
                        dropTarget === entry.path && 'ring-2 ring-trakend-accent bg-trakend-accent/10'
                      )}
                      onDoubleClick={() => entry.type === 'directory' ? navigate(entry.path) : handlePreview(entry.path)}
                      onClick={() => toggleSelect(entry.path)}
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
                <div className="flex flex-col items-center justify-center py-20 text-trakend-text-secondary">
                  <FolderOpen size={48} className="mb-3 opacity-30" />
                  <span className="text-sm">This folder is empty</span>
                </div>
              )}
            </>
          )}
        </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-trakend-surface border border-trakend-border rounded-lg shadow-xl py-1 z-50 min-w-48"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.entry.type === 'directory' && (
            <button onClick={() => { navigate(contextMenu.entry.path); setContextMenu(null) }}
              className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
              <FolderOpen size={14} /> Open
            </button>
          )}
          {contextMenu.entry.type === 'file' && (
            <button onClick={() => { handlePreview(contextMenu.entry.path); setContextMenu(null) }}
              className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
              <Eye size={14} /> Preview
            </button>
          )}
          <button onClick={() => {
            setRenameTarget(contextMenu.entry.path)
            setRenameValue(contextMenu.entry.name)
            setContextMenu(null)
          }}
            className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
            <Edit3 size={14} /> Rename
          </button>
          <button onClick={() => {
            setClipboard({ paths: [contextMenu.entry.path], action: 'copy' })
            notify('Copied')
            setContextMenu(null)
          }}
            className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
            <Copy size={14} /> Copy
          </button>
          <button onClick={() => {
            setClipboard({ paths: [contextMenu.entry.path], action: 'cut' })
            notify('Cut')
            setContextMenu(null)
          }}
            className="w-full text-left px-4 py-2 text-sm text-trakend-text-primary hover:bg-trakend-surface-light flex items-center gap-2">
            <Scissors size={14} /> Cut
          </button>
          <div className="border-t border-trakend-border my-1" />
          <button onClick={() => {
            handleDelete([contextMenu.entry.path])
            setContextMenu(null)
          }}
            className="w-full text-left px-4 py-2 text-sm text-trakend-error hover:bg-red-900/20 flex items-center gap-2">
            <Trash2 size={14} /> Delete
          </button>
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
