import { useRef, useEffect } from 'react'
import { Menu, Search, X, ChevronRight } from 'lucide-react'
import type { Tool } from '../data/tools'

interface Props {
  onMenuClick: () => void
  activeTool: Tool | null
  onHome: () => void
  searchQuery: string
  onSearch: (q: string) => void
}

export default function Navbar({ onMenuClick, activeTool, onHome, searchQuery, onSearch }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        onSearch('')
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSearch])

  return (
    <header style={{
      height: 62,
      background: '#ffffff',
      borderBottom: '1px solid #dbe4f0',
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      gap: 14,
      flexShrink: 0,
      position: 'sticky',
      top: 0,
      zIndex: 50,
      boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
    }}>
      {/* Menu button */}
      <button
        onClick={onMenuClick}
        aria-label="Toggle sidebar"
        style={{
          background: '#f8fafc',
          border: '1px solid #dbe4f0',
          color: '#334155',
          cursor: 'pointer',
          padding: '7px 8px',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          transition: 'all 0.2s',
          flexShrink: 0,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = '#eff6ff'
          e.currentTarget.style.borderColor = '#bfdbfe'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = '#f8fafc'
          e.currentTarget.style.borderColor = '#dbe4f0'
        }}
      >
        <Menu size={18} />
      </button>

      {/* Logo + Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <button
          onClick={onHome}
          aria-label="Go to home"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 8px', borderRadius: 8, transition: 'all 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <img
            src="/bcim-logo.png"
            alt="BCIM PDF Toolkit"
            draggable={false}
            style={{ height: 32, objectFit: 'contain', userSelect: 'none' }}
          />
        </button>

        {activeTool && (
          <>
            <ChevronRight size={14} color="#94a3b8" />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#f8fafc',
              border: '1px solid #dbe4f0',
              borderRadius: 8, padding: '4px 12px',
            }}>
              <span style={{ fontSize: 16 }}>{activeTool.icon}</span>
              <span style={{ fontSize: 13, color: '#334155', fontWeight: 700 }}>{activeTool.name}</span>
            </div>
          </>
        )}
      </div>

      {/* Search */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: searchQuery ? '#eff6ff' : '#f8fafc',
        border: `1px solid ${searchQuery ? '#93c5fd' : '#dbe4f0'}`,
        borderRadius: 8, padding: '7px 12px', width: 280,
        transition: 'all 0.2s',
        boxShadow: searchQuery ? '0 0 0 3px rgba(59,130,246,0.12)' : 'none',
      }}>
        <Search size={14} color={searchQuery ? '#2563eb' : '#94a3b8'} style={{ flexShrink: 0 }} />
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
            style={{ background: '#dbeafe', border: 'none', color: '#2563eb', cursor: 'pointer', padding: '2px 5px', display: 'flex', lineHeight: 1, borderRadius: 5 }}
          >
            <X size={12} />
          </button>
        ) : (
          <kbd style={{
            background: '#ffffff', color: '#64748b', fontSize: 10,
            padding: '2px 7px', borderRadius: 5, fontFamily: 'monospace',
            whiteSpace: 'nowrap', border: '1px solid #dbe4f0',
          }}>
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        )}
      </div>
    </header>
  )
}
