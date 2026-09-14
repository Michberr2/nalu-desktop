// Talks to the SAME hosted Nalu backend the web app uses. The model plans in
// the cloud; keys never live in the desktop binary — only the user's bearer
// token (stored locally after they sign in on n4lu.ai).

import { consumeChatStream } from './chatStream'
import { getModelSettings } from './settings'
import { syncBodies } from './syncPayload'

// Cloudflare D1/R2 are accessed through this authenticated shared API.
// Database credentials belong on the server, never in the desktop application.
export const API_BASE = 'https://n4lu.ai'

export function getToken(): string {
  return localStorage.getItem('nalu-token') || ''
}
export function setToken(t: string): void {
  if (t !== getToken()) localStorage.removeItem('nalu-user')
  localStorage.setItem('nalu-token', t)
  syncCliConfig(true)
}

// Push the Nalu token (+ any frontier keys the user set) to ~/.nalu/cli.json so the
// terminal `nalu`, `claude`, and `gpt` commands can authenticate. Frontier keys are
// stored under 'nalu-supercharge' when the user configures Supercharge.
export function syncCliConfig(clearSession = false): void {
  try {
    const boost = JSON.parse(localStorage.getItem('nalu-supercharge') || '{}') as Record<string, unknown>
    const token = getToken()
    // A signed-out window opening must not erase a standalone CLI session.
    // Explicit token changes and sign-out still clear it when requested.
    // Opening a fresh desktop profile must not replace standalone CLI choices
    // with UI defaults. A preference saved in Settings is an explicit choice.
    const { reasoning, maxTokens, webSearch } = getModelSettings()
    const model = localStorage.getItem('nalu-model-settings') !== null ? { reasoning, maxTokens, webSearch } : {}
    void window.nalu?.cliSync?.({ ...boost, ...model, apiBase: API_BASE, ...(token || clearSession ? { token } : {}) })
  } catch { /* desktop-only, best-effort */ }
}

// ---- Auth: the SAME accounts + sessions table as n4lu.ai. Signing in here with
// your web email/password mints a session tied to the exact same DB user, so the
// AI, specialists, quotas, and saved data are identical to the browser. --------
export type NaluUser = { id: string; displayName: string; phone?: string | null }

export function currentUser(): NaluUser | null {
  try { return JSON.parse(localStorage.getItem('nalu-user') || 'null') } catch { return null }
}

type AuthResponse = { ok?: boolean; error?: string; user?: NaluUser | null; token?: string; status: number }
const ACCOUNT_UNAVAILABLE = 'Nalu’s account service is temporarily unavailable. Sign-in and account sync cannot finish right now. Please try again shortly.'

async function authRequest(action: string, body: Record<string, unknown>): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: JSON.stringify({ action, ...body }),
  })
  const data = await res.json().catch(() => ({ ok: false, error: 'Could not read the account service response.' }))
  const error = res.status >= 500 || /data transfer quota/i.test(data.error || '')
    ? ACCOUNT_UNAVAILABLE : data.error
  return { ...data, ok: res.ok && data.ok === true, error, status: res.status }
}

export async function signIn(email: string, password: string): Promise<{ ok: boolean; error?: string; user?: NaluUser }> {
  const d = await authRequest('signin', { email, password })
  if (d.ok && d.token && d.user) { setToken(d.token); localStorage.setItem('nalu-user', JSON.stringify(d.user)) }
  return { ok: !!d.ok, error: d.error, user: d.user ?? undefined }
}

export async function signUp(email: string, password: string, displayName?: string): Promise<{ ok: boolean; error?: string; user?: NaluUser }> {
  const d = await authRequest('signup', { email, password, displayName })
  if (d.ok && d.token && d.user) { setToken(d.token); localStorage.setItem('nalu-user', JSON.stringify(d.user)) }
  return { ok: !!d.ok, error: d.error, user: d.user ?? undefined }
}

// Verify the stored token still maps to a live user (same DB row as the browser).
export async function fetchMe(): Promise<NaluUser | null> {
  const token = getToken()
  if (!token) return null
  const d = await authRequest('me', {})
  // A delayed check must never restore an account after sign-out or a token change.
  if (getToken() !== token) return currentUser()
  if (d.status === 401 || d.status === 403 || (d.status === 200 && !d.error && d.user === null)) {
    signOut()
    return null
  }
  if (d.status !== 200 || d.error || !d.user?.id) throw new Error(d.error || 'Could not verify your account. Your saved session has been kept; try again shortly.')
  localStorage.setItem('nalu-user', JSON.stringify(d.user))
  return d.user
}

// Update the signed-in user's profile (display name and/or phone). Pass phone: ''
// to clear it. Caches the refreshed user locally and returns it.
export async function updateProfile(patch: { displayName?: string; phone?: string }): Promise<{ ok: boolean; error?: string; user?: NaluUser }> {
  const d = await authRequest('update-profile', patch)
  if (d.ok && d.user) localStorage.setItem('nalu-user', JSON.stringify(d.user))
  return { ok: !!d.ok, error: d.error, user: d.user ?? undefined }
}

// Ask Nalu to phone the signed-in user's saved number (or an explicit `to`).
export async function placeCall(opts: { message?: string; to?: string; voice?: 'britishWoman' | 'britishMan' } = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: JSON.stringify(opts),
    })
    const d = await res.json().catch(() => ({}))
    return { ok: !!d.ok, error: d.error }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export function signOut(): void {
  void authRequest('signout', {}).catch(() => {})
  localStorage.removeItem('nalu-token')
  localStorage.removeItem('nalu-user')
  syncCliConfig(true)
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type WireMessage = { role: 'user' | 'assistant' | 'system'; content: string | Part[] }

// ---- The user's Studio data — the SAME chats as the website (/api/data). ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChatMsg = { role: 'user' | 'assistant'; content: string; reasoning?: string; specialist?: string; doc?: any; sheet?: any; deck?: any; design?: any; cad?: string; video?: string }
export type Chat = { id: string; title: string; messages: ChatMsg[]; createdAt: number; projectId?: string }

export async function loadUserData(): Promise<Record<string, unknown>> {
  const token = getToken()
  if (!token) return {}
  const res = await fetch(`${API_BASE}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'load', token }),
  })
  const d = await res.json().catch(() => null)
  if (getToken() !== token) throw new Error('Your account changed. Reload your chats.')
  if (!res.ok || !d?.data || typeof d.data !== 'object' || Array.isArray(d.data)) {
    throw new Error(res.status >= 500 ? ACCOUNT_UNAVAILABLE : d?.error || 'Could not load your saved chats. Please try again.')
  }
  return d.data
}

export async function loadChats(): Promise<Chat[]> {
  const data = await loadUserData()
  let raw = data['nalu-chats']
  if (raw === undefined || raw === null) return []
  if (typeof raw === 'string') raw = JSON.parse(raw)
  if (!Array.isArray(raw)) throw new Error('Could not read your saved chats. Please try again.')
  return raw.filter((c) => c && c.id) as Chat[]
}

// Match the website's bounded, compressed sync requests. The shared server
// merges chats and preserves artifacts; an omitted chat never means deletion.
export async function saveChats(chats: Chat[], token = getToken()): Promise<void> {
  if (!token) return
  const bodies = await syncBodies({ 'nalu-chats': JSON.stringify(chats) }, token)
  for (const body of bodies) {
    if (getToken() !== token) throw new Error('Your account changed. This save was stopped.')
    const res = await fetch(`${API_BASE}/api/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || data?.ok !== true) throw new Error(res.status >= 500 ? ACCOUNT_UNAVAILABLE : data?.error || 'Your chats could not be saved. Please retry.')
  }
}

// ---- AutoPilot ledger: log IDE tasks to the shared per-user backend so they show
// up live in the mobile AutoPilot screen (source 'desktop'). Reuse the returned
// id to append progress/events. Best-effort — no token or offline → silent no-op.
export type LoggedTask = { id: string }
export async function logTask(t: {
  id?: string
  title?: string
  detail?: string
  status?: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress?: number
  event?: string
}): Promise<LoggedTask | null> {
  if (!getToken()) return null
  try {
    const res = await fetch(`${API_BASE}/api/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ action: 'task-log', token: getToken(), source: 'desktop', ...t }),
    })
    if (!res.ok) return null
    const d = (await res.json().catch(() => null)) as { task?: LoggedTask } | null
    return d?.task ?? null
  } catch {
    return null
  }
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
    webSearch?: boolean
    maxTokens?: number
    onRoute?: (name: string) => void
    onDelta: (text: string) => void
    signal?: AbortSignal
  },
): Promise<void> {
  // The shared API removes system-role messages. It accepts client instructions
  // in systemPrompt instead (the same contract used by mobile and the browser).
  const systemPrompt = messages.filter(message => message.role === 'system').map(message =>
    typeof message.content === 'string' ? message.content : message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'),
  ).join('\n\n')
  const settings = getModelSettings()
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify({
      messages: messages.filter(message => message.role !== 'system'),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(opts.specialist ? { specialist: opts.specialist } : {}),
      reasoning: settings.reasoning,
      maxTokens: opts.maxTokens ?? settings.maxTokens,
      webSearch: opts.webSearch ?? settings.webSearch,
    }),
    signal: opts.signal,
  })
  await consumeChatStream(res, opts)
}
