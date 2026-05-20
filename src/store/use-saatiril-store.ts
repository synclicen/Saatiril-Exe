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
    const idx = s.projects.findIndex(p => p.id === project.id)
    const newProjects = [...s.projects]
    if (idx !== -1) newProjects[idx] = project
    return { currentProject: project, projects: newProjects }
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
    try {
      const { projects } = get()
      const safeProjects = projects.map(p => ({ ...p, photoHistory: [] }))
      localStorage.setItem('saatiril_projects', JSON.stringify(safeProjects))
    } catch (e) {
      console.error('Failed to save projects to storage', e)
    }
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
