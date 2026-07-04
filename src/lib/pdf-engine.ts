import { PDFDocument, degrees, rgb, StandardFonts, PageSizes, PDFName, PDFString, PDFArray } from 'pdf-lib'

export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function uint8ToArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

async function loadPdfDocument(file: File, action = 'process') {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    throw new Error(`"${file.name}" is not a PDF file. Please choose a valid .pdf file.`)
  }

  try {
    const bytes = await readFileAsArrayBuffer(file)
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    if (doc.getPageCount() < 1) {
      throw new Error(`"${file.name}" has no pages to ${action}.`)
    }
    return doc
  } catch (error: any) {
    const message = String(error?.message || error || '')
    if (/encrypted|password|decrypt|unsupported security/i.test(message)) {
      throw new Error(`"${file.name}" is password-protected or restricted. Remove the password and try again.`)
    }
    if (/no pages/i.test(message)) throw error
    throw new Error(`"${file.name}" could not be opened as a valid PDF. The file may be damaged or unsupported. Try Repair PDF first.`)
  }
}

export async function downloadBlob(data: Uint8Array, filename: string, mime = 'application/pdf') {
  const blob = new Blob([uint8ToArrayBuffer(data)], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadZip(files: { name: string; data: Uint8Array }[]) {
  downloadBlob(createZip(files), 'bcim-pdf-files.zip', 'application/zip')
}

function createZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const centralDirectory: Uint8Array[] = []
  let offset = 0

  const push16 = (arr: number[], n: number) => arr.push(n & 0xff, (n >>> 8) & 0xff)
  const push32 = (arr: number[], n: number) => arr.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff)

  for (const file of files) {
    const name = encoder.encode(file.name.replace(/\\/g, '/'))
    const crc = crc32(file.data)
    const local: number[] = []
    push32(local, 0x04034b50)
    push16(local, 20)
    push16(local, 0)
    push16(local, 0)
    push16(local, 0)
    push16(local, 0)
    push32(local, crc)
    push32(local, file.data.length)
    push32(local, file.data.length)
    push16(local, name.length)
    push16(local, 0)
    chunks.push(new Uint8Array(local), name, file.data)

    const central: number[] = []
    push32(central, 0x02014b50)
    push16(central, 20)
    push16(central, 20)
    push16(central, 0)
    push16(central, 0)
    push16(central, 0)
    push16(central, 0)
    push32(central, crc)
    push32(central, file.data.length)
    push32(central, file.data.length)
    push16(central, name.length)
    push16(central, 0)
    push16(central, 0)
    push16(central, 0)
    push16(central, 0)
    push32(central, 0)
    push32(central, offset)
    centralDirectory.push(new Uint8Array(central), name)

    offset += local.length + name.length + file.data.length
  }

  const centralOffset = offset
  const centralSize = centralDirectory.reduce((sum, part) => sum + part.length, 0)
  const end: number[] = []
  push32(end, 0x06054b50)
  push16(end, 0)
  push16(end, 0)
  push16(end, files.length)
  push16(end, files.length)
  push32(end, centralSize)
  push32(end, centralOffset)
  push16(end, 0)

  const all = [...chunks, ...centralDirectory, new Uint8Array(end)]
  const total = all.reduce((sum, part) => sum + part.length, 0)
  const zip = new Uint8Array(total)
  let cursor = 0
  for (const part of all) {
    zip.set(part, cursor)
    cursor += part.length
  }
  return zip
}

function crc32(data: Uint8Array): number {
  let crc = -1
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ -1) >>> 0
}

// ── MERGE ─────────────────────────────────────────────────────────────────────
export async function mergePDFs(files: File[]): Promise<Uint8Array> {
  if (files.length < 2) throw new Error('Add at least two PDF files to merge.')
  const merged = await PDFDocument.create()
  for (const file of files) {
    const doc = await loadPdfDocument(file, 'merge')
    const copied = await merged.copyPages(doc, doc.getPageIndices())
    copied.forEach(p => merged.addPage(p))
  }
  return merged.save()
}

// ── SPLIT ─────────────────────────────────────────────────────────────────────
export async function splitPDF(
  file: File,
  mode: 'range' | 'every' | 'all',
  rangeInput?: string,
  everyN?: number
): Promise<{ name: string; data: Uint8Array }[]> {
  const doc = await loadPdfDocument(file, 'split')
  const total = doc.getPageCount()
  const baseName = file.name.replace(/\.pdf$/i, '')
  const results: { name: string; data: Uint8Array }[] = []

  let groups: number[][] = []

  if (mode === 'all') {
    groups = Array.from({ length: total }, (_, i) => [i])
  } else if (mode === 'every' && everyN) {
    if (everyN < 1) throw new Error('Pages per part must be at least 1')
    for (let i = 0; i < total; i += everyN) {
      groups.push(Array.from({ length: Math.min(everyN, total - i) }, (_, j) => i + j))
    }
  } else if (mode === 'range' && rangeInput) {
    groups = parseRanges(rangeInput, total)
  }

  if (!groups.length) throw new Error('Enter at least one valid page range')

  for (let g = 0; g < groups.length; g++) {
    const newDoc = await PDFDocument.create()
    const pages = await newDoc.copyPages(doc, groups[g])
    pages.forEach(p => newDoc.addPage(p))
    results.push({ name: `${baseName}_part${g + 1}.pdf`, data: await newDoc.save() })
  }
  return results
}

function parseRanges(input: string, total: number): number[][] {
  return input.split(',').map(part => {
    part = part.trim()
    if (part.includes('-')) {
      const parsed = part.split('-').map(n => parseInt(n.trim(), 10))
      if (parsed.some(Number.isNaN)) return []
      let [s, e] = parsed.map(n => Math.max(1, Math.min(total, n)) - 1)
      if (s > e) [s, e] = [e, s]
      return Array.from({ length: e - s + 1 }, (_, i) => s + i)
    }
    const n = parseInt(part, 10) - 1
    return n >= 0 && n < total ? [n] : []
  }).filter(g => g.length > 0)
}

// ── REMOVE PAGES ──────────────────────────────────────────────────────────────
export async function removePages(file: File, pageIndices: number[]): Promise<Uint8Array> {
  const src = await loadPdfDocument(file, 'remove pages from')
  const total = src.getPageCount()
  const toRemove = new Set(pageIndices.filter(index => index >= 0 && index < total))
  if (!toRemove.size) throw new Error('Select at least one valid page to remove')
  if (toRemove.size >= total) throw new Error('Cannot remove every page from a PDF')

  const keep = src.getPageIndices().filter(index => !toRemove.has(index))
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, keep)
  pages.forEach(page => out.addPage(page))
  return out.save()
}

// ── EXTRACT PAGES ─────────────────────────────────────────────────────────────
export async function extractPages(file: File, pageIndices: number[]): Promise<Uint8Array> {
  const src = await loadPdfDocument(file, 'extract pages from')
  const total = src.getPageCount()
  const validPages = [...new Set(pageIndices)].filter(index => index >= 0 && index < total)
  if (!validPages.length) throw new Error('Select at least one valid page to extract')

  const newDoc = await PDFDocument.create()
  const pages = await newDoc.copyPages(src, validPages)
  pages.forEach(p => newDoc.addPage(p))
  return newDoc.save()
}

// ── ROTATE ────────────────────────────────────────────────────────────────────
export async function rotatePDF(file: File, angle: number, pageIndices?: number[]): Promise<Uint8Array> {
  const doc = await loadPdfDocument(file, 'rotate')
  const total = doc.getPageCount()
  const indices = pageIndices?.length
    ? [...new Set(pageIndices)].filter(index => index >= 0 && index < total)
    : doc.getPageIndices()
  if (!indices.length) throw new Error('Select at least one valid page to rotate')

  indices.forEach(i => {
    const page = doc.getPage(i)
    page.setRotation(degrees((page.getRotation().angle + angle) % 360))
  })
  return doc.save()
}

// ── REORDER PAGES ─────────────────────────────────────────────────────────────
export async function reorderPages(file: File, newOrder: number[]): Promise<Uint8Array> {
  const src = await loadPdfDocument(file, 'reorder')
  const total = src.getPageCount()
  if (newOrder.length !== total) throw new Error('Drag all pages into the required order before saving')
  const unique = new Set(newOrder)
  if (unique.size !== total || newOrder.some(index => index < 0 || index >= total)) {
    throw new Error('Page order is invalid. Please reload the PDF and try again.')
  }

  const newDoc = await PDFDocument.create()
  const pages = await newDoc.copyPages(src, newOrder)
  pages.forEach(p => newDoc.addPage(p))
  return newDoc.save()
}

// ── COMPRESS ──────────────────────────────────────────────────────────────────
export async function compressPDF(file: File, level: 'low' | 'medium' | 'high'): Promise<Uint8Array> {
  const doc = await loadPdfDocument(file, 'compress')
  // Only strip metadata at the highest level where file size is the priority
  if (level === 'high') {
    doc.setTitle('')
    doc.setAuthor('')
    doc.setSubject('')
    doc.setKeywords([])
    doc.setProducer('')
    doc.setCreator('')
  }
  const useObjectStreams = level !== 'low'
  return doc.save({ useObjectStreams, addDefaultPage: false })
}

// ── WATERMARK ─────────────────────────────────────────────────────────────────
export async function addWatermark(
  file: File,
  text: string,
  opacity: number,
  position: 'center' | 'diagonal' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  fontSize: number,
  colorHex = '#888888'
): Promise<Uint8Array> {
  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.HelveticaBold)

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    const textWidth = font.widthOfTextAtSize(text, fontSize)
    const textHeight = font.heightAtSize(fontSize)

    let x = 0, y = 0, rotate = 0

    switch (position) {
      case 'center':
        x = (width - textWidth) / 2
        y = (height - textHeight) / 2
        break
      case 'diagonal': {
        // pdf-lib rotates text around its bottom-left origin (x, y).
        // To make the visual centre of the rotated text land at the page centre,
        // back-calculate the origin using the rotation transform inverse:
        //   cx = x + (w/2)·cos θ − (h/2)·sin θ
        //   cy = y + (w/2)·sin θ + (h/2)·cos θ
        // Solving for x, y with cx=width/2, cy=height/2, θ=45°:
        const cos = Math.cos(Math.PI / 4)   // ≈ 0.7071
        const sin = Math.sin(Math.PI / 4)
        x = width  / 2 - (textWidth  / 2) * cos + (textHeight / 2) * sin
        y = height / 2 - (textWidth  / 2) * sin - (textHeight / 2) * cos
        rotate = 45
        break
      }
      case 'top-left':
        x = 20; y = height - textHeight - 20; break
      case 'top-right':
        x = width - textWidth - 20; y = height - textHeight - 20; break
      case 'bottom-left':
        x = 20; y = 20; break
      case 'bottom-right':
        x = width - textWidth - 20; y = 20; break
    }

    const c = hexToRgb(colorHex)
    page.drawText(text, {
      x, y,
      size: fontSize,
      font,
      color: rgb(c.r, c.g, c.b),
      opacity: opacity / 100,
      rotate: degrees(rotate),
    })
  }
  return doc.save()
}

// ── PAGE NUMBERS ──────────────────────────────────────────────────────────────
export async function addPageNumbers(
  file: File,
  position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center',
  startNumber: number,
  format: string
): Promise<Uint8Array> {
  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontSize = 11

  doc.getPages().forEach((page, i) => {
    const { width, height } = page.getSize()
    const label = format.replace('{n}', String(startNumber + i)).replace('{total}', String(doc.getPageCount()))
    const textWidth = font.widthOfTextAtSize(label, fontSize)
    let x = 0, y = 0

    switch (position) {
      case 'bottom-center': x = (width - textWidth) / 2; y = 20; break
      case 'bottom-right':  x = width - textWidth - 20;  y = 20; break
      case 'bottom-left':   x = 20;                       y = 20; break
      case 'top-center':    x = (width - textWidth) / 2; y = height - 30; break
    }

    page.drawText(label, { x, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) })
  })
  return doc.save()
}

// ── HEADER / FOOTER ───────────────────────────────────────────────────────────
export async function addHeaderFooter(
  file: File,
  headerText: string,
  footerText: string,
  fontSize: number,
  colorHex = '#111111'
): Promise<Uint8Array> {
  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const c = hexToRgb(colorHex)
  const textColor = rgb(c.r, c.g, c.b)

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    if (headerText) {
      const w = font.widthOfTextAtSize(headerText, fontSize)
      page.drawText(headerText, { x: (width - w) / 2, y: height - fontSize - 8, size: fontSize, font, color: textColor })
    }
    if (footerText) {
      const w = font.widthOfTextAtSize(footerText, fontSize)
      page.drawText(footerText, { x: (width - w) / 2, y: 12, size: fontSize, font, color: textColor })
    }
  }
  return doc.save()
}

// ── FLATTEN ───────────────────────────────────────────────────────────────────
export async function addTextToPDF(
  file: File,
  edits: { pageIndex: number; text: string; x: number; y: number; fontSize: number; color: string }[]
): Promise<Uint8Array> {
  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)

  for (const edit of edits) {
    const page = doc.getPage(edit.pageIndex)
    const { height } = page.getSize()
    const color = hexToRgb(edit.color)
    page.drawText(edit.text, {
      x: edit.x,
      y: height - edit.y - edit.fontSize,
      size: edit.fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
    })
  }

  return doc.save()
}

export type PDFEditItem = {
  kind: 'text' | 'highlight' | 'rectangle' | 'whiteout' | 'line' | 'image' | 'circle' | 'arrow' | 'freehand' | 'sticky-note'
  pageIndex: number
  x: number
  y: number
  width?: number
  height?: number
  x2?: number
  y2?: number
  text?: string
  fontSize?: number
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  color?: string
  opacity?: number
  imageDataUrl?: string
  points?: { x: number; y: number }[]
}

type PDFPageLike = ReturnType<PDFDocument['getPage']>

function normalizedRotation(page: PDFPageLike) {
  const angle = page.getRotation().angle % 360
  return angle < 0 ? angle + 360 : angle
}

function visualBoxToPdfBox(
  page: PDFPageLike,
  box: { x: number; y: number; width: number; height: number }
) {
  const { width: pageWidth, height: pageHeight } = page.getSize()
  const x = Math.max(0, box.x)
  const y = Math.max(0, box.y)
  const width = Math.max(1, box.width)
  const height = Math.max(1, box.height)

  switch (normalizedRotation(page)) {
    case 90:
      return { x: y, y: pageHeight - x - width, width: height, height: width }
    case 180:
      return { x: pageWidth - x - width, y, width, height }
    case 270:
      return { x: pageWidth - y - height, y: x, width: height, height: width }
    default:
      return { x, y: pageHeight - y - height, width, height }
  }
}

function visualPointToPdfPoint(page: PDFPageLike, point: { x: number; y: number }) {
  const { width: pageWidth, height: pageHeight } = page.getSize()
  const x = Math.max(0, point.x)
  const y = Math.max(0, point.y)

  switch (normalizedRotation(page)) {
    case 90:
      return { x: y, y: pageHeight - x }
    case 180:
      return { x: pageWidth - x, y }
    case 270:
      return { x: pageWidth - y, y: x }
    default:
      return { x, y: pageHeight - y }
  }
}

export async function applyPDFEdits(file: File, edits: PDFEditItem[]): Promise<Uint8Array> {
  if (!edits.length) throw new Error('Add at least one edit to the PDF')

  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()

  for (const edit of edits) {
    const page = pages[edit.pageIndex]
    if (!page) throw new Error(`Page ${edit.pageIndex + 1} does not exist`)

    const color = hexToRgb(edit.color || '#111111')
    const opacity = Math.max(0.05, Math.min(1, edit.opacity ?? 1))
    const box = visualBoxToPdfBox(page, {
      x: edit.x,
      y: edit.y,
      width: edit.width ?? 1,
      height: edit.height ?? 1,
    })

    if (edit.kind === 'text') {
      const text = edit.text?.trim()
      if (!text) continue
      const fontSize = Math.max(6, edit.fontSize ?? 14)
      const textBox = visualBoxToPdfBox(page, {
        x: edit.x,
        y: edit.y,
        width: Math.max(1, edit.width ?? 1),
        height: fontSize,
      })
      page.drawText(text, {
        x: textBox.x,
        y: textBox.y,
        size: fontSize,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity,
      })
      continue
    }

    if (edit.kind === 'line') {
      const start = visualPointToPdfPoint(page, { x: edit.x, y: edit.y })
      const end = visualPointToPdfPoint(page, { x: edit.x2 ?? edit.x + (edit.width ?? 1), y: edit.y2 ?? edit.y })
      page.drawLine({
        start,
        end,
        thickness: Math.max(1, edit.height ?? 2),
        color: rgb(color.r, color.g, color.b),
        opacity,
      })
      continue
    }

    if (edit.kind === 'image') {
      if (!edit.imageDataUrl) continue
      const imageBytes = dataUrlToBytes(edit.imageDataUrl)
      const image = edit.imageDataUrl.startsWith('data:image/jpeg') || edit.imageDataUrl.startsWith('data:image/jpg')
        ? await doc.embedJpg(imageBytes)
        : await doc.embedPng(imageBytes)
      page.drawImage(image, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        opacity,
      })
      continue
    }

    const fill = edit.kind === 'whiteout' ? { r: 1, g: 1, b: 1 } : color
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      color: rgb(fill.r, fill.g, fill.b),
      opacity: edit.kind === 'highlight' ? Math.min(opacity, 0.45) : opacity,
    })
  }

  return doc.save()
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  if (!base64) throw new Error('Invalid image data')
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}

export async function cropPDF(
  file: File,
  crop: { pageIndex: number; x: number; y: number; width: number; height: number; allPages?: boolean }
): Promise<Uint8Array> {
  if (crop.width <= 0 || crop.height <= 0) throw new Error('Enter a valid crop area')

  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pages = doc.getPages()
  const targets = crop.allPages ? pages.map((_, index) => index) : [crop.pageIndex]

  for (const index of targets) {
    const page = pages[index]
    if (!page) throw new Error(`Page ${index + 1} does not exist`)
    const box = visualBoxToPdfBox(page, crop)
    page.setCropBox(box.x, box.y, box.width, box.height)
    page.setMediaBox(box.x, box.y, box.width, box.height)
  }

  return doc.save()
}

export type PDFFormFieldSpec = {
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'signature'
  name: string
  label?: string
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  options?: string[]
}

export async function addFormFieldsToPDF(file: File, fields: PDFFormFieldSpec[]): Promise<Uint8Array> {
  if (!fields.length) throw new Error('Add at least one form field')

  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = doc.getForm()
  const font = await doc.embedFont(StandardFonts.Helvetica)

  for (const spec of fields) {
    const page = doc.getPage(spec.pageIndex)
    const box = visualBoxToPdfBox(page, {
      x: spec.x,
      y: spec.y,
      width: Math.max(12, spec.width),
      height: Math.max(12, spec.height),
    })
    const { x, y, width, height } = box
    const name = spec.name.trim() || `${spec.type}_${spec.pageIndex + 1}_${Math.round(x)}_${Math.round(y)}`
    const fieldOptions = {
      x,
      y,
      width,
      height,
      borderWidth: 1,
      borderColor: rgb(0.45, 0.45, 0.55),
      backgroundColor: rgb(1, 1, 1),
      textColor: rgb(0.05, 0.05, 0.08),
    }

    if (spec.label) {
      page.drawText(spec.label, { x, y: y + height + 4, size: 9, font, color: rgb(0.2, 0.2, 0.25) })
    }

    if (spec.type === 'text' || spec.type === 'signature') {
      const text = form.createTextField(name)
      text.setText(spec.type === 'signature' ? 'Sign here' : '')
      if (spec.type === 'signature') text.enableReadOnly()
      text.addToPage(page, fieldOptions)
    } else if (spec.type === 'checkbox') {
      form.createCheckBox(name).addToPage(page, fieldOptions)
    } else if (spec.type === 'dropdown') {
      const dropdown = form.createDropdown(name)
      const options = spec.options?.filter(Boolean).length ? spec.options!.filter(Boolean) : ['Option 1', 'Option 2']
      dropdown.addOptions(options)
      dropdown.select(options[0])
      dropdown.addToPage(page, fieldOptions)
    } else if (spec.type === 'radio') {
      const radio = form.createRadioGroup(name)
      const options = spec.options?.filter(Boolean).length ? spec.options!.filter(Boolean) : ['Yes', 'No']
      const buttonSize = Math.min(height, 16)
      options.slice(0, 4).forEach((option, index) => {
        radio.addOptionToPage(option, page, {
          x: x + index * Math.max(72, width / options.length),
          y,
          width: buttonSize,
          height: buttonSize,
          borderWidth: 1,
          borderColor: rgb(0.45, 0.45, 0.55),
          backgroundColor: rgb(1, 1, 1),
        })
        page.drawText(option, { x: x + index * Math.max(72, width / options.length) + buttonSize + 4, y: y + 3, size: 9, font, color: rgb(0.2, 0.2, 0.25) })
      })
    }
  }

  form.updateFieldAppearances(font)
  return doc.save()
}

export async function addLinkToPDF(
  file: File,
  link: { pageIndex: number; x: number; y: number; width: number; height: number; url: string; label?: string }
): Promise<Uint8Array> {
  if (!/^https?:\/\//i.test(link.url)) throw new Error('Enter a valid http or https URL')
  if (link.width <= 0 || link.height <= 0) throw new Error('Enter a valid link area')

  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const page = doc.getPage(link.pageIndex)
  const box = visualBoxToPdfBox(page, link)
  const { x, y, width, height: linkHeight } = box

  if (link.label?.trim()) {
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText(link.label.trim(), { x, y: y + Math.max(2, (linkHeight - 10) / 2), size: 10, font, color: rgb(0.05, 0.25, 0.75) })
    page.drawLine({ start: { x, y: y + 2 }, end: { x: x + width, y: y + 2 }, thickness: 0.75, color: rgb(0.05, 0.25, 0.75) })
  }

  const annotation = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x, y, x + width, y + linkHeight],
    Border: [0, 0, 0],
    C: [],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(link.url) },
  })
  const annotationRef = doc.context.register(annotation)

  // Safely get or create the Annots array and append the new annotation
  const existingAnnots = page.node.Annots()
  if (existingAnnots instanceof PDFArray) {
    existingAnnots.push(annotationRef)
  } else {
    const newAnnots = doc.context.obj([annotationRef]) as PDFArray
    page.node.set(PDFName.of('Annots'), newAnnots)
  }

  return doc.save()
}

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '').trim()
  const value = /^[0-9a-fA-F]{6}$/.test(clean) ? clean : '111111'
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  }
}

export async function flattenPDF(file: File): Promise<Uint8Array> {
  const doc = await loadPdfDocument(file, 'flatten')
  const form = doc.getForm()
  try { form.flatten() } catch (_) { /* no form fields */ }
  return doc.save()
}

// ── IMAGE TO PDF ──────────────────────────────────────────────────────────────
export async function imagesToPDF(
  files: File[],
  pageSize: 'A4' | 'Letter' | 'fit',
  orientation: 'portrait' | 'landscape'
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()

  for (const file of files) {
    const bytes = await readFileAsArrayBuffer(file)
    const isJpeg = file.type === 'image/jpeg' || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')
    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
    const imageBytes = isJpeg || isPng ? bytes : await rasterizeImage(file)
    const img = isJpeg ? await doc.embedJpg(imageBytes) : await doc.embedPng(imageBytes)

    let pw = img.width, ph = img.height

    if (pageSize !== 'fit') {
      const [w, h] = pageSize === 'A4' ? PageSizes.A4 : PageSizes.Letter
      pw = orientation === 'portrait' ? w : h
      ph = orientation === 'portrait' ? h : w
    }

    const page = doc.addPage([pw, ph])
    const scale = Math.min(pw / img.width, ph / img.height)
    const iw = img.width * scale, ih = img.height * scale
    page.drawImage(img, { x: (pw - iw) / 2, y: (ph - ih) / 2, width: iw, height: ih })
  }
  return doc.save()
}

async function rasterizeImage(file: File): Promise<ArrayBuffer> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not prepare image canvas')
    ctx.drawImage(image, 0, 0)

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not convert image to PNG')
    return await blob.arrayBuffer()
  } catch (_) {
    throw new Error(`Unsupported image format: ${file.name}`)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── PROTECT ───────────────────────────────────────────────────────────────────
export async function protectPDF(file: File, userPassword: string, _ownerPassword: string): Promise<Uint8Array> {
  void file
  void userPassword
  throw new Error('Password encryption is not available in this browser build. Use a PDF engine with real encryption support instead.')
}

// ── SIGN ──────────────────────────────────────────────────────────────────────
export async function embedSignature(file: File, signatureDataUrl: string, pageIndex: number, x: number, y: number, width: number, height: number): Promise<Uint8Array> {
  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })

  // Convert dataURL to bytes
  const base64 = signatureDataUrl.split(',')[1]
  const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const img = await doc.embedPng(imgBytes)

  const page = doc.getPage(pageIndex)
  const box = visualBoxToPdfBox(page, { x, y, width, height })
  page.drawImage(img, box)
  return doc.save()
}

// ── UNLOCK PDF ────────────────────────────────────────────────────────────────
export async function unlockPDF(file: File, _password: string): Promise<Uint8Array> {
  void file
  void _password
  throw new Error('Password-protected PDFs cannot be decrypted in this browser build.')
}

// ── REPAIR PDF ────────────────────────────────────────────────────────────────
export async function repairPDF(file: File): Promise<Uint8Array> {
  try {
    const doc = await loadPdfDocument(file, 'repair')
    return doc.save({ useObjectStreams: false })
  } catch (error: any) {
    const message = String(error?.message || error || '')
    if (/password-protected|restricted/i.test(message)) throw error
    throw new Error(`"${file.name}" is too damaged for the browser repair tool. Try opening and re-saving it in Adobe Acrobat or another PDF application.`)
  }
}

// ── REDACT ────────────────────────────────────────────────────────────────────
export async function redactPDF(file: File, redactions: { pageIndex: number; x: number; y: number; width: number; height: number }[]): Promise<Uint8Array> {
  const bytes = await readFileAsArrayBuffer(file)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })

  for (const r of redactions) {
    const page = doc.getPage(r.pageIndex)
    const box = visualBoxToPdfBox(page, r)
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      color: rgb(0, 0, 0),
      opacity: 1,
    })
  }
  return doc.save()
}
