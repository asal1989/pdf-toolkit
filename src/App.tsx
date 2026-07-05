import { useState, useEffect } from 'react'
import Navbar from './components/Navbar'
import HomePage from './pages/HomePage'
import ToolPage from './pages/ToolPage'
import type { Tool } from './data/tools'
import { visibleTools as tools } from './data/tools'
import './index.css'

const MAX_RECENT = 8

function loadRecentIds(): string[] {
  try { return JSON.parse(localStorage.getItem('pdf-recent-tools') || '[]') } catch { return [] }
}

export default function App() {
  const [activeTool, setActiveTool] = useState<Tool | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [toolKey, setToolKey] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentIds)
  const [activeCategory, setActiveCategory] = useState('all')

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onOpenFiles) return
    api.onOpenFiles((fileDataArray) => {
      const fileObjects = fileDataArray.map(({ name, data }) =>
        new File([data.buffer as ArrayBuffer], name, { type: 'application/pdf' })
      )
      const mergeTool = tools.find(t => t.id === 'merge')!
      setPendingFiles(fileObjects)
      setActiveTool(mergeTool)
      setSearchQuery('')
      setToolKey(k => k + 1)
      trackRecent(mergeTool.id)
    })
    return () => { api.removeOpenFilesListener?.() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const trackRecent = (id: string) => {
    setRecentIds(prev => {
      const updated = [id, ...prev.filter(x => x !== id)].slice(0, MAX_RECENT)
      localStorage.setItem('pdf-recent-tools', JSON.stringify(updated))
      return updated
    })
  }

  const handleBack  = () => { setActiveTool(null); setPendingFiles([]) }
  const handleHome  = () => { setActiveTool(null); setPendingFiles([]); setSearchQuery(''); setActiveCategory('all') }
  const handleSelectCategory = (id: string) => { setActiveTool(null); setPendingFiles([]); setSearchQuery(''); setActiveCategory(id) }

  const handleSelectTool = (tool: Tool) => {
    setPendingFiles([])
    setActiveTool(tool)
    setSearchQuery('')
    trackRecent(tool.id)
  }

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    if (q.trim() && activeTool) { setActiveTool(null); setPendingFiles([]) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#ffffff' }}>
      <Navbar
        activeTool={activeTool}
        onHome={handleHome}
        onSelectTool={handleSelectTool}
        searchQuery={searchQuery}
        onSearch={handleSearch}
      />
      <main style={{ flex: 1, overflowY: 'auto' }}>
        {activeTool
          ? <ToolPage key={`${activeTool.id}-${toolKey}`} tool={activeTool} onBack={handleBack} initialFiles={pendingFiles} />
          : <HomePage onSelectTool={handleSelectTool} searchQuery={searchQuery} recentIds={recentIds} activeCategory={activeCategory} onActiveCategory={handleSelectCategory} />
        }
      </main>
    </div>
  )
}
