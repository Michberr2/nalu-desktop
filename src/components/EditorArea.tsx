import '../lib/monaco' // load Monaco locally (bundled), not from a CDN
import Editor, { type Monaco } from '@monaco-editor/react'
import { X, Sparkles, Save } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import FileIcon from './FileIcon'
import Welcome from './Welcome'

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown', py: 'python', rs: 'rust', go: 'go',
  java: 'java', c: 'c', cpp: 'cpp', sh: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql', toml: 'ini',
}
function langOf(name: string): string {
  return LANG[name.split('.').pop()?.toLowerCase() || ''] || 'plaintext'
}

import { useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'

export default function EditorArea() {
  const ws = useWorkspace()
  const edRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const modelPaths = useRef(new Set<string>())
  useEffect(() => {
    const current = new Set(ws.tabs.map(tab => tab.path))
    const monaco = monacoRef.current
    if (monaco) for (const previous of modelPaths.current) {
      if (!current.has(previous)) monaco.editor.getModel(monaco.Uri.parse(previous))?.dispose()
    }
    modelPaths.current = current
  }, [ws.tabs])
  const appliedReveal = useRef<typeof ws.reveal>(null)

  // Navigation is an event, not a render side effect. Reapplying it during
  // autosave or polling would move the user's cursor away from their edits.
  useEffect(() => {
    const ed = edRef.current
    if (!ed || !ws.reveal || appliedReveal.current === ws.reveal || ws.reveal.path !== ws.activePath || ed.getModel()?.uri.path !== ws.reveal.path) return
    appliedReveal.current = ws.reveal
    ed.revealLineInCenter(ws.reveal.line)
    ed.setPosition({ lineNumber: ws.reveal.line, column: 1 })
    ed.focus()
  }, [ws.reveal, ws.activePath])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* tabs — soft rounded chips, Nalu website style */}
      {ws.tabs.length > 0 && (
        <div className="editor-tabs" role="tablist" aria-label="Open files">
          {ws.tabs.map((t) => {
            const activeT = t.path === ws.activePath
            return (
              <div
                key={t.path}
                role="tab" tabIndex={activeT ? 0 : -1} aria-selected={activeT} aria-label={t.name}
                onKeyDown={e => { if(e.target !== e.currentTarget)return; if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ws.setActive(t.path) } if(e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const index=ws.tabs.indexOf(t),next=ws.tabs[(index+(e.key === 'ArrowRight' ? 1 : ws.tabs.length-1))%ws.tabs.length]; ws.setActive(next.path); (e.currentTarget.parentElement?.querySelector(`[aria-label="${CSS.escape(next.name)}"]`) as HTMLElement)?.focus() } }}
                onClick={() => ws.setActive(t.path)}
                className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                  activeT ? 'bg-canvas text-ink shadow-sm' : 'text-dim hover:bg-glass/[0.05] hover:text-ink'
                }`}
              >
                <FileIcon name={t.name} dir={false} />
                <span className="max-w-[10rem] truncate">{t.name}</span>
                {t.dirty && <span aria-label="Unsaved changes" className="ml-0.5 h-1.5 w-1.5 rounded-full bg-gold" />}
                <button
                  title={t.dirty ? `Save and close ${t.name}` : `Close ${t.name}`}
                  aria-label={`Close ${t.name}`}
                  onClick={(e) => { e.stopPropagation(); void ws.closeTab(t.path) }}
                  className="ml-0.5 rounded p-0.5 text-dim opacity-0 hover:bg-glass/10 hover:text-ink group-hover:opacity-100 focus:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {ws.active && <div className="editor-context-bar"><span title={ws.active.path}>{ws.folder && ws.active.path.startsWith(ws.folder + '/') ? ws.active.path.slice(ws.folder.length + 1) : ws.active.name}</span><div><button aria-label="Edit file with Nalu" onClick={() => window.dispatchEvent(new CustomEvent('nalu:compose', { detail: { mode: 'edit' } }))}><Sparkles size={12}/> Edit with Nalu</button><button aria-label="Save file" title="Save (⌘S)" onClick={() => void ws.saveActive()}><Save size={12}/><span>Save</span></button></div></div>}
      {ws.recoveryError && <div role="alert" className="px-3 py-2 text-xs text-red-300">{ws.recoveryError}</div>}
      {ws.openError && <div role="alert" className="flex items-start gap-3 px-3 py-2 text-xs text-red-300">
        <span className="min-w-0 flex-1 break-words">Could not open {ws.openError.name}: {ws.openError.message}</span>
        <button onClick={() => { if (ws.openError) void ws.openFile(ws.openError.path, ws.openError.name) }}>Retry open</button>
        <button onClick={ws.dismissOpenError}>Dismiss</button>
      </div>}
      {ws.active?.detached && <div role="status" className="flex items-center gap-3 bg-amber-400/10 px-3 py-2 text-xs">
        <span className="flex-1">File moved to Trash. Your unsaved edits are preserved.</span>
        <button onClick={() => void ws.saveActiveAs()} className="text-gold">Save as…</button>
      </div>}
      {ws.active?.recovered && !ws.active.detached && <div role="status" className="flex items-center gap-3 bg-amber-400/10 px-3 py-2 text-xs">
        <span className="flex-1">Recovered unsaved edits. Review them before saving.</span>
        <button onClick={() => void ws.saveActiveAs()} className="text-gold">Save as…</button>
        {ws.active.diskConflict === undefined && <button onClick={() => void ws.saveActive()} className="text-gold">Save recovered edits</button>}
      </div>}
      {ws.active?.diskConflict !== undefined && <div role="alert" className="flex items-center gap-3 border-y border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs">
        <span className="flex-1">This file changed on disk. Your unsaved edits are preserved.</span>
        <button onClick={ws.useDiskVersion} className="text-gold">Use disk version</button>
        <button onClick={() => void ws.saveActive(true)} className="text-gold">Overwrite with my edits</button>
      </div>}
      {ws.active?.saveError && <div role="alert" className="flex gap-3 px-3 py-2 text-xs text-red-300">
        <span className="flex-1">Save failed: {ws.active.saveError}</span>
        {!ws.active.detached && <button onClick={() => void ws.saveActive()}>Retry save</button>}
        {!ws.active.recovered && <button onClick={() => void ws.saveActiveAs()}>Save as…</button>}
      </div>}

      {/* editor — the code surface, an inset rounded panel inside the card */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-t-xl border-t border-glass/[0.05]">
        {ws.active ? (
          <Editor
            path={ws.active.path}
            language={langOf(ws.active.name)}
            value={ws.active.content}
            theme={ws.appearance === 'pastel' ? 'nalu-pastel' : 'nalu'}
            beforeMount={(monaco) => { monacoRef.current = monaco }}
            onMount={(ed) => {
              edRef.current = ed
              if (ws.reveal && appliedReveal.current !== ws.reveal && ws.reveal.path === ws.activePath) {
                appliedReveal.current = ws.reveal
                ed.revealLineInCenter(ws.reveal.line)
                ed.setPosition({ lineNumber: ws.reveal.line, column: 1 })
                ed.focus()
              }
            }}
            onChange={(v) => ws.editActive(v ?? '')}
            options={{
              fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
              fontSize: 13,
              lineHeight: 21,
              minimap: { enabled: true, scale: 1, maxColumn: 70 },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              padding: { top: 12 },
              scrollBeyondLastLine: false,
              renderLineHighlight: 'all',
              fontLigatures: true,
              tabSize: 2,
            }}
          />
        ) : (
          <Welcome />
        )}
      </div>
    </div>
  )
}
