// Load Monaco from the LOCALLY BUNDLED package instead of the jsdelivr CDN.
// Without this, @monaco-editor/react fetches Monaco over the network, so the
// editor breaks with no internet / under the packaged app's CSP. Bundling it
// makes the editor load instantly and work fully offline.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/languages/features/json/json.worker?worker'
import cssWorker from 'monaco-editor/languages/features/css/css.worker?worker'
import htmlWorker from 'monaco-editor/languages/features/html/html.worker?worker'
import tsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'

;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })

monaco.editor.defineTheme('nalu', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7d8798', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'af8c56' },
      { token: 'string', foreground: 'b6c39a' },
      { token: 'number', foreground: 'd6a15e' },
      { token: 'type', foreground: '9db4d0' },
      { token: 'function', foreground: 'e6c98a' },
    ],
    colors: {
      'editor.background': '#14171d',
      'editor.foreground': '#ededed',
      'editorLineNumber.foreground': '#596171',
      'editorLineNumber.activeForeground': '#8e8e8e',
      'editor.selectionBackground': '#af8c5633',
      'editor.lineHighlightBackground': '#13151b',
      'editorCursor.foreground': '#af8c56',
      'editorIndentGuide.background1': '#1b1e26',
      'editorWidget.background': '#11141c',
      'editorGutter.background': '#14171d',
      'scrollbarSlider.background': '#ffffff10',
      'minimap.background': '#14171d',
    },
  })

monaco.editor.defineTheme('nalu-pastel', {
  base: 'vs', inherit: true,
  rules: [
    { token: 'comment', foreground: '8A7C68', fontStyle: 'italic' },
    { token: 'keyword', foreground: '8C6742' },
    { token: 'string', foreground: '7A6744' },
    { token: 'number', foreground: '936439' },
    { token: 'type', foreground: '537C99' },
  ],
  colors: {
    'editor.background': '#FFFCF7', 'editor.foreground': '#403B34',
    'editorGutter.background': '#FFFCF7', 'minimap.background': '#FFFCF7',
    'editorLineNumber.foreground': '#A79E91', 'editorLineNumber.activeForeground': '#766B5B',
    'editor.selectionBackground': '#E9DCCA', 'editor.lineHighlightBackground': '#F6F0E5',
    'editorCursor.foreground': '#93784E', 'editorIndentGuide.background1': '#ECE4D7',
    'editorWidget.background': '#FCF8F0', 'scrollbarSlider.background': '#BDAF9733',
  },
})

monaco.editor.defineTheme('nalu-avatar', {
  base: 'vs', inherit: true,
  rules: [{token:'comment',foreground:'909098',fontStyle:'italic'},{token:'keyword',foreground:'926E2D'},{token:'string',foreground:'48745D'},{token:'number',foreground:'956330'},{token:'type',foreground:'526B86'}],
  colors: {'editor.background':'#FFFFFF','editor.foreground':'#232326','editorGutter.background':'#FFFFFF','minimap.background':'#FFFFFF','editorLineNumber.foreground':'#B0B0B8','editorLineNumber.activeForeground':'#727279','editor.selectionBackground':'#EDE5D6','editor.lineHighlightBackground':'#F6F6F7','editorCursor.foreground':'#A67B29','editorIndentGuide.background1':'#EBEBEF','editorWidget.background':'#F6F6F7','scrollbarSlider.background':'#CCCCD355'},
})
