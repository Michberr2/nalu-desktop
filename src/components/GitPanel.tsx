import { useEffect, useState, useCallback } from 'react'
import { GitBranch, RefreshCw, Plus, Minus, ChevronDown, X, Github, Download, DownloadCloud, LogOut, Search } from 'lucide-react'
import { useWorkspace } from '../lib/store'

type GFile = { x: string; y: string; path: string }
type Status = { repo: boolean; branch?: string; files?: GFile[] }
type Gh = { loggedIn: boolean; login: string; hasGh: boolean }
type Repo = { full_name: string; clone_url: string; private: boolean }

// Source control — GitHub sign-in (gh OAuth, no tokens), clone any repo, pull,
// stage/unstage, Commit & Push, and a live diff so you SEE every change.
export default function GitPanel() {
  const ws = useWorkspace()
  const [st, setSt] = useState<Status>({ repo: false })
  const [stat, setStat] = useState({ added: 0, removed: 0 })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null)
  const [gh, setGh] = useState<Gh>({ loggedIn: false, login: '', hasGh: true })
  const [remote, setRemote] = useState('')
  const [loginCode, setLoginCode] = useState('')
  const [repos, setRepos] = useState<Repo[]>([])
  const [showClone, setShowClone] = useState(false)
  const [repoQuery, setRepoQuery] = useState('')
  const [note, setNote] = useState('')

  const loadGit = useCallback(async () => {
    if (!ws.folder) { setSt({ repo: false }); setRemote(''); return }
    const [s, n, r] = await Promise.all([window.nalu.git.status(ws.folder), window.nalu.git.stat(ws.folder), window.nalu.git.remote(ws.folder)])
    setSt(s); setStat(n); setRemote(r)
  }, [ws.folder])
  const loadGh = useCallback(async () => { setGh(await window.nalu.github.status()) }, [])

  useEffect(() => { void loadGit() }, [loadGit, ws.refreshKey])
  useEffect(() => { void loadGh() }, [loadGh])
  useEffect(() => { const t = setInterval(() => void loadGit(), 2000); return () => clearInterval(t) }, [loadGit])
  useEffect(() => window.nalu.github.onLoginCode((c) => setLoginCode(c)), [])
  useEffect(() => {
    if (!diff || !ws.folder) return
    const t = setInterval(async () => { const txt = await window.nalu.git.diff(ws.folder!, diff.path); if (txt) setDiff((d) => (d && d.path === diff.path ? { ...d, text: txt } : d)) }, 2000)
    return () => clearInterval(t)
  }, [diff, ws.folder])

  const staged = (st.files || []).filter((f) => f.x !== ' ' && f.x !== '?')
  const changed = (st.files || []).filter((f) => f.x === ' ' || f.x === '?' || f.y !== ' ')
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } finally { setBusy(false); await loadGit() } }

  const signIn = async () => {
    setBusy(true); setNote('Opening GitHub to authorize…'); setLoginCode('')
    try { const r = await window.nalu.github.login(); setNote(r.ok ? 'Connected to GitHub.' : 'Sign-in cancelled.') }
    finally { setBusy(false); setLoginCode(''); await loadGh() }
  }
  const signOut = async () => { setBusy(true); try { await window.nalu.github.logout() } finally { setBusy(false); await loadGh() } }
  const openClone = async () => { setShowClone(true); setNote('Loading your repositories…'); setRepos(await window.nalu.github.repos()); setNote('') }
  const cloneRepo = async (full: string) => {
    setNote(`Choose where to clone ${full}…`)
    const parent = await window.nalu.openFolder()
    if (!parent) { setNote(''); return }
    setBusy(true); setNote(`Cloning ${full}…`)
    try {
      const r = await window.nalu.git.clone(full, parent)
      if (r.ok && r.dir) { ws.openFolderAt(r.dir); setShowClone(false); setNote(`Cloned ${full}.`) }
      else setNote(r.out || 'Clone failed.')
    } finally { setBusy(false) }
  }
  const pull = async () => { if (!ws.folder) return; setBusy(true); setNote('Pulling…'); try { const r = await window.nalu.git.pull(ws.folder); setNote(r.ok ? 'Up to date.' : r.out) } finally { setBusy(false); await loadGit() } }
  const showDiff = async (f: GFile) => { if (ws.folder) setDiff({ path: f.path, text: (await window.nalu.git.diff(ws.folder, f.path)) || '(no diff)' }) }
  const commit = async (push: boolean) => {
    if (!msg.trim() || !ws.folder) return
    setBusy(true); setNote(push ? 'Committing & pushing…' : 'Committing…')
    try {
      if (push) { const r = await window.nalu.git.commitPush(ws.folder, msg.trim()); setNote(r.ok ? 'Pushed to GitHub.' : (r.push || 'Push failed.')) }
      else { await window.nalu.git.commit(ws.folder, msg.trim()); setNote('Committed.') }
      setMsg('')
    } finally { setBusy(false); await loadGit() }
  }

  // ---- GitHub account bar (always visible) ----
  const AccountBar = (
    <div className="flex items-center gap-2 border-b border-glass/[0.08] px-3 py-2">
      <Github size={14} className="shrink-0 text-ink" />
      {gh.loggedIn ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{gh.login}</span>
          <button onClick={openClone} title="Clone a repository" className="flex items-center gap-1 rounded-md bg-glass/10 px-2 py-1 text-[11px] text-ink hover:bg-glass/20"><DownloadCloud size={12} /> Clone</button>
          <button onClick={() => void signOut()} title="Sign out" className="rounded-md p-1 text-dim hover:bg-glass/10 hover:text-ink"><LogOut size={12} /></button>
        </>
      ) : (
        <button onClick={() => void signIn()} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-gold/90 px-2 py-1 text-[11px] font-medium text-[#15170f] hover:bg-gold disabled:opacity-50">
          <Github size={12} /> Sign in with GitHub
        </button>
      )}
    </div>
  )

  const filtered = repos.filter((r) => r.full_name.toLowerCase().includes(repoQuery.toLowerCase()))

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {AccountBar}
      {loginCode && (
        <div className="mx-3 mt-2 rounded-lg border border-gold/40 bg-panel2 p-2.5 text-center">
          <div className="text-[10px] uppercase tracking-wide text-dim">Enter this code at github.com/login/device</div>
          <div className="mt-1 select-all font-mono text-lg font-semibold tracking-[0.2em] text-gold">{loginCode}</div>
          <div className="mt-1 text-[10px] text-dim">The page opened in your browser. Waiting for you to authorize…</div>
        </div>
      )}
      {note && <div className="mx-3 mt-2 truncate text-[11px] text-dim">{note}</div>}

      {!ws.folder ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-[12px] text-dim">Open a folder, or clone a repo from GitHub.</p>
          {gh.loggedIn ? (
            <button onClick={openClone} className="flex items-center gap-1.5 rounded-lg bg-glass/10 px-3 py-1.5 text-[12px] text-ink hover:bg-glass/20"><DownloadCloud size={13} /> Clone a repository</button>
          ) : (
            <button onClick={() => void signIn()} className="flex items-center gap-1.5 rounded-lg bg-gold/90 px-3 py-1.5 text-[12px] font-medium text-[#15170f] hover:bg-gold"><Github size={13} /> Sign in with GitHub</button>
          )}
          <button onClick={() => void ws.openFolder()} className="text-[11px] text-dim underline hover:text-ink">Open a local folder</button>
        </div>
      ) : !st.repo ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-[12px] text-dim">This folder isn't a git repository.</p>
          <button onClick={() => ws.folder && void act(() => window.nalu.git.initRepo(ws.folder!))} className="flex items-center gap-1.5 rounded-lg bg-glass/10 px-3 py-1.5 text-[12px] text-ink hover:bg-glass/20"><GitBranch size={13} /> Initialize repository</button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink"><GitBranch size={13} className="shrink-0 text-gold" /> <span className="truncate">{st.branch}</span></span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => void pull()} disabled={busy || !remote} title={remote ? 'Pull from GitHub' : 'No remote'} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink disabled:opacity-40"><Download size={13} /></button>
              <button onClick={() => void loadGit()} disabled={busy} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /></button>
            </div>
          </div>
          {remote && <div className="truncate px-3 pb-1 text-[10px] text-dim" title={remote}>{remote.replace(/^https:\/\//, '').replace(/\.git$/, '')}</div>}

          <div className="flex items-center gap-2 px-3 pb-2">
            <span className="flex items-center gap-1.5 rounded-full border border-glass/[0.1] bg-panel2 px-2.5 py-1 text-[11px] text-ink">
              Changes {stat.added > 0 && <span className="text-green-400">+{stat.added}</span>} {stat.removed > 0 && <span className="text-red-400">−{stat.removed}</span>}
              {stat.added === 0 && stat.removed === 0 && <span className="text-dim">0</span>}
            </span>
          </div>
          <div className="px-3 pb-2">
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder="Commit message" className="w-full resize-none rounded-lg border border-glass/[0.1] bg-panel2 px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-dim focus:border-gold/40" />
            <div className="mt-1.5 flex gap-1.5">
              <button onClick={() => void commit(true)} disabled={!msg.trim() || busy} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gold/90 px-3 py-1.5 text-[12px] font-medium text-[#15170f] hover:bg-gold disabled:opacity-40">Commit &amp; Push <ChevronDown size={12} /></button>
              <button onClick={() => void commit(false)} disabled={!msg.trim() || staged.length === 0 || busy} title="Commit only (staged)" className="rounded-lg border border-glass/[0.12] px-3 py-1.5 text-[12px] text-ink hover:bg-glass/10 disabled:opacity-40">Commit</button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {staged.length > 0 && <>
              <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">Staged</div>
              {staged.map((f) => <Row key={'s' + f.path} f={f} isStaged act={act} showDiff={showDiff} ws={ws} />)}
            </>}
            <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">Changes</div>
            {changed.length === 0 && <div className="px-1.5 py-2 text-[11px] text-dim">No changes</div>}
            {changed.map((f) => <Row key={'c' + f.path} f={f} isStaged={false} act={act} showDiff={showDiff} ws={ws} />)}
          </div>
        </>
      )}

      {/* Clone picker */}
      {showClone && (
        <div className="absolute inset-0 z-40 flex flex-col rounded-2xl bg-panel">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-2">
            <span className="text-[12px] font-medium text-ink">Clone a repository</span>
            <button onClick={() => setShowClone(false)} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={14} /></button>
          </div>
          <div className="flex items-center gap-1.5 border-b border-glass/[0.06] px-3 py-2">
            <Search size={12} className="text-dim" />
            <input value={repoQuery} onChange={(e) => setRepoQuery(e.target.value)} placeholder="Search your repos, or type owner/repo" className="flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-dim" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {repoQuery.includes('/') && !filtered.some((r) => r.full_name === repoQuery) && (
              <button onClick={() => void cloneRepo(repoQuery.trim())} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-glass/[0.08]"><DownloadCloud size={12} className="text-gold" /><span className="text-[12px] text-ink">Clone “{repoQuery.trim()}”</span></button>
            )}
            {filtered.length === 0 && !repoQuery && <div className="p-3 text-center text-[11px] text-dim">Loading your repositories…</div>}
            {filtered.map((r) => (
              <button key={r.full_name} onClick={() => void cloneRepo(r.full_name)} className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-glass/[0.08]">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{r.full_name}</span>
                {r.private && <span className="shrink-0 rounded bg-glass/10 px-1 text-[9px] text-dim">private</span>}
                <DownloadCloud size={12} className="shrink-0 text-dim opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* diff view */}
      {diff && (
        <div className="absolute inset-0 z-40 flex flex-col rounded-2xl bg-panel">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-2">
            <span className="truncate text-[12px] font-medium text-ink">{diff.path}</span>
            <button onClick={() => setDiff(null)} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={14} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
            {diff.text.split('\n').map((line, i) => (
              <div key={i} className={line.startsWith('+') && !line.startsWith('+++') ? 'text-green-400' : line.startsWith('-') && !line.startsWith('---') ? 'text-red-400' : line.startsWith('@@') ? 'text-accent' : 'text-dim'}>{line || ' '}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ f, isStaged, act, showDiff, ws }: { f: GFile; isStaged: boolean; act: (fn: () => Promise<unknown>) => Promise<void>; showDiff: (f: GFile) => void; ws: ReturnType<typeof useWorkspace> }) {
  return (
    <div className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-glass/[0.06]">
      <span className="w-3 shrink-0 text-center text-[10px] font-bold text-gold">{f.x !== ' ' && f.x !== '?' ? f.x : f.y === '?' ? 'U' : f.y}</span>
      <button onClick={() => showDiff(f)} className="min-w-0 flex-1 truncate text-left text-[12px] text-dim hover:text-ink">{f.path}</button>
      <button onClick={() => ws.folder && void act(() => isStaged ? window.nalu.git.unstage(ws.folder!, f.path) : window.nalu.git.stage(ws.folder!, f.path))} title={isStaged ? 'Unstage' : 'Stage'} className="shrink-0 rounded p-0.5 text-dim opacity-0 hover:bg-glass/10 hover:text-ink group-hover:opacity-100">
        {isStaged ? <Minus size={12} /> : <Plus size={12} />}
      </button>
    </div>
  )
}
