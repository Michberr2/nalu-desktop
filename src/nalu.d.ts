import type { NaluAPI } from '../electron/preload'

declare global {
  interface Window {
    nalu: NaluAPI
    companion: import('../electron/companionPreload').CompanionAPI
  }
}

export {}
