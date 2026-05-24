'use client'

import { useEffect, useState } from 'react'

const MOBILE_BREAKPOINT = 768 // md breakpoint in Tailwind

/**
 * Detect if the current viewport is mobile-sized.
 * Returns true for screens narrower than 768px.
 * Also detects touch-only devices.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => {
      const width = window.innerWidth
      const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      setIsMobile(width < MOBILE_BREAKPOINT || (width < 1024 && hasTouchScreen))
    }

    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return isMobile
}
