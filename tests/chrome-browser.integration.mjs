import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function sourceModule(name) {
  const mod = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(new URL('../electron/' + name + '.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  new Function('require','exports','module',code)(id=>id==='./browserPage'?sourceModule('browserPage'):require(id),mod.exports,mod)
  return mod.exports
}
const { ChromeBrowser } = sourceModule('chromeBrowser')
test('real Chrome: precise trusted input, field replacement, live frames, resize, scroll, cancellation and reconnect', {timeout:60000}, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(),'nalu-chrome-test-'))
  const server = http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><title>Nalu Chrome fixture</title><style>body{font:16px system-ui;margin:30px}input,button{padding:15px;margin:8px}.covered{position:relative;width:180px}.cover{position:absolute;inset:0;z-index:1;background:#ddd}#bottom{margin-top:1800px}</style><form onsubmit="event.preventDefault();result.textContent=title.value;trusted.textContent=String(event.isTrusted)"><label>Task <input id="title" value="replace me"></label><button id="save">Save</button></form><p id="result"></p><p id="trusted"></p><button class="duplicate">First</button><button class="duplicate">Second</button><button id="disabled" disabled>Disabled</button><div class="covered"><button id="covered">Covered</button><div class="cover"></div></div><button id="bottom" onclick="result.textContent='bottom clicked'">Bottom</button><script>window.inputs=[];title.addEventListener('input',event=>inputs.push(event.isTrusted))</script>`)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}))
  const frames=[],browser=new ChromeBrowser(profile,state=>frames.push({...state})),timings={}
  t.after(async()=>{await browser.close();await new Promise(resolve=>setTimeout(resolve,400));fs.rmSync(profile,{recursive:true,force:true})})
  const timed=async(name,fn)=>{const start=performance.now();const result=await fn();timings[name]=Math.round(performance.now()-start);return result}
  await timed('launchAndNavigate',()=>browser.navigate(`http://127.0.0.1:${server.address().port}`))
  const snapshot=await browser.inspect({action:'snapshot'})
  assert.equal(snapshot.title,'Nalu Chrome fixture');assert.ok(snapshot.controls.some(c=>c.selector==='#save'))
  await assert.rejects(browser.click('.duplicate'),/found 2/)
  await assert.rejects(browser.click('#disabled'),/disabled/)
  await assert.rejects(browser.click('#covered'),/covered/)
  await timed('fillUnicode',()=>browser.fill('#title','Nalu 🐺 café'))
  await timed('click',()=>browser.click('#save'))
  assert.equal(await browser.evaluate('result.textContent'),'Nalu 🐺 café')
  assert.equal(await browser.evaluate('trusted.textContent'),'true')
  assert.equal(await browser.evaluate('JSON.stringify(inputs)'),'[true]')
  await browser.fill('#title','')
  assert.equal(await browser.evaluate('title.value'),'')
  await browser.fill('#title','Enter submitted')
  await browser.key('Enter');assert.equal(await browser.evaluate('result.textContent'),'Enter submitted')
  assert.ok(frames.filter(frame=>frame.image).length>=3)
  assert.match(browser.preview.image,/^data:image\/jpeg;base64,/)
  // Resize the actual Chrome window, then use CSS viewport coordinates as the mini view does.
  const {windowId}=await browser.call('Browser.getWindowForTarget',{targetId:browser.targetId},'')
  await browser.call('Browser.setWindowBounds',{windowId,bounds:{width:820,height:660}},'')
  await new Promise(resolve=>setTimeout(resolve,100));await browser.capture()
  const viewport=JSON.parse(await browser.evaluate('JSON.stringify({width:innerWidth,height:innerHeight})'))
  assert.equal(browser.preview.width,viewport.width);assert.equal(browser.preview.height,viewport.height)
  const point=await browser.inspect({action:'target',selector:'#save'})
  await browser.fill('#title','Mini preview click')
  await browser.clickAt(point.x,point.y)
  assert.equal(await browser.evaluate('result.textContent'),'Mini preview click')
  await browser.scroll(0,600)
  await new Promise(resolve=>setTimeout(resolve,150));assert.ok(Number(await browser.evaluate('scrollY'))>0)
  await browser.click('#bottom');assert.equal(await browser.evaluate('result.textContent'),'bottom clicked')
  const stopped=browser.click('#save');browser.cancel()
  await assert.rejects(stopped,/stopped/)
  assert.equal(await browser.evaluate('result.textContent'),'bottom clicked')
  await assert.rejects(browser.clickAt(-10,0),/outside/)
  // A hostile page cannot replace DOM methods in the isolated inspection world.
  await browser.evaluate('document.querySelectorAll=()=>[]')
  assert.ok((await browser.inspect({action:'snapshot'})).controls.some(c=>c.selector==='#save'))
  console.log('CHROME_EVIDENCE '+JSON.stringify({timings,frames:frames.length,viewport,profile}))
  await browser.close()
  const end=Date.now()+3000;while(browser.preview.connected&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25))
  assert.equal(browser.preview.connected,false)
  await browser.navigate(`http://127.0.0.1:${server.address().port}`)
  assert.equal(browser.preview.connected,true)
})
