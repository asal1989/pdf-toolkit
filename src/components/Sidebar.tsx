import { useState, useEffect } from 'react'
import type { Tool } from '../data/tools'
import { visibleTools as tools, visibleCategories as categories } from '../data/tools'
import {
  Archive, ArrowUpDown, ChevronDown, Crop, Droplets, Edit3, Eraser,
  FileImage, FileInput, FileOutput, FileSpreadsheet, FileText, FileType,
  GitCompare, GitMerge, Globe2, Hash, Image, Layers, LayoutGrid, Link,
  LockKeyhole, PanelTop, PenLine, RotateCw, ScanText, Scissors, Shield,
  Table2, Trash2, Type, Wrench, Zap,
} from 'lucide-react'

interface Props {
  open: boolean
  activeTool: Tool | null
  onSelectTool: (tool: Tool) => void
  onSelectCategory?: (id: string) => void
  activeCategory?: string
}

const sidebarTheme = {
  surface: '#0f172a',
  surfaceRaised: '#ffffff',
  surfaceMuted: '#1e293b',
  surfaceSoft: '#172554',
  border: '#1e293b',
  borderSoft: '#334155',
  title: '#93c5fd',
  text: '#dbeafe',
  textStrong: '#ffffff',
  groupText: '#c7d2fe',
  primary: '#60a5fa',
  primarySoft: '#1e3a8a',
  online: '#10b981',
  shadow: '8px 0 24px rgba(15,23,42,0.24)',
}

const categoryMeta: Record<string, { icon: any; color: string; bg: string; lightBg: string }> = {
  organize:       { icon: GitMerge,   color: '#60a5fa', bg: '#1e3a8a', lightBg: '#172554' },
  'convert-to':   { icon: FileInput,  color: '#2dd4bf', bg: '#134e4a', lightBg: '#0f3f3c' },
  'convert-from': { icon: FileOutput, color: '#047857', bg: '#d1fae5', lightBg: '#ecfdf5' },
  optimize:       { icon: Zap,        color: '#a78bfa', bg: '#4c1d95', lightBg: '#2e1065' },
  security:       { icon: Shield,     color: '#f87171', bg: '#7f1d1d', lightBg: '#450a0a' },
  edit:           { icon: Edit3,      color: '#7e22ce', bg: '#faf5ff', lightBg: '#fcf8ff' },
}

const toolIconMap: Record<string, any> = {
  merge: Archive,
  split: Scissors,
  'remove-pages': Trash2,
  extract: FileOutput,
  rotate: RotateCw,
  reorder: ArrowUpDown,
  crop: Crop,
  compare: GitCompare,
  'word-to-pdf': FileText,
  'excel-to-pdf': FileSpreadsheet,
  'image-to-pdf': Image,
  'html-to-pdf': Globe2,
  'pdf-to-word': FileType,
  'pdf-to-excel': Table2,
  'pdf-to-jpg': FileImage,
  'pdf-to-text': Type,
  compress: Archive,
  repair: Wrench,
  ocr: ScanText,
  flatten: Layers,
  protect: LockKeyhole,
  sign: PenLine,
  redact: Eraser,
  'edit-pdf': Edit3,
  annotate: PenLine,
  forms: FileText,
  links: Link,
  watermark: Droplets,
  'page-numbers': Hash,
  'header-footer': PanelTop,
}

export default function Sidebar({ open, activeTool, onSelectTool, onSelectCategory, activeCategory }: Props) {
  return (
    <aside style={{
      width: open ? 252 : 0,
      minWidth: open ? 252 : 0,
      overflow: 'hidden',
      background: `linear-gradient(180deg, ${sidebarTheme.surface} 0%, #111827 100%)`,
      borderRight: `1px solid ${sidebarTheme.border}`,
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1), min-width 0.3s cubic-bezier(0.4,0,0.2,1)',
      flexShrink: 0,
      boxShadow: sidebarTheme.shadow,
    }}>
      {/* Logo area */}
      <div style={{
        height: 62, display: 'flex', alignItems: 'center', padding: '0 18px',
        borderBottom: `1px solid ${sidebarTheme.border}`,
        flexShrink: 0,
        background: '#ffffff',
      }}>
        <img
          src="/bcim-logo.png"
          alt="BCIM PDF Toolkit"
          draggable={false}
          style={{ height: 34, maxWidth: 208, objectFit: 'contain', objectPosition: 'left center', userSelect: 'none' }}
        />
      </div>

      {/* Label */}
      <div style={{
        padding: '14px 18px 9px',
        fontSize: 10, fontWeight: 800, color: sidebarTheme.title,
        letterSpacing: '0.12em', textTransform: 'uppercase',
      }}>
        PDF Tools
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 10px 16px' }}>
        {categories.filter(c => c.id !== 'all').map(cat => {
          const meta = categoryMeta[cat.id] || { icon: LayoutGrid, color: '#4f46e5', bg: '#eef2ff', lightBg: '#f5f7ff' }
          const catTools = tools.filter(t => t.category === cat.id)
          const isGroupActive = !!activeTool && catTools.some(t => t.id === activeTool.id)
          return (
            <SidebarSection
              key={cat.id}
              label={cat.label}
              meta={meta}
              catTools={catTools}
              activeTool={activeTool}
              onSelectTool={onSelectTool}
              isGroupActive={isGroupActive}
              isCategoryActive={!activeTool && activeCategory === cat.id}
              onSelectCategory={onSelectCategory ? () => onSelectCategory(cat.id) : undefined}
              defaultOpen={cat.id === 'organize' || cat.id === 'convert-to'}
            />
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '12px 16px',
        borderTop: `1px solid ${sidebarTheme.border}`,
        fontSize: 11, color: sidebarTheme.groupText,
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(15,23,42,0.72)',
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: sidebarTheme.online,
          boxShadow: `0 0 6px ${sidebarTheme.online}`,
        }} />
        100% On-Device · Private
      </div>
    </aside>
  )
}

function SidebarSection({ label, meta, catTools, activeTool, onSelectTool, isGroupActive, isCategoryActive, onSelectCategory, defaultOpen }: {
  label: string
  meta: { icon: any; color: string; bg: string; lightBg: string }
  catTools: Tool[]
  activeTool: Tool | null
  onSelectTool: (t: Tool) => void
  isGroupActive: boolean
  isCategoryActive?: boolean
  onSelectCategory?: () => void
  defaultOpen: boolean
}) {
  const [expanded, setExpanded] = useState(defaultOpen || isGroupActive)
  const Icon = meta.icon
  const highlighted = isGroupActive || isCategoryActive

  useEffect(() => {
    if (isGroupActive) setExpanded(true)
  }, [isGroupActive])

  return (
    <div style={{ marginBottom: 6 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center',
          padding: '4px 4px 4px 8px', borderRadius: 8, border: `1px solid ${highlighted ? meta.bg + '44' : 'transparent'}`,
          background: highlighted ? meta.lightBg : 'transparent',
          marginBottom: expanded ? 5 : 0,
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        {/* Label area — clicking navigates to category */}
        <button
          onClick={() => { onSelectCategory?.(); setExpanded(true) }}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 10,
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          }}
          title={`Show ${label} tools`}
        >
          <div style={{
            width: 24, height: 24, borderRadius: 7, flexShrink: 0,
            background: highlighted ? meta.bg : 'rgba(255,255,255,0.08)',
            border: `1px solid ${highlighted ? meta.bg : sidebarTheme.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s',
          }}>
            <Icon size={13} color={meta.color} strokeWidth={2.1} />
          </div>
          <span style={{
            flex: 1, textAlign: 'left', fontSize: 12, fontWeight: 800,
            color: highlighted ? sidebarTheme.textStrong : sidebarTheme.groupText,
            textTransform: 'uppercase', letterSpacing: '0.035em',
            whiteSpace: 'nowrap', transition: 'color 0.2s',
          }}>
            {label}
          </span>
        </button>

        {/* Chevron — clicking only toggles expand */}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center', flexShrink: 0 }}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronDown
            size={14}
            color={highlighted ? meta.color : sidebarTheme.title}
            style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}
          />
        </button>
      </div>

      {expanded && (
        <div style={{ marginBottom: 8 }}>
          {catTools.map(tool => (
            <SidebarItem
              key={tool.id}
              tool={tool}
              active={activeTool?.id === tool.id}
              onSelect={onSelectTool}
              accentColor={meta.color}
              lightBg={meta.lightBg}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarItem({ tool, active, onSelect, accentColor, lightBg }: {
  tool: Tool; active: boolean; onSelect: (t: Tool) => void
  accentColor: string; lightBg: string
}) {
  const ToolIcon = toolIconMap[tool.id] || FileText

  return (
    <button
      onClick={() => onSelect(tool)}
      style={{
        position: 'relative',
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        minHeight: 38,
        padding: '7px 9px 7px 11px', borderRadius: 9, border: '1px solid transparent',
        background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
        color: sidebarTheme.text,
        cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s', textAlign: 'left',
        boxShadow: active ? `inset 0 0 0 1px ${accentColor}66` : 'none',
        marginBottom: 2,
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = sidebarTheme.surfaceMuted
          e.currentTarget.style.borderColor = sidebarTheme.borderSoft
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.borderColor = 'transparent'
        }
      }}
    >
      {active && (
        <span style={{
          position: 'absolute', left: 0, top: 7, bottom: 7, width: 4,
          borderRadius: '0 4px 4px 0', background: accentColor,
        }} />
      )}

      <div style={{
        width: 24, height: 24, borderRadius: 7, flexShrink: 0,
        background: active ? lightBg : 'rgba(255,255,255,0.09)',
        border: `1px solid ${active ? accentColor + '55' : 'rgba(255,255,255,0.10)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}>
        <ToolIcon size={13} color={active ? accentColor : '#bfdbfe'} strokeWidth={2.1} />
      </div>

      <span style={{
        fontSize: 13, color: active ? sidebarTheme.textStrong : sidebarTheme.text,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        fontWeight: active ? 700 : 600, flex: 1, transition: 'color 0.15s',
      }}>
        {tool.name}
      </span>

      {tool.badge && (
        <span style={{
          fontSize: 9, padding: '2px 6px', borderRadius: 4, flexShrink: 0,
          background: tool.badge === 'AI' ? '#ecfdf5' : lightBg,
          color: tool.badge === 'AI' ? '#059669' : accentColor,
          fontWeight: 700, letterSpacing: '0.04em',
          border: `1px solid ${tool.badge === 'AI' ? '#a7f3d0' : accentColor + '44'}`,
        }}>
          {tool.badge}
        </span>
      )}
    </button>
  )
}
