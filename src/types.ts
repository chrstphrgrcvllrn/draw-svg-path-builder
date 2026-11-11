export interface Vec {
  x: number
  y: number
}

/** auto = smooth curve computed from neighbours, manual = user-dragged handles, corner = no handles */
export type PointMode = 'auto' | 'manual' | 'corner'

export interface Pt extends Vec {
  mode: PointMode
  /** handle offsets relative to the point (only used in manual mode) */
  hin: Vec
  hout: Vec
}

export interface Line {
  id: string
  points: Pt[]
  width: number
  color: string
  /** 0 = straight segments, 1 = default smooth, 2 = very loose */
  smooth: number
  closed: boolean
}

export interface LineStyle {
  width: number
  color: string
  smooth: number
}

export type Tool = 'draw' | 'select'
