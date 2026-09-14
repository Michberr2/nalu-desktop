import { constants, promises as fs } from 'node:fs'

export const EDITOR_FILE_LIMIT = 10 * 1024 * 1024

/** Bound both growing files and special-file reads before sending text to Monaco. */
export async function readTextFile(file: string): Promise<string> {
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK || 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Only regular text files can be opened in the editor.')
    const tooLarge = () => new Error('This file exceeds the editor’s 10 MiB text limit. Open a smaller file or use the terminal to inspect it.')
    if (stat.size > EDITOR_FILE_LIMIT) throw tooLarge()
    // Preserve a UTF-8 BOM so an ordinary save does not silently remove it.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    const buffer = Buffer.allocUnsafe(64 * 1024)
    const parts: string[] = []
    let total = 0
    const unsupported = () => new Error('This file contains binary data or is not valid UTF-8 text. It cannot be edited safely here.')
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, EDITOR_FILE_LIMIT + 1 - total), null)
      if (!bytesRead) break
      total += bytesRead
      if (total > EDITOR_FILE_LIMIT) throw tooLarge()
      const chunk = buffer.subarray(0, bytesRead)
      if (chunk.includes(0)) throw unsupported()
      try { parts.push(decoder.decode(chunk, { stream: true })) }
      catch { throw unsupported() }
    }
    try { parts.push(decoder.decode()) }
    catch { throw unsupported() }
    return parts.join('')
  } finally {
    await handle.close()
  }
}
