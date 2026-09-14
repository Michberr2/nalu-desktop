import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspace } from '../lib/store'

export default function TrashEntryDialog({ target, onClose }: {
  target: { name: string; path: string; dir: boolean }; onClose: () => void
}) {
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const submit = async () => {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try { await ws.trashPath(target.path); onClose() }
    catch (failure) { setError(String(failure)) }
    finally { running.current = false; setBusy(false) }
  }
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={e => e.stopPropagation()}>
      <form role="dialog" aria-modal="true" aria-labelledby="trash-entry-title"
        onSubmit={e => { e.preventDefault(); void submit() }}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape' && !busy) onClose()
          if (e.key === 'Tab') {
            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            e.preventDefault(); buttons[(index + 1) % buttons.length]?.focus()
          }
        }} className="w-[400px] rounded-xl border border-glass/[0.12] bg-panel p-5 shadow-2xl">
        <h2 id="trash-entry-title" className="mb-3 text-sm font-medium text-ink">Move to Trash?</h2>
        <p className="break-words text-sm text-ink">{target.name}{target.dir ? ' and its contents' : ''}</p>
        <p className="mt-2 text-xs text-dim">Unsaved edits in open tabs will stay available to save elsewhere.</p>
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" autoFocus disabled={busy} onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-dim">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-md bg-red-400/20 px-3 py-1.5 text-xs text-red-200 disabled:opacity-50">{busy ? 'Moving…' : 'Move to Trash'}</button>
        </div>
      </form>
    </div>, document.body,
  )
}
