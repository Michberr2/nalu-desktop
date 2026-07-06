import Editor, { type Monaco } from '@monaco-editor/react'
import { X } from 'lucide-react'
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

// Nalu's exact dark palette as a Monaco theme.
function defineTheme(monaco: Monaco) {
  monaco.editor.defineTheme('nalu', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5f6672', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'af8c56' },
      { token: 'string', foreground: 'b6c39a' },
      { token: 'number', foreground: 'd6a15e' },
      { token: 'type', foreground: '9db4d0' },
      { token: 'function', foreground: 'e6c98a' },
    ],
    colors: {
      'editor.background': '#0b0c10',
      'editor.foreground': '#ededed',
      'editorLineNumber.foreground': '#3a3f4a',
      'editorLineNumber.activeForeground': '#8e8e8e',
      'editor.selectionBackground': '#af8c5633',
      'editor.lineHighlightBackground': '#13151b',
      'editorCursor.foreground': '#af8c56',
      'editorIndentGuide.background1': '#1b1e26',
      'editorWidget.background': '#11141c',
      'editorGutter.background': '#0b0c10',
      'scrollbarSlider.background': '#ffffff10',
      'minimap.background': '#0b0c10',
    },
  })
}

export default function EditorArea() {
  const ws = useWorkspace()

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* tabs */}
      {ws.tabs.length > 0 && (
        <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-glass/[0.08] bg-panel">
          {ws.tabs.map((t) => {
            const activeT = t.path === ws.activePath
            return (
              <div
                key={t.path}
                onClick={() => ws.setActive(t.path)}
                className={`group flex cursor-pointer items-center gap-1.5 border-r border-glass/[0.06] px-3 text-[12px] ${
                  activeT ? 'bg-canvas text-ink' : 'text-dim hover:text-ink'
                }`}
              >
                {activeT && <span className="absolute -mt-8 h-0.5 w-full" />}
                <FileIcon name={t.name} dir={false} />
                <span className="max-w-[10rem] truncate">{t.name}</span>
                {t.dirty ? (
                  <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-gold" />
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); ws.closeTab(t.path) }}
                    className="ml-0.5 rounded p-0.5 text-dim opacity-0 hover:bg-glass/10 hover:text-ink group-hover:opacity-100"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* editor */}
      <div className="min-h-0 flex-1">
        {ws.active ? (
          <Editor
            key={ws.active.path}
            path={ws.active.path}
            language={langOf(ws.active.name)}
            value={ws.active.content}
            theme="nalu"
            beforeMount={defineTheme}
            onChange={(v) => ws.editActive(v ?? '')}
            options={{
              fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
              fontSize: 13,
              lineHeight: 21,
              minimap: { enabled: true, scale: 1 },
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
