// PNG glyph-bounds probe: prints canvas size + non-transparent (or non-bg) pixel bbox.
// Usage: node scripts/probe-png.mjs <file> [--any-alpha]
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const file = process.argv[2]
if (!file) { console.error('usage: node probe-png.mjs <file.png>'); process.exit(1) }
const b = readFileSync(file)
// IHDR
const w = b.readUInt32BE(16), h = b.readUInt32BE(20)
const depth = b[24], ctype = b[25]
console.log(`canvas ${w}x${h} depth ${depth} colorType ${ctype}`)
// find IDAT
let idat = Buffer.alloc(0)
for (let i = 8; i < b.length;) {
  const len = b.readUInt32BE(i), type = b.toString('ascii', i + 4, i + 8)
  if (type === 'IDAT') idat = Buffer.concat([idat, b.subarray(i + 8, i + 8 + len)])
  i += 12 + len
}
const raw = inflateSync(idat)
const bpp = ctype === 2 ? 3 : ctype === 6 ? 4 : ctype === 3 ? 1 : 1 // assume 8-bit
const stride = w * bpp
const pixels = Buffer.alloc(h * stride)
let prev = Buffer.alloc(stride)
let off = 0
for (let y = 0; y < h; y++) {
  const f = raw[off++]
  const line = raw.subarray(off, off + stride); off += stride
  const out = pixels.subarray(y * stride, (y + 1) * stride)
  for (let x = 0; x < stride; x++) {
    const p = line[x]
    let v = p
    const a = x >= bpp ? out[x - bpp] : 0
    const c = prev[x]
    const d = x >= bpp ? prev[x - bpp] : 0
    if (f === 1) v = p + a
    else if (f === 2) v = p + c
    else if (f === 3) v = p + ((a + c) >> 1)
    else if (f === 4) { const pa = Math.abs(c - d), pb = Math.abs(a - d), pc = Math.abs(a + c - 2 * d); v = p + (pa <= pb && pa <= pc ? a : pb <= pc ? c : d) }
    out[x] = v & 0xff
  }
  prev = out
}
// glyph bbox: alpha != 0 (or RGB not equal to corner color when no alpha)
const useAlpha = ctype === 6 || ctype === 4
const corner = useAlpha ? null : [pixels[0], pixels[1], pixels[2]]
let minX = w, minY = h, maxX = -1, maxY = -1, n = 0
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * stride + x * bpp
    let hit
    if (useAlpha) hit = pixels[i + bpp - 1] > 8
    else hit = Math.abs(pixels[i] - corner[0]) + Math.abs(pixels[i + 1] - corner[1]) + Math.abs(pixels[i + 2] - corner[2]) > 30
    if (hit) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  }
}
if (!n) { console.log('no glyph pixels found (fully transparent or uniform)'); process.exit(0) }
const deadTop = minY, deadBottom = h - 1 - maxY, deadLeft = minX, deadRight = w - 1 - maxX
console.log(`glyph bbox x ${minX}..${maxX} y ${minY}..${maxY} (${maxX - minX + 1}x${maxY - minY + 1}), ${n} px`)
console.log(`dead space top ${deadTop} (${((deadTop / h) * 100).toFixed(1)}%)  bottom ${deadBottom} (${((deadBottom / h) * 100).toFixed(1)}%)`)
console.log(`dead space left ${deadLeft} (${((deadLeft / w) * 100).toFixed(1)}%)  right ${deadRight} (${((deadRight / w) * 100).toFixed(1)}%)`)
// alpha-weighted ink centroid (visual mass center)
let sy = 0, sx = 0, sa = 0
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * stride + x * bpp
    const a = useAlpha ? pixels[i + bpp - 1] : Math.abs(pixels[i] - corner[0]) + Math.abs(pixels[i + 1] - corner[1]) + Math.abs(pixels[i + 2] - corner[2])
    if (a) { sa += a; sx += x * a; sy += y * a }
  }
}
if (sa) {
  const cx = sx / sa / (w - 1), cy = sy / sa / (h - 1)
  console.log(`ink centroid x ${(cx * 100).toFixed(1)}%  y ${(cy * 100).toFixed(1)}%  (box center = 50% / 50%)`)
  console.log(`vertical nudge needed at 1.4rem (${(1.4 * 16).toFixed(1)}px tall): ${((0.5 - cy) * 1.4 * 16).toFixed(2)}px up`)
}