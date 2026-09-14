import { useLayoutEffect, useRef, useState } from 'react'
import { Search, Loader2, Square } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { SEARCH_RESULT_LIMIT } from '../lib/searchLimits'

type Hit = { file: string; rel: string; line: number; text: string }

// Find in Files — cross-file content search (like VS Code ⌘⇧F).
export default function SearchPanel() {
  const ws = useWorkspace()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState(false)
  const [error, setError] = useState('')
  const [stopped, setStopped] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const request = useRef(0)

  useLayoutEffect(() => {
    request.current++
    window.nalu.cancelSearch()
    setHits([]); setBusy(false); setRan(false); setError(''); setStopped(false)
    return () => { request.current++; window.nalu.cancelSearch() }
  }, [ws.folder])

  const run = async () => {
    if (!ws.folder || !q.trim()) return
    const id = ++request.current
    setBusy(true); setRan(true); setError(''); setHits([]); setStopped(false)
    try {
      const result = await window.nalu.search(ws.folder, q.trim())
      if (id === request.current) setHits(result)
    } catch (failure) {
      if (id === request.current) setError(`Search failed: ${String(failure)}`)
    } finally { if (id === request.current) setBusy(false) }
  }

  const stop = () => {
    request.current++; window.nalu.cancelSearch()
    setBusy(false); setRan(false); setError(''); setStopped(true)
    input.current?.focus()
  }

  // group by file
  const byFile = new Map<string, Hit[]>()
  for (const hit of hits) {
    const group = byFile.get(hit.rel) || []
    group.push(hit); byFile.set(hit.rel, group)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-glass/[0.1] bg-panel2 px-2 py-1.5 focus-within:border-gold/40">
          <Search size={13} className="text-dim" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              request.current++; setQ(e.target.value)
              window.nalu.cancelSearch()
              setHits([]); setBusy(false); setRan(false); setError(''); setStopped(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
              if (e.key === 'Escape' && busy) { e.preventDefault(); e.stopPropagation(); stop() }
            }}
            autoFocus
            placeholder="Search in files"
            className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim"
          />
          {busy && <>
            <Loader2 size={13} className="shrink-0 animate-spin text-dim" />
            <button type="button" aria-label="Stop search" title="Stop search (Esc)" onClick={stop} className="shrink-0 rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><Square size={12} /></button>
          </>}
        </div>
        {error && <div role="alert" className="mt-1.5 text-xs text-red-300">{error}</div>}
        {stopped && <div role="status" className="mt-1.5 text-[11px] text-dim">Search stopped.</div>}
        {ran && !busy && !error && <div className="mt-1.5 px-0.5 text-[11px] text-dim">{hits.length} result{hits.length === 1 ? '' : 's'} in {byFile.size} file{byFile.size === 1 ? '' : 's'}</div>}
        {ran && !busy && !error && hits.length >= SEARCH_RESULT_LIMIT && <div role="status" className="mt-1 text-[11px] text-amber-300">Search is limited to {SEARCH_RESULT_LIMIT} results. Refine your query to narrow the results.</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {Array.from(byFile).map(([rel, list]) => (
          <div key={rel} className="mb-2">
            <div className="truncate px-1.5 py-1 text-[11px] font-medium text-ink">{rel} <span className="text-dim">· {list.length}</span></div>
            {list.map((h, i) => (
              <button
                key={i}
                title={`${h.rel}:${h.line}`}
                onClick={() => void ws.openAt(h.file, rel.split('/').pop() || rel, h.line)}
                className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-glass/[0.06]"
              >
                <span className="shrink-0 text-[10px] tabular-nums text-dim">{h.line}</span>
                <span className="truncate text-[12px] text-dim">{h.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
