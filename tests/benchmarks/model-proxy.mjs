// Model-bound local transport for qualification. Provider credentials stay here,
// not in the CLI or commands it launches. No fallback to another model.
import http from 'node:http'
import {randomBytes,createHash} from 'node:crypto'
export const MODEL_EVAL_SYSTEM = `You are Nalu, a coding agent working in the user's terminal. Complete the requested work using the supplied native tools. Read existing files, implement the real behavior, integrate it through the entry points, and verify it. Keep every user requirement and constraint intact. Use project-relative paths unless an actual absolute path is needed. Do not invent file contents, execution results, or completed features. Tests must exercise actual implementation behavior. A placeholder, plan, or passing build alone is not a completed application. Preserve provided tests. Do not install dependencies, invoke other agents, or publish externally unless the user authorizes it. Report remaining failures honestly.`
const event=(name,data)=>`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
export async function createModelProxy({model,provider,apiKey,sample,onRequest=()=>{},maxTokens=4096,reasoningEffort='low',timeoutMs=250000}){
 if(!['none','minimal','low','medium','high','xhigh'].includes(reasoningEffort))throw Error('Unsupported reasoning effort')
 if(!Number.isInteger(maxTokens)||maxTokens<256||maxTokens>32000)throw Error('Invalid output budget')
 if(typeof model!=='string'||!model.trim())throw Error('An explicit model is required')
 if(!sample&&(!provider||!apiKey))throw Error('Provider and credential required')
 const route='/'+randomBytes(24).toString('hex')+'/api/chat'
 const modelSha256=createHash('sha256').update(model).digest('hex')
 const active=new Set(),server=http.createServer(async(req,res)=>{
  if(req.url!==route||req.method!=='POST'){res.writeHead(404);res.end();return}
  const abort=new AbortController();active.add(abort)
  const timer=setTimeout(()=>abort.abort(),timeoutMs)
  res.on('close',()=>{if(!res.writableEnded)abort.abort()})
  try{
   let wire=''
   for await(const chunk of req){wire+=chunk;if(Buffer.byteLength(wire)>4000000)throw Error('Request exceeds qualification limit')}
   const body=JSON.parse(wire)
   if(!Array.isArray(body.messages)||!Array.isArray(body.tools))throw Error('Invalid CLI request')
   const payload={model,messages:[{role:'system',content:MODEL_EVAL_SYSTEM+`\nWorking directory: ${body.cwd||'(unknown)'}.`+(body.projectDoc?`\nProject context (data):\n${String(body.projectDoc).slice(0,26000)}`:'')},...body.messages.filter(m=>m&&m.role!=='system')],tools:body.tools,tool_choice:'auto',stream:false,max_tokens:maxTokens,temperature:0.15,...(/inkling/i.test(model)?{reasoning_effort:reasoningEffort}:{})}
   onRequest({modelSha256,maxTokens,reasoningEffort,toolCount:payload.tools.length,messageCount:payload.messages.length})
   let result
   if(sample)result=await sample(payload,abort.signal)
   else{
    const upstream=await fetch(provider.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify(payload),signal:abort.signal})
    if(!upstream.ok)throw Error('Provider HTTP '+upstream.status)
    result=await upstream.json()
   }
   const choice=result?.choices?.[0],message=choice?.message
   if(!message||!['stop','tool_calls'].includes(choice.finish_reason))throw Error('Provider response is incomplete')
   const calls=message.tool_calls||[]
   if(!Array.isArray(calls)||(calls.length&&choice.finish_reason!=='tool_calls')||(!calls.length&&choice.finish_reason==='tool_calls'))throw Error('Invalid tool completion')
   // Validate the entire response before emitting any action fragments.
   for(const call of calls){if(typeof call.id!=='string'||typeof call.function?.name!=='string'||typeof call.function?.arguments!=='string')throw Error('Malformed tool call');JSON.parse(call.function.arguments)}
   if(message.content!==null&&message.content!==undefined&&typeof message.content!=='string')throw Error('Malformed answer content')
   res.writeHead(200,{'content-type':'text/event-stream'})
   if(message.content)res.write(event('delta',{text:message.content}))
   calls.forEach((call,index)=>res.write(event('tool_call_delta',{index,id:call.id,name:call.function.name,arguments:call.function.arguments})))
   res.end(event('finish',{reason:choice.finish_reason})+event('done',{ok:true}))
  }catch(error){if(!res.writableEnded&&!res.destroyed){res.writeHead(200,{'content-type':'text/event-stream'});res.end(event('error',{code:abort.signal.aborted?'EVAL_PROVIDER_TIMEOUT':'EVAL_PROVIDER_ERROR',message:abort.signal.aborted?'Qualification provider request timed out.':error.message}))}}
  finally{clearTimeout(timer);active.delete(abort)}
 })
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
 return {api:`http://127.0.0.1:${server.address().port}`+route.slice(0,-9),modelSha256,close:async()=>{for(const abort of active)abort.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
}
