import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X, Plus, AlertCircle, ChevronDown } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import * as monaco from 'monaco-editor'
import ResizeGrip, { type ResizeDelta } from './ResizeGrip'
import { clampPanelSize } from '../lib/panelSize'

let counter = 0

// Keep the process and scrollback alive while hidden. A terminal owns its
// initial directory; changing projects must never send text to a running CLI.
function Term({ id, active, folder, shell }: { id: string; active: boolean; folder: string | null; shell?: string }) {
  const { appearance } = useWorkspace()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const syncRef = useRef<(() => void) | null>(null)
  const activeRef = useRef(active); activeRef.current = active
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new XTerm({
      fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace', fontSize: 12.5,
      theme: { background: '#13151b', foreground: '#ededed', cursor: '#af8c56', selectionBackground: '#af8c5644' },
      cursorBlink: true, scrollback: 10000,
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit); term.open(host)
    let disposed = false
    let ready = false
    setStatus(null)
    const sync = () => {
      if (disposed || !activeRef.current || !host.clientWidth || !host.clientHeight) return
      fit.fit()
      if (ready) window.nalu.term.resize(id, term.cols, term.rows)
    }
    syncRef.current = sync
    const offData = window.nalu.term.onData(id, d => { if (!disposed) term.write(d) })
    const sessionLabel = shell === 'nalu' ? 'Nalu' : 'Shell'
    const offExit = window.nalu.term.onExit(id, code => {
      if (disposed) return
      ready = false
      setStatus(`${sessionLabel} exited with code ${code}.`)
    })
    const input = term.onData(d => { if (ready) window.nalu.term.input(id, d) })
    const ro = new ResizeObserver(sync); ro.observe(host)
    void window.nalu.term.create(id, folder || '', shell).then(created => {
      if (disposed || !created) return
      ready = true; sync()
      if (activeRef.current) term.focus()
    }).catch(error => {
      if (!disposed) setStatus(`Could not start shell: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      disposed = true; offData(); offExit(); input.dispose(); ro.disconnect()
      syncRef.current = null; termRef.current = null
      void window.nalu.term.kill(id).catch(() => {})
      term.dispose()
    }
  }, [id, folder, shell, attempt])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => { syncRef.current?.(); termRef.current?.focus() })
    return () => cancelAnimationFrame(frame)
  }, [active])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = appearance === 'avatar'
      ? { background: '#ffffff', foreground: '#232326', cursor: '#a67b29', selectionBackground: '#a67b2930', black:'#232326', red:'#ad5145', green:'#477d60', yellow:'#946d28', blue:'#587da3', magenta:'#8a6294', cyan:'#487e86', white:'#c1c1c8' }
      : appearance === 'pastel' ? { background: '#fffcf7', foreground: '#403b34', cursor: '#93784e' }
      : { background: '#13151b', foreground: '#ededed', cursor: '#af8c56', selectionBackground: '#af8c5644' }
  }, [appearance, attempt])

  return <div className="relative h-full w-full" style={{ display: active ? 'block' : 'none' }}>
    <div ref={hostRef} onMouseDown={() => termRef.current?.focus()} className="h-full w-full px-2 py-1" />
    {status && <div role="status" className="absolute inset-x-2 bottom-2 flex items-center gap-3 rounded-lg border border-glass/10 bg-panel2 p-3 text-xs">
      <span className="min-w-0 flex-1 break-words">{status}</span>
      <button onClick={() => setAttempt(n => n + 1)} className="shrink-0 text-gold">{shell === 'nalu' ? 'Restart Nalu' : 'Restart shell'}</button>
    </div>}
  </div>
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

type TermDef = { id: string; shell: string; folder: string | null }

export default function TerminalPanel({ visible = true }: { visible?: boolean }) {
  const ws = useWorkspace()
  const [avail, setAvail] = useState<string[]>([])
  const [defaultShell, setDefaultShell] = useState('zsh')
  const [terms, setTerms] = useState<TermDef[]>(() => [{ id: `t${++counter}`, shell: '', folder: ws.folder }])
  const [activeTerm, setActiveTerm] = useState(() => terms[0].id)
  const [view, setView] = useState<'terminal' | 'problems' | 'output'>('terminal')
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => { window.nalu.term.shells().then((s) => { setAvail(s); if (s[0]) setDefaultShell(s[0]) }).catch(() => {}) }, [])

  const addTerm = (shell = defaultShell) => { const id = `t${++counter}`; setTerms((p) => [...p, { id, shell, folder: ws.folder }]); setActiveTerm(id); setView('terminal'); setPickerOpen(false) }
  const closeTerm = (id: string) => {
    setTerms((p) => { const next = p.filter((t) => t.id !== id); if (next.length === 0) { ws.setTermOpen(false); return p } setActiveTerm((cur) => (cur === id ? next[next.length - 1].id : cur)); return next })
  }
  const shellLabel = (s: string) => s ? s.replace('git-bash', 'Git Bash').replace('powershell', 'PowerShell').replace(/^\w/, (c) => c.toUpperCase()) : 'Default'

  const Tab = ({ id, label, on }: { id: string; label: string; on: boolean }) => (
    <button onClick={() => { setView(id as 'terminal' | 'problems' | 'output') }} className={`px-1 text-[11px] font-medium uppercase tracking-[0.1em] ${on ? 'text-ink' : 'text-dim hover:text-ink'}`}>{label}</button>
  )

  // Drag the top edge to resize the terminal height (persisted).
  const resize = ({ start, dy }: ResizeDelta) => ws.setTermHeight(clampPanelSize(start.height - dy, 120, (document.querySelector('.editor-column')?.clientHeight || innerHeight) * .65))

  return (
    <div className="terminal-panel relative flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/80 backdrop-blur-2xl">
      <ResizeGrip edge label="Resize terminal" axis="y" onResize={resize} onReset={() => ws.setTermHeight(224)} value={ws.termHeight} min={120} max={700} />
      <ResizeGrip label="Resize Terminal panel" axis="y" onResize={resize} onReset={() => ws.setTermHeight(224)} />
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-glass/[0.06] px-3 pt-0.5">
        <Tab id="terminal" label="Terminal" on={view === 'terminal'} />
        <Tab id="problems" label="Problems" on={view === 'problems'} />
        <Tab id="output" label="Output" on={view === 'output'} />
        <button onClick={() => addTerm('nalu')} title="Start Nalu CLI in the current project" className="rounded-md border border-gold/25 px-2 py-0.5 text-[11px] text-gold hover:bg-gold/10">+ Nalu</button>
        {view === 'terminal' && (
          <div className="relative ml-2 flex items-center gap-1">
            {terms.map((t) => (
              <span key={t.id} className={`group flex items-center rounded-md px-1.5 py-0.5 text-[10px] ${activeTerm === t.id ? 'bg-glass/10 text-ink' : 'text-dim hover:text-ink'}`}>
                <button title={`Opened in ${t.folder || 'home directory'}`} onClick={() => setActiveTerm(t.id)}>{shellLabel(t.shell)}</button>
                {terms.length > 1 && <button onClick={() => closeTerm(t.id)} className="ml-1 opacity-0 group-hover:opacity-100"><X size={9} /></button>}
              </span>
            ))}
            {/* New-terminal split button: click = default shell; caret = pick type */}
            <button onClick={() => addTerm()} title="New terminal" className="rounded p-0.5 text-dim hover:bg-glass/10 hover:text-ink"><Plus size={12} /></button>
            <button onClick={() => setPickerOpen((o) => !o)} title="Choose shell" className="rounded p-0.5 text-dim hover:bg-glass/10 hover:text-ink"><ChevronDown size={11} /></button>
            {pickerOpen && (
              <div className="absolute right-0 top-6 z-20 min-w-[120px] overflow-hidden rounded-lg border border-glass/[0.12] bg-panel2 py-1 shadow-xl">
                {(avail.length ? avail : ['zsh', 'bash', 'sh']).map((s) => (
                  <button key={s} onClick={() => addTerm(s)} className="block w-full px-3 py-1.5 text-left text-[11px] text-dim hover:bg-glass/10 hover:text-ink">{shellLabel(s)}</button>
                ))}
              </div>
            )}
          </div>
        )}
        <button title="Hide terminal (keeps sessions running)" aria-label="Hide terminal" onClick={() => ws.setTermOpen(false)} className="ml-auto rounded p-0.5 text-dim hover:bg-glass/10 hover:text-ink"><X size={13} /></button>
      </div>
      <div className="min-h-0 flex-1">
        <div className="h-full" style={{ display: view === 'terminal' ? 'block' : 'none' }}>
          {terms.map((t) => <Term key={t.id} id={t.id} active={visible && view === 'terminal' && activeTerm === t.id} folder={t.folder} shell={t.shell} />)}
        </div>
        {view === 'problems' && <Problems />}
        {view === 'output' && <div className="flex h-full items-center justify-center text-[12px] text-dim">Output — build &amp; task logs appear here.</div>}
      </div>
    </div>
  )
}
