import { useEffect, useState } from 'react'
import { API_BASE, getToken } from '../lib/naluApi'

export type LiveTask = {
  id: string; title: string; source: string; status: string; detail?: string
  updated_at: string; events?: { m: string }[]
  meta?: { pendingQuestion?: { text?: string } }
}

/** Read the same account-scoped task ledger as desktop Activity and mobile. */
export default function useLiveTasks(open: boolean) {
  const [feed, setFeed] = useState<{ tasks: LiveTask[]; error: string; signedIn: boolean; updatedAt: string }>({ tasks: [], error: '', signedIn: !!getToken(), updatedAt: '' })
  useEffect(() => {
    let mounted = true, token = getToken(), controller: AbortController | undefined, timer: ReturnType<typeof setTimeout>
    const load = async () => {
      const account = getToken()
      if (account !== token) { token = account; setFeed({ tasks: [], error: '', signedIn: !!account, updatedAt: '' }) }
      if (!account) { timer = setTimeout(load, 4000); return }
      const request = new AbortController(); controller = request
      try {
        const response = await fetch(`${API_BASE}/api/data`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account}` },
          body: JSON.stringify({ action: 'task-feed', limit: 500 }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
        })
        const data = await response.json()
        if (!response.ok || !Array.isArray(data?.tasks)) throw Error('Task updates unavailable')
        if (mounted && !request.signal.aborted && getToken() === account) {
          const tasks = data.tasks.filter((task: LiveTask) => task && typeof task.id === 'string' && ['queued', 'running', 'waiting'].includes(task.status))
          setFeed({ tasks, error: '', signedIn: true, updatedAt: new Date().toISOString() })
        }
      } catch {
        if (mounted && !request.signal.aborted && getToken() === account) setFeed(previous => ({ ...previous, error: 'Live updates unavailable. Retrying…' }))
      } finally { if (mounted && !request.signal.aborted) timer = setTimeout(load, open ? 4000 : 12000) }
    }
    const accountChanged = (event: StorageEvent) => {
      if (event.key === 'nalu-token') { clearTimeout(timer); controller?.abort(); void load() }
    }
    addEventListener('storage', accountChanged); void load()
    return () => { mounted = false; clearTimeout(timer); controller?.abort(); removeEventListener('storage', accountChanged) }
  }, [open])
  return feed
}
