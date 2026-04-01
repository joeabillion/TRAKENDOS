import React, { useState } from 'react'
import { X, Plus, Trash2, ChevronRight, ChevronLeft } from 'lucide-react'
import api from '../../utils/api'

interface ContainerCreateDialogProps {
  onClose: () => void
  onSuccess?: () => void
}

interface PortMapping {
  hostPort: number
  containerPort: number
  protocol: 'tcp' | 'udp'
}

interface EnvironmentVar {
  name: string
  value: string
}

interface VolumeMount {
  hostPath: string
  containerPath: string
}

interface CreateConfig {
  image: string
  imageTag: string
  containerName: string
  ports: PortMapping[]
  environment: EnvironmentVar[]
  volumes: VolumeMount[]
  restartPolicy: 'no' | 'always' | 'unless-stopped' | 'on-failure'
  cpuCores?: number
  memoryMb?: number
  network?: string
  privileged?: boolean
}

const STEPS = ['Image', 'Container Name', 'Ports', 'Environment', 'Volumes', 'Advanced', 'Review']

export const ContainerCreateDialog: React.FC<ContainerCreateDialogProps> = ({ onClose, onSuccess }) => {
  const [step, setStep] = useState(0)
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<CreateConfig>({
    image: '',
    imageTag: 'latest',
    containerName: '',
    ports: [],
    environment: [],
    volumes: [],
    restartPolicy: 'unless-stopped',
  })

  const handleCreate = async () => {
    if (!config.image || !config.containerName) {
      setError('Image and container name are required')
      return
    }

    setDeploying(true)
    setError(null)

    try {
      const containerConfig = {
        image: `${config.image}:${config.imageTag}`,
        name: config.containerName,
        ports: config.ports,
        environment: config.environment,
        volumes: config.volumes,
        restartPolicy: config.restartPolicy,
        ...(config.cpuCores && { cpuCores: config.cpuCores }),
        ...(config.memoryMb && { memoryMb: config.memoryMb }),
        ...(config.network && { network: config.network }),
        ...(config.privileged && { privileged: config.privileged }),
      }

      await api.post('/docker/containers/create', containerConfig)
      await api.post(`/docker/containers/${config.containerName}/start`)
      onSuccess?.()
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to create container')
    } finally {
      setDeploying(false)
    }
  }

  const nextStep = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    }
  }

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1)
    }
  }

  const canProceed = () => {
    switch (step) {
      case 0:
        return config.image.trim() !== ''
      case 1:
        return config.containerName.trim() !== ''
      default:
        return true
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-trakend-surface border border-trakend-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-trakend-dark border-b border-trakend-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-trakend-text-primary">Create Custom Container</h2>
            <p className="text-xs text-trakend-text-secondary">Step {step + 1} of {STEPS.length}</p>
          </div>
          <button
            onClick={onClose}
            disabled={deploying}
            className="p-1 hover:bg-trakend-surface rounded transition-colors disabled:opacity-50"
          >
            <X size={20} className="text-trakend-text-secondary" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="bg-trakend-dark border-b border-trakend-border px-4 py-3">
          <div className="flex gap-2 overflow-x-auto">
            {STEPS.map((stepName, i) => (
              <button
                key={i}
                onClick={() => {
                  if (i < step || (i === step && canProceed())) {
                    setStep(i)
                  }
                }}
                className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  i === step
                    ? 'bg-trakend-accent text-white'
                    : i < step
                    ? 'bg-trakend-success/20 text-trakend-success'
                    : 'bg-trakend-surface-light text-trakend-text-secondary'
                }`}
              >
                {stepName}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-6">
          {error && (
            <div className="mb-4 p-4 rounded-lg bg-trakend-error/10 border border-trakend-error text-trakend-error text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Image */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-2">Docker Image</label>
                <input
                  type="text"
                  placeholder="e.g., nginx, postgres, mysql"
                  value={config.image}
                  onChange={(e) => setConfig({ ...config, image: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
                />
                <p className="text-xs text-trakend-text-secondary mt-2">
                  Enter the image name (will be pulled from Docker Hub if not present locally)
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-2">Image Tag</label>
                <input
                  type="text"
                  placeholder="latest"
                  value={config.imageTag}
                  onChange={(e) => setConfig({ ...config, imageTag: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
                />
              </div>
            </div>
          )}

          {/* Step 2: Container Name */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-2">Container Name</label>
                <input
                  type="text"
                  placeholder="my-container"
                  value={config.containerName}
                  onChange={(e) => setConfig({ ...config, containerName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
                />
                <p className="text-xs text-trakend-text-secondary mt-2">
                  Must be unique and contain only alphanumeric characters, hyphens, and underscores
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Ports */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-trakend-text-primary">Port Mappings</h3>
                <button
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      ports: [...prev.ports, { hostPort: 8000, containerPort: 8000, protocol: 'tcp' }],
                    }))
                  }
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
                >
                  <Plus size={14} />
                  Add Port
                </button>
              </div>
              {config.ports.length === 0 ? (
                <p className="text-sm text-trakend-text-secondary py-8 text-center">No ports configured. Click "Add Port" to add one.</p>
              ) : (
                <div className="space-y-2">
                  {config.ports.map((port, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="text-xs text-trakend-text-secondary">Host Port</label>
                        <input
                          type="number"
                          value={port.hostPort}
                          onChange={(e) => {
                            const ports = [...config.ports]
                            ports[i].hostPort = parseInt(e.target.value)
                            setConfig({ ...config, ports })
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-trakend-text-secondary">Container Port</label>
                        <input
                          type="number"
                          value={port.containerPort}
                          onChange={(e) => {
                            const ports = [...config.ports]
                            ports[i].containerPort = parseInt(e.target.value)
                            setConfig({ ...config, ports })
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-trakend-text-secondary">Protocol</label>
                        <select
                          value={port.protocol}
                          onChange={(e) => {
                            const ports = [...config.ports]
                            ports[i].protocol = e.target.value as 'tcp' | 'udp'
                            setConfig({ ...config, ports })
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                        >
                          <option>tcp</option>
                          <option>udp</option>
                        </select>
                      </div>
                      <button
                        onClick={() => setConfig((prev) => ({ ...prev, ports: prev.ports.filter((_, idx) => idx !== i) }))}
                        className="p-2 rounded-lg bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Environment */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-trakend-text-primary">Environment Variables</h3>
                <button
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      environment: [...prev.environment, { name: '', value: '' }],
                    }))
                  }
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
                >
                  <Plus size={14} />
                  Add Variable
                </button>
              </div>
              {config.environment.length === 0 ? (
                <p className="text-sm text-trakend-text-secondary py-8 text-center">No variables configured. Click "Add Variable" to add one.</p>
              ) : (
                <div className="space-y-2">
                  {config.environment.map((env, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="text-xs text-trakend-text-secondary">Name</label>
                        <input
                          type="text"
                          value={env.name}
                          onChange={(e) => {
                            const environment = [...config.environment]
                            environment[i].name = e.target.value
                            setConfig({ ...config, environment })
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-trakend-text-secondary">Value</label>
                        <input
                          type="text"
                          value={env.value}
                          onChange={(e) => {
                            const environment = [...config.environment]
                            environment[i].value = e.target.value
                            setConfig({ ...config, environment })
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                        />
                      </div>
                      <button
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            environment: prev.environment.filter((_, idx) => idx !== i),
                          }))
                        }
                        className="p-2 rounded-lg bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 5: Volumes */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-trakend-text-primary">Volume Mounts</h3>
                <button
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      volumes: [...prev.volumes, { hostPath: '', containerPath: '' }],
                    }))
                  }
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
                >
                  <Plus size={14} />
                  Add Volume
                </button>
              </div>
              {config.volumes.length === 0 ? (
                <p className="text-sm text-trakend-text-secondary py-8 text-center">No volumes configured. Click "Add Volume" to add one.</p>
              ) : (
                <div className="space-y-2">
                  {config.volumes.map((vol, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="text-xs text-trakend-text-secondary">Host Path</label>
                        <input
                          type="text"
                          value={vol.hostPath}
                          onChange={(e) => {
                            const volumes = [...config.volumes]
                            volumes[i].hostPath = e.target.value
                            setConfig({ ...config, volumes })
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-trakend-text-secondary">Container Path</label>
                        <input
                          type="text"
                          value={vol.containerPath}
                          onChange={(e) => {
                            const volumes = [...config.volumes]
                            volumes[i].containerPath = e.target.value
                            setConfig({ ...config, volumes })
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                        />
                      </div>
                      <button
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            volumes: prev.volumes.filter((_, idx) => idx !== i),
                          }))
                        }
                        className="p-2 rounded-lg bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 6: Advanced */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-trakend-text-primary mb-2">CPU Cores (optional)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={config.cpuCores || ''}
                    onChange={(e) => setConfig({ ...config, cpuCores: e.target.value ? parseFloat(e.target.value) : undefined })}
                    className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-trakend-text-primary mb-2">Memory (MB, optional)</label>
                  <input
                    type="number"
                    value={config.memoryMb || ''}
                    onChange={(e) => setConfig({ ...config, memoryMb: e.target.value ? parseInt(e.target.value) : undefined })}
                    className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-2">Restart Policy</label>
                <select
                  value={config.restartPolicy}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      restartPolicy: e.target.value as 'no' | 'always' | 'unless-stopped' | 'on-failure',
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
                >
                  <option value="no">No</option>
                  <option value="always">Always</option>
                  <option value="unless-stopped">Unless Stopped</option>
                  <option value="on-failure">On Failure</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-2">Network (optional)</label>
                <input
                  type="text"
                  placeholder="bridge, host, or custom network name"
                  value={config.network || ''}
                  onChange={(e) => setConfig({ ...config, network: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.privileged || false}
                  onChange={(e) => setConfig({ ...config, privileged: e.target.checked })}
                  className="rounded accent-trakend-accent"
                />
                <span className="text-sm text-trakend-text-primary">Run in privileged mode</span>
              </label>
            </div>
          )}

          {/* Step 7: Review */}
          {step === 6 && (
            <div className="space-y-4">
              <div className="bg-trakend-dark rounded-lg p-4 border border-trakend-border">
                <h3 className="text-sm font-medium text-trakend-text-primary mb-3">Configuration Summary</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-trakend-text-secondary">Image: </span>
                    <span className="text-trakend-text-primary font-mono">{config.image}:{config.imageTag}</span>
                  </div>
                  <div>
                    <span className="text-trakend-text-secondary">Container Name: </span>
                    <span className="text-trakend-text-primary font-mono">{config.containerName}</span>
                  </div>
                  {config.ports.length > 0 && (
                    <div>
                      <span className="text-trakend-text-secondary">Ports: </span>
                      <span className="text-trakend-text-primary">
                        {config.ports.map((p) => `${p.hostPort}:${p.containerPort}/${p.protocol}`).join(', ')}
                      </span>
                    </div>
                  )}
                  {config.environment.length > 0 && (
                    <div>
                      <span className="text-trakend-text-secondary">Environment Variables: </span>
                      <span className="text-trakend-text-primary">{config.environment.length} variables</span>
                    </div>
                  )}
                  {config.volumes.length > 0 && (
                    <div>
                      <span className="text-trakend-text-secondary">Volume Mounts: </span>
                      <span className="text-trakend-text-primary">{config.volumes.length} volumes</span>
                    </div>
                  )}
                  <div>
                    <span className="text-trakend-text-secondary">Restart Policy: </span>
                    <span className="text-trakend-text-primary">{config.restartPolicy}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-trakend-dark border-t border-trakend-border p-4 flex gap-3 justify-between">
          <button
            onClick={onClose}
            disabled={deploying}
            className="px-4 py-2 rounded-lg bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex gap-3">
            <button
              onClick={prevStep}
              disabled={step === 0 || deploying}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors disabled:opacity-50"
            >
              <ChevronLeft size={16} />
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={nextStep}
                disabled={!canProceed() || deploying}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors disabled:opacity-50"
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={!canProceed() || deploying}
                className="px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deploying ? (
                  <>
                    <div className="animate-spin">⚙️</div>
                    Creating...
                  </>
                ) : (
                  'Create & Start'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
