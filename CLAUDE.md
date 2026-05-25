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
- Automated Workflows: 5 toggles (welcome, contract reminder, balance reminder, questionnaire on booking, thank-you on delivery). Dashboard at /dashboard/workflows.
- Free Tier: plan='free', 1 client limit enforced at POST /api/clients. Choose via onboarding or POST /api/users/choose-free-plan.

## Active Bugs
- Notes not persisting (logging added, check Railway logs)
- Signin box left-aligned on production

## New DB Tables (need Railway redeploy to create)
- reminders_sent (client_id, reminder_type UNIQUE) — tracks sent event reminders
- questionnaire_templates (id, user_id, name, questions JSONB, created_at)
- questionnaire_responses (id, template_id, client_id, user_id, title, questions JSONB, responses JSONB, status, sent_at, completed_at, created_at)
- session_types (id, user_id, name, duration_minutes, price_cents, description, active, color, created_at)
- availability_slots (id, user_id, day_of_week, start_time, end_time, active)
- bookings (id, user_id, client_id, session_type_id, booking_date, start_time, end_time, client_name, client_email, client_phone, notes, status, created_at)
- workflow_settings (id, user_id, send_welcome_on_client_create, send_contract_reminder_3_days, send_balance_reminder_7_days, send_questionnaire_on_booking, send_thank_you_on_delivery, welcome_message, thank_you_message)
- clients.stage TEXT — added via ALTER TABLE (inquiry/consultation/booked/in_progress/delivered/archived)
- users.booking_username TEXT UNIQUE — generated from email prefix + 4 random digits on user creation

## Rules
- Always read this file first
- Use authFetch() for all API calls
- Never hardcode URLs - use import.meta.env.VITE_API_URL
- Run npm run build before every commit
- Redeploy Railway after every server/index.js change
# deploy Mon May 18 18:50:25 EDT 2026
# deploy Wed May 20 11:23:27 EDT 2026
