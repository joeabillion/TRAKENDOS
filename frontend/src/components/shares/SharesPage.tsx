import React, { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, Power, RotateCw, Play, Settings, Edit2, Save, X } from 'lucide-react'
import { useShares, SambaShare, ShareUser, SambaStatus } from '../../hooks/useShares'
import api from '../../utils/api'

interface ArrayDrive {
  number: number
  device: string
  status: string
  size: number
  allocated: number
  diskType: string
}

type ActiveTab = 'shares' | 'users' | 'connections'

export const SharesPage: React.FC = () => {
  const shares = useShares()
  const [activeTab, setActiveTab] = useState<ActiveTab>('shares')
  const [sambaStatus, setSambaStatus] = useState<SambaStatus | null>(null)
  const [sharesList, setSharesList] = useState<SambaShare[]>([])
  const [usersList, setUsersList] = useState<ShareUser[]>([])
  const [drives, setDrives] = useState<ArrayDrive[]>([])
  const [selectedDrive, setSelectedDrive] = useState<number | null>(null)
  const [selectedShare, setSelectedShare] = useState<string | null>(null)
  const [connections, setConnections] = useState<any[]>([])

  const [showNewUserDialog, setShowNewUserDialog] = useState(false)
  const [newUserForm, setNewUserForm] = useState({ username: '', password: '' })

  const [showNewShareDialog, setShowNewShareDialog] = useState(false)
  const [newShareForm, setNewShareForm] = useState({
    name: '',
    path: '',
    comment: '',
    browseable: true,
    readOnly: false,
    guestOk: false,
    validUsers: [] as string[],
    writableUsers: [] as string[],
  })

  const [editingShare, setEditingShare] = useState<SambaShare | null>(null)
  const [editingForm, setEditingForm] = useState<Partial<SambaShare> | null>(null)

  // Load initial data
  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    await Promise.all([
      loadSambaStatus(),
      loadShares(),
      loadUsers(),
      loadDrives(),
      loadConnections(),
    ])
  }

  const loadSambaStatus = async () => {
    const status = await shares.getStatus()
    setSambaStatus(status)
  }

  const loadShares = async () => {
    const list = await shares.getShares()
    setSharesList(list)
  }

  const loadUsers = async () => {
    const list = await shares.getUsers()
    setUsersList(list)
  }

  const loadDrives = async () => {
    try {
      const response = await api.get('/array/drives')
      setDrives(response.data || [])
    } catch (error) {
      console.error('Failed to load drives:', error)
    }
  }

  const loadConnections = async () => {
    const conns = await shares.getConnections()
    setConnections(conns)
  }

  const handleStartSamba = async () => {
    const success = await shares.startSamba()
    if (success) {
      await loadSambaStatus()
    }
  }

  const handleStopSamba = async () => {
    const success = await shares.stopSamba()
    if (success) {
      await loadSambaStatus()
    }
  }

  const handleRestartSamba = async () => {
    const success = await shares.restartSamba()
    if (success) {
      await loadSambaStatus()
    }
  }

  const handleCreateUser = async () => {
    if (!newUserForm.username || !newUserForm.password) return
    const result = await shares.createUser(newUserForm.username, newUserForm.password)
    if (result) {
      setNewUserForm({ username: '', password: '' })
      setShowNewUserDialog(false)
      await loadUsers()
    }
  }

  const handleToggleUser = async (username: string, enabled: boolean) => {
    const success = await shares.toggleUser(username, !enabled)
    if (success) {
      await loadUsers()
    }
  }

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`Delete user ${username}?`)) return
    const success = await shares.deleteUser(username)
    if (success) {
      await loadUsers()
      await loadShares()
    }
  }

  const handleCreateShare = async () => {
    if (!newShareForm.name || !newShareForm.path) return
    const result = await shares.createShare(newShareForm)
    if (result) {
      setNewShareForm({
        name: '',
        path: '',
        comment: '',
        browseable: true,
        readOnly: false,
        guestOk: false,
        validUsers: [],
        writableUsers: [],
      })
      setShowNewShareDialog(false)
      await loadShares()
    }
  }

  const handleUpdateShare = async () => {
    if (!editingShare || !editingForm) return
    const result = await shares.updateShare(editingShare.name, editingForm)
    if (result) {
      setEditingShare(null)
      setEditingForm(null)
      await loadShares()
    }
  }

  const handleDeleteShare = async (name: string) => {
    if (!confirm(`Delete share ${name}?`)) return
    const success = await shares.deleteShare(name)
    if (success) {
      await loadShares()
      setSelectedShare(null)
    }
  }

  const getDriveShares = () => {
    if (selectedDrive === null) return []
    const drivePath = `/mnt/disk${selectedDrive}`
    return sharesList.filter((s) => s.path.startsWith(drivePath))
  }

  const getSelectedShareDetails = () => {
    return sharesList.find((s) => s.name === selectedShare) || null
  }

  return (
    <div className="flex-1 bg-trakend-dark h-full flex flex-col overflow-hidden">
      {/* Samba Status Bar */}
      <div className="bg-trakend-surface border-b border-trakend-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${sambaStatus?.running ? 'bg-trakend-success animate-pulse' : 'bg-trakend-error'}`}></div>
          <span className="text-sm font-semibold text-trakend-text-primary">Samba</span>
          <span className="text-xs text-trakend-text-secondary">
            {sambaStatus?.running ? 'Running' : 'Stopped'} • {sambaStatus?.connections || 0} connections
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleStartSamba}
            disabled={(sambaStatus?.running || false) || shares.loading}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-trakend-success text-white hover:bg-opacity-90 transition-colors disabled:opacity-50"
          >
            <Play size={14} />
            Start
          </button>
          <button
            onClick={handleStopSamba}
            disabled={!(sambaStatus?.running || false) || shares.loading}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-trakend-error text-white hover:bg-opacity-90 transition-colors disabled:opacity-50"
          >
            <Power size={14} />
            Stop
          </button>
          <button
            onClick={handleRestartSamba}
            disabled={!(sambaStatus?.running || false) || shares.loading}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors disabled:opacity-50"
          >
            <RotateCw size={14} />
            Restart
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-trakend-surface border-b border-trakend-border px-4 py-3 flex gap-6">
        <button
          onClick={() => setActiveTab('shares')}
          className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
            activeTab === 'shares'
              ? 'text-trakend-accent border-trakend-accent'
              : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
          }`}
        >
          Shares
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
            activeTab === 'users'
              ? 'text-trakend-accent border-trakend-accent'
              : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
          }`}
        >
          Users
        </button>
        <button
          onClick={() => {
            setActiveTab('connections')
            loadConnections()
          }}
          className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
            activeTab === 'connections'
              ? 'text-trakend-accent border-trakend-accent'
              : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
          }`}
        >
          Connections
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Shares Tab */}
        {activeTab === 'shares' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Drives & Shares */}
            <div className="w-64 bg-trakend-surface border-r border-trakend-border flex flex-col overflow-hidden">
              {/* Drives */}
              <div className="p-3 border-b border-trakend-border">
                <div className="text-xs uppercase tracking-wide text-trakend-text-secondary font-semibold mb-2">Drives</div>
                <div className="space-y-1">
                  {drives.map((drive) => (
                    <button
                      key={drive.number}
                      onClick={() => {
                        setSelectedDrive(drive.number)
                        setSelectedShare(null)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                        selectedDrive === drive.number
                          ? 'bg-trakend-accent text-white'
                          : 'text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light'
                      }`}
                    >
                      <div>Disk {drive.number}</div>
                      <div className="text-xs opacity-75">{drive.device}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Shares */}
              <div className="flex-1 overflow-y-auto p-3">
                <div className="text-xs uppercase tracking-wide text-trakend-text-secondary font-semibold mb-2">Shares</div>
                <div className="space-y-1">
                  {(selectedDrive !== null ? getDriveShares() : sharesList).map((share) => (
                    <button
                      key={share.id}
                      onClick={() => setSelectedShare(share.name)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors truncate ${
                        selectedShare === share.name
                          ? 'bg-trakend-accent text-white'
                          : 'text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light'
                      }`}
                    >
                      {share.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Add Share Button */}
              <div className="p-3 border-t border-trakend-border">
                <button
                  onClick={() => setShowNewShareDialog(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
                >
                  <Plus size={16} />
                  New Share
                </button>
              </div>
            </div>

            {/* Right: Share Details */}
            <div className="flex-1 overflow-y-auto p-4">
              {getSelectedShareDetails() ? (
                editingShare ? (
                  // Edit Mode
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-trakend-text-primary">{editingShare.name}</h2>
                      <button
                        onClick={() => {
                          setEditingShare(null)
                          setEditingForm(null)
                        }}
                        className="p-1 rounded hover:bg-trakend-surface-light"
                      >
                        <X size={20} className="text-trakend-text-secondary" />
                      </button>
                    </div>

                    <div>
                      <label className="text-xs text-trakend-text-secondary uppercase tracking-wide block mb-2">Path</label>
                      <input
                        type="text"
                        value={editingForm?.path || ''}
                        onChange={(e) => setEditingForm({ ...editingForm, path: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-trakend-text-secondary uppercase tracking-wide block mb-2">Comment</label>
                      <input
                        type="text"
                        value={editingForm?.comment || ''}
                        onChange={(e) => setEditingForm({ ...editingForm, comment: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm text-trakend-text-primary">
                        <input
                          type="checkbox"
                          checked={editingForm?.browseable !== false}
                          onChange={(e) => setEditingForm({ ...editingForm, browseable: e.target.checked })}
                          className="rounded"
                        />
                        Browseable
                      </label>
                      <label className="flex items-center gap-2 text-sm text-trakend-text-primary">
                        <input
                          type="checkbox"
                          checked={editingForm?.readOnly || false}
                          onChange={(e) => setEditingForm({ ...editingForm, readOnly: e.target.checked })}
                          className="rounded"
                        />
                        Read Only
                      </label>
                      <label className="flex items-center gap-2 text-sm text-trakend-text-primary">
                        <input
                          type="checkbox"
                          checked={editingForm?.guestOk || false}
                          onChange={(e) => setEditingForm({ ...editingForm, guestOk: e.target.checked })}
                          className="rounded"
                        />
                        Guest OK
                      </label>
                    </div>

                    <div className="flex gap-2 pt-4">
                      <button
                        onClick={handleUpdateShare}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
                      >
                        <Save size={16} />
                        Save
                      </button>
                      <button
                        onClick={() => handleDeleteShare(editingShare.name)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                      >
                        <Trash2 size={16} />
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-trakend-text-primary">{getSelectedShareDetails()?.name}</h2>
                      <button
                        onClick={() => setEditingShare(getSelectedShareDetails())}
                        className="p-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
                      >
                        <Edit2 size={18} />
                      </button>
                    </div>

                    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4 space-y-3">
                      <div>
                        <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Path</p>
                        <p className="text-sm font-mono text-trakend-text-primary">{getSelectedShareDetails()?.path}</p>
                      </div>

                      <div>
                        <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Comment</p>
                        <p className="text-sm text-trakend-text-primary">{getSelectedShareDetails()?.comment || '-'}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Browseable</p>
                          <p className="text-sm text-trakend-text-primary">
                            {getSelectedShareDetails()?.browseable ? 'Yes' : 'No'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Read Only</p>
                          <p className="text-sm text-trakend-text-primary">{getSelectedShareDetails()?.readOnly ? 'Yes' : 'No'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Guest OK</p>
                          <p className="text-sm text-trakend-text-primary">{getSelectedShareDetails()?.guestOk ? 'Yes' : 'No'}</p>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Valid Users</p>
                        <p className="text-sm text-trakend-text-primary">
                          {getSelectedShareDetails()?.validUsers.join(', ') || 'All'}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Writable Users</p>
                        <p className="text-sm text-trakend-text-primary">
                          {getSelectedShareDetails()?.writableUsers.join(', ') || 'None'}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center h-full text-trakend-text-secondary">
                  <p>Select a share to view details</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-trakend-text-primary">Share Users</h2>
              <button
                onClick={() => setShowNewUserDialog(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors text-sm"
              >
                <Plus size={16} />
                New User
              </button>
            </div>

            <div className="bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-trakend-border bg-trakend-dark">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Username</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Home Dir</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.map((user) => (
                    <tr key={user.id} className="border-b border-trakend-border hover:bg-trakend-dark transition-colors">
                      <td className="px-4 py-3 text-trakend-text-primary font-mono">{user.username}</td>
                      <td className="px-4 py-3 text-trakend-text-secondary text-xs">{user.homeDir}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            user.enabled
                              ? 'bg-trakend-success/20 text-trakend-success'
                              : 'bg-trakend-error/20 text-trakend-error'
                          }`}
                        >
                          {user.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => handleToggleUser(user.username, user.enabled)}
                          className="px-2 py-1 text-xs rounded bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors"
                        >
                          {user.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.username)}
                          className="px-2 py-1 text-xs rounded bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Connections Tab */}
        {activeTab === 'connections' && (
          <div className="flex-1 overflow-auto p-4">
            <h2 className="text-lg font-semibold text-trakend-text-primary mb-4">Active Connections</h2>

            {connections.length === 0 ? (
              <div className="text-center py-8 text-trakend-text-secondary">
                <p>No active connections</p>
              </div>
            ) : (
              <div className="bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-trakend-border bg-trakend-dark">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Username</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Machine</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Group</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Protocol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map((conn, i) => (
                      <tr key={i} className="border-b border-trakend-border hover:bg-trakend-dark transition-colors">
                        <td className="px-4 py-3 text-trakend-text-primary">{conn.username}</td>
                        <td className="px-4 py-3 text-trakend-text-secondary text-xs">{conn.machine}</td>
                        <td className="px-4 py-3 text-trakend-text-secondary text-xs">{conn.group}</td>
                        <td className="px-4 py-3 text-trakend-text-secondary text-xs">{conn.protocol}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New User Dialog */}
      {showNewUserDialog && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
          <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-trakend-text-primary mb-4">Create New User</h2>
            <input
              type="text"
              placeholder="Username"
              value={newUserForm.username}
              onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary mb-3 text-sm focus:outline-none focus:border-trakend-accent"
            />
            <input
              type="password"
              placeholder="Password"
              value={newUserForm.password}
              onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary mb-4 text-sm focus:outline-none focus:border-trakend-accent"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowNewUserDialog(false)}
                className="px-4 py-2 rounded-lg bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateUser}
                className="px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors text-sm"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Share Dialog */}
      {showNewShareDialog && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
          <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-trakend-text-primary mb-4">Create New Share</h2>

            <input
              type="text"
              placeholder="Share name"
              value={newShareForm.name}
              onChange={(e) => setNewShareForm({ ...newShareForm, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary mb-3 text-sm focus:outline-none focus:border-trakend-accent"
            />

            <input
              type="text"
              placeholder="Path (e.g., /mnt/disk0/myshare)"
              value={newShareForm.path}
              onChange={(e) => setNewShareForm({ ...newShareForm, path: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary mb-3 text-sm focus:outline-none focus:border-trakend-accent"
            />

            <input
              type="text"
              placeholder="Comment"
              value={newShareForm.comment}
              onChange={(e) => setNewShareForm({ ...newShareForm, comment: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary mb-3 text-sm focus:outline-none focus:border-trakend-accent"
            />

            <div className="space-y-2 mb-4">
              <label className="flex items-center gap-2 text-sm text-trakend-text-primary">
                <input
                  type="checkbox"
                  checked={newShareForm.browseable}
                  onChange={(e) => setNewShareForm({ ...newShareForm, browseable: e.target.checked })}
                  className="rounded"
                />
                Browseable
              </label>
              <label className="flex items-center gap-2 text-sm text-trakend-text-primary">
                <input
                  type="checkbox"
                  checked={newShareForm.readOnly}
                  onChange={(e) => setNewShareForm({ ...newShareForm, readOnly: e.target.checked })}
                  className="rounded"
                />
                Read Only
              </label>
              <label className="flex items-center gap-2 text-sm text-trakend-text-primary">
                <input
                  type="checkbox"
                  checked={newShareForm.guestOk}
                  onChange={(e) => setNewShareForm({ ...newShareForm, guestOk: e.target.checked })}
                  className="rounded"
                />
                Guest OK
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowNewShareDialog(false)}
                className="px-4 py-2 rounded-lg bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateShare}
                className="px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors text-sm"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
