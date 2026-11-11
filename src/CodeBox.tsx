import { useRef } from 'react'
import type { ClipboardEvent, FocusEvent, ReactNode } from 'react'

type Tok = { cls: string; text: string }

const RE = {
  comment: /<!--[\s\S]*?-->/y,
  tagOpen: /<\/?[\w:-]+/y,
  tagClose: /\/?>/y,
  attr: /[\w:-]+(?=\s*=)/y,
  eq: /=/y,
  str: /"[^"]*"|'[^']*'/y,
  ws: /\s+/y,
  word: /[^<>"'=\s]+/y,
  pathPart: /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?|[^a-zA-Z\d.+-]+|./y,
}

function match(re: RegExp, src: string, i: number): string | null {
  re.lastIndex = i
  const m = re.exec(src)
  return m && m.index === i ? m[0] : null
}

function pathTokens(body: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < body.length) {
    const t = match(RE.pathPart, body, i) ?? body[i]
    out.push({ cls: /^[a-zA-Z]$/.test(t) ? 'cmd' : /\d/.test(t) ? 'num' : 'punct', text: t })
    i += t.length
  }
  return out
}

function tokenize(src: string): Tok[] {
  // a bare path `d` string with no markup
  if (!src.includes('<')) return pathTokens(src)
  const out: Tok[] = []
  let i = 0
  let attrName = ''
  while (i < src.length) {
    let t: string | null
    if ((t = match(RE.comment, src, i))) out.push({ cls: 'comment', text: t })
    else if ((t = match(RE.tagOpen, src, i))) {
      out.push({ cls: 'punct', text: t.startsWith('</') ? '</' : '<' }, { cls: 'tag', text: t.replace(/^<\/?/, '') })
    } else if ((t = match(RE.tagClose, src, i))) out.push({ cls: 'punct', text: t })
    else if ((t = match(RE.attr, src, i))) {
      attrName = t
      out.push({ cls: 'attr', text: t })
    } else if ((t = match(RE.eq, src, i))) out.push({ cls: 'punct', text: t })
    else if ((t = match(RE.str, src, i))) {
      const q = t[0]
      const inner = t.slice(1, t.endsWith(q) && t.length > 1 ? -1 : undefined)
      out.push({ cls: 'punct', text: q })
      if (attrName === 'd') out.push(...pathTokens(inner))
      else if (/^#[0-9a-f]{3,8}$/i.test(inner)) out.push({ cls: 'color', text: inner })
      else if (/^-?[\d.]+$/.test(inner)) out.push({ cls: 'num', text: inner })
      else out.push({ cls: 'str', text: inner })
      if (t.length > 1 && t.endsWith(q)) out.push({ cls: 'punct', text: q })
    } else if ((t = match(RE.ws, src, i))) out.push({ cls: '', text: t })
    else {
      t = match(RE.word, src, i) ?? src[i]
      out.push({ cls: '', text: t })
    }
    i += t.length
  }
  return out
}

interface Props {
  value: string
  placeholder?: string
  readOnly?: boolean
  onChange?: (v: string) => void
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  onFocus?: (e: FocusEvent<HTMLTextAreaElement>) => void
}

/** A textarea with syntax-highlighted SVG drawn behind its (transparent) text. */
export default function CodeBox({ value, placeholder, readOnly, onChange, onPaste, onFocus }: Props) {
  const pre = useRef<HTMLPreElement>(null)
  const nodes: ReactNode[] = tokenize(value).map((t, i) => (
    <span key={i} className={t.cls ? `tok-${t.cls}` : undefined}>
      {t.text}
    </span>
  ))
  return (
    <div className="code-box">
      <pre ref={pre} className="code-layer code-hl" aria-hidden="true">
        {nodes}
        {'\n'}
      </pre>
      <textarea
        className="code-layer code-input"
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange?.(e.target.value)}
        onPaste={onPaste}
        onFocus={onFocus}
        onScroll={(e) => {
          if (pre.current) {
            pre.current.scrollTop = e.currentTarget.scrollTop
            pre.current.scrollLeft = e.currentTarget.scrollLeft
          }
        }}
      />
    </div>
  )
}
