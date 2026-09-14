import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspace } from '../lib/store'

export default function CreateEntryDialog({ directory, kind, onClose }: {
  directory: string; kind: 'file' | 'folder'; onClose: () => void
}) {
  const ws = useWorkspace()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const previousFocus = useRef(document.activeElement as HTMLElement | null)
  useEffect(() => {
    return () => { if (previousFocus.current?.isConnected) previousFocus.current.focus() }
  }, [])
  const submit = async () => {
    if (running.current) return
    const value = name.trim()
    if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value)) {
      setError('Enter a name without path separators.'); return
    }
    running.current = true; setBusy(true); setError('')
    try {
      const destination = kind === 'file'
        ? await window.nalu.createFile(directory, value)
        : await window.nalu.mkdir(directory, value)
      ws.refresh()
      if (kind === 'file') await ws.openFile(destination, value)
      onClose()
    } catch (failure) { setError(String(failure)) }
    finally { running.current = false; setBusy(false) }
  }
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={e => e.stopPropagation()}>
      <form role="dialog" aria-modal="true" aria-labelledby="create-entry-title"
        onSubmit={e => { e.preventDefault(); void submit() }}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape' && !busy) onClose()
          if (e.key === 'Tab') {
            const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)'))
            const index = controls.indexOf(document.activeElement as HTMLElement)
            e.preventDefault()
            controls[(index + (e.shiftKey ? controls.length - 1 : 1)) % controls.length]?.focus()
          }
        }} className="w-[380px] rounded-xl border border-glass/[0.12] bg-panel p-5 shadow-2xl">
        <h2 id="create-entry-title" className="mb-1 text-sm font-medium text-ink">New {kind}</h2>
        <p className="mb-3 truncate text-xs text-dim" title={directory}>{directory}</p>
        <input aria-label="Name" autoFocus disabled={busy} value={name} onChange={e => setName(e.target.value)}
          className="w-full rounded-md border border-glass/[0.15] bg-black/20 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60" />
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-dim">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-md bg-gold/90 px-3 py-1.5 text-xs text-[#15170f] disabled:opacity-50">{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </div>, document.body,
  )
}
