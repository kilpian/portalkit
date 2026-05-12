import axios from 'axios'
import { useAuth } from '@clerk/clerk-react'
import { useCallback, useMemo } from 'react'

export interface DashboardStats {
  total_clients: number
  active_portals: number
  pending_invoices: number
  trial_days_remaining: number | null
}

export interface Client {
  id: number
  user_id: number
  name: string
  email: string | null
  phone: string | null
  event_date: string | null
  event_type: string | null
  notes: string | null
  portal_token: string
  created_at: string
  updated_at: string
}

export interface CreateClientPayload {
  name: string
  email?: string
  phone?: string
  event_date?: string
  event_type?: string
  notes?: string
}

export interface PortalUser {
  id: number
  clerk_id: string
  email: string
  full_name: string
  business_name?: string
  plan?: string
  trial_ends_at?: string
  stripe_customer_id?: string
  created_at: string
}

export function useApi() {
  const { getToken } = useAuth()

  const req = useCallback(async <T>(method: string, url: string, data?: unknown): Promise<T> => {
    const token = await getToken()
    const res = await axios<T>({
      method,
      url: `/api${url}`,
      data,
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.data
  }, [getToken])

  return useMemo(() => ({
    // Dashboard
    getDashboardStats: (): Promise<DashboardStats> =>
      req('get', '/dashboard/stats'),

    // Clients
    getClients: (): Promise<Client[]> =>
      req('get', '/clients'),
    createClient: (p: CreateClientPayload): Promise<Client> =>
      req('post', '/clients', p),
    getClient: (id: number): Promise<Client> =>
      req('get', `/clients/${id}`),
    updateClient: (id: number, p: Partial<CreateClientPayload>): Promise<Client> =>
      req('put', `/clients/${id}`, p),
    deleteClient: (id: number): Promise<{ success: boolean }> =>
      req('delete', `/clients/${id}`),

    // Profile
    updateProfile: (p: { full_name: string; business_name?: string }): Promise<PortalUser> =>
      req('put', '/users/me', p),
    deleteAccount: (): Promise<{ success: boolean }> =>
      req('delete', '/users/me'),

    // Stripe
    createCheckout: (): Promise<{ url: string }> =>
      req('post', '/stripe/create-checkout'),
    createBillingPortal: (): Promise<{ url: string }> =>
      req('post', '/stripe/create-portal'),
  }), [req])
}
