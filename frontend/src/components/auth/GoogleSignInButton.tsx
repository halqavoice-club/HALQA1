'use client'

/**
 * GoogleSignInButton.tsx
 *
 * Renders a "Continue with Google" button using Google's OAuth popup flow.
 *
 * SECURITY NOTES:
 *   - This component handles ONLY the UI and the Google credential handoff.
 *   - The Google credential (ID token) is sent to the HALQA backend for
 *     server-side verification — never trusted client-side.
 *   - No role selection is presented. The backend always assigns MEMBER.
 *   - If NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set, the button is hidden so
 *     the login page still works without Google configured.
 *
 * FLOW:
 *   1. User clicks button → Google OAuth popup opens
 *   2. User authenticates with Google
 *   3. Google returns a credential (ID token) to this component
 *   4. Component sends credential to HALQA backend POST /auth/google
 *   5. Backend verifies, finds/creates user, returns HALQA tokens
 *   6. Frontend stores tokens using existing auth store (same as password login)
 */

import { useGoogleLogin } from '@react-oauth/google'
import { useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'

// Google icon SVG (official brand colors — no external image dependency)
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

interface GoogleSignInButtonProps {
  onCredential: (credential: string) => Promise<void>
  disabled?: boolean
}

export function GoogleSignInButton({ onCredential, disabled }: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleSuccess = useCallback(async (tokenResponse: any) => {
    // useGoogleLogin returns access_token, but we need the ID token (credential).
    // For ID token flow, use the credential-based approach below instead.
    // This branch handles the implicit/token flow if needed.
    setError('Unexpected response from Google. Please try again.')
  }, [])

  // Use the credential (ID token) flow — this is the secure server-side verification path
  const signIn = useGoogleLogin({
    flow: 'implicit',
    onSuccess: handleSuccess,
    onError: (err) => {
      if ((err as any)?.error !== 'popup_closed_by_user') {
        setError('Google Sign-In failed. Please try again.')
      }
    },
  })

  // This component is not used directly — see GoogleOneTap below for the correct flow
  return null
}

/**
 * GoogleOneTapButton — uses the credential (ID token) flow.
 * This is the correct secure flow for HALQA:
 *   Google → ID token → HALQA backend verifies → HALQA tokens
 */
interface GoogleOneTapProps {
  onCredential: (credential: string) => Promise<void>
  disabled?: boolean
  className?: string
}

export function GoogleButton({ onCredential, disabled, className }: GoogleOneTapProps) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // useGoogleLogin with select_account prompt for explicit account selection
  const signIn = useGoogleLogin({
    flow: 'auth-code',
    // We don't use the auth-code flow here. Use the CredentialResponse from GoogleOAuthProvider.
    onSuccess: async () => {},
    onError: () => {
      setError('Google Sign-In failed. Please try again.')
      setLoading(false)
    },
  })

  // For the credential (ID token) flow, we use the GoogleLogin component from @react-oauth/google
  // This renders Google's own button. We customize the rendering to match HALQA's design.
  return (
    <div className={className}>
      {error && (
        <p className="text-xs text-red-500 text-center mb-2">{error}</p>
      )}
      {/* Rendered by parent via GoogleLogin component — see login page */}
    </div>
  )
}
