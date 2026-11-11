import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import CodeBox from './CodeBox'
import { Icon, Spinner } from './ui'
import Canvas from './Canvas'
import { buildSvg, pathD } from './geometry'
import { importSvg } from './importSvg'
import type { Line, LineStyle, PointMode, Tool } from './types'

const HISTORY_LIMIT = 100

export default function App() {
  const [lines, setLinesRaw] = useState<Line[]>([])
  const linesRef = useRef(lines)
  useEffect(() => {
    linesRef.current = lines
  }, [lines])
  const past = useRef<Line[][]>([])
  const future = useRef<Line[][]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const bump = useCallback(() => {
    setCanUndo(past.current.length > 0)
    setCanRedo(future.current.length > 0)
  }, [])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedPt, setSelectedPt] = useState<number | null>(null)
  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('draw')
  const [style, setStyle] = useState<LineStyle>({ width: 24, color: '#000000', smooth: 1 })

  const [image, setImage] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [imageOpacity, setImageOpacity] = useState(0.5)
  const [showImage, setShowImage] = useState(true)
  const [size, setSize] = useState({ w: 1000, h: 700 })
  const [background, setBackground] = useState('#ffffff')
  const [zoom, setZoom] = useState(0.6)
  const [copied, setCopied] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(true)
  const [codeOpen, setCodeOpen] = useState(true)
  const [infoOpen, setInfoOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const t = localStorage.getItem('theme')
      if (t === 'light' || t === 'dark') return t
    } catch {
      /* storage unavailable */
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* storage unavailable */
    }
  }, [theme])
  const fileRef = useRef<HTMLInputElement>(null)

  const setLines = useCallback((f: (l: Line[]) => Line[]) => setLinesRaw(f), [])

  const snapshot = useCallback(() => {
    past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), linesRef.current]
    future.current = []
    bump()
  }, [bump])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(linesRef.current)
    setLinesRaw(prev)
    setDrawingId(null)
    bump()
  }, [bump])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(linesRef.current)
    setLinesRaw(next)
    setDrawingId(null)
    bump()
  }, [bump])

  const select = useCallback((id: string | null, pt: number | null = null) => {
    setSelectedId(id)
    setSelectedPt(pt)
  }, [])

  const selected = lines.find((l) => l.id === selectedId) ?? null
  const cur: LineStyle = selected ?? style

  const patchStyle = (p: Partial<LineStyle>) => {
    setStyle((s) => ({ ...s, ...p }))
    if (selected) setLines((ls) => ls.map((l) => (l.id === selected.id ? { ...l, ...p } : l)))
  }
  const beginSlide = () => {
    if (selected) snapshot()
  }

  const setPointMode = (mode: PointMode) => {
    if (!selected || selectedPt === null) return
    snapshot()
    setLines((ls) =>
      ls.map((l) =>
        l.id === selected.id ? { ...l, points: l.points.map((pt, i) => (i === selectedPt ? { ...pt, mode } : pt)) } : l,
      ),
    )
  }

  const deletePoint = useCallback(() => {
    const l = linesRef.current.find((x) => x.id === selectedId)
    if (!l || selectedPt === null) return
    snapshot()
    if (l.points.length <= 1) {
      setLines((ls) => ls.filter((x) => x.id !== l.id))
      setSelectedId(null)
      setSelectedPt(null)
      setDrawingId(null)
      return
    }
    setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, points: x.points.filter((_, i) => i !== selectedPt) } : x)))
    setSelectedPt(null)
  }, [selectedId, selectedPt, snapshot, setLines])

  const deleteLine = useCallback(
    (id: string | null) => {
      if (!id) return
      snapshot()
      setLines((ls) => ls.filter((l) => l.id !== id))
      setSelectedId(null)
      setSelectedPt(null)
      setDrawingId((d) => (d === id ? null : d))
    },
    [snapshot, setLines],
  )

  const clearAll = () => {
    if (!lines.length) return
    snapshot()
    setLines(() => [])
    select(null)
    setDrawingId(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selectedPt !== null) deletePoint()
        else deleteLine(selectedId)
      } else if (e.key === 'Enter' || e.key === 'Escape') {
        setDrawingId(null)
      } else if (!mod && e.key.toLowerCase() === 'p') setTool('draw')
      else if (!mod && e.key.toLowerCase() === 'v') setTool('select')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, deletePoint, deleteLine, selectedId, selectedPt])

  const hasImage = image !== null
  const importText = useCallback(
    (text: string): boolean => {
      const res = importSvg(text, style)
      if (!res) {
        setImportError('No <path> found in that SVG.')
        return false
      }
      setImportError(null)
      snapshot()
      setLines(() => res.lines)
      select(null)
      setDrawingId(null)
      if (res.size && !hasImage) setSize(res.size)
      // keep very light lines (e.g. white strokes) visible
      const lum = (hex: string) => (0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16)) / 255
      if (res.lines.every((l) => lum(l.color) > 0.85)) setBackground('#3a3a3a')
      return true
    },
    [style, hasImage, snapshot, setLines, select],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return
      const text = e.clipboardData?.getData('text') ?? ''
      if (!/<svg|<path|^\s*[mM][\s\d.,+-]/.test(text)) return
      e.preventDefault()
      importText(text)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [importText])

  const loadImage = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new Image()
      img.onload = () => {
        setImage(src)
        setImageName(file.name)
        setShowImage(true)
        setSize({ w: img.naturalWidth || 1000, h: img.naturalHeight || 700 })
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  }
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    loadImage(e.target.files?.[0])
    e.target.value = ''
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    loadImage(e.dataTransfer.files[0])
  }

  const svgText = useMemo(() => buildSvg(lines, size.w, size.h), [lines, size])
  const dText = useMemo(() => lines.map(pathD).filter(Boolean).join(' '), [lines])

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(label)
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'path.svg'
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasLines = lines.some((l) => l.points.length > 0)
  const pt = selected && selectedPt !== null ? selected.points[selectedPt] : null

  return (
    <div className="page" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {leftOpen && (
        <aside className="side-panel side-panel-left open">
          <div className="side-panel-header">
            <span className="side-panel-title">Tools</span>
            <button className="side-panel-icon-btn" type="button" aria-label="Close panel" onClick={() => setLeftOpen(false)}>
              ×
            </button>
          </div>
          <div className="side-panel-body">
            <div className="sort-filter-section">
              <div className="sort-filter-section-title">Tool</div>
              <div className="panel-row">
                <div className="view-mode-switch">
                  <button className={`view-mode-option${tool === 'draw' ? ' active' : ''}`} type="button" title="Draw (P)" aria-label="Draw tool" onClick={() => setTool('draw')}>
                    <Icon name="pencil" />
                  </button>
                  <button className={`view-mode-option${tool === 'select' ? ' active' : ''}`} type="button" title="Edit (V)" aria-label="Edit tool" onClick={() => setTool('select')}>
                    <Icon name="cursor" />
                  </button>
                </div>
                {tool === 'draw' && (
                  <button className="chip-button" type="button" disabled={!drawingId} onClick={() => setDrawingId(null)}>
                    <Icon name="check" />
                    <span className="btn-label">Finish</span>
                  </button>
                )}
                <span className="controls-spacer" />
                <button className="chip-button chip-button-icon" type="button" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={undo}>
                  <Icon name="undo" />
                </button>
                <button className="chip-button chip-button-icon" type="button" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={redo}>
                  <Icon name="redo" />
                </button>
              </div>
            </div>

            <div className="sort-filter-section">
              <div className="sort-filter-section-title">{selected ? 'Selected line' : 'New line'}</div>
              <Spinner id="widthInput" label="Width" value={cur.width} min={1} max={500} step={2} onBegin={beginSlide} onChange={(v) => patchStyle({ width: v })} />
              <Spinner id="curveInput" label="Curve" value={cur.smooth} min={0} max={2} step={0.1} onBegin={beginSlide} onChange={(v) => patchStyle({ smooth: v })} />
              <div className="sort-group">
                <label htmlFor="colorInput">Color</label>
                <input id="colorInput" className="color-input" type="color" value={cur.color} onChange={(e) => patchStyle({ color: e.target.value })} />
              </div>
              {selected && (
                <div className="panel-row">
                  <button
                    className={`chip-button${selected.closed ? ' active' : ''}`}
                    type="button"
                    disabled={selected.points.length < 3}
                    onClick={() => {
                      snapshot()
                      setLines((ls) => ls.map((l) => (l.id === selected.id ? { ...l, closed: !l.closed } : l)))
                    }}
                  >
                    <span className="btn-label">Closed</span>
                  </button>
                  <button className="chip-button" type="button" onClick={() => deleteLine(selected.id)}>
                    <Icon name="trash" />
                    <span className="btn-label">Delete line</span>
                  </button>
                </div>
              )}
            </div>

            {pt && (
              <div className="sort-filter-section">
                <div className="sort-filter-section-title">Point {selectedPt! + 1}</div>
                <div className="view-mode-switch">
                  <button className={`view-mode-option text${pt.mode !== 'corner' ? ' active' : ''}`} type="button" onClick={() => setPointMode(pt.mode === 'manual' ? 'manual' : 'auto')}>
                    Smooth
                  </button>
                  <button className={`view-mode-option text${pt.mode === 'corner' ? ' active' : ''}`} type="button" onClick={() => setPointMode('corner')}>
                    Corner
                  </button>
                </div>
                <div className="panel-row">
                  <button className="chip-button" type="button" disabled={pt.mode !== 'manual'} onClick={() => setPointMode('auto')}>
                    <span className="btn-label">Reset handles</span>
                  </button>
                  <button className="chip-button" type="button" onClick={deletePoint}>
                    <Icon name="trash" />
                    <span className="btn-label">Point</span>
                  </button>
                </div>
              </div>
            )}

            <div className="sort-filter-section">
              <div className="sort-filter-section-title">View</div>
              <Spinner id="zoomInput" label="Zoom" value={Math.round(zoom * 100)} min={20} max={300} step={10} onChange={(v) => setZoom(v / 100)} />
              <button className="chip-button chip-button-primary wide" type="button" disabled={!hasLines} onClick={() => copy('svg', svgText)}>
                <Icon name={copied === 'svg' ? 'check' : 'copy'} />
                <span className="btn-label">{copied === 'svg' ? 'Copied!' : 'Copy SVG'}</span>
              </button>
            </div>

            <div className="sort-filter-section">
              <div className="sort-filter-section-title">Canvas</div>
              <div className="row small">
                <label className="num">
                  W <input type="number" min={50} value={size.w} onChange={(e) => setSize((s) => ({ ...s, w: Math.max(50, +e.target.value || 50) }))} />
                </label>
                <label className="num">
                  H <input type="number" min={50} value={size.h} onChange={(e) => setSize((s) => ({ ...s, h: Math.max(50, +e.target.value || 50) }))} />
                </label>
              </div>
              <label className="sort-filter-option">
                <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
                <span>Background</span>
              </label>
            </div>

            <div className="sort-filter-section">
              <div className="sort-filter-section-title">Guide image</div>
              {image ? (
                <>
                  <figure className="guide-preview">
                    <img src={image} alt={imageName || 'Guide image'} />
                    <figcaption>
                      <span className="name">{imageName || 'Guide image'}</span>
                      <span>
                        {size.w} × {size.h}
                      </span>
                    </figcaption>
                  </figure>
                  <label className="field">
                    <span>Opacity</span>
                    <input type="range" min={0.05} max={1} step={0.05} value={imageOpacity} onChange={(e) => setImageOpacity(+e.target.value)} />
                    <output>{Math.round(imageOpacity * 100)}%</output>
                  </label>
                  <label className="sort-filter-option">
                    <input type="checkbox" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} />
                    <span>Show guide</span>
                  </label>
                </>
              ) : (
                <p className="sort-filter-empty">No guide image yet</p>
              )}
            </div>

            <div className="sort-filter-section">
              <div className="sort-filter-section-header">
                <div className="sort-filter-section-title">Lines</div>
                <div className="sort-filter-select-actions">
                  <button type="button" className="sort-filter-link" disabled={!lines.length} onClick={clearAll}>
                    Clear all
                  </button>
                </div>
              </div>
              {lines.length === 0 ? (
                <p className="sort-filter-empty">No lines yet</p>
              ) : (
                <ul className="list">
                  {lines.map((l, i) => (
                    <li key={l.id}>
                      <button className={l.id === selectedId ? 'on' : ''} onClick={() => select(l.id)}>
                        <i style={{ background: l.color }} /> Line {i + 1}{' '}
                        <small>
                          {l.points.length} pts · {l.width}px
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
      )}

      <div className="panel">
        <header className="panel-header">
          <div id="dropzone">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
            <button className="btn btn-primary" type="button" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" />
              <span className="btn-label">{image ? 'Replace Guide' : 'Upload Guide'}</span>
            </button>
            {image && <img className="thumb" src={image} alt={imageName || 'Guide image'} title={imageName} />}
            {image && (
              <button className="btn btn-secondary" type="button" onClick={() => setImage(null)}>
                <Icon name="trash" />
                <span className="btn-label">Remove Guide</span>
              </button>
            )}
            <span id="dropHint">or drag &amp; drop an image here</span>
          </div>
          <div className="header-actions">
            <button className={`icon-button${leftOpen ? ' active' : ''}`} type="button" title="Toggle tools panel" aria-label="Toggle tools panel" onClick={() => setLeftOpen((o) => !o)}>
              <Icon name="lines" />
            </button>
            <button className={`icon-button${codeOpen ? ' active' : ''}`} type="button" title="Import / Export code" aria-label="Toggle code panel" onClick={() => setCodeOpen((o) => !o)}>
              <Icon name="code" />
            </button>
            <div className="info-toast-wrap">
              <button className="icon-button" type="button" title="About this tool" aria-label="About this tool" onClick={() => setInfoOpen((o) => !o)}>
                <Icon name="megaphone" />
              </button>
              {infoOpen && (
                <div className="info-toast-panel">
                  <p className="subtitle">Trace over a guide image with editable curves, then copy the result as SVG.</p>
                  <p className="hint">
                    <kbd>P</kbd> draw · <kbd>V</kbd> edit · <kbd>↵</kbd> finish line · <kbd>⌫</kbd> delete · <kbd>⌘Z</kbd> undo
                  </p>
                  <p className="hint">Click-drag while placing a point to pull out a curve. Click the first point to close. Double-click a point to toggle corner, double-click a line to add a point. Paste SVG with <kbd>⌘V</kbd>.</p>
                </div>
              )}
            </div>
            <button className="icon-button" type="button" title="Toggle theme" aria-label="Toggle theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
          </div>
        </header>

        <div className="stage" id="stage">
          <Canvas
            lines={lines}
            setLines={setLines}
            snapshot={snapshot}
            selectedId={selectedId}
            selectedPt={selectedPt}
            select={select}
            tool={tool}
            drawingId={drawingId}
            setDrawingId={setDrawingId}
            size={size}
            image={image}
            imageOpacity={imageOpacity}
            showImage={showImage}
            zoom={zoom}
            style={style}
            background={background}
          />
          {!image && !hasLines && <div className="hint-empty">Upload or drop an image as a guide, then click to add points</div>}
        </div>
      </div>

      {codeOpen && (
        <aside className="side-panel side-panel-right">
          <div className="side-panel-header">
            <span className="side-panel-title">Import &amp; Export</span>
            <div className="side-panel-header-actions">
              <button className="side-panel-icon-btn" type="button" aria-label="Close panel" onClick={() => setCodeOpen(false)}>
                ×
              </button>
            </div>
          </div>
          <div className="side-panel-body">
            <div className="sort-filter-section">
              <div className="sort-filter-section-title">Import SVG</div>
              <CodeBox
                value={pasteText}
                placeholder="Paste SVG code or a path d string (or press ⌘V anywhere)"
                onChange={setPasteText}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (text && importText(text)) setPasteText('')
                }}
              />
              <div className="row">
                <button className="chip-button" type="button" disabled={!pasteText.trim()} onClick={() => importText(pasteText) && setPasteText('')}>
                  <Icon name="upload" />
                  <span className="btn-label">Load into canvas</span>
                </button>
              </div>
              {importError && <p className="help err">{importError}</p>}
              <p className="help">Replaces the current lines. Reads &lt;path&gt; elements (arcs become straight segments).</p>
            </div>
            <div className="sort-filter-section">
              <div className="sort-filter-section-title">Export</div>
              <div className="row">
                <button className="chip-button" type="button" disabled={!hasLines} onClick={() => copy('svg', svgText)}>
                  <Icon name="copy" />
                  <span className="btn-label">{copied === 'svg' ? 'Copied!' : 'Copy SVG'}</span>
                </button>
                <button className="chip-button" type="button" disabled={!hasLines} onClick={() => copy('d', dText)}>
                  <Icon name="code" />
                  <span className="btn-label">{copied === 'd' ? 'Copied!' : 'Copy path d'}</span>
                </button>
                <button className="chip-button chip-button-icon" type="button" title="Download" aria-label="Download SVG" disabled={!hasLines} onClick={download}>
                  <Icon name="download" />
                </button>
              </div>
              <CodeBox readOnly value={hasLines ? svgText : ''} placeholder="SVG code appears here" onFocus={(e) => e.currentTarget.select()} />
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
