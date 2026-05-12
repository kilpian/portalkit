const TOKEN_KEY = 'pk_token'
const USER_KEY  = 'pk_user'

export interface AuthUser {
  id: number
  email: string
  full_name: string
  business_name?: string
  plan?: string
  trial_ends_at?: string
  stripe_customer_id?: string
  created_at: string
}

export function saveSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function isAuthenticated(): boolean {
  const token = getToken()
  if (!token) return false
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearSession()
      return false
    }
    return true
  } catch {
    clearSession()
    return false
  }
}
