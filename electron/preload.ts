import { contextBridge, ipcRenderer } from 'electron'

// The ONLY bridge between the renderer and the OS. Everything is an explicit,
// audited call — no raw node access leaks into the web layer.
const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (dir: string): Promise<Array<{ name: string; path: string; dir: boolean }>> =>
    ipcRenderer.invoke('fs:readDir', dir),
  readFile: (file: string): Promise<string> => ipcRenderer.invoke('fs:readFile', file),
  writeFile: (file: string, content: string): Promise<boolean> => ipcRenderer.invoke('fs:writeFile', file, content),
  createFile: (dir: string, name: string): Promise<string> => ipcRenderer.invoke('fs:createFile', dir, name),
  mkdir: (dir: string, name: string): Promise<string> => ipcRenderer.invoke('fs:mkdir', dir, name),
  del: (target: string): Promise<boolean> => ipcRenderer.invoke('fs:delete', target),
  rename: (from: string, to: string): Promise<boolean> => ipcRenderer.invoke('fs:rename', from, to),
  search: (root: string, query: string): Promise<Array<{ file: string; rel: string; line: number; text: string }>> =>
    ipcRenderer.invoke('fs:search', root, query),
  exec: (cwd: string, command: string): Promise<{ code: number; output: string }> => ipcRenderer.invoke('sys:exec', cwd, command),
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  git: {
    status: (cwd: string): Promise<{ repo: boolean; branch?: string; files?: Array<{ x: string; y: string; path: string }> }> =>
      ipcRenderer.invoke('git:status', cwd),
    diff: (cwd: string, file?: string): Promise<string> => ipcRenderer.invoke('git:diff', cwd, file),
    stage: (cwd: string, file: string): Promise<boolean> => ipcRenderer.invoke('git:stage', cwd, file),
    unstage: (cwd: string, file: string): Promise<boolean> => ipcRenderer.invoke('git:unstage', cwd, file),
    commit: (cwd: string, msg: string): Promise<string> => ipcRenderer.invoke('git:commit', cwd, msg),
    stat: (cwd: string): Promise<{ added: number; removed: number }> => ipcRenderer.invoke('git:stat', cwd),
    commitPush: (cwd: string, msg: string): Promise<{ commit: string; push: string; ok: boolean }> => ipcRenderer.invoke('git:commitPush', cwd, msg),
    clone: (repoOrUrl: string, destParent: string): Promise<{ ok: boolean; out: string; dir: string | null }> => ipcRenderer.invoke('git:clone', repoOrUrl, destParent),
    pull: (cwd: string): Promise<{ ok: boolean; out: string }> => ipcRenderer.invoke('git:pull', cwd),
    remote: (cwd: string): Promise<string> => ipcRenderer.invoke('git:remote', cwd),
    setRemote: (cwd: string, url: string): Promise<boolean> => ipcRenderer.invoke('git:setRemote', cwd, url),
    initRepo: (cwd: string): Promise<boolean> => ipcRenderer.invoke('git:initRepo', cwd),
  },
  github: {
    status: (): Promise<{ loggedIn: boolean; login: string; hasGh: boolean }> => ipcRenderer.invoke('github:status'),
    repos: (): Promise<Array<{ full_name: string; clone_url: string; private: boolean }>> => ipcRenderer.invoke('github:repos'),
    login: (): Promise<{ ok: boolean; out: string }> => ipcRenderer.invoke('github:login'),
    logout: (): Promise<boolean> => ipcRenderer.invoke('github:logout'),
    onLoginCode: (cb: (code: string) => void): (() => void) => {
      const h = (_e: unknown, code: string) => cb(code)
      ipcRenderer.on('github:loginCode', h)
      return () => ipcRenderer.removeListener('github:loginCode', h)
    },
  },

  // Computer control — the AI operates the whole Mac.
  pc: {
    permissions: (prompt: boolean): Promise<{ accessibility: boolean; screen: boolean }> => ipcRenderer.invoke('pc:permissions', prompt),
    openSettings: (pane: string): Promise<boolean> => ipcRenderer.invoke('pc:openSettings', pane),
    screenshot: (): Promise<string> => ipcRenderer.invoke('pc:screenshot'),
    screenSize: (): Promise<{ w: number; h: number }> => ipcRenderer.invoke('pc:screenSize'),
    click: (x: number, y: number, dbl?: boolean): Promise<boolean> => ipcRenderer.invoke('pc:click', x, y, dbl),
    type: (text: string): Promise<boolean> => ipcRenderer.invoke('pc:type', text),
    key: (combo: string): Promise<boolean> => ipcRenderer.invoke('pc:key', combo),
    applescript: (script: string): Promise<{ ok: boolean; out: string }> => ipcRenderer.invoke('pc:applescript', script),
    open: (target: string): Promise<boolean> => ipcRenderer.invoke('pc:open', target),
    browserRun: (code: string, wantResult: boolean): Promise<{ ok: boolean; out: string }> => ipcRenderer.invoke('pc:browserRun', code, wantResult),
    browserOpen: (url: string): Promise<boolean> => ipcRenderer.invoke('pc:browserOpen', url),
    // Nalu Browser — the in-app Chromium the agent fully controls (no toggle).
    webOpen: (url: string): Promise<{ ok: boolean; out: string }> => ipcRenderer.invoke('pc:webOpen', url),
    webJs: (code: string, wantResult: boolean): Promise<{ ok: boolean; out: string }> => ipcRenderer.invoke('pc:webJs', code, wantResult),
    webShot: (): Promise<string> => ipcRenderer.invoke('pc:webShot'),
    // trusted (isTrusted=true) input into the Nalu Browser — passes most bot-walls
    webClickSel: (selector: string): Promise<{ ok: boolean; out: string }> => ipcRenderer.invoke('pc:webClickSel', selector),
    webType: (text: string): Promise<{ ok: boolean; out: string }> => ipcRenderer.invoke('pc:webType', text),
    webKey: (key: string): Promise<{ ok: boolean; out: string }> => ipcRenderer.invoke('pc:webKey', key),
  },

  term: {
    shells: (): Promise<string[]> => ipcRenderer.invoke('term:shells'),
    create: (id: string, cwd: string, shell?: string): Promise<boolean> => ipcRenderer.invoke('term:create', id, cwd, shell),
    input: (id: string, data: string): void => ipcRenderer.send('term:input', id, data),
    resize: (id: string, cols: number, rows: number): void => ipcRenderer.send('term:resize', id, cols, rows),
    kill: (id: string): Promise<boolean> => ipcRenderer.invoke('term:kill', id),
    onData: (id: string, cb: (data: string) => void): (() => void) => {
      const listener = (_e: unknown, data: string) => cb(data)
      ipcRenderer.on(`term:data:${id}`, listener)
      return () => ipcRenderer.removeListener(`term:data:${id}`, listener)
    },
    onExit: (id: string, cb: (code: number) => void): (() => void) => {
      const listener = (_e: unknown, code: number) => cb(code)
      ipcRenderer.on(`term:exit:${id}`, listener)
      return () => ipcRenderer.removeListener(`term:exit:${id}`, listener)
    },
  },

  platform: process.platform,
}

contextBridge.exposeInMainWorld('nalu', api)

export type NaluAPI = typeof api
