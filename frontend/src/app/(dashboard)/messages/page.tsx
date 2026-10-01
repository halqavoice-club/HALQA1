'use client'

/**
 * /messages → redirects to /dm
 * The Messages and Chat pages are unified. Both use the same DM system.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MessagesRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dm')
  }, [router])

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
