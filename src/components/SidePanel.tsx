import { useWorkspace } from '../lib/store'
import Explorer from './Explorer'
import { setToken, getToken } from '../lib/naluApi'
import { useState } from 'react'

function Settings() {
  const [tok, setTok] = useState(getToken())
  const [saved, setSaved] = useState(false)
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Account</div>
        <p className="mb-2 text-[12px] leading-relaxed text-dim">
          Sign in on n4lu.ai, then paste your session token here so Nalu AI works in the desktop app.
        </p>
        <input
          value={tok}
          onChange={(e) => setTok(e.target.value)}
          placeholder="nalu session token"
          className="w-full rounded-md border border-glass/[0.1] bg-panel2 px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-dim focus:border-gold/50"
        />
        <button
          onClick={() => { setToken(tok.trim()); setSaved(true); setTimeout(() => setSaved(false), 1500) }}
          className="mt-2 rounded-md bg-gold/90 px-3 py-1.5 text-[12px] font-medium text-[#15170f] hover:bg-gold"
        >
          {saved ? 'Saved ✓' : 'Save token'}
        </button>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">About</div>
        <p className="text-[12px] leading-relaxed text-dim">Nalu Desktop 0.1.0 — the Nalu app, on your computer, with a real code editor.</p>
      </div>
    </div>
  )
}

function Placeholder({ label }: { label: string }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-dim">{label} — coming in v1</div>
}

export default function SidePanel() {
  const ws = useWorkspace()
  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-glass/[0.08] bg-sidebar">
      {ws.view === 'explorer' && <Explorer />}
      {ws.view === 'settings' && <Settings />}
      {ws.view === 'search' && <Placeholder label="Search across files" />}
      {ws.view === 'git' && <Placeholder label="Source control" />}
      {ws.view === 'studio' && <Placeholder label="Nalu Studio" />}
    </div>
  )
}
