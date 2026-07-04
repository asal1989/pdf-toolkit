/**
 * Generates public/icon.ico from the BCIM logo colours.
 * Uses only Node.js built-ins (zlib, fs, path) — no external deps.
 *
 * Design: flat-top hexagon with navy background (#1c2c72)
 *         and three horizontal red bars (#d0391a).
 * Sizes embedded: 16 × 16, 32 × 32, 48 × 48, 256 × 256.
 */

'use strict'

const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

// ── Colour palette ────────────────────────────────────────────────────────────
const NAVY        = [0x1c, 0x2c, 0x72, 0xff]   // #1c2c72
const RED         = [0xd0, 0x39, 0x1a, 0xff]   // #d0391a
const TRANSPARENT = [0x00, 0x00, 0x00, 0x00]

// ── Point-in-polygon (ray-casting) ───────────────────────────────────────────
function pip(px, py, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    const cross = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)
    if (cross) inside = !inside
  }
  return inside
}

// ── BCIM hexagon vertices (normalised 0–1 from the SVG viewBox 81×64) ────────
// SVG points="19,4 62,4 81,36 62,68 19,68 0,36" → shift Y by −4 → 0-based 0-64
const HEX = [
  [19 / 81, 0 / 64],
  [62 / 81, 0 / 64],
  [81 / 81, 32 / 64],
  [62 / 81, 64 / 64],
  [19 / 81, 64 / 64],
  [ 0 / 81, 32 / 64],
]

// ── Per-pixel colour lookup ───────────────────────────────────────────────────
function pixelColor(nx, ny) {
  if (!pip(nx, ny, HEX)) return TRANSPARENT

  // Three horizontal red bars at ~25 %, ~50 %, ~75 % of height
  const barHeight = 0.16
  if (
    (ny >= 0.18 && ny < 0.18 + barHeight) ||
    (ny >= 0.42 && ny < 0.42 + barHeight) ||
    (ny >= 0.66 && ny < 0.66 + barHeight)
  ) return RED

  return NAVY
}

// ── PNG encoder ──────────────────────────────────────────────────────────────
function crc32(buf) {
  const tbl = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    tbl[i] = c
  }
  let crc = -1
  for (const b of buf) crc = tbl[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length)
  const crcVal  = crc32(Buffer.concat([typeBuf, data]))
  const crcBuf  = Buffer.alloc(4); crcBuf.writeUInt32BE(crcVal)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function makePNG(size) {
  // Raw scanline data: filter-byte (0 = None) + RGBA per pixel
  const stride = 1 + size * 4
  const raw    = Buffer.alloc(stride * size)

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0                        // filter: None
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size
      const [r, g, b, a] = pixelColor(nx, ny)
      const off = y * stride + 1 + x * 4
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr.writeUInt8(8, 8)   // bit depth
  ihdr.writeUInt8(6, 9)   // RGBA
  // bytes 10-12 default to 0 (compression / filter / interlace)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── ICO assembler ────────────────────────────────────────────────────────────
function makeICO(sizes) {
  const pngs = sizes.map(makePNG)

  // ICONDIR header (6 bytes)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)           // reserved
  header.writeUInt16LE(1, 2)           // type: 1 = ICO
  header.writeUInt16LE(sizes.length, 4)

  // ICONDIRENTRY array (16 bytes each)
  const dirBufs = []
  let dataOffset = 6 + sizes.length * 16
  for (let i = 0; i < sizes.length; i++) {
    const e = Buffer.alloc(16)
    const s = sizes[i]
    e.writeUInt8(s >= 256 ? 0 : s, 0)   // 0 = 256 in ICO spec
    e.writeUInt8(s >= 256 ? 0 : s, 1)
    e.writeUInt8(0, 2)                   // colour count (0 = true colour)
    e.writeUInt8(0, 3)                   // reserved
    e.writeUInt16LE(1, 4)               // planes
    e.writeUInt16LE(32, 6)             // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8)
    e.writeUInt32LE(dataOffset, 12)
    dirBufs.push(e)
    dataOffset += pngs[i].length
  }

  return Buffer.concat([header, ...dirBufs, ...pngs])
}

// ── Main ─────────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, '..', 'public', 'icon.ico')
const ico     = makeICO([16, 32, 48, 256])
fs.writeFileSync(outPath, ico)
console.log(`✓  Created ${outPath}  (${(ico.length / 1024).toFixed(1)} KB)`)
