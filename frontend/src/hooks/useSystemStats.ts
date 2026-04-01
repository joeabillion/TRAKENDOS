import { useEffect, useState } from 'react'
import { useWebSocket, SystemStats } from '../context/WebSocketContext'

export const useSystemStats = () => {
  const { systemStats } = useWebSocket()
  const [stats, setStats] = useState<SystemStats | null>(systemStats)

  useEffect(() => {
    setStats(systemStats)
  }, [systemStats])

  return stats
}
