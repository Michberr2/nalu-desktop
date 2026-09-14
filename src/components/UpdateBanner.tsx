import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import type { DesktopUpdateState } from '../../electron/updateController'
import { useWorkspace } from '../lib/store'
import { reportUpdateActivity } from '../lib/updateActivity'
import { checkForUpdate, DOWNLOAD_PAGE, type UpdateInfo } from '../lib/update'

export default function UpdateBanner() {
  const ws = useWorkspace()
  const [state, setState] = useState<DesktopUpdateState>({ phase: 'idle' })
  const [manual, setManual] = useState<UpdateInfo | null>(null)
  const [now, setNow] = useState(Date.now())
  const unsafe = useRef(true)
  unsafe.current = !!ws.recoveryError || ws.tabs.some(tab => tab.dirty || !!tab.saveError || tab.diskConflict !== undefined)
  useEffect(() => reportUpdateActivity(window.nalu.updates.activity, () => unsafe.current || !!document.querySelector('dialog[open]') ||
    Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="password"]'))
      .some(input => !input.readOnly && !input.closest('.monaco-editor') && !!input.value)), [])
  useEffect(() => {
    let alive = true
    const accept = (next: DesktopUpdateState) => { if (alive) setState(next) }
    const unsubscribe = window.nalu.updates.onState(accept)
    void window.nalu.updates.get().then(accept)
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => { alive = false; unsubscribe(); clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (state.phase !== 'disabled') return
    let alive = true
    const check = () => { void checkForUpdate().then(info => { if (alive) setManual(info) }) }
    check(); const timer = setInterval(check, 30 * 60 * 1000)
    return () => { alive = false; clearInterval(timer) }
  }, [state.phase])
  if (state.phase === 'disabled') return manual ? <div className="desktop-update-banner" role="status"><span>Nalu {manual.latest} is available.</span><a href={DOWNLOAD_PAGE} target="_blank" rel="noreferrer"><Download size={13}/> Download update</a></div> : null
  if (['idle', 'checking'].includes(state.phase)) return null
  return <div className="desktop-update-banner" role="status">
    <span>{state.phase === 'downloading' ? `Downloading Nalu ${state.version} · ${state.percent ?? 0}%`
      : state.phase === 'installing' ? 'Restarting Nalu to finish your update…'
      : state.restartAt ? `Nalu ${state.version} restarts in ${Math.max(0, Math.ceil((state.restartAt - now) / 1000))}s. Keep working to postpone.`
      : `${state.version ? `Nalu ${state.version} is ready. ` : ''}${state.message || ''}`}</span>
    {state.phase === 'error' && <button onClick={() => void window.nalu.updates.check()}>Retry update</button>}
  </div>
}
