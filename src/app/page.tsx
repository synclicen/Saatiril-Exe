'use client'

import { useEffect } from 'react'
import { useSaatirilStore } from '@/store/use-saatiril-store'
import { ProjectHub } from '@/components/saatiril/project-hub'
import ProjectSetup from '@/components/saatiril/project-setup'
import { MainApp } from '@/components/saatiril/main-app'

export default function Home() {
  const currentScreen = useSaatirilStore((s) => s.currentScreen)
  const loadProjectsFromStorage = useSaatirilStore((s) => s.loadProjectsFromStorage)

  useEffect(() => {
    loadProjectsFromStorage()
  }, [loadProjectsFromStorage])

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {currentScreen === 'hub' && <ProjectHub />}
      {currentScreen === 'setup' && <ProjectSetup />}
      {currentScreen === 'app' && <MainApp />}
    </div>
  )
}
