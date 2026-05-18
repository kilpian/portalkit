import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/signin"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      signInForceRedirectUrl="/dashboard"
      signUpForceRedirectUrl="/dashboard"
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
)
