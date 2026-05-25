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

## Features
- Auth (Clerk), onboarding → Stripe checkout or free plan (1 client), dashboard, client portal
- Messaging (send/receive, email notifications)
- Contract send email (goes to client, subject: "Please review and sign your contract")
- Invoice send email (goes to client with amount)
- Event reminders (daily job at 9am via setInterval)
- CRM Pipeline: stage column on clients, Kanban board at /dashboard/pipeline, PATCH /api/clients/:id/stage
- Questionnaires: templates + responses. Dashboard at /dashboard/questionnaires. Client portal section. Emails on send/complete.
- Booking/Scheduling: session types, weekly availability, public booking page at /book/:username. Dashboard at /dashboard/booking.
- Automated Workflows: 5 toggles + review request toggle. Dashboard at /dashboard/workflows.
- Free Tier: plan='free', 1 client limit enforced at POST /api/clients.
- Lead Capture: embeddable form via /public/embed.js, public page at /inquire/:username, dashboard at /dashboard/leads. GET/POST /api/lead/:username (publicCors).
- Payment Links: shareable pages at /pay/:linkId (Stripe Connect), dashboard at /dashboard/payment-links. GET/POST /api/payment-links.
- Gallery URL: clients.gallery_url → prominent "📸 View Your Photo Gallery →" button in portal.
- Secondary Contact: clients.secondary_name/email/phone → "Welcome X & Y!" greeting, CC on emails.
- Shot List Builder: shot_lists table. Routes /api/clients/:id/shot-list (auth) + /api/portals/:token/shot-list (public).
- Vendor Contact Sheet: vendors table. Routes /api/clients/:id/vendors (auth) + /api/portals/:token/vendors (public).
- Day-of Timeline: timelines table. Routes /api/clients/:id/timeline (auth) + /api/portals/:token/timeline (public). Client approves via portal.
- Review Request: 5 new columns on workflow_settings (google/weddingwire/theknot/facebook URLs + send_review_request_on_delivery). Buttons included in delivery email.
- Package/Proposal Builder: packages + proposals tables. Dashboard at /dashboard/proposals, public at /proposal/:id.

## Active Bugs
- Signin box left-aligned on production

## DB Tables
- reminders_sent, questionnaire_templates, questionnaire_responses, session_types, availability_slots, bookings, workflow_settings
- clients.stage, clients.gallery_url, clients.secondary_name/email/phone (ALTER TABLE)
- lead_forms, lead_submissions, payment_links, payment_link_transactions
- shot_lists, vendors, timelines
- workflow_settings.google_review_url/wedding_wire_url/the_knot_url/facebook_review_url/send_review_request_on_delivery (ALTER TABLE)
- packages, proposals
- users.booking_username TEXT UNIQUE

## Rules
- Always read this file first
- Use authFetch() for all API calls
- Never hardcode URLs - use import.meta.env.VITE_API_URL
- Run npm run build before every commit
- Redeploy Railway after every server/index.js change
# deploy Mon May 18 18:50:25 EDT 2026
# deploy Wed May 20 11:23:27 EDT 2026
