import React, { useEffect, useState } from 'react'
import { Plus, RefreshCw, Trash2, HardDrive, Download, UploadCloud } from 'lucide-react'
import {
  useDocker,
  Container,
  DockerImage,
  DockerNetwork,
  DockerVolume,
  DockerSettings,
} from '../../hooks/useDocker'
import { ContainerCard } from './ContainerCard'
import { AppStore } from './AppStore'
import { ContainerCreateDialog } from './ContainerCreateDialog'
import { ContainerShellModal } from './ContainerShellModal'
import { ContainerSettingsModal } from './ContainerSettingsModal'

type TabType = 'containers' | 'appstore' | 'images' | 'networks' | 'volumes' | 'settings'

export const DockerPage: React.FC = () => {
  const {
    loading,
    error,
    getContainers,
    startContainer,
    stopContainer,
    restartContainer,
    removeContainer,
    getLogs,
    getSettings,
    getImages,
    removeImage,
    getNetworks,
    getVolumes,
    removeVolume,
    fullBackup,
    fullRestore,
    pruneSystem,
    forceRemoveContainer,
    migrateStorage,
  } = useDocker()
  const [containers, setContainers] = useState<Container[]>([])
  const [images, setImages] = useState<DockerImage[]>([])
  const [networks, setNetworks] = useState<DockerNetwork[]>([])
  const [volumes, setVolumes] = useState<DockerVolume[]>([])
  const [settings, setSettings] = useState<DockerSettings | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('containers')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [logsModal, setLogsModal] = useState<{ id: string; logs: string } | null>(null)
  const [logsError, setLogsError] = useState<string>('')
  const [backupProgress, setBackupProgress] = useState<string>('')
  const [migrationProgress, setMigrationProgress] = useState<string>('')
  const [newDataRoot, setNewDataRoot] = useState<string>('')
  const [shellModal, setShellModal] = useState<{ id: string; name: string } | null>(null)
  const [settingsModal, setSettingsModal] = useState<{ id: string; name: string } | null>(null)

  const loadContainers = async () => {
    setRefreshing(true)
    const data = await getContainers()
    setContainers(data)
    setRefreshing(false)
  }

  useEffect(() => {
    loadContainers()
  }, [])

  useEffect(() => {
    if (activeTab === 'images') loadImages()
    if (activeTab === 'networks') loadNetworks()
    if (activeTab === 'volumes') loadVolumes()
    if (activeTab === 'settings') loadSettings()
  }, [activeTab])

  const handleStart = async (id: string) => {
    await startContainer(id)
    await loadContainers()
  }

  const handleStop = async (id: string) => {
    await stopContainer(id)
    await loadContainers()
  }

  const handleRestart = async (id: string) => {
    await restartContainer(id)
    await loadContainers()
  }

  const handleRemove = async (id: string) => {
    await removeContainer(id)
    await loadContainers()
  }

  const handleShell = (id: string) => {
    const container = containers.find(c => c.id === id)
    if (container && container.state !== 'running') {
      alert('Container must be running to open a shell')
      return
    }
    setShellModal({ id, name: container?.name || id })
  }

  const handleSettings = (id: string) => {
    const container = containers.find(c => c.id === id)
    setSettingsModal({ id, name: container?.name || id })
  }

  const handleLogs = async (id: string) => {
    try {
      const logs = await getLogs(id, 500)
      setLogsModal({ id, logs })
      setLogsError('')
    } catch (err) {
      console.error('Failed to fetch logs:', err)
      setLogsError('Failed to fetch container logs')
    }
  }

  const loadImages = async () => {
    setRefreshing(true)
    const data = await getImages()
    setImages(data)
    setRefreshing(false)
  }

  const loadNetworks = async () => {
    setRefreshing(true)
    const data = await getNetworks()
    setNetworks(data)
    setRefreshing(false)
  }

  const loadVolumes = async () => {
    setRefreshing(true)
    const data = await getVolumes()
    setVolumes(data)
    setRefreshing(false)
  }

  const loadSettings = async () => {
    setRefreshing(true)
    const data = await getSettings()
    if (data) {
      setSettings(data)
      setNewDataRoot(data.dataRoot)
    }
    setRefreshing(false)
  }

  const handleDeleteImage = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this image?')) return
    if (await removeImage(id, true)) {
      await loadImages()
    }
  }

  const handleDeleteVolume = async (name: string) => {
    if (!window.confirm('Are you sure you want to delete this volume?')) return
    if (await removeVolume(name)) {
      await loadVolumes()
    }
  }

  const handleBackup = async () => {
    setBackupProgress('Starting backup...')
    const result = await fullBackup('/data/backups/docker/', (msg) => {
      setBackupProgress(msg)
    })
    if (result) {
      setBackupProgress('Backup completed successfully!')
      setTimeout(() => setBackupProgress(''), 5000)
    }
  }

  const handlePrune = async () => {
    if (!window.confirm('This will remove all unused containers, images, and volumes. Continue?')) return
    setRefreshing(true)
    await pruneSystem()
    setRefreshing(false)
    await loadImages()
    await loadVolumes()
  }

  const handleMigrateStorage = async () => {
    if (!newDataRoot || newDataRoot === settings?.dataRoot) {
      alert('Please enter a different path')
      return
    }
    if (!window.confirm(`Migrate Docker storage to ${newDataRoot}? This will stop all containers.`)) return

    setMigrationProgress('Starting migration...')
    await migrateStorage(newDataRoot)
    setMigrationProgress('Migration completed successfully!')
    setTimeout(() => setMigrationProgress(''), 5000)
  }

  const runningCount = containers.filter((c) => c.state === 'running').length
  const stoppedCount = containers.filter((c) => c.state !== 'running').length

  return (
    <div className="flex-1 overflow-y-auto bg-trakend-dark flex flex-col">
      <div className="p-8 flex-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-trakend-text-primary mb-2">Docker</h1>
            {activeTab === 'containers' && (
              <p className="text-trakend-text-secondary">
                {runningCount} running • {stoppedCount} stopped • {containers.length} total
              </p>
            )}
          </div>
          <div className="flex gap-3">
            {activeTab === 'containers' && (
              <button
                onClick={loadContainers}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-surface border border-trakend-border text-trakend-text-secondary hover:text-trakend-text-primary hover:border-trakend-accent transition-colors disabled:opacity-50"
              >
                <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                Refresh
              </button>
            )}
            {activeTab === 'containers' && (
              <button
                onClick={() => setShowCreateDialog(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
              >
                <Plus size={18} />
                New Container
              </button>
            )}
            {activeTab === 'appstore' && (
              <button
                onClick={() => setShowCreateDialog(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
              >
                <Plus size={18} />
                Custom Container
              </button>
            )}
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-6 mb-8 border-b border-trakend-border pb-4">
          <button
            onClick={() => setActiveTab('containers')}
            className={`text-sm font-medium pb-2 -mb-4 border-b-2 transition-colors ${
              activeTab === 'containers'
                ? 'text-trakend-accent border-trakend-accent'
                : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
            }`}
          >
            Containers
          </button>
          <button
            onClick={() => setActiveTab('appstore')}
            className={`text-sm font-medium pb-2 -mb-4 border-b-2 transition-colors ${
              activeTab === 'appstore'
                ? 'text-trakend-accent border-trakend-accent'
                : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
            }`}
          >
            App Store
          </button>
          <button
            onClick={() => setActiveTab('images')}
            className={`text-sm font-medium pb-2 -mb-4 border-b-2 transition-colors ${
              activeTab === 'images'
                ? 'text-trakend-accent border-trakend-accent'
                : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
            }`}
          >
            Images
          </button>
          <button
            onClick={() => setActiveTab('networks')}
            className={`text-sm font-medium pb-2 -mb-4 border-b-2 transition-colors ${
              activeTab === 'networks'
                ? 'text-trakend-accent border-trakend-accent'
                : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
            }`}
          >
            Networks
          </button>
          <button
            onClick={() => setActiveTab('volumes')}
            className={`text-sm font-medium pb-2 -mb-4 border-b-2 transition-colors ${
              activeTab === 'volumes'
                ? 'text-trakend-accent border-trakend-accent'
                : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
            }`}
          >
            Volumes
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`text-sm font-medium pb-2 -mb-4 border-b-2 transition-colors ${
              activeTab === 'settings'
                ? 'text-trakend-accent border-trakend-accent'
                : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
            }`}
          >
            Settings
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-trakend-error/10 border border-trakend-error rounded-lg text-trakend-error text-sm">
            {error}
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'containers' && (
          <>
            {/* Loading */}
            {loading && containers.length === 0 && (
              <div className="flex items-center justify-center h-64">
                <div className="text-trakend-text-secondary">
                  <div className="animate-spin text-4xl mb-2">⚙️</div>
                  Loading containers...
                </div>
              </div>
            )}

            {/* Containers Grid */}
            {!loading && containers.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {containers.map((container) => (
                  <ContainerCard
                    key={container.id}
                    container={container}
                    onStart={handleStart}
                    onStop={handleStop}
                    onRestart={handleRestart}
                    onRemove={handleRemove}
                    onLogs={handleLogs}
                    onShell={handleShell}
                    onSettings={handleSettings}
                  />
                ))}
              </div>
            )}

            {/* Empty State */}
            {!loading && containers.length === 0 && (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="text-6xl mb-4">🐳</div>
                  <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">No Containers</h2>
                  <p className="text-trakend-text-secondary mb-6">Get started by creating a new container or deploying an app</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => setShowCreateDialog(true)}
                      className="px-6 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
                    >
                      Create Container
                    </button>
                    <button
                      onClick={() => setActiveTab('appstore')}
                      className="px-6 py-2 rounded-lg bg-trakend-surface border border-trakend-border text-trakend-text-secondary hover:text-trakend-text-primary transition-colors"
                    >
                      Browse App Store
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'appstore' && (
          <AppStore onDeployApp={() => loadContainers()} />
        )}

        {activeTab === 'images' && (
          <>
            {loading && images.length === 0 && (
              <div className="flex items-center justify-center h-64">
                <div className="text-trakend-text-secondary">
                  <div className="animate-spin text-4xl mb-2">📦</div>
                  Loading images...
                </div>
              </div>
            )}

            {!loading && images.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-trakend-border">
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Repository</th>
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Tag</th>
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Size</th>
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Created</th>
                      <th className="text-right py-3 px-4 text-trakend-text-secondary font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {images.map((image) => (
                      <tr key={image.id} className="border-b border-trakend-border hover:bg-trakend-surface/50 transition">
                        <td className="py-3 px-4 text-trakend-text-primary">
                          {image.repoTags?.[0]?.split(':')?.[0] || 'unknown'}
                        </td>
                        <td className="py-3 px-4 text-trakend-text-secondary">
                          {image.repoTags?.[0]?.split(':')?.[1] || 'latest'}
                        </td>
                        <td className="py-3 px-4 text-trakend-text-secondary">
                          {(image.size / 1024 / 1024).toFixed(2)} MB
                        </td>
                        <td className="py-3 px-4 text-trakend-text-secondary">
                          {new Date(image.created).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteImage(image.id)}
                            className="text-trakend-error hover:text-trakend-error/80 transition"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && images.length === 0 && (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="text-6xl mb-4">📦</div>
                  <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">No Images</h2>
                  <p className="text-trakend-text-secondary">Pull or build your first Docker image</p>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'networks' && (
          <>
            {loading && networks.length === 0 && (
              <div className="flex items-center justify-center h-64">
                <div className="text-trakend-text-secondary">
                  <div className="animate-spin text-4xl mb-2">🌐</div>
                  Loading networks...
                </div>
              </div>
            )}

            {!loading && networks.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-trakend-border">
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Name</th>
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Driver</th>
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Scope</th>
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Containers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {networks.map((network) => (
                      <tr
                        key={network.id}
                        className="border-b border-trakend-border hover:bg-trakend-surface/50 transition"
                      >
                        <td className="py-3 px-4 text-trakend-text-primary">{network.name}</td>
                        <td className="py-3 px-4 text-trakend-text-secondary">{network.driver}</td>
                        <td className="py-3 px-4 text-trakend-text-secondary">{network.scope}</td>
                        <td className="py-3 px-4 text-trakend-text-secondary">
                          {Object.keys(network.containers || {}).length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && networks.length === 0 && (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="text-6xl mb-4">🌐</div>
                  <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">No Networks</h2>
                  <p className="text-trakend-text-secondary">Create custom networks for your containers</p>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'volumes' && (
          <>
            {loading && volumes.length === 0 && (
              <div className="flex items-center justify-center h-64">
                <div className="text-trakend-text-secondary">
                  <div className="animate-spin text-4xl mb-2">💾</div>
                  Loading volumes...
                </div>
              </div>
            )}

            {!loading && volumes.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-trakend-border">
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Name</th>
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Driver</th>
                      <th className="text-left py-3 px-4 text-trakend-text-secondary font-medium">Mount Point</th>
                      <th className="text-right py-3 px-4 text-trakend-text-secondary font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {volumes.map((volume) => (
                      <tr
                        key={volume.name}
                        className="border-b border-trakend-border hover:bg-trakend-surface/50 transition"
                      >
                        <td className="py-3 px-4 text-trakend-text-primary">{volume.name}</td>
                        <td className="py-3 px-4 text-trakend-text-secondary">{volume.driver}</td>
                        <td className="py-3 px-4 text-trakend-text-secondary font-mono text-xs">{volume.mountpoint}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteVolume(volume.name)}
                            className="text-trakend-error hover:text-trakend-error/80 transition"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && volumes.length === 0 && (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="text-6xl mb-4">💾</div>
                  <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">No Volumes</h2>
                  <p className="text-trakend-text-secondary">Create volumes to persist container data</p>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'settings' && (
          <>
            {loading && !settings && (
              <div className="flex items-center justify-center h-64">
                <div className="text-trakend-text-secondary">
                  <div className="animate-spin text-4xl mb-2">⚙️</div>
                  Loading settings...
                </div>
              </div>
            )}

            {!loading && settings && (
              <div className="space-y-6 max-w-2xl">
                {/* Storage Section */}
                <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-trakend-text-primary mb-4 flex items-center gap-2">
                    <HardDrive size={20} />
                    Storage Management
                  </h3>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-trakend-text-secondary mb-2">Current Data Root</label>
                      <div className="font-mono text-sm bg-trakend-dark p-3 rounded border border-trakend-border text-trakend-text-primary">
                        {settings.dataRoot}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm text-trakend-text-secondary mb-2">Storage Usage</label>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-trakend-dark p-3 rounded border border-trakend-border">
                          <div className="text-xs text-trakend-text-secondary">Images</div>
                          <div className="text-lg font-semibold text-trakend-text-primary">
                            {(settings.storageUsage.imagesSize / 1024 / 1024).toFixed(2)} MB
                          </div>
                        </div>
                        <div className="bg-trakend-dark p-3 rounded border border-trakend-border">
                          <div className="text-xs text-trakend-text-secondary">Containers</div>
                          <div className="text-lg font-semibold text-trakend-text-primary">
                            {(settings.storageUsage.containersSize / 1024 / 1024).toFixed(2)} MB
                          </div>
                        </div>
                        <div className="bg-trakend-dark p-3 rounded border border-trakend-border">
                          <div className="text-xs text-trakend-text-secondary">Volumes</div>
                          <div className="text-lg font-semibold text-trakend-text-primary">
                            {(settings.storageUsage.volumesSize / 1024 / 1024).toFixed(2)} MB
                          </div>
                        </div>
                        <div className="bg-trakend-dark p-3 rounded border border-trakend-border">
                          <div className="text-xs text-trakend-text-secondary">Build Cache</div>
                          <div className="text-lg font-semibold text-trakend-text-primary">
                            {(settings.storageUsage.buildCacheSize / 1024 / 1024).toFixed(2)} MB
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm text-trakend-text-secondary mb-2">New Data Root Path</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newDataRoot}
                          onChange={(e) => setNewDataRoot(e.target.value)}
                          className="flex-1 bg-trakend-dark border border-trakend-border rounded px-3 py-2 text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                          placeholder="/mnt/docker-storage"
                        />
                        <button
                          onClick={handleMigrateStorage}
                          disabled={refreshing}
                          className="px-4 py-2 bg-trakend-warning text-white rounded hover:bg-opacity-90 transition-colors disabled:opacity-50"
                        >
                          Migrate
                        </button>
                      </div>
                      {migrationProgress && <div className="text-xs text-trakend-text-secondary mt-2">{migrationProgress}</div>}
                    </div>
                  </div>
                </div>

                {/* Backup Section */}
                <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-trakend-text-primary mb-4 flex items-center gap-2">
                    <Download size={20} />
                    Backup & Restore
                  </h3>

                  <div className="space-y-3">
                    <button
                      onClick={handleBackup}
                      disabled={refreshing}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-trakend-success text-white rounded hover:bg-opacity-90 transition-colors disabled:opacity-50"
                    >
                      <Download size={18} />
                      Full Backup
                    </button>
                    <button
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-trakend-accent text-white rounded hover:bg-opacity-90 transition-colors disabled:opacity-50"
                    >
                      <UploadCloud size={18} />
                      Restore from Backup
                    </button>
                    {backupProgress && <div className="text-xs text-trakend-text-secondary">{backupProgress}</div>}
                  </div>
                </div>

                {/* Maintenance Section */}
                <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-trakend-text-primary mb-4 flex items-center gap-2">
                    <Trash2 size={20} />
                    Maintenance
                  </h3>

                  <button
                    onClick={handlePrune}
                    disabled={refreshing}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-trakend-error text-white rounded hover:bg-opacity-90 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={18} />
                    System Prune (Remove unused items)
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Container Dialog */}
      {showCreateDialog && (
        <ContainerCreateDialog
          onClose={() => setShowCreateDialog(false)}
          onSuccess={() => {
            setShowCreateDialog(false)
            loadContainers()
          }}
        />
      )}

      {/* Logs Modal */}
      {logsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-trakend-surface border border-trakend-border rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-trakend-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-trakend-text-primary">Container Logs</h2>
              <button
                onClick={() => { setLogsModal(null); setLogsError('') }}
                className="text-trakend-text-secondary hover:text-trakend-text-primary text-2xl"
              >
                ×
              </button>
            </div>
            {logsError && (
              <div className="p-4 bg-trakend-error/10 border-b border-trakend-error text-trakend-error text-sm flex items-center gap-2">
                <span>Error: {logsError}</span>
              </div>
            )}
            <div className="flex-1 overflow-auto p-4 bg-trakend-dark">
              <pre className="font-mono text-xs text-trakend-text-secondary whitespace-pre-wrap break-words">
                {logsModal.logs || '(no logs)'}
              </pre>
            </div>
            <div className="p-4 border-t border-trakend-border flex gap-2 justify-end">
              <button
                onClick={() => {
                  // Reload logs
                  handleLogs(logsModal.id)
                }}
                className="px-4 py-2 bg-trakend-surface border border-trakend-border text-trakend-text-secondary hover:text-trakend-text-primary rounded transition-colors"
              >
                Refresh
              </button>
              <button
                onClick={() => { setLogsModal(null); setLogsError('') }}
                className="px-4 py-2 bg-trakend-accent text-white rounded hover:bg-opacity-90 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shell Modal */}
      {shellModal && (
        <ContainerShellModal
          containerId={shellModal.id}
          containerName={shellModal.name}
          onClose={() => setShellModal(null)}
        />
      )}

      {/* Settings Modal */}
      {settingsModal && (
        <ContainerSettingsModal
          containerId={settingsModal.id}
          containerName={settingsModal.name}
          onClose={() => setSettingsModal(null)}
          onRefresh={loadContainers}
        />
      )}
    </div>
  )
}
