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

// ---- Auth: the SAME accounts + sessions table as n4lu.ai. Signing in here with
// your web email/password mints a session tied to the exact same DB user, so the
// AI, specialists, quotas, and saved data are identical to the browser. --------
export type NaluUser = { id: string; displayName: string }

export function currentUser(): NaluUser | null {
  try { return JSON.parse(localStorage.getItem('nalu-user') || 'null') } catch { return null }
}

async function authRequest(action: string, body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; user?: NaluUser; token?: string }> {
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: JSON.stringify({ action, ...body }),
  })
  return res.json().catch(() => ({ ok: false, error: 'Network error' }))
}

export async function signIn(email: string, password: string): Promise<{ ok: boolean; error?: string; user?: NaluUser }> {
  const d = await authRequest('signin', { email, password })
  if (d.ok && d.token && d.user) { setToken(d.token); localStorage.setItem('nalu-user', JSON.stringify(d.user)) }
  return { ok: !!d.ok, error: d.error, user: d.user }
}

export async function signUp(email: string, password: string, displayName?: string): Promise<{ ok: boolean; error?: string; user?: NaluUser }> {
  const d = await authRequest('signup', { email, password, displayName })
  if (d.ok && d.token && d.user) { setToken(d.token); localStorage.setItem('nalu-user', JSON.stringify(d.user)) }
  return { ok: !!d.ok, error: d.error, user: d.user }
}

// Verify the stored token still maps to a live user (same DB row as the browser).
export async function fetchMe(): Promise<NaluUser | null> {
  if (!getToken()) return null
  const d = await authRequest('me', {})
  if (d.user) localStorage.setItem('nalu-user', JSON.stringify(d.user))
  return d.user ?? null
}

export function signOut(): void {
  void authRequest('signout', {})
  localStorage.removeItem('nalu-token')
  localStorage.removeItem('nalu-user')
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type WireMessage = { role: 'user' | 'assistant' | 'system'; content: string | Part[] }

// ---- The user's Studio data — the SAME chats as the website (/api/data). ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChatMsg = { role: 'user' | 'assistant'; content: string; reasoning?: string; specialist?: string; doc?: any; sheet?: any; deck?: any; design?: any; cad?: string; video?: string }
export type Chat = { id: string; title: string; messages: ChatMsg[]; createdAt: number; projectId?: string }

export async function loadUserData(): Promise<Record<string, unknown>> {
  if (!getToken()) return {}
  const res = await fetch(`${API_BASE}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ action: 'load', token: getToken() }),
  }).catch(() => null)
  if (!res || !res.ok) return {}
  const d = await res.json().catch(() => ({})) as { data?: Record<string, unknown> }
  return d.data || {}
}

// nalu-chats is stored (double-encoded) as a JSON string in the DB; parse robustly.
export async function loadChats(): Promise<Chat[]> {
  const data = await loadUserData()
  let raw = data['nalu-chats']
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = [] } }
  const arr = Array.isArray(raw) ? raw : []
  return arr.filter((c) => c && c.id) as Chat[]
}

// Save chats back — the server guard preserves every artifact, so continuing a
// conversation from the desktop never drops docs made on the web.
export async function saveChats(chats: Chat[]): Promise<void> {
  if (!getToken()) return
  await fetch(`${API_BASE}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ action: 'set', token: getToken(), key: 'nalu-chats', value: JSON.stringify(chats) }),
  }).catch(() => {})
}

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
