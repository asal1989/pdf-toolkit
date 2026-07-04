/**
 * Electron preload script — runs in a privileged Node.js context.
 * Exposes a minimal, safe API to the renderer via contextBridge.
 * contextIsolation: true keeps Node APIs out of the renderer completely.
 */
const { contextBridge, ipcRenderer } = require('electron')
const fs   = require('fs')
const path = require('path')

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Register a callback that fires whenever the user opens PDFs via
   * File > Open PDF… in the native menu. The callback receives an array
   * of { name: string, data: Uint8Array } objects ready to be turned into
   * File objects in the renderer.
   */
  onOpenFiles: (callback) => {
    // Remove any previously registered listener before adding a new one
    // to prevent accumulation when the component re-mounts.
    ipcRenderer.removeAllListeners('open-files')
    ipcRenderer.on('open-files', (_event, filePaths) => {
      const fileDataArray = filePaths
        .map(filePath => {
          try {
            const buf  = fs.readFileSync(filePath)
            const name = path.basename(filePath)
            return { name, data: new Uint8Array(buf) }
          } catch {
            return null
          }
        })
        .filter(Boolean)

      if (fileDataArray.length) callback(fileDataArray)
    })
  },

  /** Remove the open-files listener (call on component unmount). */
  removeOpenFilesListener: () => {
    ipcRenderer.removeAllListeners('open-files')
  },
})
