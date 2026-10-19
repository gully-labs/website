import { useCallback, useEffect, useState } from 'react'
import { ADMIN_SECTIONS } from './adminSections'

export const ADMIN_SECTION_IDS = ADMIN_SECTIONS.map((s) => s.id)
const IDS = ADMIN_SECTION_IDS
const read = () => {
  const h = typeof location === 'undefined' ? '' : location.hash.slice(1)
  return IDS.includes(h) ? h : IDS[0]
}

export function useAdminSection(): [string, (id: string) => void] {
  const [section, setSection] = useState(read)
  useEffect(() => {
    const on = () => setSection(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  // A new section opens at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [section])
  const go = useCallback((id: string) => {
    if (!IDS.includes(id)) return
    if (location.hash.slice(1) === id) setSection(id)
    else location.hash = id
  }, [])
  return [section, go]
}

