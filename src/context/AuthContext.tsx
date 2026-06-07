import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useUser, useClerk, useAuth as useClerkAuth } from '@clerk/clerk-react'
import posthog from 'posthog-js'
import API_BASE, { type PortalUser } from '../lib/api'

interface PortalAuthContextType {
  user: PortalUser | null
  isLoggedIn: boolean
  isLoaded: boolean
  signOut: () => void
  setUser: (user: PortalUser) => void
  refreshUser: () => Promise<void>
}

const PortalAuthContext = createContext<PortalAuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser()
  const { signOut: clerkSignOut } = useClerk()
  const { getToken } = useClerkAuth()
  const [portalUser, setPortalUser] = useState<PortalUser | null>(null)

  const fetchUser = useCallback(async (retries = 3) => {
    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.id) {
        setPortalUser(data)
        posthog.identify(data.id.toString(), {
          email: data.email,
          name: data.full_name,
          business_name: data.business_name,
          plan: data.plan,
          created_at: data.created_at,
        })
        // Track referral code if present (stored at signup from ?ref= URL param)
        const refCode = localStorage.getItem('portalkit_ref')
        const affCode = localStorage.getItem('pk_affiliate')
        if (refCode || affCode) {
          fetch(`${API_BASE}/api/auth/me`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(refCode ? { ref: refCode } : {}),
              ...(affCode ? { affiliate_code: affCode } : {}),
            }),
          }).catch(() => {})
          if (refCode) localStorage.removeItem('portalkit_ref')
          if (affCode) localStorage.removeItem('pk_affiliate')
        }
      } else if (retries > 0) {
        setTimeout(() => fetchUser(retries - 1), 1000)
      }
    } catch (err) {
      if (retries > 0) setTimeout(() => fetchUser(retries - 1), 1000)
    }
  }, [getToken])

  useEffect(() => {
    if (!clerkLoaded) return
    if (!clerkUser) { setPortalUser(null); return }
    fetchUser()
  }, [clerkUser, clerkLoaded, fetchUser])

  const refreshUser = useCallback(async () => {
    await fetchUser(0)
  }, [fetchUser])

  const signOut = useCallback(() => {
    setPortalUser(null)
    clerkSignOut()
  }, [clerkSignOut])

  const updateUser = useCallback((updated: PortalUser) => {
    setPortalUser(updated)
  }, [])

  return (
    <PortalAuthContext.Provider value={{
      user: portalUser,
      isLoggedIn: !!clerkUser,
      isLoaded: clerkLoaded,
      signOut,
      setUser: updateUser,
      refreshUser,
    }}>
      {children}
    </PortalAuthContext.Provider>
  )
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext)
  if (!ctx) throw new Error('usePortalAuth must be used within AuthProvider')
  return ctx
}
