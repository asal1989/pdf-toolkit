import { readFileSync } from 'node:fs'

const toolsSource = readFileSync(new URL('../src/data/tools.ts', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/pages/ToolPage.tsx', import.meta.url), 'utf8')

const toolsBlock = toolsSource.slice(toolsSource.indexOf('export const tools'))
const toolIds = [...toolsBlock.matchAll(/id:\s*'([^']+)'/g)].map(match => match[1])
const caseIds = new Set([...pageSource.matchAll(/case\s+'([^']+)'/g)].map(match => match[1]))
const optionIds = new Set([...pageSource.matchAll(/['"]?([a-z0-9-]+)['"]?:\s*\(/g)].map(match => match[1]))

const optionless = new Set([
  'merge',
  'remove-pages',
  'extract',
  'reorder',
  'compare',
  'repair',
  'flatten',
  'word-to-pdf',
  'excel-to-pdf',
  'html-to-pdf',
])

const missingCases = toolIds.filter(id => !caseIds.has(id) && id !== 'annotate')
const missingOptions = toolIds.filter(id => !optionIds.has(id) && !optionless.has(id) && id !== 'annotate')
const duplicateIds = toolIds.filter((id, index) => toolIds.indexOf(id) !== index)

if (missingCases.length || missingOptions.length || duplicateIds.length) {
  console.error(JSON.stringify({ missingCases, missingOptions, duplicateIds }, null, 2))
  process.exit(1)
}

console.log(`Tool check passed: ${toolIds.length} tools, ${caseIds.size} process cases.`)
