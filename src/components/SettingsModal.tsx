import { useEffect, useState } from 'react'
import { X, LogOut, Check } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import wolfUrl from '../lib/wolf'
import { currentUser, fetchMe, signIn, signUp, signOut, getToken, setToken, type NaluUser } from '../lib/naluApi'

export default function SettingsModal() {
  const ws = useWorkspace()
  const [user, setUser] = useState<NaluUser | null>(currentUser())
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [tok, setTok] = useState(getToken())
  const [savedTok, setSavedTok] = useState(false)

  // Confirm the stored session still maps to the same DB user (sync check).
  useEffect(() => { if (getToken()) fetchMe().then((u) => setUser(u)) }, [])

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const r = mode === 'signin' ? await signIn(email.trim(), password) : await signUp(email.trim(), password, name.trim() || undefined)
      if (r.ok && r.user) setUser(r.user)
      else setError(r.error || 'Could not sign in.')
    } catch { setError('Network error — check your connection.') }
    finally { setBusy(false) }
  }

  const doSignOut = () => { signOut(); setUser(null); setTok(''); setEmail(''); setPassword('') }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => ws.setSettingsOpen(false)}>
      <div className="w-full max-w-md animate-fadeIn rounded-2xl border border-glass/[0.12] bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Settings</h2>
          <button onClick={() => ws.setSettingsOpen(false)} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={16} /></button>
        </div>

        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Nalu account</div>

        {user ? (
          <div className="rounded-xl border border-glass/[0.1] bg-panel2 p-3.5">
            <div className="flex items-center gap-3">
              <img src={wolfUrl} alt="" className="h-9 w-9 rounded-lg" style={{ filter: 'brightness(0) invert(1)' }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{user.displayName}</div>
                <div className="truncate text-[11px] text-dim">{user.id}</div>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400"><Check size={10} /> synced</span>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-dim">Signed in as the same account as n4lu.ai — same AI, specialists, quotas, and data.</p>
            <button onClick={doSignOut} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-glass/[0.1] px-3 py-2 text-[12px] text-dim hover:bg-glass/5 hover:text-ink"><LogOut size={13} /> Sign out</button>
          </div>
        ) : (
          <>
            <p className="mb-3 text-[12px] leading-relaxed text-dim">Sign in with your n4lu.ai email and password. It's the same account — everything syncs.</p>
            <div className="space-y-2">
              {mode === 'signup' && (
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" className="w-full rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-gold/50" />
              )}
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email or username" autoComplete="username" className="w-full rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-gold/50" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} type="password" placeholder="Password" autoComplete="current-password" className="w-full rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-gold/50" />
            </div>
            {error && <div className="mt-2 text-[11.5px] text-red-400">{error}</div>}
            <button onClick={submit} disabled={busy || !email || !password} className="mt-3 w-full rounded-lg bg-gold/90 px-3 py-2 text-[13px] font-medium text-[#15170f] hover:bg-gold disabled:opacity-50">
              {busy ? 'Signing in…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
            <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }} className="mt-2 w-full text-center text-[11.5px] text-dim hover:text-ink">
              {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
            </button>
          </>
        )}

        <button onClick={() => setShowToken((s) => !s)} className="mt-4 text-[10.5px] text-dim hover:text-ink">{showToken ? 'Hide' : 'Advanced:'} paste a session token</button>
        {showToken && (
          <div className="mt-2">
            <input value={tok} onChange={(e) => setTok(e.target.value)} placeholder="nalu session token" className="w-full rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[12px] text-ink outline-none placeholder:text-dim focus:border-gold/50" />
            <button onClick={async () => { setToken(tok.trim()); setSavedTok(true); setUser(await fetchMe()); setTimeout(() => setSavedTok(false), 1500) }} className="mt-2 w-full rounded-lg border border-glass/[0.12] px-3 py-1.5 text-[12px] text-gold hover:bg-glass/5">{savedTok ? 'Saved ✓' : 'Use token'}</button>
          </div>
        )}
        <div className="mt-4 text-[11px] text-dim">Nalu Desktop 0.1.0 — the Nalu app, on your computer.</div>
      </div>
    </div>
  )
}
