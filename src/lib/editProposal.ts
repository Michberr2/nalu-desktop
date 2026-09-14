// Require one complete outer fence. This also handles Markdown files whose
// contents contain shorter fences, without silently applying a truncated file.
export function extractProposedFile(text: string): string | null {
  const match = text.trim().match(/^(`{3,}|~{3,})[^\n]*\r?\n([\s\S]*)$/)
  if (!match) return null
  const lines = match[2].split('\n')
  if (lines.at(-1)?.trim() !== match[1]) return null
  lines.pop()
  if (lines.some(line => line.trim() === match[1])) return null
  return lines.join('\n')
}
