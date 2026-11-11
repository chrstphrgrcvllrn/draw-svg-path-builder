import type { Line, LineStyle, Pt, Vec } from './types'

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
const zero = (): Vec => ({ x: 0, y: 0 })

interface Sub {
  pts: Pt[]
  closed: boolean
}

const anchor = (x: number, y: number): Pt => ({ x, y, mode: 'corner', hin: zero(), hout: zero() })

/** Parse path data into sub-paths whose points carry bezier handle offsets. */
function parsePathData(d: string): Sub[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []
  const subs: Sub[] = []
  let sub: Sub | null = null
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let lastC2: Vec | null = null
  let lastQ: Vec | null = null
  let i = 0
  let cmd = ''

  const begin = (x: number, y: number) => {
    sub = { pts: [anchor(x, y)], closed: false }
    subs.push(sub)
    sx = x
    sy = y
  }
  const cubic = (c1: Vec, c2: Vec, x: number, y: number) => {
    if (!sub) begin(cx, cy)
    const prev = sub!.pts[sub!.pts.length - 1]
    prev.hout = { x: c1.x - prev.x, y: c1.y - prev.y }
    const np = anchor(x, y)
    np.hin = { x: c2.x - x, y: c2.y - y }
    sub!.pts.push(np)
    cx = x
    cy = y
  }

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++]
    else if (!cmd) break
    const up = cmd.toUpperCase()
    const rel = cmd !== up
    const n = ARGS[up]
    if (n === undefined) break
    if (up === 'Z') {
      if (sub) (sub as Sub).closed = true
      cx = sx
      cy = sy
      sub = null
      lastC2 = lastQ = null
      continue
    }
    const a = tokens.slice(i, i + n).map(Number)
    if (a.length < n || a.some(Number.isNaN)) break
    i += n
    const ox = rel ? cx : 0
    const oy = rel ? cy : 0
    let nextC2: Vec | null = null
    let nextQ: Vec | null = null

    if (up === 'M') {
      begin(a[0] + ox, a[1] + oy)
      cx = a[0] + ox
      cy = a[1] + oy
      cmd = rel ? 'l' : 'L' // extra pairs are implicit lineto
    } else if (up === 'L' || up === 'H' || up === 'V' || up === 'A') {
      const x = up === 'H' ? a[0] + ox : up === 'V' ? cx : up === 'A' ? a[5] + ox : a[0] + ox
      const y = up === 'V' ? a[0] + oy : up === 'H' ? cy : up === 'A' ? a[6] + oy : a[1] + oy
      // arcs fall back to a straight segment to their end point
      if (!sub) begin(cx, cy)
      sub!.pts.push(anchor(x, y))
      cx = x
      cy = y
    } else if (up === 'C') {
      const c2 = { x: a[2] + ox, y: a[3] + oy }
      cubic({ x: a[0] + ox, y: a[1] + oy }, c2, a[4] + ox, a[5] + oy)
      nextC2 = c2
    } else if (up === 'S') {
      const c1 = lastC2 ? { x: 2 * cx - lastC2.x, y: 2 * cy - lastC2.y } : { x: cx, y: cy }
      const c2 = { x: a[0] + ox, y: a[1] + oy }
      cubic(c1, c2, a[2] + ox, a[3] + oy)
      nextC2 = c2
    } else {
      const q: Vec = up === 'Q' ? { x: a[0] + ox, y: a[1] + oy } : lastQ ? { x: 2 * cx - lastQ.x, y: 2 * cy - lastQ.y } : { x: cx, y: cy }
      const x = (up === 'Q' ? a[2] : a[0]) + ox
      const y = (up === 'Q' ? a[3] : a[1]) + oy
      const p0 = { x: cx, y: cy }
      cubic(
        { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
        { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) },
        x,
        y,
      )
      nextQ = q
    }
    lastC2 = nextC2
    lastQ = nextQ
  }
  return subs
}

const toHex = (c: string | null | undefined, fallback: string): string => {
  if (!c || c === 'none' || c === 'currentColor') return fallback
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return fallback
  ctx.fillStyle = '#000001'
  ctx.fillStyle = c
  const v = ctx.fillStyle
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback
}

const attr = (el: Element, name: string): string | null => {
  const inline = (el as SVGElement).style?.getPropertyValue(name)
  if (inline) return inline
  return el.closest(`[${name}]`)?.getAttribute(name) ?? null
}

export interface ImportResult {
  lines: Line[]
  size: { w: number; h: number } | null
}

/** Accepts a full <svg> document, a fragment containing <path>s, or a bare path `d` string. */
export function importSvg(text: string, style: LineStyle): ImportResult | null {
  const src = text.trim()
  const bare = /^[mM][\s\d.,+-]/.test(src)
  const markup = bare
    ? `<svg xmlns="http://www.w3.org/2000/svg"><path d="${src}"/></svg>`
    : /<svg[\s>]/i.test(src)
      ? src.includes('xmlns=') ? src : src.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
      : `<svg xmlns="http://www.w3.org/2000/svg">${src}</svg>` // bare <path .../> fragment
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const svg = doc.querySelector('svg')
  if (!svg || doc.querySelector('parsererror')) return null

  let size: { w: number; h: number } | null = null
  let ox = 0
  let oy = 0
  const vb = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    ox = vb[0]
    oy = vb[1]
    size = { w: vb[2], h: vb[3] }
  } else {
    const w = parseFloat(svg.getAttribute('width') ?? '')
    const h = parseFloat(svg.getAttribute('height') ?? '')
    if (w > 0 && h > 0) size = { w, h }
  }

  const lines: Line[] = []
  svg.querySelectorAll('path').forEach((el) => {
    const d = el.getAttribute('d')
    if (!d) return
    const stroke = attr(el, 'stroke')
    const width = parseFloat(attr(el, 'stroke-width') ?? '')
    for (const sub of parsePathData(d)) {
      const pts = sub.pts
      if (sub.closed && pts.length > 2) {
        const first = pts[0]
        const last = pts[pts.length - 1]
        if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
          first.hin = last.hin
          pts.pop()
        }
      }
      const points = pts.map((p) => ({
        ...p,
        x: p.x - ox,
        y: p.y - oy,
        mode: p.hin.x || p.hin.y || p.hout.x || p.hout.y ? ('manual' as const) : ('corner' as const),
      }))
      lines.push({
        id: crypto.randomUUID(),
        points,
        closed: sub.closed && points.length > 2,
        width: width > 0 ? width : style.width,
        color: toHex(stroke, style.color),
        smooth: style.smooth,
      })
    }
  })
  if (!lines.length) return null
  if (!size) {
    // no viewBox: fit the canvas around the imported lines
    let mx = 0
    let my = 0
    for (const l of lines) for (const p of l.points) {
      mx = Math.max(mx, p.x + l.width / 2)
      my = Math.max(my, p.y + l.width / 2)
    }
    size = { w: Math.ceil(mx + 20), h: Math.ceil(my + 20) }
  }
  return { lines, size }
}
