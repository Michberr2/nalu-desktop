import { useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { useWorkspace } from '../lib/store'

type Hit = { file: string; rel: string; line: number; text: string }

// Find in Files — cross-file content search (like VS Code ⌘⇧F).
export default function SearchPanel() {
  const ws = useWorkspace()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState(false)

  const run = async () => {
    if (!ws.folder || !q.trim()) return
    setBusy(true); setRan(true)
    try { setHits(await window.nalu.search(ws.folder, q.trim())) } finally { setBusy(false) }
  }

  // group by file
  const byFile = hits.reduce<Record<string, Hit[]>>((acc, h) => { (acc[h.rel] ??= []).push(h); return acc }, {})

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-glass/[0.1] bg-panel2 px-2 py-1.5 focus-within:border-gold/40">
          <Search size={13} className="text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
            autoFocus
            placeholder="Search in files"
            className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim"
          />
          {busy && <Loader2 size={13} className="animate-spin text-dim" />}
        </div>
        {ran && !busy && <div className="mt-1.5 px-0.5 text-[11px] text-dim">{hits.length} results in {Object.keys(byFile).length} files</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {Object.entries(byFile).map(([rel, list]) => (
          <div key={rel} className="mb-2">
            <div className="truncate px-1.5 py-1 text-[11px] font-medium text-ink">{rel} <span className="text-dim">· {list.length}</span></div>
            {list.map((h, i) => (
              <button
                key={i}
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
