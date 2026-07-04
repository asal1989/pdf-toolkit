/**
 * Type declarations for the contextBridge API exposed by electron/preload.cjs.
 * These are available on `window.electronAPI` inside the renderer process only.
 */
interface ElectronFileData {
  name: string
  data: Uint8Array
}

interface ElectronAPI {
  /** Register a callback fired when the user opens PDFs via File > Open PDF… */
  onOpenFiles: (callback: (files: ElectronFileData[]) => void) => void
  /** Remove the open-files listener (call on component unmount). */
  removeOpenFilesListener: () => void
}

declare global {
  interface Window {
    /** Present only when running inside Electron. Undefined in a plain browser. */
    electronAPI?: ElectronAPI
  }
}

export {}
