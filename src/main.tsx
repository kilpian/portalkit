import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import posthog from 'posthog-js'
import './index.css'
import App from './App.tsx'

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
if (POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    session_recording: {
      maskAllInputs: true,
      maskInputOptions: {
        password: true,
      },
    },
  })
}

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', fontFamily: 'sans-serif',
        background: '#FDFAF5', color: '#1B4332', padding: 24,
      }}>
        <h2 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h2>
        <p style={{ color: '#6B7280', marginBottom: 24 }}>
          We've been notified and are fixing it. Please refresh to try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#1B4332', color: 'white',
            border: 'none', padding: '10px 24px',
            borderRadius: 8, cursor: 'pointer',
            fontSize: 15, fontWeight: 600,
          }}
        >
          Refresh Page
        </button>
      </div>
    }>
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
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
