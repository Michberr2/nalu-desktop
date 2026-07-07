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

  term: {
    create: (id: string, cwd: string): Promise<boolean> => ipcRenderer.invoke('term:create', id, cwd),
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
