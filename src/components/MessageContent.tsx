import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

function inline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1,-1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2,-2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1,-1)}</em>
    const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>
    return part
  })
}
function CodeBlock({ text, language }: { text: string; language: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  return <div className="message-code"><div className="message-code-heading"><span>{language || 'Code'}</span><button aria-label="Copy code" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setError('') }, () => setError('Select the code and copy it with ⌘C.')) }}>{copied ? <Check size={12}/> : <Copy size={12}/>} {copied ? 'Copied' : 'Copy'}</button></div><pre><code>{text}</code></pre>{error && <p role="status">{error}</p>}</div>
}
export default function MessageContent({ text }: { text: string }) {
  const lines=text.split('\n'), blocks: ReactNode[]=[]
  for(let i=0;i<lines.length;i++) {
    const line=lines[i]
    const fence=line.match(/^\s*(`{3,}|~{3,})(.*)$/)
    if(fence) {
      const code: string[]=[]
      while(++i<lines.length && lines[i].trim()!==fence[1])code.push(lines[i])
      blocks.push(<CodeBlock key={i} text={code.join('\n')} language={fence[2].trim()}/>);continue
    }
    const heading=line.match(/^#{1,6}\s+(.+)$/)
    if(heading){blocks.push(<h3 key={i}>{inline(heading[1])}</h3>);continue}
    const list=line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)
    if(list){const ordered=/^\s*\d+\./.test(line),items:ReactNode[]=[<li key={i}>{inline(list[1])}</li>];while(i+1<lines.length){const next=lines[i+1].match(ordered?/^\s*\d+\.\s+(.+)$/:/^\s*[-*]\s+(.+)$/);if(!next)break;items.push(<li key={++i}>{inline(next[1])}</li>)}blocks.push(ordered?<ol key={i}>{items}</ol>:<ul key={i}>{items}</ul>);continue}
    if(line.startsWith('> ')){blocks.push(<blockquote key={i}>{inline(line.slice(2))}</blockquote>);continue}
    if(line.trim())blocks.push(<p key={i}>{inline(line)}</p>)
  }
  return <div className="message-content">{blocks}</div>
}
