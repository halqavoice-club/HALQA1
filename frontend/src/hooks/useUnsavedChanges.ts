'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Warns the user before leaving a page with unsaved changes.
 * Usage: useUnsavedChanges(isDirty)
 */
export function useUnsavedChanges(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])
}
