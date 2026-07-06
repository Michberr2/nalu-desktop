import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X } from 'lucide-react'
import { useWorkspace } from '../lib/store'

let counter = 0

export default function TerminalPanel() {
  const ws = useWorkspace()
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const id = `t${++counter}`
    const term = new Terminal({
      fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      theme: {
        background: '#13151b',
        foreground: '#ededed',
        cursor: '#af8c56',
        selectionBackground: '#af8c5644',
        black: '#0b0c10', brightBlack: '#5f6672',
      },
      cursorBlink: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    void window.nalu.term.create(id, ws.folder || '')
    const offData = window.nalu.term.onData(id, (d) => term.write(d))
    const offExit = window.nalu.term.onExit(id, () => term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n'))
    term.onData((d) => window.nalu.term.input(id, d))

    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(host)

    return () => {
      offData(); offExit(); ro.disconnect()
      void window.nalu.term.kill(id)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-glass/[0.08] bg-panel2">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-glass/[0.06] px-3">
        <div className="flex items-center gap-4 text-[11px] font-medium uppercase tracking-[0.1em]">
          <span className="text-ink">Terminal</span>
          <span className="text-dim">Problems</span>
          <span className="text-dim">Output</span>
        </div>
        <button onClick={() => ws.setTermOpen(false)} className="rounded p-0.5 text-dim hover:bg-glass/10 hover:text-ink">
          <X size={13} />
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  )
}
