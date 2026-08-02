'use client'
// Exams page — same component as assignments, opens on exams tab by default
// We re-export with the tab pre-set via a search param approach, but since
// the assignments page reads tab from state, simplest is to just redirect.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ExamsPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/assignments?tab=exams')
  }, [router])
  return null
}
