import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { getStoredUser, saveSession, clearSession, isAuthenticated, getToken } from '../lib/auth'
import { apiSignIn, apiSignUp } from '../lib/api'
import type { AuthUser } from '../lib/auth'
import type { SignInPayload, SignUpPayload } from '../lib/api'

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  signIn: (payload: SignInPayload) => Promise<void>
  signUp: (payload: SignUpPayload) => Promise<void>
  signOut: () => void
  isLoggedIn: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isAuthenticated()) {
      setUser(getStoredUser())
      const token = getToken()
      if (token) {
        fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json())
          .then(userData => {
            if (userData.plan) {
              localStorage.setItem('pk_user_plan', userData.plan)
            }
            if (userData.id) setUser(userData as AuthUser)
          })
          .catch(() => {})
      }
    }
    setLoading(false)
  }, [])

  const signIn = async (payload: SignInPayload) => {
    const { token, user } = await apiSignIn(payload)
    saveSession(token, user as AuthUser)
    setUser(user as AuthUser)
  }

  const signUp = async (payload: SignUpPayload) => {
    const { token, user } = await apiSignUp(payload)
    saveSession(token, user as AuthUser)
    setUser(user as AuthUser)
  }

  const signOut = () => {
    clearSession()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, isLoggedIn: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
