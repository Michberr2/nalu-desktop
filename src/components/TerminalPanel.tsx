import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X, Plus, AlertCircle } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import * as monaco from 'monaco-editor'

let counter = 0

// One real pty-backed terminal. Kept mounted (hidden when inactive) so its
// shell + scrollback survive tab switches.
function Term({ id, active, folder }: { id: string; active: boolean; folder: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new XTerm({
      fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      theme: { background: '#13151b', foreground: '#ededed', cursor: '#af8c56', selectionBackground: '#af8c5644', black: '#0b0c10', brightBlack: '#5f6672' },
      cursorBlink: true,
    })
    const fit = new FitAddon(); fitRef.current = fit
    term.loadAddon(fit); term.open(host); fit.fit()
    void window.nalu.term.create(id, folder || '')
    const offData = window.nalu.term.onData(id, (d) => term.write(d))
    const offExit = window.nalu.term.onExit(id, () => term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n'))
    term.onData((d) => window.nalu.term.input(id, d))
    const sync = () => { fit.fit(); window.nalu.term.resize(id, term.cols, term.rows) }
    const ro = new ResizeObserver(sync); ro.observe(host)
    setTimeout(sync, 50)
    return () => { offData(); offExit(); ro.disconnect(); void window.nalu.term.kill(id); term.dispose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // refit when this tab becomes visible
  useEffect(() => { if (active) setTimeout(() => fitRef.current?.fit(), 30) }, [active])

  return <div ref={hostRef} className="h-full w-full px-2 py-1" style={{ display: active ? 'block' : 'none' }} />
}

function Problems() {
  const ws = useWorkspace()
  const [markers, setMarkers] = useState<monaco.editor.IMarker[]>([])
  useEffect(() => {
    const read = () => setMarkers(monaco.editor.getModelMarkers({}).filter((m) => m.severity >= monaco.MarkerSeverity.Warning))
    read()
    const t = setInterval(read, 1500)
    return () => clearInterval(t)
  }, [ws.refreshKey])
  if (markers.length === 0) return <div className="flex h-full items-center justify-center text-[12px] text-dim">No problems detected in open files.</div>
  return (
    <div className="h-full overflow-y-auto p-2 text-[12px]">
      {markers.map((m, i) => (
        <button key={i} onClick={() => { const u = m.resource.path; ws.openAt(u, u.split('/').pop() || u, m.startLineNumber) }} className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-glass/[0.06]">
          <AlertCircle size={13} className={`mt-0.5 shrink-0 ${m.severity === monaco.MarkerSeverity.Error ? 'text-red-400' : 'text-amber-400'}`} />
          <span className="min-w-0 flex-1 text-ink">{m.message} <span className="text-dim">· {m.resource.path.split('/').pop()}:{m.startLineNumber}</span></span>
        </button>
      ))}
    </div>
  )
}

export default function TerminalPanel() {
  const ws = useWorkspace()
  const [terms, setTerms] = useState<string[]>(() => [`t${++counter}`])
  const [activeTerm, setActiveTerm] = useState(() => terms[0])
  const [view, setView] = useState<'terminal' | 'problems' | 'output'>('terminal')

  const addTerm = () => { const id = `t${++counter}`; setTerms((p) => [...p, id]); setActiveTerm(id); setView('terminal') }
  const closeTerm = (id: string) => {
    setTerms((p) => { const next = p.filter((t) => t !== id); if (next.length === 0) { ws.setTermOpen(false); return p } setActiveTerm((cur) => (cur === id ? next[next.length - 1] : cur)); return next })
  }

  const Tab = ({ id, label, on }: { id: string; label: string; on: boolean }) => (
    <button onClick={() => { setView(id as 'terminal' | 'problems' | 'output') }} className={`px-1 text-[11px] font-medium uppercase tracking-[0.1em] ${on ? 'text-ink' : 'text-dim hover:text-ink'}`}>{label}</button>
  )

  return (
    <div className="flex h-56 shrink-0 flex-col overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/80 backdrop-blur-2xl">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-glass/[0.06] px-3">
        <Tab id="terminal" label="Terminal" on={view === 'terminal'} />
        <Tab id="problems" label="Problems" on={view === 'problems'} />
        <Tab id="output" label="Output" on={view === 'output'} />
        {view === 'terminal' && (
          <div className="ml-2 flex items-center gap-1">
            {terms.map((id, i) => (
              <span key={id} className={`group flex items-center rounded-md px-1.5 py-0.5 text-[10px] ${activeTerm === id ? 'bg-glass/10 text-ink' : 'text-dim hover:text-ink'}`}>
                <button onClick={() => setActiveTerm(id)}>zsh {i + 1}</button>
                {terms.length > 1 && <button onClick={() => closeTerm(id)} className="ml-1 opacity-0 group-hover:opacity-100"><X size={9} /></button>}
              </span>
            ))}
            <button onClick={addTerm} title="New terminal" className="rounded p-0.5 text-dim hover:bg-glass/10 hover:text-ink"><Plus size={12} /></button>
          </div>
        )}
        <button onClick={() => ws.setTermOpen(false)} className="ml-auto rounded p-0.5 text-dim hover:bg-glass/10 hover:text-ink"><X size={13} /></button>
      </div>
      <div className="min-h-0 flex-1">
        <div className="h-full" style={{ display: view === 'terminal' ? 'block' : 'none' }}>
          {terms.map((id) => <Term key={id} id={id} active={view === 'terminal' && activeTerm === id} folder={ws.folder} />)}
        </div>
        {view === 'problems' && <Problems />}
        {view === 'output' && <div className="flex h-full items-center justify-center text-[12px] text-dim">Output — build &amp; task logs appear here.</div>}
      </div>
    </div>
  )
}
