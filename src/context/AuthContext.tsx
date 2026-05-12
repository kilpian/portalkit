import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { useUser, useClerk, useAuth as useClerkAuth } from '@clerk/clerk-react'
import type { PortalUser } from '../lib/api'

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

    getToken()
      .then(token =>
        fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      )
      .then(r => r.json())
      .then((data: PortalUser) => {
        if (data.id) setPortalUser(data)
      })
      .catch(console.error)
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
