// Run after npm run build: electron tests/ide-smoke.cjs
// Uses the real renderer, preload, xterm and PTY. All non-terminal IPC is local.
const {app, BrowserWindow, ipcMain, session, shell} = require('electron')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict'), ts = require('typescript'), Module = require('node:module')
const root = path.resolve(__dirname, '..')
const cliVersion = fs.readFileSync(path.join(root,'cli/nalu.mjs'),'utf8').match(/const VERSION = '([^']+)'/)[1]
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-ide-smoke-'))
app.setPath('userData', path.join(scratch, 'profile'))
const mod = new Module(path.join(root, 'electron/terminalSessions.ts'))
mod._compile(ts.transpileModule(fs.readFileSync(mod.id, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, mod.id)
const installer = new Module(path.join(root, 'electron/cliInstall.ts'))
installer._compile(ts.transpileModule(fs.readFileSync(installer.id,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,installer.id)
const terminals = new mod.exports.TerminalSessions()
const creates = [], kills = [], inputs = [], output = [], exits = []
const commandTest = process.env.NALU_IDE_COMMAND_TEST === '1'
const pcCancelTest = process.env.NALU_IDE_PC_CANCEL_TEST === '1'
let releasePcPermissions, pcPlanningCalls=0
const terminalTest = process.env.NALU_IDE_TERMINAL_TEST === '1'
let terminalReplies = 0
const liveAgent = process.env.NALU_IDE_LIVE_AGENT === '1'
const streamTest = process.env.NALU_IDE_STREAM_TEST === '1'
const previewTest = process.env.NALU_IDE_PREVIEW_TEST === '1'
let previewReplies = 0
const agentTest = pcCancelTest || previewTest || streamTest || liveAgent || terminalTest || commandTest || process.env.NALU_IDE_AGENT_TEST === '1'
const commandModule = new Module(path.join(root,'electron/commandRunner.ts'))
commandModule._compile(ts.transpileModule(fs.readFileSync(commandModule.id,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,commandModule.id)
const journalModule = new Module(path.join(root,'electron/sessionJournal.ts'))
journalModule._compile(ts.transpileModule(fs.readFileSync(journalModule.id,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,journalModule.id)
const journal = new journalModule.exports.SessionJournal(path.join(scratch,'profile','workspace-recovery.json'))
const saveAsTest = process.env.NALU_IDE_SAVE_AS_TEST === '1'
const recoveryTest = saveAsTest || process.env.NALU_IDE_RECOVERY_TEST === '1'
let saveDialogs = 0
const commandJobs = new Map()
let commandStarted = false
const taskLedger = []
const saveTest = process.env.NALU_IDE_SAVE_TEST === '1'
const renameTest = process.env.NALU_IDE_RENAME_TEST === '1'
const createTest = process.env.NALU_IDE_CREATE_TEST === '1'
const trashTest = process.env.NALU_IDE_TRASH_TEST === '1'
const searchTest = process.env.NALU_IDE_SEARCH_TEST === '1'
const gitOperationTest = process.env.NALU_IDE_GIT_OPERATION_TEST === '1'
const openTest = process.env.NALU_IDE_OPEN_TEST === '1'
const contextTest = process.env.NALU_IDE_CONTEXT_TEST === '1'
const quickTest = process.env.NALU_IDE_QUICK_TEST === '1'
let delayQuickIndex=false,pendingQuickIndex
let pendingContextIndex
const contextReads=[]
const pendingOpens = new Map()
const textReader = new Module(path.join(root,'electron/readTextFile.ts'))
textReader._compile(ts.transpileModule(fs.readFileSync(textReader.id,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,textReader.id)
const gitRaceTest = gitOperationTest || process.env.NALU_IDE_GIT_RACE_TEST === '1'
const pendingDiffs = []
const pendingCommits = [], gitStatusRoots = []
const pendingSearches = new Map()
let searchCancellations = 0
let denyTrash = true
let releaseRename = null
let delayWrite = false, releaseWrite = null, failWrite = false
const review = process.env.NALU_IDE_GIT_TEST === '1'
const gitModule = new Module(path.join(root,'electron/gitWorkspace.ts'))
gitModule._compile(ts.transpileModule(fs.readFileSync(gitModule.id,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,gitModule.id)
const runGit = async(cwd,args)=>{const r=require('node:child_process').spawnSync('git',args,{cwd,encoding:'utf8'});return {ok:r.status===0,out:r.stdout+(r.status===0?'':r.stderr)}}
const live = process.env.NALU_IDE_LIVE_TEST === '1'
const duo = process.env.NALU_IDE_LIVE_DUO === '1'
const task = `${duo ? '/duo ' : ''}Fix the invoice fixture. subtotal must multiply each unit price by quantity; invoiceTotal must treat taxPercent as a percentage (10 means 10%). Correct both modules, preserve their exports, and run node invoice.test.mjs. Do not modify invoice.test.mjs. Work only in this directory, do not use web tools, and give a brief final result.`
let win
const wait = async (fn, label, timeout = 10000) => {
  const until = Date.now()+timeout
  while(Date.now()<until) { if(await fn()) return; await new Promise(r=>setTimeout(r,50)) }
  throw new Error('Timed out: '+label)
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (details, cb)=>cb({cancel:!agentTest || !details.url.startsWith('https://')}))
  if(agentTest)session.defaultSession.protocol.handle('https',async request=>{
    const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}
    if(request.method==='OPTIONS')return new Response('',{headers})
    if(streamTest && request.url.endsWith('/api/chat'))return new Response('event: delta\ndata: '+JSON.stringify({text:JSON.stringify({tool:'run',command:'node invoice.test.mjs'})})+'\n\n',{headers:{...headers,'Content-Type':'text/event-stream'}})
    if(liveAgent && request.url.endsWith('/api/chat')) {
      const readConfig=name=>{try{return JSON.parse(fs.readFileSync(path.join(os.homedir(),'.nalu',name),'utf8'))}catch{return {}}}
      const config={...readConfig('cli.json'),...readConfig('config.json')}
      const token=process.env.NALU_TOKEN || config.token
      assert.ok(token,'Nalu sign-in required for live Agent acceptance')
      const response=await fetch('https://n4lu.ai/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:await request.text(),signal:AbortSignal.timeout(90000)})
      assert.ok(response.ok,`Live API returned HTTP ${response.status}`)
      const content=await response.text()
      fs.appendFileSync(path.join(scratch,'agent-stream.log'),content+'\n')
      console.log('LIVE_AGENT_MODEL_RESPONSE')
      return new Response(content,{headers:{...headers,'Content-Type':'text/event-stream'}})
    }
    if(request.url.endsWith('/api/chat') && pcCancelTest)pcPlanningCalls++
    if(request.url.endsWith('/api/chat'))return new Response('event: delta\ndata: '+JSON.stringify({text:terminalTest ? (terminalReplies++ === 0 ? 'false' : 'DONE: Fixed and verified') : JSON.stringify(previewTest && previewReplies++===0 ? {tool:'write_file',path:'fixture.js',content:'const value = 63;\n'} : commandTest?{tool:'run',command:'while :; do sleep 1; done'}:{tool:'done',summary:'Fixed and verified'})})+'\n\nevent: done\ndata: {"ok":true}\n\n',{headers:{...headers,'Content-Type':'text/event-stream'}})
    const body=await request.json().catch(()=>({}))
    if(body.action==='task-log')taskLedger.push(body)
    return new Response(JSON.stringify({ok:true,tasks:[],members:[]}),{headers})
  })
  const cli = installer.exports.installDesktopCli({sourcePath:path.join(root,'cli/nalu.mjs'),binDir:path.join(scratch,'cli bin'),runtime:process.execPath})
  const fixture = path.join(scratch, 'project with spaces'); fs.mkdirSync(fixture)
  let folderChoice = fixture
  const recoveredPath = path.join(fixture,'recovered.js')
  ipcMain.handle('dialog:saveFile',()=>trashTest ? recoveredPath : ++saveDialogs===1 ? null : recoveredPath)
  const documentPath = path.join(fixture,'fixture.js'); fs.writeFileSync(documentPath,'const value = 1;\n')
  if(openTest)for(const name of ['slow.js','latest.js','missing.js','project-slow.js'])fs.writeFileSync(path.join(fixture,name),`const marker = '${name}';\n`)
  if(openTest){
    fs.writeFileSync(path.join(fixture,'binary.dat'),Buffer.from([65,0,66]))
    fs.writeFileSync(path.join(fixture,'large.txt'),'')
    fs.truncateSync(path.join(fixture,'large.txt'),textReader.exports.EDITOR_FILE_LIMIT+1)
  }
  if(trashTest){fs.mkdirSync(path.join(fixture,'trash-folder'));fs.writeFileSync(path.join(fixture,'trash-folder','clean.js'),'clean original')}
  if(renameTest){fs.mkdirSync(path.join(fixture,'source'));fs.writeFileSync(path.join(fixture,'source','child.js'),'const child = 1;\n')}
  const navigationPath = path.join(fixture,'navigation.js')
  if(saveTest)fs.writeFileSync(navigationPath,'const first = 1;\nconst second = 2;\n')
  const secondPath = path.join(fixture,'second.js')
  if (saveTest) fs.writeFileSync(secondPath,'const second = 1;\n')
  const invoiceTest = "import assert from 'node:assert/strict';\nimport {subtotal} from './price.mjs';\nimport {invoiceTotal} from './invoice.mjs';\nassert.equal(subtotal([{price:12,quantity:3},{price:5,quantity:2}]),46);\nassert.equal(subtotal([]),0);\nassert.equal(invoiceTotal([{price:10,quantity:2}],10),22);\nassert.equal(invoiceTotal([{price:4,quantity:3}],0),12);\nassert.equal(invoiceTotal([],10),0);\nconsole.log('INVOICE_TESTS_PASS');\n"
  if (live || liveAgent) {
    fs.writeFileSync(path.join(fixture,'price.mjs'), 'export const subtotal = items => items.reduce((sum, item) => sum + item.price, 0)\n')
    fs.writeFileSync(path.join(fixture,'invoice.mjs'), "import {subtotal} from './price.mjs'\nexport const invoiceTotal = (items, taxPercent) => subtotal(items) * (1 + taxPercent)\n")
    fs.writeFileSync(path.join(fixture,'invoice.test.mjs'),invoiceTest)
    console.log('LIVE_FIXTURE: '+fixture)
  }
  if (review) {
    assert.ok((await runGit(fixture,['init','-b','ide-review-branch'])).ok)
    await runGit(fixture,['add','fixture.js'])
    assert.ok((await runGit(fixture,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture'])).ok)
  }
  ipcMain.handle('git:status',(_e,cwd)=>{gitStatusRoots.push(cwd);return gitRaceTest?{repo:true,branch:'fixture-branch',files:['slow.js','latest.js','error.js'].map(path=>({path,x:' ',y:'M'}))}:review?gitModule.exports.workspaceStatus(runGit,cwd):{repo:false}})
  ipcMain.handle('git:diff',async(_e,cwd,file,staged)=>{
    if(!gitRaceTest)return gitModule.exports.workspaceDiff(runGit,cwd,file,staged)
    if(file==='slow.js')return await new Promise(resolve=>pendingDiffs.push(resolve))
    if(file==='error.js')throw new Error('Fixture diff denied')
    return '+ LATEST_DIFF'
  })
  if(gitRaceTest)ipcMain.handle('git:stage',()=>false)
  if(gitOperationTest)ipcMain.handle('git:commitPush',(_e,cwd,msg)=>new Promise(resolve=>pendingCommits.push({cwd,msg,resolve})))
  for(const [channel, result] of Object.entries({'git:remote':'','git:stat':{added:0,removed:0},'github:status':{loggedIn:false,hasGh:false},'app:version':'0.1.14','nalu:cli-sync':true,'term:shells':['sh']})) ipcMain.handle(channel,()=>result)
  if(pcCancelTest)ipcMain.handle('pc:permissions',()=>new Promise(resolve=>{releasePcPermissions=resolve}))
  ipcMain.handle('dialog:openFolder',()=>folderChoice)
  if(contextTest)fs.mkdirSync(path.join(fixture,'slow-index'))
  if(quickTest){
    fs.mkdirSync(path.join(fixture,'nested'))
    fs.writeFileSync(path.join(fixture,'nested','終-$&.txt'),'Quick opened Unicode file\n')
    fs.writeFileSync(path.join(fixture,'root-file.txt'),'Quick opened root file\n')
  }
  ipcMain.handle('fs:readDir',(_e,dir)=>{
    contextReads.push(dir)
    if(quickTest && delayQuickIndex && dir===path.join(fixture,'nested'))return new Promise(resolve=>{pendingQuickIndex=resolve})
    if(contextTest && dir===path.join(fixture,'slow-index'))return new Promise(resolve=>{pendingContextIndex=resolve})
    return fs.readdirSync(dir,{withFileTypes:true}).map(entry=>({name:entry.name,path:path.join(dir,entry.name),dir:entry.isDirectory()}))
  })
  if(createTest){
    const createModule=new Module(path.join(root,'electron/createEntry.ts'))
    createModule._compile(ts.transpileModule(fs.readFileSync(createModule.id,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,createModule.id)
    for(const [channel,kind] of [['fs:createFile','file'],['fs:mkdir','folder']])ipcMain.handle(channel,(_e,dir,name)=>{assert.ok(dir===fixture||dir.startsWith(fixture+path.sep));return createModule.exports.createEntry(dir,name,kind)})
  }
  if(renameTest){
    const renameModule=new Module(path.join(root,'electron/renameEntry.ts'))
    renameModule._compile(ts.transpileModule(fs.readFileSync(renameModule.id,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,renameModule.id)
    ipcMain.handle('fs:rename',async(_e,from,to)=>{assert.ok(from.startsWith(fixture+path.sep)&&to.startsWith(fixture+path.sep));if(path.basename(to)==='delayed.js')await new Promise(resolve=>{releaseRename=resolve});return renameModule.exports.renameEntry(from,to)})
  }
  ipcMain.handle('workspace:load',()=>journal.read())
  ipcMain.handle('workspace:save',(_e,raw)=>journal.write(raw))
  ipcMain.handle('sys:exec',async(e,cwd,command,id)=>{const controller=new AbortController();const key=`${e.sender.id}:${id}`;commandJobs.set(key,controller);commandStarted=true;try{if(liveAgent)assert.match(command.trim(),/^node invoice\.test\.mjs$/,'Live fixture allows only node invoice.test.mjs');return await commandModule.exports.runCommand(cwd,command,{signal:controller.signal})}finally{commandJobs.delete(key)}})
  ipcMain.on('sys:cancel',(e,id)=>commandJobs.get(`${e.sender.id}:${id}`)?.abort())
  ipcMain.handle('fs:search',async(_e,dir,query)=>{
    if(!searchTest)return [{file:navigationPath,rel:'navigation.js',line:2,text:'const second = 2;'}]
    if(query==='failure')throw new Error('Fixture search denied')
    if(query==='limit')return Array.from({length:300},(_,i)=>({file:path.join(dir,'fixture.js'),rel:'fixture.js',line:i+1,text:'LIMIT_MATCH_'+i}))
    if(query.startsWith('slow'))return await new Promise(resolve=>pendingSearches.set(query,resolve))
    return [{file:path.join(dir,'fixture.js'),rel:query==='special'?'__proto__':'fixture.js',line:1,text:'RESULT_'+query}]
  })
  ipcMain.on('fs:cancelSearch',()=>{searchCancellations++})
  ipcMain.handle('fs:readFile',(_e,file)=>{
    if(openTest && ['slow.js','project-slow.js'].includes(path.basename(file)) && !pendingOpens.has(file))return new Promise(resolve=>pendingOpens.set(file,resolve))
    return textReader.exports.readTextFile(file)
  })
  if(trashTest)ipcMain.handle('fs:delete',async(_e,target)=>{assert.ok(target.startsWith(fixture+path.sep));if(denyTrash)throw new Error('Fixture Trash denied');await shell.trashItem(target);return true})
  ipcMain.handle('fs:writeFile',async(_e,file,content)=>{assert.ok(file===documentPath || (renameTest && file.startsWith(fixture+path.sep)) || ((saveAsTest||trashTest) && file===recoveredPath) || (liveAgent && ['price.mjs','invoice.mjs'].some(name=>file===path.join(fixture,name))) || (saveTest && (file===secondPath || file===navigationPath)));if(failWrite)throw new Error('Fixture save denied');if(delayWrite){delayWrite=false;await new Promise(resolve=>{releaseWrite=resolve})}fs.writeFileSync(file,content);return true})
  ipcMain.handle('term:create',(e,id,cwd,kind)=>{
    creates.push({id,cwd,kind})
    return terminals.create(`${e.sender.id}:${id}`,async()=>require('node-pty').spawn(kind==='nalu'?process.execPath:'/bin/sh',kind==='nalu'?[cli.script,...(live?['--yolo',task]:[])]:[],{name:'xterm-256color',cols:80,rows:24,cwd:cwd||scratch,env:{...process.env,...(kind==='nalu'?{ELECTRON_RUN_AS_NODE:'1'}:{}),NALU_NO_TRAINING_DATA:'1',NALU_REMOTE_TASK:'',PS1:'IDE_TEST> '}}),(kind,data)=>{
      if(kind==='data'){output.push(data);if(live){fs.appendFileSync(path.join(scratch,'terminal.log'),data);process.stdout.write(data)}}
      if(kind==='exit')exits.push({id,code:data})
      if(!e.sender.isDestroyed())e.sender.send(`term:${kind}:${id}`,data)
    })
  })
  ipcMain.handle('term:kill',(e,id)=>{kills.push(id);terminals.kill(`${e.sender.id}:${id}`);return true})
  ipcMain.on('term:input',(e,id,data)=>{inputs.push(data);terminals.input(`${e.sender.id}:${id}`,data)})
  ipcMain.on('term:resize',(e,id,c,r)=>terminals.resize(`${e.sender.id}:${id}`,c,r))
  win = new BrowserWindow({show:false,width:1200,height:850,webPreferences:{preload:path.join(root,'dist-electron/preload.js'),contextIsolation:true,sandbox:false}})
  const js = code => win.webContents.executeJavaScript(code)
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
  await win.loadFile(path.join(root,'dist/index.html'))
  await wait(()=>js(`!!document.querySelector('button[title="Toggle terminal (⌘\u0060)"]')`),'IDE loaded')
  await click('button[title="Toggle terminal (⌘`)"]')
  await wait(()=>creates.length===1 && output.join('').includes('IDE_TEST>'),'terminal ready')
  const original = creates[0].id
  terminals.input(`${win.webContents.id}:${original}`, `'${cli.launcher}' --version\n`)
  await wait(()=>output.join('').includes('nalu '+cliVersion),'Nalu CLI in PTY')
  await click('button[aria-label="Hide terminal"]')
  await click('button[title="Toggle terminal (⌘`)"]')
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Chats').click()`)
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Workspace').click()`)
  assert.equal(creates.length,1); assert.equal(kills.length,0)
  await click('button[title="Open folder"]')
  await wait(()=>js(`document.body.textContent.includes('project with spaces')`),'folder switched')
  assert.deepEqual(inputs,[],'folder switching must not type into the active CLI')
  await click('button[title="New terminal"]')
  await wait(()=>creates.length===2,'new terminal')
  assert.equal(creates[1].cwd,fixture)
  terminals.input(`${win.webContents.id}:${creates[1].id}`,'exit 7\n')
  await wait(()=>js(`document.body.textContent.includes('Shell exited with code 7.')`),'exit status')
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Restart shell').click()`)
  await wait(()=>creates.length===3,'explicit restart')
  assert.equal(creates[2].cwd,fixture)
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='fixture.js').click()`)
  await wait(()=>js(`!!document.querySelector('.monaco-editor textarea')`),'editor loaded')
  await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('value')`),'initial editor text')
  win.show(); win.focus(); win.webContents.focus()
  await js(`document.querySelector('.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea').focus()`)
  await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'X'})
  win.webContents.sendInputEvent({type:'char',keyCode:'x'})
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'X'})
  await wait(()=>js(`document.querySelector('.view-lines')?.textContent.replace(/\\s/g,'').includes('xconst')`),'user edit reached Monaco')
  fs.writeFileSync(documentPath,'const value = 99;\n')
  await wait(()=>js(`document.body.textContent.includes('Your unsaved edits are preserved.')`),'external edit conflict')
  assert.equal(fs.readFileSync(documentPath,'utf8'),'const value = 99;\n','autosave must not clobber the external edit')
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Use disk version').click()`)
  await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('99')`),'disk version displayed')
  win.hide()
  fs.writeFileSync(documentPath,'const value = 42;\n')
  win.show(); win.focus(); win.webContents.focus()
  await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('42')`),'clean editor follows CLI edits')
  terminals.input(`${win.webContents.id}:${creates[2].id}`, "printf 'IDE_SESSION_READY\\n'\n")
  await wait(()=>output.join('').includes('IDE_SESSION_READY'),'restarted shell output')
  if (saveTest) {
    const typePrefix = async letter => {
      win.show();win.focus();win.webContents.focus()
      await js(`document.querySelector('.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea').focus()`)
      win.webContents.sendInputEvent({type:'keyDown',keyCode:letter.toUpperCase()})
      win.webContents.sendInputEvent({type:'char',keyCode:letter})
      win.webContents.sendInputEvent({type:'keyUp',keyCode:letter.toUpperCase()})
      await wait(()=>js(`document.body.textContent.includes('Unsaved')`),'edit marked unsaved')
    }
    await typePrefix('x')
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='second.js').click()`)
    await wait(()=>fs.readFileSync(documentPath,'utf8').includes('x'),'inactive file autosaved')
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('second')`),'second file loaded')
    delayWrite=true
    await typePrefix('y')
    await wait(()=>releaseWrite!==null,'save in flight')
    await typePrefix('z')
    releaseWrite();releaseWrite=null
    await wait(()=>fs.readFileSync(secondPath,'utf8').includes('yz'),'typing during save persisted')
    failWrite=true
    await typePrefix('q')
    await click('button[aria-label="Close second.js"]')
    await wait(()=>js(`document.body.textContent.includes('Fixture save denied')`),'save failure surfaced')
    assert.equal(await js(`!!document.querySelector('button[aria-label="Close second.js"]')`),true)
    failWrite=false
    await click('button[aria-label="Close second.js"]')
    await wait(()=>js(`!document.querySelector('button[aria-label="Close second.js"]')`),'save then close')
    assert.ok(fs.readFileSync(secondPath,'utf8').includes('yzq'))
    await click('button[title="Search"]')
    await js(`document.querySelector('input[placeholder="Search in files"]').focus()`)
    await win.webContents.insertText('second')
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'})
    await wait(()=>js(`!!document.querySelector('button[title="navigation.js:2"]')`),'search result')
    await click('button[title="navigation.js:2"]')
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('first')`),'navigation file loaded')
    await typePrefix('a')
    await wait(()=>fs.readFileSync(navigationPath,'utf8').includes('aconst second'),'first edit after navigation')
    await typePrefix('b')
    await wait(()=>fs.readFileSync(navigationPath,'utf8').includes('abconst second'),'cursor preserved across autosave')
    await click('button[title="Files"]')
    await wait(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='navigation.js')`),'file tree loaded')
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='fixture.js').click()`)
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('value')`),'switched away from navigation')
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='navigation.js').click()`)
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('second')`),'returned to navigation')
    await typePrefix('c')
    await wait(()=>fs.readFileSync(navigationPath,'utf8').includes('abcconst second'),'cursor preserved across tabs')
    console.log('EDITOR_SAVE_AND_NAVIGATION_VERIFIED')
  }
  if (review) {
    await wait(()=>js(`document.body.textContent.includes('ide-review-branch')`),'actual Git branch')
    await runGit(fixture,['add','fixture.js'])
    fs.writeFileSync(documentPath,'const value = 84;\n')
    await click('button[title="Source control"]')
    await wait(()=>js(`!!document.querySelector('button[title="Review staged fixture.js"]')`),'staged and unstaged rows')
    await click('button[title="Review staged fixture.js"]')
    await wait(()=>js(`document.body.textContent.includes('+const value = 42;')`),'staged diff')
    assert.equal(await js(`document.body.textContent.includes('+const value = 84;')`),false)
    await click('button[title="Close diff"]')
    await click('button[title="Review unstaged fixture.js"]')
    await wait(()=>js(`document.body.textContent.includes('+const value = 84;')`),'unstaged diff')
    await click('button[title="Close diff"]')
    await click('button[title="Files"]')
    console.log('GIT_REVIEW_VERIFIED')
  }
  if (live || liveAgent) {
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='price.mjs').click()`)
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('item.price')`),'live source open in editor')
  }
  await click('button[title="Start Nalu CLI in the current project"]')
  await wait(()=>creates.length===4 && output.join('').includes('Nalu CLI v'+cliVersion),'dedicated Nalu terminal')
  assert.equal(creates[3].kind,'nalu'); assert.equal(creates[3].cwd,fixture)
  if (live) {
    await wait(()=>output.join('').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').trim().endsWith('❯') || exits.some(exit=>exit.id===creates[3].id),'live Nalu task completion',480000)
    if (!exits.some(exit=>exit.id===creates[3].id)) terminals.input(`${win.webContents.id}:${creates[3].id}`,'/exit\n')
    await wait(()=>exits.some(exit=>exit.id===creates[3].id),'CLI session exit')
    assert.equal(exits.find(exit=>exit.id===creates[3].id).code,0)
    assert.equal(fs.readFileSync(path.join(fixture,'invoice.test.mjs'),'utf8'),invoiceTest)
    const verification = require('node:child_process').spawnSync(process.execPath,[path.join(fixture,'invoice.test.mjs')],{cwd:fixture,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8'})
    assert.equal(verification.status,0,verification.stdout+verification.stderr)
    win.show(); win.focus(); win.webContents.focus()
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('quantity')`),'live CLI edits reflected in editor')
    console.log('LIVE_INVOICE_VERIFIED: '+verification.stdout.trim())
  } else {
    terminals.input(`${win.webContents.id}:${creates[3].id}`,'/help\n')
    await wait(()=>output.join('').includes('/duo [<task>]'),'full CLI command help')
  }
  if(agentTest){
    await js(`localStorage.setItem('nalu-token','isolated-test-token')`)
    await js(`Array.from(document.querySelectorAll('button')).filter(b=>b.textContent===${JSON.stringify(pcCancelTest ? 'PC' : terminalTest ? 'Terminal' : 'Agent')}).at(-1).click()`)
    win.show();win.focus();win.webContents.focus()
    const taskInput = `textarea[placeholder=${JSON.stringify(pcCancelTest ? 'Tell Nalu what to do on your computer…' : terminalTest ? 'Describe a terminal task…' : 'Give Nalu a coding task…')}]`
    await wait(()=>js(`!!document.querySelector(${JSON.stringify(taskInput)})`),'task input mode')
    await js(`document.querySelector(${JSON.stringify(taskInput)}).focus()`)
    await win.webContents.insertText(liveAgent ? task : 'Fix fixture.js')
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'})
    if(pcCancelTest){
      await wait(()=>!!releasePcPermissions,'PC permissions pending')
      await click('button[aria-label="Stop task"]')
      releasePcPermissions({platform:'darwin',accessibility:true,screen:true})
      await wait(()=>js(`!!document.querySelector('button[aria-label="Send prompt"]')`),'PC task stopped')
      assert.equal(pcPlanningCalls,0)
      await wait(()=>taskLedger.some(entry=>entry.status==='cancelled'),'PC cancellation ledger')
      console.log('PC_PERMISSION_CANCELLATION_VERIFIED')
    }else if(previewTest){
      await wait(()=>js(`!!document.querySelector('section[aria-label^="Proposed changes"] .monaco-diff-editor')`),'edit diff visible')
      await wait(()=>js(`document.querySelector('section[aria-label^="Proposed changes"]')?.textContent.includes('63')`),'proposed code visible')
      fs.writeFileSync(documentPath,'const value = 84;\n')
      await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Approve').click()`)
      await wait(()=>js(`document.body.textContent.includes('File changed while awaiting approval')`),'stale approval rejected')
      await wait(()=>taskLedger.some(entry=>entry.status==='failed'),'incomplete stale edit task status')
      assert.equal(fs.readFileSync(documentPath,'utf8'),'const value = 84;\n')
      console.log('EDIT_DIFF_AND_STALE_APPROVAL_VERIFIED')
    }else if(streamTest){
      await wait(()=>taskLedger.some(entry=>entry.status==='failed'),'interrupted stream failed task ledger')
      assert.equal(commandStarted,false)
      await wait(()=>js(`document.body.textContent.includes('ended before completion')`),'interrupted stream error visible')
      console.log('INTERRUPTED_STREAM_BLOCKED_TOOL_VERIFIED')
    }else if(liveAgent){
      await wait(async()=>{
        await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Approve')?.click()`)
        return taskLedger.some(entry=>['done','failed','cancelled'].includes(entry.status))
      },'live built-in Agent completion',480000)
      console.log('LIVE_AGENT_LEDGER: '+JSON.stringify(taskLedger.map(({status,event})=>({status,event}))))
      assert.ok(taskLedger.some(entry=>entry.status==='done'),'Live Agent did not complete')
      assert.equal(fs.readFileSync(path.join(fixture,'invoice.test.mjs'),'utf8'),invoiceTest)
      const verification=require('node:child_process').spawnSync(process.execPath,[path.join(fixture,'invoice.test.mjs')],{cwd:fixture,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8'})
      assert.equal(verification.status,0,verification.stdout+verification.stderr)
      await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('quantity')`),'live Agent edits reflected in editor')
      console.log('LIVE_BUILTIN_AGENT_VERIFIED: '+verification.stdout.trim())
    }else if(terminalTest){
      await wait(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Approve')`),'terminal approval')
      assert.equal(commandStarted,false)
      await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Approve').click()`)
      await wait(()=>taskLedger.some(entry=>entry.status==='failed'),'failed terminal task ledger')
      assert.ok(commandStarted)
      await wait(()=>js(`document.body.textContent.includes('without confirmed completion.')`),'terminal failure visible')
      console.log('TERMINAL_FAILURE_LEDGER_VERIFIED')
    }else if(commandTest){
      await wait(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Approve')`),'command approval')
      await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Approve').click()`)
      await wait(()=>commandStarted,'command running')
      await click('button[title="Stop task"]')
      await wait(()=>taskLedger.some(entry=>entry.status==='cancelled'),'cancelled command task ledger')
      assert.equal(commandJobs.size,0)
      console.log('AGENT_COMMAND_CANCELLATION_VERIFIED')
    }else{
      await wait(()=>taskLedger.some(entry=>entry.status==='failed'),'failed agent task ledger')
      await wait(()=>js(`document.body.textContent.includes('Stopped after 26 steps.')`),'agent failure visible')
    }
    if(!liveAgent)assert.ok(!taskLedger.some(entry=>entry.status==='done'))
    assert.equal(fs.readFileSync(documentPath,'utf8'),previewTest?'const value = 84;\n':'const value = 42;\n')
    if(!liveAgent)console.log('AGENT_FAILURE_LEDGER_VERIFIED')
  }
  if(recoveryTest){
    failWrite=true
    win.show();win.focus();win.webContents.focus()
    await js(`document.querySelector('.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea').focus()`)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Home',modifiers:['meta']})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Home',modifiers:['meta']})
    await win.webContents.insertText('// recovered draft\n')
    await wait(()=>js(`document.body.textContent.includes('Fixture save denied')`),'failed save before crash')
    await wait(async()=>JSON.parse(await journal.read()).tabs.some(tab=>tab.content?.includes('recovered draft')),'draft journal durable')
    assert.equal(fs.readFileSync(documentPath,'utf8'),'const value = 42;\n')
    if(saveAsTest)fs.unlinkSync(documentPath)
    else fs.writeFileSync(documentPath,'const value = 84;\n')
    const crashed=new Promise(resolve=>win.webContents.once('render-process-gone',resolve))
    win.webContents.forcefullyCrashRenderer()
    await crashed
    await journal.flush()
    const recoverySnapshot=JSON.parse(await journal.read())
    for(let i=0;i<24;i++){
      const name=`recovered-tab-${i}.txt`,file=path.join(fixture,name)
      fs.writeFileSync(file,`Saved tab ${i}\n`)
      recoverySnapshot.tabs.push({path:file,name})
    }
    await journal.write(JSON.stringify(recoverySnapshot))
    await win.loadFile(path.join(root,'dist/index.html'))
    win.show();win.focus();win.webContents.focus()
    await wait(()=>js(`document.body.textContent.includes('Recovered unsaved edits')`),'recovery notice after renderer crash')
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('recovered')`),'recovered buffer visible')
    await wait(()=>js(`document.querySelectorAll('button[aria-label^="Close recovered-tab-"]').length===24`),'all background recovery tabs restored')
    if(saveAsTest){
      await wait(()=>js(`document.body.textContent.includes('Cannot read original file')`),'missing original recovery error')
      const saveAs = ()=>js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save as…').click()`)
      await saveAs()
      await wait(()=>saveDialogs===1,'Save As cancelled')
      assert.equal(fs.existsSync(recoveredPath),false)
      await saveAs()
      await wait(()=>js(`document.body.textContent.includes('Fixture save denied')`),'failed Save As preserves draft')
      assert.equal(fs.existsSync(recoveredPath),false)
      failWrite=false
      await saveAs()
      await wait(()=>fs.existsSync(recoveredPath)&&fs.readFileSync(recoveredPath,'utf8').includes('recovered draft'),'recovered Save As')
      assert.equal(fs.existsSync(documentPath),false)
      await wait(()=>js(`!!document.querySelector('button[aria-label="Close recovered.js"]')`),'saved tab renamed')
      await wait(async()=>JSON.parse(await journal.read()).tabs.some(tab=>tab.path===recoveredPath && tab.content===undefined),'new saved path journaled')
      console.log('MISSING_FILE_SAVE_AS_VERIFIED')
    }else{
    await wait(()=>js(`document.body.textContent.includes('Your unsaved edits are preserved.')`),'downtime conflict visible')
    assert.equal(fs.readFileSync(documentPath,'utf8'),'const value = 84;\n')
    failWrite=false
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Overwrite with my edits').click()`)
    await wait(()=>fs.readFileSync(documentPath,'utf8').includes('recovered draft'),'explicit recovered save')
    await wait(async()=>JSON.parse(await journal.read()).tabs.every(tab=>tab.content===undefined),'saved draft removed from recovery journal')
    }
    console.log('CRASH_RECOVERY_AND_CONFLICT_VERIFIED')
  }
  if(renameTest){
    const typeEditor=async text=>{
      win.show();win.focus();win.webContents.focus()
      await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      await js(`document.querySelector('.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea').focus()`)
      await wait(()=>js(`document.activeElement?.matches('.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea')`),'editor input focused')
      await win.webContents.insertText(text)
    }
    const beginRename=async name=>{
      await js(`Array.from(document.querySelectorAll('button[draggable]')).find(b=>b.textContent.trim()===${JSON.stringify(name)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:150}))`)
      await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Rename').click()`)
      await wait(()=>js(`!!document.querySelector('[role="dialog"] input')`),'rename dialog')
    }
    const submitName=async name=>{
      await js(`{const input=document.querySelector('[role="dialog"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}))}`)
      await click('[role="dialog"] button[type="submit"]')
    }
    // Failed saves leave a dirty buffer; rename must preserve it and its journal.
    failWrite=true
    await typeEditor('// rename draft\n')
    await wait(()=>js(`document.body.textContent.includes('Fixture save denied')`),'dirty buffer before rename')
    const occupied=path.join(fixture,'occupied.js');fs.writeFileSync(occupied,'keep this')
    await beginRename('fixture.js');await submitName('occupied.js')
    await wait(()=>js(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('already exists')`),'rename collision reported')
    assert.equal(fs.readFileSync(occupied,'utf8'),'keep this')
    assert.equal(fs.existsSync(documentPath),true)
    await submitName('renamed.js')
    const renamed=path.join(fixture,'renamed.js')
    await wait(()=>js(`!!document.querySelector('button[aria-label="Close renamed.js"]')`),'open tab retargeted')
    await wait(async()=>JSON.parse(await journal.read()).tabs.some(tab=>tab.path===renamed&&tab.content?.includes('rename draft')),'renamed draft journaled')
    assert.equal(fs.existsSync(documentPath),false)
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('rename')`),'renamed buffer preserved')
    failWrite=false
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'s',modifiers:['meta']})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'s',modifiers:['meta']})
    await wait(()=>fs.readFileSync(renamed,'utf8').includes('rename draft'),'save uses renamed path')
    assert.equal(fs.existsSync(documentPath),false)
    console.log('RENAME_DIRTY_BUFFER_COLLISION_AND_JOURNAL_VERIFIED')
    await js(`Array.from(document.querySelectorAll('button[draggable]')).find(b=>b.textContent.trim()==='source').click()`)
    await wait(()=>js(`Array.from(document.querySelectorAll('button[draggable]')).some(b=>b.textContent.trim()==='child.js')`),'folder expanded')
    await js(`Array.from(document.querySelectorAll('button[draggable]')).find(b=>b.textContent.trim()==='child.js').click()`)
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('child')`),'child editor loaded')
    failWrite=true
    await typeEditor('// child draft\n')
    await wait(()=>js(`document.body.textContent.includes('Fixture save denied')`),'dirty folder child')
    await beginRename('source');await submitName('library')
    const childDestination=path.join(fixture,'library','child.js')
    await wait(async()=>JSON.parse(await journal.read()).tabs.some(tab=>tab.path===childDestination&&tab.content?.includes('child draft')),'folder child draft retargeted')
    assert.equal(fs.existsSync(path.join(fixture,'source')),false)
    failWrite=false
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'s',modifiers:['meta']})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'s',modifiers:['meta']})
    await wait(()=>fs.readFileSync(childDestination,'utf8').includes('child draft'),'child saved after folder rename')
    assert.equal(fs.existsSync(path.join(fixture,'source')),false)
    console.log('FOLDER_RENAME_OPEN_CHILD_VERIFIED')
    await js(`Array.from(document.querySelectorAll('button[draggable]')).find(b=>b.textContent.trim()==='library').click()`)
    await wait(()=>js(`Array.from(document.querySelectorAll('button[draggable]')).some(b=>b.textContent.trim()==='child.js')`),'renamed folder expanded')
    await beginRename('child.js');await submitName('delayed.js')
    await wait(()=>!!releaseRename,'rename pending')
    await typeEditor('// typed during rename\n')
    await new Promise(resolve=>setTimeout(resolve,900))
    assert.ok(!fs.readFileSync(childDestination,'utf8').includes('typed during rename'),'autosave must wait for rename')
    releaseRename()
    const delayedDestination=path.join(fixture,'library','delayed.js')
    await wait(()=>fs.existsSync(delayedDestination)&&fs.readFileSync(delayedDestination,'utf8').includes('typed during rename'),'pending edits saved to new path')
    assert.equal(fs.existsSync(childDestination),false)
    console.log('RENAME_PENDING_AUTOSAVE_AND_TYPING_VERIFIED')
    delayWrite=true;releaseWrite=null
    await typeEditor('// save in flight\n')
    await wait(()=>!!releaseWrite,'save pending before rename')
    await wait(()=>js(`Array.from(document.querySelectorAll('button[draggable]')).some(b=>b.textContent.trim()==='delayed.js')`),'delayed entry refreshed')
    await beginRename('delayed.js');await submitName('finished.js')
    await wait(()=>js(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('still finishing')`),'in-flight save blocks rename')
    assert.equal(fs.existsSync(delayedDestination),true)
    assert.equal(fs.existsSync(path.join(fixture,'library','finished.js')),false)
    releaseWrite()
    await wait(()=>fs.readFileSync(delayedDestination,'utf8').includes('save in flight'),'pending save completed')
    await wait(()=>js(`document.body.textContent.includes('Saved')`),'save acknowledged')
    await submitName('finished.js')
    await wait(()=>js(`!!document.querySelector('button[aria-label="Close finished.js"]')`),'rename retry completed')
    assert.equal(fs.existsSync(delayedDestination),false)
    assert.ok(fs.readFileSync(path.join(fixture,'library','finished.js'),'utf8').includes('save in flight'))
    console.log('RENAME_IN_FLIGHT_SAVE_AND_RETRY_VERIFIED')
  }
  if(createTest){
    const submitName=async name=>{
      await wait(()=>js(`!!document.querySelector('[role="dialog"] input')`),'creation dialog')
      await js(`{const input=document.querySelector('[role="dialog"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}))}`)
      await click('[role="dialog"] button[type="submit"]')
    }
    await click('button[title="New file"]');await submitName('../escape.js')
    await wait(()=>js(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('path separators')`),'invalid name rejected')
    await submitName('fixture.js')
    await wait(()=>js(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('already exists')`),'existing file rejected')
    assert.equal(fs.readFileSync(documentPath,'utf8'),'const value = 42;\n')
    await submitName('new file.js')
    await wait(()=>js(`!!document.querySelector('button[aria-label="Close new file.js"]')`),'new file opened')
    assert.equal(fs.readFileSync(path.join(fixture,'new file.js'),'utf8'),'')
    await click('button[title="New folder"]');await submitName('generated')
    await wait(()=>js(`Array.from(document.querySelectorAll('button[draggable]')).some(b=>b.textContent.trim()==='generated')`),'new folder visible')
    for(const [action,name] of [['New File','child.js'],['New Folder','nested']]){
      await js(`Array.from(document.querySelectorAll('button[draggable]')).find(b=>b.textContent.trim()==='generated').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:150}))`)
      await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(action)}).click()`)
      await submitName(name)
      await wait(()=>fs.existsSync(path.join(fixture,'generated',name)),'context creation in selected folder')
      await wait(()=>js(`!document.querySelector('[role="dialog"]')`),'creation finished')
    }
    await wait(()=>js(`!!document.querySelector('button[aria-label="Close child.js"]')`),'nested created file opened')
    await js(`document.querySelector('button[title="New file"]').focus()`)
    await click('button[title="New file"]')
    await wait(()=>js(`!!document.querySelector('[role="dialog"]')`),'cancel dialog opened')
    await js(`document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await wait(()=>js(`!document.querySelector('[role="dialog"]')`),'Escape cancels creation')
    await wait(()=>js(`document.activeElement===document.querySelector('button[title="New file"]')`),'cancel restores launcher focus')
    assert.equal(fs.existsSync(path.join(scratch,'escape.js')),false)
    console.log('CREATE_FILE_FOLDER_COLLISION_CONTEXT_AND_CANCEL_VERIFIED')
  }
  if(trashTest){
    const beginTrash=async name=>{
      await js(`Array.from(document.querySelectorAll('button[draggable]')).find(b=>b.textContent.trim()===${JSON.stringify(name)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:150}))`)
      await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Move to Trash').click()`)
      await wait(()=>js(`!!document.querySelector('[role="dialog"]')`),'Trash dialog')
    }
    failWrite=true
    win.show();win.focus();win.webContents.focus()
    await js(`document.querySelector('.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea').focus()`)
    await win.webContents.insertText('// preserved after Trash\n')
    await wait(()=>js(`document.body.textContent.includes('Fixture save denied')`),'dirty buffer before Trash')
    failWrite=false
    await beginTrash('fixture.js')
    await click('[role="dialog"] button[type="button"]')
    assert.equal(fs.existsSync(documentPath),true)
    await beginTrash('fixture.js')
    await click('[role="dialog"] button[type="submit"]')
    await wait(()=>js(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('Fixture Trash denied')`),'Trash failure shown')
    assert.equal(fs.readFileSync(documentPath,'utf8'),'const value = 42;\n')
    denyTrash=false
    await click('[role="dialog"] button[type="submit"]')
    await wait(()=>js(`document.body.textContent.includes('File moved to Trash.')`),'detached draft notice')
    await wait(async()=>JSON.parse(await journal.read()).tabs.some(tab=>tab.path===documentPath&&tab.detached&&tab.content?.includes('preserved after Trash')),'detached draft journaled')
    assert.equal(fs.existsSync(documentPath),false)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'s',modifiers:['meta']})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'s',modifiers:['meta']})
    await new Promise(resolve=>setTimeout(resolve,900))
    assert.equal(fs.existsSync(documentPath),false,'save must not recreate a trashed path')
    const crashed=new Promise(resolve=>win.webContents.once('render-process-gone',resolve))
    win.webContents.forcefullyCrashRenderer();await crashed
    await win.loadFile(path.join(root,'dist/index.html'))
    win.show();win.focus();win.webContents.focus()
    await wait(()=>js(`document.body.textContent.includes('File moved to Trash.')`),'detached draft after crash')
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('preserved')`),'draft restored after crash')
    failWrite=true
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save as…').click()`)
    await wait(()=>js(`document.body.textContent.includes('Fixture save denied')`),'failed Save As preserves trashed draft')
    assert.equal(fs.existsSync(recoveredPath),false)
    assert.equal(await js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Retry save')`),false)
    failWrite=false
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save as…').click()`)
    await wait(()=>fs.existsSync(recoveredPath)&&fs.readFileSync(recoveredPath,'utf8').includes('preserved after Trash'),'trashed draft saved elsewhere')
    assert.equal(fs.existsSync(documentPath),false)
    await js(`Array.from(document.querySelectorAll('button[draggable]')).find(b=>b.textContent.trim()==='trash-folder').click()`)
    await wait(()=>js(`Array.from(document.querySelectorAll('button[draggable]')).some(b=>b.textContent.trim()==='clean.js')`),'folder expanded')
    await js(`Array.from(document.querySelectorAll('button[draggable]')).find(b=>b.textContent.trim()==='clean.js').click()`)
    await wait(()=>js(`!!document.querySelector('button[aria-label="Close clean.js"]')`),'clean child open')
    await beginTrash('trash-folder');await click('[role="dialog"] button[type="submit"]')
    await wait(()=>!fs.existsSync(path.join(fixture,'trash-folder')),'folder moved to OS Trash')
    await wait(()=>js(`!document.querySelector('button[aria-label="Close clean.js"]')`),'clean child tab closed')
    assert.equal(fs.readFileSync(recoveredPath,'utf8').includes('preserved after Trash'),true)
    console.log('OS_TRASH_FAILURE_DRAFT_CRASH_SAVE_AS_AND_FOLDER_VERIFIED')
  }
  if(searchTest){
    await click('button[title="Search"]')
    const query=async(value,run=true)=>{
      await js(`{const input=document.querySelector('input[placeholder="Search in files"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))}`)
      if(run)await js(`document.querySelector('input[placeholder="Search in files"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
    }
    const settle=()=>js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    const oldHits=[{file:documentPath,rel:'fixture.js',line:1,text:'OBSOLETE_RESULT'}]
    await query('slow-old');await wait(()=>pendingSearches.has('slow-old'),'old search pending')
    await query('latest');await wait(()=>js(`document.body.textContent.includes('RESULT_latest')`),'latest search displayed')
    pendingSearches.get('slow-old')(oldHits);await settle()
    assert.equal(await js(`document.body.textContent.includes('OBSOLETE_RESULT')`),false)
    assert.equal(await js(`document.body.textContent.includes('RESULT_latest')`),true)
    await query('slow-clear');await wait(()=>pendingSearches.has('slow-clear'),'clear search pending')
    const beforeClear=searchCancellations
    await query('',false);pendingSearches.get('slow-clear')(oldHits);await settle()
    await wait(()=>searchCancellations>beforeClear,'clearing cancels backend search')
    assert.equal(await js(`document.body.textContent.includes('OBSOLETE_RESULT')`),false)
    await query('slow-stop');await wait(()=>pendingSearches.has('slow-stop'),'stop search pending')
    const beforeStop=searchCancellations
    await click('button[aria-label="Stop search"]')
    await wait(()=>searchCancellations>beforeStop,'Stop reaches backend')
    pendingSearches.get('slow-stop')(oldHits);await settle()
    assert.equal(await js(`document.body.textContent.includes('Search stopped.')`),true)
    assert.equal(await js(`document.body.textContent.includes('OBSOLETE_RESULT')`),false)
    assert.equal(await js(`document.activeElement===document.querySelector('input[placeholder="Search in files"]')`),true)
    await query('slow-escape');await wait(()=>pendingSearches.has('slow-escape'),'Escape search pending')
    await js(`document.querySelector('input[placeholder="Search in files"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    pendingSearches.get('slow-escape')(oldHits);await settle()
    assert.equal(await js(`document.body.textContent.includes('Search stopped.')`),true)
    assert.equal(await js(`!!document.querySelector('button[aria-label="Stop search"]')`),false)
    await query('limit')
    await wait(()=>js(`document.body.textContent.includes('300 results in 1 file')&&document.body.textContent.includes('Search is limited to 300 results.')`),'result cap visible')
    fs.writeFileSync(path.join(scratch,'search-limit.png'),(await win.webContents.capturePage()).toPNG())
    await query('failure');await wait(()=>js(`document.body.textContent.includes('Fixture search denied')`),'search error visible')
    assert.equal(await js(`document.body.textContent.includes('0 results in 0 files')`),false)
    await query('special');await wait(()=>js(`document.body.textContent.includes('RESULT_special')`),'prototype-like filename grouped')
    await query('slow-project');await wait(()=>pendingSearches.has('slow-project'),'project search pending')
    folderChoice=path.join(scratch,'project two');fs.mkdirSync(folderChoice)
    await click('button[title="Open folder"]')
    await wait(()=>js(`document.body.textContent.includes('project two')`),'project changed during search')
    pendingSearches.get('slow-project')(oldHits);await settle()
    assert.equal(await js(`document.body.textContent.includes('OBSOLETE_RESULT')`),false)
    assert.equal(await js(`document.body.textContent.includes('RESULT_special')`),false)
    const beforeUnmount=searchCancellations
    await click('button[title="Files"]')
    await wait(()=>searchCancellations>beforeUnmount,'unmount cancels backend search')
    console.log('SEARCH_RACES_CLEAR_ERROR_GROUPING_AND_PROJECT_SWITCH_VERIFIED')
  }
  if(gitRaceTest){
    await click('button[title="Source control"]')
    await wait(()=>js(`!!document.querySelector('button[title="Review unstaged slow.js"]')`),'Git fixture loaded')
    await click('button[title="Review unstaged slow.js"]')
    await wait(()=>pendingDiffs.length===1,'first diff pending')
    await wait(()=>js(`document.body.textContent.includes('Loading diff…')`),'loading diff visible')
    await click('button[title="Close diff"]')
    await click('button[title="Review unstaged latest.js"]')
    await wait(()=>js(`document.body.textContent.includes('LATEST_DIFF')`),'new diff loaded')
    pendingDiffs[0]('+ OBSOLETE_DIFF')
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    assert.equal(await js(`document.body.textContent.includes('OBSOLETE_DIFF')`),false)
    assert.equal(await js(`document.body.textContent.includes('LATEST_DIFF')`),true)
    await click('button[title="Close diff"]')
    await click('button[title="Review unstaged error.js"]')
    await wait(()=>js(`document.body.textContent.includes('Could not load diff:')&&document.body.textContent.includes('Fixture diff denied')`),'diff failure visible inside review')
    await click('button[title="Close diff"]')
    await click('button[title="Stage"]')
    await wait(()=>js(`document.body.textContent.includes('Git operation failed.')`),'stage failure visible')
    await click('button[title="Review unstaged slow.js"]')
    await wait(()=>pendingDiffs.length===2,'project diff pending')
    folderChoice=path.join(scratch,'other git project');fs.mkdirSync(folderChoice)
    await click('button[title="Open folder"]')
    await wait(()=>js(`document.body.textContent.includes('other git project')&&!document.querySelector('button[title="Close diff"]')`),'project switch closes review')
    pendingDiffs[1]('+ OLD_PROJECT_DIFF')
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    assert.equal(await js(`document.body.textContent.includes('OLD_PROJECT_DIFF')`),false)
    assert.equal(await js(`!!document.querySelector('button[title="Close diff"]')`),false)
    console.log('GIT_DIFF_CLOSE_SELECTION_PROJECT_RACES_AND_ERRORS_VERIFIED')
  }
  if(gitOperationTest){
    const draft=async text=>js(`{const input=document.querySelector('textarea[placeholder="Commit message"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}))}`)
    const commit=()=>js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Commit & Push')).click()`)
    await wait(()=>js(`!!document.querySelector('textarea[placeholder="Commit message"]')`),'new project Git loaded')
    const oldProject=folderChoice
    await draft('old project draft');await commit()
    await wait(()=>pendingCommits.length===1,'old project commit pending')
    folderChoice=path.join(scratch,'new operation project');fs.mkdirSync(folderChoice)
    await click('button[title="Open folder"]')
    await wait(()=>js(`document.body.textContent.includes('new operation project')&&!!document.querySelector('textarea[placeholder="Commit message"]')`),'operation project changed')
    await draft('new project draft')
    const oldLoads=gitStatusRoots.filter(dir=>dir===oldProject).length
    pendingCommits[0].resolve({ok:true,commit:'old commit',push:'old push'})
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    assert.equal(await js(`document.querySelector('textarea[placeholder="Commit message"]').value`),'new project draft')
    assert.equal(await js(`document.body.textContent.includes('Pushed to GitHub.')`),false)
    assert.equal(gitStatusRoots.filter(dir=>dir===oldProject).length,oldLoads)
    await commit();await wait(()=>pendingCommits.length===2,'current project commit pending')
    await draft('newer typing while committing')
    pendingCommits[1].resolve({ok:true,commit:'current commit',push:'current push'})
    await wait(()=>js(`document.body.textContent.includes('Pushed to GitHub.')`),'current completion shown')
    assert.equal(await js(`document.querySelector('textarea[placeholder="Commit message"]').value`),'newer typing while committing')
    folderChoice=oldProject;await click('button[title="Open folder"]')
    await wait(()=>js(`document.querySelector('textarea[placeholder="Commit message"]')?.value==='old project draft'`),'old project draft retained')
    assert.equal(pendingCommits[0].cwd,oldProject)
    assert.notEqual(pendingCommits[1].cwd,oldProject)
    console.log('GIT_MUTATION_PROJECT_SCOPE_AND_DRAFT_SNAPSHOTS_VERIFIED')
    await click('button[title="Files"]');await click('button[title="Source control"]')
    await wait(()=>js(`document.querySelector('textarea[placeholder="Commit message"]')?.value==='old project draft'`),'draft after panel remount')
    const crashed=new Promise(resolve=>win.webContents.once('render-process-gone',resolve))
    win.webContents.forcefullyCrashRenderer();await crashed
    await win.loadFile(path.join(root,'dist/index.html'))
    win.show();win.focus();win.webContents.focus()
    await wait(()=>js(`!!document.querySelector('button[title="Source control"]')`),'IDE reloaded')
    await click('button[title="Source control"]')
    await wait(()=>js(`document.querySelector('textarea[placeholder="Commit message"]')?.value==='old project draft'`),'draft after renderer crash')
    await js(`{const original=Storage.prototype.setItem;window.restoreDraftStorage=()=>{Storage.prototype.setItem=original};Storage.prototype.setItem=function(key,value){if(key.startsWith('nalu-git-draft:'))throw new Error('Fixture draft quota');return original.call(this,key,value)};void 0}`)
    await draft('draft with failed backup')
    await wait(()=>js(`document.body.textContent.includes('Commit draft could not be backed up')`),'draft backup error visible')
    await click('button[title="Files"]');await click('button[title="Source control"]')
    await wait(()=>js(`document.querySelector('textarea[placeholder="Commit message"]')?.value==='draft with failed backup'&&document.body.textContent.includes('Fixture draft quota')`),'failed draft and warning survive remount')
    await js(`window.restoreDraftStorage();void 0`)
    await draft('durable recovered draft')
    await wait(()=>js(`!document.body.textContent.includes('Fixture draft quota')`),'backup retry clears warning')
    await commit();await wait(()=>pendingCommits.length===3,'commit for persisted draft pending')
    pendingCommits[2].resolve({ok:true,commit:'committed draft',push:'pushed'})
    await wait(()=>js(`document.querySelector('textarea[placeholder="Commit message"]')?.value===''`),'committed draft cleared')
    assert.equal(await js(`localStorage.getItem(${JSON.stringify('nalu-git-draft:'+oldProject)})`),null)
    console.log('COMMIT_DRAFT_REMOUNT_CRASH_FAILURE_AND_CLEAR_VERIFIED')
  }
  if(quickTest){
    win.show();win.focus();win.webContents.focus()
    const shortcut=()=>js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'p',metaKey:true,bubbles:true}))`)
    const typeQuery=value=>js(`(()=>{const input=document.querySelector('input[aria-label="Search project files"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await shortcut()
    await wait(()=>js(`!!document.querySelector('dialog[open] input[aria-label="Search project files"]')`),'quick opener modal shown')
    assert.equal(await js(`document.activeElement?.getAttribute('aria-label')`),'Search project files')
    await typeQuery('終')
    await wait(()=>js(`document.querySelector('[cmdk-item]')?.textContent.includes('nested/終-$&.txt')`),'nested Unicode match')
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    fs.writeFileSync(path.join(scratch,'quick-open.png'),(await win.webContents.capturePage()).toPNG())
    await js(`document.querySelector('input[aria-label="Search project files"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.replaceAll(String.fromCharCode(160),' ').includes('Quick opened Unicode')`),'keyboard selection opens file')
    assert.equal(await js(`!!document.querySelector('dialog[open]')`),false)
    delayQuickIndex=true
    await shortcut()
    await wait(()=>!!pendingQuickIndex,'quick index pending')
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
    await wait(()=>js(`!document.querySelector('dialog')`),'cancel closes quick opener')
    const obsolete=path.join(fixture,'nested','obsolete')
    pendingQuickIndex([{name:'obsolete',path:obsolete,dir:true}])
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    assert.ok(!contextReads.includes(obsolete))
    delayQuickIndex=false
    await shortcut();await typeQuery('nomatch')
    await wait(()=>js(`document.querySelector('dialog')?.textContent.includes('No matching files.')`),'no-match state')
    await typeQuery('root-file')
    await wait(()=>js(`document.querySelector('[cmdk-item]')?.textContent.includes('root-file.txt')`),'root file match')
    fs.unlinkSync(path.join(fixture,'root-file.txt'))
    await js(`document.querySelector('[cmdk-item]').click()`)
    await wait(()=>js(`document.body.textContent.includes('Could not open root-file.txt')`),'open failure remains visible after picker closes')
    assert.equal(await js(`document.querySelector('.view-lines')?.textContent.replaceAll(String.fromCharCode(160),' ').includes('Quick opened Unicode')`),true)
    console.log('QUICK_OPEN_KEYBOARD_UNICODE_CANCELLATION_AND_FAILURE_VERIFIED')
  }
  if(contextTest){
    win.show();win.focus();win.webContents.focus()
    const typeContext=value=>js(`(()=>{const input=document.querySelector('textarea[placeholder="Ask Nalu anything…"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await wait(()=>!!pendingContextIndex,'old project index waiting')
    await typeContext('@')
    await wait(()=>js(`document.body.textContent.includes('Finding project files…')`),'context indexing status')
    await js(`document.querySelector('textarea[placeholder="Ask Nalu anything…"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await wait(()=>js(`!document.body.textContent.includes('Add context')`),'Escape dismisses empty picker')
    folderChoice=path.join(scratch,'context other project');fs.mkdirSync(folderChoice)
    fs.writeFileSync(path.join(folderChoice,'fresh-context-終-$&.txt'),'current project')
    await click('button[title="Open folder"]')
    await wait(()=>js(`document.body.textContent.includes('context other project')`),'new context project selected')
    await typeContext('@終')
    await wait(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='fresh-context-終-$&.txt' && !b.hasAttribute('draggable'))`),'current project Unicode context available')
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    fs.writeFileSync(path.join(scratch,'context-picker.png'),(await win.webContents.capturePage()).toPNG())
    const obsolete=path.join(fixture,'slow-index','obsolete')
    pendingContextIndex([{name:'obsolete',path:obsolete,dir:true}])
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    assert.ok(!contextReads.includes(obsolete))
    await js(`document.querySelector('textarea[placeholder="Ask Nalu anything…"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
    await wait(()=>js(`document.querySelector('textarea[placeholder="Ask Nalu anything…"]').value==='fresh-context-終-$&.txt '`),'keyboard context selection preserves literal filename')
    console.log('CONTEXT_INDEX_CANCELLATION_PROJECT_SWITCH_AND_KEYBOARD_VERIFIED')
  }
  if(openTest){
    const openTree=name=>js(`Array.from(document.querySelectorAll('button[draggable]')).find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`)
    for(const [name,message] of [['binary.dat','binary data'],['large.txt','10 MiB']]){
      await openTree(name)
      await wait(()=>js(`document.body.textContent.includes(${JSON.stringify(message)})`),name+' refusal visible')
      assert.equal(await js(`document.body.textContent.includes('Error invoking remote method')`),false)
      assert.equal(await js(`document.querySelector('.view-lines')?.textContent.includes('42')`),true)
      assert.equal(await js(`!!document.querySelector(${JSON.stringify('button[aria-label="Close '+name+'"]')})`),false)
    }
    fs.writeFileSync(path.join(scratch,'file-read-limit.png'),(await win.webContents.capturePage()).toPNG())
    fs.writeFileSync(path.join(fixture,'large.txt'),'Reduced to readable text\n')
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry open').click()`)
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('Reduced')`),'retry after reducing file size')
    await openTree('fixture.js')
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('42')`),'original editor restored')
    assert.deepEqual(fs.readFileSync(path.join(fixture,'binary.dat')),Buffer.from([65,0,66]))
    console.log('REAL_FILE_READ_BINARY_LIMIT_AND_RETRY_VERIFIED')
    fs.unlinkSync(path.join(fixture,'missing.js'))
    await openTree('missing.js')
    await wait(()=>js(`document.body.textContent.includes('Could not open missing.js')`),'missing file error visible')
    assert.equal(await js(`document.querySelector('.view-lines')?.textContent.includes('42')`),true)
    assert.equal(await js(`!!document.querySelector('button[aria-label="Close missing.js"]')`),false)
    fs.writeFileSync(path.join(fixture,'missing.js'),"const restored = 'available again';\n")
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry open').click()`)
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('available')`),'retry opens restored file')
    await openTree('slow.js');await wait(()=>pendingOpens.has(path.join(fixture,'slow.js')),'slow open pending')
    await openTree('latest.js')
    await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('latest.js')`),'latest open active')
    pendingOpens.get(path.join(fixture,'slow.js'))("const delayed = 'older request';\n")
    await wait(()=>js(`!!document.querySelector('button[aria-label="Close slow.js"]')`),'older request opens background tab')
    assert.equal(await js(`document.querySelector('.view-lines')?.textContent.includes('latest.js')`),true)
    await openTree('project-slow.js');await wait(()=>pendingOpens.has(path.join(fixture,'project-slow.js')),'project open pending')
    folderChoice=path.join(scratch,'open other project');fs.mkdirSync(folderChoice)
    await click('button[title="Open folder"]')
    await wait(()=>js(`document.body.textContent.includes('open other project')`),'project switched')
    pendingOpens.get(path.join(fixture,'project-slow.js'))("const stale = 'old project';\n")
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    assert.equal(await js(`!!document.querySelector('button[aria-label="Close project-slow.js"]')`),false)
    assert.equal(await js(`document.querySelector('.view-lines')?.textContent.includes('latest.js')`),true)
    console.log('OPEN_FAILURE_RETRY_ORDERING_AND_PROJECT_SWITCH_VERIFIED')
  }
  fs.writeFileSync(path.join(scratch,'ide.png'),(await win.webContents.capturePage()).toPNG())
  console.log('IDE_SMOKE_PASS: real CLI/PTy, hide/show, mode switching, project switching, exit/restart, edit conflicts and disk refresh')
  console.log('Screenshot: '+path.join(scratch,'ide.png'))
}).catch(async error=>{console.error(error);if(win&&!win.isDestroyed()){console.log(await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(path.join(scratch,'failure.png'),(await win.webContents.capturePage()).toPNG());console.log('Failure screenshot: '+path.join(scratch,'failure.png'))}process.exitCode=1}).finally(async()=>{for(const controller of commandJobs.values())controller.abort();if(commandJobs.size)await wait(()=>commandJobs.size===0,'command cleanup');terminals.killAll();if(win&&!win.isDestroyed())win.destroy();app.exit(process.exitCode||0)})
