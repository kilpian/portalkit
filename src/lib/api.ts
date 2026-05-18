import axios from 'axios'
import { useAuth } from '@clerk/clerk-react'

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// ── Types ─────────────────────────────────────────────────────
// These are re-exported here so dashboard pages only need one import.

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

export interface Message {
  id: number
  client_id: number
  user_id: number
  sender: 'photographer' | 'client'
  content: string
  read_at: string | null
  created_at: string
}

export interface MessageSummary {
  client_id: number
  last_message: string | null
  last_sender: 'photographer' | 'client' | null
  last_message_at: string | null
  unread_count: number
}

export interface Contract {
  id: number
  user_id: number
  client_id: number | null
  client_name: string | null
  title: string
  content: string | null
  status: 'draft' | 'sent' | 'signed'
  signed_at: string | null
  signed_by_name: string | null
  signed_by_ip: string | null
  content_hash: string | null
  created_at: string
  updated_at: string
}

export interface ContractTemplate {
  id: number
  name: string
  content: string
  created_at: string
}

export interface Invoice {
  id: number
  user_id: number
  client_id: number | null
  client_name: string | null
  invoice_number: string | null
  amount_cents: number
  status: 'draft' | 'sent' | 'paid' | 'overdue'
  due_date: string | null
  paid_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface UploadedFile {
  id: number
  user_id: number
  client_id: number | null
  client_name: string | null
  original_name: string
  storage_url: string
  size_bytes: number
  created_at: string
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
  logo_url?: string | null
  brand_color?: string | null
  onboarding_completed?: boolean
  created_at: string
}

// ── Hook ──────────────────────────────────────────────────────

export function useApi() {
  const { getToken } = useAuth()

  const authFetch = async (url: string, options: Record<string, unknown> = {}) => {
    const token = await getToken()
    try {
      return await axios({
        ...options,
        url: `${API_BASE}${url}`,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string> | undefined),
        },
        withCredentials: false,
      })
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 402) {
        window.location.href = '/dashboard/settings'
      }
      throw error
    }
  }

  return { authFetch }
}

export default API_BASE
