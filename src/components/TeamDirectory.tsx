import { useCallback, useEffect, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import { AvatarPageIntro } from './AvatarPresence'
import UtilityDialog from './UtilityDialog'

type Member = { id: string; name: string; role: string; responsibilities: string; extension: number; voice: string; active: boolean }
type Props = { apiBase?: string; readToken: () => string | null }

// Shared team behavior comes from train/api; this is the desktop presentation.
export default function TeamDirectory({ apiBase = '', readToken }: Props) {
  const close = () => setOpen(false)
  const [open, setOpen] = useState(false)
  useEffect(() => { const show = () => setOpen(true); window.addEventListener('nalu:open-team', show); return () => window.removeEventListener('nalu:open-team', show) }, [])
  const [token, setToken] = useState(() => readToken() || '')
  useEffect(() => {
    const check = () => setToken(readToken() || '')
    const timer = setInterval(check, 1000)
    window.addEventListener('storage', check)
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); window.removeEventListener('storage', check); window.removeEventListener('focus', check) }
  }, [readToken])
  return <>
    <button type="button" className="header-text-button" aria-label="Your team" onClick={() => setOpen(true)}><Users size={15}/><span>Team</span></button>
    {open && <UtilityDialog title="Your team" onClose={close}>
      <AvatarPageIntro label="Your team" title="Better together." detail="Your people, your projects. Nalu brings it together."/>
      {token ? <TeamContent key={token} token={token} apiBase={apiBase} readToken={readToken} /> : <p className="text-dim">Sign in to see your team across Nalu apps.</p>}
    </UtilityDialog>}
  </>
}

function TeamContent({ token, apiBase = '', readToken }: Props & { token: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [responsibilities, setResponsibilities] = useState('')
  const mounted = useRef(true)
  const generation = useRef(0)
  const sending = useRef(false)
  const requestId = useRef({ signature: '', id: '' })
  const controllers = useRef(new Set<AbortController>())
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const c of controllers.current) c.abort() } }, [])
  const current = useCallback(() => mounted.current && readToken() === token, [readToken, token])
  const request = useCallback(async (body: Record<string, unknown>) => {
    const controller = new AbortController(); controllers.current.add(controller)
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`${apiBase}/api/team`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: controller.signal })
      const data = await response.json().catch(() => null)
      if (!response.ok || data?.error || !data) throw new Error(data?.error || 'Your team is unavailable. Please try again.')
      return data
    } catch (error) {
      if (controller.signal.aborted) throw new Error('The request timed out. Retry the same role to check whether it was saved.')
      throw error
    } finally { clearTimeout(timer); controllers.current.delete(controller) }
  }, [apiBase, token])
  const refresh = useCallback(async () => {
    const id = ++generation.current
    setLoading(true); setError('')
    try {
      const data = await request({ action: 'list' })
      if (!Array.isArray(data.members)) throw new Error('The team response was incomplete. Please refresh.')
      if (current() && id === generation.current) { setMembers(data.members); setNumber(data.number || '') }
    } catch (e) { if (current() && id === generation.current) setError(e instanceof Error ? e.message : 'Could not load your team.') }
    finally { if (current() && id === generation.current) setLoading(false) }
  }, [request, current])
  useEffect(() => { void refresh() }, [refresh])
  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!current() || sending.current || !name.trim() || !role.trim() || !responsibilities.trim()) return
    const signature = JSON.stringify([name.trim(), role.trim(), responsibilities.trim()])
    if (requestId.current.signature !== signature) requestId.current = { signature, id: `role_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}` }
    sending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const data = await request({ action: 'create', name: name.trim(), role: role.trim(), responsibilities: responsibilities.trim(), workspace: 'auto', requestId: requestId.current.id })
      if (!data.member?.id || !Number.isInteger(data.member.extension)) throw new Error('The role could not be confirmed. Retry to check its status.')
      if (current()) {
        setNotice(`${data.member.name} joined your team at extension ${data.member.extension}.`)
        setName(''); setRole(''); setResponsibilities(''); requestId.current = { signature: '', id: '' }
        await refresh()
      }
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : 'Could not add this role.') }
    finally { sending.current = false; if (current()) setBusy(false) }
  }
  return <div className="space-y-5">
    <div className="team-line-card flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm text-dim">AI colleagues shared across your Nalu apps.</p>
        {number && <p className="mt-2 text-lg text-gold">{number}</p>}
        <p className="mt-1 text-xs text-dim">On a call, say a name or enter an extension followed by #.</p></div>
      <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-glass/10 px-3 py-2 text-xs disabled:opacity-50">{loading ? 'Loading…' : 'Refresh team'}</button>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-400/10 p-3 text-sm text-emerald-200">{notice}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      {members.filter(m => m.active).map(member => <article key={member.id} className="team-member-card">
        <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{member.name}</h3><span className="team-extension">Ext. {member.extension}</span></div>
        <p className="mt-2 text-sm">{member.role}</p><p className="mt-1 text-xs leading-relaxed text-dim">{member.responsibilities}</p>
        <p className="mt-3 text-xs text-dim">Voice: {member.voice.replace('Polly.', '').replace('-Neural', '')}</p>
      </article>)}
    </div>
    <form onSubmit={e => void add(e)} className="team-role-form space-y-3">
      <h3 className="font-semibold">Add a role</h3><p className="text-xs text-dim">An extension and a distinct available voice are assigned automatically.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs"><span>Name</span><input required value={name} onChange={e => setName(e.target.value)} maxLength={60} className="block w-full rounded-lg border border-glass/10 bg-panel2 p-2.5 text-sm" /></label>
        <label className="space-y-1 text-xs"><span>Company role</span><input required value={role} onChange={e => setRole(e.target.value)} maxLength={80} className="block w-full rounded-lg border border-glass/10 bg-panel2 p-2.5 text-sm" /></label>
      </div>
      <label className="block space-y-1 text-xs"><span>Responsibilities</span><textarea required value={responsibilities} onChange={e => setResponsibilities(e.target.value)} maxLength={1200} rows={3} className="block w-full rounded-lg border border-glass/10 bg-panel2 p-2.5 text-sm" /></label>
      <button type="submit" disabled={busy || !name.trim() || !role.trim() || !responsibilities.trim()} className="avatar-primary disabled:opacity-40">{busy ? 'Adding…' : 'Add team member'}</button>
    </form>
  </div>
}
