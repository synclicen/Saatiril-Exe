'use client'

import { create } from 'zustand'

export type StudentStatus = 'pending' | 'done' | `active_${number}`

export interface Student {
  id: string
  nim: string
  nama: string
  status: StudentStatus
  assignedChannel: number
}

export interface ProjectConfig {
  mode: 'single' | 'dual'
  ratio: string
  preset: string
  targetFolder: string
  frame: string | null
}

export interface PhotoHistoryItem {
  student: Student
  photos: string[]
  channel: number
}

export interface Project {
  id: string
  name: string
  config: ProjectConfig
  database: Student[]
  photoHistory: PhotoHistoryItem[]
}

export type Role = 'admin' | 'mc' | 'operator'
export type AppScreen = 'hub' | 'setup' | 'app'
export type AppTab = 'admin' | 'mc' | 'operator'

// ─── Storage version: clear stale data on reinstall/version change ────────────
const STORAGE_VERSION = '1.0.0'

// ─── Memory guard: max photo history items kept in memory ──────────────────
// With thousands of participants, we can't keep all base64 photos in memory.
// Admin keeps last N items for live gallery; MC/Operator only need current target.
// Photos are still saved to disk by the Operator's SYNC_DB handler.
const MAX_PHOTO_HISTORY_IN_MEMORY = 200

// ─── Debounced save ───────────────────────────────────────────────────────
let saveTimeout: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 500 // Debounce saves to avoid thrashing localStorage

interface SaatirilState {
  // Projects
  projects: Project[]
  currentProject: Project | null

  // User role & channel
  myRole: Role
  myChannel: number

  // Screen & Tab
  currentScreen: AppScreen
  currentTab: AppTab

  // Operator state
  opCurrentTarget: Student | null
  opCapturedPhotos: string[]

  // Actions
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  deleteProject: (id: string) => void
  setCurrentProject: (project: Project | null) => void
  updateCurrentProject: (project: Project) => void
  setMyRole: (role: Role) => void
  setMyChannel: (channel: number) => void
  setCurrentScreen: (screen: AppScreen) => void
  setCurrentTab: (tab: AppTab) => void
  setOpCurrentTarget: (target: Student | null) => void
  setOpCapturedPhotos: (photos: string[]) => void
  addOpCapturedPhoto: (photo: string) => void
  resetOpState: () => void
  loadProjectsFromStorage: () => void
  saveProjectsToStorage: () => void
  updateStudentStatus: (studentId: string, status: StudentStatus) => void
}

/**
 * Trim photoHistory to prevent memory bloat with thousands of participants.
 * Only keeps the most recent N items (by array order = chronological).
 * Photo data is still saved to disk via the Operator's file save logic.
 */
function trimPhotoHistory(history: PhotoHistoryItem[]): PhotoHistoryItem[] {
  if (history.length <= MAX_PHOTO_HISTORY_IN_MEMORY) return history
  // Keep the most recent items (last N)
  return history.slice(history.length - MAX_PHOTO_HISTORY_IN_MEMORY)
}

export const useSaatirilStore = create<SaatirilState>((set, get) => ({
  projects: [],
  currentProject: null,
  myRole: 'admin',
  myChannel: 1,
  currentScreen: 'hub',
  currentTab: 'admin',
  opCurrentTarget: null,
  opCapturedPhotos: [],

  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
  deleteProject: (id) => set((s) => {
    const newProjects = s.projects.filter(p => p.id !== id)
    return { projects: newProjects }
  }),
  setCurrentProject: (project) => set({ currentProject: project }),
  updateCurrentProject: (project) => set((s) => {
    // Auto-trim photo history to prevent memory bloat
    const trimmedProject = {
      ...project,
      photoHistory: trimPhotoHistory(project.photoHistory),
    }
    const idx = s.projects.findIndex(p => p.id === trimmedProject.id)
    const newProjects = [...s.projects]
    if (idx !== -1) newProjects[idx] = trimmedProject
    return { currentProject: trimmedProject, projects: newProjects }
  }),
  setMyRole: (role) => set({ myRole: role }),
  setMyChannel: (channel) => set({ myChannel: channel }),
  setCurrentScreen: (screen) => set({ currentScreen: screen }),
  setCurrentTab: (tab) => set({ currentTab: tab }),
  setOpCurrentTarget: (target) => set({ opCurrentTarget: target }),
  setOpCapturedPhotos: (photos) => set({ opCapturedPhotos: photos }),
  addOpCapturedPhoto: (photo) => set((s) => ({ opCapturedPhotos: [...s.opCapturedPhotos, photo] })),
  resetOpState: () => set({ opCurrentTarget: null, opCapturedPhotos: [] }),

  loadProjectsFromStorage: () => {
    try {
      // Version check — clear stale data on reinstall/version change
      const savedVersion = localStorage.getItem('saatiril_version')
      if (savedVersion !== STORAGE_VERSION) {
        console.log('[SAATIRIL] Storage version mismatch — clearing stale data')
        localStorage.removeItem('saatiril_projects')
        localStorage.setItem('saatiril_version', STORAGE_VERSION)
        set({ projects: [], currentProject: null })
        return
      }

      const saved = localStorage.getItem('saatiril_projects')
      if (saved) {
        const projects = JSON.parse(saved)
        set({ projects })
      }
    } catch (e) {
      console.error('Failed to load projects from storage', e)
    }
  },

  saveProjectsToStorage: () => {
    // Debounced — prevents localStorage thrashing during rapid state changes
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      try {
        const { projects } = get()
        // Never save photoHistory to localStorage (too large, and it's transient data)
        // Photo data is saved to disk by Operator's file save logic
        const safeProjects = projects.map(p => ({ ...p, photoHistory: [] }))
        localStorage.setItem('saatiril_projects', JSON.stringify(safeProjects))
      } catch (e) {
        console.error('Failed to save projects to storage', e)
      }
    }, SAVE_DEBOUNCE_MS)
  },

  updateStudentStatus: (studentId, status) => set((s) => {
    if (!s.currentProject) return {}
    const newDb = s.currentProject.database.map(st =>
      st.id === studentId ? { ...st, status } : st
    )
    const updatedProject = { ...s.currentProject, database: newDb }
    const idx = s.projects.findIndex(p => p.id === updatedProject.id)
    const newProjects = [...s.projects]
    if (idx !== -1) newProjects[idx] = updatedProject
    return { currentProject: updatedProject, projects: newProjects }
  }),
}))
