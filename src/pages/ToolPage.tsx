import { useState, useRef, useCallback, useEffect } from 'react'
import type { Tool } from '../data/tools'
import {
  ArrowLeft, Upload, X, FileText, Download,
  CheckCircle2, Loader2, AlertCircle, ImageIcon, Settings2, GripVertical
} from 'lucide-react'
import PageSelector from '../components/PageSelector'
import {
  mergePDFs, splitPDF, removePages, extractPages, rotatePDF,
  reorderPages, compressPDF, addWatermark, addPageNumbers,
  addHeaderFooter, flattenPDF, imagesToPDF, repairPDF,
  embedSignature, downloadZip, applyPDFEdits, cropPDF,
  addFormFieldsToPDF, addLinkToPDF
} from '../lib/pdf-engine'
import {
  comparePDFText, pdfToImages, downloadDataUrl, renderPageToDataUrl,
  redactPDFRasterized, compressPDFRasterized, protectPDFRasterized,
  cropPDFRasterized, getPageCount, applyPDFEditsRasterized
} from '../lib/pdf-render'
import {
  docxToPDF, xlsxToPDF, htmlFileToPDF, ocrPDF, ocrSearchablePDF,
  pdfToWordDocx, pdfToExcelXlsx, extractTextSmart
} from '../lib/pdf-convert'

interface Props { tool: Tool; onBack: () => void; initialFiles?: File[] }
type Stage = 'upload' | 'configure' | 'processing' | 'done' | 'error'

type ResultFile = {
  name: string
  data?: Uint8Array
  url?: string
  text?: string
  mime?: string
}

function parsePageNumbers(input: string, total: number): number[] {
  const pages = new Set<number>()
  for (const rawPart of input.split(',')) {
    const part = rawPart.trim()
    if (!part) continue

    if (part.includes('-')) {
      const [startRaw, endRaw] = part.split('-').map(value => parseInt(value.trim(), 10))
      if (Number.isNaN(startRaw) || Number.isNaN(endRaw)) continue
      const start = Math.max(1, Math.min(total, startRaw))
      const end = Math.max(1, Math.min(total, endRaw))
      const step = start <= end ? 1 : -1
      for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
        pages.add(page - 1)
      }
      continue
    }

    const page = parseInt(part, 10)
    if (!Number.isNaN(page) && page >= 1 && page <= total) pages.add(page - 1)
  }
  return [...pages].sort((a, b) => a - b)
}

const BATCH_CONVERT_TO_PDF_TOOLS = ['word-to-pdf', 'excel-to-pdf', 'html-to-pdf']
const MULTI_FILE_TOOLS = ['merge', 'image-to-pdf', 'compare', 'compress', 'split', ...BATCH_CONVERT_TO_PDF_TOOLS]
const MAX_TWO_FILE_TOOLS = ['compare']
const IMAGE_INPUT_TOOLS = ['image-to-pdf']
const DOCX_TOOLS = ['word-to-pdf']
const XLSX_TOOLS = ['excel-to-pdf']
const HTML_TOOLS = ['html-to-pdf']

function getAccept(tool: Tool) {
  if (IMAGE_INPUT_TOOLS.includes(tool.id)) return 'image/jpeg,image/png,image/webp'
  if (DOCX_TOOLS.includes(tool.id)) return '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (XLSX_TOOLS.includes(tool.id)) return '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (HTML_TOOLS.includes(tool.id)) return '.html,.htm,text/html'
  return '.pdf,application/pdf'
}

function getUploadTitle(toolId: string, isMulti: boolean) {
  switch (toolId) {
    case 'word-to-pdf': return 'Drop DOCX files here'
    case 'excel-to-pdf': return 'Drop XLSX files here'
    case 'image-to-pdf': return 'Drop JPG, PNG, or WebP images here'
    case 'html-to-pdf': return 'Drop HTML files here'
    default: return isMulti ? 'Drop PDF files here' : 'Drop a PDF file here'
  }
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function expectedFileMessage(tool: Tool) {
  if (DOCX_TOOLS.includes(tool.id)) return 'This tool supports DOCX only. Older .doc files are not supported; open the file in Word and save as .docx.'
  if (XLSX_TOOLS.includes(tool.id)) return 'This tool supports XLSX only. Older .xls files are not supported; open the file in Excel and save as .xlsx.'
  if (IMAGE_INPUT_TOOLS.includes(tool.id)) return 'This tool supports JPG, PNG, and WebP images only.'
  if (HTML_TOOLS.includes(tool.id)) return 'This tool supports .html and .htm files only.'
  return 'This tool needs PDF files only. Convert other files to PDF first, then try again.'
}

function friendlyError(error: unknown, toolName: string) {
  const raw = error instanceof Error ? error.message : String(error || '')
  const message = raw || 'An unexpected error occurred.'

  if (/password|encrypted|decrypt|restricted/i.test(message)) {
    return 'This PDF is password-protected or restricted. Remove the password and try again.'
  }
  if (/could not be opened as a valid PDF|invalid pdf|pdf header|xref|object stream|parse/i.test(message)) {
    return message.includes('could not be opened as a valid PDF')
      ? message
      : 'This file is not a valid PDF or it is damaged. Try Repair PDF first.'
  }
  if (/docx|word/i.test(message) && /not supported|could not be read|valid/i.test(message)) return message
  if (/xlsx|excel/i.test(message) && /not supported|could not be read|valid/i.test(message)) return message
  if (/unsupported image|image format|decode|canvas/i.test(message)) {
    return 'This image is damaged or unsupported. Please use JPG, PNG, or WebP.'
  }
  if (/ocr|tesseract|language/i.test(message)) return message
  if (/html|rendered|cross-origin|cors|tainted/i.test(message)) return message
  return `${toolName} failed: ${message}`
}

export default function ToolPage({ tool, onBack, initialFiles }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [stage, setStage] = useState<Stage>('upload')
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [dragging, setDragging] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [resultFiles, setResultFiles] = useState<ResultFile[]>([])
  const [selectedPages, setSelectedPages] = useState<number[]>([])
  const [pageOrder, setPageOrder] = useState<number[]>([])
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isDrawing = useRef(false)
  // Cancel support: incrementing ID; a process() call is orphaned when id no longer matches
  const processIdRef = useRef(0)
  const [inputBytes, setInputBytes] = useState(0)

  const isMulti = MULTI_FILE_TOOLS.includes(tool.id)
  const accept = getAccept(tool)

  const [opts, setOpts] = useState({
    splitMode: 'range' as 'range' | 'every' | 'all',
    splitRange: '', everyN: 2,
    angle: 90,
    compressLevel: 'medium' as 'low' | 'medium' | 'high',
    watermarkText: 'CONFIDENTIAL', watermarkOpacity: 30,
    watermarkPosition: 'diagonal' as any, watermarkSize: 48, watermarkColor: '#888888',
    pageNumPosition: 'bottom-center' as any,
    pageNumStart: 1, pageNumFormat: 'Page {n} of {total}',
    headerText: '', footerText: '', hfFontSize: 10, hfColor: '#111111',
    pageSize: 'A4' as 'A4' | 'Letter' | 'fit',
    orientation: 'portrait' as 'portrait' | 'landscape',
    imgFormat: 'jpeg' as 'jpeg' | 'png', imgScale: 2,
    ocrOutput: 'text' as 'text' | 'searchable',
    ocrLang: 'eng',
    userPassword: '',
    ownerPassword: '',
    signPage: 1,
    signX: 50,
    signY: 680,
    signWidth: 200,
    signHeight: 80,
    redactPage: 1,
    redactX: 50,
    redactY: 50,
    redactWidth: 220,
    redactHeight: 80,
    redactItems: [] as { pageIndex: number; x: number; y: number; width: number; height: number }[],
    editPage: 1,
    editMode: 'text' as 'text' | 'highlight' | 'rectangle' | 'whiteout' | 'line' | 'image' | 'edit-existing' | 'circle' | 'arrow' | 'freehand' | 'sticky-note',
    editText: 'New text',
    editX: 50,
    editY: 50,
    editWidth: 220,
    editHeight: 60,
    editFontSize: 14,
    editFontFamily: 'Arial',
    editFontBold: false,
    editFontItalic: false,
    editFontUnderline: false,
    editFontStrike: false,
    editLineWidth: 2,
    editColor: '#111111',
    editOpacity: 1,
    editItems: [] as any[],
    editImageDataUrl: '',
    editPoints: [] as { x: number; y: number }[],
    cropPage: 1,
    cropAllPages: false,
    cropRasterize: false,
    cropX: 40,
    cropY: 40,
    cropWidth: 520,
    cropHeight: 700,
    formType: 'text' as 'text' | 'checkbox' | 'dropdown' | 'radio' | 'signature',
    formName: 'field_1',
    formLabel: 'Field label',
    formPage: 1,
    formX: 50,
    formY: 120,
    formWidth: 220,
    formHeight: 32,
    formOptions: 'Option 1, Option 2',
    formFields: [] as any[],
    removePageRange: '',
    linkPage: 1,
    linkX: 80,
    linkY: 380,
    linkWidth: 200,
    linkHeight: 30,
    linkUrl: 'https://',
    linkLabel: 'Open link',
  })

  const opt = (k: string, v: any) => setOpts(o => ({ ...o, [k]: v }))

  // Pre-load files passed from the Electron "File > Open PDF" menu or App.tsx
  useEffect(() => {
    if (initialFiles?.length) {
      setFiles(initialFiles)
      setStage('configure')
    }
  }, []) // intentionally mount-only — file state lives here after that

  const handleFiles = (fl: FileList | null) => {
    if (!fl) return
    const arr = Array.from(fl)

    // Validate file types — drag-and-drop bypasses the input's accept attribute
    const wrongType = arr.find(f => {
      if (IMAGE_INPUT_TOOLS.includes(tool.id)) return !(/\.(jpe?g|png|webp)$/i.test(f.name) || f.type.startsWith('image/'))
      if (DOCX_TOOLS.includes(tool.id))        return !/\.docx$/i.test(f.name)
      if (XLSX_TOOLS.includes(tool.id))        return !/\.xlsx$/i.test(f.name)
      if (HTML_TOOLS.includes(tool.id))        return !/\.(html?)$/i.test(f.name)
      return !isPdfFile(f)
    })
    if (wrongType) {
      setErrorMsg(`"${wrongType.name}" is not the right file type for ${tool.name}. ${expectedFileMessage(tool)}`)
      setStage('error')
      return
    }

    const maxFiles = MAX_TWO_FILE_TOOLS.includes(tool.id) ? 2 : Infinity
    setFiles(prev => isMulti ? [...prev, ...arr].slice(0, maxFiles) : arr.slice(0, 1))
    setStage('configure')
    setSelectedPages([])
    setPageOrder([])
  }

  const removeFile = (i: number) => {
    const nf = files.filter((_, j) => j !== i)
    setFiles(nf)
    if (!nf.length) setStage('upload')
  }

  // ── MAIN PROCESSOR ─────────────────────────────────────────────────────────
  const process = useCallback(async () => {
    if (!files.length) return
    const myId = ++processIdRef.current
    const isCancelled = () => processIdRef.current !== myId

    setInputBytes(files.reduce((s, f) => s + f.size, 0))
    setStage('processing')
    setProgress(10)
    setProgressMsg('Starting…')
    setErrorMsg('')

    try {
      const file = files[0]
      const baseName = file.name.replace(/\.[^.]+$/, '')
      const results: ResultFile[] = []

      const tick = (pct: number, msg = '') => { setProgress(pct); setProgressMsg(msg) }

      // Cache page count to avoid redundant re-reads
      let _pageCount: number | null = null
      const pageCount = async () => {
        if (_pageCount === null) _pageCount = await getPageCount(file)
        return _pageCount
      }

      switch (tool.id) {

        // ── ORGANIZE ──
        case 'merge': {
          if (files.length < 2) throw new Error('Add at least 2 PDF files to merge')
          tick(20, 'Merging PDFs…')
          results.push({ name: 'merged.pdf', data: await mergePDFs(files) })
          break
        }

        case 'split': {
          tick(20, 'Splitting PDF…')
          for (let i = 0; i < files.length; i++) {
            const current = files[i]
            tick(15 + Math.round((i / files.length) * 75), `Splitting ${current.name} (${i + 1}/${files.length})...`)
            const parts = await splitPDF(current, opts.splitMode, opts.splitRange, opts.everyN)
            parts.forEach(p => results.push(p))
          }
          break
        }

        case 'remove-pages': {
          const selectedForRemoval = opts.removePageRange.trim()
            ? parsePageNumbers(opts.removePageRange, await pageCount())
            : selectedPages
          if (!selectedForRemoval.length) throw new Error('Select pages on the preview or enter page numbers to remove')
          tick(30, 'Removing pages…')
          results.push({ name: `${baseName}_removed.pdf`, data: await removePages(file, selectedForRemoval) })
          break
        }

        case 'extract':
          if (!selectedPages.length) throw new Error('Select at least one page to extract')
          tick(30, 'Extracting pages…')
          results.push({ name: `${baseName}_extracted.pdf`, data: await extractPages(file, selectedPages) })
          break

        case 'rotate':
          tick(30, 'Rotating pages…')
          results.push({ name: `${baseName}_rotated.pdf`, data: await rotatePDF(file, opts.angle, selectedPages.length ? selectedPages : undefined) })
          break

        case 'reorder':
          if (!pageOrder.length) throw new Error('Drag pages to set a new order first')
          tick(30, 'Reordering pages…')
          results.push({ name: `${baseName}_reordered.pdf`, data: await reorderPages(file, pageOrder) })
          break

        // ── OPTIMIZE ──
        case 'crop': {
          if (opts.cropPage < 1 || opts.cropPage > await pageCount()) throw new Error('Choose a valid crop page')
          const cropSpec = { pageIndex: opts.cropPage - 1, x: opts.cropX, y: opts.cropY, width: opts.cropWidth, height: opts.cropHeight, allPages: opts.cropAllPages }
          if (opts.cropRasterize) {
            tick(20, 'Rasterizing crop (removing hidden content)…')
            results.push({
              name: `${baseName}_cropped.pdf`,
              data: await cropPDFRasterized(file, cropSpec, (pct, pg, tot) => tick(20 + Math.round(pct * 0.75), `Rendering page ${pg} of ${tot}…`)),
            })
          } else {
            tick(30, 'Cropping PDF…')
            results.push({ name: `${baseName}_cropped.pdf`, data: await cropPDF(file, cropSpec) })
          }
          break
        }

        case 'compare': {
          if (files.length < 2) throw new Error('Add two PDF files to compare')
          tick(20, 'Comparing PDFs...')
          results.push({ name: 'pdf-compare-report.txt', text: await comparePDFText(files[0], files[1]) })
          break
        }

        case 'compress': {
          tick(30, 'Compressing PDF…')
          for (let i = 0; i < files.length; i++) {
            const current = files[i]
            const currentBaseName = current.name.replace(/\.[^.]+$/, '')
            tick(15 + Math.round((i / files.length) * 75), `Compressing ${current.name} (${i + 1}/${files.length})...`)
            results.push({
              name: `${currentBaseName}_compressed.pdf`,
              data: opts.compressLevel === 'low'
                ? await compressPDF(current, opts.compressLevel)
                : await compressPDFRasterized(current, opts.compressLevel, (pct, pg, tot) => {
                    const fileSpan = 75 / files.length
                    tick(15 + Math.round(i * fileSpan + (pct / 100) * fileSpan), `Compressing ${current.name} page ${pg} of ${tot}...`)
                  }),
            })
          }
          break
        }

        case 'repair':
          tick(30, 'Repairing PDF…')
          results.push({ name: `${baseName}_repaired.pdf`, data: await repairPDF(file) })
          break

        case 'flatten':
          tick(30, 'Flattening PDF…')
          results.push({ name: `${baseName}_flat.pdf`, data: await flattenPDF(file) })
          break

        case 'ocr': {
          tick(10, 'Rendering pages to images…')
          if (opts.ocrOutput === 'searchable') {
            results.push({
              name: `${baseName}_searchable.pdf`,
              data: await ocrSearchablePDF(file, opts.ocrLang, (pct, pg, tot) => {
                tick(10 + Math.round(pct * 0.8), `OCR page ${pg} of ${tot}...`)
              }),
            })
          } else {
            const ocrText = await ocrPDF(file, opts.ocrLang, (pct, pg, tot) => {
              tick(10 + Math.round(pct * 0.8), `OCR page ${pg} of ${tot}...`)
            })
            results.push({ name: `${baseName}_ocr.txt`, text: ocrText })
          }
          break
        }

        // ── SECURITY ──
        case 'protect': {
          if (!opts.userPassword.trim()) throw new Error('Enter a password to protect the PDF')
          tick(20, 'Protecting PDF...')
          results.push({
            name: `${baseName}_protected.pdf`,
            data: await protectPDFRasterized(file, opts.userPassword, opts.ownerPassword, (pct, pg, tot) => {
              tick(20 + Math.round(pct * 0.75), `Protecting page ${pg} of ${tot}...`)
            }),
          })
          break
        }

        case 'sign': {
          if (!signatureDataUrl) throw new Error('Draw your signature on the canvas first')
          if (opts.signPage < 1 || opts.signPage > await pageCount()) throw new Error('Choose a valid signature page')
          tick(30, 'Embedding signature…')
          results.push({ name: `${baseName}_signed.pdf`, data: await embedSignature(file, signatureDataUrl, opts.signPage - 1, opts.signX, opts.signY, opts.signWidth, opts.signHeight) })
          break
        }

        case 'redact': {
          // Use the queued list if present, otherwise fall back to the single drawn region
          const redactions = opts.redactItems.length
            ? opts.redactItems
            : [{ pageIndex: opts.redactPage - 1, x: opts.redactX, y: opts.redactY, width: opts.redactWidth, height: opts.redactHeight }]
          if (redactions.some((r: any) => r.width <= 0 || r.height <= 0)) throw new Error('Each redaction area must have a positive width and height')
          tick(20, 'Applying redaction…')
          results.push({
            name: `${baseName}_redacted.pdf`,
            data: await redactPDFRasterized(file, redactions, 2.5, (pct, pg, tot) => tick(20 + Math.round(pct * 0.75), `Redacting page ${pg} of ${tot}…`)),
          })
          break
        }

        // ── EDIT ──
        case 'edit-pdf':
        case 'annotate': {
          if (opts.editPage < 1 || opts.editPage > await pageCount()) throw new Error('Choose a valid page')
          if (opts.editMode === 'text' && !opts.editText.trim() && !opts.editItems.length) throw new Error('Enter text to add to the PDF')
          if (opts.editMode === 'image' && !opts.editImageDataUrl && !opts.editItems.length) throw new Error('Load an image first using the Image picker')
          if (opts.editMode === 'edit-existing' && !opts.editItems.length) throw new Error('Click text on the page to edit it, then click Apply Changes')
          tick(30, 'Applying edits...')
          const editItems = opts.editItems.length ? opts.editItems : [{
            kind: opts.editMode,
            pageIndex: opts.editPage - 1,
            text: opts.editText,
            x: opts.editX,
            y: opts.editY,
            width: opts.editWidth,
            height: opts.editMode === 'line' ? opts.editLineWidth : opts.editHeight,
            x2: opts.editX + opts.editWidth,
            y2: opts.editY + opts.editHeight,
            fontSize: opts.editFontSize,
            fontFamily: opts.editFontFamily,
            bold: opts.editFontBold,
            italic: opts.editFontItalic,
            underline: opts.editFontUnderline,
            strikethrough: opts.editFontStrike,
            color: opts.editColor,
            opacity: opts.editOpacity,
            imageDataUrl: opts.editImageDataUrl,
            points: opts.editPoints,
          }]
          results.push({
            name: `${baseName}_${tool.id === 'annotate' ? 'annotated' : 'edited'}.pdf`,
            data: tool.id === 'edit-pdf'
              ? await applyPDFEditsRasterized(file, editItems, 2.5, (pct, pg, tot) => tick(30 + Math.round(pct * 0.65), `Editing page ${pg} of ${tot}...`))
              : await applyPDFEdits(file, editItems),
          })
          break
        }

        case 'forms': {
          // If using queued fields, skip single-field validation; otherwise validate current field
          if (!opts.formFields.length) {
            if (!opts.formName.trim()) throw new Error('Enter a field name before processing')
            if (opts.formPage < 1 || opts.formPage > await pageCount()) throw new Error('Choose a valid form page')
          }
          const singleField = {
            type: opts.formType,
            name: opts.formName,
            label: opts.formLabel,
            pageIndex: opts.formPage - 1,
            x: opts.formX,
            y: opts.formY,
            width: opts.formWidth,
            height: opts.formHeight,
            options: opts.formOptions.split(',').map((item: string) => item.trim()).filter(Boolean),
          }
          const fields = opts.formFields.length ? opts.formFields : [singleField]
          // Catch duplicate field names before sending to pdf-lib (it throws internally)
          const seen = new Set<string>()
          for (const f of fields) {
            if (seen.has(f.name)) throw new Error(`Duplicate field name "${f.name}" — each field must have a unique name`)
            seen.add(f.name)
          }
          tick(30, 'Adding fillable fields...')
          results.push({ name: `${baseName}_form.pdf`, data: await addFormFieldsToPDF(file, fields) })
          break
        }

        case 'links': {
          if (!opts.linkUrl.trim() || opts.linkUrl === 'https://') throw new Error('Enter a valid URL (e.g. https://example.com)')
          if (opts.linkPage < 1 || opts.linkPage > await pageCount()) throw new Error('Choose a valid link page')
          tick(30, 'Adding link...')
          results.push({
            name: `${baseName}_linked.pdf`,
            data: await addLinkToPDF(file, {
              pageIndex: opts.linkPage - 1,
              x: opts.linkX,
              y: opts.linkY,
              width: opts.linkWidth,
              height: opts.linkHeight,
              url: opts.linkUrl,
              label: opts.linkLabel,
            }),
          })
          break
        }

        case 'watermark':
          if (!opts.watermarkText.trim()) throw new Error('Enter watermark text')
          tick(30, 'Adding watermark…')
          results.push({ name: `${baseName}_watermarked.pdf`, data: await addWatermark(file, opts.watermarkText, opts.watermarkOpacity, opts.watermarkPosition, opts.watermarkSize, opts.watermarkColor) })
          break

        case 'page-numbers':
          tick(30, 'Adding page numbers…')
          results.push({ name: `${baseName}_numbered.pdf`, data: await addPageNumbers(file, opts.pageNumPosition, opts.pageNumStart, opts.pageNumFormat) })
          break

        case 'header-footer':
          if (!opts.headerText.trim() && !opts.footerText.trim()) throw new Error('Enter header or footer text')
          tick(30, 'Adding header/footer…')
          results.push({ name: `${baseName}_hf.pdf`, data: await addHeaderFooter(file, opts.headerText, opts.footerText, opts.hfFontSize, opts.hfColor) })
          break

        // ── CONVERT TO PDF ──
        case 'image-to-pdf':
          tick(20, 'Converting images to PDF…')
          results.push({ name: 'images.pdf', data: await imagesToPDF(files, opts.pageSize, opts.orientation) })
          break

        case 'word-to-pdf':
          tick(20, 'Converting Word document…')
          for (let i = 0; i < files.length; i++) {
            const current = files[i]
            const currentBaseName = current.name.replace(/\.[^.]+$/, '')
            tick(15 + Math.round((i / files.length) * 75), `Converting ${current.name} (${i + 1}/${files.length})...`)
            results.push({ name: `${currentBaseName}.pdf`, data: await docxToPDF(current) })
          }
          break

        case 'excel-to-pdf':
          tick(20, 'Converting Excel spreadsheet…')
          for (let i = 0; i < files.length; i++) {
            const current = files[i]
            const currentBaseName = current.name.replace(/\.[^.]+$/, '')
            tick(15 + Math.round((i / files.length) * 75), `Converting ${current.name} (${i + 1}/${files.length})...`)
            results.push({ name: `${currentBaseName}.pdf`, data: await xlsxToPDF(current) })
          }
          break

        case 'html-to-pdf':
          tick(20, 'Converting HTML page…')
          for (let i = 0; i < files.length; i++) {
            const current = files[i]
            const currentBaseName = current.name.replace(/\.[^.]+$/, '')
            tick(15 + Math.round((i / files.length) * 75), `Converting ${current.name} (${i + 1}/${files.length})...`)
            results.push({ name: `${currentBaseName}.pdf`, data: await htmlFileToPDF(current) })
          }
          break

        // ── CONVERT FROM PDF ──
        case 'pdf-to-jpg': {
          tick(10, 'Rendering pages…')
          const imgs = await pdfToImages(file, opts.imgFormat, opts.imgScale, (pct, pg, tot) => {
            tick(10 + Math.round(pct * 0.85), `Rendering page ${pg} of ${tot}...`)
          })
          imgs.forEach(img => results.push({ name: img.name, url: img.url }))
          break
        }

        case 'pdf-to-text': {
          const { text: txt, wasScanned } = await extractTextSmart(file, opts.ocrLang, (msg, pct) => tick(pct, msg))
          results.push({ name: `${baseName}.txt`, text: txt })
          if (wasScanned) tick(100, 'Done — OCR was used (scanned PDF detected)')
          break
        }

        case 'pdf-to-word': {
          const docx = await pdfToWordDocx(file, opts.ocrLang, (msg, pct) => tick(pct, msg))
          results.push({
            name: `${baseName}.docx`, data: docx,
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          })
          break
        }

        case 'pdf-to-excel': {
          const xlsx = await pdfToExcelXlsx(file, opts.ocrLang, (msg, pct) => tick(pct, msg))
          results.push({
            name: `${baseName}.xlsx`, data: xlsx,
            mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          })
          break
        }

        default:
          throw new Error(`"${tool.name}" is not yet implemented in this version.`)
      }

      if (isCancelled()) return
      tick(100, 'Done!')
      setResultFiles(results)
      setStage('done')
    } catch (e: any) {
      if (isCancelled()) return
      setErrorMsg(friendlyError(e, tool.name))
      setStage('error')
    }
  }, [files, opts, selectedPages, pageOrder, signatureDataUrl, tool])

  const cancelProcess = () => {
    processIdRef.current++ // orphan the running process
    setStage('configure')
    setProgressMsg('')
    setProgress(0)
  }

  // ── DOWNLOAD HELPERS ─────────────────────────────────────────────────────────
  const downloadSingle = (f: ResultFile) => {
    if (f.data) {
      const mime = f.mime || 'application/pdf'
      const data = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer
      const blob = new Blob([data], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = f.name; a.click()
      URL.revokeObjectURL(url)
    } else if (f.url) {
      downloadDataUrl(f.url, f.name)
    } else if (f.text !== undefined) {
      const blob = new Blob([f.text], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = f.name; a.click()
      URL.revokeObjectURL(url)
    }
  }

  // ── DOWNLOAD ALL ────────────────────────────────────────────────────────────
  const downloadAll = () => {
    if (resultFiles.length === 1) { downloadSingle(resultFiles[0]); return }

    // Build ZIP entries from all result types (data, url data-URLs, text)
    const zipEntries: { name: string; data: Uint8Array }[] = []
    for (const f of resultFiles) {
      if (f.data) {
        zipEntries.push({ name: f.name, data: f.data })
      } else if (f.url) {
        // data URL → bytes
        const comma = f.url.indexOf(',')
        if (comma !== -1) {
          try {
            const bytes = Uint8Array.from(atob(f.url.slice(comma + 1)), c => c.charCodeAt(0))
            zipEntries.push({ name: f.name, data: bytes })
          } catch { /* skip unreadable data URLs */ }
        }
      } else if (f.text !== undefined) {
        zipEntries.push({ name: f.name, data: new TextEncoder().encode(f.text) })
      }
    }

    if (zipEntries.length > 1) {
      downloadZip(zipEntries)
    } else {
      // Fallback: download individually if ZIP conversion failed
      resultFiles.forEach(downloadSingle)
    }
  }

  const reset = () => { setFiles([]); setStage('upload'); setResultFiles([]); setSelectedPages([]); setPageOrder([]); setSignatureDataUrl(null); opt('redactItems', []) }
  const retry = () => { setStage('configure'); setResultFiles([]); setErrorMsg('') }

  // ── SIGNATURE CANVAS ────────────────────────────────────────────────────────
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    }
  }

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDrawing.current = true
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !canvasRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const point = getCanvasPoint(e)
    if (!point) return
    ctx.beginPath(); ctx.moveTo(point.x, point.y)
  }
  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')!
    const point = getCanvasPoint(e)
    if (!point) return
    ctx.lineTo(point.x, point.y)
    ctx.strokeStyle = '#6c63ff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke()
  }
  const endDraw = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e?.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    isDrawing.current = false
    setSignatureDataUrl(canvasRef.current?.toDataURL('image/png') ?? null)
  }
  const clearSig = () => {
    const c = canvasRef.current
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    setSignatureDataUrl(null)
  }

  const needsPageSelector = ['remove-pages', 'extract', 'rotate'].includes(tool.id)
  const needsReorder = tool.id === 'reorder'

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '28px 36px', maxWidth: 940, margin: '0 auto' }}>
      {/* Back */}
      <button onClick={onBack} aria-label="Back to tools" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: '#8888aa', cursor: 'pointer', fontSize: 13, marginBottom: 24, padding: 0 }}
        onMouseEnter={e => e.currentTarget.style.color = '#4444aa'}
        onMouseLeave={e => e.currentTarget.style.color = '#8888aa'}>
        <ArrowLeft size={15} /> Back to tools
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: tool.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, boxShadow: '0 4px 14px rgba(99,102,241,0.25)' }}>{tool.icon}</div>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1a1a3a', margin: 0, marginBottom: 3 }}>{tool.name}</h2>
          <p style={{ color: '#8888aa', fontSize: 13, margin: 0 }}>{tool.description}</p>
        </div>
      </div>

      {/* Upload + Configure */}
      {(stage === 'upload' || stage === 'configure') && (
        <div style={{ background: '#ffffff', border: '1px solid #e8e8f5', borderRadius: 20, padding: 28, marginBottom: 16, boxShadow: '0 2px 12px rgba(99,102,241,0.06)' }}>
          <DropZone
            files={files} dragging={dragging} accept={accept} isMulti={isMulti}
            inputRef={inputRef}
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDrop={(e: React.DragEvent) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files)}
            onRemove={removeFile}
            onAddMore={() => { if (inputRef.current) inputRef.current.value = ''; inputRef.current?.click() }}
            toolId={tool.id}
            onReorder={(from: number, to: number) => {
              setFiles(prev => {
                const arr = [...prev]
                const [item] = arr.splice(from, 1)
                arr.splice(to, 0, item)
                return arr
              })
            }}
          />

          {files.length > 0 && files.some(isPdfFile) && (
            <PdfInputPreview
              files={files.filter(isPdfFile)}
              selectedPages={selectedPages}
              title={isMulti ? 'PDF previews before processing' : 'PDF preview before processing'}
            />
          )}

          {/* Page selectors */}
          {files.length > 0 && needsPageSelector && (
            <Section title={tool.id === 'remove-pages' ? 'Select pages to REMOVE' : tool.id === 'extract' ? 'Select pages to EXTRACT' : 'Select pages to rotate (empty = all)'}>
              {tool.id === 'remove-pages' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#666680', marginBottom: 6 }}>
                    Page numbers to remove
                  </label>
                  <input
                    value={opts.removePageRange}
                    onChange={e => opt('removePageRange', e.target.value)}
                    placeholder="Example: 2 or 2,4-6"
                    style={{
                      width: '100%',
                      border: '1.5px solid #d7def0',
                      borderRadius: 10,
                      padding: '10px 12px',
                      fontSize: 13,
                      color: '#1a1a3a',
                      outline: 'none',
                      background: '#ffffff',
                    }}
                  />
                  <div style={{ fontSize: 11, color: '#8888aa', marginTop: 6 }}>
                    You can click thumbnails below or type page numbers here. Typed page numbers will be used first.
                  </div>
                </div>
              )}
              <PageSelector file={files[0]} mode="select" selectedPages={selectedPages} onSelectionChange={setSelectedPages} />
            </Section>
          )}
          {files.length > 0 && needsReorder && (
            <Section title="Drag pages to reorder">
              <PageSelector file={files[0]} mode="reorder" onOrderChange={setPageOrder} />
            </Section>
          )}

          {/* Merge: warn if only 1 file */}
          {tool.id === 'merge' && files.length === 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 14px', background: '#fffaeb', border: '1px solid #fde68a', borderRadius: 10, fontSize: 12, color: '#d97706' }}>
              ℹ️ Add at least one more PDF to merge. Use <strong>+ Add more files</strong> above.
            </div>
          )}

          {/* Tool-specific options */}
          {files.length > 0 && (
            <ToolOptions file={files[0]} tool={tool} opts={opts} opt={opt} canvasRef={canvasRef} startDraw={startDraw} draw={draw} endDraw={endDraw} clearSig={clearSig} signatureDataUrl={signatureDataUrl} />
          )}

          {/* Process button */}
          {files.length > 0 && (
            <button onClick={process} style={{ marginTop: 20, width: '100%', background: tool.gradient, border: 'none', borderRadius: 12, padding: '14px 0', color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.02em' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              {tool.icon}&nbsp;&nbsp;{tool.name}
            </button>
          )}
        </div>
      )}

      {/* Processing */}
      {stage === 'processing' && (
        <div style={{ background: '#ffffff', border: '1px solid #e8e8f5', borderRadius: 20, padding: 60, textAlign: 'center', boxShadow: '0 2px 12px rgba(99,102,241,0.06)' }}>
          <Loader2 size={48} color="#6366f1" style={{ animation: 'spin 1s linear infinite', marginBottom: 20 }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a3a', marginBottom: 6 }}>Processing…</div>
          <div style={{ fontSize: 13, color: '#8888aa', marginBottom: 20, minHeight: 18 }}>{progressMsg}</div>
          <div style={{ height: 6, background: '#eeeefc', borderRadius: 100, overflow: 'hidden', maxWidth: 340, margin: '0 auto 24px' }}>
            <div style={{ height: '100%', borderRadius: 100, background: tool.gradient, width: `${progress}%`, transition: 'width 0.3s ease' }} />
          </div>
          <button
            onClick={cancelProcess}
            style={{ padding: '8px 24px', borderRadius: 8, border: '1px solid #e0e0f0', background: '#f5f5ff', color: '#8888aa', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#eeeeff'; e.currentTarget.style.color = '#4444aa' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#f5f5ff'; e.currentTarget.style.color = '#8888aa' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error */}
      {stage === 'error' && (
        <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 20, padding: 48, textAlign: 'center', boxShadow: '0 2px 12px rgba(239,68,68,0.08)' }}>
          <AlertCircle size={48} color="#dc2626" style={{ marginBottom: 16 }} />
          <div style={{ fontSize: 18, fontWeight: 600, color: '#dc2626', marginBottom: 8 }}>Processing Failed</div>
          <div style={{ fontSize: 13, color: '#8888aa', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>{errorMsg}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={retry} style={{ padding: '10px 28px', borderRadius: 10, background: '#fef2f2', color: '#dc2626', fontSize: 13, cursor: 'pointer', fontWeight: 600, border: '1px solid #fecaca' }}>Try Again</button>
            <button onClick={reset} style={{ padding: '10px 28px', borderRadius: 10, border: '1px solid #e5e5f5', background: '#ffffff', color: '#8888aa', fontSize: 13, cursor: 'pointer' }}>Start Over</button>
          </div>
        </div>
      )}

      {/* Done */}
      {stage === 'done' && (
        <div style={{ background: '#ffffff', border: '1px solid #a7f3d0', borderRadius: 20, overflow: 'hidden', boxShadow: '0 4px 20px rgba(16,185,129,0.1)' }}>
          <div style={{ padding: '32px 32px 20px', textAlign: 'center', borderBottom: '1px solid #e8e8f5', background: 'linear-gradient(135deg,#f0fdf8,#f5fff8)' }}>
            <CheckCircle2 size={52} color="#10b981" style={{ marginBottom: 14 }} />
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a3a', marginBottom: 4 }}>Done!</div>
            <div style={{ fontSize: 13, color: '#8888aa' }}>{resultFiles.length} file{resultFiles.length !== 1 ? 's' : ''} ready to download</div>
          </div>

          {/* Text output */}
          {resultFiles[0]?.text !== undefined && (
            <div style={{ padding: '16px 24px' }}>
              <textarea readOnly value={resultFiles[0].text} style={{ width: '100%', height: 260, background: '#f8f8ff', border: '1.5px solid #e0e0f0', borderRadius: 10, padding: 14, color: '#1a1a3a', fontSize: 12, fontFamily: 'monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
            </div>
          )}

          {/* Image grid */}
          {resultFiles[0]?.url && (
            <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10 }}>
              {resultFiles.map((f, i) => (
                <div key={i} style={{ border: '1px solid #e5e5f5', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                  <img src={f.url} alt={f.name} style={{ width: '100%', display: 'block' }} />
                  <div style={{ padding: '5px 8px', fontSize: 10, color: '#8888aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: '#fafaff' }}>{f.name}</div>
                </div>
              ))}
            </div>
          )}

          {/* File list */}
          {resultFiles[0]?.data && (
            <div style={{ padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inputBytes > 0 && (() => {
                const outBytes = resultFiles.reduce((s, f) => s + (f.data?.length ?? 0), 0)
                const pct = Math.round((1 - outBytes / inputBytes) * 100)
                const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#f8f8ff', border: '1px solid #e8e8f5', borderRadius: 10, fontSize: 12, flexWrap: 'wrap' }}>
                    <span style={{ color: '#8888aa' }}>{fmt(inputBytes)}</span>
                    <span style={{ color: '#c7d2fe', fontWeight: 700 }}>→</span>
                    <span style={{ color: '#1a1a3a', fontWeight: 600 }}>{fmt(outBytes)}</span>
                    {pct > 0 && <span style={{ marginLeft: 2, color: '#059669', fontWeight: 700, background: '#ecfdf5', padding: '2px 9px', borderRadius: 100, border: '1px solid #a7f3d0', fontSize: 11 }}>↓ {pct}% smaller</span>}
                    {pct < 0 && <span style={{ marginLeft: 2, color: '#d97706', fontWeight: 700, background: '#fffaeb', padding: '2px 9px', borderRadius: 100, border: '1px solid #fde68a', fontSize: 11 }}>↑ {Math.abs(pct)}% larger</span>}
                    {pct === 0 && <span style={{ marginLeft: 2, color: '#8888aa', fontSize: 11 }}>same size</span>}
                  </div>
                )
              })()}
              {resultFiles.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f8f8ff', border: '1px solid #e8e8f5', borderRadius: 10, padding: '10px 14px' }}>
                  <FileText size={16} color="#6366f1" />
                  <span style={{ flex: 1, fontSize: 13, color: '#1a1a3a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: '#aaaacc', flexShrink: 0 }}>{f.data ? ((f.data.length / 1024).toFixed(0) + ' KB') : ''}</span>
                  <button onClick={() => downloadSingle(f)} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #c7d2fe', background: '#eef0ff', color: '#6366f1', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontWeight: 600 }}>
                    <Download size={12} /> Save
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ padding: '16px 24px 28px', display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={downloadAll} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'linear-gradient(135deg,#10b981,#34d399)', border: 'none', borderRadius: 12, padding: '12px 32px', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(16,185,129,0.3)' }}>
              <Download size={16} /> {resultFiles.length > 1 ? 'Download ZIP' : 'Download'}
            </button>
            <button onClick={reset} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f5f5ff', border: '1px solid #e0e0f0', borderRadius: 12, padding: '12px 22px', color: '#8888aa', fontSize: 13, cursor: 'pointer' }}>
              Process Another File
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SUB-COMPONENTS ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20, borderTop: '1px solid #e8e8f5', paddingTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#8888aa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

function PdfInputPreview({ files, selectedPages, title }: { files: File[]; selectedPages: number[]; title: string }) {
  return (
    <Section title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {files.slice(0, 3).map((file, index) => (
          <PdfFilePreview
            key={`${file.name}-${file.size}-${index}`}
            file={file}
            selectedPages={index === 0 ? selectedPages : []}
          />
        ))}
        {files.length > 3 && (
          <div style={{ fontSize: 12, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px' }}>
            {files.length - 3} more PDF file{files.length - 3 === 1 ? '' : 's'} queued.
          </div>
        )}
      </div>
    </Section>
  )
}

function PdfFilePreview({ file, selectedPages }: { file: File; selectedPages: number[] }) {
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [error, setError] = useState('')
  const selected = new Set(selectedPages)
  const selectedCount = selectedPages.length
  const maxThumbs = 8

  useEffect(() => {
    let cancelled = false
    setPageCount(null)
    setThumbs([])
    setError('')

    ;(async () => {
      try {
        const count = await getPageCount(file)
        if (cancelled) return
        setPageCount(count)

        const limit = Math.min(maxThumbs, count)
        for (let page = 0; page < limit; page++) {
          const thumb = await renderPageToDataUrl(file, page, 0.22)
          if (cancelled) return
          setThumbs(prev => {
            const next = [...prev]
            next[page] = thumb
            return next
          })
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not preview this PDF')
      }
    })()

    return () => { cancelled = true }
  }, [file])

  return (
    <div style={{
      border: '1px solid #dbe4f0',
      background: '#ffffff',
      borderRadius: 10,
      padding: 12,
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <FileText size={16} color="#2563eb" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: '#0f172a', fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
            {pageCount === null && !error ? 'Reading PDF...' : error ? 'Preview unavailable' : `${pageCount} page${pageCount === 1 ? '' : 's'}`} · {formatBytes(file.size)}
          </div>
        </div>
        {selectedCount > 0 && (
          <span style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1d4ed8',
            borderRadius: 999,
            padding: '4px 9px',
            fontSize: 11,
            fontWeight: 800,
          }}>
            {selectedCount} selected
          </span>
        )}
      </div>

      {error ? (
        <div style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
          {error}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {Array.from({ length: Math.min(maxThumbs, pageCount ?? 4) }, (_, page) => {
            const isSelected = selected.has(page)
            return (
              <div
                key={page}
                style={{
                  width: 72,
                  flex: '0 0 72px',
                  border: `2px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: '#f8fafc',
                  position: 'relative',
                }}
              >
                {thumbs[page]
                  ? <img src={thumbs[page]} alt={`Page ${page + 1}`} style={{ display: 'block', width: '100%' }} />
                  : <div style={{ width: '100%', paddingBottom: '141%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 10 }}>Loading</div>
                }
                <div style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: isSelected ? 'rgba(37,99,235,0.92)' : 'rgba(15,23,42,0.72)',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '3px 5px',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}>
                  <span>P {page + 1}</span>
                  {isSelected && <span>Selected</span>}
                </div>
              </div>
            )
          })}
          {pageCount !== null && pageCount > maxThumbs && (
            <div style={{
              width: 72,
              flex: '0 0 72px',
              minHeight: 102,
              border: '1px dashed #cbd5e1',
              borderRadius: 8,
              color: '#64748b',
              background: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 700,
              padding: 8,
            }}>
              +{pageCount - maxThumbs}<br />more
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DropZone({ files, dragging, accept, isMulti, inputRef, onDragEnter, onDragLeave, onDrop, onChange, onRemove, onAddMore, toolId, onReorder }: any) {
  const isEmpty = files.length === 0
  const [dragSrc, setDragSrc] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const dragSrcRef = useRef<number | null>(null)

  const startReorder = (i: number) => { dragSrcRef.current = i; setDragSrc(i) }
  const endReorder = () => { dragSrcRef.current = null; setDragSrc(null); setDragOver(null) }

  return (
    <div
      onDragEnter={() => { if (dragSrcRef.current === null) onDragEnter() }}
      onDragLeave={onDragLeave}
      onDragOver={(e: any) => e.preventDefault()} onDrop={onDrop}
      onClick={() => isEmpty && inputRef.current?.click()}
      style={{ border: `2px dashed ${dragging ? '#6c63ff' : isEmpty ? '#d0d0f0' : 'rgba(108,99,255,0.35)'}`, borderRadius: 14, padding: isEmpty ? '44px 20px' : '18px 20px', textAlign: 'center', cursor: isEmpty ? 'pointer' : 'default', background: dragging ? 'rgba(108,99,255,0.04)' : isEmpty ? '#fafaff' : 'transparent', transition: 'all 0.2s' }}
    >
      <input ref={inputRef} type="file" multiple={isMulti} accept={accept} hidden onChange={onChange} />
      {isEmpty ? (
        <>
          <div style={{ width: 54, height: 54, borderRadius: 14, background: 'rgba(108,99,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Upload size={24} color="#6c63ff" />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a3a', marginBottom: 6 }}>
            {getUploadTitle(toolId, isMulti)}
          </div>
          <div style={{ fontSize: 12, color: '#8888aa', marginBottom: 14 }}>or click to browse from your computer</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['No size limit', isMulti ? 'Multiple files OK' : 'Single file'].map(t => (
              <span key={t} style={{ padding: '3px 10px', borderRadius: 100, background: '#f0f0fa', border: '1px solid #e0e0f5', fontSize: 10, color: '#8888aa' }}>{t}</span>
            ))}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isMulti && files.length > 1 && (
            <div style={{ fontSize: 10, color: '#aaaacc', textAlign: 'left', paddingLeft: 2, marginBottom: 2 }}>
              Drag rows to reorder
            </div>
          )}
          {files.map((f: File, i: number) => {
            const isImg = f.type.startsWith('image/')
            const size = f.size > 1e6 ? `${(f.size / 1e6).toFixed(1)} MB` : `${(f.size / 1024).toFixed(0)} KB`
            const isDragged = dragSrc === i
            const isTarget = dragOver === i && dragSrc !== null && dragSrc !== i
            return (
              <div
                key={i}
                draggable={isMulti && !!onReorder}
                onDragStart={(e) => { e.stopPropagation(); startReorder(i) }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (dragSrcRef.current !== null) setDragOver(i) }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  if (dragSrcRef.current !== null && dragSrcRef.current !== i) onReorder?.(dragSrcRef.current, i)
                  endReorder()
                }}
                onDragEnd={endReorder}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: isTarget ? '#eef0ff' : '#f8f8ff',
                  border: `1px solid ${isTarget ? '#6366f1' : '#e8e8f5'}`,
                  borderRadius: 10, padding: '9px 14px',
                  opacity: isDragged ? 0.4 : 1,
                  cursor: isMulti && onReorder ? (dragSrc !== null ? 'grabbing' : 'grab') : 'default',
                  transition: 'opacity 0.15s, border-color 0.15s, background 0.15s',
                  boxShadow: isTarget ? '0 0 0 2px rgba(99,102,241,0.2)' : 'none',
                }}
              >
                {isMulti && onReorder && (
                  <GripVertical size={14} color={isTarget ? '#6366f1' : '#ccccdd'} style={{ flexShrink: 0 }} />
                )}
                {isImg ? <ImageIcon size={15} color="#6c63ff" /> : <FileText size={15} color="#6c63ff" />}
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontSize: 13, color: '#1a1a3a', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: '#aaaacc' }}>{size}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); onRemove(i) }} aria-label={`Remove ${f.name}`} style={{ background: 'none', border: 'none', color: '#aaaacc', cursor: 'pointer', padding: 4, display: 'flex' }}
                  onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.color = '#aaaacc')}>
                  <X size={14} />
                </button>
              </div>
            )
          })}
          {isMulti && !(toolId === 'compare' && files.length >= 2) && (
            <button onClick={onAddMore} style={{ padding: '8px 0', borderRadius: 8, border: '1px dashed rgba(108,99,255,0.5)', background: '#f5f5ff', color: '#6366f1', fontSize: 12, cursor: 'pointer', marginTop: 4 }}>+ Add more files</button>
          )}
          {toolId === 'compare' && files.length >= 2 && (
            <div style={{ fontSize: 11, color: '#059669', textAlign: 'center', marginTop: 4, padding: '6px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0' }}>✓ 2 files ready to compare</div>
          )}
        </div>
      )}
    </div>
  )
}

function RedactionDesigner({ file, opts, opt }: { file: File; opts: any; opt: (key: string, value: any) => void }) {
  const PREVIEW_SCALE = 0.5
  const [preview, setPreview] = useState('')
  const [pdfDims, setPdfDims] = useState({ width: 595, height: 842 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let cancelled = false
    setPreview('')
    renderPageToDataUrl(file, Math.max(0, opts.redactPage - 1), PREVIEW_SCALE)
      .then(url => {
        if (cancelled) return
        const img = new Image()
        img.onload = () => setPdfDims({ width: img.naturalWidth / PREVIEW_SCALE, height: img.naturalHeight / PREVIEW_SCALE })
        img.src = url
        setPreview(url)
      })
      .catch(() => { if (!cancelled) setPreview('') })
    return () => { cancelled = true }
  }, [file, opts.redactPage])

  const pointFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
    return {
      x: x * (pdfDims.width / rect.width),
      y: y * (pdfDims.height / rect.height),
    }
  }

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(e)
    if (!point) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragStart(point)
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return
    const point = pointFromEvent(e)
    if (!point) return
    setDraft({
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    })
  }

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (draft && draft.width > 2 && draft.height > 2) {
      opt('redactX', Math.round(draft.x))
      opt('redactY', Math.round(draft.y))
      opt('redactWidth', Math.round(draft.width))
      opt('redactHeight', Math.round(draft.height))
    }
    setDragStart(null)
  }

  const box = draft ?? { x: opts.redactX, y: opts.redactY, width: opts.redactWidth, height: opts.redactHeight }
  const img = imgRef.current
  const sx = img?.clientWidth ? img.clientWidth / pdfDims.width : 1
  const sy = img?.clientHeight ? img.clientHeight / pdfDims.height : 1

  if (!preview) return <div style={{ fontSize: 12, color: '#8888aa' }}>Loading page preview...</div>

  return (
    <div
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{ position: 'relative', maxWidth: 520, border: '1px solid #d0d0f0', borderRadius: 8, overflow: 'hidden', touchAction: 'none', cursor: 'crosshair', background: '#f8f8ff' }}
    >
      <img ref={imgRef} src={preview} alt="Redaction page preview" style={{ display: 'block', width: '100%', userSelect: 'none', pointerEvents: 'none' }} />
      {/* Queued redaction regions for the current page */}
      {(opts.redactItems as any[]).filter(r => r.pageIndex === opts.redactPage - 1).map((r: any, i: number) => (
        <div key={i} style={{ position: 'absolute', left: r.x * sx, top: r.y * sy, width: r.width * sx, height: r.height * sy, background: 'rgba(0,0,0,0.88)', border: '1px solid #ef4444', pointerEvents: 'none' }} />
      ))}
      {/* Current draft region */}
      <div style={{ position: 'absolute', left: box.x * sx, top: box.y * sy, width: box.width * sx, height: box.height * sy, background: 'rgba(0,0,0,0.55)', border: '2px dashed #ef4444', pointerEvents: 'none' }} />
    </div>
  )
}

function CropDesigner({ file, opts, opt }: { file: File; opts: any; opt: (key: string, value: any) => void }) {
  const PREVIEW_SCALE = 0.5
  const [preview, setPreview] = useState('')
  const [pdfDims, setPdfDims] = useState({ width: 595, height: 842 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let cancelled = false
    setPreview('')
    renderPageToDataUrl(file, Math.max(0, opts.cropPage - 1), PREVIEW_SCALE)
      .then(url => {
        if (cancelled) return
        const img = new Image()
        img.onload = () => setPdfDims({ width: img.naturalWidth / PREVIEW_SCALE, height: img.naturalHeight / PREVIEW_SCALE })
        img.src = url
        setPreview(url)
      })
      .catch(() => { if (!cancelled) setPreview('') })
    return () => { cancelled = true }
  }, [file, opts.cropPage])

  const pointFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
    return {
      x: x * (pdfDims.width / rect.width),
      y: y * (pdfDims.height / rect.height),
    }
  }

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(e)
    if (!point) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragStart(point)
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return
    const point = pointFromEvent(e)
    if (!point) return
    setDraft({
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    })
  }

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (draft && draft.width > 2 && draft.height > 2) {
      opt('cropX', Math.round(draft.x))
      opt('cropY', Math.round(draft.y))
      opt('cropWidth', Math.round(draft.width))
      opt('cropHeight', Math.round(draft.height))
    }
    setDragStart(null)
  }

  const box = draft ?? { x: opts.cropX, y: opts.cropY, width: opts.cropWidth, height: opts.cropHeight }
  const img = imgRef.current
  const sx = img?.clientWidth ? img.clientWidth / pdfDims.width : 1
  const sy = img?.clientHeight ? img.clientHeight / pdfDims.height : 1

  if (!preview) return <div style={{ fontSize: 12, color: '#8888aa' }}>Loading page preview...</div>

  return (
    <div
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{ position: 'relative', maxWidth: 520, border: '1px solid #d0d0f0', borderRadius: 8, overflow: 'hidden', touchAction: 'none', cursor: 'crosshair', background: '#f8f8ff' }}
    >
      <img ref={imgRef} src={preview} alt="Crop page preview" style={{ display: 'block', width: '100%', userSelect: 'none', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.38)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: box.x * sx, top: box.y * sy, width: box.width * sx, height: box.height * sy, boxShadow: '0 0 0 9999px rgba(0,0,0,0.38)', border: '2px solid #2dd4bf', pointerEvents: 'none' }} />
    </div>
  )
}

function LinkDesigner({ file, opts, opt }: { file: File; opts: any; opt: (key: string, value: any) => void }) {
  const PREVIEW_SCALE = 0.5
  const [preview, setPreview] = useState('')
  const [pdfDims, setPdfDims] = useState({ width: 595, height: 842 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let cancelled = false
    setPreview('')
    renderPageToDataUrl(file, Math.max(0, opts.linkPage - 1), PREVIEW_SCALE)
      .then(url => {
        if (cancelled) return
        const img = new Image()
        img.onload = () => setPdfDims({ width: img.naturalWidth / PREVIEW_SCALE, height: img.naturalHeight / PREVIEW_SCALE })
        img.src = url
        setPreview(url)
      })
      .catch(() => { if (!cancelled) setPreview('') })
    return () => { cancelled = true }
  }, [file, opts.linkPage])

  const pointFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
    return {
      x: Math.round(x * (pdfDims.width / rect.width)),
      y: Math.round(y * (pdfDims.height / rect.height)),
    }
  }

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(e)
    if (!point) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragStart(point)
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return
    const point = pointFromEvent(e)
    if (!point) return
    setDraft({
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    })
  }

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (draft && draft.width > 5 && draft.height > 5) {
      opt('linkX', draft.x)
      opt('linkY', draft.y)
      opt('linkWidth', draft.width)
      opt('linkHeight', draft.height)
    }
    setDragStart(null)
    setDraft(null)
  }

  const box = draft ?? { x: opts.linkX, y: opts.linkY, width: opts.linkWidth, height: opts.linkHeight }
  const img = imgRef.current
  const sx = img?.clientWidth ? img.clientWidth / pdfDims.width : 1
  const sy = img?.clientHeight ? img.clientHeight / pdfDims.height : 1

  if (!preview) return <div style={{ fontSize: 12, color: '#8888aa' }}>Loading page preview…</div>

  return (
    <div>
      <div style={{ fontSize: 11, color: '#7777aa', marginBottom: 6 }}>🖱️ Drag on the page to draw the link area. The blue box shows where it will be placed.</div>
      <div
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ position: 'relative', maxWidth: 520, border: '1px solid #d0d0f0', borderRadius: 8, overflow: 'hidden', touchAction: 'none', cursor: 'crosshair', background: '#f8f8ff', userSelect: 'none' }}
      >
        <img ref={imgRef} src={preview} alt="Link placement preview" style={{ display: 'block', width: '100%', pointerEvents: 'none' }} />
        <div style={{
          position: 'absolute',
          left: box.x * sx,
          top: box.y * sy,
          width: Math.max(2, box.width * sx),
          height: Math.max(2, box.height * sy),
          background: 'rgba(37,99,235,0.13)',
          border: '2px dashed #2563eb',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 2,
        }}>
          {box.width * sx > 40 && (
            <span style={{ fontSize: 10, color: '#1d4ed8', fontWeight: 700, whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.8)', padding: '1px 5px', borderRadius: 3 }}>🔗 Link</span>
          )}
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: '#aaaacc' }}>
        Position: X={opts.linkX} · Y={opts.linkY} · {opts.linkWidth}×{opts.linkHeight} pts
      </div>
    </div>
  )
}

function FormFieldDesigner({ file, opts, opt }: { file: File; opts: any; opt: (key: string, value: any) => void }) {
  const PREVIEW_SCALE = 0.5
  const [preview, setPreview] = useState('')
  const [pdfDims, setPdfDims] = useState({ width: 595, height: 842 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let cancelled = false
    setPreview('')
    renderPageToDataUrl(file, Math.max(0, opts.formPage - 1), PREVIEW_SCALE)
      .then(url => {
        if (cancelled) return
        const img = new Image()
        img.onload = () => setPdfDims({ width: img.naturalWidth / PREVIEW_SCALE, height: img.naturalHeight / PREVIEW_SCALE })
        img.src = url
        setPreview(url)
      })
      .catch(() => { if (!cancelled) setPreview('') })
    return () => { cancelled = true }
  }, [file, opts.formPage])

  const pointFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
    return {
      x: Math.round(x * (pdfDims.width / rect.width)),
      y: Math.round(y * (pdfDims.height / rect.height)),
    }
  }

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(e)
    if (!point) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragStart(point)
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return
    const point = pointFromEvent(e)
    if (!point) return
    setDraft({
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    })
  }

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (draft && draft.width > 5 && draft.height > 5) {
      opt('formX', draft.x)
      opt('formY', draft.y)
      opt('formWidth', Math.max(12, draft.width))
      opt('formHeight', Math.max(12, draft.height))
    }
    setDragStart(null)
    setDraft(null)
  }

  const box = draft ?? { x: opts.formX, y: opts.formY, width: opts.formWidth, height: opts.formHeight }
  // Also overlay queued fields on this page
  const queuedOnPage: any[] = opts.formFields.filter((f: any) => f.pageIndex === opts.formPage - 1)
  const img = imgRef.current
  const sx = img?.clientWidth ? img.clientWidth / pdfDims.width : 1
  const sy = img?.clientHeight ? img.clientHeight / pdfDims.height : 1

  if (!preview) return <div style={{ fontSize: 12, color: '#8888aa' }}>Loading page preview…</div>

  return (
    <div>
      <div style={{ fontSize: 11, color: '#7777aa', marginBottom: 6 }}>🖱️ Drag on the page to position the field. Queued fields show in green.</div>
      <div
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ position: 'relative', maxWidth: 520, border: '1px solid #d0d0f0', borderRadius: 8, overflow: 'hidden', touchAction: 'none', cursor: 'crosshair', background: '#f8f8ff', userSelect: 'none' }}
      >
        <img ref={imgRef} src={preview} alt="Form field placement preview" style={{ display: 'block', width: '100%', pointerEvents: 'none' }} />
        {/* Queued fields */}
        {queuedOnPage.map((f: any, i: number) => (
          <div key={i} style={{ position: 'absolute', left: f.x * sx, top: f.y * sy, width: f.width * sx, height: f.height * sy, background: 'rgba(16,185,129,0.13)', border: '1.5px solid #10b981', pointerEvents: 'none', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <span style={{ fontSize: 9, color: '#059669', fontWeight: 700, background: 'rgba(255,255,255,0.85)', padding: '1px 4px', borderRadius: 2, whiteSpace: 'nowrap' }}>{f.type}</span>
          </div>
        ))}
        {/* Current draft */}
        <div style={{ position: 'absolute', left: box.x * sx, top: box.y * sy, width: Math.max(2, box.width * sx), height: Math.max(2, box.height * sy), background: 'rgba(16,185,129,0.13)', border: '2px dashed #10b981', pointerEvents: 'none', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {box.width * sx > 40 && <span style={{ fontSize: 10, color: '#059669', fontWeight: 700, background: 'rgba(255,255,255,0.8)', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>{opts.formType}</span>}
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: '#aaaacc' }}>
        Position: X={opts.formX} · Y={opts.formY} · {opts.formWidth}×{opts.formHeight} pts
      </div>
    </div>
  )
}

function SignatureDesigner({ file, opts, opt, signatureDataUrl }: { file: File; opts: any; opt: (key: string, value: any) => void; signatureDataUrl: string | null }) {
  const PREVIEW_SCALE = 0.5
  const [preview, setPreview] = useState('')
  const [pdfDims, setPdfDims] = useState({ width: 595, height: 842 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let cancelled = false
    setPreview('')
    renderPageToDataUrl(file, Math.max(0, opts.signPage - 1), PREVIEW_SCALE)
      .then(url => {
        if (cancelled) return
        const img = new Image()
        img.onload = () => setPdfDims({ width: img.naturalWidth / PREVIEW_SCALE, height: img.naturalHeight / PREVIEW_SCALE })
        img.src = url
        setPreview(url)
      })
      .catch(() => { if (!cancelled) setPreview('') })
    return () => { cancelled = true }
  }, [file, opts.signPage])

  const pointFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
    return {
      x: x * (pdfDims.width / rect.width),
      y: y * (pdfDims.height / rect.height),
    }
  }

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(e)
    if (!point) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragStart(point)
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return
    const point = pointFromEvent(e)
    if (!point) return
    setDraft({
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    })
  }

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (draft && draft.width > 8 && draft.height > 8) {
      opt('signX', Math.round(draft.x))
      opt('signY', Math.round(draft.y))
      opt('signWidth', Math.round(draft.width))
      opt('signHeight', Math.round(draft.height))
    }
    setDragStart(null)
  }

  const box = draft ?? { x: opts.signX, y: opts.signY, width: opts.signWidth, height: opts.signHeight }
  const img = imgRef.current
  const sx = img?.clientWidth ? img.clientWidth / pdfDims.width : 1
  const sy = img?.clientHeight ? img.clientHeight / pdfDims.height : 1

  if (!preview) return <div style={{ fontSize: 12, color: '#8888aa' }}>Loading page preview...</div>

  return (
    <div>
      <div style={{ fontSize: 11, color: '#8888aa', marginBottom: 6 }}>Drag on the page to choose where the signature will appear.</div>
      <div
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ position: 'relative', maxWidth: 520, border: '1px solid #d0d0f0', borderRadius: 8, overflow: 'hidden', touchAction: 'none', cursor: 'crosshair', background: '#f8f8ff' }}
      >
        <img ref={imgRef} src={preview} alt="Signature page preview" style={{ display: 'block', width: '100%', userSelect: 'none', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: box.x * sx, top: box.y * sy, width: box.width * sx, height: box.height * sy, border: '2px dashed #a78bfa', background: 'rgba(108,99,255,0.08)', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {signatureDataUrl ? (
            <img src={signatureDataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 0.9 }} />
          ) : (
            <span style={{ color: '#a78bfa', fontSize: 11, fontWeight: 700 }}>Signature</span>
          )}
        </div>
      </div>
    </div>
  )
}

function PDFEditDesigner({ file, opts, opt }: { file: File; opts: any; opt: (key: string, value: any) => void }) {
  const [preview, setPreview] = useState('')
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [livePts, setLivePts] = useState<{ x: number; y: number }[]>([])
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let cancelled = false
    setPreview('')
    renderPageToDataUrl(file, Math.max(0, opts.editPage - 1), 1)
      .then(url => { if (!cancelled) setPreview(url) })
      .catch(() => { if (!cancelled) setPreview('') })
    return () => { cancelled = true }
  }, [file, opts.editPage])

  const pointFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const cx = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const cy = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
    return {
      x: cx * (img.naturalWidth / rect.width),
      y: cy * (img.naturalHeight / rect.height),
    }
  }

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(e)
    if (!point) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragStart(point)
    opt('editX', Math.round(point.x))
    opt('editY', Math.round(point.y))
    if (opts.editMode === 'freehand') {
      setLivePts([point])
      opt('editPoints', [point])
    } else if (opts.editMode === 'text' || opts.editMode === 'sticky-note') {
      opt('editWidth', opts.editMode === 'sticky-note' ? 180 : 220)
      opt('editHeight', opts.editMode === 'sticky-note' ? 120 : Math.max(24, opts.editFontSize + 12))
    } else if (opts.editMode === 'image' && opts.editWidth < 2) {
      opt('editWidth', 220)
      opt('editHeight', 140)
    }
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(e)
    if (!point) return
    if (opts.editMode === 'freehand') {
      if (!dragStart) return
      setLivePts(pts => [...pts, point])
      return
    }
    if (!dragStart || opts.editMode === 'text' || opts.editMode === 'sticky-note') return
    opt('editX', Math.round(Math.min(dragStart.x, point.x)))
    opt('editY', Math.round(Math.min(dragStart.y, point.y)))
    opt('editWidth', Math.round(Math.max(1, Math.abs(point.x - dragStart.x))))
    opt('editHeight', Math.round(Math.max(1, Math.abs(point.y - dragStart.y))))
  }

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (opts.editMode === 'freehand' && livePts.length > 1) {
      opt('editPoints', livePts)
    }
    setDragStart(null)
  }

  const makeItem = () => ({
    kind: opts.editMode,
    pageIndex: opts.editPage - 1,
    text: opts.editText,
    x: opts.editX,
    y: opts.editY,
    width: opts.editWidth,
    height: opts.editMode === 'line' || opts.editMode === 'arrow' ? opts.editLineWidth : opts.editHeight,
    x2: opts.editX + opts.editWidth,
    y2: opts.editY + opts.editHeight,
    fontSize: opts.editFontSize,
    fontFamily: opts.editFontFamily,
    bold: opts.editFontBold,
    italic: opts.editFontItalic,
    underline: opts.editFontUnderline,
    strikethrough: opts.editFontStrike,
    color: opts.editColor,
    opacity: opts.editOpacity,
    imageDataUrl: opts.editImageDataUrl,
    points: opts.editMode === 'freehand' ? (opts.editPoints?.length > 1 ? opts.editPoints : livePts) : undefined,
  })

  const addItem = () => {
    if (opts.editMode === 'text' && !opts.editText.trim()) return
    if (opts.editMode === 'sticky-note' && !opts.editText.trim()) return
    if (opts.editMode === 'image' && !opts.editImageDataUrl) return
    if (opts.editMode === 'freehand' && livePts.length < 2 && (!opts.editPoints || opts.editPoints.length < 2)) return
    opt('editItems', [...opts.editItems, makeItem()])
    if (opts.editMode === 'freehand') { setLivePts([]); opt('editPoints', []) }
  }

  const img = imgRef.current
  const sx = img?.naturalWidth ? img.clientWidth / img.naturalWidth : 1
  const sy = img?.naturalHeight ? img.clientHeight / img.naturalHeight : 1
  const current = makeItem()
  const pageItems = [...opts.editItems, current].filter((item: any) => item.pageIndex === opts.editPage - 1)

  const renderOverlay = (item: any, index: number) => {
    const isCurrent = index === pageItems.length - 1
    const color = item.kind === 'whiteout' ? '#fff' : (item.color || '#111111')
    const opacity = item.kind === 'highlight' ? Math.min(item.opacity ?? 1, 0.45) : (item.opacity ?? 1)
    const common: React.CSSProperties = {
      position: 'absolute',
      left: item.x * sx,
      top: item.y * sy,
      pointerEvents: 'none',
      opacity,
      outline: isCurrent ? '1.5px dashed #6c63ff' : 'none',
    }

    if (item.kind === 'text') {
      return (
        <div key={index} style={{ ...common, color, fontSize: Math.max(8, (item.fontSize ?? 14) * sy), fontFamily: item.fontFamily || 'Arial', fontStyle: item.italic ? 'italic' : 'normal', fontWeight: item.bold ? 700 : 400, textDecoration: [item.underline ? 'underline' : '', item.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none', whiteSpace: 'pre-wrap', maxWidth: 320 }}>
          {item.text || 'Text'}
        </div>
      )
    }

    if (item.kind === 'sticky-note') {
      return (
        <div key={index} style={{ ...common, width: (item.width || 180) * sx, height: (item.height || 120) * sy, background: '#fffacd', border: '1px solid #e6c000', borderRadius: 4, padding: '4px 6px', overflow: 'hidden' }}>
          <div style={{ fontSize: Math.max(7, (item.fontSize ?? 12) * sy), color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.3 }}>{item.text || 'Note'}</div>
        </div>
      )
    }

    if (item.kind === 'line') {
      return <div key={index} style={{ ...common, width: item.width * sx, height: Math.max(2, (item.height ?? 2) * sy), background: color }} />
    }

    if (item.kind === 'arrow') {
      const x1 = item.x * sx, y1 = item.y * sy
      const x2 = (item.x2 ?? item.x + (item.width ?? 50)) * sx
      const y2 = (item.y2 ?? item.y) * sy
      const angle = Math.atan2(y2 - y1, x2 - x1)
      const hLen = 12
      return (
        <svg key={index} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity }}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} />
          <polygon points={`${x2},${y2} ${x2 - hLen * Math.cos(angle - Math.PI / 6)},${y2 - hLen * Math.sin(angle - Math.PI / 6)} ${x2 - hLen * Math.cos(angle + Math.PI / 6)},${y2 - hLen * Math.sin(angle + Math.PI / 6)}`} fill={color} />
        </svg>
      )
    }

    if (item.kind === 'circle') {
      return <div key={index} style={{ ...common, width: item.width * sx, height: item.height * sy, border: `2px solid ${color}`, borderRadius: '50%', background: 'transparent' }} />
    }

    if (item.kind === 'freehand' && item.points && item.points.length > 1) {
      return (
        <svg key={index} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity }}>
          <polyline points={item.points.map((p: any) => `${p.x * sx},${p.y * sy}`).join(' ')} fill="none" stroke={color} strokeWidth={Math.max(1.5, (item.height ?? 2) * sy * 0.5)} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    }

    if (item.kind === 'image') {
      return item.imageDataUrl ? (
        <img key={index} src={item.imageDataUrl} alt="" style={{ ...common, width: item.width * sx, height: item.height * sy, objectFit: 'contain', background: 'transparent' }} />
      ) : (
        <div key={index} style={{ ...common, width: item.width * sx, height: item.height * sy, border: '1px dashed #6c63ff', color: '#a78bfa', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Image</div>
      )
    }

    return (
      <div key={index} style={{ ...common, width: item.width * sx, height: item.height * sy, background: color, border: item.kind === 'whiteout' ? '1px solid rgba(0,0,0,0.2)' : 'none' }} />
    )
  }

  // live freehand stroke overlay while drawing
  const liveFreehandOverlay = opts.editMode === 'freehand' && dragStart && livePts.length > 1 ? (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: opts.editOpacity ?? 1 }}>
      <polyline points={livePts.map(p => `${p.x * sx},${p.y * sy}`).join(' ')} fill="none" stroke={opts.editColor || '#111'} strokeWidth={Math.max(1.5, opts.editLineWidth * sy * 0.5)} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : null

  const cursorStyle = opts.editMode === 'freehand' ? 'crosshair' : opts.editMode === 'text' || opts.editMode === 'sticky-note' || opts.editMode === 'image' ? 'pointer' : 'crosshair'

  if (!preview) return <div style={{ fontSize: 12, color: '#8888aa' }}>Loading page preview...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ position: 'relative', border: '1.5px solid #d0d0f0', borderRadius: 8, overflow: 'hidden', touchAction: 'none', cursor: cursorStyle, background: '#f8f8ff' }}
      >
        <img ref={imgRef} src={preview} alt="PDF edit preview" style={{ display: 'block', width: '100%', userSelect: 'none', pointerEvents: 'none' }} />
        {pageItems.map(renderOverlay)}
        {liveFreehandOverlay}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={addItem} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>＋ Add to Page</button>
        <button onClick={() => opt('editItems', opts.editItems.slice(0, -1))} disabled={!opts.editItems.length} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e0e0f0', background: '#f8f8ff', color: opts.editItems.length ? '#8888aa' : '#ccccdd', fontSize: 12, cursor: opts.editItems.length ? 'pointer' : 'not-allowed' }}>↩ Undo</button>
        <button onClick={() => opt('editItems', [])} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fff5f5', color: '#ef4444', fontSize: 12, cursor: 'pointer' }}>🗑 Clear All</button>
        <span style={{ fontSize: 11, color: '#8888aa', marginLeft: 4 }}>{opts.editItems.length} item{opts.editItems.length === 1 ? '' : 's'} queued</span>
      </div>
      {opts.editItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto', border: '1px solid #e0e0f0', borderRadius: 8, padding: '6px 8px', background: '#fafafe' }}>
          {opts.editItems.map((item: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span style={{ flex: 1, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {i + 1}. {item.kind} — p.{item.pageIndex + 1}
                {item.text ? ` "${item.text.substring(0, 20)}${item.text.length > 20 ? '…' : ''}"` : ''}
              </span>
              <button onClick={() => opt('editItems', opts.editItems.filter((_: any, j: number) => j !== i))} style={{ padding: '2px 7px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff5f5', color: '#ef4444', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── INLINE TEXT EDITOR ────────────────────────────────────────────────────────
function PDFInlineTextEditor({ file, opts, opt }: { file: File; opts: any; opt: (key: string, value: any) => void }) {
  type TItem = { str: string; x: number; y: number; width: number; height: number; fontSize: number }
  const [textItems, setTextItems] = useState<TItem[]>([])
  const [preview, setPreview] = useState('')
  const [pdfDims, setPdfDims] = useState({ width: 595, height: 842 })
  const [editValues, setEditValues] = useState<string[]>([])
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [loadMessage, setLoadMessage] = useState('')
  const imgRef = useRef<HTMLImageElement>(null)
  const SCALE = 1.5

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setPreview('')
        setTextItems([])
        setEditValues([])
        setLoadMessage('Loading page...')
        const pdfjsLib = await import('pdfjs-dist')
        const bytes = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise
        const pageNum = Math.min(Math.max(1, opts.editPage), pdf.numPages)
        const page = await pdf.getPage(pageNum)
        const vp = page.getViewport({ scale: SCALE })
        const pdfW = vp.width / SCALE
        const pdfH = vp.height / SCALE
        if (!cancelled) setPdfDims({ width: pdfW, height: pdfH })

        // Render preview image
        const canvas = document.createElement('canvas')
        canvas.width = vp.width
        canvas.height = vp.height
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx, viewport: vp, canvas } as any).promise
        if (!cancelled) setPreview(canvas.toDataURL('image/jpeg', 0.92))

        // Extract text items with positions
        const content = await page.getTextContent()
        const items: TItem[] = (content.items as any[])
          .filter(it => it.str?.trim())
          .map(it => {
            const t = it.transform
            const fontSize = Math.abs(t[3]) || Math.abs(t[0]) || 12
            return {
              str: it.str,
              x: t[4],
              y: t[5],  // PDF bottom-left origin
              width: it.width > 0 ? it.width : fontSize * it.str.length * 0.55,
              height: it.height > 0 ? it.height : fontSize * 1.3,
              fontSize,
            }
          })
        if (!cancelled) {
          setTextItems(items)
          setEditValues(items.map(it => it.str))
          setEditingIdx(null)
          setLoadMessage(items.length ? '' : 'This page is scanned or image-only. Use Whiteout + Add Text, or run OCR first.')
        }
      } catch (e) {
        console.error('PDFInlineTextEditor load error', e)
        if (!cancelled) setLoadMessage('Could not load editable text. Use Add Text or Whiteout for scanned PDFs.')
      }
    }
    load()
    return () => { cancelled = true }
  }, [file, opts.editPage])

  // Convert PDF coords (bottom-left origin) → screen coords (top-left origin)
  const toScreen = (item: TItem) => {
    const img = imgRef.current
    if (!img || !img.clientWidth) return { left: 0, top: 0, width: 60, height: 14, fs: 12 }
    const sx = img.clientWidth / (pdfDims.width * SCALE)
    const sy = img.clientHeight / (pdfDims.height * SCALE)
    return {
      left: item.x * SCALE * sx,
      top: (pdfDims.height - item.y - item.height) * SCALE * sy,
      width: Math.max(item.width * SCALE * sx, 20),
      height: Math.max(item.height * SCALE * sy, 8),
      fs: Math.max(item.fontSize * SCALE * Math.min(sx, sy), 8),
    }
  }

  const applyChanges = () => {
    const newItems: any[] = [...opts.editItems]
    let queued = 0
    for (let i = 0; i < textItems.length; i++) {
      if (editValues[i] === textItems[i].str) continue
      const it = textItems[i]
      const yTop = pdfDims.height - it.y - it.height  // top-origin y for applyPDFEdits
      // Whiteout the original text
      newItems.push({ kind: 'whiteout', pageIndex: opts.editPage - 1, x: Math.max(0, it.x - 1), y: Math.max(0, yTop - 2), width: it.width + 3, height: it.height + 4, color: '#ffffff', opacity: 1 })
      // Write the new text
      newItems.push({ kind: 'text', pageIndex: opts.editPage - 1, x: it.x, y: yTop, text: editValues[i], fontSize: it.fontSize, color: '#111111', opacity: 1 })
      queued++
    }
    opt('editItems', newItems)
    if (queued) {
      setTextItems(items => items.map((item, index) => ({ ...item, str: editValues[index] ?? item.str })))
    }
  }

  const changedCount = editValues.filter((v, i) => v !== textItems[i]?.str).length

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flex: '1 1 400px', border: '1px solid #d0d0f0', borderRadius: 8, overflow: 'hidden', background: '#f8f8ff', minHeight: 200 }}>
        {preview ? (
          <>
            <img ref={imgRef} src={preview} alt="PDF page" style={{ display: 'block', width: '100%', userSelect: 'none', pointerEvents: 'none' }} />
            {textItems.map((item, i) => {
              const s = toScreen(item)
              const changed = editValues[i] !== item.str
              if (editingIdx === i) {
                return (
                  <input
                    key={i}
                    autoFocus
                    value={editValues[i]}
                    onChange={e => setEditValues(prev => { const n = [...prev]; n[i] = e.target.value; return n })}
                    onBlur={() => setEditingIdx(null)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditingIdx(null) } }}
                    style={{ position: 'absolute', left: s.left, top: s.top, width: Math.max(s.width, 80), fontSize: s.fs, lineHeight: 1, background: '#fffde7', border: '2px solid #f59e0b', borderRadius: 2, padding: '0 2px', outline: 'none', color: '#111', zIndex: 20, fontFamily: 'sans-serif' }}
                  />
                )
              }
              return (
                <div
                  key={i}
                  title={`"${item.str}" — click to edit`}
                  onClick={() => setEditingIdx(i)}
                  style={{ position: 'absolute', left: s.left, top: s.top, width: s.width, height: s.height, cursor: 'text', background: changed ? 'rgba(245,158,11,0.25)' : 'transparent', border: changed ? '1px solid #f59e0b' : '1px solid transparent', borderRadius: 2, zIndex: 10, transition: 'border-color 0.1s, background 0.1s' }}
                  onMouseEnter={e => { if (!changed) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(108,99,255,0.6)' }}
                  onMouseLeave={e => { if (!changed) (e.currentTarget as HTMLElement).style.borderColor = 'transparent' }}
                />
              )
            })}
          </>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: loadMessage.startsWith('Loading') ? '#8888aa' : '#d97706', fontSize: 13 }}>{loadMessage || 'Loading page...'}</div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 130 }}>
        {preview && !textItems.length && (
          <div style={{ fontSize: 11, color: '#d97706', background: '#fffaeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
            This page is scanned. Switch to Whiteout to cover old text, then Add Text to type the replacement.
          </div>
        )}
        <div style={{ fontSize: 11, color: '#6366f1', background: '#eef0ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
          Click text to replace it. Saved edits are burned into the page so the old text is removed visually.
        </div>
        <button onClick={applyChanges} disabled={!changedCount} style={{ padding: '9px 12px', borderRadius: 8, border: 'none', background: changedCount ? '#eef0ff' : '#f5f5ff', color: changedCount ? '#6366f1' : '#ccccdd', fontSize: 12, fontWeight: 700, cursor: changedCount ? 'pointer' : 'not-allowed' }}>
          Apply {changedCount || ''} Change{changedCount !== 1 ? 's' : ''}
        </button>
        <button onClick={() => setEditValues(textItems.map(it => it.str))} disabled={!changedCount} style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #e0e0f0', background: '#f8f8ff', color: changedCount ? '#8888aa' : '#ccccdd', fontSize: 12, cursor: changedCount ? 'pointer' : 'not-allowed' }}>
          Reset All
        </button>
        <div style={{ fontSize: 11, color: '#8888aa' }}>{changedCount} change{changedCount !== 1 ? 's' : ''} pending</div>
        {opts.editItems.length > 0 && <div style={{ fontSize: 11, color: '#10b981' }}>{opts.editItems.length} edit{opts.editItems.length === 1 ? '' : 's'} queued → Save PDF</div>}
      </div>
    </div>
  )
}

function ToolOptions({ file, tool, opts, opt, canvasRef, startDraw, draw, endDraw, clearSig, signatureDataUrl }: any) {
  const S: React.CSSProperties = { marginTop: 0 }
  const lbl: React.CSSProperties = { fontSize: 12, color: '#7777aa', display: 'block', marginBottom: 6 }
  const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 8, background: '#f8f8ff', border: '1.5px solid #e0e0f0', color: '#1a1a3a', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
  const row: React.CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap' as const }
  const half: React.CSSProperties = { flex: 1, minWidth: 140 }
  const btnRow = (options: [any, string][], key: string) => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(([v, l]) => (
        <button key={String(v)} onClick={() => opt(key, v)} style={{ flex: 1, minWidth: 90, padding: '9px 6px', borderRadius: 9, border: `1px solid ${opts[key] === v ? '#6366f1' : '#e0e0f0'}`, background: opts[key] === v ? '#eef0ff' : '#f8f8ff', color: opts[key] === v ? '#6366f1' : '#8888aa', fontSize: 12, fontWeight: opts[key] === v ? 600 : 400, cursor: 'pointer' }}>{l}</button>
      ))}
    </div>
  )
  const loadEditImage = (imageFile: File | undefined) => {
    if (!imageFile) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      opt('editImageDataUrl', dataUrl)
      const img = new Image()
      img.onload = () => {
        const maxWidth = 260
        const scale = Math.min(1, maxWidth / Math.max(1, img.naturalWidth))
        opt('editWidth', Math.round(img.naturalWidth * scale))
        opt('editHeight', Math.round(img.naturalHeight * scale))
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(imageFile)
  }

  const optionMap: Record<string, React.ReactNode> = {
    split: (
      <div style={S}>
        <div style={{ ...lbl, marginBottom: 10 }}>Split Method</div>
        {btnRow([['range', '📋 By Ranges'], ['every', '📄 Every N Pages'], ['all', '✂️ Every Page']], 'splitMode')}
        {opts.splitMode === 'range' && <div style={{ marginTop: 12 }}><label style={lbl}>Page ranges (e.g. 1-3, 5, 7-9)</label><input value={opts.splitRange} onChange={e => opt('splitRange', e.target.value)} placeholder="1-3, 5, 7-9" style={inp} /></div>}
        {opts.splitMode === 'every' && <div style={{ marginTop: 12 }}><label style={lbl}>Pages per part</label><input type="number" min={1} value={opts.everyN} onChange={e => opt('everyN', +e.target.value)} style={inp} /></div>}
      </div>
    ),
    rotate: (
      <div style={S}>
        <label style={lbl}>Rotation Angle</label>
        {btnRow([[90, '↻ 90° Right'], [-90, '↺ 90° Left'], [180, '↻ 180°']], 'angle')}
      </div>
    ),
    compress: (
      <div style={S}>
        <label style={lbl}>Compression Level</label>
        {btnRow([['low', '🟢 Standard — No quality loss'], ['medium', '🟡 Medium — Rasterized'], ['high', '🔴 Maximum — Smallest file']], 'compressLevel')}
        <div style={{ marginTop: 10, fontSize: 11, color: '#8888aa', background: '#f5f5ff', border: '1px solid #e8e8f5', borderRadius: 8, padding: '8px 12px', lineHeight: 1.6 }}>
          <strong style={{ color: '#5555aa' }}>Standard</strong> re-saves the PDF without quality changes — best for preserving text and form fields.<br />
          <strong style={{ color: '#5555aa' }}>Medium / Maximum</strong> rasterize pages to images — flattens text into pixels but achieves smaller file sizes. Effectiveness depends on the PDF's content; image-heavy PDFs compress best.
        </div>
      </div>
    ),
    crop: (
      <div style={S}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 12px' }}>
            ⚠️ Standard crop <strong style={{ color: '#fbbf24' }}>hides</strong> content outside the selected area — the original data is still inside the PDF file. To permanently destroy hidden content, enable <strong style={{ color: '#fbbf24' }}>Destroy Hidden Content</strong> below.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#1a1a3a', cursor: 'pointer', padding: '8px 12px', border: `1px solid ${opts.cropRasterize ? 'rgba(245,158,11,0.5)' : '#e0e0f0'}`, borderRadius: 8, background: opts.cropRasterize ? '#fffaeb' : '#f8f8ff', userSelect: 'none' }}>
            <input type="checkbox" checked={opts.cropRasterize} onChange={e => opt('cropRasterize', e.target.checked)} style={{ accentColor: '#f59e0b', width: 14, height: 14 }} />
            <span>Destroy hidden content <span style={{ color: '#888', fontWeight: 400 }}>(converts pages to images — slower, irreversible)</span></span>
          </label>
          <CropDesigner file={file} opts={opts} opt={opt} />
          <div style={row}>
            <div style={half}><label style={lbl}>Page</label><input type="number" min={1} value={opts.cropPage} onChange={e => opt('cropPage', +e.target.value)} style={inp} /></div>
            <label style={{ ...half, display: 'flex', alignItems: 'center', gap: 8, color: '#888', fontSize: 12, marginTop: 23 }}>
              <input type="checkbox" checked={opts.cropAllPages} onChange={e => opt('cropAllPages', e.target.checked)} /> Apply to all pages
            </label>
          </div>
          <div style={row}>
            <div style={half}><label style={lbl}>X</label><input type="number" min={0} value={opts.cropX} onChange={e => opt('cropX', +e.target.value)} style={inp} /></div>
            <div style={half}><label style={lbl}>Y</label><input type="number" min={0} value={opts.cropY} onChange={e => opt('cropY', +e.target.value)} style={inp} /></div>
          </div>
          <div style={row}>
            <div style={half}><label style={lbl}>Width</label><input type="number" min={1} value={opts.cropWidth} onChange={e => opt('cropWidth', +e.target.value)} style={inp} /></div>
            <div style={half}><label style={lbl}>Height</label><input type="number" min={1} value={opts.cropHeight} onChange={e => opt('cropHeight', +e.target.value)} style={inp} /></div>
          </div>
        </div>
      </div>
    ),    'edit-pdf': (
      <div style={S}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ── Tool Toolbar ── */}
          <div>
            <label style={lbl}>Tool</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                ['edit-existing', '✏️', 'Edit Text'],
                ['text',          '🔤', 'Add Text'],
                ['sticky-note',   '📌', 'Sticky Note'],
                ['highlight',     '🖍️', 'Highlight'],
                ['rectangle',     '⬜', 'Rectangle'],
                ['circle',        '⭕', 'Circle'],
                ['arrow',         '➡️', 'Arrow'],
                ['line',          '➖', 'Line'],
                ['freehand',      '✍️', 'Freehand'],
                ['image',         '🖼️', 'Image'],
                ['whiteout',      '⬛', 'Whiteout'],
              ] as [string, string, string][]).map(([v, ic, label]) => (
                <button key={v} onClick={() => opt('editMode', v)} title={label} style={{ padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${opts.editMode === v ? '#6366f1' : '#e0e0f0'}`, background: opts.editMode === v ? '#eef0ff' : '#f8f8ff', color: opts.editMode === v ? '#6366f1' : '#555', fontSize: 12, cursor: 'pointer', fontWeight: opts.editMode === v ? 700 : 400, whiteSpace: 'nowrap' }}>
                  {ic} {label}
                </button>
              ))}
            </div>
          </div>

          {opts.editMode === 'edit-existing' ? (
            <>
              <div style={{ fontSize: 11, color: '#6366f1', background: '#eef0ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 12px' }}>
                Click text to replace it. Hit Enter or click away to confirm, then click <strong>Apply Changes</strong> and <strong>Save PDF</strong>. Edited pages are flattened so the old text is not left underneath.
              </div>
              <div style={row}><div style={half}><label style={lbl}>Page</label><input type="number" min={1} value={opts.editPage} onChange={e => opt('editPage', +e.target.value)} style={inp} /></div></div>
              <PDFInlineTextEditor file={file} opts={opts} opt={opt} />
            </>
          ) : (
            <>
              {/* ── Text / Note content ── */}
              {(opts.editMode === 'text' || opts.editMode === 'sticky-note') && (
                <>
                  <div><label style={lbl}>{opts.editMode === 'sticky-note' ? 'Note Text' : 'Text Content'}</label><textarea value={opts.editText} onChange={e => opt('editText', e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} /></div>
                  {/* Font controls */}
                  <div style={row}>
                    <div style={half}>
                      <label style={lbl}>Font Family</label>
                      <select value={opts.editFontFamily} onChange={e => opt('editFontFamily', e.target.value)} style={inp}>
                        {['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS'].map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div style={half}>
                      <label style={lbl}>Font Size</label>
                      <input type="number" min={6} max={120} value={opts.editFontSize} onChange={e => opt('editFontSize', +e.target.value)} style={inp} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {([['editFontBold', '𝐁', 'Bold'], ['editFontItalic', '𝐼', 'Italic'], ['editFontUnderline', 'U̲', 'Underline'], ['editFontStrike', 'S̶', 'Strikethrough']] as [string, string, string][]).map(([key, ic, label]) => (
                      <button key={key} onClick={() => opt(key, !opts[key])} title={label} style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${opts[key] ? '#6366f1' : '#e0e0f0'}`, background: opts[key] ? '#eef0ff' : '#f8f8ff', color: opts[key] ? '#6366f1' : '#555', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{ic}</button>
                    ))}
                  </div>
                </>
              )}

              {/* ── Image picker ── */}
              {opts.editMode === 'image' && (
                <div>
                  <label style={lbl}>Image File</label>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => loadEditImage(e.target.files?.[0])} style={inp} />
                  {opts.editImageDataUrl && <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}><img src={opts.editImageDataUrl} alt="" style={{ width: 54, height: 40, objectFit: 'contain', border: '1px solid #e0e0f0', borderRadius: 6 }} /><span style={{ fontSize: 11, color: '#10b981' }}>✓ Image ready — drag on preview to position</span></div>}
                </div>
              )}

              {/* ── Stroke / line width for drawing tools ── */}
              {(opts.editMode === 'line' || opts.editMode === 'arrow' || opts.editMode === 'freehand') && (
                <div><label style={lbl}>Stroke Width: {opts.editLineWidth}px</label>
                  <input type="range" min={1} max={20} step={1} value={opts.editLineWidth} onChange={e => opt('editLineWidth', +e.target.value)} style={{ width: '100%', accentColor: '#6c63ff' }} />
                </div>
              )}

              {/* ── Color & opacity (not for image) ── */}
              {opts.editMode !== 'image' && (
                <div style={row}>
                  <div style={half}><label style={lbl}>Color</label><input type="color" value={opts.editColor} onChange={e => opt('editColor', e.target.value)} style={{ ...inp, height: 38, padding: 4 }} /></div>
                  <div style={half}><label style={lbl}>Opacity: {Math.round(opts.editOpacity * 100)}%</label><input type="range" min={0.1} max={1} step={0.05} value={opts.editOpacity} onChange={e => opt('editOpacity', +e.target.value)} style={{ width: '100%', accentColor: '#6c63ff', marginTop: 8 }} /></div>
                </div>
              )}

              {/* ── Page selector ── */}
              <div style={row}><div style={half}><label style={lbl}>Page</label><input type="number" min={1} value={opts.editPage} onChange={e => opt('editPage', +e.target.value)} style={inp} /></div></div>

              {/* ── Canvas preview & item management ── */}
              <div style={{ fontSize: 11, color: '#7777aa', background: '#eef0ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 12px' }}>
                {opts.editMode === 'freehand' ? '✍️ Click and drag to draw freely on the page.' :
                 opts.editMode === 'text' || opts.editMode === 'sticky-note' ? '🖱️ Click on the page to place the item at that position.' :
                 opts.editMode === 'image' ? '🖱️ Drag on the page to set the image position and size.' :
                 '🖱️ Drag on the page to draw the shape. Click ＋ Add to Page to queue it.'}
              </div>
              <PDFEditDesigner file={file} opts={opts} opt={opt} />
            </>
          )}
        </div>
      </div>
    ),
    forms: (
      <div style={S}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '8px 12px' }}>
            <strong>Step 1:</strong> Choose field type &amp; page, then drag on the preview to draw the field area. <strong>Step 2:</strong> Set name/label, then click <strong>Add Field</strong>. Repeat for multiple fields.
          </div>
          <div><label style={lbl}>Field Type</label>{btnRow([['text', 'Text'], ['checkbox', 'Checkbox'], ['dropdown', 'Dropdown'], ['radio', 'Radio'], ['signature', 'Signature']], 'formType')}</div>
          <div style={half}><label style={lbl}>Page</label><input type="number" min={1} value={opts.formPage} onChange={e => opt('formPage', +e.target.value)} style={inp} /></div>
          <FormFieldDesigner file={file} opts={opts} opt={opt} />
          <div style={row}>
            <div style={half}><label style={lbl}>Field Name</label><input value={opts.formName} onChange={e => opt('formName', e.target.value)} style={inp} /></div>
            <div style={half}><label style={lbl}>Label</label><input value={opts.formLabel} onChange={e => opt('formLabel', e.target.value)} style={inp} /></div>
          </div>
          {(opts.formType === 'dropdown' || opts.formType === 'radio') && <div><label style={lbl}>Options</label><input value={opts.formOptions} onChange={e => opt('formOptions', e.target.value)} placeholder="Yes, No, Maybe" style={inp} /></div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => opt('formFields', [...opts.formFields, { type: opts.formType, name: opts.formName, label: opts.formLabel, pageIndex: opts.formPage - 1, x: opts.formX, y: opts.formY, width: opts.formWidth, height: opts.formHeight, options: opts.formOptions.split(',').map((item: string) => item.trim()).filter(Boolean) }])} style={{ flex: 1, padding: '9px 12px', borderRadius: 8, background: '#ecfdf5', color: '#059669', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid #a7f3d0' }}>+ Add Field</button>
            <button onClick={() => opt('formFields', opts.formFields.slice(0, -1))} disabled={!opts.formFields.length} style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid #e0e0f0', background: '#f8f8ff', color: opts.formFields.length ? '#8888aa' : '#ccccdd', fontSize: 12, cursor: opts.formFields.length ? 'pointer' : 'not-allowed' }}>Undo Last</button>
          </div>
          <div style={{ fontSize: 11, color: opts.formFields.length ? '#059669' : '#8888aa' }}>
            {opts.formFields.length ? `${opts.formFields.length} field${opts.formFields.length === 1 ? '' : 's'} queued — click Save PDF to save the form` : 'No fields queued yet'}
          </div>
        </div>
      </div>
    ),
    links: (
      <div style={S}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px' }}>
            <strong>Step 1:</strong> Choose page &amp; drag on the preview to draw the link area. <strong>Step 2:</strong> Enter the URL below. Label is optional (visible blue text).
          </div>
          <div style={half}><label style={lbl}>Page</label><input type="number" min={1} value={opts.linkPage} onChange={e => opt('linkPage', +e.target.value)} style={inp} /></div>
          <LinkDesigner file={file} opts={opts} opt={opt} />
          <div><label style={lbl}>URL <span style={{ color: '#ef4444' }}>*</span></label><input value={opts.linkUrl} onChange={e => opt('linkUrl', e.target.value)} placeholder="https://example.com" style={{ ...inp, borderColor: opts.linkUrl.trim() && opts.linkUrl !== 'https://' ? '#e0e0f0' : '#fca5a5' }} /></div>
          <div><label style={lbl}>Visible Label <span style={{ fontWeight: 400, color: '#9999bb' }}>(optional — blank = invisible clickable area)</span></label><input value={opts.linkLabel} onChange={e => opt('linkLabel', e.target.value)} placeholder="Open link" style={inp} /></div>
        </div>
      </div>
    ),
    'pdf-to-word': (
      <div style={S}>
        <div style={{ marginBottom: 12, fontSize: 11, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', lineHeight: 1.6 }}>
          ℹ️ Conversion quality depends on the PDF's structure. Text-based PDFs extract well; scanned PDFs trigger OCR and may have imperfect formatting.
        </div>
        <label style={lbl}>OCR Language <span style={{ fontWeight: 400, color: '#9999bb' }}>(used automatically if PDF is scanned)</span></label>
        <select value={opts.ocrLang} onChange={e => opt('ocrLang', e.target.value)} style={inp}>
          <option value="eng">English</option>
          <option value="ara">Arabic</option>
          <option value="fra">French</option>
          <option value="deu">German</option>
          <option value="spa">Spanish</option>
          <option value="por">Portuguese</option>
          <option value="hin">Hindi</option>
          <option value="chi_sim">Chinese (Simplified)</option>
          <option value="jpn">Japanese</option>
          <option value="kor">Korean</option>
        </select>
      </div>
    ),
    'pdf-to-excel': (
      <div style={S}>
        <div style={{ marginBottom: 12, fontSize: 11, color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '8px 12px', lineHeight: 1.6 }}>
          ℹ️ Table extraction works best on text-based PDFs. Scanned PDFs trigger OCR — results may require cleanup in Excel.
        </div>
        <label style={lbl}>OCR Language <span style={{ fontWeight: 400, color: '#9999bb' }}>(used automatically if PDF is scanned)</span></label>
        <select value={opts.ocrLang} onChange={e => opt('ocrLang', e.target.value)} style={inp}>
          <option value="eng">English</option>
          <option value="ara">Arabic</option>
          <option value="fra">French</option>
          <option value="deu">German</option>
          <option value="spa">Spanish</option>
          <option value="por">Portuguese</option>
          <option value="hin">Hindi</option>
          <option value="chi_sim">Chinese (Simplified)</option>
          <option value="jpn">Japanese</option>
          <option value="kor">Korean</option>
        </select>
      </div>
    ),
    'pdf-to-text': (
      <div style={S}>
        <label style={lbl}>OCR Language <span style={{ fontWeight: 400, color: '#9999bb' }}>(used automatically if PDF is scanned)</span></label>
        <select value={opts.ocrLang} onChange={e => opt('ocrLang', e.target.value)} style={inp}>
          <option value="eng">English</option>
          <option value="ara">Arabic</option>
          <option value="fra">French</option>
          <option value="deu">German</option>
          <option value="spa">Spanish</option>
          <option value="por">Portuguese</option>
          <option value="hin">Hindi</option>
          <option value="chi_sim">Chinese (Simplified)</option>
          <option value="jpn">Japanese</option>
          <option value="kor">Korean</option>
        </select>
        <div style={{ fontSize: 11, color: '#8888aa', marginTop: 8 }}>Text-based PDFs extract instantly. Scanned PDFs trigger OCR automatically (10–30s per page).</div>
      </div>
    ),
    watermark: (
      <div style={S}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label style={lbl}>Watermark Text</label><input value={opts.watermarkText} onChange={e => opt('watermarkText', e.target.value)} placeholder="CONFIDENTIAL" style={inp} /></div>
            <div style={row}>
              <div style={half}><label style={lbl}>Opacity: {opts.watermarkOpacity}%</label><input type="range" min={5} max={100} value={opts.watermarkOpacity} onChange={e => opt('watermarkOpacity', +e.target.value)} style={{ width: '100%', accentColor: '#6c63ff' }} /></div>
              <div style={half}><label style={lbl}>Font Size: {opts.watermarkSize}px</label><input type="range" min={12} max={120} value={opts.watermarkSize} onChange={e => opt('watermarkSize', +e.target.value)} style={{ width: '100%', accentColor: '#6c63ff' }} /></div>
            </div>
            <div style={row}>
              <div style={half}><label style={lbl}>Position</label>
                <select value={opts.watermarkPosition} onChange={e => opt('watermarkPosition', e.target.value)} style={inp}>
                  {[['diagonal', 'Diagonal (center)'], ['center', 'Center'], ['top-left', 'Top Left'], ['top-right', 'Top Right'], ['bottom-left', 'Bottom Left'], ['bottom-right', 'Bottom Right']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div style={half}><label style={lbl}>Color</label><input type="color" value={opts.watermarkColor} onChange={e => opt('watermarkColor', e.target.value)} style={{ ...inp, height: 38, padding: 4 }} /></div>
            </div>
          </div>
          <PDFFirstPagePreview file={file} />
        </div>
      </div>
    ),
    'page-numbers': (
      <div style={S}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={row}>
              <div style={half}><label style={lbl}>Position</label>
                <select value={opts.pageNumPosition} onChange={e => opt('pageNumPosition', e.target.value)} style={inp}>
                  {[['bottom-center', 'Bottom Center'], ['bottom-right', 'Bottom Right'], ['bottom-left', 'Bottom Left'], ['top-center', 'Top Center']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div style={half}><label style={lbl}>Start Number</label><input type="number" min={1} value={opts.pageNumStart} onChange={e => opt('pageNumStart', +e.target.value)} style={inp} /></div>
            </div>
            <div><label style={lbl}>Format ({'{n}'} = page number, {'{total}'} = total pages)</label><input value={opts.pageNumFormat} onChange={e => opt('pageNumFormat', e.target.value)} style={inp} /></div>
          </div>
          <PDFFirstPagePreview file={file} />
        </div>
      </div>
    ),
    'header-footer': (
      <div style={S}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label style={lbl}>Header Text (top of every page)</label><input value={opts.headerText} onChange={e => opt('headerText', e.target.value)} placeholder="Company Name" style={inp} /></div>
            <div><label style={lbl}>Footer Text (bottom of every page)</label><input value={opts.footerText} onChange={e => opt('footerText', e.target.value)} placeholder="Confidential" style={inp} /></div>
            <div style={row}>
              <div style={half}><label style={lbl}>Font Size: {opts.hfFontSize}pt</label><input type="range" min={6} max={24} value={opts.hfFontSize} onChange={e => opt('hfFontSize', +e.target.value)} style={{ width: '100%', accentColor: '#6c63ff' }} /></div>
              <div style={half}><label style={lbl}>Color</label><input type="color" value={opts.hfColor} onChange={e => opt('hfColor', e.target.value)} style={{ ...inp, height: 38, padding: 4 }} /></div>
            </div>
          </div>
          <PDFFirstPagePreview file={file} />
        </div>
      </div>
    ),
    'image-to-pdf': (
      <div style={S}>
        <div style={row}>
          <div style={half}><label style={lbl}>Page Size</label>
            <select value={opts.pageSize} onChange={e => opt('pageSize', e.target.value)} style={inp}>
              <option value="A4">A4 (210×297mm)</option>
              <option value="Letter">Letter (8.5×11in)</option>
              <option value="fit">Fit to Image</option>
            </select>
          </div>
          <div style={half}><label style={lbl}>Orientation</label>
            <select value={opts.orientation} onChange={e => opt('orientation', e.target.value)} style={inp}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
        </div>
      </div>
    ),
    'pdf-to-jpg': (
      <div style={S}>
        <div style={row}>
          <div style={half}><label style={lbl}>Image Format</label>
            <select value={opts.imgFormat} onChange={e => opt('imgFormat', e.target.value)} style={inp}>
              <option value="jpeg">JPEG (smaller file)</option>
              <option value="png">PNG (lossless)</option>
            </select>
          </div>
          <div style={half}><label style={lbl}>Quality/Scale: {opts.imgScale}x</label><input type="range" min={1} max={4} step={0.5} value={opts.imgScale} onChange={e => opt('imgScale', +e.target.value)} style={{ width: '100%', accentColor: '#6c63ff', marginTop: 10 }} /></div>
        </div>
      </div>
    ),
    ocr: (
      <div style={S}>
        <div style={{ marginBottom: 12 }}><label style={lbl}>Output</label>{btnRow([['text', 'Text File'], ['searchable', 'Searchable PDF']], 'ocrOutput')}</div>
        <label style={lbl}>Language</label>
        <select value={opts.ocrLang} onChange={e => opt('ocrLang', e.target.value)} style={inp}>
          <option value="eng">English</option>
          <option value="ara">Arabic</option>
          <option value="fra">French</option>
          <option value="deu">German</option>
          <option value="spa">Spanish</option>
          <option value="por">Portuguese</option>
          <option value="hin">Hindi</option>
          <option value="chi_sim">Chinese (Simplified)</option>
          <option value="jpn">Japanese</option>
          <option value="kor">Korean</option>
        </select>
        <div style={{ fontSize: 11, color: '#8888aa', marginTop: 8 }}>⏱ OCR may take 10–30 seconds per page depending on image quality.</div>
      </div>
    ),
    protect: (
      <div style={S}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px' }}>
            Protect PDF creates a password-protected rasterized copy. The visual quality is preserved, but text and form fields become flattened.
          </div>
          <div>
            <label style={lbl}>Open Password <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              type="password"
              value={opts.userPassword}
              onChange={e => opt('userPassword', e.target.value)}
              placeholder="Required"
              style={{ ...inp, borderColor: opts.userPassword.trim() ? '#e0e0f0' : '#fca5a5' }}
            />
            {!opts.userPassword.trim() && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>A password is required</div>}
          </div>
          <div><label style={lbl}>Owner Password <span style={{ fontWeight: 400, color: '#9999bb' }}>(optional)</span></label><input type="password" value={opts.ownerPassword} onChange={e => opt('ownerPassword', e.target.value)} placeholder="Defaults to open password" style={inp} /></div>
        </div>
      </div>
    ),
    sign: (
      <div style={S}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#6366f1', background: '#eef0ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 12px' }}>
            Draw your signature, then drag on the page preview to place and size it.
          </div>
          <div><label style={lbl}>Page number</label><input type="number" min={1} value={opts.signPage} onChange={e => opt('signPage', +e.target.value)} style={inp} /></div>
          <SignatureDesigner file={file} opts={opts} opt={opt} signatureDataUrl={signatureDataUrl} />
          <label style={lbl}>Draw your signature below</label>
          <canvas ref={canvasRef} width={560} height={130}
            onPointerDown={startDraw} onPointerMove={draw} onPointerUp={endDraw} onPointerCancel={endDraw}
            style={{ border: '1.5px solid #c7d2fe', borderRadius: 10, background: '#ffffff', cursor: 'crosshair', touchAction: 'none', width: '100%', display: 'block' }} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={clearSig} style={{ padding: '6px 16px', borderRadius: 7, border: '1px solid #e0e0f0', background: '#f8f8ff', color: '#8888aa', fontSize: 12, cursor: 'pointer' }}>Clear</button>
            {signatureDataUrl && <span style={{ fontSize: 12, color: '#10b981' }}>✓ Signature ready</span>}
          </div>
          <div style={row}>
            <div style={half}><label style={lbl}>X (from left)</label><input type="number" min={0} value={opts.signX} onChange={e => opt('signX', +e.target.value)} style={inp} /></div>
            <div style={half}><label style={lbl}>Y (from top)</label><input type="number" min={0} value={opts.signY} onChange={e => opt('signY', +e.target.value)} style={inp} /></div>
          </div>
          <div style={row}>
            <div style={half}><label style={lbl}>Width</label><input type="number" min={20} value={opts.signWidth} onChange={e => opt('signWidth', +e.target.value)} style={inp} /></div>
            <div style={half}><label style={lbl}>Height</label><input type="number" min={10} value={opts.signHeight} onChange={e => opt('signHeight', +e.target.value)} style={inp} /></div>
          </div>
        </div>
      </div>
    ),
    redact: (
      <div style={S}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#d97706', background: '#fffaeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
            Redaction draws a permanent black rectangle over the selected area. Coordinates are measured from the top-left of the page in PDF points.
          </div>
          <RedactionDesigner file={file} opts={opts} opt={opt} />
          <div style={row}>
            <div style={half}><label style={lbl}>Page</label><input type="number" min={1} value={opts.redactPage} onChange={e => opt('redactPage', +e.target.value)} style={inp} /></div>
            <div style={half}><label style={lbl}>X</label><input type="number" min={0} value={opts.redactX} onChange={e => opt('redactX', +e.target.value)} style={inp} /></div>
            <div style={half}><label style={lbl}>Y</label><input type="number" min={0} value={opts.redactY} onChange={e => opt('redactY', +e.target.value)} style={inp} /></div>
          </div>
          <div style={row}>
            <div style={half}><label style={lbl}>Width</label><input type="number" min={1} value={opts.redactWidth} onChange={e => opt('redactWidth', +e.target.value)} style={inp} /></div>
            <div style={half}><label style={lbl}>Height</label><input type="number" min={1} value={opts.redactHeight} onChange={e => opt('redactHeight', +e.target.value)} style={inp} /></div>
          </div>
          {/* Multi-redact queue */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                if (opts.redactWidth > 0 && opts.redactHeight > 0) {
                  opt('redactItems', [...opts.redactItems, { pageIndex: opts.redactPage - 1, x: opts.redactX, y: opts.redactY, width: opts.redactWidth, height: opts.redactHeight }])
                }
              }}
              style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.18)', color: '#f87171', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >+ Queue This Region</button>
            <button
              onClick={() => opt('redactItems', opts.redactItems.slice(0, -1))}
              disabled={!opts.redactItems.length}
              style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid #e0e0f0', background: '#f8f8ff', color: opts.redactItems.length ? '#8888aa' : '#ccccdd', fontSize: 12, cursor: opts.redactItems.length ? 'pointer' : 'not-allowed' }}
            >Undo Last</button>
          </div>
          <div style={{ fontSize: 11, color: opts.redactItems.length ? '#ef4444' : '#8888aa', lineHeight: 1.5 }}>
            {opts.redactItems.length
              ? `${opts.redactItems.length} region${opts.redactItems.length === 1 ? '' : 's'} queued — all will be redacted on save`
              : 'Draw a region above, then queue it. Repeat to redact multiple areas.'}
          </div>
        </div>
      </div>
    ),
  }

  const content = tool.id === 'annotate' ? optionMap['edit-pdf'] : optionMap[tool.id]
  if (!content) return null

  return (
    <div style={{ marginTop: 20, borderTop: '1px solid #e8e8f5', paddingTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Settings2 size={14} color="#6366f1" />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#8888aa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Options</span>
      </div>
      {content}
    </div>
  )
}

/* ── PDF First Page Preview ─────────────────────────────────────────────────── */
function PDFFirstPagePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    renderPageToDataUrl(file, 0, 0.45)
      .then(u => { if (!cancelled) setUrl(u) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [file])
  if (!url) return <div style={{ fontSize: 11, color: '#aaaacc', padding: '8px 0' }}>Loading preview…</div>
  return (
    <div style={{ border: '1px solid #e0e0f0', borderRadius: 8, overflow: 'hidden', maxWidth: 160, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <img src={url} alt="Page 1 preview" style={{ display: 'block', width: '100%', userSelect: 'none' }} />
      <div style={{ padding: '4px 8px', fontSize: 10, color: '#aaaacc', background: '#f8f8ff', textAlign: 'center' }}>Page 1 preview</div>
    </div>
  )
}
