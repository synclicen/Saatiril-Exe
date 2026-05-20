'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users,
  CheckCircle2,
  Copy,
  Camera,
  Monitor,
  Wifi,
  Image as ImageIcon,
  Clock,
  Radio,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useSaatirilStore, type Student, type PhotoHistoryItem } from '@/store/use-saatiril-store'
import { onLocal, offLocal } from '@/lib/socket'
import { useToast } from '@/hooks/use-toast'

// ── Theme constants ──────────────────────────────────────────────
const BG = 'bg-[#1a0b2e]'
const PANEL = 'bg-[#2a164a]'
const CARD = 'bg-[#3b2263]'
const BORDER = 'border-[#533485]'
const GOLD = '#d4af37'
const GOLD_TEXT = 'text-[#d4af37]'
const MUTED = 'text-[#c4b5fd]'
const CYAN = '#06b6d4'
const CYAN_TEXT = 'text-[#06b6d4]'
const GREEN_ACCENT = 'text-emerald-400'

// ── Helper: sanitize nama for filenames ──────────────────────────
function sanitizeNama(nama: string): string {
  return nama
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
}

function buildFilename(nim: string, nama: string, suffix: number, type: string): string {
  return `${nim}_${sanitizeNama(nama)}_${suffix}_${type}.jpg`
}

// ── Socket event data shapes ─────────────────────────────────────
interface McCallData {
  student: Student
  channel: number
}

interface OpProgressData {
  channel: number
  status: string
}

interface PhotosSavedData {
  historyItem: PhotoHistoryItem
}

interface SyncDbData {
  database: Student[]
}

// ── Component ────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { toast } = useToast()

  // Store
  const currentProject = useSaatirilStore((s) => s.currentProject)
  const updateCurrentProject = useSaatirilStore((s) => s.updateCurrentProject)

  // Local UI state
  const [liveTargets, setLiveTargets] = useState<Record<number, Student | null>>({})
  const [cameraStatus, setCameraStatus] = useState<Record<number, string>>({
    1: 'Menunggu target...',
    2: 'Menunggu target...',
  })

  // ── Computed values ──────────────────────────────────────────────
  const mode = currentProject?.config.mode ?? 'single'
  const database = currentProject?.database ?? []
  const photoHistory = currentProject?.photoHistory ?? []

  const totalPeserta = database.length
  const doneCount = useMemo(
    () => database.filter((s) => s.status === 'done').length,
    [database],
  )

  // ── Socket listeners ─────────────────────────────────────────────
  useEffect(() => {
    const handleMcCall = (data: McCallData) => {
      setLiveTargets((prev) => ({
        ...prev,
        [data.channel]: data.student,
      }))
      setCameraStatus((prev) => ({
        ...prev,
        [data.channel]: 'Target aktif — Siap foto',
      }))
    }

    const handleOpProgress = (data: OpProgressData) => {
      setCameraStatus((prev) => ({
        ...prev,
        [data.channel]: data.status,
      }))
    }

    const handlePhotosSaved = (data: PhotosSavedData) => {
      if (!currentProject) return
      const existing = currentProject.photoHistory.findIndex(
        (h) =>
          h.student.id === data.historyItem.student.id &&
          h.channel === data.historyItem.channel,
      )
      let newHistory: PhotoHistoryItem[]
      if (existing !== -1) {
        newHistory = [...currentProject.photoHistory]
        newHistory[existing] = data.historyItem
      } else {
        newHistory = [...currentProject.photoHistory, data.historyItem]
      }
      updateCurrentProject({ ...currentProject, photoHistory: newHistory })
    }

    const handleSyncDb = (data: SyncDbData) => {
      if (!currentProject) return
      updateCurrentProject({ ...currentProject, database: data.database })
    }

    onLocal('MC_CALL', handleMcCall)
    onLocal('OP_PROGRESS', handleOpProgress)
    onLocal('PHOTOS_SAVED', handlePhotosSaved)
    onLocal('SYNC_DB', handleSyncDb)

    return () => {
      offLocal('MC_CALL', handleMcCall)
      offLocal('OP_PROGRESS', handleOpProgress)
      offLocal('PHOTOS_SAVED', handlePhotosSaved)
      offLocal('SYNC_DB', handleSyncDb)
    }
  }, [currentProject, updateCurrentProject])

  // ── Copy link handler ────────────────────────────────────────────
  const copyLink = useCallback(
    (role: string, channel: number) => {
      const url = `${window.location.origin}/?role=${role}&channel=${channel}`
      navigator.clipboard.writeText(url).then(
        () => {
          toast({
            title: 'Link disalin!',
            description: `${role.toUpperCase()} ${channel > 0 ? channel : ''} — ${url}`,
          })
        },
        () => {
          // Fallback: select from a temporary input
          const textarea = document.createElement('textarea')
          textarea.value = url
          document.body.appendChild(textarea)
          textarea.select()
          document.execCommand('copy')
          document.body.removeChild(textarea)
          toast({
            title: 'Link disalin!',
            description: `${role.toUpperCase()} ${channel > 0 ? channel : ''} — ${url}`,
          })
        },
      )
    },
    [toast],
  )

  // ── Render: Status Panel ─────────────────────────────────────────
  const renderStatusPanel = () => (
    <Card className={`${PANEL} ${BORDER} shadow-lg`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-[#c4b5fd]">
          <Monitor className="size-4" style={{ color: GOLD }} />
          Status Panel
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-lg bg-[#1a0b2e]/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-[#c4b5fd]" />
            <span className="text-sm text-[#c4b5fd]">Total Peserta</span>
          </div>
          <span className="text-2xl font-bold" style={{ color: GOLD }}>
            {totalPeserta}
          </span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-[#1a0b2e]/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-400" />
            <span className="text-sm text-[#c4b5fd]">Selesai Difoto</span>
          </div>
          <span className="text-2xl font-bold text-emerald-400">{doneCount}</span>
        </div>
      </CardContent>
    </Card>
  )

  // ── Render: Live Command Center ──────────────────────────────────
  const renderLiveCommandCenter = () => {
    const target1 = liveTargets[1]
    const target2 = liveTargets[2]
    const status1 = cameraStatus[1] ?? 'Menunggu target...'
    const status2 = cameraStatus[2] ?? 'Menunggu target...'

    return (
      <Card className={`${PANEL} ${BORDER} shadow-lg`}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-[#c4b5fd]">
            <Radio className="size-4" style={{ color: GOLD }} />
            Live Command Center
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {mode === 'single' ? (
            <div className="rounded-lg bg-[#1a0b2e]/60 px-4 py-3">
              <div className="mb-1 text-xs uppercase tracking-wider text-[#c4b5fd]/70">
                Target Aktif
              </div>
              <div className="text-base font-semibold" style={{ color: GOLD }}>
                {target1 ? target1.nama : '—'}
              </div>
              <Separator className="my-2 bg-[#533485]/50" />
              <div className="flex items-center gap-2">
                <Camera className="size-3.5 text-[#c4b5fd]/70" />
                <span className="text-xs text-[#c4b5fd]">{status1}</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Camera KIRI — Jalur 1 */}
              <div className="rounded-lg bg-[#1a0b2e]/60 px-4 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge
                    className="border-[#d4af37]/40 text-[10px]"
                    style={{ backgroundColor: 'rgba(212,175,55,0.15)', color: GOLD }}
                  >
                    Camera KIRI
                  </Badge>
                  <span className="text-[10px] text-[#c4b5fd]/60">Jalur 1</span>
                </div>
                <div className="text-sm font-semibold" style={{ color: GOLD }}>
                  {target1 ? target1.nama : '—'}
                </div>
                <Separator className="my-2 bg-[#533485]/50" />
                <div className="flex items-center gap-2">
                  <Camera className="size-3.5 text-[#c4b5fd]/70" />
                  <span className="text-xs text-[#c4b5fd]">{status1}</span>
                </div>
              </div>

              {/* Camera KANAN — Jalur 2 */}
              <div className="rounded-lg bg-[#1a0b2e]/60 px-4 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge
                    className="border-[#06b6d4]/40 text-[10px]"
                    style={{ backgroundColor: 'rgba(6,182,212,0.15)', color: CYAN }}
                  >
                    Camera KANAN
                  </Badge>
                  <span className="text-[10px] text-[#c4b5fd]/60">Jalur 2</span>
                </div>
                <div className="text-sm font-semibold" style={{ color: CYAN }}>
                  {target2 ? target2.nama : '—'}
                </div>
                <Separator className="my-2 bg-[#533485]/50" />
                <div className="flex items-center gap-2">
                  <Camera className="size-3.5 text-[#c4b5fd]/70" />
                  <span className="text-xs text-[#c4b5fd]">{status2}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // ── Render: LAN Access Distribution ──────────────────────────────
  const renderLanAccess = () => (
    <Card className={`${PANEL} ${BORDER} shadow-lg`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-[#c4b5fd]">
          <Wifi className="size-4" style={{ color: GOLD }} />
          LAN Access Distribution
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {mode === 'single' ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-2 border-[#533485] bg-[#1a0b2e]/60 text-[#c4b5fd] hover:bg-[#3b2263] hover:text-[#d4af37]"
              onClick={() => copyLink('mc', 1)}
            >
              <Copy className="size-3.5" />
              Copy Link MC
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 border-[#533485] bg-[#1a0b2e]/60 text-[#c4b5fd] hover:bg-[#3b2263] hover:text-[#d4af37]"
              onClick={() => copyLink('operator', 1)}
            >
              <Copy className="size-3.5" />
              Copy Link Operator
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Jalur Kiri */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                Jalur Kiri
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 border-[#d4af37]/30 bg-[#1a0b2e]/60 text-[#c4b5fd] hover:bg-[#3b2263] hover:text-[#d4af37]"
                  onClick={() => copyLink('mc', 1)}
                >
                  <Copy className="size-3.5" />
                  MC 1
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 border-[#d4af37]/30 bg-[#1a0b2e]/60 text-[#c4b5fd] hover:bg-[#3b2263] hover:text-[#d4af37]"
                  onClick={() => copyLink('operator', 1)}
                >
                  <Copy className="size-3.5" />
                  Operator 1
                </Button>
              </div>
            </div>

            <Separator className="bg-[#533485]/40" />

            {/* Jalur Kanan */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: CYAN }}>
                Jalur Kanan
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 border-[#06b6d4]/30 bg-[#1a0b2e]/60 text-[#c4b5fd] hover:bg-[#3b2263] hover:text-[#06b6d4]"
                  onClick={() => copyLink('mc', 2)}
                >
                  <Copy className="size-3.5" />
                  MC 2
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 border-[#06b6d4]/30 bg-[#1a0b2e]/60 text-[#c4b5fd] hover:bg-[#3b2263] hover:text-[#06b6d4]"
                  onClick={() => copyLink('operator', 2)}
                >
                  <Copy className="size-3.5" />
                  Operator 2
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )

  // ── Render: Photo History Item ───────────────────────────────────
  const renderPhotoItem = (item: PhotoHistoryItem, index: number) => {
    const { student, channel } = item
    const togaFilename = buildFilename(student.nim, student.nama, 1, 'Toga')
    const ijazahFilename = buildFilename(student.nim, student.nama, 2, 'Ijazah')

    const channelLabel = mode === 'dual' ? (channel === 1 ? 'Kiri' : 'Kanan') : 'Ch.1'
    const channelColor = mode === 'dual' ? (channel === 1 ? GOLD : CYAN) : GOLD

    return (
      <div
        key={`${student.id}-${channel}-${index}`}
        className="rounded-lg border border-[#533485]/50 bg-[#1a0b2e]/50 p-3"
      >
        {/* Student name row */}
        <div className="mb-2 flex items-center gap-2">
          <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
          <span className="truncate text-sm font-medium text-[#c4b5fd]">
            {student.nama}
          </span>
        </div>

        {/* Channel badge */}
        <div className="mb-2">
          <Badge
            className="text-[10px]"
            style={{
              backgroundColor:
                channel === 1 ? 'rgba(212,175,55,0.15)' : 'rgba(6,182,212,0.15)',
              color: channelColor,
              borderColor:
                channel === 1 ? 'rgba(212,175,55,0.3)' : 'rgba(6,182,212,0.3)',
            }}
          >
            {channelLabel}
          </Badge>
        </div>

        {/* Photo thumbnails */}
        <div className="flex gap-2">
          {/* Toga */}
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex h-14 items-center justify-center rounded-md bg-[#2a164a]/80 border border-[#533485]/30">
              <ImageIcon className="size-5 text-[#533485]" />
            </div>
            <span className="truncate text-[10px] text-[#c4b5fd]/60" title={togaFilename}>
              {togaFilename}
            </span>
          </div>
          {/* Ijazah */}
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex h-14 items-center justify-center rounded-md bg-[#2a164a]/80 border border-[#533485]/30">
              <ImageIcon className="size-5 text-[#533485]" />
            </div>
            <span className="truncate text-[10px] text-[#c4b5fd]/60" title={ijazahFilename}>
              {ijazahFilename}
            </span>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Photo Gallery ────────────────────────────────────────
  const renderPhotoGallery = () => (
    <Card className={`${PANEL} ${BORDER} shadow-lg flex flex-col h-full`}>
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-[#c4b5fd]">
            <ImageIcon className="size-4" style={{ color: GOLD }} />
            Log Render &amp; Penyimpanan
          </div>
          <Badge
            className="text-[10px] border-[#533485]/50"
            style={{ backgroundColor: 'rgba(212,175,55,0.15)', color: GOLD }}
          >
            {photoHistory.length} foto
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 pt-0">
        {photoHistory.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 py-8">
            <div className="flex size-16 items-center justify-center rounded-full bg-[#3b2263]/50">
              <Camera className="size-7 text-[#533485]" />
            </div>
            <p className="max-w-[240px] text-center text-sm text-[#c4b5fd]/60">
              Server aktif. Menunggu jepretan dari Operator Kamera...
            </p>
            <div className="flex items-center gap-1.5 text-xs text-[#533485]">
              <Clock className="size-3" />
              <span>Menunggu aktivitas</span>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-240px)] min-h-[200px]">
            <div className="grid grid-cols-1 gap-3 pr-2 sm:grid-cols-2">
              {photoHistory.map((item, idx) => renderPhotoItem(item, idx))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )

  // ── Main render ──────────────────────────────────────────────────
  return (
    <div className={`${BG} min-h-screen w-full p-4 md:p-6`}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:gap-6">
        {/* ── Left Column (1/3) ── */}
        <div className="flex w-full flex-col gap-4 md:w-1/3">
          {renderStatusPanel()}
          {renderLiveCommandCenter()}
          {renderLanAccess()}
        </div>

        {/* ── Right Column (2/3) ── */}
        <div className="w-full md:w-2/3">
          {renderPhotoGallery()}
        </div>
      </div>
    </div>
  )
}
