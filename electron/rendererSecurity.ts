import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'

export function isRendererEntry(candidate: string, entry: string): boolean {
  try {
    const actual = new URL(candidate), expected = new URL(entry)
    actual.hash = ''; expected.hash = ''
    return actual.href === expected.href
  } catch { return false }
}

export function isExternalWebUrl(value: string): boolean {
  try { return ['https:', 'http:'].includes(new URL(value).protocol) }
  catch { return false }
}

export function isTrustedRenderer(
  event: IpcMainEvent | IpcMainInvokeEvent,
  window: BrowserWindow | null,
  entry: string,
): boolean {
  try {
    return !!window && !window.isDestroyed()
      && event.sender === window.webContents
      && !!event.senderFrame && event.senderFrame === event.sender.mainFrame
      && isRendererEntry(event.senderFrame.url, entry)
  } catch { return false }
}

// Centralize the check so newly added OS bridges receive the same protection.
// Tool browser windows, subframes and navigated documents never own IDE IPC.
export function trustedIpc(raw: IpcMain, window: () => BrowserWindow | null, entry: () => string) {
  return {
    handle(channel: string, listener: Parameters<IpcMain['handle']>[1]) {
      raw.handle(channel, (event, ...args) => {
        if (!isTrustedRenderer(event, window(), entry())) throw new Error('Untrusted desktop IPC sender')
        return listener(event, ...args)
      })
    },
    on<Args extends unknown[]>(channel: string, listener: (event: IpcMainEvent, ...args: Args) => void) {
      raw.on(channel, (event, ...args) => {
        if (isTrustedRenderer(event, window(), entry())) listener(event, ...args as Args)
      })
    },
  }
}
