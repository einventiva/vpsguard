import { useState, useEffect, useCallback, useRef } from 'react'
import { Socket } from 'socket.io-client'
import { api, ApiError } from '@/lib/api'
import { getSharedSocket, releaseSharedSocket } from '@/lib/socket'
import { transformServerStatus } from '@/lib/parsers'
import type { ServerData, ServerInfo } from '@/types'

interface UseServerDataReturn {
  data: ServerData | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  wsConnected: boolean
  servers: Record<string, ServerInfo>
  serverKeys: string[]
  refetchServers: () => Promise<void>
}

export function useServerData(refreshInterval: number = 15000): UseServerDataReturn {
  const [data, setData] = useState<ServerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [servers, setServers] = useState<Record<string, ServerInfo>>({})
  const socketRef = useRef<Socket | null>(null)
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const transformRawStatus = useCallback((raw: any): ServerData | null => {
    if (!raw) return null
    const result: ServerData = {}
    for (const [key, value] of Object.entries(raw)) {
      result[key] = transformServerStatus(value, key)
    }
    return Object.keys(result).length > 0 ? result : null
  }, [])

  const fetchData = useCallback(async () => {
    try {
      setError(null)
      const result = await api.getAllServerStatus()
      setData(result)
      setLoading(false)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to fetch server data'
      setError(message)
      setLoading(false)
    }
  }, [])

  const refetchServers = useCallback(async () => {
    try {
      const s = await api.getServers()
      setServers(s)
    } catch {
      // ignore
    }
  }, [])

  // Fetch server list once
  useEffect(() => {
    refetchServers()
  }, [])

  useEffect(() => {
    // Initial HTTP fetch
    fetchData()

    // Use shared socket
    const socket = getSharedSocket()

    socket.on('connect', () => {
      setWsConnected(true)
      if (fallbackRef.current) {
        clearInterval(fallbackRef.current)
        fallbackRef.current = null
      }
    })

    socket.on('disconnect', () => {
      setWsConnected(false)
      if (!fallbackRef.current) {
        fallbackRef.current = setInterval(fetchData, refreshInterval)
      }
    })

    socket.on('metrics:update', (rawData: any) => {
      const transformed = transformRawStatus(rawData)
      if (transformed) {
        setData(transformed)
        setLoading(false)
        setError(null)
      }
    })

    socketRef.current = socket

    // If already connected, don't start fallback
    if (socket.connected) {
      setWsConnected(true)
    } else {
      fallbackRef.current = setInterval(fetchData, refreshInterval)
    }

    return () => {
      socket.off('connect')
      socket.off('disconnect')
      socket.off('metrics:update')
      releaseSharedSocket()
      socketRef.current = null
      if (fallbackRef.current) {
        clearInterval(fallbackRef.current)
        fallbackRef.current = null
      }
    }
  }, [fetchData, refreshInterval, transformRawStatus])

  const serverKeys = Object.keys(servers)

  return {
    data,
    loading,
    error,
    refetch: fetchData,
    wsConnected,
    servers,
    serverKeys,
    refetchServers,
  }
}
