import { useWorkspace } from '../lib/store'
import '../lib/monaco'
import { DiffEditor } from '@monaco-editor/react'
import type { FileChangePreview } from '../lib/agent'

export default function ChangePreview({ preview, hasUnsavedEdits = false, source = 'disk' }: { preview: FileChangePreview; hasUnsavedEdits?: boolean; source?: 'disk' | 'editor' }) {
  const { appearance } = useWorkspace()
  return <section aria-label={`Proposed changes to ${preview.path}`} className="mb-2 overflow-hidden rounded border border-glass/10">
    <div className="px-2 py-1 text-[11px] text-dim">{preview.before === null ? 'New file' : source === 'editor' ? 'Editor contents → proposed version' : 'Disk version → proposed version'}</div>
    {hasUnsavedEdits && source === 'disk' && <div role="alert" className="px-2 py-1 text-[11px] text-amber-300">This file has unsaved edits in the editor. This proposal changes the disk version.</div>}
    <DiffEditor height={`${Math.min(260, Math.max(130, (Math.max((preview.before || '').split('\n').length, preview.after.split('\n').length) + 3) * 19))}px`} original={preview.before ?? ''} modified={preview.after} theme={appearance === 'pastel' ? 'nalu-pastel' : 'nalu'}
      options={{ readOnly: true, originalEditable: false, renderSideBySide: false, minimap: { enabled: false }, fontSize: 11,
        scrollBeyondLastLine: false, automaticLayout: true, renderIndicators: true, diffWordWrap: 'on' }} />
  </section>
}
