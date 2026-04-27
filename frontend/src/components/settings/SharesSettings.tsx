import React, { useState, useEffect } from 'react'
import {
  Users, FolderOpen, Plus, Trash2, Power, PowerOff,
  RefreshCw, AlertCircle, Check, Eye, EyeOff, Shield, Network
} from 'lucide-react'
import api from '../../utils/api'
import clsx from 'clsx'

// ── Types ──

interface ShareUser {
  id: number
  username: string
  homeDir: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface SambaShare {
  id: number
  name: string
  path: string
  comment: string
  browseable: boolean
  readOnly: boolean
  guestOk: boolean
  validUsers: string[]
  writableUsers: string[]
  createdAt: string
  updatedAt: string
}

interface SambaStatus {
  installed: boolean
  running: boolean
  version: string
  connections: number
}

// ── Main Component ──

export const SharesSettings: React.FC = () => {
  const [status, setStatus] = useState<SambaStatus | null>(null)
  const [users, setUsers] = useState<ShareUser[]>([])
  const [shares, setShares] = useState<SambaShare[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<'status' | 'users' | 'shares'>('status')
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // New user form
  const [showNewUser, setShowNewUser] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newHomeDir, setNewHomeDir] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // New share form
  const [showNewShare, setShowNewShare] = useState(false)
  const [newShareName, setNewShareName] = useState('')
  const [newSharePath, setNewSharePath] = useState('')
  const [newShareComment, setNewShareComment] = useState('')
  const [newShareBrowseable, setNewShareBrowseable] = useState(true)
  const [newShareReadOnly, setNewShareReadOnly] = useState(false)
  const [newShareGuestOk, setNewShareGuestOk] = useState(false)
  const [newShareUsers, setNewShareUsers] = useState<string[]>([])
  const [newShareWriteUsers, setNewShareWriteUsers] = useState<string[]>([])

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 3000)
  }

  const loadAll = async () => {
    setLoading(true)
    try {
      const [statusRes, usersRes, sharesRes] = await Promise.all([
        api.get('/shares/status'),
        api.get('/shares/users'),
        api.get('/shares/list'),
      ])
      setStatus(statusRes.data)
      setUsers(usersRes.data)
      setShares(sharesRes.data)
    } catch (err) {
      notify('Failed to load share data', 'error')
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  // ── Actions ──

  const handleStartStop = async (action: 'start' | 'stop' | 'restart') => {
    try {
      await api.post(`/shares/${action}`)
      notify(`Samba ${action}ed`)
      loadAll()
    } catch (err: any) {
      notify(`Failed to ${action} Samba: ${err?.response?.data?.error}`, 'error')
    }
  }

  const handleCreateUser = async () => {
    if (!newUsername || !newPassword) return
    try {
      await api.post('/shares/users', {
        username: newUsername,
        password: newPassword,
        homeDir: newHomeDir || undefined,
      })
      notify(`User "${newUsername}" created`)
      setShowNewUser(false)
      setNewUsername('')
      setNewPassword('')
      setNewHomeDir('')
      loadAll()
    } catch (err: any) {
      notify(err?.response?.data?.error || 'Failed to create user', 'error')
    }
  }

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`Delete user "${username}"?`)) return
    try {
      await api.delete(`/shares/users/${username}`)
      notify(`User "${username}" deleted`)
      loadAll()
    } catch (err: any) {
      notify(err?.response?.data?.error || 'Failed to delete user', 'error')
    }
  }

  const handleToggleUser = async (username: string, enabled: boolean) => {
    try {
      await api.put(`/shares/users/${username}/toggle`, { enabled })
      notify(`User "${username}" ${enabled ? 'enabled' : 'disabled'}`)
      loadAll()
    } catch (err: any) {
      notify(err?.response?.data?.error || 'Failed', 'error')
    }
  }

  const handleCreateShare = async () => {
    if (!newShareName || !newSharePath) return
    try {
      await api.post('/shares/create', {
        name: newShareName,
        path: newSharePath,
        comment: newShareComment,
        browseable: newShareBrowseable,
        readOnly: newShareReadOnly,
        guestOk: newShareGuestOk,
        validUsers: newShareUsers,
        writableUsers: newShareWriteUsers,
      })
      notify(`Share "${newShareName}" created`)
      setShowNewShare(false)
      setNewShareName('')
      setNewSharePath('')
      setNewShareComment('')
      setNewShareUsers([])
      setNewShareWriteUsers([])
      loadAll()
    } catch (err: any) {
      notify(err?.response?.data?.error || 'Failed to create share', 'error')
    }
  }

  const handleDeleteShare = async (name: string) => {
    if (!confirm(`Delete share "${name}"?`)) return
    try {
      await api.delete(`/shares/${name}`)
      notify(`Share "${name}" deleted`)
      loadAll()
    } catch (err: any) {
      notify(err?.response?.data?.error || 'Failed', 'error')
    }
  }

  if (loading && !status) {
    return <div className="text-trakend-text-secondary p-4">Loading shares...</div>
  }

  return (
    <div className="space-y-6">
      {/* Notification */}
      {notification && (
        <div className={clsx(
          'px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2',
          notification.type === 'success' ? 'bg-green-900/30 text-trakend-success border border-green-700/30' : 'bg-red-900/30 text-trakend-error border border-red-700/30'
        )}>
          {notification.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {notification.msg}
        </div>
      )}

      {/* Section tabs */}
      <div className="flex gap-2">
        {(['status', 'users', 'shares'] as const).map(s => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium capitalize',
              activeSection === s ? 'bg-trakend-accent text-white' : 'bg-trakend-surface text-trakend-text-secondary hover:text-trakend-text-primary'
            )}>
            {s === 'status' && <Network size={14} className="inline mr-1.5" />}
            {s === 'users' && <Users size={14} className="inline mr-1.5" />}
            {s === 'shares' && <FolderOpen size={14} className="inline mr-1.5" />}
            {s}
          </button>
        ))}
      </div>

      {/* ── Status Section ── */}
      {activeSection === 'status' && status && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
              <div className="text-xs text-trakend-text-secondary uppercase mb-1">Status</div>
              <div className={clsx('text-lg font-bold', status.running ? 'text-trakend-success' : 'text-trakend-error')}>
                {status.running ? 'Running' : status.installed ? 'Stopped' : 'Not Installed'}
              </div>
            </div>
            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
              <div className="text-xs text-trakend-text-secondary uppercase mb-1">Version</div>
              <div className="text-lg font-bold text-trakend-text-primary">{status.version || 'N/A'}</div>
            </div>
            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
              <div className="text-xs text-trakend-text-secondary uppercase mb-1">Connections</div>
              <div className="text-lg font-bold text-trakend-accent">{status.connections}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => handleStartStop('start')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-success text-white text-sm">
              <Power size={14} /> Start
            </button>
            <button onClick={() => handleStartStop('stop')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-error text-white text-sm">
              <PowerOff size={14} /> Stop
            </button>
            <button onClick={() => handleStartStop('restart')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-surface border border-trakend-border text-trakend-text-primary text-sm">
              <RefreshCw size={14} /> Restart
            </button>
          </div>

          <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
            <h4 className="text-sm font-semibold text-trakend-text-primary mb-2">Network Access Info</h4>
            <p className="text-sm text-trakend-text-secondary">
              Windows: Open File Explorer, type <code className="bg-trakend-dark px-1 rounded">\\server-ip\share-name</code>
            </p>
            <p className="text-sm text-trakend-text-secondary mt-1">
              Mac: Finder → Go → Connect to Server → <code className="bg-trakend-dark px-1 rounded">smb://server-ip/share-name</code>
            </p>
          </div>
        </div>
      )}

      {/* ── Users Section ── */}
      {activeSection === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-trakend-text-primary">Share Users ({users.length})</h3>
            <button onClick={() => setShowNewUser(!showNewUser)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-trakend-accent text-white text-sm">
              <Plus size={14} /> Add User
            </button>
          </div>

          {/* New user form */}
          {showNewUser && (
            <div className="bg-trakend-surface border border-trakend-accent/30 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-trakend-text-secondary">Username</label>
                  <input value={newUsername} onChange={e => setNewUsername(e.target.value)}
                    placeholder="e.g. john"
                    className="w-full mt-1 bg-trakend-dark border border-trakend-border rounded-lg px-3 py-2 text-sm text-trakend-text-primary outline-none focus:border-trakend-accent" />
                </div>
                <div>
                  <label className="text-xs text-trakend-text-secondary">Password</label>
                  <div className="relative mt-1">
                    <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                      className="w-full bg-trakend-dark border border-trakend-border rounded-lg px-3 py-2 text-sm text-trakend-text-primary outline-none focus:border-trakend-accent pr-10" />
                    <button onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-2 text-trakend-text-secondary">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs text-trakend-text-secondary">Home Directory (optional)</label>
                <input value={newHomeDir} onChange={e => setNewHomeDir(e.target.value)}
                  placeholder="/data/shares/username"
                  className="w-full mt-1 bg-trakend-dark border border-trakend-border rounded-lg px-3 py-2 text-sm text-trakend-text-primary outline-none focus:border-trakend-accent" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreateUser} disabled={!newUsername || !newPassword}
                  className="px-4 py-2 text-sm bg-trakend-accent text-white rounded-lg disabled:opacity-50">Create</button>
                <button onClick={() => setShowNewUser(false)}
                  className="px-4 py-2 text-sm text-trakend-text-secondary">Cancel</button>
              </div>
            </div>
          )}

          {/* User list */}
          <div className="space-y-2">
            {users.map(user => (
              <div key={user.id} className="bg-trakend-surface border border-trakend-border rounded-lg p-3 flex items-center gap-4">
                <div className={clsx('w-2 h-2 rounded-full', user.enabled ? 'bg-trakend-success' : 'bg-trakend-text-secondary')} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-trakend-text-primary">{user.username}</div>
                  <div className="text-xs text-trakend-text-secondary truncate">{user.homeDir}</div>
                </div>
                <button onClick={() => handleToggleUser(user.username, !user.enabled)}
                  className={clsx('p-1.5 rounded', user.enabled ? 'text-trakend-success hover:bg-green-900/20' : 'text-trakend-text-secondary hover:bg-trakend-surface-light')}>
                  {user.enabled ? <Power size={16} /> : <PowerOff size={16} />}
                </button>
                <button onClick={() => handleDeleteUser(user.username)}
                  className="p-1.5 rounded text-trakend-error hover:bg-red-900/20">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {users.length === 0 && (
              <p className="text-sm text-trakend-text-secondary py-4 text-center">No share users created yet</p>
            )}
          </div>
        </div>
      )}

      {/* ── Shares Section ── */}
      {activeSection === 'shares' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-trakend-text-primary">Network Shares ({shares.length})</h3>
            <button onClick={() => setShowNewShare(!showNewShare)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-trakend-accent text-white text-sm">
              <Plus size={14} /> Add Share
            </button>
          </div>

          {/* New share form */}
          {showNewShare && (
            <div className="bg-trakend-surface border border-trakend-accent/30 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-trakend-text-secondary">Share Name</label>
                  <input value={newShareName} onChange={e => setNewShareName(e.target.value)}
                    placeholder="e.g. Media"
                    className="w-full mt-1 bg-trakend-dark border border-trakend-border rounded-lg px-3 py-2 text-sm text-trakend-text-primary outline-none focus:border-trakend-accent" />
                </div>
                <div>
                  <label className="text-xs text-trakend-text-secondary">Path</label>
                  <input value={newSharePath} onChange={e => setNewSharePath(e.target.value)}
                    placeholder="/data/shares/media"
                    className="w-full mt-1 bg-trakend-dark border border-trakend-border rounded-lg px-3 py-2 text-sm text-trakend-text-primary outline-none focus:border-trakend-accent" />
                </div>
              </div>
              <div>
                <label className="text-xs text-trakend-text-secondary">Comment</label>
                <input value={newShareComment} onChange={e => setNewShareComment(e.target.value)}
                  placeholder="Shared media files"
                  className="w-full mt-1 bg-trakend-dark border border-trakend-border rounded-lg px-3 py-2 text-sm text-trakend-text-primary outline-none focus:border-trakend-accent" />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-trakend-text-primary cursor-pointer">
                  <input type="checkbox" checked={newShareBrowseable} onChange={e => setNewShareBrowseable(e.target.checked)} /> Browseable
                </label>
                <label className="flex items-center gap-2 text-sm text-trakend-text-primary cursor-pointer">
                  <input type="checkbox" checked={newShareReadOnly} onChange={e => setNewShareReadOnly(e.target.checked)} /> Read Only
                </label>
                <label className="flex items-center gap-2 text-sm text-trakend-text-primary cursor-pointer">
                  <input type="checkbox" checked={newShareGuestOk} onChange={e => setNewShareGuestOk(e.target.checked)} /> Guest Access
                </label>
              </div>
              {users.length > 0 && (
                <div>
                  <label className="text-xs text-trakend-text-secondary mb-1 block">Allowed Users</label>
                  <div className="flex flex-wrap gap-2">
                    {users.map(u => (
                      <label key={u.username} className="flex items-center gap-1.5 text-sm text-trakend-text-primary cursor-pointer bg-trakend-dark px-2 py-1 rounded">
                        <input type="checkbox"
                          checked={newShareUsers.includes(u.username)}
                          onChange={e => {
                            if (e.target.checked) {
                              setNewShareUsers([...newShareUsers, u.username])
                              setNewShareWriteUsers([...newShareWriteUsers, u.username])
                            } else {
                              setNewShareUsers(newShareUsers.filter(x => x !== u.username))
                              setNewShareWriteUsers(newShareWriteUsers.filter(x => x !== u.username))
                            }
                          }} />
                        {u.username}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={handleCreateShare} disabled={!newShareName || !newSharePath}
                  className="px-4 py-2 text-sm bg-trakend-accent text-white rounded-lg disabled:opacity-50">Create Share</button>
                <button onClick={() => setShowNewShare(false)}
                  className="px-4 py-2 text-sm text-trakend-text-secondary">Cancel</button>
              </div>
            </div>
          )}

          {/* Share list */}
          <div className="space-y-2">
            {shares.map(share => (
              <div key={share.id} className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FolderOpen size={16} className="text-trakend-accent" />
                      <span className="text-sm font-semibold text-trakend-text-primary">{share.name}</span>
                      {share.readOnly && <span className="text-xs bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">Read Only</span>}
                      {share.guestOk && <span className="text-xs bg-orange-900/30 text-orange-400 px-1.5 py-0.5 rounded">Guest</span>}
                    </div>
                    <div className="text-xs text-trakend-text-secondary mt-1 font-mono">{share.path}</div>
                    {share.comment && <div className="text-xs text-trakend-text-secondary mt-0.5">{share.comment}</div>}
                    {share.validUsers.length > 0 && (
                      <div className="flex items-center gap-1 mt-2">
                        <Shield size={12} className="text-trakend-text-secondary" />
                        <span className="text-xs text-trakend-text-secondary">
                          Users: {share.validUsers.join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleDeleteShare(share.name)}
                    className="p-1.5 rounded text-trakend-error hover:bg-red-900/20">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {shares.length === 0 && (
              <p className="text-sm text-trakend-text-secondary py-4 text-center">No shares created yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
