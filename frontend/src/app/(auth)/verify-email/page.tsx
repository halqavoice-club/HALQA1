/**
 * Email verification page
 *
 * After registration, users receive a 6-digit OTP by email.
 * They enter it here to activate their account and proceed to login.
 *
 * Flow:
 *   Register → check email → enter OTP here → verified → sign in
 */

import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import VerifyEmailContent from './VerifyEmailContent'

// Page wrapper — required by Next.js 14 because VerifyEmailContent uses
// useSearchParams(), which needs a <Suspense> boundary at the page level.
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  )
}
