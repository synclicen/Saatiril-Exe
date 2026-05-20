'use client'

import { useEffect, useMemo, useRef, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Megaphone, Users, Clock, CheckCircle2, Loader2 } from 'lucide-react'
import { useSaatirilStore, type Student, type StudentStatus } from '@/store/use-saatiril-store'
import { emitLocal, onLocal, offLocal } from '@/lib/socket'

// ─── Theme tokens ───────────────────────────────────────────────────────────
const THEME = {
  bg: '#1a0b2e',
  panel: '#2a164a',
  card: '#3b2263',
  border: '#533485',
  gold: '#d4af37',
  muted: '#c4b5fd',
} as const

// ─── Helpers ────────────────────────────────────────────────────────────────
function isActiveStatus(status: StudentStatus): boolean {
  return status.startsWith('active')
}

function getActiveChannel(status: StudentStatus): number | null {
  if (!isActiveStatus(status)) return null
  const ch = status.split('_')[1]
  return ch ? parseInt(ch, 10) : null
}

function statusLabel(status: StudentStatus): string {
  if (status === 'pending') return 'Menunggu'
  if (status === 'done') return 'Selesai'
  const ch = getActiveChannel(status)
  return ch != null ? `Foto Ch.${ch}` : 'Aktif'
}

// ─── Component ──────────────────────────────────────────────────────────────
export function McPanel() {
  const currentProject = useSaatirilStore((s) => s.currentProject)
  const myChannel = useSaatirilStore((s) => s.myChannel)
  const updateStudentStatus = useSaatirilStore((s) => s.updateStudentStatus)
  const updateCurrentProject = useSaatirilStore((s) => s.updateCurrentProject)
  const saveProjectsToStorage = useSaatirilStore((s) => s.saveProjectsToStorage)

  // ── Derived data ────────────────────────────────────────────────────────
  const channelStudents = useMemo<Student[]>(() => {
    if (!currentProject) return []
    return currentProject.database.filter((s) => s.assignedChannel === myChannel)
  }, [currentProject, myChannel])

  const currentlyActive = useMemo<Student | null>(() => {
    const targetStatus: StudentStatus = `active_${myChannel}`
    return channelStudents.find((s) => s.status === targetStatus) ?? null
  }, [channelStudents, myChannel])

  const nextPending = useMemo<Student | null>(() => {
    return channelStudents.find((s) => s.status === 'pending') ?? null
  }, [channelStudents])

  const remainingCount = useMemo<number>(() => {
    return channelStudents.filter((s) => s.status === 'pending').length
  }, [channelStudents])

  const isPhotographing = currentlyActive !== null

  // ── Auto-scroll ref ─────────────────────────────────────────────────────
  const activeRowRef = useRef<HTMLDivElement>(null)
  const nextRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const target = activeRowRef.current ?? nextRowRef.current
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentlyActive, nextPending])

  // ── Socket sync ─────────────────────────────────────────────────────────
  const handleSync = useCallback(() => {
    // Trigger re-render by reading from store (Zustand will handle reactivity)
  }, [])

  useEffect(() => {
    onLocal('SYNC_DB', handleSync)
    return () => {
      offLocal('SYNC_DB', handleSync)
    }
  }, [handleSync])

  // ── Call action ─────────────────────────────────────────────────────────
  const handleCallNow = useCallback(() => {
    if (!nextPending || !currentProject) return

    const newStatus: StudentStatus = `active_${myChannel}`

    // 1. Update student status in store
    updateStudentStatus(nextPending.id, newStatus)

    // 2. Persist
    saveProjectsToStorage()

    // 3. Emit socket events
    const updatedProject = {
      ...currentProject,
      database: currentProject.database.map((s) =>
        s.id === nextPending.id ? { ...s, status: newStatus } : s
      ),
    }
    updateCurrentProject(updatedProject)

    emitLocal('SYNC_DB', { project: updatedProject })
    emitLocal('MC_CALL', {
      student: { ...nextPending, status: newStatus },
      channel: myChannel,
    })
  }, [
    nextPending,
    currentProject,
    myChannel,
    updateStudentStatus,
    updateCurrentProject,
    saveProjectsToStorage,
  ])

  // ── Render helpers ──────────────────────────────────────────────────────
  const renderCallButton = () => {
    if (isPhotographing) {
      return (
        <Button
          disabled
          className="w-full h-14 text-lg font-bold cursor-not-allowed"
          style={{
            backgroundColor: THEME.panel,
            color: THEME.muted,
            border: `2px solid ${THEME.border}`,
          }}
        >
          <Loader2 className="size-5 animate-spin" />
          TUNGGU KAMERA...
        </Button>
      )
    }

    if (nextPending) {
      return (
        <Button
          onClick={handleCallNow}
          className="w-full h-14 text-lg font-bold cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          style={{
            backgroundColor: THEME.gold,
            color: THEME.bg,
            border: `2px solid ${THEME.gold}`,
          }}
        >
          <Megaphone className="size-5" />
          PANGGIL SEKARANG
        </Button>
      )
    }

    return (
      <Button
        disabled
        className="w-full h-14 text-lg font-bold cursor-not-allowed"
        style={{
          backgroundColor: THEME.panel,
          color: THEME.muted,
          border: `2px solid ${THEME.border}`,
          opacity: 0.6,
        }}
      >
        <Users className="size-5" />
        ANTREAN HABIS
      </Button>
    )
  }

  const getRowStyle = (student: Student, index: number): React.CSSProperties => {
    const isActive = student.status === `active_${myChannel}`
    const isNext = student.id === nextPending?.id && student.status === 'pending'
    const isDone = student.status === 'done'

    if (isActive) {
      return {
        backgroundColor: `${THEME.gold}22`,
        borderLeft: `4px solid ${THEME.gold}`,
        boxShadow: `0 0 12px ${THEME.gold}44`,
      }
    }

    if (isNext) {
      return {
        backgroundColor: THEME.panel,
        borderLeft: `4px solid ${THEME.gold}`,
      }
    }

    if (isDone) {
      return {
        backgroundColor: '#22c55e0d',
        opacity: 0.55,
        borderLeft: `4px solid #22c55e66`,
      }
    }

    // Regular pending
    return {
      backgroundColor: THEME.panel,
      borderLeft: `4px solid ${THEME.border}`,
    }
  }

  const renderStatusBadge = (status: StudentStatus) => {
    if (status === 'done') {
      return (
        <Badge
          className="text-[10px] px-1.5 py-0"
          style={{ backgroundColor: '#22c55e33', color: '#4ade80', border: '1px solid #22c55e55' }}
        >
          <CheckCircle2 className="size-3 mr-0.5" />
          Selesai
        </Badge>
      )
    }

    if (isActiveStatus(status)) {
      return (
        <Badge
          className="text-[10px] px-1.5 py-0 animate-pulse"
          style={{
            backgroundColor: `${THEME.gold}33`,
            color: THEME.gold,
            border: `1px solid ${THEME.gold}66`,
          }}
        >
          <Loader2 className="size-3 mr-0.5 animate-spin" />
          {statusLabel(status)}
        </Badge>
      )
    }

    // pending
    return (
      <Badge
        className="text-[10px] px-1.5 py-0"
        style={{
          backgroundColor: `${THEME.border}44`,
          color: THEME.muted,
          border: `1px solid ${THEME.border}`,
        }}
      >
        <Clock className="size-3 mr-0.5" />
        Menunggu
      </Badge>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────
  if (!currentProject) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ backgroundColor: THEME.bg, color: THEME.muted }}
      >
        <p className="text-sm opacity-60">Belum ada proyek aktif</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full p-4" style={{ backgroundColor: THEME.bg }}>
      {/* ── Top: Call Panel ──────────────────────────────────────────────── */}
      <Card
        className="shrink-0 border-2 rounded-xl"
        style={{
          backgroundColor: THEME.card,
          borderColor: THEME.gold,
          boxShadow: `0 0 20px ${THEME.gold}22`,
        }}
      >
        <CardContent className="p-4 space-y-3">
          {/* Label */}
          <p
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: THEME.gold }}
          >
            Target Pemanggilan Selanjutnya
          </p>

          {/* Next student info */}
          {nextPending ? (
            <div className="space-y-1">
              <p className="text-2xl font-bold leading-tight" style={{ color: '#ffffff' }}>
                {nextPending.nama}
              </p>
              <p className="text-sm font-mono" style={{ color: THEME.muted }}>
                {nextPending.nim}
              </p>
            </div>
          ) : currentlyActive ? (
            <div className="space-y-1">
              <p className="text-lg font-semibold leading-tight" style={{ color: THEME.gold }}>
                Sedang difoto:
              </p>
              <p className="text-2xl font-bold leading-tight" style={{ color: '#ffffff' }}>
                {currentlyActive.nama}
              </p>
              <p className="text-sm font-mono" style={{ color: THEME.muted }}>
                {currentlyActive.nim}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-lg italic" style={{ color: THEME.muted }}>
                Semua mahasiswa telah dipanggil
              </p>
            </div>
          )}

          {/* Call button */}
          {renderCallButton()}
        </CardContent>
      </Card>

      {/* ── Bottom: Queue List ───────────────────────────────────────────── */}
      <Card
        className="flex-1 min-h-0 border rounded-xl overflow-hidden flex flex-col"
        style={{ backgroundColor: THEME.card, borderColor: THEME.border }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${THEME.border}` }}
        >
          <h3 className="text-sm font-semibold" style={{ color: '#ffffff' }}>
            Sisa Antrean:{' '}
            <span style={{ color: THEME.gold }} className="font-bold">
              {remainingCount}
            </span>
          </h3>
          <span className="text-xs" style={{ color: THEME.muted }}>
            Channel {myChannel}
          </span>
        </div>

        {/* Column headers */}
        <div
          className="shrink-0 grid grid-cols-[40px_100px_1fr_90px] gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: THEME.panel,
            color: THEME.muted,
            borderBottom: `1px solid ${THEME.border}`,
          }}
        >
          <span>No</span>
          <span>NIM</span>
          <span>Nama Lengkap</span>
          <span className="text-right">Status</span>
        </div>

        {/* Scrollable rows */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col">
            {channelStudents.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm" style={{ color: THEME.muted }}>
                  Tidak ada mahasiswa di channel ini
                </p>
              </div>
            ) : (
              channelStudents.map((student, idx) => {
                const isActive = student.status === `active_${myChannel}`
                const isNext =
                  student.id === nextPending?.id && student.status === 'pending'
                const isDone = student.status === 'done'

                return (
                  <div
                    key={student.id}
                    ref={
                      isActive
                        ? activeRowRef
                        : isNext
                          ? nextRowRef
                          : undefined
                    }
                    className="grid grid-cols-[40px_100px_1fr_90px] gap-2 items-center px-4 py-2.5 transition-colors duration-200"
                    style={getRowStyle(student, idx)}
                  >
                    {/* Row number */}
                    <span
                      className="text-xs font-mono"
                      style={{ color: THEME.muted }}
                    >
                      {idx + 1}
                    </span>

                    {/* NIM */}
                    <span
                      className="text-xs font-mono truncate"
                      style={{ color: THEME.muted }}
                    >
                      {student.nim}
                    </span>

                    {/* Name */}
                    <span
                      className={`text-sm font-medium truncate ${isDone ? 'line-through' : ''}`}
                      style={{
                        color: isActive
                          ? THEME.gold
                          : isDone
                            ? THEME.muted
                            : '#ffffff',
                      }}
                    >
                      {student.nama}
                    </span>

                    {/* Status */}
                    <div className="flex justify-end">
                      {renderStatusBadge(student.status)}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  )
}

export default McPanel
