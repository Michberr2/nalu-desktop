import { useState } from 'react'
import { X } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { getToken, setToken } from '../lib/naluApi'

export default function SettingsModal() {
  const ws = useWorkspace()
  const [tok, setTok] = useState(getToken())
  const [saved, setSaved] = useState(false)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => ws.setSettingsOpen(false)}>
      <div className="w-full max-w-md animate-fadeIn rounded-2xl border border-glass/[0.12] bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Settings</h2>
          <button onClick={() => ws.setSettingsOpen(false)} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={16} /></button>
        </div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Nalu account</div>
        <p className="mb-2 text-[12px] leading-relaxed text-dim">Sign in at n4lu.ai, then paste your session token so Nalu AI works here.</p>
        <input
          value={tok}
          onChange={(e) => setTok(e.target.value)}
          placeholder="nalu session token"
          className="w-full rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-gold/50"
        />
        <button
          onClick={() => { setToken(tok.trim()); setSaved(true); setTimeout(() => setSaved(false), 1500) }}
          className="mt-3 w-full rounded-lg bg-gold/90 px-3 py-2 text-[13px] font-medium text-[#15170f] hover:bg-gold"
        >
          {saved ? 'Saved ✓' : 'Save token'}
        </button>
        <div className="mt-4 text-[11px] text-dim">Nalu Desktop 0.1.0 — the Nalu app, on your computer.</div>
      </div>
    </div>
  )
}
