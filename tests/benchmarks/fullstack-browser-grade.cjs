const {app,BrowserWindow,session}=require('electron')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const [base,out]=process.argv.slice(2),results=[],errors=[]
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'nalu-browser-grade-')))
let win
const evaluate=code=>win.webContents.executeJavaScript(code)
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(code){for(let i=0;i<100;i++){if(await evaluate(code))return;await delay(30)}throw Error('Browser condition timed out: '+code)}
async function tasks(){const response=await fetch(base+'/api/tasks');assert.equal(response.status,200);const body=await response.json();assert.ok(Array.isArray(body.tasks));return body.tasks}
async function persisted(predicate){for(let i=0;i<100;i++){const rows=await tasks();if(predicate(rows))return rows;await delay(30)}throw Error('Expected server state was not observed')}
const visible=`e=>!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden'`
async function click(pattern,scope='document'){
 const code=`(()=>{const scope=${scope};const e=[...scope.querySelectorAll('button,a')].filter(${visible}).find(e=>new RegExp(${JSON.stringify(pattern)},'i').test((e.getAttribute('aria-label')||e.innerText).trim()));if(!e)throw Error('Missing visible control: '+${JSON.stringify(pattern)});e.click();return true})()`
 await evaluate(code);await delay(40)
}
async function taskAction(title,action){
 await evaluate(`(()=>{const visible=${visible};const leaves=[...document.querySelectorAll('div,span,p,td,button,h3,h4')].filter(e=>visible(e)&&e.innerText.trim()===${JSON.stringify(title)});for(const leaf of leaves){if(${JSON.stringify(action)}==='Edit'){const b=leaf.closest('button,a');if(b){b.click();return true}}let parent=leaf.parentElement;while(parent&&parent!==document.body){const buttons=[...parent.querySelectorAll('button,a')].filter(e=>visible(e)&&new RegExp('^'+${JSON.stringify(action)}+'(?:$|[: \u00a0])','i').test(e.getAttribute('aria-label')||e.innerText));if(buttons.length===1){buttons[0].click();return true}if(buttons.length>1)break;parent=parent.parentElement}}throw Error('No unambiguous '+${JSON.stringify(action)}+' control for '+${JSON.stringify(title)});})()`)
 await delay(40)
}
const taskVisible=title=>`[...document.querySelectorAll('td,article,button,h3,h4')].filter(${visible}).some(e=>e.innerText.includes(${JSON.stringify(title)}))`
const dialog="document.querySelector('dialog[open],[role=dialog]')"
async function field(label,value,select=false){
 await evaluate(`(()=>{const s=${dialog};if(!s)throw Error('No open dialog');const e=[...s.querySelectorAll('input,textarea,select')].find(e=>new RegExp(${JSON.stringify(label)},'i').test([...e.labels||[]].map(l=>l.innerText).join(' ')||e.getAttribute('aria-label')||''));if(!e)throw Error('Missing labeled field: '+${JSON.stringify(label)});${select?`e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));`:`e.focus();e.select();`}return true})()`)
 if(!select)await win.webContents.insertText(value)
}
async function check(name,fn){try{await fn();results.push({name,passed:true})}catch(error){results.push({name,passed:false,error:error.message});throw error}finally{console.log(JSON.stringify(results.at(-1)))}}
async function screenshot(name){await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(path.join(out,name),(await win.webContents.capturePage()).toPNG())}
app.whenReady().then(async()=>{
 session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false))
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>cb({cancel:new URL(d.url).origin!==new URL(base).origin}))
 win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)})
 try{
  await win.loadURL(base);await until("!document.body.innerText.includes('Loading your workspace')")
  await check('real dashboard and empty backend',async()=>{assert.deepEqual(await tasks(),[]);assert.equal(await evaluate("document.body.innerText.includes('Website not implemented')"),false);await click('^(Create|New) task$');await until(`${dialog} !== null`)})
  await check('required title prevents empty submission',async()=>{await click('^(Create|Add|Save)( task)?$',dialog);await delay(100);assert.deepEqual(await tasks(),[])})
  await check('browser creates task in real API',async()=>{await field('title','Independent browser task');await field('description','Created through the browser');await field('priority','high',true);await click('^(Create|Add|Save)( task)?$',dialog);await persisted(rows=>rows.length===1&&rows[0].title==='Independent browser task'&&rows[0].description==='Created through the browser'&&rows[0].priority==='high');await until(`${dialog} === null`)})
  await check('reload retains task',async()=>{await win.loadURL(base);await until("document.body.innerText.includes('Independent browser task')");assert.equal((await tasks()).length,1)})
  await check('edit title and move to doing',async()=>{await taskAction('Independent browser task','Edit');await until(`${dialog} !== null`);await field('title','Edited browser task');await field('status','doing',true);await click('^(Save changes|Save task|Save)$',dialog);await persisted(rows=>rows[0]?.title==='Edited browser task'&&rows[0]?.status==='doing');await until(`${dialog} === null`)})
  await check('move to done through browser',async()=>{await taskAction('Edited browser task','Edit');await until(`${dialog} !== null`);await field('status','done',true);await click('^(Save changes|Save task|Save)$',dialog);await persisted(rows=>rows[0]?.status==='done');await until(`${dialog} === null`)})
  await check('search hides nonmatching task and resets',async()=>{await evaluate(`(()=>{const e=[...document.querySelectorAll('input')].find(e=>/search/i.test(e.placeholder||e.getAttribute('aria-label')||[...e.labels||[]].map(l=>l.innerText).join(' ')));if(!e)throw Error('Search field missing');e.focus();e.select();return true})()`);await win.webContents.insertText('nonmatching-query-76382');await until('!('+taskVisible('Edited browser task')+')');await win.webContents.insertText('');await evaluate(`(()=>{const e=document.activeElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await until("document.body.innerText.includes('Edited browser task')")})
  await check('status and priority filters combine',async()=>{
    async function filter(label,value){await evaluate(`(()=>{const e=[...document.querySelectorAll('select')].find(e=>new RegExp(${JSON.stringify(label)},'i').test(e.getAttribute('aria-label')||[...e.labels||[]].map(l=>l.innerText).join(' ')));if(!e)throw Error('Missing filter');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await delay(50)}
    const present=taskVisible('Edited browser task')
    await filter('^(?:filter by )?status$','todo');assert.equal(await evaluate(present),false)
    await filter('^(?:filter by )?status$','done');await until(present)
    await filter('^(?:filter by )?priority$','low');assert.equal(await evaluate(present),false)
    await filter('^(?:filter by )?priority$','high');await until(present)
    await filter('^(?:filter by )?status$','all');await filter('^(?:filter by )?priority$','all')
  })
  await check('board displays task and status columns',async()=>{await click('^(Board|Kanban)( view)?$');await until("document.body.innerText.includes('Edited browser task')");const text=await evaluate('document.body.innerText');assert.match(text,/To do/i);assert.match(text,/In progress/i);assert.match(text,/Done/);await click('^List( view)?$')})
  await check('delete cancellation preserves server task',async()=>{await taskAction('Edited browser task','Delete');await until(`${dialog} !== null`);await click('^Cancel$',dialog);assert.equal((await tasks()).length,1)})
  await check('confirmed deletion persists',async()=>{await taskAction('Edited browser task','Delete');await until(`${dialog} !== null`);await click('^Delete( task)?$',dialog);await persisted(rows=>rows.length===0);await win.loadURL(base);await delay(150);assert.deepEqual(await tasks(),[])})
  await check('desktop layout',async()=>{assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await screenshot('desktop.png')})
  await check('mobile layout and create control',async()=>{win.setContentSize(390,844);await delay(100);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await screenshot('mobile.png');await click('^(Create|New) task$');await until(`${dialog} !== null`)})
  await check('Escape closes mobile dialog',async()=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await until(`${dialog} === null`)})
 }catch{await screenshot('failure.png').catch(()=>{})}
 const passed=results.length===14&&results.every(r=>r.passed)&&errors.length===0
 fs.writeFileSync(path.join(out,'browser-grade.json'),JSON.stringify({results,errors,passed},null,2)+'\n');app.exit(passed?0:1)
}).catch(error=>{fs.writeFileSync(path.join(out,'browser-grade.json'),JSON.stringify({passed:false,error:error.message}));app.exit(1)})
