import { useEffect, useState } from 'react'
import { X, LogOut, Check } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import wolfUrl from '../lib/wolf'
import { currentUser, fetchMe, signIn, signUp, signOut, getToken, setToken, type NaluUser } from '../lib/naluApi'
import { REASONING_LEVELS, REASONING_DESC, getModelSettings, setModelSettings, type ReasoningLevel } from '../lib/settings'

const TOKEN_PRESETS = [
  { label: '4k', value: 4096 },
  { label: '8k', value: 8192 },
  { label: '16k', value: 16000 },
  { label: '32k', value: 32000 },
]

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
  const [{ reasoning, maxTokens, webSearch, streaming }, setModel] = useState(getModelSettings())
  const pickReasoning = (r: ReasoningLevel) => setModel(setModelSettings({ reasoning: r }))
  const pickTokens = (v: number) => setModel(setModelSettings({ maxTokens: v }))
  const toggleWeb = () => setModel(setModelSettings({ webSearch: !webSearch }))
  const toggleStream = () => setModel(setModelSettings({ streaming: !streaming }))

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
        <div className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Reasoning &amp; capacity</div>
        <div className="rounded-xl border border-glass/[0.1] bg-panel2 p-3.5 space-y-4">
          <div>
            <div className="mb-2 text-[12px] font-medium text-ink">Reasoning level</div>
            <div className="grid grid-cols-4 gap-1.5">
              {REASONING_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => pickReasoning(lvl)}
                  className={`rounded-lg py-1.5 text-[12px] font-medium capitalize ${reasoning === lvl ? 'bg-gold text-[#15170f]' : 'bg-glass/5 text-dim hover:bg-glass/10'}`}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-dim">{REASONING_DESC[reasoning]}</div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink">Token capacity</span>
              <span className="text-[11px] tabular-nums text-dim">{maxTokens.toLocaleString()} tokens</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {TOKEN_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => pickTokens(p.value)}
                  className={`rounded-lg py-1.5 text-[12px] font-medium ${maxTokens === p.value ? 'bg-gold text-[#15170f]' : 'bg-glass/5 text-dim hover:bg-glass/10'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Web &amp; streaming</div>
        <div className="divide-y divide-glass/[0.08] rounded-xl border border-glass/[0.1] bg-panel2">
          <ToggleRow title="Web search" desc="Search the live web when it helps" on={webSearch} onToggle={toggleWeb} />
          <ToggleRow title="Stream replies" desc={streaming ? 'Type out live as they generate' : 'Appear all at once when ready'} on={streaming} onToggle={toggleStream} />
        </div>

        <div className="mt-4 text-[11px] text-dim">Nalu Desktop 0.1.0 — the Nalu app, on your computer.</div>
      </div>
    </div>
  )
}

function ToggleRow({ title, desc, on, onToggle }: { title: string; desc: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-ink">{title}</div>
        <div className="text-[11px] text-dim">{desc}</div>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        aria-label={title}
        className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-gold' : 'bg-glass/20'}`}
      >
        <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`} />
      </button>
    </div>
  )
}
