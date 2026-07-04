import { useEffect, useState } from 'react'
import type { Tool } from '../data/tools'
import { visibleTools as tools, visibleCategories as categories } from '../data/tools'
import { ArrowRight, Clock, FileCheck2, HardDrive, ShieldCheck, Star } from 'lucide-react'

interface Props {
  onSelectTool: (tool: Tool) => void
  searchQuery?: string
  recentIds?: string[]
  activeCategory?: string
  onActiveCategory?: (id: string) => void
}

type CategoryStyle = {
  color: string
  bg: string
  border: string
  soft: string
}

const categoryStyles: Record<string, CategoryStyle> = {
  all:            { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', soft: '#f8fbff' },
  organize:       { color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe', soft: '#f7f8ff' },
  'convert-to':   { color: '#0f766e', bg: '#ecfdf5', border: '#99f6e4', soft: '#f7fffd' },
  'convert-from': { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0', soft: '#f7fffb' },
  optimize:       { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', soft: '#fbfaff' },
  security:       { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', soft: '#fffafa' },
}

export default function HomePage({
  onSelectTool,
  searchQuery = '',
  recentIds = [],
  activeCategory: activeCategoryProp = 'all',
  onActiveCategory,
}: Props) {
  const [activeCategory, setActiveCategory] = useState(activeCategoryProp)

  useEffect(() => {
    setActiveCategory(activeCategoryProp)
  }, [activeCategoryProp])

  const q = searchQuery.trim().toLowerCase()
  const filtered = q
    ? tools.filter(tool =>
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.category.toLowerCase().includes(q)
      )
    : activeCategory === 'all'
      ? tools
      : tools.filter(tool => tool.category === activeCategory)

  const popular = tools.filter(tool => tool.badge === 'Popular')
  const recent = recentIds.length
    ? recentIds.map(id => tools.find(tool => tool.id === id)).filter(Boolean) as Tool[]
    : tools.slice(0, 4)

  const setCategory = (id: string) => {
    setActiveCategory(id)
    onActiveCategory?.(id)
  }

  return (
    <div style={{ padding: '26px 32px 36px', maxWidth: 1240, margin: '0 auto' }}>
      {!q && (
        <>
          <section style={{
            background: '#ffffff',
            border: '1px solid #dbe4f0',
            borderRadius: 8,
            padding: '22px 24px',
            marginBottom: 18,
            boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <img src="/bcim-logo.png" alt="BCIM" draggable={false} style={{ height: 34, objectFit: 'contain', userSelect: 'none' }} />
                  <span style={{
                    border: '1px solid #c7d2fe',
                    background: '#eef2ff',
                    color: '#4f46e5',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                  }}>
                    PDF Toolkit
                  </span>
                </div>
                <h1 style={{ fontSize: 28, lineHeight: 1.2, color: '#0f172a', marginBottom: 8, fontWeight: 800 }}>
                  Fast PDF tools for daily office work
                </h1>
                <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, maxWidth: 620 }}>
                  Merge, split, convert, compress, OCR and protect PDF files from one clean workspace.
                  Files are processed locally on this system.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(118px, 1fr))', gap: 10, minWidth: 280 }}>
                <Stat icon={<FileCheck2 size={15} />} value={tools.length} label="Tools" />
                <Stat icon={<HardDrive size={15} />} value="100 MB" label="Max file" />
                <Stat icon={<ShieldCheck size={15} />} value="Local" label="Processing" />
                <Stat icon={<Clock size={15} />} value="Fast" label="Workflow" />
              </div>
            </div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
            <QuickRow icon={<Star size={14} />} label="Popular" items={popular} onSelect={onSelectTool} />
            <QuickRow icon={<Clock size={14} />} label="Recent" items={recent} onSelect={onSelectTool} />
          </div>
        </>
      )}

      {q && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>
            {filtered.length} result{filtered.length === 1 ? '' : 's'} for "{searchQuery}"
          </div>
          {!filtered.length && (
            <div style={{ fontSize: 13, color: '#64748b' }}>Try another keyword such as compress, word, sign, rotate, or OCR.</div>
          )}
        </div>
      )}

      {!q && (
        <div style={{
          display: 'flex',
          gap: 8,
          marginBottom: 20,
          flexWrap: 'wrap',
          background: '#ffffff',
          border: '1px solid #dbe4f0',
          borderRadius: 8,
          padding: 8,
        }}>
          {categories.map(category => {
            const meta = categoryStyles[category.id] ?? categoryStyles.all
            const active = category.id === activeCategory
            return (
              <button
                key={category.id}
                onClick={() => setCategory(category.id)}
                style={{
                  border: `1px solid ${active ? meta.border : 'transparent'}`,
                  background: active ? meta.bg : 'transparent',
                  color: active ? meta.color : '#475569',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: active ? 800 : 650,
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={event => {
                  if (!active) event.currentTarget.style.background = '#f8fafc'
                }}
                onMouseLeave={event => {
                  if (!active) event.currentTarget.style.background = 'transparent'
                }}
              >
                {category.label}
              </button>
            )
          })}
        </div>
      )}

      {!q && activeCategory === 'all' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {categories.filter(category => category.id !== 'all').map(category => {
            const meta = categoryStyles[category.id] ?? categoryStyles.all
            const categoryTools = tools.filter(tool => tool.category === category.id)
            if (!categoryTools.length) return null
            return (
              <section key={category.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 4, height: 18, background: meta.color, borderRadius: 2 }} />
                  <h2 style={{ color: '#0f172a', fontSize: 15, fontWeight: 800, margin: 0 }}>{category.label}</h2>
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>{categoryTools.length} tools</span>
                  <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                </div>
                <ToolGrid tools={categoryTools} onSelect={onSelectTool} />
              </section>
            )
          })}
        </div>
      ) : (
        filtered.length > 0 && <ToolGrid tools={filtered} onSelect={onSelectTool} highlight={q} />
      )}
    </div>
  )
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return (
    <div style={{
      border: '1px solid #e2e8f0',
      background: '#f8fafc',
      borderRadius: 8,
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <div style={{ width: 30, height: 30, borderRadius: 6, background: '#e0f2fe', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </div>
      <div>
        <div style={{ color: '#0f172a', fontSize: 15, fontWeight: 800 }}>{value}</div>
        <div style={{ color: '#64748b', fontSize: 11, fontWeight: 650 }}>{label}</div>
      </div>
    </div>
  )
}

function QuickRow({ icon, label, items, onSelect }: {
  icon: React.ReactNode
  label: string
  items: Tool[]
  onSelect: (tool: Tool) => void
}) {
  return (
    <section style={{
      background: '#ffffff',
      border: '1px solid #dbe4f0',
      borderRadius: 8,
      padding: 14,
      minHeight: 96,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#334155', marginBottom: 10 }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {items.slice(0, 5).map(tool => (
          <button
            key={tool.id}
            onClick={() => onSelect(tool)}
            style={{
              border: '1px solid #dbe4f0',
              background: '#f8fafc',
              color: '#334155',
              borderRadius: 6,
              padding: '6px 9px',
              fontSize: 12,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            {tool.name}
          </button>
        ))}
      </div>
    </section>
  )
}

function ToolGrid({ tools: gridTools, onSelect, highlight }: {
  tools: Tool[]
  onSelect: (tool: Tool) => void
  highlight?: string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(214px, 1fr))', gap: 12 }}>
      {gridTools.map(tool => (
        <ToolCard key={tool.id} tool={tool} onSelect={onSelect} highlight={highlight} />
      ))}
    </div>
  )
}

function ToolCard({ tool, onSelect, highlight }: {
  tool: Tool
  onSelect: (tool: Tool) => void
  highlight?: string
}) {
  const [hovered, setHovered] = useState(false)
  const meta = categoryStyles[tool.category] ?? categoryStyles.all

  return (
    <button
      onClick={() => onSelect(tool)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        minHeight: 126,
        background: hovered ? meta.soft : '#ffffff',
        border: `1px solid ${hovered ? meta.border : '#dbe4f0'}`,
        borderRadius: 8,
        padding: 16,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? '0 8px 22px rgba(15,23,42,0.08)' : '0 1px 2px rgba(15,23,42,0.04)',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: meta.bg,
          border: `1px solid ${meta.border}`,
          color: meta.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 17,
          flexShrink: 0,
        }}>
          {tool.icon}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
            <div style={{ color: '#0f172a', fontSize: 14, lineHeight: 1.25, fontWeight: 800 }}>
              {highlight ? <HighlightText text={tool.name} query={highlight} color={meta.color} /> : tool.name}
            </div>
            {tool.badge && (
              <span style={{ border: `1px solid ${meta.border}`, background: meta.bg, color: meta.color, borderRadius: 5, padding: '2px 5px', fontSize: 9, fontWeight: 800, flexShrink: 0 }}>
                {tool.badge}
              </span>
            )}
          </div>
          <p style={{ margin: 0, color: '#64748b', fontSize: 12, lineHeight: 1.55 }}>
            {highlight ? <HighlightText text={tool.description} query={highlight} color={meta.color} /> : tool.description}
          </p>
        </div>
      </div>
      <ArrowRight size={14} color={meta.color} style={{ position: 'absolute', right: 14, bottom: 14, opacity: hovered ? 0.85 : 0.28 }} />
    </button>
  )
}

function HighlightText({ text, query, color }: { text: string; query: string; color: string }) {
  if (!query) return <>{text}</>
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark style={{ background: `${color}1f`, color, borderRadius: 3, padding: '0 2px' }}>
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  )
}
