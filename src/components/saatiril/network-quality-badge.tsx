'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Wifi, WifiOff, Signal, SignalHigh, SignalLow, SignalZero } from 'lucide-react'
import { getConnectionHealth, onLatencyUpdate, type ConnectionHealth } from '@/lib/socket'

// ─── Theme ────────────────────────────────────────────────────────────────
const THEME = {
  gold: '#d4af37',
  muted: '#c4b5fd',
  border: '#533485',
  bg: '#1a0b2e',
}

/**
 * Network quality indicator badge — shows latency and connection quality.
 * Used in Operator and MC panels to help users identify network issues.
 *
 * Quality thresholds (LAN-optimized):
 * - Excellent: <5ms (Ethernet direct)
 * - Good: <15ms (WiFi same room)
 * - Fair: <30ms (WiFi distant)
 * - Poor: >=30ms (network issues)
 */
export function NetworkQualityBadge() {
  const [health, setHealth] = useState<ConnectionHealth>(getConnectionHealth())

  useEffect(() => {
    // Subscribe to latency updates (every 5s)
    const unsub = onLatencyUpdate((h) => setHealth({ ...h }))
    return unsub
  }, [])

  const { connected, latencyMs, avgLatencyMs, networkQuality } = health

  if (!connected) {
    return (
      <Badge
        className="text-[9px] px-1.5 py-0.5 border-0 animate-pulse"
        style={{ backgroundColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}
      >
        <WifiOff className="size-2.5 mr-0.5" />
        Offline
      </Badge>
    )
  }

  const config: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
    excellent: {
      color: '#4ade80',
      bg: 'rgba(74,222,128,0.2)',
      icon: <SignalHigh className="size-2.5 mr-0.5" />,
    },
    good: {
      color: '#a3e635',
      bg: 'rgba(163,230,53,0.2)',
      icon: <Signal className="size-2.5 mr-0.5" />,
    },
    fair: {
      color: '#fbbf24',
      bg: 'rgba(251,191,36,0.2)',
      icon: <SignalLow className="size-2.5 mr-0.5" />,
    },
    poor: {
      color: '#f87171',
      bg: 'rgba(248,113,113,0.2)',
      icon: <SignalZero className="size-2.5 mr-0.5" />,
    },
    unknown: {
      color: THEME.muted,
      bg: 'rgba(196,181,253,0.15)',
      icon: <Wifi className="size-2.5 mr-0.5" />,
    },
  }

  const c = config[networkQuality] ?? config.unknown
  const latencyText = latencyMs >= 0 ? `${Math.round(latencyMs)}ms` : '...'

  return (
    <Badge
      className="text-[9px] px-1.5 py-0.5 border-0"
      style={{ backgroundColor: c.bg, color: c.color }}
    >
      {c.icon}
      {latencyText}
    </Badge>
  )
}
