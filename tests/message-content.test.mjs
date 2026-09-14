import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import Module from 'node:module'
import ts from 'typescript'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
const file=path.resolve('src/components/MessageContent.tsx'),mod=new Module(file)
mod.paths=Module._nodeModulePaths(path.dirname(file))
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file)
const render=text=>renderToStaticMarkup(createElement(mod.exports.default,{text}))
test('assistant responses retain readable code, lists, headings and emphasis',()=>{
 const html=render('# Result\n**Built** the *feature*.\n- First\n- Second\n1. Run\n2. Verify\n```js\nconst value = "<html>";\n```')
 for(const expected of ['<h3>Result</h3>','<strong>Built</strong>','<em>feature</em>','<ul>','<ol>','const value = &quot;&lt;html&gt;&quot;;','Copy code'])assert.ok(html.includes(expected),expected)
})
test('untrusted response markup stays text and dangerous links never become anchors',()=>{
 const html=render('<script>alert(1)</script>\n[x](javascript:alert(1))\n[docs](https://example.com/docs)')
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'))
 assert.ok(html.includes('href="https://example.com/docs"'));assert.ok(html.includes('rel="noopener noreferrer"'))
})
test('partially streamed code remains visible without interpreting its markup',()=>{
 const html=render('```html\n<button onclick="bad()">hello</button>')
 assert.ok(html.includes('&lt;button onclick=&quot;bad()&quot;&gt;hello&lt;/button&gt;'));assert.ok(!html.includes('onclick="bad()"'))
})
