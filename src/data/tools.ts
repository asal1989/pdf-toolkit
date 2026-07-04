export interface Tool {
  id: string
  name: string
  description: string
  icon: string
  color: string
  gradient: string
  category: string
  badge?: string
}

const hiddenCategories = new Set<string>()

export const categories = [
  { id: 'all', label: 'All Tools' },
  { id: 'organize', label: 'Organize' },
  { id: 'convert-to', label: 'Convert to PDF' },
  // { id: 'convert-from', label: 'Convert from PDF' },  // hidden
  { id: 'optimize', label: 'Optimize' },
  { id: 'security', label: 'Security' },
  { id: 'edit', label: 'Edit' },
]

export const visibleCategories = categories.filter(category => !hiddenCategories.has(category.id))

export const tools: Tool[] = [
  // Organize
  { id: 'merge',        name: 'Merge PDF',        description: 'Combine multiple PDFs into one document',         icon: '📎', color: '#6c63ff', gradient: 'linear-gradient(135deg,#6c63ff,#a78bfa)', category: 'organize' },
  { id: 'split',        name: 'Split PDF',         description: 'Split PDF into separate files by pages',          icon: '✂️', color: '#f59e0b', gradient: 'linear-gradient(135deg,#f59e0b,#fbbf24)', category: 'organize' },
  { id: 'remove-pages', name: 'Remove Pages',      description: 'Delete specific pages from your PDF',             icon: '🗑️', color: '#ef4444', gradient: 'linear-gradient(135deg,#ef4444,#f87171)', category: 'organize' },
  { id: 'extract',      name: 'Extract Pages',     description: 'Extract selected pages into a new PDF',           icon: '📤', color: '#10b981', gradient: 'linear-gradient(135deg,#10b981,#34d399)', category: 'organize' },
  { id: 'rotate',       name: 'Rotate PDF',        description: 'Rotate pages to the correct orientation',         icon: '🔄', color: '#3b82f6', gradient: 'linear-gradient(135deg,#3b82f6,#60a5fa)', category: 'organize' },
  { id: 'reorder',      name: 'Reorder Pages',     description: 'Drag and drop to reorder your PDF pages',         icon: '↕️', color: '#8b5cf6', gradient: 'linear-gradient(135deg,#8b5cf6,#a78bfa)', category: 'organize' },
  { id: 'crop',         name: 'Crop PDF',          description: 'Crop page margins or visible page area',          icon: '⬜', color: '#14b8a6', gradient: 'linear-gradient(135deg,#0d9488,#2dd4bf)', category: 'organize' },
  { id: 'compare',      name: 'Compare PDF',       description: 'Compare two PDFs and list text changes',          icon: '⚖️', color: '#64748b', gradient: 'linear-gradient(135deg,#475569,#94a3b8)', category: 'organize' },

  // Convert to PDF
  { id: 'word-to-pdf',  name: 'Word to PDF',       description: 'Convert DOCX documents to PDF',                  icon: '📝', color: '#2563eb', gradient: 'linear-gradient(135deg,#2563eb,#3b82f6)', category: 'convert-to' },
  { id: 'excel-to-pdf', name: 'Excel to PDF',      description: 'Convert XLSX spreadsheets to PDF',               icon: '📊', color: '#16a34a', gradient: 'linear-gradient(135deg,#16a34a,#22c55e)', category: 'convert-to' },
  { id: 'image-to-pdf', name: 'Image to PDF',      description: 'Convert JPG, PNG, WebP to PDF',                  icon: '🖼️', color: '#0891b2', gradient: 'linear-gradient(135deg,#0891b2,#06b6d4)', category: 'convert-to' },
  { id: 'html-to-pdf',  name: 'HTML to PDF',       description: 'Convert web pages to PDF format',                icon: '🌐', color: '#7c3aed', gradient: 'linear-gradient(135deg,#7c3aed,#8b5cf6)', category: 'convert-to' },

  // Convert from PDF
  { id: 'pdf-to-word',  name: 'PDF to Word',       description: 'Convert PDF back to editable DOCX',              icon: '📃', color: '#2563eb', gradient: 'linear-gradient(135deg,#2563eb,#3b82f6)', category: 'convert-from', badge: 'Popular' },
  { id: 'pdf-to-excel', name: 'PDF to Excel',      description: 'Extract tables from PDF to XLSX',                icon: '📈', color: '#16a34a', gradient: 'linear-gradient(135deg,#16a34a,#22c55e)', category: 'convert-from' },
  { id: 'pdf-to-jpg',   name: 'PDF to JPG',        description: 'Convert each PDF page to an image',              icon: '🎨', color: '#0891b2', gradient: 'linear-gradient(135deg,#0891b2,#06b6d4)', category: 'convert-from' },
  { id: 'pdf-to-text',  name: 'PDF to Text',       description: 'Extract all text content from PDF',              icon: '📜', color: '#6b7280', gradient: 'linear-gradient(135deg,#6b7280,#9ca3af)', category: 'convert-from' },

  // Optimize
  { id: 'compress',     name: 'Compress PDF',      description: 'Reduce PDF file size significantly',             icon: '🗜️', color: '#f59e0b', gradient: 'linear-gradient(135deg,#f59e0b,#fbbf24)', category: 'optimize', badge: 'Popular' },
  { id: 'repair',       name: 'Repair PDF',        description: 'Fix corrupted or damaged PDF files',             icon: '🔧', color: '#6c63ff', gradient: 'linear-gradient(135deg,#6c63ff,#a78bfa)', category: 'optimize' },
  { id: 'ocr',          name: 'OCR PDF',           description: 'Make scanned PDFs searchable and selectable',    icon: '👁️', color: '#10b981', gradient: 'linear-gradient(135deg,#10b981,#34d399)', category: 'optimize', badge: 'AI' },
  { id: 'flatten',      name: 'Flatten PDF',       description: 'Flatten form fields and annotations',            icon: '📋', color: '#3b82f6', gradient: 'linear-gradient(135deg,#3b82f6,#60a5fa)', category: 'optimize' },

  // Security
  { id: 'protect',      name: 'Protect PDF',       description: 'Add an open password to a rasterized PDF copy', icon: '🔒', color: '#ef4444', gradient: 'linear-gradient(135deg,#ef4444,#f87171)', category: 'security' },
  { id: 'sign',         name: 'Sign PDF',          description: 'Add a drawn signature to your PDF',             icon: '✍️', color: '#6c63ff', gradient: 'linear-gradient(135deg,#6c63ff,#a78bfa)', category: 'security' },
  { id: 'redact',       name: 'Redact PDF',        description: 'Permanently black out sensitive content',        icon: '⬛', color: '#1f2937', gradient: 'linear-gradient(135deg,#374151,#6b7280)', category: 'security' },

  // Edit
  { id: 'edit-pdf',     name: 'Edit PDF',          description: 'Add text, images, shapes and more to a PDF',    icon: '✏️', color: '#8b5cf6', gradient: 'linear-gradient(135deg,#8b5cf6,#a78bfa)', category: 'edit' },
  { id: 'annotate',     name: 'Annotate PDF',      description: 'Add highlights, notes, boxes, and lines',       icon: '🖊️', color: '#f59e0b', gradient: 'linear-gradient(135deg,#f59e0b,#fbbf24)', category: 'edit' },
  { id: 'forms',        name: 'Prepare Form',      description: 'Add fillable fields to a PDF',                  icon: '📝', color: '#10b981', gradient: 'linear-gradient(135deg,#059669,#34d399)', category: 'edit' },
  { id: 'links',        name: 'Add Link',          description: 'Add clickable web links to a PDF',              icon: '🔗', color: '#2563eb', gradient: 'linear-gradient(135deg,#2563eb,#60a5fa)', category: 'edit' },
  { id: 'watermark',    name: 'Add Watermark',     description: 'Stamp text watermark on every page',            icon: '💧', color: '#0891b2', gradient: 'linear-gradient(135deg,#0891b2,#06b6d4)', category: 'edit' },
  { id: 'page-numbers', name: 'Page Numbers',      description: 'Add page numbers to your PDF',                  icon: '🔢', color: '#f59e0b', gradient: 'linear-gradient(135deg,#f59e0b,#fbbf24)', category: 'edit' },
  { id: 'header-footer',name: 'Header and Footer', description: 'Add custom headers and footers',                icon: '📑', color: '#6b7280', gradient: 'linear-gradient(135deg,#6b7280,#9ca3af)', category: 'edit' },
]

export const visibleTools = tools.filter(tool => !hiddenCategories.has(tool.category))
