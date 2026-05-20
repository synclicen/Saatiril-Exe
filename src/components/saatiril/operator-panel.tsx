'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  User,
  Video,
  VideoOff,
  Aperture,
  Frame,
} from 'lucide-react'
import {
  useSaatirilStore,
  type Student,
  type StudentStatus,
  type PhotoHistoryItem,
} from '@/store/use-saatiril-store'
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

// ─── Filter preset map ──────────────────────────────────────────────────────
const PRESET_FILTERS: Record<string, string> = {
  original: 'none',
  studio: 'brightness(1.1) contrast(1.05) saturate(1.1)',
  cinematic: 'sepia(0.15) contrast(1.1) brightness(0.95) saturate(1.3)',
}

// ─── Ratio parser ───────────────────────────────────────────────────────────
function parseRatio(ratioStr: string): number {
  const parts = ratioStr.split(':')
  if (parts.length === 2) {
    const w = parseFloat(parts[0])
    const h = parseFloat(parts[1])
    if (w > 0 && h > 0) return w / h
  }
  return 4 / 3
}

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

// ─── Capture state machine ──────────────────────────────────────────────────
type CapturePhase = 'standby' | 'ready-1' | 'ready-2' | 'sending'

// ─── Video device info ──────────────────────────────────────────────────────
interface VideoDeviceInfo {
  deviceId: string
  label: string
}

// ─── Socket event data shapes ───────────────────────────────────────────────
interface McCallData {
  student: Student
  channel: number
}

interface SyncDbData {
  project: {
    id: string
    name: string
    config: {
      mode: 'single' | 'dual'
      ratio: string
      preset: string
      targetFolder: string
      frame: string | null
    }
    database: Student[]
    photoHistory: PhotoHistoryItem[]
  }
}

// ─── Component ──────────────────────────────────────────────────────────────
export function OperatorPanel() {
  // ── Store ────────────────────────────────────────────────────────────────
  const currentProject = useSaatirilStore((s) => s.currentProject)
  const myChannel = useSaatirilStore((s) => s.myChannel)
  const opCurrentTarget = useSaatirilStore((s) => s.opCurrentTarget)
  const opCapturedPhotos = useSaatirilStore((s) => s.opCapturedPhotos)
  const setOpCurrentTarget = useSaatirilStore((s) => s.setOpCurrentTarget)
  const addOpCapturedPhoto = useSaatirilStore((s) => s.addOpCapturedPhoto)
  const resetOpState = useSaatirilStore((s) => s.resetOpState)
  const updateStudentStatus = useSaatirilStore((s) => s.updateStudentStatus)
  const updateCurrentProject = useSaatirilStore((s) => s.updateCurrentProject)
  const saveProjectsToStorage = useSaatirilStore((s) => s.saveProjectsToStorage)

  // ── Local state ──────────────────────────────────────────────────────────
  const [videoDevices, setVideoDevices] = useState<VideoDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [cameraAvailable, setCameraAvailable] = useState(false)
  const [flashVisible, setFlashVisible] = useState(false)
  const [sending, setSending] = useState(false)

  // ── Refs ─────────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const activeRowRef = useRef<HTMLDivElement>(null)
  const nextRowRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const selectedDeviceRef = useRef<string>('')
  const frameImgRef = useRef<HTMLImageElement | null>(null)

  // ── Derived config ───────────────────────────────────────────────────────
  const config = currentProject?.config
  const aspectRatio = config?.ratio ? parseRatio(config.ratio) : 4 / 3
  const cssFilter = config?.preset ? PRESET_FILTERS[config.preset] ?? 'none' : 'none'
  const frameData = config?.frame ?? null

  // ── Preload frame image ──────────────────────────────────────────────────
  useEffect(() => {
    if (frameData) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { frameImgRef.current = img }
      img.onerror = () => { frameImgRef.current = null }
      img.src = frameData
    } else {
      frameImgRef.current = null
    }
  }, [frameData])

  // ── Derived data ─────────────────────────────────────────────────────────
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

  const hasActiveTarget = opCurrentTarget !== null

  const capturePhase = useMemo<CapturePhase>(() => {
    if (sending) return 'sending'
    if (!hasActiveTarget) return 'standby'
    if (opCapturedPhotos.length === 0) return 'ready-1'
    if (opCapturedPhotos.length === 1) return 'ready-2'
    return 'standby'
  }, [sending, hasActiveTarget, opCapturedPhotos.length])

  // ── Auto-scroll refs ─────────────────────────────────────────────────────
  useEffect(() => {
    const target = activeRowRef.current ?? nextRowRef.current
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentlyActive, nextPending])

  // ── Camera: enumerate devices ────────────────────────────────────────────
  const enumerateVideoDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoInputs = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Kamera ${d.deviceId.slice(0, 6)}`,
        }))
      setVideoDevices(videoInputs)
      if (videoInputs.length > 0 && !selectedDeviceRef.current) {
        setSelectedDeviceId(videoInputs[0].deviceId)
        selectedDeviceRef.current = videoInputs[0].deviceId
      }
    } catch (err) {
      console.error('[SAATIRIL OP] Failed to enumerate devices:', err)
    }
  }, [])

  // ── Camera: start stream ─────────────────────────────────────────────────
  const startCamera = useCallback(
    async (deviceId?: string) => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
        setCameraAvailable(false)
        return
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = stream
        setCameraAvailable(true)
        if (videoRef.current) videoRef.current.srcObject = stream
        await enumerateVideoDevices()
      } catch (err) {
        console.error('[SAATIRIL OP] Camera access failed:', err)
        setCameraAvailable(false)
      }
    },
    [enumerateVideoDevices],
  )

  useEffect(() => {
    queueMicrotask(() => void startCamera())
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [startCamera])

  useEffect(() => {
    if (selectedDeviceId && selectedDeviceRef.current !== selectedDeviceId) {
      selectedDeviceRef.current = selectedDeviceId
      queueMicrotask(() => void startCamera(selectedDeviceId))
    }
  }, [selectedDeviceId, startCamera])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return
    const handler = () => enumerateVideoDevices()
    navigator.mediaDevices.addEventListener('devicechange', handler)
    return () => { navigator.mediaDevices.removeEventListener('devicechange', handler) }
  }, [enumerateVideoDevices])

  // ── State recovery ───────────────────────────────────────────────────────
  const recoverOperatorState = useCallback(() => {
    if (!currentProject) return
    const activeStudent = currentProject.database.find(
      (s) => s.assignedChannel === myChannel && isActiveStatus(s.status),
    )
    if (activeStudent) setOpCurrentTarget(activeStudent)
  }, [currentProject, myChannel, setOpCurrentTarget])

  useEffect(() => { recoverOperatorState() }, [recoverOperatorState])

  // ── Socket: MC_CALL ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleMcCall = (data: McCallData) => {
      if (data.channel !== myChannel) return
      setOpCurrentTarget(data.student)
    }
    onLocal('MC_CALL', handleMcCall)
    return () => { offLocal('MC_CALL', handleMcCall) }
  }, [myChannel, setOpCurrentTarget])

  // ── Socket: SYNC_DB ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleSyncDb = (data: SyncDbData) => {
      if (!currentProject) return
      updateCurrentProject({ ...currentProject, database: data.project.database })
      const activeStudent = data.project.database.find(
        (s: Student) => s.assignedChannel === myChannel && isActiveStatus(s.status),
      )
      if (activeStudent) setOpCurrentTarget(activeStudent)
    }
    onLocal('SYNC_DB', handleSyncDb)
    return () => { offLocal('SYNC_DB', handleSyncDb) }
  }, [currentProject, myChannel, setOpCurrentTarget, updateCurrentProject])

  // ── Finalize capture ────────────────────────────────────────────────────
  const finalizeCapture = useCallback(
    (canvas: HTMLCanvasElement) => {
      setFlashVisible(true)
      setTimeout(() => setFlashVisible(false), 300)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95)
      addOpCapturedPhoto(dataUrl)
      const photoCount = opCapturedPhotos.length

      if (photoCount === 0) {
        emitLocal('OP_PROGRESS', { channel: myChannel, status: `Pose 1 OK — Siap Foto 2` })
      } else if (photoCount >= 1) {
        setSending(true)
        const student = opCurrentTarget!
        const allPhotos = [...opCapturedPhotos, dataUrl]
        const historyItem: PhotoHistoryItem = {
          student: { ...student },
          photos: allPhotos,
          channel: myChannel,
        }
        updateStudentStatus(student.id, 'done')
        saveProjectsToStorage()
        emitLocal('PHOTOS_SAVED', {
          student: { ...student },
          photos: allPhotos,
          channel: myChannel,
        })
        setTimeout(() => {
          const store = useSaatirilStore.getState()
          if (store.currentProject) {
            const existingIdx = store.currentProject.photoHistory.findIndex(
              (h) => h.student.id === student.id && h.channel === myChannel
            )
            let newHistory: PhotoHistoryItem[]
            if (existingIdx !== -1) {
              newHistory = [...store.currentProject.photoHistory]
              newHistory[existingIdx] = historyItem
            } else {
              newHistory = [...store.currentProject.photoHistory, historyItem]
            }
            const updatedProject = { ...store.currentProject, photoHistory: newHistory }
            store.updateCurrentProject(updatedProject)
            emitLocal('SYNC_DB', { project: updatedProject })
          }
          setSending(false)
          setTimeout(() => { resetOpState() }, 500)
        }, 100)
      }
    },
    [opCurrentTarget, opCapturedPhotos, myChannel, addOpCapturedPhoto, updateStudentStatus, saveProjectsToStorage, resetOpState],
  )

  // ── Photo capture logic ──────────────────────────────────────────────────
  const handleCapture = useCallback(() => {
    if (!opCurrentTarget) return
    if (capturePhase !== 'ready-1' && capturePhase !== 'ready-2') return

    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas) return

    const targetWidth = 1920
    const targetHeight = Math.round(targetWidth / aspectRatio)
    canvas.width = targetWidth
    canvas.height = targetHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, targetWidth, targetHeight)

    if (video && video.readyState >= 2) {
      const videoWidth = video.videoWidth
      const videoHeight = video.videoHeight
      const videoRatio = videoWidth / videoHeight
      let sx = 0, sy = 0, sw = videoWidth, sh = videoHeight
      if (videoRatio > aspectRatio) {
        sw = videoHeight * aspectRatio
        sx = (videoWidth - sw) / 2
      } else {
        sh = videoWidth / aspectRatio
        sy = (videoHeight - sh) / 2
      }
      if (cssFilter !== 'none') ctx.filter = cssFilter
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
      ctx.filter = 'none'
    } else {
      ctx.fillStyle = '#1a0b2e'
      ctx.fillRect(0, 0, targetWidth, targetHeight)
      ctx.fillStyle = '#533485'
      ctx.font = 'bold 48px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('NO CAMERA SIGNAL', targetWidth / 2, targetHeight / 2)
    }

    if (frameImgRef.current) {
      ctx.drawImage(frameImgRef.current, 0, 0, targetWidth, targetHeight)
      finalizeCapture(canvas)
    } else if (frameData) {
      const frameImg = new Image()
      frameImg.crossOrigin = 'anonymous'
      frameImg.onload = () => { ctx.drawImage(frameImg, 0, 0, targetWidth, targetHeight); finalizeCapture(canvas) }
      frameImg.onerror = () => { finalizeCapture(canvas) }
      frameImg.src = frameData
    } else {
      finalizeCapture(canvas)
    }
  }, [opCurrentTarget, capturePhase, aspectRatio, cssFilter, frameData, finalizeCapture])

  // ── Progress badge text ──────────────────────────────────────────────────
  const progressText = useMemo(() => {
    if (!hasActiveTarget) return 'Menunggu Arahan MC...'
    if (capturePhase === 'ready-1') return 'Siap Foto 1'
    if (capturePhase === 'ready-2') return 'Pose 1 OK - Siap Foto 2'
    if (capturePhase === 'sending') return 'Mengirim...'
    return 'Menunggu Arahan MC...'
  }, [hasActiveTarget, capturePhase])

  // ── Render helpers ───────────────────────────────────────────────────────
  const getRowStyle = (student: Student): React.CSSProperties => {
    const isActive = student.status === `active_${myChannel}`
    const isNext = student.id === nextPending?.id && student.status === 'pending'
    const isDone = student.status === 'done'
    if (isActive) return { backgroundColor: `${THEME.gold}22`, borderLeft: `4px solid ${THEME.gold}`, boxShadow: `0 0 12px ${THEME.gold}44` }
    if (isNext) return { backgroundColor: THEME.panel, borderLeft: `4px solid ${THEME.gold}` }
    if (isDone) return { backgroundColor: '#22c55e0d', opacity: 0.55, borderLeft: `4px solid #22c55e66` }
    return { backgroundColor: THEME.panel, borderLeft: `4px solid ${THEME.border}` }
  }

  const renderStatusBadge = (status: StudentStatus) => {
    if (status === 'done') return <Badge className="text-[10px] px-1.5 py-0" style={{ backgroundColor: '#22c55e33', color: '#4ade80', border: '1px solid #22c55e55' }}><CheckCircle2 className="size-3 mr-0.5" />Selesai</Badge>
    if (isActiveStatus(status)) return <Badge className="text-[10px] px-1.5 py-0 animate-pulse" style={{ backgroundColor: `${THEME.gold}33`, color: THEME.gold, border: `1px solid ${THEME.gold}66` }}><Loader2 className="size-3 mr-0.5 animate-spin" />{statusLabel(status)}</Badge>
    return <Badge className="text-[10px] px-1.5 py-0" style={{ backgroundColor: `${THEME.border}44`, color: THEME.muted, border: `1px solid ${THEME.border}` }}><Clock className="size-3 mr-0.5" />Menunggu</Badge>
  }

  // ── Main render ──────────────────────────────────────────────────────────
  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full" style={{ backgroundColor: THEME.bg, color: THEME.muted }}>
        <p className="text-sm opacity-60">Belum ada proyek aktif</p>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden" style={{ backgroundColor: THEME.bg }}>

      {/* ═══════════════════════════════════════════════════════════════════════
          CAMERA ZONE — Aspect ratio is king, camera dictates its own size
          Height fills available space, width is derived from aspect ratio
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-center h-full p-3 flex-shrink-0"
        style={{ minWidth: 0 }}
      >
        <div
          className="relative rounded-xl overflow-hidden border-2 h-full"
          style={{
            aspectRatio: `${aspectRatio}`,
            maxHeight: '100%',
            borderColor: hasActiveTarget ? THEME.gold : THEME.border,
            boxShadow: hasActiveTarget ? `0 0 16px ${THEME.gold}15` : 'none',
            backgroundColor: '#000000',
          }}
        >
          {/* Video — fills the container exactly matching aspect ratio */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              filter: cssFilter !== 'none' ? cssFilter : undefined,
            }}
          />

          {/* Frame overlay preview on camera */}
          {frameData && (
            <img
              src={frameData}
              alt="Frame overlay"
              className="absolute inset-0 w-full h-full object-fill pointer-events-none"
              style={{ zIndex: 5 }}
            />
          )}

          {/* Rule of thirds grid overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 6 }}>
            <div className="absolute top-0 bottom-0 left-[33.333%] w-px bg-white/[0.12]" />
            <div className="absolute top-0 bottom-0 left-[66.666%] w-px bg-white/[0.12]" />
            <div className="absolute left-0 right-0 top-[33.333%] h-px bg-white/[0.12]" />
            <div className="absolute left-0 right-0 top-[66.666%] h-px bg-white/[0.12]" />
          </div>

          {/* Flash overlay */}
          <div
            ref={flashRef}
            className="absolute inset-0 transition-opacity duration-150 pointer-events-none"
            style={{
              backgroundColor: '#ffffff',
              opacity: flashVisible ? 0.85 : 0,
              zIndex: 20,
            }}
          />

          {/* NO CAMERA SIGNAL overlay */}
          {!cameraAvailable && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80" style={{ zIndex: 8 }}>
              <VideoOff className="size-12" style={{ color: THEME.border }} />
              <p className="text-sm font-semibold tracking-wider" style={{ color: THEME.muted }}>
                NO CAMERA SIGNAL
              </p>
              <p className="text-xs" style={{ color: THEME.border }}>
                Pastikan kamera terhubung dan izin diberikan
              </p>
            </div>
          )}

          {/* Aspect ratio & frame indicator badges */}
          <div className="absolute top-2 left-2 flex gap-1.5" style={{ zIndex: 10 }}>
            <Badge
              className="text-[9px] px-1.5 py-0.5 border-0"
              style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: THEME.muted }}
            >
              {config?.ratio ?? '4:3'}
            </Badge>
            {frameData && (
              <Badge
                className="text-[9px] px-1.5 py-0.5 border-0"
                style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: THEME.gold }}
              >
                <Frame className="size-2.5 mr-0.5" />
                Frame
              </Badge>
            )}
          </div>

          {/* Hidden canvas for photo capture */}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SIDEBAR — Target info, Queue list, Capture button
          Takes remaining horizontal space, adapts to camera size
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col gap-2 p-3 min-w-[260px] max-w-[380px] flex-1 min-h-0">

        {/* ── Target Info Panel (compact) ────────────────────────────────── */}
        <Card
          className="shrink-0 border-2 rounded-lg transition-all duration-300"
          style={{
            backgroundColor: THEME.card,
            borderColor: hasActiveTarget ? THEME.gold : THEME.border,
            opacity: hasActiveTarget ? 1 : 0.5,
            boxShadow: hasActiveTarget ? `0 0 20px ${THEME.gold}22` : 'none',
          }}
        >
          <CardContent className="p-2.5">
            <div className="flex items-center gap-2.5">
              {/* Avatar */}
              <div
                className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full border-2"
                style={{
                  backgroundColor: THEME.panel,
                  borderColor: hasActiveTarget ? THEME.gold : THEME.border,
                }}
              >
                <User className="size-4" style={{ color: hasActiveTarget ? THEME.gold : THEME.border }} />
              </div>

              {/* Name & NIM */}
              <div className="flex-1 min-w-0">
                {hasActiveTarget ? (
                  <>
                    <p className="text-sm font-bold leading-tight truncate" style={{ color: '#ffffff' }}>
                      {opCurrentTarget.nama}
                    </p>
                    <p className="text-[11px] font-mono" style={{ color: THEME.muted }}>
                      {opCurrentTarget.nim}
                    </p>
                  </>
                ) : (
                  <p className="text-xs italic" style={{ color: THEME.muted }}>
                    Menunggu panggilan MC...
                  </p>
                )}
              </div>

              {/* Progress Badge */}
              <Badge
                className={`text-[10px] px-2 py-0.5 shrink-0 ${hasActiveTarget && !sending ? 'animate-pulse' : ''}`}
                style={{
                  backgroundColor:
                    capturePhase === 'ready-1' ? `${THEME.gold}33`
                      : capturePhase === 'ready-2' ? '#22c55e33'
                        : capturePhase === 'sending' ? `${THEME.border}66`
                          : `${THEME.border}44`,
                  color:
                    capturePhase === 'ready-1' ? THEME.gold
                      : capturePhase === 'ready-2' ? '#4ade80'
                        : THEME.muted,
                  border: `1px solid ${
                    capturePhase === 'ready-1' ? `${THEME.gold}66`
                      : capturePhase === 'ready-2' ? '#22c55e66'
                        : THEME.border
                  }`,
                }}
              >
                {capturePhase === 'sending' && <Loader2 className="size-3 mr-0.5 animate-spin" />}
                {capturePhase === 'ready-1' && <Camera className="size-3 mr-0.5" />}
                {capturePhase === 'ready-2' && <CheckCircle2 className="size-3 mr-0.5" />}
                {capturePhase === 'standby' && <Clock className="size-3 mr-0.5" />}
                {progressText}
              </Badge>
            </div>

            {/* Camera selector row */}
            <div className="mt-2 flex items-center gap-2">
              <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                <SelectTrigger
                  className="flex-1 text-[11px] h-7"
                  style={{
                    backgroundColor: THEME.panel,
                    borderColor: THEME.border,
                    color: THEME.muted,
                  }}
                >
                  <Video className="size-3 mr-1 shrink-0" style={{ color: THEME.gold }} />
                  <SelectValue placeholder="Pilih Kamera" />
                </SelectTrigger>
                <SelectContent style={{ backgroundColor: THEME.panel, borderColor: THEME.border }}>
                  {videoDevices.length === 0 ? (
                    <SelectItem value="__none" disabled>Tidak ada kamera</SelectItem>
                  ) : (
                    videoDevices.map((dev) => (
                      <SelectItem key={dev.deviceId} value={dev.deviceId} style={{ color: '#ffffff' }}>
                        {dev.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ── Queue List ────────────────────────────────────────────────── */}
        <Card
          className="flex-1 min-h-0 border rounded-lg overflow-hidden flex flex-col"
          style={{ backgroundColor: THEME.card, borderColor: THEME.border }}
        >
          {/* Header */}
          <div
            className="shrink-0 flex items-center justify-between px-3 py-2"
            style={{ borderBottom: `1px solid ${THEME.border}` }}
          >
            <h3 className="text-xs font-semibold" style={{ color: '#ffffff' }}>
              Antrean:{' '}
              <span style={{ color: THEME.gold }} className="font-bold">
                {remainingCount}
              </span>
            </h3>
            <span className="text-[10px]" style={{ color: THEME.muted }}>
              Ch.{myChannel}
            </span>
          </div>

          {/* Column headers */}
          <div
            className="shrink-0 grid grid-cols-[24px_60px_1fr_60px] gap-0.5 px-2 py-1 text-[8px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: THEME.panel,
              color: THEME.muted,
              borderBottom: `1px solid ${THEME.border}`,
            }}
          >
            <span>No</span>
            <span>NIM</span>
            <span>Nama</span>
            <span className="text-right">Status</span>
          </div>

          {/* Scrollable rows */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col">
              {channelStudents.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-xs" style={{ color: THEME.muted }}>
                    Tidak ada mahasiswa
                  </p>
                </div>
              ) : (
                channelStudents.map((student, idx) => {
                  const isActive = student.status === `active_${myChannel}`
                  const isNext = student.id === nextPending?.id && student.status === 'pending'

                  return (
                    <div
                      key={student.id}
                      ref={isActive ? activeRowRef : isNext ? nextRowRef : undefined}
                      className="grid grid-cols-[24px_60px_1fr_60px] gap-0.5 items-center px-2 py-1 transition-colors duration-200"
                      style={getRowStyle(student)}
                    >
                      <span className="text-[9px] font-mono" style={{ color: THEME.muted }}>
                        {idx + 1}
                      </span>
                      <span className="text-[9px] font-mono truncate" style={{ color: THEME.muted }}>
                        {student.nim}
                      </span>
                      <span
                        className={`text-[10px] font-medium truncate ${student.status === 'done' ? 'line-through' : ''}`}
                        style={{
                          color: isActive ? THEME.gold : student.status === 'done' ? THEME.muted : '#ffffff',
                        }}
                      >
                        {student.nama}
                      </span>
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

        {/* ── Capture Button ────────────────────────────────────────────── */}
        <div className="shrink-0">
          {capturePhase === 'standby' && (
            <Button
              disabled
              className="w-full h-12 text-sm font-bold cursor-not-allowed rounded-lg"
              style={{
                backgroundColor: THEME.panel,
                color: THEME.muted,
                border: `2px solid ${THEME.border}`,
                opacity: 0.6,
              }}
            >
              <Aperture className="size-4 mr-2" />
              STANDBY
            </Button>
          )}

          {capturePhase === 'ready-1' && (
            <Button
              onClick={handleCapture}
              className="w-full h-12 text-sm font-bold cursor-pointer rounded-lg transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
              style={{
                backgroundColor: THEME.gold,
                color: THEME.bg,
                border: `2px solid ${THEME.gold}`,
                boxShadow: `0 0 30px ${THEME.gold}44, 0 0 60px ${THEME.gold}22`,
              }}
            >
              <Camera className="size-4 mr-2" />
              1. JEPRET (TOGA)
            </Button>
          )}

          {capturePhase === 'ready-2' && (
            <Button
              onClick={handleCapture}
              className="w-full h-12 text-sm font-bold cursor-pointer rounded-lg transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
              style={{
                backgroundColor: '#22c55e',
                color: '#ffffff',
                border: `2px solid #22c55e`,
                boxShadow: `0 0 30px #22c55e44, 0 0 60px #22c55e22`,
              }}
            >
              <Camera className="size-4 mr-2" />
              2. JEPRET (IJAZAH)
            </Button>
          )}

          {capturePhase === 'sending' && (
            <Button
              disabled
              className="w-full h-12 text-sm font-bold cursor-not-allowed rounded-lg"
              style={{
                backgroundColor: THEME.panel,
                color: THEME.muted,
                border: `2px solid ${THEME.border}`,
              }}
            >
              <Loader2 className="size-4 mr-2 animate-spin" />
              MENGIRIM...
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default OperatorPanel
