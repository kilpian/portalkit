import type { AuthUser } from './auth'

export function isTrialActive(user: AuthUser | null): boolean {
  if (!user) return false
  if (user.plan === 'active') return false
  if (!user.trial_ends_at) return true
  return new Date(user.trial_ends_at) > new Date()
}

export function isSubscribed(user: AuthUser | null): boolean {
  if (!user) return false
  return user.plan === 'active'
}

export function hasAccess(user: AuthUser | null): boolean {
  return isTrialActive(user) || isSubscribed(user)
}

export function trialDaysLeft(user: AuthUser | null): number {
  if (!user?.trial_ends_at) return 14
  const diff = new Date(user.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}
