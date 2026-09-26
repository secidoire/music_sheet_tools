import { useRef, useState } from 'react'
import type { Rotation } from '../pipeline/types.ts'

interface Props {
  /** Unrotated source image and its size. */
  url: string
  width: number
  height: number
  /** Clockwise turn the page is shown with; split and guides are in the turned frame. */
  rotation: Rotation
  split: boolean
  splitX: number
  /** Skew per part in degrees (positive = lines descend to the right). */
  angles: number[]
  onSplitX: (x: number) => void
}

const GUIDE_ROWS = 14

/**
 * Source page with the split line (draggable) and skew guides: thin lines drawn at the
 * detected angle. When the angle is right they run parallel to the staff lines.
 */
export function SourceView({ url, width: srcW, height: srcH, rotation, split, splitX, angles, onSplitX }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const sideways = rotation === 90 || rotation === 270
  const width = sideways ? srcH : srcW
  const height = sideways ? srcW : srcH
  const [drag, setDrag] = useState<number | null>(null)
  const x = drag ?? splitX

  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    // Constrain to the ±10% band the detector searches, plus some slack for manual fixes.
    return Math.min(0.75, Math.max(0.25, (e.clientX - r.left) / r.width))
  }

  const parts = split
    ? [
        { x0: 0, x1: x * width, angle: angles[0] ?? 0 },
        { x0: x * width, x1: width, angle: angles[1] ?? 0 },
      ]
    : [{ x0: 0, x1: width, angle: angles[0] ?? 0 }]

  return (
    <div className="source-view" ref={ref} style={{ aspectRatio: `${width} / ${height}`, maxWidth: `calc(var(--view-h) * ${width / height})` }}>
      <img
        src={url}
        alt="処理前"
        draggable={false}
        style={{ width: `${(srcW / width) * 100}%`, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
      />
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
        {parts.map((p, i) =>
          Array.from({ length: GUIDE_ROWS }, (_, k) => {
            const y = ((k + 0.5) / GUIDE_ROWS) * height
            const dy = (p.x1 - p.x0) * Math.tan((p.angle * Math.PI) / 180)
            return <line key={`${i}-${k}`} className="guide" x1={p.x0} y1={y} x2={p.x1} y2={y + dy} vectorEffect="non-scaling-stroke" />
          }),
        )}
      </svg>
      {split && (
        <div
          className={`split-handle${drag !== null ? ' dragging' : ''}`}
          style={{ left: `${x * 100}%` }}
          role="slider"
          aria-label="分割位置"
          aria-valuenow={Math.round(x * 1000) / 10}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setDrag(fromEvent(e))
          }}
          onPointerMove={(e) => drag !== null && setDrag(fromEvent(e))}
          onPointerUp={() => {
            if (drag !== null) onSplitX(Math.round(drag * 1000) / 1000)
            setDrag(null)
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.01 : 0.002
            if (e.key === 'ArrowLeft') onSplitX(Math.max(0.25, splitX - step))
            else if (e.key === 'ArrowRight') onSplitX(Math.min(0.75, splitX + step))
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <span />
        </div>
      )}
    </div>
  )
}
