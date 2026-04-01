import React, { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { AppTemplate } from './AppStore'
import api from '../../utils/api'

interface AppDeployDialogProps {
  app: AppTemplate
  onClose: () => void
  onDeploy: (containerName: string, config: any) => Promise<void>
}

interface DeployConfig {
  containerName: string
  ports: Array<{ hostPort: number; containerPort: number; protocol: string }>
  environment: Array<{ name: string; value: string }>
  volumes: Array<{ hostPath: string; containerPath: string }>
  resources?: { cpuCores?: number; memoryMb?: number }
  restartPolicy: 'no' | 'always' | 'unless-stopped' | 'on-failure'
}

export const AppDeployDialog: React.FC<AppDeployDialogProps> = ({ app, onClose, onDeploy }) => {
  const [config, setConfig] = useState<DeployConfig>({
    containerName: app.name.toLowerCase().replace(/\s+/g, '-'),
    ports: app.ports || [],
    environment: (app.environment || []).map((env) => ({ name: env.name, value: env.value || '' })),
    volumes: (app.volumes || []).map((vol) => ({ hostPath: vol.hostPath || '', containerPath: vol.containerPath })),
    resources: app.resources,
    restartPolicy: app.restartPolicy,
  })
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDeploy = async () => {
    if (!config.containerName.trim()) {
      setError('Container name is required')
      return
    }

    setDeploying(true)
    setError(null)

    try {
      const containerConfig = {
        image: app.image,
        name: config.containerName,
        ports: config.ports,
        environment: config.environment,
        volumes: config.volumes,
        restartPolicy: config.restartPolicy,
        ...config.resources,
      }

      await api.post('/docker/containers/create', containerConfig)
      await api.post(`/docker/containers/${config.containerName}/start`)
      await onDeploy(config.containerName, containerConfig)
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to deploy container')
    } finally {
      setDeploying(false)
    }
  }

  const addPort = () => {
    setConfig((prev) => ({
      ...prev,
      ports: [...prev.ports, { hostPort: 8000, containerPort: 8000, protocol: 'tcp' }],
    }))
  }

  const removePort = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      ports: prev.ports.filter((_, i) => i !== index),
    }))
  }

  const updatePort = (index: number, field: string, value: any) => {
    setConfig((prev) => ({
      ...prev,
      ports: prev.ports.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    }))
  }

  const addEnvironment = () => {
    setConfig((prev) => ({
      ...prev,
      environment: [...prev.environment, { name: '', value: '' }],
    }))
  }

  const removeEnvironment = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      environment: prev.environment.filter((_, i) => i !== index),
    }))
  }

  const updateEnvironment = (index: number, field: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      environment: prev.environment.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    }))
  }

  const addVolume = () => {
    setConfig((prev) => ({
      ...prev,
      volumes: [...prev.volumes, { hostPath: '', containerPath: '' }],
    }))
  }

  const removeVolume = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      volumes: prev.volumes.filter((_, i) => i !== index),
    }))
  }

  const updateVolume = (index: number, field: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      volumes: prev.volumes.map((v, i) => (i === index ? { ...v, [field]: value } : v)),
    }))
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-trakend-surface border border-trakend-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-trakend-dark border-b border-trakend-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{app.icon}</span>
            <div>
              <h2 className="text-lg font-semibold text-trakend-text-primary">{app.name}</h2>
              <p className="text-xs text-trakend-text-secondary">{app.image}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={deploying}
            className="p-1 hover:bg-trakend-surface rounded transition-colors disabled:opacity-50"
          >
            <X size={20} className="text-trakend-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="p-4 rounded-lg bg-trakend-error/10 border border-trakend-error text-trakend-error text-sm">
              {error}
            </div>
          )}

          {/* Container Name */}
          <div>
            <label className="block text-sm font-medium text-trakend-text-primary mb-2">Container Name</label>
            <input
              type="text"
              value={config.containerName}
              onChange={(e) => setConfig((prev) => ({ ...prev, containerName: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
            />
          </div>

          {/* Port Mappings */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-trakend-text-primary">Port Mappings</label>
              <button
                onClick={addPort}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
              >
                <Plus size={14} />
                Add Port
              </button>
            </div>
            <div className="space-y-2">
              {config.ports.map((port, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-trakend-text-secondary">Host Port</label>
                    <input
                      type="number"
                      value={port.hostPort}
                      onChange={(e) => updatePort(i, 'hostPort', parseInt(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-trakend-text-secondary">Container Port</label>
                    <input
                      type="number"
                      value={port.containerPort}
                      onChange={(e) => updatePort(i, 'containerPort', parseInt(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-trakend-text-secondary">Protocol</label>
                    <select
                      value={port.protocol}
                      onChange={(e) => updatePort(i, 'protocol', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    >
                      <option>tcp</option>
                      <option>udp</option>
                    </select>
                  </div>
                  <button
                    onClick={() => removePort(i)}
                    className="p-2 rounded-lg bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Environment Variables */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-trakend-text-primary">Environment Variables</label>
              <button
                onClick={addEnvironment}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
              >
                <Plus size={14} />
                Add Variable
              </button>
            </div>
            <div className="space-y-2">
              {config.environment.map((env, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-trakend-text-secondary">Name</label>
                    <input
                      type="text"
                      value={env.name}
                      onChange={(e) => updateEnvironment(i, 'name', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-trakend-text-secondary">Value</label>
                    <input
                      type="text"
                      value={env.value}
                      onChange={(e) => updateEnvironment(i, 'value', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    />
                  </div>
                  <button
                    onClick={() => removeEnvironment(i)}
                    className="p-2 rounded-lg bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Volumes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-trakend-text-primary">Volume Mounts</label>
              <button
                onClick={addVolume}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
              >
                <Plus size={14} />
                Add Volume
              </button>
            </div>
            <div className="space-y-2">
              {config.volumes.map((vol, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-trakend-text-secondary">Host Path</label>
                    <input
                      type="text"
                      value={vol.hostPath}
                      onChange={(e) => updateVolume(i, 'hostPath', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-trakend-text-secondary">Container Path</label>
                    <input
                      type="text"
                      value={vol.containerPath}
                      onChange={(e) => updateVolume(i, 'containerPath', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    />
                  </div>
                  <button
                    onClick={() => removeVolume(i)}
                    className="p-2 rounded-lg bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Resources */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-trakend-text-primary mb-2">CPU Cores (optional)</label>
              <input
                type="number"
                step="0.5"
                value={config.resources?.cpuCores || ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    resources: { ...prev.resources, cpuCores: e.target.value ? parseFloat(e.target.value) : undefined },
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-trakend-text-primary mb-2">Memory (MB, optional)</label>
              <input
                type="number"
                value={config.resources?.memoryMb || ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    resources: { ...prev.resources, memoryMb: e.target.value ? parseInt(e.target.value) : undefined },
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
              />
            </div>
          </div>

          {/* Restart Policy */}
          <div>
            <label className="block text-sm font-medium text-trakend-text-primary mb-2">Restart Policy</label>
            <select
              value={config.restartPolicy}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  restartPolicy: e.target.value as any,
                }))
              }
              className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
            >
              <option value="no">No</option>
              <option value="always">Always</option>
              <option value="unless-stopped">Unless Stopped</option>
              <option value="on-failure">On Failure</option>
            </select>
          </div>

          {/* Description */}
          <div className="bg-trakend-dark rounded-lg p-4 border border-trakend-border">
            <h4 className="text-sm font-medium text-trakend-text-primary mb-2">About</h4>
            <p className="text-sm text-trakend-text-secondary">{app.description}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-trakend-dark border-t border-trakend-border p-4 flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={deploying}
            className="px-4 py-2 rounded-lg bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className="px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {deploying ? (
              <>
                <div className="animate-spin">⚙️</div>
                Deploying...
              </>
            ) : (
              'Deploy'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
