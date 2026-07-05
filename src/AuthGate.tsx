// src/AuthGate.tsx — staff-only login gate for the web build. See msalConfig.ts
// for the security caveat (client-side only, no backend to verify against).
// Session is a locally-decoded, time-limited flag — good enough to stop
// casual access, not meant to be bulletproof against a determined attacker
// with dev tools open.
import { useState, useEffect, useCallback } from 'react'
import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser'
import { msalConfig, loginRequest } from './msalConfig'

const SESSION_KEY = 'pdf_staff_session'
const SESSION_HOURS = 12

const msalInstance = new PublicClientApplication(msalConfig)
const msalReady = msalInstance.initialize()

function loadSession(): { email: string; name: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data.expiresAt || data.expiresAt < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return { email: data.email, name: data.name }
  } catch { return null }
}

function saveSession(account: AccountInfo) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    email: account.username,
    name: account.name || account.username,
    expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
  }))
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  // Electron desktop build never shows this gate — it only runs on
  // already-managed company machines, not the public web.
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI

  const [session, setSession] = useState(() => (isElectron ? { email: 'desktop', name: 'Desktop' } : loadSession()))
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState('')

  const handleSignIn = useCallback(async () => {
    setError('')
    setSigningIn(true)
    try {
      await msalReady
      const result = await msalInstance.loginPopup(loginRequest)
      saveSession(result.account)
      setSession({ email: result.account.username, name: result.account.name || result.account.username })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed — please try again')
    } finally {
      setSigningIn(false)
    }
  }, [])

  const handleSignOut = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY)
    setSession(null)
  }, [])

  useEffect(() => {
    if (isElectron) return
    const id = setInterval(() => { if (!loadSession()) setSession(null) }, 60_000)
    return () => clearInterval(id)
  }, [isElectron])

  if (!session) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.logoCircle}>PDF</div>
          <h1 style={styles.title}>BCIM PDF Toolkit</h1>
          <p style={styles.subtitle}>This tool is for BCIM Engineering staff only.</p>
          <button style={styles.btn} onClick={handleSignIn} disabled={signingIn}>
            {signingIn ? 'Signing in…' : 'Sign in with Microsoft'}
          </button>
          {error && <p style={styles.error}>{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {!isElectron && (
        <div style={styles.staffBadge}>
          <span>{session.name}</span>
          <button style={styles.signOutBtn} onClick={handleSignOut}>Sign out</button>
        </div>
      )}
      {children}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f0f2f5', fontFamily: "'Helvetica Neue', Arial, sans-serif",
  },
  card: {
    background: '#fff', borderRadius: 14, boxShadow: '0 4px 32px rgba(0,0,0,.10)',
    width: '100%', maxWidth: 380, padding: '40px 36px', textAlign: 'center',
  },
  logoCircle: {
    width: 56, height: 56, borderRadius: 14, background: '#DC2626', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800,
    fontSize: 14, margin: '0 auto 18px',
  },
  title: { fontSize: 20, fontWeight: 800, color: '#111', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 24, lineHeight: 1.5 },
  btn: {
    width: '100%', padding: '13px', background: '#DC2626', color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
  error: { marginTop: 12, fontSize: 13, color: '#c00' },
  staffBadge: {
    position: 'fixed', top: 8, right: 10, zIndex: 999, display: 'flex', alignItems: 'center',
    gap: 10, background: 'rgba(255,255,255,0.92)', border: '1px solid #e5e5e5', borderRadius: 20,
    padding: '4px 6px 4px 12px', fontSize: 11, color: '#555', boxShadow: '0 2px 10px rgba(0,0,0,.06)',
  },
  signOutBtn: {
    background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 14, padding: '3px 9px',
    fontSize: 10, fontWeight: 600, color: '#777', cursor: 'pointer',
  },
}
