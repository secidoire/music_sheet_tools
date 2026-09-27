import { useEffect, useRef, useState } from 'react'
import type { Rotation } from '../pipeline/types.ts'

interface Props {
  /** Unrotated source image and its size. */
  url: string
  width: number
  height: number
  /** Clockwise quarter turn the page is shown with; split and parts are in the turned frame. */
  rotation: Rotation
  split: boolean
  splitX: number
  /** Skew per part in degrees (positive = lines descend to the right). Each part is turned back by it. */
  angles: number[]
  /** Part the angle control acts on; outlined when the page is split. */
  activePart: number
  onActivePart: (i: number) => void
  /** Ease into new angles (the correction landing) instead of following them instantly (slider). */
  settle: boolean
  onSplitX: (x: number) => void
}

const GUIDE_ROWS = 16

/**
 * The page as it will be straightened: each part (half of a spread) is rotated with a CSS
 * transform, so dragging the angle slider costs no image processing. Horizontal guides
 * show when the staff lines are level.
 */
export function DeskewView({ url, width: srcW, height: srcH, rotation, split, splitX, angles, activePart, onActivePart, settle, onSplitX }: Props) {
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

  const parts = split ? [[0, x], [x, 1]] : [[0, 1]]

  return (
    <div className="deskew" ref={ref} style={{ '--ratio': width / height } as React.CSSProperties}>
      {parts.map(([x0, x1], i) => (
        <Part
          // Remount when the split appears so both halves ease in from the scanned angle.
          key={`${split}-${i}`}
          x0={x0}
          x1={x1}
          angle={angles[i] ?? 0}
          settle={settle}
          active={split && i === activePart}
          onClick={split ? () => onActivePart(i) : undefined}
        >
          <img
            src={url}
            alt=""
            draggable={false}
            style={{ width: `${(srcW / width) * 100}%`, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
          />
        </Part>
      ))}
      <svg className="guides" viewBox={`0 0 100 ${GUIDE_ROWS}`} preserveAspectRatio="none" aria-hidden>
        {Array.from({ length: GUIDE_ROWS }, (_, k) => (
          <line key={k} x1="0" x2="100" y1={k + 0.5} y2={k + 0.5} vectorEffect="non-scaling-stroke" />
        ))}
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

function Part({ x0, x1, angle, settle, active, onClick, children }: {
  x0: number
  x1: number
  angle: number
  settle: boolean
  active: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  // A freshly mounted part starts at the scanned angle and eases to its correction.
  const [entered, setEntered] = useState(!settle)
  useEffect(() => {
    if (entered) return
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
    return () => cancelAnimationFrame(id)
  }, [entered])
  const w = x1 - x0
  return (
    <div className={`part${active ? ' active' : ''}`} style={{ left: `${x0 * 100}%`, width: `${w * 100}%` }} onClick={onClick}>
      <div
        className={`layer${settle ? ' settle' : ''}`}
        style={{
          left: `${(-x0 / w) * 100}%`,
          width: `${(1 / w) * 100}%`,
          transformOrigin: `${((x0 + x1) / 2) * 100}% 50%`,
          transform: `rotate(${entered ? -angle : 0}deg)`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
