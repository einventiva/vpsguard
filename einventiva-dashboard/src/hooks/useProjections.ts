import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { ServerProjection } from '@/types'

// Disk-full ETA and memory slope per server; the backend caches for
// 5 min, so poll at the same cadence.
export function useProjections(): Record<string, ServerProjection> {
  const [projections, setProjections] = useState<Record<string, ServerProjection>>({})

  useEffect(() => {
    const fetchProjections = async () => {
      try {
        const response = await api.getProjections()
        setProjections(response.servers)
      } catch (err) {
        console.error('Failed to fetch projections:', err)
      }
    }
    fetchProjections()
    const interval = setInterval(fetchProjections, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  return projections
}
