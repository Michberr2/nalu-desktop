// Independent render evidence; does not certify all requested interactions.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const [url,out]=process.argv.slice(2); fs.mkdirSync(out,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'website-render-')));
app.whenReady().then(async()=>{
 session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>cb({cancel:!['localhost','127.0.0.1','::1'].includes(new URL(d.url).hostname)}));
 const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}),errors=[];
 w.webContents.on('console-message',(_e,level,message)=>{if(level>=2)errors.push(message)});
 const results=[];
 for(const width of [1440,390]){
  w.setContentSize(width,900);await w.loadURL(url);
  await w.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const snapshot=await w.webContents.executeJavaScript(`({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,controls:[...document.querySelectorAll('a,button,input,select,textarea')].map(e=>({tag:e.tagName,text:e.innerText,name:e.getAttribute('aria-label'),type:e.type})),brokenImages:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src)})`);
  fs.writeFileSync(path.join(out,width+'.png'),(await w.webContents.capturePage()).toPNG());results.push({width,...snapshot});
 }
 fs.writeFileSync(path.join(out,'render.json'),JSON.stringify({url,results,errors},null,2));console.log(JSON.stringify(results.map(r=>({width:r.width,overflow:r.overflow,controls:r.controls.length,placeholder:r.text.includes('Website not implemented')}))));app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
