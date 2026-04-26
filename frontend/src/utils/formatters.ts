export const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes == null || isNaN(bytes)) return '0 B'
  if (bytes === 0) return '0 B'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

export const formatBytesShort = (bytes: number): string => {
  if (bytes == null || isNaN(bytes)) return '0'
  if (bytes === 0) return '0'

  const k = 1024
  const sizes = ['', 'K', 'M', 'G', 'T']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i]
}

export const formatSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond == null || isNaN(bytesPerSecond)) return '0 B/s'
  if (bytesPerSecond === 0) return '0 B/s'

  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))

  return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const formatPercentage = (value: number, decimals = 1): string => {
  if (value == null || isNaN(value)) return '0%'
  return parseFloat(value.toFixed(decimals)) + '%'
}

export const formatTemperature = (celsius: number): string => {
  if (celsius == null || isNaN(celsius)) return '--°F'
  return Math.round(celsius * 9 / 5 + 32) + '°F'
}

export const formatUptime = (seconds: number): string => {
  if (seconds == null || isNaN(seconds)) return '0m'
  const days = Math.floor(seconds / (3600 * 24))
  const hours = Math.floor((seconds % (3600 * 24)) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)

  return parts.join(' ') || '0m'
}

export const formatDuration = (ms: number): string => {
  if (ms == null || isNaN(ms) || ms <= 0) return '0s'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours % 24 > 0) parts.push(`${hours % 24}h`)
  if (minutes % 60 > 0) parts.push(`${minutes % 60}m`)
  if (seconds % 60 > 0 && days === 0) parts.push(`${seconds % 60}s`)

  return parts.join(' ') || '0s'
}

export const formatDateTime = (date: Date | string): string => {
  const d = new Date(date)
  return d.toLocaleString()
}

export const formatTime = (date: Date | string): string => {
  const d = new Date(date)
  return d.toLocaleTimeString()
}

export const formatDate = (date: Date | string): string => {
  const d = new Date(date)
  return d.toLocaleDateString()
}

export const formatRelativeTime = (date: Date | string): string => {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`

  return formatDate(d)
}

export const formatCpuModel = (model: string): string => {
  return model
    .replace(/\(R\)/g, '®')
    .replace(/\(TM\)/g, '™')
    .replace(/Intel\(R\) Core\(TM\) /g, '')
    .replace(/AMD Ryzen /g, '')
    .trim()
}

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max)
}

export const lerp = (a: number, b: number, t: number): number => {
  return a + (b - a) * t
}

export const getHealthColor = (health: string): string => {
  switch (health.toLowerCase()) {
    case 'good':
      return '#00d4aa'
    case 'warning':
      return '#ffa502'
    case 'critical':
      return '#ff3860'
    default:
      return '#a0a0a0'
  }
}

export const getStatusColor = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'running':
    case 'up':
    case 'online':
      return '#00d4aa'
    case 'paused':
      return '#ffa502'
    case 'stopped':
    case 'down':
    case 'offline':
      return '#ff3860'
    default:
      return '#a0a0a0'
  }
}
