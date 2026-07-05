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
        {/* Floating 3D orbs — purely decorative background motion */}
        <div style={styles.orb1} />
        <div style={styles.orb2} />
        <div style={styles.orb3} />
        <div style={styles.scene}>
          <div style={styles.card}>
            <div style={styles.brandRow}>
              <img src="/bcim-logo.png" alt="BCIM" style={styles.brandLogo} />
              <span style={styles.brandName}>BCIM ENGINEERING PRIVATE LIMITED</span>
            </div>
            <h1 style={styles.title}>PDF Toolkit</h1>
            <p style={styles.subtitle}>Internal tool — sign in with your company account to continue.</p>
            <button style={styles.btn} onClick={handleSignIn} disabled={signingIn}>
              {signingIn ? (
                <span style={styles.spinner} />
              ) : (
                <svg width="18" height="18" viewBox="0 0 21 21" style={{ flexShrink: 0 }}>
                  <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                </svg>
              )}
              {signingIn ? 'Signing in…' : 'Sign in with Microsoft'}
            </button>
            {error && <p style={styles.error}>{error}</p>}
            <div style={styles.divider} />
            <p style={styles.footnote}>BCIM ENGINEERING PRIVATE LIMITED · Staff access only</p>
          </div>
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
    padding: 20, position: 'relative', overflow: 'hidden',
    background: 'radial-gradient(circle at 20% 15%, #3a1210 0%, #1a0605 45%, #0d0302 100%)',
    fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  },
  scene: { perspective: 1200 },
  orb1: {
    position: 'absolute', top: '8%', left: '10%', width: 260, height: 260, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(226,59,59,0.35), transparent 70%)',
    filter: 'blur(10px)', animation: 'pdf-orb-drift 9s ease-in-out infinite',
  },
  orb2: {
    position: 'absolute', bottom: '10%', right: '8%', width: 320, height: 320, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,140,90,0.22), transparent 70%)',
    filter: 'blur(14px)', animation: 'pdf-orb-drift 12s ease-in-out infinite reverse',
  },
  orb3: {
    position: 'absolute', top: '48%', right: '22%', width: 160, height: 160, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,255,255,0.08), transparent 70%)',
    filter: 'blur(8px)', animation: 'pdf-orb-drift 7s ease-in-out infinite',
  },
  card: {
    background: '#fff', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,.35)',
    width: '100%', maxWidth: 400, padding: '44px 40px 32px', textAlign: 'center',
    border: '1px solid rgba(255,255,255,0.06)', position: 'relative', zIndex: 1,
    transformStyle: 'preserve-3d', animation: 'pdf-card-enter 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
  },
  brandRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 28, paddingBottom: 20, borderBottom: '1px solid #f0f0f0',
  },
  brandLogo: { height: 32, width: 'auto', flexShrink: 0, animation: 'pdf-logo-float 4s ease-in-out infinite' },
  brandName: { fontSize: 12.5, fontWeight: 700, color: '#3c3c3c', letterSpacing: '0.01em', textAlign: 'right', maxWidth: 180, lineHeight: 1.35 },
  title: { fontSize: 21, fontWeight: 700, color: '#161616', marginBottom: 8, letterSpacing: '-0.01em' },
  subtitle: { fontSize: 13.5, color: '#787878', marginBottom: 28, lineHeight: 1.6, maxWidth: 280, margin: '0 auto 28px' },
  btn: {
    width: '100%', padding: '12px 16px', background: '#fff', color: '#3c3c3c',
    border: '1px solid #d6d6d6', borderRadius: 10, fontSize: 14.5, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 10, transition: 'background 0.15s, border-color 0.15s',
  },
  spinner: {
    width: 15, height: 15, border: '2px solid #d6d6d6', borderTopColor: '#3c3c3c',
    borderRadius: '50%', display: 'inline-block', animation: 'pdf-auth-spin 0.7s linear infinite',
  },
  error: {
    marginTop: 14, fontSize: 12.5, color: '#b42318', background: '#fef3f2',
    border: '1px solid #fecdca', borderRadius: 8, padding: '8px 12px',
  },
  divider: { height: 1, background: '#eee', margin: '26px 0 14px' },
  footnote: { fontSize: 11, color: '#b0b0b0', letterSpacing: '0.01em' },
  staffBadge: {
    position: 'fixed', top: 10, right: 12, zIndex: 999, display: 'flex', alignItems: 'center',
    gap: 10, background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e5e5', borderRadius: 20,
    padding: '5px 6px 5px 14px', fontSize: 12, color: '#555',
    boxShadow: '0 4px 14px rgba(0,0,0,.08)', backdropFilter: 'blur(6px)',
  },
  signOutBtn: {
    background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 14, padding: '4px 11px',
    fontSize: 11, fontWeight: 600, color: '#777', cursor: 'pointer',
  },
}

// Animation keyframes injected once (this file has no external stylesheet).
if (typeof document !== 'undefined' && !document.getElementById('pdf-auth-styles')) {
  const styleTag = document.createElement('style')
  styleTag.id = 'pdf-auth-styles'
  styleTag.textContent = `
    @keyframes pdf-auth-spin { to { transform: rotate(360deg); } }
    @keyframes pdf-card-enter {
      from { opacity: 0; transform: translateY(24px) rotateX(-10deg) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) rotateX(0deg) scale(1); }
    }
    @keyframes pdf-logo-float {
      0%, 100% { transform: perspective(300px) translateY(0) rotateY(0deg); }
      50%      { transform: perspective(300px) translateY(-3px) rotateY(10deg); }
    }
    @keyframes pdf-orb-drift {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50%      { transform: translate(24px, -18px) scale(1.08); }
    }
  `
  document.head.appendChild(styleTag)
}
