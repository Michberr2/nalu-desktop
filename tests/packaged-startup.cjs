// Exercise the packaged main/preload/renderer together, with external state isolated.
const {app,BrowserWindow,dialog,session}=require('electron')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const sourceMode=process.argv.includes('--source')
const resources=path.resolve(sourceMode?'.':process.argv[2]||'review-build/mac-arm64/Nalu.app/Contents/Resources')
const application=sourceMode?resources:path.join(resources,'app.asar')
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-packaged-startup-'))
const home=path.join(scratch,'home'),fixture=path.join(scratch,'project')
fs.mkdirSync(home);fs.mkdirSync(fixture)
fs.writeFileSync(path.join(fixture,'packaged-fixture.txt'),'PACKAGED_EDITOR_CONTENT\n')
os.homedir=()=>home
process.env.GH_CONFIG_DIR=path.join(scratch,'gh')
process.env.GIT_CONFIG_GLOBAL=path.join(scratch,'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM='1'
process.env.GH_TOKEN='';process.env.GITHUB_TOKEN=''
process.env.NALU_NO_TRAINING_DATA='1'
delete process.env.VITE_DEV_SERVER_URL
app.setPath('userData',path.join(scratch,'profile'))
app.setAppPath(application)
Object.defineProperty(app,'isPackaged',{value:!sourceMode})
if(!sourceMode)Object.defineProperty(process,'resourcesPath',{value:resources})
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]})
const ready=app.whenReady().then(()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}))
})
let win
const created=new Promise(resolve=>app.once('browser-window-created',(_event,window)=>{win=window;resolve(window)}))
const wait=async(check,label)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error('Timed out: '+label)}
require(path.join(application,'dist-electron/main.js'))
;(async()=>{
  await ready;await created
  const js=code=>win.webContents.executeJavaScript(code)
  await wait(()=>!win.webContents.isLoading(),'packaged renderer load')
  await wait(()=>js(`!!document.querySelector('button[title="Open folder"]')`),'IDE ready')
  assert.equal(win.webContents.getLastWebPreferences().sandbox,true,'main renderer sandbox enabled')
  assert.equal(win.webContents.getLastWebPreferences().contextIsolation,true)
  assert.equal(await js(`typeof require`),'undefined','no Node API in renderer')
  win.show();win.focus();win.webContents.focus()
  await js(`document.querySelector('button[title="Open folder"]').click()`)
  await wait(()=>js(`document.body.textContent.includes('packaged-fixture.txt')`),'real directory IPC')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'p',metaKey:true,bubbles:true}))`)
  await wait(()=>js(`!!document.querySelector('[cmdk-item]')`),'packaged quick open')
  await js(`document.querySelector('[cmdk-item]').click()`)
  await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('PACKAGED_EDITOR_CONTENT')`),'real file-read IPC and editor')
  assert.equal(await js(`window.nalu.readFile(${JSON.stringify(path.join(fixture,'packaged-fixture.txt'))})`),'PACKAGED_EDITOR_CONTENT\n')
  const cli=fs.readFileSync(path.join(resources,'cli/nalu.mjs'))
  await wait(()=>fs.existsSync(path.join(home,'.nalu/bin/nalu.mjs')),'isolated CLI installed')
  assert.deepEqual(fs.readFileSync(path.join(home,'.nalu/bin/nalu.mjs')),cli)
  await js(`window.packagedOutput='';window.nalu.term.onData('packaged-test',data=>{window.packagedOutput+=data});void 0`)
  assert.equal(await js(`window.nalu.term.create('packaged-test',${JSON.stringify(fixture)},'sh')`),true)
  await js(`window.nalu.term.input('packaged-test',"printf 'PACKAGED_TERMINAL_OK\\n'\\n");void 0`)
  await wait(()=>js(`window.packagedOutput.includes('PACKAGED_TERMINAL_OK')`),'real terminal IPC')
  await js(`window.nalu.term.input('packaged-test',"nalu --version\\n");void 0`)
  const version=cli.toString().match(/const VERSION = '([^']+)'/)[1]
  await wait(()=>js(`window.packagedOutput.includes(${JSON.stringify('nalu '+version)})`),'installed CLI via packaged terminal')
  await js(`window.nalu.term.kill('packaged-test')`)
  // Exercise the actual registered main handlers from a different renderer,
  // even when it deliberately loads the exact same preload and application.
  const foreign=new BrowserWindow({show:false,webPreferences:{preload:path.join(application,'dist-electron/preload.js'),contextIsolation:true,sandbox:true}})
  try {
    await foreign.loadFile(path.join(application,'dist/index.html'))
    const rejected=await foreign.webContents.executeJavaScript(`window.nalu.readFile(${JSON.stringify(path.join(fixture,'packaged-fixture.txt'))}).then(()=>false,e=>String(e).includes('Untrusted desktop IPC sender'))`)
    assert.equal(rejected,true,'foreign renderer cannot access filesystem IPC')
  } finally {foreign.destroy()}
  let navigationBlocked=false
  win.webContents.once('will-navigate',event=>{navigationBlocked=event.defaultPrevented})
  await js(`location.href='https://example.invalid/';void 0`)
  await wait(()=>navigationBlocked,'navigation to external page blocked')
  assert.equal(await js(`window.nalu.readFile(${JSON.stringify(path.join(fixture,'packaged-fixture.txt'))})`),'PACKAGED_EDITOR_CONTENT\n','trusted renderer remains usable after blocked navigation')
  await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  fs.writeFileSync(path.join(scratch,'packaged-startup.png'),(await win.webContents.capturePage()).toPNG())
  console.log('STARTUP_MAIN_IPC_EDITOR_PTY_CLI_SECURITY_PASS')
  console.log('Evidence: '+scratch)
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{win?.destroy();app.exit(process.exitCode||0)})
