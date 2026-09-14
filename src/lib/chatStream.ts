export async function consumeChatStream(response: Response, opts: {
  onDelta: (text: string) => void
  onRoute?: (name: string) => void
  signal?: AbortSignal
}): Promise<void> {
  if (!response.ok) throw new Error(`Nalu request failed (HTTP ${response.status}).`)
  if (!response.body) throw new Error('Nalu returned no response stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', completed = false
  const abort = () => { void reader.cancel().catch(() => {}) }
  opts.signal?.addEventListener('abort', abort, { once: true })
  const checkAbort = () => {
    if (opts.signal?.aborted) throw new DOMException('Task cancelled', 'AbortError')
  }
  const event = (frame: string) => {
    const lines = frame.split('\n')
    const kind = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
    const dataLines = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, ''))
    if (!dataLines.length) return
    let data: { text?: string; name?: string; message?: string; ok?: boolean }
    try { data = JSON.parse(dataLines.join('\n')) }
    catch { throw new Error('Nalu returned a malformed stream event.') }
    if (!data || typeof data !== 'object') throw new Error('Nalu returned an invalid stream event.')
    if (kind === 'error') throw new Error(typeof data.message === 'string' ? data.message : 'Nalu could not finish the response.')
    if (kind === 'done') {
      if (data.ok !== true) throw new Error('Nalu could not finish the response.')
      completed = true
    } else if (kind === 'delta' && typeof data.text === 'string') opts.onDelta(data.text)
    else if (kind === 'route' && typeof data.name === 'string') opts.onRoute?.(data.name)
  }
  try {
    checkAbort()
    while (!completed) {
      const { done, value } = await reader.read()
      checkAbort()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      // Keep a trailing CR until the next chunk so split CRLF stays intact.
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2)
        if (completed) break
      }
      if (buffer.length > 1_000_000) throw new Error('Nalu returned an oversized stream event.')
      if (done) {
        if (!completed && buffer.trim()) event(buffer)
        break
      }
    }
    if (!completed) throw new Error('Nalu response ended before completion. Please retry.')
  } finally {
    opts.signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
