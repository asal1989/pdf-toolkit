import mammoth from 'mammoth'
import { Workbook } from 'exceljs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import {
  Document, Paragraph, TextRun, HeadingLevel, Packer, AlignmentType, PageBreak,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx'
import { readFileAsArrayBuffer } from './pdf-engine'
import { extractTextFromPDF, pdfToImages } from './pdf-render'

async function getTesseract() {
  try {
    const mod = await import('tesseract.js')
    return mod.default ?? mod
  } catch (_) {
    throw new Error('OCR engine could not be loaded. Please refresh the app and try again.')
  }
}

// ── Structured OCR types ──────────────────────────────────────────────────────
interface OcrWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}
interface OcrLine {
  words: OcrWord[]
  yMid: number
  text: string   // cleaned joined text
  xMin: number
  xMax: number
}
interface OcrPage {
  lines: OcrLine[]
  imageWidth: number
}

// ── LAYOUT-AWARE OCR: returns structured lines + flat text ────────────────────
async function ocrPageWithLayout(imageUrl: string, language: string): Promise<OcrPage> {
  const Tesseract = await getTesseract()
  const result = await Tesseract.recognize(imageUrl, language, { logger: () => {} })

  // Filter out noise: purely non-alphanumeric tokens (table borders like |, [, ], ___)
  // Do NOT filter by confidence — scanned docs can have legitimately low confidence
  // scores on real text, especially for complex fonts or degraded scans.
  const allWords: OcrWord[] = (((result.data as any).words || []) as any[])
    .filter((w: any) => {
      const t = (w.text || '').trim()
      if (!t) return false
      if (/^[|[\]_\-—=~]+$/.test(t)) return false   // pure table-border chars
      return true
    })
    .map((w: any) => ({
      text: (w.text as string).trim(),
      confidence: w.confidence as number ?? 0,
      bbox: w.bbox as OcrWord['bbox'],
    }))

  // Approximate page width from rightmost word edge (use ALL words before any confidence pruning)
  const imageWidth = allWords.length
    ? Math.max(...allWords.map(w => w.bbox.x1))
    : 2480  // A4 at 300dpi fallback

  // Only remove truly zero-confidence words (Tesseract returns 0 for unrecognised glyphs)
  const words = allWords.filter(w => w.confidence > 0)

  if (!words.length) {
    // Last resort: return raw Tesseract text as a single line so the doc is never blank
    const raw = (result.data.text || '').trim()
    if (raw) {
      return {
        lines: [{ words: [], yMid: 0, text: raw, xMin: 0, xMax: imageWidth }],
        imageWidth,
      }
    }
    return { lines: [], imageWidth }
  }

  // Cluster into visual lines by y-midpoint (10px tolerance)
  const LINE_TOL = 10
  const lineMap = new Map<number, OcrWord[]>()
  for (const word of words) {
    const midY = (word.bbox.y0 + word.bbox.y1) / 2
    let matchKey = -1
    for (const k of lineMap.keys()) {
      if (Math.abs(midY - k) <= LINE_TOL) { matchKey = k; break }
    }
    if (matchKey === -1) lineMap.set(midY, [word])
    else lineMap.get(matchKey)!.push(word)
  }

  const lines: OcrLine[] = [...lineMap.entries()]
    .sort(([ya], [yb]) => ya - yb)
    .map(([yMid, lw]) => {
      lw.sort((a, b) => a.bbox.x0 - b.bbox.x0)
      const text = lw.map((w, i) => {
        if (i === 0) return w.text
        const gap = w.bbox.x0 - lw[i - 1].bbox.x1
        return (gap > 30 ? '   ' : gap > 10 ? ' ' : '') + w.text
      }).join('')
        .replace(/\|/g, ' ').replace(/\[(?!\d)/g, '').replace(/(?<!\d)\]/g, '')
        .replace(/_{3,}/g, '').replace(/\s{3,}/g, '   ').trim()
      return {
        words: lw,
        yMid,
        text,
        xMin: lw[0].bbox.x0,
        xMax: lw[lw.length - 1].bbox.x1,
      }
    })
    .filter(line => !!line.text)  // only drop fully empty lines

  return { lines, imageWidth }
}

// ── TABLE DETECTION: find column boundaries from word bboxes ─────────────────

/** Returns x-coordinates of column dividers (sorted), or [] if not a table */
function detectColBoundaries(tableLines: OcrLine[], imageWidth: number): number[] {
  const GAP_MIN = imageWidth * 0.018   // min gap to be a column separator
  const CLUSTER_TOL = imageWidth * 0.04

  // Collect midpoints of all significant inter-word gaps
  const gapMids: number[] = []
  for (const line of tableLines) {
    const ws = line.words
    for (let i = 1; i < ws.length; i++) {
      const gap = ws[i].bbox.x0 - ws[i - 1].bbox.x1
      if (gap > GAP_MIN) gapMids.push(ws[i - 1].bbox.x1 + gap / 2)
    }
  }
  if (!gapMids.length) return []

  // Cluster nearby gap midpoints
  gapMids.sort((a, b) => a - b)
  const clusters: number[][] = []
  for (const gm of gapMids) {
    let added = false
    for (const cl of clusters) {
      const avg = cl.reduce((s, v) => s + v, 0) / cl.length
      if (Math.abs(gm - avg) < CLUSTER_TOL) { cl.push(gm); added = true; break }
    }
    if (!added) clusters.push([gm])
  }

  // Keep boundaries that appear in at least 25% of rows (consistent columns)
  const minAppearances = Math.max(2, Math.ceil(tableLines.length * 0.25))
  return clusters
    .filter(cl => cl.length >= minAppearances)
    .map(cl => cl.reduce((s, v) => s + v, 0) / cl.length)
    .sort((a, b) => a - b)
}

/** Assign words of a line to columns defined by boundaries */
function splitIntoCells(line: OcrLine, colBoundaries: number[]): string[] {
  const cells: string[] = Array(colBoundaries.length + 1).fill('')
  for (const word of line.words) {
    const mid = (word.bbox.x0 + word.bbox.x1) / 2
    let col = colBoundaries.findIndex(b => mid < b)
    if (col === -1) col = colBoundaries.length
    cells[col] = (cells[col] ? cells[col] + ' ' : '') + word.text
  }
  return cells.map(c => c.trim())
}

/** Build a docx Table from detected table lines */
function buildDocxTable(
  tableLines: OcrLine[],
  colBoundaries: number[],
  imageWidth: number
): Table {
  const numCols = colBoundaries.length + 1

  // Column widths in percent
  const boundaries = [0, ...colBoundaries, imageWidth]
  const colPct = boundaries.slice(1).map((b, i) =>
    Math.max(3, Math.round(((b - boundaries[i]) / imageWidth) * 100))
  )
  // Normalise to exactly 100%
  const pctSum = colPct.reduce((s, v) => s + v, 0)
  const normPct = colPct.map(p => Math.round((p / pctSum) * 100))

  const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
  const INNER  = { style: BorderStyle.SINGLE, size: 2, color: '888888' }

  const tblRows = tableLines.map((line, rowIdx) => {
    const cells = splitIntoCells(line, colBoundaries)
    const isHdr  = rowIdx === 0 && isTableHeader(line.text)
    const isTot  = isTotalRow(line.text)
    const fill   = isHdr ? 'D6D9FF' : isTot ? 'D4F4E0' : undefined

    return new TableRow({
      tableHeader: isHdr,
      children: cells.map((cellText, ci) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({
                text: cellText,
                bold: isHdr || isTot,
                size: 16,
                font: 'Courier New',
              })],
              spacing: { before: 40, after: 40 },
            }),
          ],
          width: { size: normPct[ci] ?? Math.round(100 / numCols), type: WidthType.PERCENTAGE },
          ...(fill ? { shading: { type: 'clear', fill } } : {}),
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          borders: {
            top: BORDER, bottom: BORDER, left: BORDER, right: BORDER,
          },
        })
      ),
    })
  })

  return new Table({
    rows: tblRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER, bottom: BORDER, left: BORDER, right: BORDER,
      insideHorizontal: INNER, insideVertical: INNER,
    },
  })
}

// ── AUTO-DETECT SCANNED PDF AND RUN OCR IF NEEDED ────────────────────────────
export async function extractTextSmart(
  file: File,
  language = 'eng',
  onProgress?: (msg: string, pct: number) => void
): Promise<{ text: string; wasScanned: boolean; ocrPages?: OcrPage[] }> {
  onProgress?.('Extracting text…', 10)

  // 1. Try regular text extraction first
  const extracted = await extractTextFromPDF(file)
  const cleanText = extracted.replace(/--- Page \d+ ---/g, '').replace(/\s+/g, ' ').trim()

  // 2. If meaningful text found, return it directly
  if (cleanText.length > 80) {
    onProgress?.('Text extracted successfully', 90)
    return { text: extracted, wasScanned: false }
  }

  // 3. Scanned PDF detected — render pages at 3x for sharper OCR input
  onProgress?.('Scanned PDF detected — running OCR…', 15)
  const images = await pdfToImages(file, 'jpeg', 3, (pct, page, total) => {
    onProgress?.(`Rendering page ${page} of ${total}...`, 15 + Math.round(pct * 0.15))
  })
  const total = images.length
  const texts: string[] = []
  const ocrPages: OcrPage[] = []

  for (let i = 0; i < total; i++) {
    const pct = 15 + Math.round(((i + 1) / total) * 70)
    onProgress?.(`OCR page ${i + 1} of ${total}…`, pct)
    try {
      const ocrPage = await ocrPageWithLayout(images[i].url, language)
      ocrPages.push(ocrPage)
      texts.push(`--- Page ${i + 1} ---\n${ocrPage.lines.map(l => l.text).join('\n')}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`OCR failed on page ${i + 1}: ${message}`)
    }
  }

  onProgress?.('OCR complete', 90)
  return { text: texts.join('\n\n'), wasScanned: true, ocrPages }
}

// ── Helpers for DOCX paragraph classification ─────────────────────────────────

/** True if the line looks like a financial data row (amounts, percentages, numbers) */
function isFinancialDataRow(s: string): boolean {
  // Exclude pure dates like "Date - 06-01-2026"
  if (/\b\d{2}[\-\/]\d{2}[\-\/]\d{2,4}\b/.test(s) && (s.match(/\b[\d,]+\.?\d*%?\b/g) || []).length < 4) return false
  const numericTokens = (s.match(/\b[\d,]+\.?\d*%?\b/g) || []).length
  const wordCount = s.split(/\s+/).filter(Boolean).length
  return numericTokens >= 2 && wordCount >= 3 && numericTokens / wordCount >= 0.28
}

/** True if the line is a totals/summary row */
function isTotalRow(s: string): boolean {
  return /\b(total|grand total|sub.?total|balance due)\b/i.test(s) &&
    /[\d,]+\.?\d*/.test(s)
}

/** True if line is a column HEADER row (needs ≥2 table-specific keywords) */
function isTableHeader(s: string): boolean {
  const lower = s.toLowerCase().replace(/\s+/g, ' ')
  // Use simple includes() — more reliable than \b regex for abbreviations like "Sr.", "HSN/SAC"
  // 'sr. no' covers both "Sr.No" and "Sr. No." OCR variants
  const keywords = ['sr. no', 'sr.no', 'hsn', 'sac', 'uom', 'qty', 'cgst', 'sgst']
  const matches = keywords.filter(k => lower.includes(k))
  return matches.length >= 2
}

// ── PDF → WORD (.docx) ────────────────────────────────────────────────────────

/** Convert a single OcrPage into a mix of Paragraphs and Tables */
function ocrPageToDocxBlocks(page: OcrPage): Array<Paragraph | Table> {
  const { lines, imageWidth } = page
  const blocks: Array<Paragraph | Table> = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // ── Detect the start of a table block ──
    // A line is "table-like" if it has >= 2 significant gaps AND spans >= 35% of page width
    const GAP_MIN = imageWidth * 0.018
    const significantGaps = ((): number => {
      let cnt = 0
      for (let j = 1; j < line.words.length; j++) {
        if (line.words[j].bbox.x0 - line.words[j - 1].bbox.x1 > GAP_MIN) cnt++
      }
      return cnt
    })()
    const spanPct = imageWidth > 0 ? (line.xMax - line.xMin) / imageWidth : 0
    const isTableLike = significantGaps >= 2 && spanPct >= 0.35

    if (isTableLike) {
      // Collect consecutive table-like lines into one block
      const tableLines: OcrLine[] = [line]
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        const nextGaps = ((): number => {
          let cnt = 0
          for (let k = 1; k < next.words.length; k++) {
            if (next.words[k].bbox.x0 - next.words[k - 1].bbox.x1 > GAP_MIN) cnt++
          }
          return cnt
        })()
        const nextSpan = imageWidth > 0 ? (next.xMax - next.xMin) / imageWidth : 0
        // Continue table if line is table-like OR is a short row that fits within same x range
        if (nextGaps >= 1 && nextSpan >= 0.2) {
          tableLines.push(next)
          j++
        } else {
          break
        }
      }
      i = j

      if (tableLines.length >= 2) {
        // Detect columns and build real table
        const colBoundaries = detectColBoundaries(tableLines, imageWidth)
        if (colBoundaries.length >= 1) {
          blocks.push(buildDocxTable(tableLines, colBoundaries, imageWidth))
          blocks.push(new Paragraph({ text: '', spacing: { after: 80 } }))
          continue
        }
      }
      // Fall through: not enough structure to make a table — render as monospace
      for (const tl of tableLines) {
        blocks.push(lineToMonoParagraph(tl.text, isTotalRow(tl.text)))
      }
      continue
    }

    // ── Non-table line → paragraph classification ──
    blocks.push(lineToParagraph(line.text))
    i++
  }

  return blocks
}

/** Classify a plain text line and return the right Paragraph type */
function lineToParagraph(trimmed: string): Paragraph {
  // Table header (even outside a table block, bold it)
  if (isTableHeader(trimmed)) {
    return new Paragraph({
      children: [new TextRun({ text: trimmed, bold: true, size: 20, font: 'Courier New' })],
      spacing: { before: 80, after: 40 },
      shading: { type: 'clear', fill: 'EEF0FF' },
    })
  }
  // Financial data row
  if (isFinancialDataRow(trimmed)) {
    return lineToMonoParagraph(trimmed, isTotalRow(trimmed))
  }
  // Heading (all-caps, short)
  const hasLetters = /[A-Z]/.test(trimmed)
  const isAllCaps = hasLetters && trimmed === trimmed.toUpperCase()
  if (isAllCaps && trimmed.length >= 3 && trimmed.length <= 60 &&
      !trimmed.match(/^\d/) && !/\.\d/.test(trimmed) &&
      (trimmed.match(/,/g) || []).length <= 1) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: trimmed, bold: true, size: 26 })],
      spacing: { before: 240, after: 80 },
    })
  }
  // Label: value  ("Company Name - Godrej..." / "GSTIN: 27AAA...")
  const labelMatch = trimmed.match(/^([A-Z][A-Za-z .#\/]{1,30}[\-:]\s*)(.*)$/)
  if (labelMatch && trimmed.length < 120 && !isFinancialDataRow(trimmed)) {
    return new Paragraph({
      children: [
        new TextRun({ text: labelMatch[1], bold: true, size: 22 }),
        new TextRun({ text: labelMatch[2], size: 22 }),
      ],
      spacing: { after: 50 },
    })
  }
  // Regular
  return new Paragraph({
    children: [new TextRun({ text: trimmed, size: 22 })],
    spacing: { after: 60 },
    alignment: AlignmentType.LEFT,
  })
}

function lineToMonoParagraph(text: string, isTotals: boolean): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, font: 'Courier New', bold: isTotals })],
    spacing: { after: 30 },
    ...(isTotals ? { shading: { type: 'clear', fill: 'D4F4E0' } } : {}),
  })
}

export async function pdfToWordDocx(
  file: File,
  language = 'eng',
  onProgress?: (msg: string, pct: number) => void
): Promise<Uint8Array> {
  const { text, wasScanned, ocrPages } = await extractTextSmart(file, language, onProgress)
  onProgress?.(`Building Word document${wasScanned ? ' from OCR' : ''}…`, 92)

  let docChildren: Array<Paragraph | Table> = []

  if (wasScanned && ocrPages && ocrPages.length > 0) {
    // ── Scanned PDF: use structured OCR data → proper tables ──
    for (let p = 0; p < ocrPages.length; p++) {
      if (p > 0) docChildren.push(new Paragraph({ children: [new PageBreak()] }))
      docChildren.push(...ocrPageToDocxBlocks(ocrPages[p]))
    }
    // Safety fallback: if structured OCR produced nothing, use raw text strings
    if (docChildren.length === 0) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || /^--- Page \d+ ---$/.test(trimmed)) continue
        docChildren.push(lineToParagraph(trimmed))
      }
    }
  } else {
    // ── Native text PDF: line-by-line paragraph classification ──
    let firstPage = true
    let consecutiveBlanks = 0
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (/^--- Page \d+ ---$/.test(trimmed)) {
        if (!firstPage && docChildren.length > 0)
          docChildren.push(new Paragraph({ children: [new PageBreak()] }))
        firstPage = false
        consecutiveBlanks = 0
        continue
      }
      if (!trimmed) {
        if (++consecutiveBlanks <= 1 && docChildren.length > 0)
          docChildren.push(new Paragraph({ text: '', spacing: { after: 40 } }))
        continue
      }
      consecutiveBlanks = 0
      docChildren.push(lineToParagraph(trimmed))
    }
  }

  const doc = new Document({
    creator: 'BCIM PDF Toolkit',
    title: file.name.replace(/\.pdf$/i, ''),
    description: `Converted from ${file.name}${wasScanned ? ' (via OCR)' : ''}`,
    sections: [{
      properties: {},
      children: docChildren.length
        ? docChildren
        : [new Paragraph({ text: '(No selectable text found in this PDF.)' })],
    }],
  })

  const blob = await Packer.toBlob(doc)
  onProgress?.('Done!', 100)
  return new Uint8Array(await blob.arrayBuffer())
}

// ── PDF → EXCEL (.xlsx) ───────────────────────────────────────────────────────
export async function pdfToExcelXlsx(
  file: File,
  language = 'eng',
  onProgress?: (msg: string, pct: number) => void
): Promise<Uint8Array> {
  const { text, wasScanned } = await extractTextSmart(file, language, onProgress)

  onProgress?.(`Building Excel sheet${wasScanned ? ' from OCR' : ''}…`, 92)

  const workbook = new Workbook()
  workbook.creator = 'BCIM PDF Toolkit'

  const pages = text.split(/--- Page \d+ ---/).filter(p => p.trim())

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx]
    const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean)
    const rows: string[][] = []

    for (const line of lines) {
      // Detect columns by tabs, multiple spaces, or pipe delimiters
      let cols: string[]
      if (line.includes('\t')) {
        cols = line.split('\t').map(c => c.trim())
      } else if (/\s{2,}/.test(line)) {
        cols = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean)
      } else if (line.includes('|')) {
        cols = line.split('|').map(c => c.trim()).filter(Boolean)
      } else {
        cols = [line]
      }
      if (cols.length > 0) rows.push(cols)
    }

    if (rows.length === 0) continue

    const worksheet = workbook.addWorksheet(`Page ${pageIdx + 1}`)
    rows.forEach(row => worksheet.addRow(row))

    // Auto-width columns (cap at 50 chars)
    const colWidths = rows.reduce((widths: number[], row) => {
      row.forEach((cell, i) => { widths[i] = Math.max(widths[i] || 10, cell.length + 2) })
      return widths
    }, [])
    colWidths.forEach((w, i) => { worksheet.getColumn(i + 1).width = Math.min(w, 50) })
  }

  // Fallback: single sheet with all lines if no pages were parsed
  if (workbook.worksheets.length === 0) {
    const worksheet = workbook.addWorksheet('Content')
    text.split('\n').filter(l => l.trim()).forEach(l => worksheet.addRow([l.trim()]))
  }

  const buffer = await workbook.xlsx.writeBuffer()
  onProgress?.('Done!', 100)
  return new Uint8Array(buffer as ArrayBuffer)
}

// ── DOCX → PDF ────────────────────────────────────────────────────────────────
export async function docxToPDF(file: File): Promise<Uint8Array> {
  if (!/\.docx$/i.test(file.name)) {
    throw new Error(`"${file.name}" is not supported. Word to PDF supports only .docx files. Open the file in Word and save it as .docx.`)
  }

  let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>
  try {
    const arrayBuffer = await readFileAsArrayBuffer(file)
    result = await mammoth.convertToHtml({
      arrayBuffer,
    }, {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
      ],
    })
  } catch (_) {
    throw new Error(`"${file.name}" could not be read as a valid DOCX file. Open it in Word and save it again as .docx, then retry.`)
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: Cambria, 'Times New Roman', serif; font-size: 12pt; line-height: 1.45;
           margin: 0; padding: 54px 62px; color: #111; background: white; width: 820px; }
    h1 { font-size: 22pt; font-weight: bold; margin: 0 0 12px; line-height: 1.18; }
    h2 { font-size: 17pt; font-weight: bold; margin: 16px 0 8px; line-height: 1.25; }
    h3 { font-size: 14pt; font-weight: bold; margin: 14px 0 6px; line-height: 1.3; }
    p  { margin: 0 0 9px; }
    strong, b { font-weight: 700; }
    em, i { font-style: italic; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { border: 1px solid #ccc; padding: 6px 10px; font-size: 10pt; vertical-align: top; }
    th { background: #f0f0f0; font-weight: bold; }
    ul, ol { margin: 8px 0 8px 24px; }
    li { margin: 3px 0; }
    img { max-width: 100%; height: auto; }
  </style></head><body>${result.value}</body></html>`

  return await htmlToPDFBytes(html, { scale: 3, imageFormat: 'png' })
}

// ── XLSX → PDF ────────────────────────────────────────────────────────────────
export async function xlsxToPDF(file: File): Promise<Uint8Array> {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error(`"${file.name}" is not supported. Excel to PDF supports only .xlsx files. Open the file in Excel and save it as .xlsx.`)
  }

  const workbook = new Workbook()
  try {
    const arrayBuffer = await readFileAsArrayBuffer(file)
    await workbook.xlsx.load(arrayBuffer)
  } catch (_) {
    throw new Error(`"${file.name}" could not be read as a valid XLSX file. Open it in Excel and save it again as .xlsx, then retry.`)
  }

  let allHtml = ''
  for (const worksheet of workbook.worksheets) {
    let tableHtml = '<table>'
    worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
      tableHtml += '<tr>'
      row.eachCell({ includeEmpty: true }, cell => {
        const tag = rowNum === 1 ? 'th' : 'td'
        // Resolve rich-text objects and formula results to a plain string
        let val = ''
        if (cell.value === null || cell.value === undefined) {
          val = ''
        } else if (typeof cell.value === 'object' && 'richText' in (cell.value as any)) {
          val = (cell.value as any).richText.map((r: any) => r.text ?? '').join('')
        } else if (typeof cell.value === 'object' && 'result' in (cell.value as any)) {
          val = String((cell.value as any).result ?? '')
        } else {
          val = String(cell.value)
        }
        tableHtml += `<${tag}>${val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</${tag}>`
      })
      tableHtml += '</tr>'
    })
    tableHtml += '</table>'
    allHtml += `<h2 style="margin:20px 0 8px;font-size:14pt;color:#333;border-bottom:2px solid #6c63ff;padding-bottom:6px;">Sheet: ${worksheet.name}</h2>${tableHtml}`
  }

  if (!allHtml) allHtml = '<p style="color:#888">This spreadsheet appears to be empty.</p>'

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; font-size: 10pt; margin: 0; padding: 30px; background: white; color: #111; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 20px; font-size: 9pt; }
    td, th { border: 1px solid #ccc; padding: 4px 8px; white-space: nowrap; }
    tr:nth-child(even) { background: #f9f9f9; }
    tr:first-child td, tr:first-child th { background: #e8e4ff; font-weight: bold; }
  </style></head><body>${allHtml}</body></html>`

  return await htmlToPDFBytes(html, { scale: 2, imageFormat: 'jpeg', imageQuality: 0.98 })
}

// ── HTML → PDF (shared helper) ────────────────────────────────────────────────
async function htmlToPDFBytes(
  html: string,
  options: { scale?: number; imageFormat?: 'jpeg' | 'png'; imageQuality?: number } = {}
): Promise<Uint8Array> {
  const renderScale = options.scale ?? 2
  const imageFormat = options.imageFormat ?? 'jpeg'
  const imageQuality = options.imageQuality ?? 0.98
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:1px;border:none;background:white;'
  document.body.appendChild(iframe)
  try {
    const doc = iframe.contentDocument!
    doc.open(); doc.write(html); doc.close()
    await new Promise(r => setTimeout(r, 700))

    const body = iframe.contentDocument!.body
    const totalHeight = Math.max(body.scrollHeight, 200)

    const canvas = await html2canvas(body, {
      scale: renderScale, useCORS: true, backgroundColor: '#ffffff',
      width: 820, height: totalHeight, scrollY: 0,
      windowWidth: 820, windowHeight: totalHeight,
    })

    const A4_W = 595, A4_H = 842
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = canvas.width
    const sourcePageHeight = Math.floor(canvas.width * (A4_H / A4_W))
    const pages = Math.ceil(canvas.height / sourcePageHeight)

    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage()
      const sy = i * sourcePageHeight
      const sliceHeight = Math.min(sourcePageHeight, canvas.height - sy)
      pageCanvas.height = sliceHeight
      const pageCtx = pageCanvas.getContext('2d')
      if (!pageCtx) throw new Error('Could not prepare PDF page canvas')
      pageCtx.fillStyle = '#ffffff'
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      pageCtx.drawImage(canvas, 0, sy, canvas.width, sliceHeight, 0, 0, pageCanvas.width, sliceHeight)
      const imgData = imageFormat === 'png'
        ? pageCanvas.toDataURL('image/png')
        : pageCanvas.toDataURL('image/jpeg', imageQuality)
      const pageHeight = sliceHeight * (A4_W / canvas.width)
      pdf.addImage(imgData, imageFormat.toUpperCase(), 0, 0, A4_W, pageHeight)
    }

    return new Uint8Array(pdf.output('arraybuffer'))
  } catch (error: any) {
    const message = String(error?.message || error || '')
    if (/tainted|cors|cross-origin/i.test(message)) {
      throw new Error('This HTML could not be rendered because it uses blocked external images or styles. Save the page with local assets and try again.')
    }
    throw new Error('This HTML could not be rendered as a PDF. Check that the file is valid HTML and try again.')
  } finally {
    document.body.removeChild(iframe)
  }
}

// ── HTML file → PDF ───────────────────────────────────────────────────────────
export async function htmlFileToPDF(file: File): Promise<Uint8Array> {
  if (!/\.(html?|xhtml)$/i.test(file.name)) {
    throw new Error(`"${file.name}" is not supported. HTML to PDF supports .html and .htm files.`)
  }
  const html = await file.text()
  if (!html.trim()) throw new Error(`"${file.name}" is empty. Choose an HTML file with visible content.`)
  return await htmlToPDFBytes(html, { scale: 2, imageFormat: 'jpeg', imageQuality: 0.98 })
}

// ── OCR full pipeline ─────────────────────────────────────────────────────────
export async function ocrPDF(
  file: File,
  language: string,
  onProgress: (pct: number, page: number, total: number) => void
): Promise<string> {
  try {
    const Tesseract = await getTesseract()
    const images = await pdfToImages(file, 'jpeg', 2.5, (pct, pg, total) => {
      onProgress(Math.round(pct * 0.2), pg, total)
    })
    const total = images.length
    const texts: string[] = []

    for (let i = 0; i < total; i++) {
      onProgress(Math.round((i / total) * 90), i + 1, total)
      const result = await Tesseract.recognize(images[i].url, language, { logger: () => {} })
      texts.push(`--- Page ${i + 1} ---\n${result.data.text.trim()}`)
    }
    onProgress(100, total, total)
    return texts.join('\n\n')
  } catch (error: any) {
    const message = String(error?.message || error || '')
    if (/password|encrypted/i.test(message)) throw new Error('This PDF is password-protected. Remove the password before running OCR.')
    throw new Error('OCR could not read this PDF. Try a clearer scanned PDF, English language, or Repair PDF first.')
  }
}

export async function ocrSearchablePDF(
  file: File,
  language: string,
  onProgress: (pct: number, page: number, total: number) => void
): Promise<Uint8Array> {
  try {
    const Tesseract = await getTesseract()
    const images = await pdfToImages(file, 'jpeg', 2.5, (pct, pg, total) => {
      onProgress(Math.round(pct * 0.2), pg, total)
    })
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const total = images.length

    for (let i = 0; i < total; i++) {
      onProgress(Math.round((i / total) * 90), i + 1, total)
      const imageBytes = dataUrlToBytes(images[i].url)
      const image = await doc.embedJpg(imageBytes)
      const page = doc.addPage([image.width, image.height])
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })

      const result = await Tesseract.recognize(images[i].url, language, { logger: () => {} })
      const lines = result.data.text.split('\n').map((line: string) => line.trim()).filter(Boolean)
      const lineHeight = Math.max(10, Math.min(16, image.height / Math.max(40, lines.length + 8)))
      let y = image.height - lineHeight * 2
      for (const line of lines) {
        page.drawText(line.slice(0, 180), {
          x: 18,
          y,
          size: lineHeight,
          font,
          color: rgb(1, 1, 1),
          opacity: 0.01,
        })
        y -= lineHeight * 1.25
        if (y < 18) break
      }
    }

    onProgress(100, total, total)
    return doc.save()
  } catch (error: any) {
    const message = String(error?.message || error || '')
    if (/password|encrypted/i.test(message)) throw new Error('This PDF is password-protected. Remove the password before running OCR.')
    throw new Error('OCR could not create a searchable PDF. Try a clearer scanned PDF, English language, or Repair PDF first.')
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  if (!base64) throw new Error('Invalid image data')
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}
