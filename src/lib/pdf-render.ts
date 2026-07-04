import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'
import { jsPDF } from 'jspdf'
import type { PDFEditItem } from './pdf-engine'

// Configure worker for Vite/Electron
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

async function loadPdfFromFile(file: File) {
  const bytes = await file.arrayBuffer()
  // pdf.js may transfer/detach the supplied buffer internally; always pass it
  // an isolated Uint8Array so the browser File remains reusable across tools.
  return pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise
}

async function renderPage(page: any, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')!
  // pdfjs v5 requires `canvas` in RenderParameters
  await page.render({ canvasContext: ctx, viewport, canvas } as any).promise
  return canvas
}

export async function renderPageToCanvas(file: File, pageIndex: number, scale = 1.5): Promise<HTMLCanvasElement> {
  const pdf = await loadPdfFromFile(file)
  const page = await pdf.getPage(pageIndex + 1)
  return renderPage(page, scale)
}

export async function renderPageToDataUrl(file: File, pageIndex: number, scale = 0.5): Promise<string> {
  const canvas = await renderPageToCanvas(file, pageIndex, scale)
  return canvas.toDataURL('image/jpeg', 0.8)
}

export async function getPageCount(file: File): Promise<number> {
  const pdf = await loadPdfFromFile(file)
  return pdf.numPages
}

export async function extractTextFromPDF(file: File): Promise<string> {
  const pdf = await loadPdfFromFile(file)
  const parts: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const viewport = page.getViewport({ scale: 1 })
    const pageHeight = viewport.height

    // Map each text item to { str, x, y, width }
    const items = (content.items as any[])
      .filter(item => item.str)
      .map(item => ({
        str: item.str as string,
        x: item.transform[4] as number,
        y: pageHeight - (item.transform[5] as number), // flip to top-left origin
        width: (item.width as number) || 0,
      }))

    if (!items.length) {
      parts.push(`--- Page ${i} ---\n`)
      continue
    }

    // Cluster items into visual lines using y-coordinate proximity (3 pt tolerance)
    const TOLERANCE = 3
    const lineMap = new Map<number, typeof items>()
    for (const item of items) {
      let matchKey = -1
      for (const k of lineMap.keys()) {
        if (Math.abs(item.y - k) <= TOLERANCE) { matchKey = k; break }
      }
      if (matchKey === -1) lineMap.set(item.y, [item])
      else lineMap.get(matchKey)!.push(item)
    }

    // Sort lines top→bottom; items within each line left→right
    const visualLines = [...lineMap.entries()]
      .sort(([ya], [yb]) => ya - yb)
      .map(([, lineItems]) => {
        lineItems.sort((a, b) => a.x - b.x)
        return lineItems.map((item, idx) => {
          if (idx === 0) return item.str
          const prevItem = lineItems[idx - 1]
          const gap = item.x - (prevItem.x + prevItem.width)
          return (gap > 25 ? '   ' : gap > 5 ? ' ' : '') + item.str
        }).join('')
      })
      .filter(l => l.trim())

    parts.push(`--- Page ${i} ---\n${visualLines.join('\n')}`)
  }
  return parts.join('\n\n')
}

export async function comparePDFText(left: File, right: File): Promise<string> {
  const [leftText, rightText] = await Promise.all([extractTextFromPDF(left), extractTextFromPDF(right)])
  const leftLines = normalizeForCompare(leftText)
  const rightLines = normalizeForCompare(rightText)
  const max = Math.max(leftLines.length, rightLines.length)
  const changes: string[] = []

  for (let i = 0; i < max; i++) {
    const a = leftLines[i] ?? ''
    const b = rightLines[i] ?? ''
    if (a === b) continue
    changes.push(`Line ${i + 1}`)
    if (a) changes.push(`- ${a}`)
    if (b) changes.push(`+ ${b}`)
    changes.push('')
  }

  return [
    `PDF Compare Report`,
    `Left: ${left.name}`,
    `Right: ${right.name}`,
    `Changed lines: ${changes.filter(line => line.startsWith('Line ')).length}`,
    '',
    changes.length ? changes.join('\n') : 'No text differences found.',
  ].join('\n')
}

function normalizeForCompare(text: string) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export async function pdfToImages(
  file: File,
  format: 'jpeg' | 'png',
  scale: number,
  onProgress?: (pct: number, page: number, total: number) => void
): Promise<{ name: string; url: string }[]> {
  const pdf = await loadPdfFromFile(file)
  const results: { name: string; url: string }[] = []
  const baseName = file.name.replace(/\.pdf$/i, '')

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const canvas = await renderPage(page, scale)
    const quality = format === 'jpeg' ? 0.92 : undefined
    results.push({ name: `${baseName}_page${i}.${format}`, url: canvas.toDataURL(`image/${format}`, quality) })
    onProgress?.(Math.round((i / pdf.numPages) * 100), i, pdf.numPages)
  }
  return results
}

export async function redactPDFRasterized(
  file: File,
  redactions: { pageIndex: number; x: number; y: number; width: number; height: number }[],
  scale = 2.5,
  onProgress?: (pct: number, page: number, total: number) => void
): Promise<Uint8Array> {
  const pdf = await loadPdfFromFile(file)
  const out = await PDFDocument.create()

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })
    const canvas = await renderPage(page, scale)
    const ctx = canvas.getContext('2d')!

    for (const redaction of redactions.filter(r => r.pageIndex === i - 1)) {
      ctx.fillStyle = '#000'
      ctx.fillRect(redaction.x * scale, redaction.y * scale, redaction.width * scale, redaction.height * scale)
    }

    const imageBytes = await new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob(async blob => {
        if (!blob) {
          reject(new Error('Could not render redacted page'))
          return
        }
        resolve(new Uint8Array(await blob.arrayBuffer()))
      }, 'image/jpeg', 0.95)
    })
    const image = await out.embedJpg(imageBytes)
    const outPage = out.addPage([baseViewport.width, baseViewport.height])
    outPage.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height })
    onProgress?.(Math.round((i / pdf.numPages) * 100), i, pdf.numPages)
  }

  return out.save()
}

export async function compressPDFRasterized(
  file: File,
  level: 'medium' | 'high',
  onProgress?: (pct: number, page: number, total: number) => void
): Promise<Uint8Array> {
  const scale = level === 'high' ? 1.3 : 1.8
  const quality = level === 'high' ? 0.55 : 0.72
  const pdf = await loadPdfFromFile(file)
  const out = await PDFDocument.create()

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })
    const canvas = await renderPage(page, scale)
    const imageBytes = await new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob(async blob => {
        if (!blob) {
          reject(new Error('Could not compress page image'))
          return
        }
        resolve(new Uint8Array(await blob.arrayBuffer()))
      }, 'image/jpeg', quality)
    })
    const image = await out.embedJpg(imageBytes)
    const outPage = out.addPage([baseViewport.width, baseViewport.height])
    outPage.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height })
    onProgress?.(Math.round((i / pdf.numPages) * 100), i, pdf.numPages)
  }

  return out.save({ useObjectStreams: true })
}

export async function protectPDFRasterized(
  file: File,
  userPassword: string,
  ownerPassword: string,
  onProgress?: (pct: number, page: number, total: number) => void
): Promise<Uint8Array> {
  if (!userPassword.trim()) throw new Error('Enter a password to protect the PDF')

  const pdf = await loadPdfFromFile(file)
  let out: jsPDF | null = null

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })
    const orientation = baseViewport.width > baseViewport.height ? 'landscape' : 'portrait'
    const canvas = await renderPage(page, 2.2)
    const imageData = canvas.toDataURL('image/jpeg', 0.93)

    if (!out) {
      out = new jsPDF({
        orientation,
        unit: 'pt',
        format: [baseViewport.width, baseViewport.height],
        compress: true,
        encryption: {
          userPassword,
          ownerPassword: ownerPassword.trim() || userPassword,
          userPermissions: ['print'],
        },
      })
    } else {
      out.addPage([baseViewport.width, baseViewport.height], orientation)
    }

    out.addImage(imageData, 'JPEG', 0, 0, baseViewport.width, baseViewport.height)
    onProgress?.(Math.round((i / pdf.numPages) * 100), i, pdf.numPages)
  }

  if (!out) throw new Error('Could not protect an empty PDF')
  return new Uint8Array(out.output('arraybuffer'))
}

export function downloadDataUrl(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
}

// ── CROP PDF — RASTERIZED (permanently removes hidden content) ────────────────
export async function cropPDFRasterized(
  file: File,
  crop: { pageIndex: number; x: number; y: number; width: number; height: number; allPages?: boolean },
  onProgress?: (pct: number, page: number, total: number) => void
): Promise<Uint8Array> {
  const scale = 2
  const pdf = await loadPdfFromFile(file)
  const out = await PDFDocument.create()

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })
    const shouldCrop = crop.allPages || (i - 1 === crop.pageIndex)
    const canvas = await renderPage(page, scale)

    let finalCanvas: HTMLCanvasElement
    let pw: number
    let ph: number

    if (shouldCrop) {
      // Crop coordinates are in PDF-point space; multiply by scale for canvas pixels
      const cx = Math.round(Math.max(0, crop.x * scale))
      const cy = Math.round(Math.max(0, crop.y * scale))
      const cw = Math.round(Math.min(crop.width * scale, canvas.width - cx))
      const ch = Math.round(Math.min(crop.height * scale, canvas.height - cy))
      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = Math.max(1, cw)
      cropCanvas.height = Math.max(1, ch)
      cropCanvas.getContext('2d')!.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch)
      finalCanvas = cropCanvas
      pw = Math.max(1, crop.width)
      ph = Math.max(1, crop.height)
    } else {
      finalCanvas = canvas
      pw = baseViewport.width
      ph = baseViewport.height
    }

    const imageBytes = await new Promise<Uint8Array>((resolve, reject) => {
      finalCanvas.toBlob(async blob => {
        if (!blob) reject(new Error('Failed to render page'))
        else resolve(new Uint8Array(await blob.arrayBuffer()))
      }, 'image/jpeg', 0.92)
    })

    const image = await out.embedJpg(imageBytes)
    const outPage = out.addPage([pw, ph])
    outPage.drawImage(image, { x: 0, y: 0, width: pw, height: ph })
    onProgress?.(Math.round((i / pdf.numPages) * 100), i, pdf.numPages)
  }

  return out.save()
}

export async function applyPDFEditsRasterized(
  file: File,
  edits: PDFEditItem[],
  scale = 2.5,
  onProgress?: (pct: number, page: number, total: number) => void
): Promise<Uint8Array> {
  if (!edits.length) throw new Error('Add at least one edit to the PDF')

  const pdf = await loadPdfFromFile(file)
  const out = await PDFDocument.create()

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })
    const canvas = await renderPage(page, scale)
    const ctx = canvas.getContext('2d')!

    for (const edit of edits.filter(item => item.pageIndex === i - 1)) {
      await drawRasterEdit(ctx, edit, scale)
    }

    const imageBytes = await new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob(async blob => {
        if (!blob) {
          reject(new Error('Could not render edited page'))
          return
        }
        resolve(new Uint8Array(await blob.arrayBuffer()))
      }, 'image/jpeg', 0.96)
    })

    const image = await out.embedJpg(imageBytes)
    const outPage = out.addPage([baseViewport.width, baseViewport.height])
    outPage.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height })
    onProgress?.(Math.round((i / pdf.numPages) * 100), i, pdf.numPages)
  }

  return out.save({ useObjectStreams: true })
}

async function drawRasterEdit(ctx: CanvasRenderingContext2D, edit: PDFEditItem, scale: number) {
  const x = edit.x * scale
  const y = edit.y * scale
  const width = Math.max(1, edit.width ?? 1) * scale
  const height = Math.max(1, edit.height ?? 1) * scale
  const opacity = Math.max(0.05, Math.min(1, edit.opacity ?? 1))

  ctx.save()
  ctx.globalAlpha = edit.kind === 'highlight' ? Math.min(opacity, 0.45) : opacity

  if (edit.kind === 'text') {
    const text = edit.text?.trim()
    if (text) {
      const fontSize = Math.max(6, edit.fontSize ?? 14) * scale
      ctx.fillStyle = edit.color || '#111111'
      const familySafe = edit.fontFamily ? `"${edit.fontFamily}", Arial, sans-serif` : 'Arial, sans-serif'
      const weight = edit.bold ? 'bold' : 'normal'
      const style = edit.italic ? 'italic' : 'normal'
      ctx.font = `${style} ${weight} ${fontSize}px ${familySafe}`
      ctx.textBaseline = 'top'
      text.split('\n').forEach((line, index) => {
        const lineY = y + index * fontSize * 1.25
        ctx.fillText(line, x, lineY)
        if (edit.underline || edit.strikethrough) {
          const metrics = ctx.measureText(line)
          const lw = Math.max(1, fontSize * 0.065)
          ctx.beginPath()
          ctx.strokeStyle = edit.color || '#111111'
          ctx.lineWidth = lw
          if (edit.underline) {
            ctx.moveTo(x, lineY + fontSize * 1.05)
            ctx.lineTo(x + metrics.width, lineY + fontSize * 1.05)
          }
          if (edit.strikethrough) {
            ctx.moveTo(x, lineY + fontSize * 0.55)
            ctx.lineTo(x + metrics.width, lineY + fontSize * 0.55)
          }
          ctx.stroke()
        }
      })
    }
    ctx.restore()
    return
  }

  if (edit.kind === 'sticky-note') {
    const noteW = width || 180 * scale
    const noteH = height || 120 * scale
    const radius = 5 * scale
    ctx.fillStyle = '#fffacd'
    ctx.strokeStyle = '#e6c000'
    ctx.lineWidth = Math.max(1, scale * 0.5)
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + noteW - radius, y)
    ctx.quadraticCurveTo(x + noteW, y, x + noteW, y + radius)
    ctx.lineTo(x + noteW, y + noteH - radius)
    ctx.quadraticCurveTo(x + noteW, y + noteH, x + noteW - radius, y + noteH)
    ctx.lineTo(x + radius, y + noteH)
    ctx.quadraticCurveTo(x, y + noteH, x, y + noteH - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    if (edit.text?.trim()) {
      const fontSize = Math.max(6, edit.fontSize ?? 12) * scale
      ctx.fillStyle = '#333333'
      ctx.globalAlpha = opacity
      ctx.font = `${fontSize}px Arial, sans-serif`
      ctx.textBaseline = 'top'
      edit.text.trim().split('\n').forEach((line, i) => {
        ctx.fillText(line, x + 8 * scale, y + 8 * scale + i * fontSize * 1.3, noteW - 12 * scale)
      })
    }
    ctx.restore()
    return
  }

  if (edit.kind === 'line') {
    ctx.strokeStyle = edit.color || '#111111'
    ctx.lineWidth = Math.max(1, edit.height ?? 2) * scale
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo((edit.x2 ?? edit.x + (edit.width ?? 1)) * scale, (edit.y2 ?? edit.y) * scale)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (edit.kind === 'arrow') {
    const x2 = (edit.x2 ?? edit.x + (edit.width ?? 50)) * scale
    const y2 = (edit.y2 ?? edit.y) * scale
    const lw = Math.max(2, (edit.height ?? 2) * scale * 0.5)
    const headLen = Math.max(12, lw * 4) * scale * 0.4
    const angle = Math.atan2(y2 - y, x2 - x)
    ctx.strokeStyle = edit.color || '#111111'
    ctx.fillStyle = edit.color || '#111111'
    ctx.lineWidth = lw
    ctx.lineCap = 'round'
    // shaft
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    // arrowhead
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    return
  }

  if (edit.kind === 'circle') {
    const lw = Math.max(2, scale * 1.5)
    ctx.strokeStyle = edit.color || '#111111'
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (edit.kind === 'freehand' && edit.points && edit.points.length > 1) {
    ctx.strokeStyle = edit.color || '#111111'
    ctx.lineWidth = Math.max(1, (edit.height ?? 2) * scale * 0.5)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(edit.points[0].x * scale, edit.points[0].y * scale)
    for (let i = 1; i < edit.points.length; i++) {
      ctx.lineTo(edit.points[i].x * scale, edit.points[i].y * scale)
    }
    ctx.stroke()
    ctx.restore()
    return
  }

  if (edit.kind === 'image' && edit.imageDataUrl) {
    const image = await loadImage(edit.imageDataUrl)
    ctx.drawImage(image, x, y, width, height)
    ctx.restore()
    return
  }

  ctx.fillStyle = edit.kind === 'whiteout' ? '#ffffff' : edit.color || '#111111'
  ctx.fillRect(x, y, width, height)
  ctx.restore()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load edit image'))
    image.src = src
  })
}
