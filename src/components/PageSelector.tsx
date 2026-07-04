import { useState, useEffect } from 'react'
import { renderPageToDataUrl, getPageCount } from '../lib/pdf-render'
import { Loader2, Check, GripVertical } from 'lucide-react'

interface PageItem {
  index: number
  thumb: string
  selected: boolean
}

interface Props {
  file: File | null
  mode: 'select' | 'reorder'
  selectedPages?: number[]
  onSelectionChange?: (indices: number[]) => void
  onOrderChange?: (indices: number[]) => void
}

export default function PageSelector({ file, mode, selectedPages, onSelectionChange, onOrderChange }: Props) {
  const [pages, setPages] = useState<PageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!file) { setPages([]); return }
    setLoading(true)
    let cancelled = false
    ;(async () => {
      const count = await getPageCount(file)
      // Seed the grid immediately with blank placeholders so the user sees
      // the layout before any thumbnail is ready.
      const placeholders: PageItem[] = Array.from({ length: count }, (_, i) => ({
        index: i, thumb: '', selected: selectedPages?.includes(i) ?? false,
      }))
      if (!cancelled) setPages(placeholders)

      // Render thumbnails one-by-one and update state after each one so they
      // appear progressively instead of all at once at the end.
      for (let i = 0; i < count; i++) {
        if (cancelled) return
        const thumb = await renderPageToDataUrl(file, i, 0.4)
        if (cancelled) return
        setPages(prev => prev.map((p, idx) => idx === i ? { ...p, thumb } : p))
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [file])

  useEffect(() => {
    if (mode !== 'select' || !selectedPages) return
    setPages(prev => prev.map(page => ({
      ...page,
      selected: selectedPages.includes(page.index),
    })))
  }, [mode, selectedPages])

  const togglePage = (i: number) => {
    const updated = pages.map((p, idx) => idx === i ? { ...p, selected: !p.selected } : p)
    setPages(updated)
    onSelectionChange?.(updated.filter(p => p.selected).map(p => p.index))
  }

  const selectAll = () => {
    const updated = pages.map(p => ({ ...p, selected: true }))
    setPages(updated)
    onSelectionChange?.(updated.map(p => p.index))
  }

  const deselectAll = () => {
    const updated = pages.map(p => ({ ...p, selected: false }))
    setPages(updated)
    onSelectionChange?.([])
  }

  const handleDragStart = (i: number) => setDragIdx(i)
  const handleDragEnd = () => { setDragIdx(null); setOverIdx(null) }
  const handleDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setOverIdx(i) }
  const handleDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === i) return
    const reordered = [...pages]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(i, 0, moved)
    setPages(reordered)
    setDragIdx(null)
    setOverIdx(null)
    onOrderChange?.(reordered.map(p => p.index))
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: '#666680' }}>
      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      Loading page previews...
    </div>
  )

  if (!pages.length) return null

  return (
    <div>
      {mode === 'select' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={selectAll} style={btnStyle('#2563eb')}>Select All</button>
          <button onClick={deselectAll} style={btnStyle('#475569')}>Deselect All</button>
          <span style={{
            fontSize: 12,
            color: pages.some(p => p.selected) ? '#1d4ed8' : '#64748b',
            marginLeft: 'auto',
            alignSelf: 'center',
            fontWeight: 800,
            background: pages.some(p => p.selected) ? '#eff6ff' : '#f8fafc',
            border: `1px solid ${pages.some(p => p.selected) ? '#bfdbfe' : '#e2e8f0'}`,
            borderRadius: 999,
            padding: '4px 10px',
          }}>
            {pages.filter(p => p.selected).length} / {pages.length} selected
          </span>
        </div>
      )}
      {mode === 'reorder' && (
        <p style={{ fontSize: 12, color: '#666680', marginBottom: 14 }}>Drag pages to reorder them</p>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: 10,
        maxHeight: 400,
        overflowY: 'auto',
        padding: 4,
      }}>
        {pages.map((page, i) => (
          <div
            key={`${page.index}-${i}`}
            draggable={mode === 'reorder'}
            onDragStart={() => handleDragStart(i)}
            onDragEnd={handleDragEnd}
            onDragOver={e => handleDragOver(e, i)}
            onDrop={e => handleDrop(e, i)}
            onClick={() => mode === 'select' && togglePage(i)}
            style={{
              position: 'relative',
              border: `2px solid ${
                mode === 'select' && page.selected ? '#2563eb' :
                overIdx === i ? '#2563eb' : '#dbe4f0'
              }`,
              borderRadius: 8,
              overflow: 'hidden',
              cursor: mode === 'select' ? 'pointer' : 'grab',
              transition: 'border-color 0.15s, box-shadow 0.15s, opacity 0.15s',
              opacity: dragIdx === i ? 0.4 : 1,
              background: '#f8fafc',
              boxShadow: mode === 'select' && page.selected ? '0 0 0 3px rgba(37,99,235,0.14)' : 'none',
            }}
          >
            {page.thumb
              ? <img src={page.thumb} alt={`Page ${page.index + 1}`} style={{ width: '100%', display: 'block' }} />
              : <div style={{ width: '100%', paddingBottom: '141%', background: '#f1f5f9' }} />
            }
            {mode === 'select' && page.selected && (
              <div style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: '#2563eb',
                border: '2px solid #ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(37,99,235,0.35)',
              }}>
                <Check size={12} color="#ffffff" strokeWidth={3} />
              </div>
            )}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: mode === 'select' && page.selected ? 'rgba(37,99,235,0.92)' : 'rgba(15,23,42,0.72)',
              padding: '4px 6px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 10, color: 'white', fontWeight: 600 }}>
                {mode === 'reorder' && <GripVertical size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />}
                P {page.index + 1}
              </span>
              {mode === 'select' && page.selected && <span style={{ color: '#ffffff', fontSize: 9, fontWeight: 800 }}>Selected</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function btnStyle(bg: string) {
  return {
    padding: '5px 12px', borderRadius: 6, border: 'none',
    background: bg, color: 'white', fontSize: 11, fontWeight: 600,
    cursor: 'pointer',
  } as React.CSSProperties
}
