import axios from 'axios'
import { getToken } from './auth'

const BASE = '/api'

const client = axios.create({ baseURL: BASE })

client.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export interface SignUpPayload {
  full_name: string
  email: string
  password: string
  business_name?: string
}

export interface SignInPayload {
  email: string
  password: string
}

export interface AuthResponse {
  token: string
  user: {
    id: number
    email: string
    full_name: string
    business_name?: string
    plan?: string
    trial_ends_at?: string
    created_at: string
  }
}

export async function apiSignUp(payload: SignUpPayload): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>('/auth/signup', payload)
  return data
}

export async function apiSignIn(payload: SignInPayload): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>('/auth/signin', payload)
  return data
}

export async function apiGetMe(): Promise<AuthResponse['user']> {
  const { data } = await client.get('/auth/me')
  return data
}

// ── Clients ───────────────────────────────────────────────────
export async function apiGetClients() {
  const { data } = await client.get('/clients')
  return data
}

export async function apiCreateClient(payload: Record<string, unknown>) {
  const { data } = await client.post('/clients', payload)
  return data
}

export async function apiGetClient(id: number) {
  const { data } = await client.get(`/clients/${id}`)
  return data
}

export async function apiUpdateClient(id: number, payload: Record<string, unknown>) {
  const { data } = await client.put(`/clients/${id}`, payload)
  return data
}

export async function apiDeleteClient(id: number) {
  const { data } = await client.delete(`/clients/${id}`)
  return data
}

// ── Stripe ────────────────────────────────────────────────────
export async function apiCreateCheckout() {
  const { data } = await client.post('/stripe/create-checkout')
  return data
}

export async function apiCreateBillingPortal() {
  const { data } = await client.post('/stripe/create-portal')
  return data
}
