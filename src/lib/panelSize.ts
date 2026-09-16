import { useEffect, useState } from 'react'

export const clampPanelSize = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value))

export function usePanelSize(key: string) {
  const [size, setSize] = useState<number | null>(() => {
    try { const value = Number(localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : null } catch { return null }
  })
  const update = (value: number | null) => {
    setSize(value)
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, String(Math.round(value))) } catch { /* Resizing still works without storage. */ }
  }
  return [size, update] as const
}

export function useStackedPanels() {
  const [stacked, setStacked] = useState(() => matchMedia('(max-width: 1050px)').matches)
  useEffect(() => {
    const query = matchMedia('(max-width: 1050px)'), update = () => setStacked(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return stacked
}
