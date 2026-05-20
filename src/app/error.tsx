'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[SAATIRIL] Runtime error:', error)
  }, [error])

  return (
    <div
      style={{
        padding: 40,
        color: '#c4b5fd',
        background: '#1a0b2e',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'rgba(212,175,55,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
        }}
      >
        ⚠️
      </div>
      <h2 style={{ color: '#d4af37', fontSize: 20, margin: 0 }}>
        Terjadi Kesalahan
      </h2>
      <p style={{ color: '#c4b5fd', fontSize: 14, margin: 0, maxWidth: 480, textAlign: 'center' }}>
        Aplikasi SAATIRIL mengalami error. Silakan coba lagi.
      </p>
      {error?.message && (
        <pre
          style={{
            background: '#2a164a',
            border: '1px solid #533485',
            borderRadius: 8,
            padding: '12px 16px',
            color: '#c4b5fd',
            fontSize: 12,
            maxWidth: '90vw',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error.message}
        </pre>
      )}
      <button
        onClick={reset}
        style={{
          background: '#d4af37',
          color: '#1a0b2e',
          border: 'none',
          borderRadius: 8,
          padding: '10px 24px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          marginTop: 8,
        }}
      >
        Coba Lagi
      </button>
    </div>
  )
}
