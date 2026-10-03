import { contextBridge, ipcRenderer } from 'electron'
import type { CompanionSettings } from './companion'
export type CompanionState = CompanionSettings & { working: boolean; reveal: number; activities: import('./companion').CompanionActivity[] }
const companion = {
  expanded: (open: boolean): void => ipcRenderer.send('companion:expanded', open),
  reducedMotion: (reduced: boolean): void => ipcRenderer.send('companion:reduced-motion', reduced),
  moveBy: (dx: number, dy: number): void => ipcRenderer.send('companion:move', dx, dy),
  onCursor: (fn: (point: { x: number; y: number }) => void) => { const listener = (_event: unknown, point: { x: number; y: number }) => fn(point); ipcRenderer.on('companion:cursor', listener); return () => ipcRenderer.removeListener('companion:cursor', listener) },
  updateActivity: (blocked: boolean, idleMs: number): void => ipcRenderer.send('companion:update-activity', blocked, idleMs),
  get: (): Promise<CompanionState> => ipcRenderer.invoke('companion:get'),
  set: (settings: Partial<CompanionSettings>): Promise<CompanionState> => ipcRenderer.invoke('companion:set', settings),
  openWorkspace: (prompt?: string): Promise<void> => ipcRenderer.invoke('companion:workspace', prompt),
  microphone: (): Promise<boolean> => ipcRenderer.invoke('companion:microphone'),
  hitAreas: (areas: { x: number; y: number; width: number; height: number }[]): void => ipcRenderer.send('companion:hit-areas', areas),
  onState: (fn: (state: CompanionState) => void) => { const listener = (_event: unknown, state: CompanionState) => fn(state); ipcRenderer.on('companion:state', listener); return () => ipcRenderer.removeListener('companion:state', listener) },
}
contextBridge.exposeInMainWorld('companion', companion)
export type CompanionAPI = typeof companion
