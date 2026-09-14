// Local website QA fallback when the in-app browser execution tool is absent.
const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), readline = require('node:readline')
const [url, destination] = process.argv.slice(2)
if (!url || !destination) throw Error('Usage: electron website-browser.cjs URL evidence-directory')
const output = path.resolve(destination)
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-website-browser-')))
let win
const logs = []
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, done) => {
    done({ cancel: !['127.0.0.1', 'localhost', '::1'].includes(new URL(details.url).hostname) })
  })
  win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  win.webContents.on('console-message', (_event, level, message) => logs.push({ level, message }))
  await win.loadURL(url)
  console.log('BROWSER_READY')
  const input = readline.createInterface({ input: process.stdin })
  let queue = Promise.resolve()
  input.on('line', line => { queue = queue.then(async () => {
    try {
      const command = JSON.parse(line)
      let result
      if (command.op === 'snapshot') result = await win.webContents.executeJavaScript(`({url:location.href,title:document.title,text:document.body.innerText.slice(0,16000),controls:[...document.querySelectorAll('a,button,input,select,textarea,[role="dialog"]')].map(e=>({tag:e.tagName,text:e.innerText?.slice(0,100),name:e.getAttribute('aria-label'),label:e.labels?.[0]?.innerText,id:e.id,type:e.type,placeholder:e.placeholder,disabled:e.disabled,href:e.getAttribute('href')})),overflow:document.documentElement.scrollWidth>innerWidth})`)
      else if (command.op === 'js') result = await win.webContents.executeJavaScript(command.code)
      else if (command.op === 'key') { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: command.key }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: command.key }); result = true }
      else if (command.op === 'text') { await win.webContents.insertText(command.text); result = true }
      else if (command.op === 'reload') { await win.loadURL(win.webContents.getURL()); result = true }
      else if (command.op === 'resize') { win.setContentSize(command.width, command.height); result = true }
      else if (command.op === 'screenshot') {
        win.show(); win.focus(); win.webContents.focus()
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        const file = path.join(output, path.basename(command.name || 'website.png'))
        fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); result = file
      } else if (command.op === 'logs') result = logs
      else if (command.op === 'quit') { app.quit(); return }
      else throw Error('Unknown operation')
      fs.appendFileSync(path.join(output, 'browser-audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), command, result }) + '\n')
      console.log(JSON.stringify({ id: command.id, result }))
    } catch (error) { console.log(JSON.stringify({ error: error.message })) }
  }) })
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
