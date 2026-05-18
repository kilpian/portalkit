import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useUser, useClerk, useAuth as useClerkAuth } from '@clerk/clerk-react'
import API_BASE, { type PortalUser } from '../lib/api'

interface PortalAuthContextType {
  user: PortalUser | null
  isLoggedIn: boolean
  isLoaded: boolean
  signOut: () => void
  setUser: (user: PortalUser) => void
}

const PortalAuthContext = createContext<PortalAuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser()
  const { signOut: clerkSignOut } = useClerk()
  const { getToken } = useClerkAuth()
  const [portalUser, setPortalUser] = useState<PortalUser | null>(null)

  useEffect(() => {
    if (!clerkLoaded) return
    if (!clerkUser) { setPortalUser(null); return }

    const fetchUser = async (retries = 3) => {
      try {
        const token = await getToken()
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const data = await res.json()
        if (data.id) {
          setPortalUser(data)
        } else if (retries > 0) {
          setTimeout(() => fetchUser(retries - 1), 1000)
        }
      } catch (err) {
        if (retries > 0) setTimeout(() => fetchUser(retries - 1), 1000)
      }
    }

    fetchUser()
  }, [clerkUser, clerkLoaded, getToken])

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
