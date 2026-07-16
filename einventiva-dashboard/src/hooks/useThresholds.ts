import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { DEFAULT_THRESHOLDS } from '@/lib/formatters'
import type { Thresholds, ThresholdOverride, ThresholdsResponse } from '@/types'

export interface UseThresholdsReturn {
  data: ThresholdsResponse | null
  loading: boolean
  // Effective thresholds for a server, safe before/without data
  effectiveFor: (serverKey: string) => Thresholds
  saveGlobal: (values: ThresholdOverride) => Promise<void>
  saveServer: (server: string, values: ThresholdOverride) => Promise<void>
}

export function useThresholds(): UseThresholdsReturn {
  const [data, setData] = useState<ThresholdsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      setData(await api.getThresholds())
    } catch (err) {
      console.error('Failed to fetch thresholds:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  const effectiveFor = useCallback(
    (serverKey: string): Thresholds => data?.effective[serverKey] ?? data?.builtin ?? DEFAULT_THRESHOLDS,
    [data]
  )

  const saveGlobal = useCallback(async (values: ThresholdOverride) => {
    try {
      await api.setGlobalThresholds(values)
      await refetch()
      toast.success('Global thresholds updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update thresholds')
    }
  }, [refetch])

  const saveServer = useCallback(async (server: string, values: ThresholdOverride) => {
    try {
      await api.setServerThresholds(server, values)
      await refetch()
      toast.success(`Thresholds updated for ${server}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update thresholds')
    }
  }, [refetch])

  return { data, loading, effectiveFor, saveGlobal, saveServer }
}
