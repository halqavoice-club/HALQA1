'use client'

import { PKBattleView } from '@/components/pk/PKBattleView'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

/**
 * PK Battle page — /voice-club/pk/[id]
 * Renders the live PK battle UI for a given match ID.
 */
export default function PKBattlePage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          className="text-white/60 hover:text-white hover:bg-white/10"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-bold">⚔️ PK Battle</h1>
      </div>

      {/* Battle view */}
      <div className="p-4 max-w-2xl mx-auto">
        <PKBattleView pkMatchId={id} />
      </div>
    </div>
  )
}
