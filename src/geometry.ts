import type { Line, Pt, Vec } from './types'

const fmt = (n: number) => String(Math.round(n * 100) / 100)

export const newPoint = (p: Vec): Pt => ({ x: p.x, y: p.y, mode: 'auto', hin: { x: 0, y: 0 }, hout: { x: 0, y: 0 } })

/** Absolute positions of a point's in/out bezier handles. */
export function handlesOf(line: Line, i: number): { inn: Vec; out: Vec } {
  const pts = line.points
  const n = pts.length
  const p = pts[i]
  if (p.mode === 'corner' || n < 2) return { inn: { x: p.x, y: p.y }, out: { x: p.x, y: p.y } }
  if (p.mode === 'manual') {
    return { inn: { x: p.x + p.hin.x, y: p.y + p.hin.y }, out: { x: p.x + p.hout.x, y: p.y + p.hout.y } }
  }
  const prev = i > 0 ? pts[i - 1] : line.closed ? pts[n - 1] : null
  const next = i < n - 1 ? pts[i + 1] : line.closed ? pts[0] : null
  const a = prev ?? p
  const b = next ?? p
  // Catmull-Rom tangent; end points use a longer factor since they only have one neighbour
  const k = (line.smooth / 6) * (prev && next ? 1 : 2)
  const tx = (b.x - a.x) * k
  const ty = (b.y - a.y) * k
  return { inn: { x: p.x - tx, y: p.y - ty }, out: { x: p.x + tx, y: p.y + ty } }
}

export function hasInHandle(line: Line, i: number) {
  return line.points.length > 1 && (i > 0 || line.closed)
}
export function hasOutHandle(line: Line, i: number) {
  return line.points.length > 1 && (i < line.points.length - 1 || line.closed)
}

function segments(line: Line): [number, number][] {
  const n = line.points.length
  const s: [number, number][] = []
  for (let i = 0; i < n - 1; i++) s.push([i, i + 1])
  if (line.closed && n > 2) s.push([n - 1, 0])
  return s
}

export function pathD(line: Line): string {
  const pts = line.points
  if (pts.length === 0) return ''
  const first = pts[0]
  let d = `M${fmt(first.x)} ${fmt(first.y)}`
  if (pts.length === 1) return d + 'h0'
  for (const [a, b] of segments(line)) {
    const c1 = handlesOf(line, a).out
    const c2 = handlesOf(line, b).inn
    const p = pts[b]
    d += `C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p.x)} ${fmt(p.y)}`
  }
  if (line.closed && pts.length > 2) d += 'Z'
  return d
}

const bez = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/** Closest point on the curve, used to insert a point by double-clicking the line. */
export function nearestOnLine(line: Line, pos: Vec): { insertAt: number; dist: number; point: Vec } | null {
  let best: { insertAt: number; dist: number; point: Vec } | null = null
  for (const [a, b] of segments(line)) {
    const p0 = line.points[a]
    const p3 = line.points[b]
    const c1 = handlesOf(line, a).out
    const c2 = handlesOf(line, b).inn
    for (let s = 0; s <= 40; s++) {
      const t = s / 40
      const x = bez(p0.x, c1.x, c2.x, p3.x, t)
      const y = bez(p0.y, c1.y, c2.y, p3.y, t)
      const dist = Math.hypot(x - pos.x, y - pos.y)
      if (!best || dist < best.dist) best = { insertAt: a + 1, dist, point: { x, y } }
    }
  }
  return best
}

export function buildSvg(lines: Line[], w: number, h: number): string {
  const paths = lines
    .filter((l) => l.points.length > 0)
    .map(
      (l) =>
        `  <path d="${pathD(l)}" stroke="${l.color}" stroke-width="${l.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none">\n${paths}\n</svg>`
}
