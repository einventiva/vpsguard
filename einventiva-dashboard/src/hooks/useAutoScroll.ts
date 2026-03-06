import { useEffect, useRef } from 'react'

export function useAutoScroll<T extends HTMLElement>(deps: any[]) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, deps)

  return ref
}
