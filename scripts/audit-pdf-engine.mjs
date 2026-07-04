import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const root = process.cwd()
const auditDir = path.join(root, '.audit')
await fs.mkdir(auditDir, { recursive: true })

const source = await fs.readFile(path.join(root, 'src/lib/pdf-engine.ts'), 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
}).outputText
const modulePath = path.join(auditDir, 'pdf-engine.mjs')
await fs.writeFile(modulePath, transpiled)

class FileReaderPolyfill {
  readAsArrayBuffer(file) {
    file.arrayBuffer()
      .then(buffer => {
        this.result = buffer
        this.onload?.()
      })
      .catch(error => this.onerror?.(error))
  }
}

globalThis.FileReader = FileReaderPolyfill
let lastDownload = null
globalThis.document = {
  createElement(tag) {
    if (tag !== 'a') throw new Error(`Unexpected element: ${tag}`)
    return {
      href: '',
      download: '',
      click() {},
    }
  },
}
globalThis.URL.createObjectURL = blob => {
  lastDownload = blob
  return 'blob:audit'
}
globalThis.URL.revokeObjectURL = () => {}

const engine = await import(`file:///${modulePath.replaceAll('\\', '/')}`)

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const pngBytes = Uint8Array.from(Buffer.from(pngBase64, 'base64'))
const pngDataUrl = `data:image/png;base64,${pngBase64}`

function fileFromBytes(name, bytes, type = 'application/pdf') {
  return new File([bytes], name, { type })
}

async function makePdf(name, pages = 1) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 420])
    page.drawText(`${name} page ${i + 1}`, { x: 40, y: 360, size: 18, font, color: rgb(0, 0, 0) })
  }
  return fileFromBytes(`${name}.pdf`, await doc.save())
}

async function makeFormPdf() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 420])
  const form = doc.getForm()
  const field = form.createTextField('name')
  field.setText('Sample')
  field.addToPage(page, { x: 40, y: 330, width: 140, height: 24 })
  return fileFromBytes('form.pdf', await doc.save())
}

async function pageCount(bytes) {
  return (await PDFDocument.load(bytes)).getPageCount()
}

async function rotation(bytes, pageIndex = 0) {
  return (await PDFDocument.load(bytes)).getPage(pageIndex).getRotation().angle
}

async function assert(name, fn) {
  try {
    await fn()
    results.push({ name, status: 'PASS' })
  } catch (error) {
    results.push({ name, status: 'FAIL', detail: error?.message || String(error) })
  }
}

function eq(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`)
}

function ok(value, message) {
  if (!value) throw new Error(message)
}

const results = []
const one = await makePdf('one', 1)
const two = await makePdf('two', 2)
const three = await makePdf('three', 3)

await assert('mergePDFs combines pages in order', async () => {
  eq(await pageCount(await engine.mergePDFs([one, two])), 3, 'merged page count')
})

await assert('splitPDF all creates one-page outputs', async () => {
  const parts = await engine.splitPDF(three, 'all')
  eq(parts.length, 3, 'part count')
  for (const part of parts) eq(await pageCount(part.data), 1, `${part.name} page count`)
})

await assert('splitPDF every N groups pages', async () => {
  const parts = await engine.splitPDF(three, 'every', undefined, 2)
  eq(parts.length, 2, 'part count')
  eq(await pageCount(parts[0].data), 2, 'first part page count')
  eq(await pageCount(parts[1].data), 1, 'second part page count')
})

await assert('splitPDF range accepts reverse ranges', async () => {
  const parts = await engine.splitPDF(three, 'range', '3-1')
  eq(parts.length, 1, 'part count')
  eq(await pageCount(parts[0].data), 3, 'reverse range page count')
})

await assert('splitPDF rejects empty/invalid ranges', async () => {
  let threw = false
  try { await engine.splitPDF(three, 'range', '') } catch { threw = true }
  ok(threw, 'splitPDF did not reject empty range')
})

await assert('removePages removes selected pages', async () => {
  eq(await pageCount(await engine.removePages(three, [1])), 2, 'remaining page count')
})

await assert('removePages rejects removing every page', async () => {
  let threw = false
  try { await engine.removePages(three, [0, 1, 2]) } catch { threw = true }
  ok(threw, 'removePages did not reject all-page removal')
})

await assert('extractPages extracts selected pages', async () => {
  eq(await pageCount(await engine.extractPages(three, [0, 2])), 2, 'extracted page count')
})

await assert('rotatePDF writes page rotation', async () => {
  eq(await rotation(await engine.rotatePDF(one, 90)), 90, 'rotation angle')
})

await assert('reorderPages keeps all requested pages', async () => {
  eq(await pageCount(await engine.reorderPages(three, [2, 0, 1])), 3, 'reordered page count')
})

await assert('compressPDF returns readable PDF', async () => {
  eq(await pageCount(await engine.compressPDF(three, 'medium')), 3, 'compressed page count')
})

await assert('addWatermark returns readable PDF', async () => {
  eq(await pageCount(await engine.addWatermark(one, 'CONFIDENTIAL', 30, 'diagonal', 40)), 1, 'watermarked page count')
})

await assert('addPageNumbers returns readable PDF', async () => {
  eq(await pageCount(await engine.addPageNumbers(three, 'bottom-center', 1, 'Page {n} of {total}')), 3, 'numbered page count')
})

await assert('addHeaderFooter returns readable PDF', async () => {
  eq(await pageCount(await engine.addHeaderFooter(one, 'Header', 'Footer', 10)), 1, 'header/footer page count')
})

await assert('addTextToPDF adds text and keeps PDF readable', async () => {
  eq(await pageCount(await engine.addTextToPDF(one, [{ pageIndex: 0, text: 'Edited text', x: 40, y: 80, fontSize: 14, color: '#111111' }])), 1, 'edited page count')
})

await assert('flattenPDF returns readable PDF with form flattened', async () => {
  const bytes = await engine.flattenPDF(await makeFormPdf())
  const doc = await PDFDocument.load(bytes)
  eq(doc.getPageCount(), 1, 'flattened page count')
  eq(doc.getForm().getFields().length, 0, 'remaining form fields')
})

await assert('imagesToPDF embeds PNG at fit size', async () => {
  const imageFile = fileFromBytes('dot.png', pngBytes, 'image/png')
  eq(await pageCount(await engine.imagesToPDF([imageFile], 'fit', 'portrait')), 1, 'image PDF page count')
})

await assert('embedSignature adds signature and keeps PDF readable', async () => {
  eq(await pageCount(await engine.embedSignature(one, pngDataUrl, 0, 20, 20, 60, 20)), 1, 'signed page count')
})

await assert('repairPDF rewrites readable PDF', async () => {
  eq(await pageCount(await engine.repairPDF(three)), 3, 'repaired page count')
})

await assert('redactPDF overlay helper keeps PDF readable', async () => {
  eq(await pageCount(await engine.redactPDF(one, [{ pageIndex: 0, x: 20, y: 20, width: 80, height: 30 }])), 1, 'redacted page count')
})

await assert('downloadZip creates a valid ZIP archive', async () => {
  lastDownload = null
  await engine.downloadZip([{ name: 'one.pdf', data: await one.arrayBuffer().then(b => new Uint8Array(b)) }])
  ok(lastDownload, 'download blob was not created')
  const zip = await JSZip.loadAsync(await lastDownload.arrayBuffer())
  ok(zip.file('one.pdf'), 'ZIP missing one.pdf')
})

await assert('protectPDF fails loudly instead of fake encryption', async () => {
  let threw = false
  try { await engine.protectPDF(one, 'secret', 'secret') } catch { threw = true }
  ok(threw, 'protectPDF did not throw')
})

await assert('unlockPDF fails loudly instead of fake unlocking', async () => {
  let threw = false
  try { await engine.unlockPDF(one, 'secret') } catch { threw = true }
  ok(threw, 'unlockPDF did not throw')
})

const pass = results.filter(r => r.status === 'PASS').length
const fail = results.filter(r => r.status === 'FAIL').length
console.log(JSON.stringify({ pass, fail, results }, null, 2))
if (fail) process.exitCode = 1
