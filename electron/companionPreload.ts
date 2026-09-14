import { contextBridge, ipcRenderer } from 'electron'
import type { CompanionSettings } from './companion'
export type CompanionState = CompanionSettings & { working: boolean; reveal: number; activities: import('./companion').CompanionActivity[] }
const companion = {
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
