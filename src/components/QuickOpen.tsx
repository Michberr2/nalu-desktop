import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { FileText } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { CONTEXT_INDEX_LIMIT, indexWorkspace } from '../lib/workspaceIndex'
import { matchFiles } from '../lib/quickOpen'

export default function QuickOpen() {
  const ws = useWorkspace()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [status, setStatus] = useState('Finding project files…')
  const close = () => ws.setQuickOpen(false)
  useLayoutEffect(() => {
    dialog.current?.showModal()
    input.current?.focus()
    return () => dialog.current?.close()
  }, [])
  useLayoutEffect(() => {
    const controller = new AbortController()
    setQuery(''); setFiles([])
    setStatus(ws.folder ? 'Finding project files…' : 'Open a folder to search project files.')
    if (ws.folder) void indexWorkspace(ws.folder, window.nalu.readDir, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setFiles(result.files)
      setStatus([result.limited ? `Index limited to ${CONTEXT_INDEX_LIMIT} entries.` : '', result.unreadable ? 'Some folders could not be read.' : ''].filter(Boolean).join(' '))
    }, error => {
      if (!controller.signal.aborted) setStatus(`Could not list files: ${String(error).replace(/^Error:\s*/, '').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')}`)
    })
    return () => controller.abort()
  }, [ws.folder])
  const matches = useMemo(() => matchFiles(files, query), [files, query])
  const open = (relative: string) => {
    if (!ws.folder) return
    const separator = ws.folder.includes('\\') ? '\\' : '/'
    void ws.openFile(ws.folder.replace(/[\\/]+$/, '') + separator + relative.replace(/\//g, separator), relative.split('/').pop()!)
    close()
  }
  return <dialog ref={dialog} aria-label="Open project file" onCancel={close}
    onClick={event => { if (event.target === event.currentTarget) close() }}
    className="fixed top-[15vh] m-0 mx-auto w-[min(90vw,640px)] overflow-hidden rounded-xl border border-glass/[0.12] bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/50">
    <Command loop shouldFilter={false} onClick={event => event.stopPropagation()}>
      <div className="flex items-center gap-2 border-b border-glass/[0.08] px-3">
        <Command.Input ref={input} autoFocus aria-label="Search project files" placeholder="Search files by name or path…" value={query} onValueChange={setQuery}
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-dim" />
        <button onClick={close} aria-label="Close file search" className="text-xs text-dim">Esc</button>
      </div>
      {status && <div role="status" className="px-3 py-2 text-xs text-dim">{status}</div>}
      <Command.List className="max-h-80 overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-4 text-sm text-dim">No matching files.</Command.Empty>
        {matches.map(file => <Command.Item key={file} value={file} onSelect={() => open(file)}
          className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm data-[selected=true]:bg-glass/[0.1]">
          <FileText size={14} className="shrink-0 text-gold" /><span className="truncate">{file}</span>
        </Command.Item>)}
      </Command.List>
      <div className="border-t border-glass/[0.08] px-3 py-2 text-xs text-dim">↑↓ to select · Enter to open · Up to 100 matches</div>
    </Command>
  </dialog>
}
