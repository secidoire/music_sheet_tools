// Draws the bundled sample (public/sample.jpg): an A4 page of made-up music, scanned a
// little crooked on a grey scanner bed. Synthetic so it carries no copyright.
//   node scripts/make-sample.mjs
import { writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'

const W = 1240 // A4 at 150dpi
const H = 1754
const TILT = (1.8 * Math.PI) / 180
const SP = 11 // staff line spacing (≈1.9mm)

const c = createCanvas(W, H)
const g = c.getContext('2d')

// Scanner bed, then the paper turned by TILT and slightly off centre.
g.fillStyle = '#cfcdc8'
g.fillRect(0, 0, W, H)
g.translate(W / 2 + 6, H / 2 + 4)
g.rotate(TILT)
g.translate(-W / 2, -H / 2)
g.fillStyle = '#f1eee6'
g.fillRect(14, 10, W - 36, H - 26)

// Deterministic pseudo-random numbers so the sample never changes between runs.
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

g.fillStyle = g.strokeStyle = '#1c1a17'
g.textAlign = 'center'
g.font = 'bold 44px serif'
g.fillText('Étude', W / 2, 150)
g.font = 'italic 22px serif'
g.textAlign = 'right'
g.fillText('Sample Score', W - 130, 195)

const left = 130
const right = W - 130
for (let s = 0; s < 10; s++) {
  const top = 260 + s * 140
  g.lineWidth = 1.4
  for (let l = 0; l < 5; l++) {
    g.beginPath()
    g.moveTo(left, top + l * SP)
    g.lineTo(right, top + l * SP)
    g.stroke()
  }
  // Treble clef and a two-sharp key signature at the start of every staff, as on a real
  // score: the orientation check looks for this ink at the left end.
  const cx = left + 22
  g.lineWidth = 2.6
  g.beginPath()
  g.moveTo(cx + 3, top + 6 * SP)
  g.quadraticCurveTo(cx - 8, top + 6.6 * SP, cx - 5, top + 5.3 * SP)
  g.lineTo(cx + 4, top - 1.8 * SP)
  g.bezierCurveTo(cx + 16, top - 0.8 * SP, cx - 12, top + 1.2 * SP, cx - 9, top + 2.8 * SP)
  g.bezierCurveTo(cx - 7, top + 4.7 * SP, cx + 14, top + 4.5 * SP, cx + 11, top + 3 * SP)
  g.bezierCurveTo(cx + 9, top + 1.8 * SP, cx - 2, top + 2 * SP, cx, top + 3.2 * SP)
  g.stroke()
  const sharp = (x, y) => {
    g.lineWidth = 1.4
    g.beginPath()
    g.moveTo(x - 2.5, y - 13)
    g.lineTo(x - 2.5, y + 13)
    g.moveTo(x + 2.5, y - 14)
    g.lineTo(x + 2.5, y + 12)
    g.stroke()
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(x - 6, y - 3)
    g.lineTo(x + 6, y - 6)
    g.moveTo(x - 6, y + 5)
    g.lineTo(x + 6, y + 2)
    g.stroke()
  }
  sharp(left + 52, top)
  sharp(left + 66, top + 1.5 * SP)

  // Bar lines, with a thicker opening one.
  const bars = 4
  const start = left + 115
  const barW = (right - start) / bars
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(left, top)
  g.lineTo(left, top + 4 * SP)
  g.stroke()
  g.lineWidth = 1.4
  for (let b = 1; b <= bars; b++) {
    const x = start + b * barW
    g.beginPath()
    g.moveTo(x, top)
    g.lineTo(x, top + 4 * SP)
    g.stroke()
  }
  if (s === 0) {
    g.font = 'bold 26px serif'
    g.textAlign = 'center'
    g.fillText('4', left + 96, top + 2 * SP - 2)
    g.fillText('4', left + 96, top + 4 * SP - 2)
  }
  // Notes: four quavers per beat pair, beamed, stems up or down by pitch.
  for (let b = 0; b < bars; b++) {
    for (let pair = 0; pair < 4; pair++) {
      const xs = [0, 1].map((k) => start + b * barW + 20 + (pair * 2 + k) * ((barW - 30) / 8))
      const ys = xs.map(() => top + Math.round(rand() * 10 - 2) * (SP / 2))
      const up = ys[0] + ys[1] > 2 * (top + 2 * SP)
      const stemX = xs.map((x) => (up ? x + 6.5 : x - 6.5))
      const end = up ? Math.min(...ys) - 34 : Math.max(...ys) + 34
      xs.forEach((x, k) => {
        g.beginPath()
        g.ellipse(x, ys[k], 7.5, 5.2, -0.35, 0, Math.PI * 2)
        g.fill()
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(stemX[k], ys[k])
        g.lineTo(stemX[k], end)
        g.stroke()
        // Ledger lines above or below the staff.
        for (let y = top - SP; y >= ys[k]; y -= SP) g.fillRect(x - 11, y - 0.7, 22, 1.4)
        for (let y = top + 5 * SP; y <= ys[k]; y += SP) g.fillRect(x - 11, y - 0.7, 22, 1.4)
      })
      g.lineWidth = 5
      g.beginPath()
      g.moveTo(stemX[0], end)
      g.lineTo(stemX[1], end)
      g.stroke()
    }
  }
}
g.font = '16px serif'
g.textAlign = 'center'
g.fillText('— 1 —', W / 2, H - 70)

// A little scanner dust and uneven grey so the background clean-up has something to do.
g.setTransform(1, 0, 0, 1, 0, 0)
for (let i = 0; i < 900; i++) {
  g.fillStyle = `rgba(60, 55, 50, ${0.08 + rand() * 0.25})`
  g.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2)
}

writeFileSync('public/sample.jpg', c.toBuffer('image/jpeg', 82))
console.log('wrote public/sample.jpg')
