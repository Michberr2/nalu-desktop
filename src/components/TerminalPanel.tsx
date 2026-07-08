import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X, Plus, AlertCircle, ChevronDown } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import * as monaco from 'monaco-editor'

let counter = 0

// One real pty-backed terminal. Kept mounted (hidden when inactive) so its
// shell + scrollback survive tab switches. Auto-focuses so you can type right
// away, and auto-restarts if the shell ever exits.
function Term({ id, active, folder, shell }: { id: string; active: boolean; folder: string | null; shell?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<XTerm | null>(null)
  const restartsRef = useRef(0)
  const bornRef = useRef(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new XTerm({
      fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      theme: { background: '#13151b', foreground: '#ededed', cursor: '#af8c56', selectionBackground: '#af8c5644', black: '#0b0c10', brightBlack: '#5f6672' },
      cursorBlink: true,
    })
    termRef.current = term
    const fit = new FitAddon(); fitRef.current = fit
    term.loadAddon(fit); term.open(host); fit.fit()
    let disposed = false

    // Spawn (or respawn) the shell for this terminal.
    const spawn = () => {
      bornRef.current = Date.now()
      void window.nalu.term.create(id, folder || '', shell).then(() => { term.focus(); const s = () => { fit.fit(); window.nalu.term.resize(id, term.cols, term.rows) }; setTimeout(s, 40) })
    }

    const offData = window.nalu.term.onData(id, (d) => term.write(d))
    const offExit = window.nalu.term.onExit(id, () => {
      if (disposed) return
      const quick = Date.now() - bornRef.current < 2500
      if (restartsRef.current < 4) {
        restartsRef.current++
        // If it died instantly, the login profile likely errored — retry without
        // login next time so the user always gets a working shell.
        term.write('\r\n\x1b[90m[restarting shell…]\x1b[0m\r\n')
        setTimeout(() => { if (!disposed) spawn() }, quick ? 400 : 100)
      } else {
        term.write('\r\n\x1b[90m[shell exited — press ⌘` twice to reopen]\x1b[0m\r\n')
      }
    })
    term.onData((d) => window.nalu.term.input(id, d))
    const sync = () => { fit.fit(); window.nalu.term.resize(id, term.cols, term.rows) }
    const ro = new ResizeObserver(sync); ro.observe(host)
    spawn()
    setTimeout(() => { sync(); term.focus() }, 60)

    return () => { disposed = true; offData(); offExit(); ro.disconnect(); void window.nalu.term.kill(id); term.dispose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refit AND focus when this tab becomes visible, so typing works immediately.
  useEffect(() => { if (active) setTimeout(() => { fitRef.current?.fit(); termRef.current?.focus() }, 30) }, [active])

  // Click anywhere in the terminal focuses it (belt-and-suspenders for typing).
  return <div ref={hostRef} onMouseDown={() => termRef.current?.focus()} className="h-full w-full px-2 py-1" style={{ display: active ? 'block' : 'none' }} />
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

type TermDef = { id: string; shell: string }

export default function TerminalPanel() {
  const ws = useWorkspace()
  const [avail, setAvail] = useState<string[]>([])
  const [defaultShell, setDefaultShell] = useState('zsh')
  const [terms, setTerms] = useState<TermDef[]>(() => [{ id: `t${++counter}`, shell: '' }])
  const [activeTerm, setActiveTerm] = useState(() => terms[0].id)
  const [view, setView] = useState<'terminal' | 'problems' | 'output'>('terminal')
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => { window.nalu.term.shells().then((s) => { setAvail(s); if (s[0]) setDefaultShell(s[0]) }) }, [])

  const addTerm = (shell = defaultShell) => { const id = `t${++counter}`; setTerms((p) => [...p, { id, shell }]); setActiveTerm(id); setView('terminal'); setPickerOpen(false) }
  const closeTerm = (id: string) => {
    setTerms((p) => { const next = p.filter((t) => t.id !== id); if (next.length === 0) { ws.setTermOpen(false); return p } setActiveTerm((cur) => (cur === id ? next[next.length - 1].id : cur)); return next })
  }
  const shellLabel = (s: string) => s ? s.replace('git-bash', 'Git Bash').replace('powershell', 'PowerShell').replace(/^\w/, (c) => c.toUpperCase()) : 'Default'

  const Tab = ({ id, label, on }: { id: string; label: string; on: boolean }) => (
    <button onClick={() => { setView(id as 'terminal' | 'problems' | 'output') }} className={`px-1 text-[11px] font-medium uppercase tracking-[0.1em] ${on ? 'text-ink' : 'text-dim hover:text-ink'}`}>{label}</button>
  )

  // Drag the top edge to resize the terminal height (persisted).
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY, startH = ws.termHeight
    const move = (ev: MouseEvent) => ws.setTermHeight(startH + (startY - ev.clientY))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = '' }
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  return (
    <div className="relative flex shrink-0 flex-col overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/80 backdrop-blur-2xl" style={{ height: ws.termHeight }}>
      <div onMouseDown={startResize} title="Drag to resize" className="group absolute inset-x-0 top-0 z-10 flex h-2 cursor-ns-resize items-center justify-center">
        <div className="h-0.5 w-10 rounded-full bg-glass/20 group-hover:bg-gold/60" />
      </div>
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-glass/[0.06] px-3 pt-0.5">
        <Tab id="terminal" label="Terminal" on={view === 'terminal'} />
        <Tab id="problems" label="Problems" on={view === 'problems'} />
        <Tab id="output" label="Output" on={view === 'output'} />
        {view === 'terminal' && (
          <div className="relative ml-2 flex items-center gap-1">
            {terms.map((t) => (
              <span key={t.id} className={`group flex items-center rounded-md px-1.5 py-0.5 text-[10px] ${activeTerm === t.id ? 'bg-glass/10 text-ink' : 'text-dim hover:text-ink'}`}>
                <button onClick={() => setActiveTerm(t.id)}>{shellLabel(t.shell)}</button>
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
        <button onClick={() => ws.setTermOpen(false)} className="ml-auto rounded p-0.5 text-dim hover:bg-glass/10 hover:text-ink"><X size={13} /></button>
      </div>
      <div className="min-h-0 flex-1">
        <div className="h-full" style={{ display: view === 'terminal' ? 'block' : 'none' }}>
          {terms.map((t) => <Term key={t.id} id={t.id} active={view === 'terminal' && activeTerm === t.id} folder={ws.folder} shell={t.shell} />)}
        </div>
        {view === 'problems' && <Problems />}
        {view === 'output' && <div className="flex h-full items-center justify-center text-[12px] text-dim">Output — build &amp; task logs appear here.</div>}
      </div>
    </div>
  )
}
