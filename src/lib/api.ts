import axios from 'axios'
import { useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// ── Types ─────────────────────────────────────────────────────
// These are re-exported here so dashboard pages only need one import.

export interface DashboardStats {
  total_clients: number
  active_portals: number
  pending_invoices: number
  upcoming_events: number
  trial_days_remaining: number | null
  pipeline_counts?: { inquiry: number; consultation: number; booked: number; in_progress: number; delivered: number; archived: number }
  _expired?: boolean
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
  stage: string
  stage_changed_at?: string | null
  gallery_url: string | null
  secondary_name: string | null
  secondary_email: string | null
  secondary_phone: string | null
  created_at: string
  updated_at: string
  _blurred?: boolean
}

export interface QuestionnaireTemplate {
  id: number
  user_id: number
  name: string
  questions: QuestionDef[]
  created_at: string
}

export interface QuestionDef {
  id: string
  type: 'text' | 'textarea' | 'select' | 'radio' | 'date'
  label: string
  required: boolean
  options?: string[]
}

export interface QuestionnaireResponse {
  id: number
  template_id: number | null
  client_id: number
  user_id: number
  title: string
  questions: QuestionDef[]
  responses: Record<string, string>
  status: 'pending' | 'completed'
  sent_at: string | null
  completed_at: string | null
  created_at: string
  client_name?: string
  client_email?: string
}

export interface SessionType {
  id: number
  user_id: number
  name: string
  duration_minutes: number
  price_cents: number
  description: string | null
  active: boolean
  color: string
}

export interface AvailabilitySlot {
  id?: number
  day_of_week: number
  start_time: string
  end_time: string
  active: boolean
}

export interface Booking {
  id: number
  user_id: number
  client_id: number | null
  session_type_id: number | null
  booking_date: string
  start_time: string
  end_time: string
  client_name: string
  client_email: string
  client_phone: string | null
  notes: string | null
  status: 'pending' | 'confirmed' | 'cancelled'
  session_type_name?: string
  session_color?: string
  created_at: string
}

export interface WorkflowSettings {
  id: number
  user_id: number
  send_welcome_on_client_create: boolean
  send_contract_reminder_3_days: boolean
  send_balance_reminder_7_days: boolean
  send_questionnaire_on_booking: boolean
  send_thank_you_on_delivery: boolean
  welcome_message: string | null
  thank_you_message: string | null
  send_review_request_on_delivery: boolean
  google_review_url: string | null
  wedding_wire_url: string | null
  the_knot_url: string | null
  facebook_review_url: string | null
}

export interface LeadForm {
  id: number
  user_id: number
  headline: string
  subheadline: string | null
  fields: string[]
  brand_color: string
  active: boolean
  created_at: string
}

export interface LeadSubmission {
  id: number
  user_id: number
  name: string
  email: string | null
  phone: string | null
  event_type: string | null
  event_date: string | null
  message: string | null
  source: string
  created_at: string
}

export interface PaymentLink {
  id: number
  user_id: number
  title: string
  description: string | null
  amount_cents: number | null
  allow_custom_amount: boolean
  min_amount_cents: number
  link_type: 'fixed' | 'tip' | 'custom'
  active: boolean
  total_collected_cents: number
  transaction_count: number
  created_at: string
}

export interface PaymentLinkTransaction {
  id: number
  payment_link_id: number
  payer_name: string | null
  payer_email: string | null
  amount_cents: number
  stripe_payment_intent_id: string | null
  status: 'pending' | 'succeeded' | 'failed'
  created_at: string
}

export interface ShotItem {
  id: string
  category: string
  description: string
  priority: 'must_have' | 'if_possible' | 'skip'
  confirmed: boolean
}

export interface ShotList {
  id: number
  client_id: number
  user_id: number
  shots: ShotItem[]
  client_notes: string | null
  photographer_notes: string | null
  status: 'pending' | 'submitted' | 'confirmed'
  submitted_at: string | null
  confirmed_at: string | null
  created_at: string
}

export interface Vendor {
  id: number
  client_id: number
  user_id: number
  category: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  website: string | null
  notes: string | null
  created_at: string
}

export interface TimelineItem {
  id: string
  time: string
  duration_minutes: number
  title: string
  location: string | null
  notes: string | null
  category: string
}

export interface Timeline {
  id: number
  client_id: number
  user_id: number
  title: string
  items: TimelineItem[]
  status: 'draft' | 'sent' | 'approved'
  client_approved_at: string | null
  created_at: string
}

export interface Package {
  id: number
  user_id: number
  name: string
  description: string | null
  price_cents: number
  deposit_cents: number
  features: string[]
  active: boolean
  created_at: string
}

export interface Proposal {
  id: number
  user_id: number
  client_id: number | null
  client_name?: string | null
  title: string
  message: string | null
  packages: Package[]
  selected_package_id: number | null
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'expired'
  expires_at: string | null
  viewed_at: string | null
  accepted_at: string | null
  created_at: string
}

export interface CreateClientPayload {
  name: string
  email?: string
  phone?: string
  event_date?: string
  event_type?: string
  notes?: string
  gallery_url?: string
  secondary_name?: string
  secondary_email?: string
  secondary_phone?: string
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
  status: 'draft' | 'sent' | 'signed' | 'fully_signed'
  signed_at: string | null
  signed_by_name: string | null
  signed_by_ip: string | null
  content_hash: string | null
  photographer_signed_at: string | null
  photographer_signature: string | null
  created_at: string
  updated_at: string
  _blurred?: boolean
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
  _blurred?: boolean
}

export interface UploadedFile {
  id: number
  user_id: number
  client_id: number | null
  client_name: string | null
  original_name: string
  mime_type: string | null
  storage_url: string
  size_bytes: number
  gallery_id: number | null
  is_favorite: boolean | null
  caption: string | null
  display_order: number | null
  created_at: string
}

export interface Gallery {
  id: number
  user_id: number
  client_id: number
  client_name: string
  client_email?: string | null
  portal_token: string
  event_date: string | null
  event_type: string | null
  name: string
  description: string | null
  status: 'hidden' | 'preview' | 'delivered'
  password_protected: boolean
  allow_downloads: boolean
  allow_favorites: boolean
  cover_file_id: number | null
  cover_url: string | null
  preview_url: string | null
  file_count: number
  delivered_at: string | null
  created_at: string
  password?: string | null
}

export interface GalleryFile {
  id: number
  original_name: string
  mime_type: string | null
  storage_url: string
  size_bytes: number
  gallery_id: number
  caption: string | null
  display_order: number
  is_favorite: boolean
  created_at: string
}

export interface PortalUser {
  id: number
  clerk_id: string
  email: string
  full_name: string
  business_name?: string
  plan?: string
  billing_cycle?: string
  trial_ends_at?: string
  stripe_customer_id?: string
  stripe_subscription_id?: string | null
  logo_url?: string | null
  brand_color?: string | null
  onboarding_completed?: boolean
  stripe_connect_id?: string | null
  stripe_connect_enabled?: boolean
  booking_username?: string | null
  created_at: string
}

// ── Hook ──────────────────────────────────────────────────────

export function usePolling(callback: () => void, intervalMs = 30000) {
  useEffect(() => {
    const id = setInterval(callback, intervalMs)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

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
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 402) {
          // Trial/subscription required. Don't hard-redirect (and never to hosted
          // Stripe) — let the app surface the embedded upgrade modal in place so
          // the user keeps their context. Dashboard listens for this event.
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('pk:upgrade-required'))
          }
        }
        if (error.response?.status === 403 && error.response?.data?.error === 'onboarding_required') {
          window.location.href = '/dashboard'
          return error.response as never
        }
      }
      throw error
    }
  }

  return { authFetch }
}

export default API_BASE
