import { useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent, MouseEvent as RMouseEvent } from 'react'
import { handlesOf, hasInHandle, hasOutHandle, nearestOnLine, newPoint, pathD } from './geometry'
import type { Line, LineStyle, Tool, Vec } from './types'

interface Props {
  lines: Line[]
  setLines: (f: (l: Line[]) => Line[]) => void
  snapshot: () => void
  selectedId: string | null
  selectedPt: number | null
  select: (id: string | null, pt?: number | null) => void
  tool: Tool
  drawingId: string | null
  setDrawingId: (id: string | null) => void
  size: { w: number; h: number }
  image: string | null
  imageOpacity: number
  showImage: boolean
  zoom: number
  style: LineStyle
  background: string
}

type Drag =
  | { kind: 'pt'; id: string; idx: number; snapped: boolean }
  | { kind: 'h'; id: string; idx: number; which: 'in' | 'out'; other: Vec; snapped: boolean }
  | { kind: 'new'; id: string; idx: number; start: Vec }

export default function Canvas(p: Props) {
  const { lines, setLines, snapshot, selectedId, selectedPt, select, tool, drawingId, setDrawingId, size } = p
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [k, setK] = useState(1) // user units per screen pixel
  // pasteboard around the artboard so lines can be drawn/edited outside it
  const pad = Math.round(Math.max(size.w, size.h) * 0.4)
  const vbW = size.w + pad * 2
  const vbH = size.h + pad * 2

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => setK(vbW / Math.max(1, svg.getBoundingClientRect().width))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [vbW, p.zoom])

  const toLocal = (e: { clientX: number; clientY: number }): Vec => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: r.x, y: r.y }
  }

  const capture = (e: RPointerEvent) => svgRef.current?.setPointerCapture(e.pointerId)

  const onBackgroundDown = (e: RPointerEvent) => {
    if (e.button !== 0) return
    if (tool === 'select') {
      select(null)
      return
    }
    const pos = toLocal(e)
    snapshot()
    let id = drawingId
    let idx = 0
    if (id) {
      idx = lines.find((l) => l.id === id)?.points.length ?? 0
      setLines((ls) => ls.map((l) => (l.id === id ? { ...l, points: [...l.points, newPoint(pos)] } : l)))
    } else {
      id = crypto.randomUUID()
      const nl: Line = { id, points: [newPoint(pos)], closed: false, ...p.style }
      setLines((ls) => [...ls, nl])
      setDrawingId(id)
    }
    select(id, idx)
    drag.current = { kind: 'new', id, idx, start: pos }
    capture(e)
  }

  const onPointDown = (e: RPointerEvent, line: Line, idx: number) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (tool === 'draw' && drawingId === line.id && idx === 0 && line.points.length >= 3) {
      snapshot()
      setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, closed: true } : l)))
      setDrawingId(null)
      select(line.id, 0)
      return
    }
    select(line.id, idx)
    drag.current = { kind: 'pt', id: line.id, idx, snapped: false }
    capture(e)
  }

  const onHandleDown = (e: RPointerEvent, line: Line, idx: number, which: 'in' | 'out') => {
    if (e.button !== 0) return
    e.stopPropagation()
    const pt = line.points[idx]
    const h = handlesOf(line, idx)
    const o = which === 'in' ? h.out : h.inn
    drag.current = { kind: 'h', id: line.id, idx, which, other: { x: o.x - pt.x, y: o.y - pt.y }, snapped: false }
    capture(e)
  }

  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const pos = toLocal(e)
    if (d.kind !== 'new' && !d.snapped) {
      snapshot()
      d.snapped = true
    }
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== d.id) return l
        const pts = l.points.slice()
        const pt = pts[d.idx]
        if (!pt) return l
        if (d.kind === 'pt') {
          pts[d.idx] = { ...pt, x: pos.x, y: pos.y }
        } else {
          const off = d.kind === 'new' ? { x: pos.x - d.start.x, y: pos.y - d.start.y } : { x: pos.x - pt.x, y: pos.y - pt.y }
          if (d.kind === 'new') {
            if (Math.hypot(off.x, off.y) < 4 * k) return l // treat as a plain click
            pts[d.idx] = { ...pt, mode: 'manual', hout: off, hin: { x: -off.x, y: -off.y } }
          } else {
            const neg = { x: -off.x, y: -off.y }
            const keep = e.altKey ? d.other : neg
            pts[d.idx] =
              d.which === 'out'
                ? { ...pt, mode: 'manual', hout: off, hin: keep }
                : { ...pt, mode: 'manual', hin: off, hout: keep }
          }
        }
        return { ...l, points: pts }
      }),
    )
  }

  const onUp = () => {
    drag.current = null
  }

  const onPointDouble = (e: RMouseEvent, line: Line, idx: number) => {
    e.stopPropagation()
    snapshot()
    setLines((ls) =>
      ls.map((l) =>
        l.id !== line.id
          ? l
          : { ...l, points: l.points.map((pt, i) => (i === idx ? { ...pt, mode: pt.mode === 'corner' ? 'auto' : 'corner' } : pt)) },
      ),
    )
  }

  const onLineDouble = (e: RMouseEvent, line: Line) => {
    const hit = nearestOnLine(line, toLocal(e))
    if (!hit) return
    snapshot()
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== line.id) return l
        const pts = l.points.slice()
        pts.splice(hit.insertAt, 0, newPoint(hit.point))
        return { ...l, points: pts }
      }),
    )
    select(line.id, hit.insertAt)
  }

  const sel = lines.find((l) => l.id === selectedId) ?? null
  const R = 5 * k

  return (
    <svg
      ref={svgRef}
      className={`canvas tool-${tool}`}
      viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
      style={{ width: `${p.zoom * 100 * (vbW / size.w)}%`, aspectRatio: `${vbW} / ${vbH}`, overflow: 'visible' }}
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <rect className="artboard" width={size.w} height={size.h} fill={p.background} />
      {p.image && p.showImage && (
        <image href={p.image} width={size.w} height={size.h} opacity={p.imageOpacity} preserveAspectRatio="none" pointerEvents="none" />
      )}

      {lines.map((l) => (
        <g key={l.id}>
          <path
            d={pathD(l)}
            fill="none"
            stroke={l.color}
            strokeWidth={l.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
          {tool === 'select' && (
            <path
              d={pathD(l)}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(l.width, 16 * k)}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="stroke"
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                select(l.id, null)
              }}
              onDoubleClick={(e) => onLineDouble(e, l)}
            />
          )}
        </g>
      ))}

      {sel && (
        <g>
          <path d={pathD(sel)} fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={3 * k} pointerEvents="none" />
          <path d={pathD(sel)} fill="none" stroke="#2f7bff" strokeWidth={1.25 * k} pointerEvents="none" />
          {selectedPt !== null && sel.points[selectedPt] && sel.points[selectedPt].mode !== 'corner' && (() => {
            const pt = sel.points[selectedPt]
            const h = handlesOf(sel, selectedPt)
            return (
              <>
                {hasInHandle(sel, selectedPt) && (
                  <>
                    <line x1={pt.x} y1={pt.y} x2={h.inn.x} y2={h.inn.y} className="hline" strokeWidth={1.25 * k} />
                    <circle cx={h.inn.x} cy={h.inn.y} r={R * 0.85} className="handle" strokeWidth={1.5 * k} onPointerDown={(e) => onHandleDown(e, sel, selectedPt, 'in')} />
                  </>
                )}
                {hasOutHandle(sel, selectedPt) && (
                  <>
                    <line x1={pt.x} y1={pt.y} x2={h.out.x} y2={h.out.y} className="hline" strokeWidth={1.25 * k} />
                    <circle cx={h.out.x} cy={h.out.y} r={R * 0.85} className="handle" strokeWidth={1.5 * k} onPointerDown={(e) => onHandleDown(e, sel, selectedPt, 'out')} />
                  </>
                )}
              </>
            )
          })()}
          {sel.points.map((pt, i) => (
            <circle
              key={i}
              cx={pt.x}
              cy={pt.y}
              r={pt.mode === 'corner' ? R * 0.9 : R}
              className={`anchor${i === selectedPt ? ' active' : ''}${pt.mode === 'corner' ? ' corner' : ''}`}
              strokeWidth={1.75 * k}
              onPointerDown={(e) => onPointDown(e, sel, i)}
              onDoubleClick={(e) => onPointDouble(e, sel, i)}
            />
          ))}
        </g>
      )}
    </svg>
  )
}
