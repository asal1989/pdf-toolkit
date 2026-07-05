import { useRef, useEffect, useState } from 'react'
import { Search, X, ChevronRight, ChevronDown } from 'lucide-react'
import type { Tool } from '../data/tools'
import { visibleTools as tools, visibleCategories as categories } from '../data/tools'
import {
  Archive, ArrowUpDown, Crop, Droplets, Edit3, Eraser,
  FileImage, FileOutput, FileSpreadsheet, FileText, FileType,
  GitCompare, Globe2, Hash, Image, Link,
  LockKeyhole, PanelTop, PenLine, RotateCw, ScanText, Scissors,
  Table2, Trash2, Type, Wrench,
} from 'lucide-react'

interface Props {
  activeTool: Tool | null
  onHome: () => void
  onSelectTool: (tool: Tool) => void
  searchQuery: string
  onSearch: (q: string) => void
}

const toolIconMap: Record<string, any> = {
  merge: Archive, split: Scissors, 'remove-pages': Trash2, extract: FileOutput,
  rotate: RotateCw, reorder: ArrowUpDown, crop: Crop, compare: GitCompare,
  'word-to-pdf': FileText, 'excel-to-pdf': FileSpreadsheet, 'image-to-pdf': Image, 'html-to-pdf': Globe2,
  'pdf-to-word': FileType, 'pdf-to-excel': Table2, 'pdf-to-jpg': FileImage, 'pdf-to-text': Type,
  compress: Archive, repair: Wrench, ocr: ScanText, flatten: Type,
  protect: LockKeyhole, sign: PenLine, redact: Eraser,
  'edit-pdf': Edit3, annotate: PenLine, forms: FileText, links: Link,
  watermark: Droplets, 'page-numbers': Hash, 'header-footer': PanelTop,
}

export default function Navbar({ activeTool, onHome, onSelectTool, searchQuery, onSearch }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape') {
        if (document.activeElement === inputRef.current) { onSearch(''); inputRef.current?.blur() }
        setOpenCategory(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSearch])

  return (
    <header style={{
      background: '#ffffff',
      borderBottom: '1px solid #ececf0',
      flexShrink: 0,
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div style={{
        height: 64,
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 8,
        maxWidth: 1400,
        margin: '0 auto',
      }}>
        {/* Logo */}
        <button
          onClick={onHome}
          aria-label="Go to home"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 6px', borderRadius: 8, flexShrink: 0, marginRight: 6,
          }}
        >
          <img
            src="/bcim-logo.png"
            alt="BCIM PDF Toolkit"
            draggable={false}
            style={{ height: 30, objectFit: 'contain', userSelect: 'none' }}
          />
        </button>

        {/* Category nav with mega-menu dropdowns */}
        <nav style={{ display: 'flex', alignItems: 'center', height: '100%', flex: 1, minWidth: 0 }}>
          {categories.filter(c => c.id !== 'all').map(cat => {
            const catTools = tools.filter(t => t.category === cat.id)
            if (!catTools.length) return null
            const isOpen = openCategory === cat.id
            const isActive = !!activeTool && catTools.some(t => t.id === activeTool.id)
            return (
              <div
                key={cat.id}
                style={{ position: 'relative', height: '100%' }}
                onMouseEnter={() => setOpenCategory(cat.id)}
                onMouseLeave={() => setOpenCategory(null)}
              >
                <button
                  style={{
                    height: '100%',
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '0 12px',
                    fontSize: 14, fontWeight: 650,
                    color: isActive || isOpen ? 'var(--brand-red)' : '#292933',
                    whiteSpace: 'nowrap',
                    borderBottom: `2px solid ${isActive || isOpen ? 'var(--brand-red)' : 'transparent'}`,
                    transition: 'color 0.15s, border-color 0.15s',
                  }}
                >
                  {cat.label}
                  <ChevronDown size={13} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>

                {isOpen && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0,
                    background: '#ffffff', border: '1px solid #ececf0', borderRadius: 12,
                    boxShadow: '0 16px 40px rgba(15,15,20,0.12)',
                    padding: 10, minWidth: 280,
                    display: 'grid', gridTemplateColumns: catTools.length > 4 ? 'repeat(2, 1fr)' : '1fr',
                    gap: 2, zIndex: 60,
                  }}>
                    {catTools.map(tool => {
                      const ToolIcon = toolIconMap[tool.id] || FileText
                      const toolActive = activeTool?.id === tool.id
                      return (
                        <button
                          key={tool.id}
                          onClick={() => { onSelectTool(tool); setOpenCategory(null) }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 10px', borderRadius: 8, border: 'none',
                            background: toolActive ? 'var(--brand-red-light)' : 'transparent',
                            cursor: 'pointer', textAlign: 'left', width: '100%',
                          }}
                          onMouseEnter={e => { if (!toolActive) e.currentTarget.style.background = '#f7f7fa' }}
                          onMouseLeave={e => { if (!toolActive) e.currentTarget.style.background = 'transparent' }}
                        >
                          <div style={{
                            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                            background: tool.gradient,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <ToolIcon size={14} color="#fff" strokeWidth={2.2} />
                          </div>
                          <span style={{
                            fontSize: 13, fontWeight: 600,
                            color: toolActive ? 'var(--brand-red)' : '#292933',
                            whiteSpace: 'nowrap',
                          }}>
                            {tool.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Active tool breadcrumb */}
        {activeTool && (
          <>
            <ChevronRight size={14} color="#c7c7d1" style={{ flexShrink: 0 }} />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--brand-red-light)',
              border: '1px solid var(--brand-red-border)',
              borderRadius: 8, padding: '4px 12px', flexShrink: 0,
            }}>
              <span style={{ fontSize: 15 }}>{activeTool.icon}</span>
              <span style={{ fontSize: 13, color: 'var(--brand-red-dark)', fontWeight: 700, whiteSpace: 'nowrap' }}>{activeTool.name}</span>
            </div>
          </>
        )}

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: searchQuery ? 'var(--brand-red-light)' : '#f7f7fa',
          border: `1px solid ${searchQuery ? 'var(--brand-red-border)' : '#ececf0'}`,
          borderRadius: 8, padding: '7px 12px', width: 240,
          marginLeft: 14, flexShrink: 0,
          transition: 'all 0.2s',
          boxShadow: searchQuery ? '0 0 0 3px rgba(229,50,45,0.10)' : 'none',
        }}>
          <Search size={14} color={searchQuery ? 'var(--brand-red)' : '#9a9aa8'} style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search tools…"
            aria-label="Search tools"
            style={{
              background: 'none', border: 'none', outline: 'none',
              color: '#0f172a', fontSize: 13, width: '100%',
            }}
          />
          {searchQuery ? (
            <button
              onClick={() => { onSearch(''); inputRef.current?.focus() }}
              aria-label="Clear search"
              style={{ background: 'var(--brand-red-border)', border: 'none', color: 'var(--brand-red-dark)', cursor: 'pointer', padding: '2px 5px', display: 'flex', lineHeight: 1, borderRadius: 5 }}
            >
              <X size={12} />
            </button>
          ) : (
            <kbd style={{
              background: '#ffffff', color: '#9a9aa8', fontSize: 10,
              padding: '2px 7px', borderRadius: 5, fontFamily: 'monospace',
              whiteSpace: 'nowrap', border: '1px solid #ececf0',
            }}>
              {isMac ? '⌘K' : 'Ctrl K'}
            </kbd>
          )}
        </div>
      </div>
    </header>
  )
}
