import React, { useEffect, useState } from 'react'
import { Plus, Refresh } from 'lucide-react'
import { useDocker, Container } from '../../hooks/useDocker'
import { ContainerCard } from './ContainerCard'
import { AppStore } from './AppStore'
import { ContainerCreateDialog } from './ContainerCreateDialog'

type TabType = 'containers' | 'appstore' | 'images' | 'networks' | 'volumes'

export const DockerPage: React.FC = () => {
  const { loading, error, getContainers, startContainer, stopContainer, restartContainer, removeContainer } =
    useDocker()
  const [containers, setContainers] = useState<Container[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('containers')
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const loadContainers = async () => {
    setRefreshing(true)
    const data = await getContainers()
    setContainers(data)
    setRefreshing(false)
  }

  useEffect(() => {
    loadContainers()
  }, [])

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

  const handleLogs = (id: string) => {
    // TODO: Open logs modal
    console.log('Logs for:', id)
  }

  const handleShell = (id: string) => {
    // TODO: Open shell modal
    console.log('Shell for:', id)
  }

  const handleSettings = (id: string) => {
    // TODO: Open settings modal
    console.log('Settings for:', id)
  }

  const runningCount = containers.filter((c) => c.status === 'running').length
  const stoppedCount = containers.filter((c) => c.status !== 'running').length

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
                <Refresh size={18} className={refreshing ? 'animate-spin' : ''} />
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
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="text-6xl mb-4">📦</div>
              <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">Images</h2>
              <p className="text-trakend-text-secondary">Image management coming soon</p>
            </div>
          </div>
        )}

        {activeTab === 'networks' && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="text-6xl mb-4">🌐</div>
              <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">Networks</h2>
              <p className="text-trakend-text-secondary">Network management coming soon</p>
            </div>
          </div>
        )}

        {activeTab === 'volumes' && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="text-6xl mb-4">💾</div>
              <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">Volumes</h2>
              <p className="text-trakend-text-secondary">Volume management coming soon</p>
            </div>
          </div>
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
    </div>
  )
}
