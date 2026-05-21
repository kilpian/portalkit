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

## URLs
- Frontend: https://getportalkit.com
- Backend: https://portalkit-production.up.railway.app

## Known Working in Production
- Auth (Clerk), onboarding → Stripe checkout, dashboard, client portal
- Messaging (send/receive, email notifications)
- Contract send email (goes to client, subject: "Please review and sign your contract")
- Invoice send email (goes to client with amount)
- Event reminders (daily job at 9am via setInterval)

## Active Bugs
- Notes not persisting (logging added, check Railway logs)
- Signin box left-aligned on production

## New DB Tables (need Railway redeploy to create)
- reminders_sent (client_id, reminder_type UNIQUE) — tracks sent event reminders

## Rules
- Always read this file first
- Use authFetch() for all API calls
- Never hardcode URLs - use import.meta.env.VITE_API_URL
- Run npm run build before every commit
- Redeploy Railway after every server/index.js change
# deploy Mon May 18 18:50:25 EDT 2026
# deploy Wed May 20 11:23:27 EDT 2026
