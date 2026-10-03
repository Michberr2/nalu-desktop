import CompanionSettings from './CompanionSettings'
import { useEffect, useRef, useState } from 'react'
import { X, LogOut, Check, Phone } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import artwork from './avatar/nalu-avatar.png'
import AvatarPresence from './AvatarPresence'
import { currentUser, fetchMe, signIn, signUp, signOut, getToken, setToken, syncCliConfig, updateProfile, type NaluUser } from '../lib/naluApi'
import { REASONING_LEVELS, REASONING_DESC, getModelSettings, setModelSettings, type ReasoningLevel } from '../lib/settings'

const TOKEN_PRESETS = [
  { label: '4k', value: 4096 },
  { label: '8k', value: 8192 },
  { label: '16k', value: 16000 },
  { label: '32k', value: 32000 },
]

export default function SettingsModal() {
  const ws = useWorkspace()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pointerStartedOutside = useRef(false)
  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog?.showModal()
    return () => {
      if (dialog?.open) dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
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
  const [desktopVersion, setDesktopVersion] = useState('')
  const [{ reasoning, maxTokens, webSearch, streaming }, setModel] = useState(getModelSettings())
  const pickReasoning = (r: ReasoningLevel) => setModel(setModelSettings({ reasoning: r }))
  const pickTokens = (v: number) => setModel(setModelSettings({ maxTokens: v }))
  const toggleWeb = () => setModel(setModelSettings({ webSearch: !webSearch }))
  const toggleStream = () => setModel(setModelSettings({ streaming: !streaming }))
  useEffect(() => { syncCliConfig() }, [reasoning, maxTokens, webSearch])
  useEffect(() => { void window.nalu.appVersion().then(setDesktopVersion).catch(() => {}) }, [])

  // Confirm the stored session still maps to the same DB user (sync check).
  useEffect(() => {
    let active = true
    if (getToken()) void fetchMe().then(u => { if (active) setUser(u) }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : 'Could not check your account. Your saved session has been kept.')
    })
    return () => { active = false }
  }, [])

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const r = mode === 'signin' ? await signIn(email.trim(), password) : await signUp(email.trim(), password, name.trim() || undefined)
      if (r.ok && r.user) setUser(r.user)
      else setError(r.error || 'Could not sign in.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Network error — check your connection.') }
    finally { setBusy(false) }
  }

  const doSignOut = () => { signOut(); setUser(null); setTok(''); setEmail(''); setPassword('') }

  // Phone number (for the phone-call feature) — edited inline in the account card.
  const [phone, setPhone] = useState(user?.phone || '')
  const [phoneState, setPhoneState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [phoneErr, setPhoneErr] = useState('')
  useEffect(() => { setPhone(user?.phone || '') }, [user?.phone])
  const savePhone = async () => {
    setPhoneState('saving'); setPhoneErr('')
    try {
      const r = await updateProfile({ phone: phone.trim() })
      if (r.ok && r.user) { setUser(r.user); setPhoneState('saved'); setTimeout(() => setPhoneState('idle'), 1500) }
      else { setPhoneState('error'); setPhoneErr(r.error || 'Could not save.') }
    } catch { setPhoneState('error'); setPhoneErr('Could not reach Nalu. Your phone number has not been saved; try again.') }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="settings-title"
      className="settings-dialog m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100vw_-_2rem)] max-w-md overflow-y-auto rounded-2xl border border-glass/[0.12] bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      onCancel={(e) => { e.preventDefault(); ws.setSettingsOpen(false) }}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        pointerStartedOutside.current = e.target === e.currentTarget && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        if (pointerStartedOutside.current && e.target === e.currentTarget && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) ws.setSettingsOpen(false)
        pointerStartedOutside.current = false
      }}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-glass/[0.08] bg-panel px-5 py-4">
          <h2 id="settings-title" className="text-[15px] font-semibold text-ink">Settings</h2>
          <button aria-label="Close settings" onClick={() => ws.setSettingsOpen(false)} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={16} /></button>
        </div>

        <div className="settings-body">
        <aside className="settings-avatar-intro"><span className="avatar-eyebrow">Your Nalu</span><h2>Make yourself<br/>at home.</h2><p>Your work, your rhythm.<br/>A familiar little presence.</p><AvatarPresence size={240}/><span className="avatar-presence-status"><i/>Right here with you</span></aside>
        <div className="settings-controls">
        <fieldset className="mb-6"><legend className="mb-2 text-[12px] font-semibold text-ink">Appearance</legend>
          <div className="appearance-options">
            <button type="button" aria-pressed={ws.appearance === 'avatar'} onClick={() => ws.setAppearance('avatar')}><span className="appearance-swatch avatar-swatch"/>Nalu<span>The original avatar look</span></button>
            <button type="button" aria-pressed={ws.appearance === 'pastel'} onClick={() => ws.setAppearance('pastel')}><span className="appearance-swatch pastel-swatch" style={{backgroundImage:`url(${import.meta.env.BASE_URL}bg/pastel-painting.png)`,backgroundSize:'cover',backgroundPosition:'center'}}/>Pastel<span>Softly painted scenery</span></button>
            <button type="button" aria-pressed={ws.appearance === 'focus'} onClick={() => ws.setAppearance('focus')}><span className="appearance-swatch focus-swatch"/>Focus<span>Calm dark workspace</span></button>
            <button type="button" aria-pressed={ws.appearance === 'scenic'} onClick={() => ws.setAppearance('scenic')}><span className="appearance-swatch scenic-swatch"/>Scenic<span>Nalu’s glass backdrop</span></button>
          </div>
        </fieldset>
        <CompanionSettings/>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Nalu account</div>

        {user ? (
          <div className="rounded-xl border border-glass/[0.1] bg-panel2 p-3.5">
            <div className="flex items-center gap-3">
              <img src={artwork} alt="Nalu" className="h-9 w-9 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{user.displayName}</div>
                <div className="truncate text-[11px] text-dim">{user.id}</div>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400"><Check size={10} /> synced</span>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-dim">Signed in as the same account as n4lu.ai — same AI, specialists, quotas, and data.</p>

            {/* Phone number — so Nalu can call you, and recognize you when you call in. */}
            <div className="mt-3 border-t border-glass/[0.08] pt-3">
              <label htmlFor="nalu-phone" className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink"><Phone size={12} /> Phone number</label>
              <div className="flex items-center gap-2">
                <input
                  id="nalu-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && savePhone()}
                  type="tel"
                  placeholder="+1 415 555 1234"
                  className="min-w-0 flex-1 rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-gold/50"
                />
                <button
                  onClick={savePhone}
                  disabled={phoneState === 'saving' || (phone.trim() || '') === (user.phone || '')}
                  className="flex items-center gap-1 rounded-lg bg-gold/90 px-3 py-2 text-[12px] font-medium text-[#15170f] hover:bg-gold disabled:opacity-40"
                >
                  {phoneState === 'saving' ? 'Saving…' : phoneState === 'saved' ? <><Check size={12} /> Saved</> : 'Save'}
                </button>
              </div>
              {phoneState === 'error'
                ? <div role="alert" className="mt-1.5 text-[11px] text-red-400">{phoneErr}</div>
                : <div className="mt-1.5 text-[11px] leading-relaxed text-dim">Include your country code (e.g. +1). Nalu calls this when you ask, and knows it's you when you call in.</div>}
            </div>

            <button onClick={doSignOut} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-glass/[0.1] px-3 py-2 text-[12px] text-dim hover:bg-glass/5 hover:text-ink"><LogOut size={13} /> Sign out</button>
          </div>
        ) : (
          <>
            <p className="mb-3 text-[12px] leading-relaxed text-dim">Sign in with your n4lu.ai email and password. It's the same account — everything syncs.</p>
            <div className="space-y-2">
              {mode === 'signup' && (
                <div>
                  <label htmlFor="nalu-name" className="mb-1 block text-[12px] text-ink">Your name (optional)</label>
                  <input id="nalu-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="w-full rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[13px] text-ink outline-none focus:border-gold/50" />
                </div>
              )}
              <div>
                <label htmlFor="nalu-email" className="mb-1 block text-[12px] text-ink">Email or username</label>
                <input id="nalu-email" value={email} onChange={(e) => setEmail(e.target.value)} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} className="w-full rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[13px] text-ink outline-none focus:border-gold/50" />
              </div>
              <div>
                <label htmlFor="nalu-password" className="mb-1 block text-[12px] text-ink">Password</label>
                <input id="nalu-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && email && password && submit()} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className="w-full rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[13px] text-ink outline-none focus:border-gold/50" />
              </div>
            </div>
            <button onClick={submit} disabled={busy || !email || !password} className="mt-3 w-full rounded-lg bg-gold/90 px-3 py-2 text-[13px] font-medium text-[#15170f] hover:bg-gold disabled:opacity-50">
              {busy ? 'Signing in…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
            <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }} className="mt-2 w-full text-center text-[11.5px] text-dim hover:text-ink">
              {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
            </button>
          </>
        )}
        {error && <div role="alert" className="mt-2 text-[11.5px] text-red-400">{error}</div>}

        <button onClick={() => setShowToken((s) => !s)} className="mt-4 text-[10.5px] text-dim hover:text-ink">{showToken ? 'Hide' : 'Advanced:'} paste a session token</button>
        {showToken && (
          <div className="mt-2">
            <label htmlFor="nalu-session-token" className="mb-1 block text-[12px] text-ink">Session token</label>
            <input id="nalu-session-token" type="password" autoComplete="off" value={tok} onChange={(e) => setTok(e.target.value)} className="w-full rounded-lg border border-glass/[0.1] bg-panel2 px-3 py-2 text-[12px] text-ink outline-none focus:border-gold/50" />
            <button onClick={async () => {
              setToken(tok.trim()); setUser(currentUser()); setError('')
              try { setUser(await fetchMe()); setSavedTok(true); setTimeout(() => setSavedTok(false), 1500) }
              catch (error) { setError(error instanceof Error ? error.message : 'Could not check this token. Try again.') }
            }} className="mt-2 w-full rounded-lg border border-glass/[0.12] px-3 py-1.5 text-[12px] text-gold hover:bg-glass/5">{savedTok ? 'Saved ✓' : 'Use token'}</button>
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
                  aria-pressed={reasoning === lvl}
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
                  aria-pressed={maxTokens === p.value}
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

        <div className="mt-4 text-[11px] text-dim">Nalu Desktop{desktopVersion ? ` ${desktopVersion}` : ''} — the Nalu app, on your computer.</div>
        </div>
        </div>
    </dialog>
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
