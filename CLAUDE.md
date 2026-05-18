# PortalKit — Project Memory

## Stack
- Frontend: React 19 + TypeScript + Vite → Vercel (https://getportalkit.com)
- Backend: Express 5 → Railway (https://portalkit-production.up.railway.app)
- DB: PostgreSQL on Railway (portalkit-db project)
- Auth: Clerk production instance
- Payments: Stripe $39/mo subscription
- Email: Resend from hello@mail.getportalkit.com
- AI: Anthropic Haiku

## Key Files
- server/index.js — full backend
- src/App.tsx — all routes
- src/lib/api.ts — useApi() / authFetch()
- src/context/AuthContext.tsx — Clerk + DB user state
- public/index.html — static landing page
- public/app.html — React entry point

## Deployment
- Git push → Vercel auto-deploys frontend
- Git push → Railway auto-deploys backend
- After backend changes: Railway → redeploy manually

## Active Bugs
- Notes not persisting (logging added, check Railway logs)
- Signin box left-aligned on production

## Rules
- Always read this file first
- Use authFetch() for all API calls
- Never hardcode URLs - use import.meta.env.VITE_API_URL
- Run npm run build before every commit
- Redeploy Railway after every server/index.js change
