import { useEffect, useState } from 'react'
import type { CompanionState } from '../../electron/companionPreload'
export default function CompanionSettings() {
  const [state, setState] = useState<CompanionState | null>(null), [error, setError] = useState('')
  useEffect(() => { void window.nalu.companion?.get().then(setState).catch(() => setError('Companion controls are unavailable in this session.')) }, [])
  const change = async (patch: Partial<CompanionState>) => { try { setState(await window.nalu.companion.set(patch)); setError('') } catch { setError('Could not save companion settings. Try again.') } }
  return <fieldset className="mb-6"><legend className="mb-2 text-[12px] font-semibold text-ink">Desktop companion</legend><p className="mb-3 text-[12px] leading-5 text-dim">A small floating Nalu keeps you company when the workspace is closed. Click her to talk. Quit Nalu from the menu bar to close everything.</p>{state && <div className="space-y-3"><button type="button" onClick={() => void window.nalu.companion.find().then(setState).catch(() => setError("Could not find Nalu. Try again."))} className="rounded-lg border border-glass/15 px-3 py-2 text-xs text-ink">Find Nalu</button>{([
    ['enabled', 'Show Nalu on my desktop'], ['paused', 'Pause Nalu’s floating animation'],
    ...(['darwin','win32'].includes(window.nalu.platform) ? [['launchAtLogin', 'Start Nalu when I sign in to my computer']] : []),
  ] as ['enabled' | 'paused' | 'launchAtLogin',string][]).map(([key,label]) => <label key={key} className="flex items-center gap-2 text-[12px] text-ink"><input type="checkbox" checked={state[key]} onChange={e => void change({ [key]: e.target.checked })} className="accent-[#d9b87c]"/>{label}</label>)}</div>}{error && <p role="alert" className="text-xs text-red-300">{error}</p>}</fieldset>
}
