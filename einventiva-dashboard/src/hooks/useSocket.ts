import { useEffect, useState } from 'react'
import { Socket } from 'socket.io-client'
import { getSharedSocket, releaseSharedSocket } from '@/lib/socket'

export function useSocket() {
  const [connected, setConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)

  useEffect(() => {
    const s = getSharedSocket()
    setSocket(s)

    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)

    if (s.connected) setConnected(true)

    return () => {
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      releaseSharedSocket()
    }
  }, [])

  return { socket, connected }
}
