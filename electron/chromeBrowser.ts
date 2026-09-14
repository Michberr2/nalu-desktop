import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { inspectBrowserPage, type BrowserCommand } from './browserPage'

export type BrowserPreview = { connected: boolean; url: string; title: string; image: string; width: number; height: number; error?: string; target?: { x: number; y: number } }
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

/** Chrome owns page rendering and input. A private pipe carries the protocol;
 * its dedicated Nalu profile never opens or copies the user's other profiles. */
export class ChromeBrowser {
  private child: ChildProcess | null = null
  private writer: Writable | null = null
  private sequence = 0
  private pending = new Map<number, Pending>()
  private session = ''
  private targetId = ''
  private starting: Promise<void> | null = null
  private generation = 0
  private loaded = new Set<string>()
  private lastFrame = 0
  preview: BrowserPreview = { connected: false, url: '', title: '', image: '', width: 1200, height: 800 }
  constructor(private profile: string, private publish: (state: BrowserPreview) => void, private executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') {}
  get available() { return fs.existsSync(this.executable) }
  private emit(patch: Partial<BrowserPreview>) { this.preview = { ...this.preview, ...patch }; this.publish(this.preview) }
  private call(method: string, params: Record<string, unknown> = {}, sessionId = this.session): Promise<any> {
    if (!this.writer) return Promise.reject(Error('Open Chrome first.'))
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`Chrome timed out: ${method}`)) }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      this.writer!.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', error => {
        if (!error) return
        clearTimeout(timer); this.pending.delete(id); reject(error)
      })
    })
  }
  private receive(message: any) {
    if (message.id) {
      const pending = this.pending.get(message.id); if (!pending) return
      clearTimeout(pending.timer); this.pending.delete(message.id)
      if (message.error) pending.reject(Error(message.error.message)); else pending.resolve(message.result)
      return
    }
    if (message.sessionId !== this.session) return
    if (message.method === 'Page.lifecycleEvent' && ['DOMContentLoaded', 'load'].includes(message.params.name)) {
      this.loaded.add(message.params.loaderId); if (this.loaded.size > 100) this.loaded.delete(this.loaded.values().next().value!)
    }
    if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) this.emit({ url: message.params.frame.url, target: undefined })
    if (message.method === 'Page.screencastFrame') {
      void this.call('Page.screencastFrameAck', { sessionId: message.params.sessionId }).catch(() => {})
      if (Date.now() - this.lastFrame < 180) return
      this.lastFrame = Date.now()
      const { data, metadata } = message.params
      this.emit({ image: 'data:image/jpeg;base64,' + data, width: metadata.deviceWidth, height: metadata.deviceHeight })
    }
  }
  private disconnected(error: string) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error(error)) }
    this.pending.clear(); this.child = null; this.writer = null; this.session = ''; this.targetId = ''; this.starting = null
    this.emit({ connected: false, image: '', error })
  }
  async start() {
    if (this.session && this.child) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      if (!this.available) throw Error('Google Chrome is not installed in Applications.')
      fs.mkdirSync(this.profile, { recursive: true })
      const child = spawn(this.executable, ['--remote-debugging-pipe', '--user-data-dir=' + path.resolve(this.profile), '--no-first-run', '--no-default-browser-check', '--window-size=1200,850', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
      this.child = child; this.writer = child.stdio[3] as Writable
      let buffer = ''
      ;(child.stdio[4] as Readable).setEncoding('utf8').on('data', (chunk: string) => {
        buffer += chunk
        let at: number
        while ((at = buffer.indexOf('\0')) >= 0) { const raw = buffer.slice(0, at); buffer = buffer.slice(at + 1); try { this.receive(JSON.parse(raw)) } catch { /* ignore malformed protocol frames */ } }
      })
      this.writer.on('error', () => { /* pending requests receive the write error */ })
      child.once('error', error => { if (this.child === child) this.disconnected(error.message) })
      child.once('exit', () => { if (this.child === child) this.disconnected('Chrome was closed. Open it to continue.') })
      await this.call('Browser.getVersion', {}, '')
      const { targetInfos } = await this.call('Target.getTargets', {}, '')
      const target = targetInfos.find((t: any) => t.type === 'page' && t.url === 'about:blank') || targetInfos.find((t: any) => t.type === 'page')
      if (!target) throw Error('Chrome did not open a tab.')
      this.targetId = target.targetId
      this.session = (await this.call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, '')).sessionId
      await this.call('Page.enable'); await this.call('Page.setLifecycleEventsEnabled', { enabled: true })
      await this.call('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1000, maxHeight: 700, everyNthFrame: 1 })
      this.emit({ connected: true, url: target.url, error: undefined })
      await this.capture()
    })()
    try { await this.starting } catch (error) {
      this.child?.kill()
      this.disconnected(error instanceof Error ? error.message : 'Could not open Chrome.')
      throw error
    }
  }
  cancel() { this.generation++ }
  private check(generation: number) { if (generation !== this.generation) throw Error('Browser action stopped.') }
  async show() { await this.start(); await this.call('Target.activateTarget', { targetId: this.targetId }, '') }
  async navigate(url: string) {
    const full = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url)
    if (!['https:', 'http:'].includes(full.protocol)) throw Error('Use an HTTP or HTTPS address.')
    const generation = this.generation; await this.start(); this.check(generation)
    const result = await this.call('Page.navigate', { url: full.href }); this.check(generation)
    if (result.errorText) throw Error(result.errorText)
    const deadline = Date.now() + 12000
    while (result.loaderId && !this.loaded.has(result.loaderId) && Date.now() < deadline) { this.check(generation); await new Promise(resolve => setTimeout(resolve, 20)) }
    this.check(generation)
    const snapshot = await this.inspect({ action: 'snapshot' })
    await this.capture()
    return `Opened ${snapshot.url}`
  }
  async inspect(command: BrowserCommand) {
    if (!this.session) throw Error('Open a website first.')
    const { frameTree } = await this.call('Page.getFrameTree')
    const { executionContextId } = await this.call('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'Nalu page controls' })
    const result = await this.call('Runtime.evaluate', { expression: `(${inspectBrowserPage.toString()})(${JSON.stringify(command)})`, contextId: executionContextId, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    const value = result.result.value
    if (command.action === 'snapshot') this.emit({ title: value.title, url: value.url })
    return value
  }
  async evaluate(expression: string) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 10000 })
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return typeof result.result.value === 'string' ? result.result.value : JSON.stringify(result.result.value) ?? ''
  }
  async click(selector: string) {
    const generation = this.generation
    const point = await this.inspect({ action: 'target', selector }); this.check(generation)
    await this.clickAt(point.x, point.y, generation)
    return `Clicked ${selector}`
  }
  async clickAt(x: number, y: number, generation = this.generation) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > this.preview.width || y > this.preview.height) throw Error('Click is outside the browser viewport.')
    this.check(generation)
    await this.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); this.check(generation)
    await this.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    this.emit({ target: { x, y } })
    await this.capture()
  }
  async fill(selector: string, text: string) {
    const generation = this.generation
    const focused = await this.inspect({ action: 'focus', selector }); this.check(generation)
    if (!focused.focused) throw Error('The field could not receive focus.')
    await this.type(text, generation); return `Filled ${selector}`
  }
  async type(text: string, generation = this.generation) { this.check(generation); await this.call('Input.insertText', { text }); await this.capture(); return `Typed ${text.length} characters` }
  async key(key: string) {
    const keys: Record<string, [string, number]> = { Return: ['Enter',13], Enter:['Enter',13], Tab:['Tab',9], Escape:['Escape',27], Backspace:['Backspace',8], Delete:['Delete',46], ArrowLeft:['ArrowLeft',37], ArrowUp:['ArrowUp',38], ArrowRight:['ArrowRight',39], ArrowDown:['ArrowDown',40], Space:[' ',32] }
    const pair=keys[key] || (key.length===1 ? [key,key.toUpperCase().charCodeAt(0)] as [string,number] : null)
    if(!pair)throw Error('Use a named browser key such as Enter, Tab, Escape or ArrowDown.')
    await this.call('Input.dispatchKeyEvent',{type:'keyDown',key:pair[0],windowsVirtualKeyCode:pair[1],...(key==='Enter'||key==='Return'?{text:'\r'}:{})})
    await this.call('Input.dispatchKeyEvent',{type:'keyUp',key:pair[0],windowsVirtualKeyCode:pair[1]})
    await this.capture();return `Pressed ${key}`
  }
  async scroll(x:number,y:number) {
    if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>2000||Math.abs(y)>2000)throw Error('Scroll must be at most 2000 pixels per step.')
    await this.call('Input.dispatchMouseEvent',{type:'mouseWheel',x:this.preview.width/2,y:this.preview.height/2,deltaX:x,deltaY:y})
    await this.capture();return 'Scrolled the page'
  }
  async capture() {
    if (!this.session) return ''
    try {
      const [{ data }, metrics] = await Promise.all([this.call('Page.captureScreenshot', { format: 'jpeg', quality: 70 }), this.call('Page.getLayoutMetrics')])
      this.emit({ image: 'data:image/jpeg;base64,' + data, width: metrics.cssLayoutViewport.clientWidth, height: metrics.cssLayoutViewport.clientHeight })
      return this.preview.image
    } catch { return this.preview.image }
  }
  async close() { this.cancel(); if(this.writer) await this.call('Browser.close',{},'').catch(()=>{}) }
}
