// Talks to the SAME hosted Nalu backend the web app uses. The model plans in
// the cloud; keys never live in the desktop binary — only the user's bearer
// token (stored locally after they sign in on n4lu.ai).

export const API_BASE = 'https://n4lu.ai'

export function getToken(): string {
  return localStorage.getItem('nalu-token') || ''
}
export function setToken(t: string): void {
  localStorage.setItem('nalu-token', t)
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type WireMessage = { role: 'user' | 'assistant' | 'system'; content: string | Part[] }

// Build a user message carrying an image (for the vision model / computer use).
export function imageMessage(text: string, dataUrl: string): WireMessage {
  return { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: dataUrl } }] }
}

// Stream a chat/agent completion from Nalu. Calls onDelta with answer text as it
// arrives and onRoute with the specialist that answered.
export async function streamChat(
  messages: WireMessage[],
  opts: {
    specialist?: string
    onRoute?: (name: string) => void
    onDelta: (text: string) => void
    signal?: AbortSignal
  },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify({ messages, ...(opts.specialist ? { specialist: opts.specialist } : {}) }),
    signal: opts.signal,
  })
  if (!res.body) throw new Error('no response stream')

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() || ''
    for (const evt of events) {
      const lines = evt.split('\n')
      const type = lines.find((l) => l.startsWith('event:'))?.slice(6).trim()
      const dataLine = lines.find((l) => l.startsWith('data:'))?.slice(5).trim()
      if (!dataLine) continue
      try {
        const data = JSON.parse(dataLine)
        if (type === 'route' && data.name) opts.onRoute?.(data.name)
        else if (type === 'delta' && typeof data.text === 'string') opts.onDelta(data.text)
      } catch {
        /* skip malformed */
      }
    }
  }
}
