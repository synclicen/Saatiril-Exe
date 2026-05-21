'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  LayoutDashboard,
  Megaphone,
  Radio,
  Loader2,
  Wifi,
  Copy,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSaatirilStore, type AppTab, type Role, type Project } from '@/store/use-saatiril-store'
import { connectSocket, onLocal, offLocal, emitLocal, getSocket } from '@/lib/socket'

import AdminDashboard from '@/components/saatiril/admin-dashboard'
import { McPanel } from '@/components/saatiril/mc-panel'
import OperatorPanel from '@/components/saatiril/operator-panel'

// ─── Theme constants ──────────────────────────────────────────────────────────
const THEME = {
  bg: '#1a0b2e',
  panel: '#2a164a',
  card: '#3b2263',
  border: '#533485',
  gold: '#d4af37',
  muted: '#c4b5fd',
  cyan: '#06b6d4',
} as const

// ─── Tab configuration ────────────────────────────────────────────────────────
interface TabConfig {
  id: AppTab
  label: string
  icon: React.ReactNode
}

const TABS: TabConfig[] = [
  { id: 'admin', label: 'Admin Dashboard', icon: <LayoutDashboard className="size-4" /> },
  { id: 'mc', label: 'Panel MC', icon: <Megaphone className="size-4" /> },
  { id: 'operator', label: 'Panel Operator', icon: <Camera className="size-4" /> },
]

// ─── Mode badge text helper ───────────────────────────────────────────────────
function getModeBadgeText(role: Role, channel: number): string {
  switch (role) {
    case 'admin':
      return 'Admin Control Center'
    case 'mc':
      return `Layar MC - Jalur ${channel}`
    case 'operator':
      return `Kamera - Jalur ${channel}`
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export function MainApp() {
  // ── Store bindings ─────────────────────────────────────────────────────────
  const currentProject = useSaatirilStore((s) => s.currentProject)
  const updateCurrentProject = useSaatirilStore((s) => s.updateCurrentProject)
  const myRole = useSaatirilStore((s) => s.myRole)
  const myChannel = useSaatirilStore((s) => s.myChannel)
  const currentTab = useSaatirilStore((s) => s.currentTab)
  const setMyRole = useSaatirilStore((s) => s.setMyRole)
  const setMyChannel = useSaatirilStore((s) => s.setMyChannel)
  const setCurrentScreen = useSaatirilStore((s) => s.setCurrentScreen)
  const setCurrentTab = useSaatirilStore((s) => s.setCurrentTab)
  const loadProjectsFromStorage = useSaatirilStore((s) => s.loadProjectsFromStorage)

  // ── Local state ────────────────────────────────────────────────────────────
  const [serverConnected, setServerConnected] = useState(false)
  const [lanIP, setLanIP] = useState<string>('')
  const [copiedIP, setCopiedIP] = useState(false)

  // ── Refs for stable event handlers ─────────────────────────────────────────
  const myRoleRef = useRef(myRole)
  const currentProjectRef = useRef(currentProject)
  useEffect(() => { myRoleRef.current = myRole }, [myRole])
  useEffect(() => { currentProjectRef.current = currentProject }, [currentProject])

  // ── Derived values ─────────────────────────────────────────────────────────
  const isDualMode = currentProject?.config.mode === 'dual'
  // Non-admin is synced when they have a project (from server or localStorage)
  const isSynced = myRole === 'admin' || currentProject !== null
  const effectiveTab: AppTab = useMemo(() => {
    if (myRole === 'admin') return currentTab
    if (myRole === 'mc') return 'mc'
    return 'operator'
  }, [myRole, currentTab])

  // ── Detect LAN IP via WebRTC ───────────────────────────────────────────────
  useEffect(() => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] })
      pc.createDataChannel('')
      pc.createOffer().then((offer) => pc.setLocalDescription(offer))
      pc.onicecandidate = (e) => {
        if (!e.candidate) return
        const parts = e.candidate.candidate.split(' ')
        const ip = parts[4]
        if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && !ip.startsWith('0.') && ip !== '0.0.0.0') {
          setLanIP(ip)
          pc.close()
        }
      }
      // Fallback: also try to detect from hostname
      setTimeout(() => {
        pc.close()
        if (!lanIP && typeof window !== 'undefined') {
          // Try using the hostname from current URL
          const hostname = window.location.hostname
          if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
            setLanIP(hostname)
          }
        }
      }, 3000)
    } catch {
      // WebRTC not available, skip
    }
  }, [])

  // ── Copy IP to clipboard ───────────────────────────────────────────────────
  const handleCopyIP = useCallback(() => {
    if (!lanIP) return
    navigator.clipboard.writeText(`http://${lanIP}:3000`)
    setCopiedIP(true)
    setTimeout(() => setCopiedIP(false), 2000)
  }, [lanIP])

  // ── URL parameter handling (run once on mount) ────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const roleParam = params.get('role') as Role | null
    const channelParam = params.get('channel')

    if (roleParam && ['admin', 'mc', 'operator'].includes(roleParam)) {
      setMyRole(roleParam)
    }
    if (channelParam) {
      const ch = parseInt(channelParam, 10)
      if (ch >= 1 && ch <= 2) {
        setMyChannel(ch)
      }
    }
  }, [setMyRole, setMyChannel])

  // ── Socket initialization ─────────────────────────────────────────────────
  useEffect(() => {
    const socket = connectSocket()

    const handleConnect = () => {
      setServerConnected(true)

      // On reconnection, re-request state sync from admin to ensure we have latest data
      const role = myRoleRef.current
      if (role !== 'admin') {
        emitLocal('REQUEST_STATE', { role, channel: useSaatirilStore.getState().myChannel })
      }
    }
    const handleDisconnect = () => {
      setServerConnected(false)
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)

    queueMicrotask(() => {
      if (socket.connected) {
        setServerConnected(true)
      }
    })

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
    }
  }, [])

  // ── Socket event listeners (stable — no currentProject in deps) ──────────
  useEffect(() => {
    const handleSyncDb = (data: { project: Project }) => {
      const role = myRoleRef.current
      const curProj = currentProjectRef.current

      if (role !== 'admin' && data.project) {
        // For MC/Operator: replace entire project with server data
        updateCurrentProject(data.project)
      } else if (role === 'admin' && data.project) {
        // For admin: merge database and photoHistory from other clients
        if (curProj && data.project.id === curProj.id) {
          updateCurrentProject({
            ...curProj,
            database: data.project.database,
            photoHistory: data.project.photoHistory ?? curProj.photoHistory,
          })
        }
      }
    }

    const handleRequestState = () => {
      const role = myRoleRef.current
      const curProj = currentProjectRef.current
      if (role === 'admin' && curProj) {
        emitLocal('SYNC_DB', { project: curProj })
      }
    }

    onLocal('SYNC_DB', handleSyncDb)
    onLocal('REQUEST_STATE', handleRequestState)

    return () => {
      offLocal('SYNC_DB', handleSyncDb)
      offLocal('REQUEST_STATE', handleRequestState)
    }
  }, [updateCurrentProject])

  // ── Non-admin: load localStorage + request state from admin ────────────────
  useEffect(() => {
    if (myRole === 'admin') return

    // Try to recover project from localStorage first (for reconnection/recovery)
    loadProjectsFromStorage()

    // Request state from admin via socket
    emitLocal('REQUEST_STATE', { role: myRole, channel: myChannel })

    // Periodic retry while we don't have a project
    const requestInterval = setInterval(() => {
      if (!useSaatirilStore.getState().currentProject) {
        emitLocal('REQUEST_STATE', { role: myRole, channel: myChannel })
      }
    }, 3000)

    return () => clearInterval(requestInterval)
  }, [myRole, myChannel, loadProjectsFromStorage])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    setCurrentScreen('hub')
  }, [setCurrentScreen])

  const handleTabChange = useCallback(
    (tab: AppTab) => {
      if (myRole === 'admin') {
        setCurrentTab(tab)
      }
    },
    [myRole, setCurrentTab],
  )

  const handleChannelSelect = useCallback(
    (channel: string) => {
      setMyChannel(parseInt(channel, 10))
    },
    [setMyChannel],
  )

  // ── Render: Sync waiting screen ───────────────────────────────────────────
  if (!isSynced && myRole !== 'admin') {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-6 px-6"
        style={{ backgroundColor: THEME.bg }}
      >
        <div className="flex size-20 items-center justify-center rounded-full border-2 border-[#533485] bg-[#2a164a]">
          <Loader2 className="size-10 animate-spin" style={{ color: THEME.gold }} />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-white">Sinkronisasi Data</h2>
          <p className="mt-2 text-sm" style={{ color: THEME.muted }}>
            Menunggu data proyek dari Admin...
          </p>
          <p className="mt-1 text-xs" style={{ color: `${THEME.muted}88` }}>
            Pastikan Admin sudah membuka proyek di jaringan LAN yang sama.
          </p>
        </div>
        <Badge
          className="gap-1.5 border-[#533485] bg-[#2a164a] px-3 py-1 text-xs"
          style={{ color: THEME.muted }}
        >
          <Radio className="size-3" style={{ color: THEME.gold }} />
          {myRole === 'mc' ? 'MC' : 'Operator'} — Jalur {myChannel}
        </Badge>
      </div>
    )
  }

  // ── Render: Tab content ───────────────────────────────────────────────────
  const renderTabContent = () => {
    switch (effectiveTab) {
      case 'admin':
        return <AdminDashboard />
      case 'mc':
        return <McPanel />
      case 'operator':
        return <OperatorPanel />
    }
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: THEME.bg }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header
        className="shrink-0 border-b backdrop-blur-sm z-20"
        style={{
          backgroundColor: `${THEME.panel}ee`,
          borderColor: THEME.border,
        }}
      >
        <div className="flex flex-col gap-0">
          {/* Top row: back, project name, badge, server status */}
          <div className="flex items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6">
            {/* Back button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              className="shrink-0 text-[#c4b5fd] hover:bg-white/10 hover:text-[#d4af37]"
              aria-label="Kembali ke hub"
            >
              <ArrowLeft className="size-5" />
            </Button>

            {/* Project name */}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-bold text-white sm:text-base">
                {currentProject?.name ?? 'Saatiril'}
              </h1>
            </div>

            {/* Mode badge */}
            <Badge
              className="shrink-0 gap-1.5 border-none px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider sm:text-xs"
              style={{
                backgroundColor: myRole === 'admin' ? `${THEME.gold}22` : myRole === 'mc' ? `${THEME.gold}22` : `${THEME.cyan}22`,
                color: myRole === 'operator' ? THEME.cyan : THEME.gold,
              }}
            >
              {myRole === 'admin' && <LayoutDashboard className="size-3" />}
              {myRole === 'mc' && <Megaphone className="size-3" />}
              {myRole === 'operator' && <Camera className="size-3" />}
              {getModeBadgeText(myRole, myChannel)}
            </Badge>

            {/* Channel indicator (MC/Operator only) */}
            {myRole !== 'admin' && (
              <Badge
                className="shrink-0 gap-1 border-none px-2 py-0.5 text-[10px] font-bold sm:text-xs"
                style={{
                  backgroundColor: myChannel === 1 ? `${THEME.gold}22` : `${THEME.cyan}22`,
                  color: myChannel === 1 ? THEME.gold : THEME.cyan,
                }}
              >
                <Radio className="size-3" />
                Jalur {myChannel}
              </Badge>
            )}

            {/* LAN IP indicator — shows IP for other devices to connect */}
            {lanIP && (
              <button
                onClick={handleCopyIP}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-white/10 cursor-pointer"
                title="Klik untuk salin alamat LAN"
              >
                <Wifi className="size-3" style={{ color: THEME.gold }} />
                <span className="text-[10px] font-mono font-medium" style={{ color: THEME.gold }}>
                  {lanIP}:3000
                </span>
                {copiedIP ? (
                  <Check className="size-3" style={{ color: '#22c55e' }} />
                ) : (
                  <Copy className="size-3" style={{ color: THEME.muted }} />
                )}
              </button>
            )}

            {/* Server status */}
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{
                  backgroundColor: serverConnected ? '#22c55e' : '#ef4444',
                  boxShadow: serverConnected
                    ? '0 0 6px #22c55e88'
                    : '0 0 6px #ef444488',
                }}
              />
              <span className="hidden text-[10px] font-medium sm:inline" style={{ color: THEME.muted }}>
                LAN
              </span>
            </div>
          </div>

          {/* Tab navigation (admin only) */}
          {myRole === 'admin' && (
            <div className="flex items-center gap-1 border-t px-4 py-1 sm:px-6" style={{ borderColor: `${THEME.border}66` }}>
              {TABS.map((tab) => {
                const isActive = effectiveTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`
                      flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold
                      transition-all duration-200 sm:text-sm
                      ${
                        isActive
                          ? 'text-[#1a0b2e] shadow-md'
                          : 'text-[#c4b5fd] hover:bg-white/5 hover:text-white'
                      }
                    `}
                    style={
                      isActive
                        ? { backgroundColor: THEME.gold }
                        : undefined
                    }
                    aria-selected={isActive}
                    role="tab"
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                )
              })}

              {/* Channel selector (admin, dual mode, on MC or Operator tab) */}
              {isDualMode && (effectiveTab === 'mc' || effectiveTab === 'operator') && (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: THEME.muted }}>
                    Jalur Simulasi
                  </span>
                  <Select value={String(myChannel)} onValueChange={handleChannelSelect}>
                    <SelectTrigger
                      size="sm"
                      className="h-7 gap-1 border px-2 text-xs"
                      style={{
                        backgroundColor: THEME.card,
                        borderColor: THEME.border,
                        color: THEME.muted,
                      }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      className="border"
                      style={{
                        backgroundColor: THEME.panel,
                        borderColor: THEME.border,
                      }}
                    >
                      <SelectItem
                        value="1"
                        className="text-xs"
                        style={{ color: THEME.gold }}
                      >
                        Jalur 1 — Kiri
                      </SelectItem>
                      <SelectItem
                        value="2"
                        className="text-xs"
                        style={{ color: THEME.cyan }}
                      >
                        Jalur 2 — Kanan
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Main Content Area ───────────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <div
          key={effectiveTab}
          className="h-full animate-in fade-in slide-in-from-y-2 duration-300"
        >
          {renderTabContent()}
        </div>
      </main>

      {/* ── Footer (sticky to bottom) ───────────────────────────────────────── */}
      <footer
        className="shrink-0 border-t"
        style={{
          backgroundColor: `${THEME.panel}88`,
          borderColor: `${THEME.border}44`,
        }}
      >
        <div className="px-4 py-2 sm:px-6">
          <p
            className="text-center font-mono text-[10px] tracking-widest sm:text-xs"
            style={{ color: `${THEME.muted}66` }}
          >
            Saatiril - Made by Fajrianor - Pusat Humas dan Keterbukaan Informasi 2026
          </p>
        </div>
      </footer>
    </div>
  )
}

export default MainApp
