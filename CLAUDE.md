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

## Function Map — server/index.js

### Key Clients (top of file)
| Client | Line | Env vars required |
|---|---|---|
| `stripe` | 29 | STRIPE_SECRET_KEY |
| `resend` | 33 | RESEND_API_KEY |
| `clerk` | 37 | CLERK_SECRET_KEY |
| `anthropic` | 41 | ANTHROPIC_API_KEY |
| `r2` (S3Client) | 45 | R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY |
| `twitterClient` | 58 | TWITTER_API_KEY/SECRET, TWITTER_ACCESS_TOKEN/SECRET |
| `pool` (pg) | 145 | DATABASE_URL |
| `BREVO_API_KEY` | 95 | BREVO_API_KEY |
| `ELEVENLABS_API_KEY` | 92 | ELEVENLABS_API_KEY |

### Utility / Helper Functions
| Function | Line | Purpose |
|---|---|---|
| `sendBrevoEmail` | 97 | Cold outreach email via Brevo REST API |
| `sanitize` | 600 | Strip dangerous chars from strings |
| `stripMarkdown` | 607 | Remove markdown for plain-text emails |
| `emailTemplate` | 621 | Resend HTML email wrapper |
| `checkAdminSecret` | 6827 | x-admin-secret guard for admin routes |
| `checkFreeToolLimit` | 5761 | Rate-limit free tool endpoints by IP |
| `generateDownloadUrl` | 4051 | Presigned R2 URL for file download |
| `checkAndIncrementAiCalls` | 4953 | Per-user AI usage counter |

### DB / Startup
| Function | Line | Purpose |
|---|---|---|
| `initDb` | 652 | CREATE TABLE IF NOT EXISTS for all tables |
| `startServer` | 7096 | await initDb → runDailyJobs → app.listen |

### Email / Job Functions
| Function | Line | Purpose |
|---|---|---|
| `sendEventReminders` | 1329 | Daily reminder emails for upcoming events |
| `sendTrialExpiryReminders` | 1538 | 3-day-before trial expiry emails |
| `sendOnboardingSequence` | 1673 | Day 1/3/7 onboarding drip via Resend |
| `sendFreeToolNurtureEmails` | 2228 | Nurture drip for tool_leads |
| `buildColdEmail` | 2327 | Returns {subject, html} for cold outreach |
| `sendColdOutreach` | 2391 | Drip up to COLD_DAILY_LIMIT cold emails/day |
| `generateAndSendAllTemplates` | 5779 | Send all 3 free tool templates to email |
| `runDailyJobs` | 2784 | Hourly cron: reminders, cold, content, Reddit |

### Content / Video / Social
| Function | Line | Purpose |
|---|---|---|
| `postToX` | 1816 | Tweet via TwitterApi |
| `generateVoiceAudio` | 1837 | ElevenLabs TTS → mp3 file (silent fallback) |
| `generateVideoFrames` | 1876 | @napi-rs/canvas JPEG frames at 6fps |
| `renderVideo` | 1998 | fluent-ffmpeg: JPEG glob → yuv420p MP4 at 30fps |
| `generateSocialVideo` | 2037 | Orchestrates audio+frames+render+R2 upload |
| `generateAndScheduleWeeklyContent` | 2110 | Claude Haiku → 7 posts → DB |
| `monitorRedditAndGenerateContent` | 2188 | Reddit scrape → Claude → post |

### Email Discovery (Cold Outreach Pipeline)
| Function | Line | Purpose |
|---|---|---|
| `isBusinessSiteUrl` | 2509 | Filter out aggregator/social domains |
| `discoverSitesViaAnthropic` | 2522 | Primary: web_search tool → photographer URLs |
| `discoverSitesViaDuckDuckGo` | 2556 | Fallback: DDG HTML endpoint (keyless) |
| `discoverSitesViaBing` | 2584 | Fallback 2: Bing HTML scrape (keyless) |
| `findPhotographerEmails` | 2611 | Hybrid discovery → scrape homepage+/contact |
| `importFoundEmails` | 2758 | INSERT INTO cold_contacts ON CONFLICT DO NOTHING |

### Middleware
| Function | Line | Purpose |
|---|---|---|
| `requireAuth` | 2823 | Clerk token verify → req.user |

### Routes — Stripe / Auth / User
| Route | Line |
|---|---|
| POST /api/stripe/webhook | 180 |
| POST /api/webhooks/clerk | 517 |
| PUT /api/users/me | 2966 |
| DELETE /api/users/me | 3001 |
| GET /api/auth/me | 3043 |
| POST /api/auth/me | 3048 |
| GET /api/referrals | 3083 |
| POST /api/stripe/create-checkout | 3133 |
| POST /api/stripe/create-portal | 3174 |
| POST /api/stripe/connect/onboard | 3194 |
| GET /api/stripe/connect/status | 3232 |
| POST /api/stripe/connect/disconnect | 3261 |
| POST /api/stripe/create-checkout-with-trial | 3434 |
| GET /api/stripe/switch-to-annual | 3406 |

### Routes — Clients / Events / Pipeline
| Route | Line |
|---|---|
| GET /api/dashboard/stats | 3484 |
| GET /api/clients | 3522 |
| POST /api/clients | 3564 |
| GET/PUT/DELETE /api/clients/:id | 3607/3618/3637 |
| GET/POST /api/clients/:id/events | 3649/3664 |
| PUT/DELETE /api/clients/:id/events/:eventId | 3682/3700 |
| PATCH /api/clients/:id/stage | 5219 |

### Routes — Contracts / Invoices
| Route | Line |
|---|---|
| GET/POST /api/contracts | 3718/3742 |
| PUT/DELETE /api/contracts/:id | 3758/3774 |
| POST /api/contracts/:id/send | 3892 |
| POST /api/contracts/:id/photographer-sign | 3951 |
| GET/POST /api/invoices | 3786/3811 |
| PUT /api/invoices/:id | 3827 |
| POST /api/invoices/:id/send | 3976 |
| DELETE /api/invoices/:id | 4028 |

### Routes — Files / Galleries / Portal
| Route | Line |
|---|---|
| POST /api/files/upload | 4070 |
| GET/DELETE /api/files | 4115/4141 |
| PATCH /api/files/:id/assign | 4155 |
| GET/POST/PUT/DELETE /api/galleries | 4177/4242/4260/4343 |
| POST /api/galleries/:id/add-files | 4361 |
| GET /api/portals/:token | 4536 |
| GET /api/portals/:token/gallery | 4396 |
| POST /api/portals/:token/contracts/:id/sign | 4588 |
| POST /api/portals/:token/invoices/:id/pay | 4843 |

### Routes — Messages / AI / Booking
| Route | Line |
|---|---|
| GET /api/messages/unread-count | 4672 |
| GET/POST /api/messages | 4706/4728 |
| GET/POST /api/portals/:token/messages | 4780/4795 |
| POST /api/ai/suggest-message | 4970 |
| POST /api/ai/generate-contract | 5003 |
| POST /api/ai/generate-proposal | 5054 |
| GET/POST /api/session-types | 5479/5486 |
| GET/PUT /api/availability | 5519/5526 |
| GET /api/bookings | 5549 |
| GET /api/book/:username | 5591 |
| POST /api/book/:username/book | 5655 |

### Routes — Questionnaires / Workflows / Features
| Route | Line |
|---|---|
| GET/POST /api/questionnaire-templates | 5272/5279 |
| GET/POST /api/questionnaires | 5312/5325 |
| GET/PUT /api/workflow-settings | 5437/5447 |
| GET/POST/PUT /api/clients/:id/shot-list | 6297/6313 |
| GET/POST /api/portals/:token/shot-list | 6359/6368 |
| GET/POST/PUT/DELETE /api/clients/:id/vendors | 6406/6415/6429/6441 |
| GET/PUT /api/clients/:id/timeline | 6459/6475 |
| POST /api/clients/:id/timeline/send | 6490 |
| GET/PUT/DELETE /api/packages | 6565/6584/6596 |
| GET/POST/PUT/DELETE /api/proposals | 6605/6616/6628/6640 |
| GET /api/proposals/:id/public | 6681 |

### Routes — Leads / Payment Links
| Route | Line |
|---|---|
| GET/PUT /api/lead-form | 6043/6053 |
| GET /api/lead-submissions | 6067 |
| GET/POST /api/lead/:username | 6101/6120 |
| GET/POST/PUT/DELETE /api/payment-links | 6192/6199/6211/6223 |
| GET /api/pay/:linkId | 6231 |
| POST /api/pay/:linkId/charge | 6244 |

### Routes — Free Tools (publicCors, no auth)
| Route | Line |
|---|---|
| POST /api/tools/capture-lead | 5866 |
| POST /api/tools/shot-list | 5892 |
| POST /api/tools/timeline | 5932 |
| POST /api/tools/questionnaire | 5967 |
| POST /api/tools/pricing-guide | 6003 |

### Routes — Admin (x-admin-secret)
| Route | Line |
|---|---|
| POST /api/admin/generate-content | 6840 |
| POST /api/admin/reddit-content | 6856 |
| GET /api/admin/generated-content | 6864 |
| PATCH /api/admin/generated-content/:id | 6872 |
| GET /api/admin/tool-leads | 6881 |
| POST /api/admin/cold-contacts/import | 6891 |
| GET /api/admin/cold-contacts/stats | 6950 |
| POST /api/admin/cold-suppression | 6994 |
| POST /api/admin/cold-send-test | 7013 |
| POST /api/admin/find-emails | 7040 |
| POST /api/admin/generate-video | 7058 |
| GET/DELETE /api/admin/generated-videos | 7069/7082 |
| GET/POST/PATCH /api/admin/affiliates | 6781/6798/6815 |
| POST /api/admin/activate-account | 6739 |
| POST /api/admin/reset-account | 6751 |

# deploy Mon May 18 18:50:25 EDT 2026
# deploy Wed May 20 11:23:27 EDT 2026
