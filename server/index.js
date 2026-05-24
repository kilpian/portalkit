import express from 'express'
import pkg from 'pg'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { createClerkClient, verifyToken } from '@clerk/backend'
import Anthropic from '@anthropic-ai/sdk'
import { Webhook } from 'svix'
import multer from 'multer'
import fs from 'fs'
import crypto from 'crypto'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'

console.log('🔑 Auth version: v2 - email dedup + onboarding flag active')

;['DATABASE_URL', 'CLERK_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_PORTALKIT', 'RESEND_API_KEY', 'ANTHROPIC_API_KEY', 'FRONTEND_URL', 'STRIPE_PUBLISHABLE_KEY'].forEach(v => {
  if (!process.env[v]) console.error(`❌ Missing env var: ${v}`)
  else console.log(`✅ ${v}: set`)
})

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const clerk = process.env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  : null

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const r2 = (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'portalkit-files'

const { Pool } = pkg
const app = express()
const PORT = process.env.PORT || 3001

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')
if (!process.env.CLERK_SECRET_KEY) throw new Error('CLERK_SECRET_KEY environment variable is required')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
})

const allowedOrigins = [
  'https://getportalkit.com',
  'https://www.getportalkit.com',
  'https://portalkit.vercel.app',
  'https://portalkit-one.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
]

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// Webhook must be before express.json() to get raw body
app.post('/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature']
    let event
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      if (process.env.STRIPE_WEBHOOK_SECRET_CLI) {
        try {
          event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET_CLI)
        } catch (err2) {
          console.error('Webhook error:', err2.message)
          return res.status(400).send('Webhook Error')
        }
      } else {
        console.error('Webhook error:', err.message)
        return res.status(400).send('Webhook Error')
      }
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object
          const { userId } = session.metadata || {}
          if (userId) {
            await pool.query(
              'UPDATE users SET plan=$1, stripe_subscription_id=$2 WHERE id=$3',
              ['active', session.subscription, userId]
            )
            console.log(`User ${userId} subscribed`)
          }
          break
        }
        case 'customer.subscription.created': {
          const sub = event.data.object
          const subUserId = sub.metadata?.user_id
          let rowsUpdated = 0
          if (subUserId) {
            const r = await pool.query(
              'UPDATE users SET plan=$1, stripe_subscription_id=$2, stripe_customer_id=$4 WHERE id=$3',
              ['active', sub.id, subUserId, sub.customer]
            )
            rowsUpdated = r.rowCount ?? 0
          }
          if (!rowsUpdated) {
            await pool.query(
              'UPDATE users SET plan=$1, stripe_subscription_id=$2 WHERE stripe_customer_id=$3',
              ['active', sub.id, sub.customer]
            )
          }
          break
        }
        case 'invoice.payment_succeeded': {
          const inv = event.data.object
          console.log('💳 Webhook: invoice.payment_succeeded for customer:', inv.customer)
          await pool.query(
            'UPDATE users SET plan=$1 WHERE stripe_customer_id=$2',
            ['active', inv.customer]
          ).catch(() => {})
          if (inv.billing_reason === 'subscription_create') {
            const userResult = await pool.query(
              'SELECT email, full_name FROM users WHERE stripe_customer_id=$1',
              [inv.customer]
            )
            const u = userResult.rows[0]
            if (u && resend) {
              try {
                const firstName = u.full_name?.split(' ')[0] || 'there'
                await resend.emails.send({
                  from: 'PortalKit <hello@mail.getportalkit.com>',
                  to: u.email,
                  subject: "Welcome to PortalKit — you're all set! 🎉",
                  html: emailTemplate({
                    title: "Welcome to PortalKit",
                    preheader: "You're all set — let's get your first client portal ready.",
                    body: `<h2 style="font-size:24px;color:#1A1208;margin:0 0 12px;">Welcome, ${firstName}! 🎉</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Your account is ready. Here's how to get started:</p><ol style="color:#2D2416;line-height:2.2;padding-left:20px;margin:0 0 16px;"><li><strong>Create your first client</strong> — Add a client and share their private portal link</li><li><strong>Send your contract</strong> — Use our templates or generate one with AI in seconds</li><li><strong>Stay organized</strong> — All your clients, contracts, and invoices in one place</li></ol><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">You have 14 days to explore everything — no limits, no restrictions.</p><p style="color:#9C8E7A;font-size:13px;margin:0;">Questions? Reply to this email — we read every one.</p>`,
                    ctaText: 'Go to your dashboard →',
                    ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard`,
                    footerNote: 'PortalKit by Kilpian LLC',
                  }),
                })
              } catch (emailErr) {
                console.error('Welcome email failed:', emailErr)
              }
            }
          }
          break
        }
        case 'invoice.payment_failed': {
          const inv = event.data.object
          console.log('💳 Webhook: invoice.payment_failed for customer:', inv.customer)
          console.warn(`Payment failed for customer ${inv.customer}: ${inv.id}`)
          // Set grace period instead of immediately cancelling
          await pool.query(
            "UPDATE users SET plan='grace', grace_period_ends_at=NOW() + INTERVAL '7 days' WHERE stripe_customer_id=$1",
            [inv.customer]
          ).catch(e => console.error('Grace period update failed:', e))
          if (resend && stripe) {
            try {
              const userResult = await pool.query('SELECT email, full_name, stripe_customer_id FROM users WHERE stripe_customer_id=$1', [inv.customer])
              const u = userResult.rows[0]
              if (u) {
                let portalUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/settings`
                try {
                  const portalSession = await stripe.billingPortal.sessions.create({
                    customer: u.stripe_customer_id,
                    return_url: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard`,
                  })
                  portalUrl = portalSession.url
                } catch (portalErr) {
                  console.error('Portal session creation failed:', portalErr)
                }
                const firstName = u.full_name?.split(' ')[0] || 'there'
                await resend.emails.send({
                  from: 'PortalKit <hello@mail.getportalkit.com>',
                  to: u.email,
                  subject: 'Action required: Update your payment method',
                  html: emailTemplate({
                    title: 'Your payment didn\'t go through',
                    preheader: 'Action required — please update your payment method to keep access.',
                    body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Your payment didn't go through</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Hi ${firstName}, your recent PortalKit payment failed. Don't worry — Stripe will automatically retry the charge, but we recommend updating your card now to avoid any interruption.</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">You can update your payment method, view past invoices, or manage your subscription from the link below.</p><p style="color:#A32D2D;font-weight:600;line-height:1.6;margin:0 0 16px;">⚠️ If payment isn't resolved within 7 days, your account will be paused.</p>`,
                    ctaText: 'Update Payment Method →',
                    ctaUrl: portalUrl,
                    footerNote: 'PortalKit by Kilpian LLC',
                  }),
                })
                console.log(`📧 Dunning email sent to ${u.email}`)
              }
            } catch (emailErr) {
              console.error('Payment failed email error:', emailErr)
            }
          }
          break
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object
          console.log('💳 Webhook: customer.subscription.deleted for subscription:', sub.id)
          const cancelResult = await pool.query(
            'UPDATE users SET plan=$1 WHERE stripe_subscription_id=$2 RETURNING email, full_name',
            ['cancelled', sub.id]
          )
          const u = cancelResult.rows[0]
          if (u && resend) {
            try {
              await resend.emails.send({
                from: 'PortalKit <hello@mail.getportalkit.com>',
                to: u.email,
                subject: 'Your PortalKit subscription has been cancelled',
                html: emailTemplate({
                  title: 'Subscription Cancelled',
                  preheader: 'Your PortalKit subscription has ended.',
                  body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Subscription cancelled</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Hi ${u.full_name?.split(' ')[0] || 'there'}, your PortalKit subscription has been cancelled. You can resubscribe at any time to regain access to your client portals.</p>`,
                  ctaText: 'Resubscribe →',
                  ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/settings`,
                  footerNote: 'PortalKit by Kilpian LLC',
                }),
              })
            } catch (emailErr) {
              console.error('Cancellation email error:', emailErr)
            }
          }
          break
        }
        case 'customer.subscription.updated': {
          const sub = event.data.object
          if (sub.status === 'active') {
            await pool.query(
              'UPDATE users SET plan=$1 WHERE stripe_subscription_id=$2',
              ['active', sub.id]
            )
          }
          break
        }
        case 'payment_intent.succeeded': {
          const pi = event.data.object
          const invoiceId = pi.metadata?.invoice_id
          if (invoiceId) {
            await pool.query(
              "UPDATE invoices SET status='paid', paid_at=NOW() WHERE id=$1",
              [invoiceId]
            ).catch(e => console.error('Invoice paid update failed:', e))
            console.log(`💳 Invoice ${invoiceId} marked as paid via Stripe Connect`)
          }
          break
        }
        // NOTE: Add "account.updated" to your Stripe webhook destination events list
        case 'account.updated': {
          const account = event.data.object
          if (account.charges_enabled) {
            await pool.query(
              'UPDATE users SET stripe_connect_enabled=TRUE WHERE stripe_connect_id=$1',
              [account.id]
            ).catch(() => {})
            console.log('✅ Stripe Connect enabled for account:', account.id)
          }
          break
        }
      }
    } catch (err) {
      console.error('Webhook handler error:', err)
    }
    res.json({ received: true })
  }
)

// Clerk webhook — raw body needed for svix signature verification
app.post('/api/webhooks/clerk',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.warn('CLERK_WEBHOOK_SECRET not set, skipping verification')
      return res.json({ received: true })
    }
    let event
    try {
      const wh = new Webhook(webhookSecret)
      event = wh.verify(req.body, {
        'svix-id': req.headers['svix-id'],
        'svix-timestamp': req.headers['svix-timestamp'],
        'svix-signature': req.headers['svix-signature'],
      })
    } catch (err) {
      console.error('Clerk webhook verify error:', err.message)
      return res.status(400).json({ error: 'Webhook verification failed' })
    }
    try {
      if (event.type === 'user.created') {
        const clerkUser = event.data
        const email = clerkUser.email_addresses?.[0]?.email_address
        const firstName = clerkUser.first_name || ''
        if (email && resend) {
          await resend.emails.send({
            from: 'PortalKit <hello@mail.getportalkit.com>',
            to: email,
            subject: "Welcome to PortalKit — you're all set",
            html: emailTemplate({
              title: 'Welcome to PortalKit',
              preheader: 'Your 14-day free trial has started.',
              body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Welcome${firstName ? `, ${firstName}` : ''}!</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Your 14-day free trial has started. Here's how to get going:</p><ol style="color:#2D2416;line-height:2.2;padding-left:20px;margin:0 0 16px;"><li>Create your first client</li><li>Share their private portal link</li><li>Get paid faster</li></ol><p style="color:#9C8E7A;font-size:13px;margin:0;">Questions? Reply to this email — we read every one.</p>`,
              ctaText: 'Go to Dashboard →',
              ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard`,
              footerNote: 'PortalKit by Kilpian LLC',
            }),
          })
          console.log('Welcome email sent to:', email)
        }
      }
      res.json({ received: true })
    } catch (err) {
      console.error('Clerk webhook handler error:', err)
      res.status(500).json({ error: 'Webhook handler failed' })
    }
  }
)

app.use(express.json({ limit: '10mb' }))

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}))

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  next()
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Rate limit exceeded. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
})

app.use('/api/', apiLimiter)

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'AI usage limit reached. Please wait before generating more content.' },
  standardHeaders: true,
  legacyHeaders: false,
})

function sanitize(str) {
  if (!str) return str
  return String(str).trim().slice(0, 10000)
}

const sanitizePrompt = (str) => str?.replace(/<[^>]*>/g, '').slice(0, 2000) || ''

function emailTemplate({ title, preheader, body, ctaText, ctaUrl, footerNote }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F0;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#1B4332;border-radius:12px 12px 0 0;padding:28px 40px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#FDFAF5;letter-spacing:-0.03em;">Portal<span style="color:#C9A84C;">Kit</span></div>
        </td></tr>
        <tr><td style="background:#FFFFFF;padding:40px;border-left:1px solid #E8E0D0;border-right:1px solid #E8E0D0;">
          ${body}
        </td></tr>
        ${ctaText && ctaUrl ? `<tr><td style="background:#FFFFFF;padding:0 40px 32px;text-align:center;border-left:1px solid #E8E0D0;border-right:1px solid #E8E0D0;"><a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;background:#1B4332;color:#FDFAF5;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">${ctaText}</a></td></tr>` : ''}
        <tr><td style="background:#F9F6F0;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;border:1px solid #E8E0D0;border-top:none;">
          <p style="color:#9C8E7A;font-size:13px;margin:0 0 8px;">${footerNote || 'Sent by PortalKit · helping photographers deliver a beautiful client experience'}</p>
          <p style="margin:0;"><a href="https://getportalkit.com" style="color:#6B5E4A;font-size:13px;text-decoration:none;">getportalkit.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

async function initDb() {
  let retries = 5
  while (retries > 0) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          clerk_id VARCHAR(255),
          full_name TEXT,
          email TEXT UNIQUE NOT NULL,
          password TEXT,
          business_name TEXT,
          plan TEXT DEFAULT 'trial',
          trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS clients (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          event_date DATE,
          event_type TEXT,
          notes TEXT,
          portal_token TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS contracts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          content TEXT,
          status TEXT DEFAULT 'draft',
          signed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS invoices (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
          invoice_number TEXT,
          amount_cents INTEGER NOT NULL DEFAULT 0,
          status TEXT DEFAULT 'draft',
          due_date DATE,
          paid_at TIMESTAMPTZ,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS files (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
          filename TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type TEXT,
          size_bytes INTEGER,
          storage_url TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          sender TEXT NOT NULL CHECK (sender IN ('photographer', 'client')),
          content TEXT NOT NULL,
          read_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `)

      // Migrate existing tables to add clerk_id if missing
      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id VARCHAR(255);
      `).catch(() => {})

      await pool.query(`
        ALTER TABLE users ALTER COLUMN full_name DROP NOT NULL;
      `).catch(() => {})

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_id_unique
        ON users (clerk_id) WHERE clerk_id IS NOT NULL;
      `).catch(() => {})

      await pool.query(`
        ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT;
      `).catch(() => {})

      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS logo_url TEXT;
      `).catch(() => {})

      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#1B4332';
      `).catch(() => {})

      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_calls_today INTEGER DEFAULT 0;
      `).catch(() => {})

      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_calls_reset_at TIMESTAMPTZ DEFAULT NOW();
      `).catch(() => {})

      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
      `).catch(() => {})

      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;
      `).catch(() => {})

      // Backfill: existing users with a business_name are considered onboarded
      await pool.query(`
        UPDATE users SET onboarding_completed = true
        WHERE business_name IS NOT NULL AND business_name <> '' AND onboarding_completed = false;
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_templates (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS trials_used (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          first_trial_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_by_name TEXT;`).catch(() => {})
      await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_by_ip TEXT;`).catch(() => {})
      await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS content_hash TEXT;`).catch(() => {})
      await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS photographer_signed_at TIMESTAMPTZ;`).catch(() => {})
      await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS photographer_signature TEXT;`).catch(() => {})

      await pool.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_key TEXT;`).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS reminders_sent (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          reminder_type TEXT NOT NULL,
          sent_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(client_id, reminder_type)
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS client_events (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          event_name TEXT NOT NULL,
          event_date DATE,
          event_type TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT;`).catch(() => {})
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_enabled BOOLEAN DEFAULT FALSE;`).catch(() => {})

      console.log('✅ Database ready')
      return
    } catch (err) {
      retries--
      console.error(`DB init failed (${retries} retries left):`, err.message)
      if (retries === 0) throw err
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}

async function sendEventReminders() {
  if (!resend) return
  const reminders = [
    { days: 0,  type: '0_day',  subject: 'Your event is today! 🎉' },
    { days: 1,  type: '1_day',  subject: 'Tomorrow is your big day! 🥂' },
    { days: 3,  type: '3_day',  subject: '3 days until your event! ✨' },
    { days: 7,  type: '7_day',  subject: 'One week to go! 📸' },
    { days: 14, type: '14_day', subject: '2 weeks until your big day! 💍' },
    { days: 30, type: '30_day', subject: '30 days until your event! 🎉' },
  ]
  for (const reminder of reminders) {
    try {
      const clients = await pool.query(`
        SELECT c.*, u.business_name, u.full_name as photographer_name
        FROM clients c
        JOIN users u ON c.user_id = u.id
        WHERE DATE(c.event_date) = CURRENT_DATE + ${reminder.days}
        AND c.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM reminders_sent rs
          WHERE rs.client_id = c.id AND rs.reminder_type = $1
        )
      `, [reminder.type])
      for (const client of clients.rows) {
        const rawDate = client.event_date
        const dateStr = rawDate instanceof Date ? rawDate.toISOString().split('T')[0] : (rawDate + '').split('T')[0]
        const [y, mo, d] = dateStr.split('-').map(Number)
        const eventDate = new Date(y, mo - 1, d).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        const portalLink = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${client.portal_token}`
        const biz = client.business_name || client.photographer_name
        try {
          await resend.emails.send({
            from: 'PortalKit <hello@mail.getportalkit.com>',
            to: client.email,
            subject: reminder.subject,
            html: emailTemplate({
              title: reminder.subject,
              preheader: `Your wedding with ${biz} is coming up!`,
              body: `<h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1B4332;">${reminder.subject}</h2><p style="margin:0 0 16px;color:#6B7280;font-size:15px;">Hi ${client.name}! Your wedding day is on <strong>${eventDate}</strong>.</p><p style="margin:0 0 16px;color:#6B7280;font-size:15px;">Visit your client portal to review your contract, check your invoice status, and send any last-minute messages to ${biz}.</p>`,
              ctaText: 'Visit Your Portal →',
              ctaUrl: portalLink,
              footerNote: `Reminder sent on behalf of ${biz} via PortalKit`,
            }),
          })
          await pool.query(
            'INSERT INTO reminders_sent (client_id, reminder_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [client.id, reminder.type]
          )
          console.log(`📅 Reminder sent: ${reminder.type} to ${client.email}`)
        } catch (emailErr) {
          console.error('📅 Reminder email failed:', emailErr.message)
        }
      }
    } catch (err) {
      console.error('📅 Reminder error:', err.message)
    }
  }

  // Also send reminders for client_events table
  for (const reminder of reminders) {
    try {
      const events = await pool.query(`
        SELECT ce.id as event_id, ce.event_name, ce.event_date, ce.event_type,
               c.id as client_id, c.email, c.name as client_name, c.portal_token,
               u.business_name, u.full_name as photographer_name
        FROM client_events ce
        JOIN clients c ON ce.client_id = c.id
        JOIN users u ON c.user_id = u.id
        WHERE DATE(ce.event_date) = CURRENT_DATE + ${reminder.days}
        AND c.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM reminders_sent rs
          WHERE rs.client_id = c.id AND rs.reminder_type = 'ce_' || ce.id || '_' || $1
        )
      `, [reminder.type])
      for (const ev of events.rows) {
        const rawDate = ev.event_date
        const dateStr = rawDate instanceof Date ? rawDate.toISOString().split('T')[0] : (rawDate + '').split('T')[0]
        const [y, mo, d] = dateStr.split('-').map(Number)
        const eventDate = new Date(y, mo - 1, d).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        const portalLink = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${ev.portal_token}`
        const biz = ev.business_name || ev.photographer_name
        const subject = reminder.days === 0
          ? `Today is ${ev.event_name}!`
          : reminder.days === 1
            ? `Tomorrow is ${ev.event_name}!`
            : `${reminder.days} days until ${ev.event_name}!`
        try {
          await resend.emails.send({
            from: 'PortalKit <hello@mail.getportalkit.com>',
            to: ev.email,
            subject,
            html: emailTemplate({
              title: subject,
              preheader: `${ev.event_name} with ${biz} is coming up!`,
              body: `<h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1B4332;">${subject}</h2><p style="margin:0 0 16px;color:#6B7280;font-size:15px;">Hi ${ev.client_name}! Your upcoming event — <strong>${ev.event_name}</strong> — is on <strong>${eventDate}</strong>.</p><p style="margin:0 0 16px;color:#6B7280;font-size:15px;">Visit your client portal to review your details and send any last-minute messages to ${biz}.</p>`,
              ctaText: 'Visit Your Portal →',
              ctaUrl: portalLink,
              footerNote: `Reminder sent on behalf of ${biz} via PortalKit`,
            }),
          })
          await pool.query(
            'INSERT INTO reminders_sent (client_id, reminder_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [ev.client_id, `ce_${ev.event_id}_${reminder.type}`]
          )
          console.log(`📅 Event reminder sent: ${reminder.type} to ${ev.email} for ${ev.event_name}`)
        } catch (emailErr) {
          console.error('📅 Event reminder email failed:', emailErr.message)
        }
      }
    } catch (err) {
      console.error('📅 Client events reminder error:', err.message)
    }
  }
}

// Run on startup and every 24 hours (Railway restarts daily, so this effectively fires once per day)
sendEventReminders()
setInterval(sendEventReminders, 24 * 60 * 60 * 1000)

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  try {
    const token = authHeader?.replace('Bearer ', '')
    if (!token) return res.status(401).json({ error: 'Unauthorized' })

    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      skipJwksCache: true,
    })

    const result = await pool.query('SELECT * FROM users WHERE clerk_id = $1', [payload.sub])

    if (result.rows.length === 0) {
      const clerkUser = await clerk.users.getUser(payload.sub)
      const email = clerkUser.emailAddresses[0]?.emailAddress
      const fullName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || email?.split('@')[0] || 'User'

      const existingByEmail = email ? await pool.query('SELECT * FROM users WHERE email = $1', [email]) : { rows: [] }

      if (existingByEmail.rows.length > 0) {
        const updated = await pool.query(
          'UPDATE users SET clerk_id = $1 WHERE email = $2 RETURNING *',
          [payload.sub, email]
        )
        req.user = updated.rows[0]
        console.log(`🔗 Linked clerk_id to existing account: ${req.user.id}`)
      } else {
        const trialUsed = email ? await pool.query('SELECT * FROM trials_used WHERE email = $1', [email]) : { rows: [] }
        const plan = trialUsed.rows.length > 0 ? 'expired' : 'trial'
        const trialEndsAt = trialUsed.rows.length > 0
          ? new Date().toISOString()
          : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

        if (trialUsed.rows.length === 0 && email) {
          await pool.query('INSERT INTO trials_used (email) VALUES ($1) ON CONFLICT DO NOTHING', [email])
        }

        const newUser = await pool.query(
          `INSERT INTO users (clerk_id, email, full_name, plan, trial_ends_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [payload.sub, email, fullName, plan, trialEndsAt]
        )
        req.user = newUser.rows[0]
        console.log(`${plan === 'expired' ? '🚫 Repeat trial blocked' : '🆕 New user created'}: ${req.user.id}`)
      }
    } else {
      req.user = result.rows[0]
    }

    req.userId = String(req.user.id)

    if (process.env.NODE_ENV !== 'production') {
      console.log(`${req.method} ${req.path} — user ${req.user?.id}`)
    }

    const allowedAfterExpiry = ['/api/auth/me', '/api/users/me', '/api/stripe/create-checkout', '/api/stripe/create-portal', '/api/stripe/create-setup-intent', '/api/stripe/confirm-setup', '/api/health']

    if (req.user.plan === 'trial' && req.user.trial_ends_at) {
      if (new Date() > new Date(req.user.trial_ends_at)) {
        if (!allowedAfterExpiry.some(p => req.path.startsWith(p))) {
          return res.status(402).json({
            error: 'Trial expired',
            message: 'Your 14-day trial has ended. Please upgrade to continue.',
            upgradeUrl: 'https://buy.stripe.com/8x2eVfcbid7ZcILcby9IQ00',
          })
        }
      }
    }

    if (req.user.plan === 'grace' && req.user.grace_period_ends_at) {
      if (new Date() > new Date(req.user.grace_period_ends_at)) {
        if (!allowedAfterExpiry.some(p => req.path.startsWith(p))) {
          return res.status(402).json({
            error: 'Payment failed',
            message: 'Please update your payment method to continue.',
            upgradeUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/settings`,
          })
        }
      }
    }

    next()
  } catch (err) {
    console.error('❌ Auth error:', err.message)
    res.status(401).json({ error: 'Unauthorized' })
  }
}

// ── TEST (public) ─────────────────────────────────────────────

app.get('/api/test', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is reachable', time: new Date() })
})

// ── USERS ─────────────────────────────────────────────────────

app.put('/api/users/me', requireAuth, async (req, res) => {
  console.log('PUT /api/users/me body keys:', Object.keys(req.body))
  const { full_name, business_name, logo_url, brand_color, onboarding_completed } = req.body
  // 'logo_url' in req.body distinguishes "sent as null (remove)" from "not sent (keep)"
  const logoProvided = 'logo_url' in req.body
  const onboardingProvided = 'onboarding_completed' in req.body
  try {
    const result = await pool.query(
      `UPDATE users SET
         full_name=COALESCE($1, full_name),
         business_name=COALESCE($2, business_name),
         logo_url=CASE WHEN $3 THEN $4 ELSE logo_url END,
         brand_color=COALESCE($5, brand_color),
         onboarding_completed=CASE WHEN $7 THEN $8 ELSE onboarding_completed END
       WHERE id=$6
       RETURNING id, clerk_id, full_name, email, business_name, plan, trial_ends_at, stripe_customer_id, logo_url, brand_color, onboarding_completed, stripe_connect_id, stripe_connect_enabled, created_at`,
      [
        full_name ? sanitize(full_name) : null,
        business_name !== undefined ? (sanitize(business_name) || null) : null,
        logoProvided,
        logo_url || null,
        brand_color || null,
        req.userId,
        onboardingProvided,
        onboarding_completed === true,
      ]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('Update profile error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/users/me', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.userId])
    res.json({ success: true })
  } catch (err) {
    console.error('Delete account error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── AUTH ──────────────────────────────────────────────────────

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json(req.user)
})

// Temporary diagnostic — inspect raw DB row + schema. Remove after onboarding stabilizes.
app.get('/api/debug/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId])
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' })
    const row = result.rows[0]
    res.json({
      raw_row: row,
      onboarding_completed: row.onboarding_completed,
      onboarding_completed_type: typeof row.onboarding_completed,
      has_onboarding_column: 'onboarding_completed' in row,
      business_name: row.business_name,
      business_name_type: typeof row.business_name,
      schema_columns: Object.keys(row),
      auth_version: 'v2 - email dedup + onboarding flag active',
    })
  } catch (err) {
    console.error('Debug endpoint error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── STRIPE ────────────────────────────────────────────────────

app.post('/api/stripe/create-checkout', requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })
    const priceId = process.env.STRIPE_PRICE_PORTALKIT
    if (!priceId) return res.status(500).json({ error: 'Price not configured' })

    const userResult = await pool.query('SELECT email, stripe_customer_id FROM users WHERE id=$1', [req.userId])
    const user = userResult.rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })

    let customerId = user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: String(req.userId) },
      })
      customerId = customer.id
      await pool.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [customerId, req.userId])
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${frontendUrl}/dashboard/settings?upgraded=true`,
      cancel_url: `${frontendUrl}/dashboard/settings?cancelled=true`,
      metadata: { userId: String(req.userId) },
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('Checkout error:', err)
    res.status(500).json({ error: 'Failed to create checkout session' })
  }
})

// NOTE: Configure Stripe Customer Portal at stripe.com → Settings → Billing → Customer portal
// Enable: Update payment method, Cancel subscription, View invoice history
// Set cancellation to: Cancel at end of billing period (not immediately)
app.post('/api/stripe/create-portal', requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })
    const userResult = await pool.query('SELECT stripe_customer_id FROM users WHERE id=$1', [req.userId])
    const customerId = userResult.rows[0]?.stripe_customer_id
    if (!customerId) return res.status(400).json({ error: 'No subscription found' })

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/settings`,
    })
    res.json({ url: session.url })
  } catch (err) {
    console.error('Portal error:', err)
    res.status(500).json({ error: 'Failed to create portal session' })
  }
})

// ── STRIPE CONNECT (Account Sessions approach — no OAuth client ID needed) ──

app.post('/api/stripe/connect/onboard', requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })
    let connectId = req.user.stripe_connect_id

    if (!connectId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: req.user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: { user_id: String(req.user.id) },
      })
      connectId = account.id
      await pool.query(
        'UPDATE users SET stripe_connect_id=$1 WHERE id=$2',
        [connectId, req.user.id]
      )
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://getportalkit.com'
    const accountLink = await stripe.accountLinks.create({
      account: connectId,
      refresh_url: `${frontendUrl}/dashboard/settings?stripe_connect=refresh`,
      return_url: `${frontendUrl}/dashboard/settings?stripe_connect=complete`,
      type: 'account_onboarding',
    })

    res.json({ url: accountLink.url })
  } catch (err) {
    console.error('Stripe Connect onboard error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/stripe/connect/status', requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.json({ connected: false, enabled: false })
    if (!req.user.stripe_connect_id) return res.json({ connected: false, enabled: false })

    const account = await stripe.accounts.retrieve(req.user.stripe_connect_id)
    const enabled = !!(account.charges_enabled && account.payouts_enabled)

    if (enabled !== req.user.stripe_connect_enabled) {
      await pool.query(
        'UPDATE users SET stripe_connect_enabled=$1 WHERE id=$2',
        [enabled, req.user.id]
      ).catch(() => {})
    }

    res.json({
      connected: true,
      enabled,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      account_id: account.id,
    })
  } catch (err) {
    console.error('Stripe Connect status error:', err)
    res.json({ connected: false, enabled: false })
  }
})

app.post('/api/stripe/connect/disconnect', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE users SET stripe_connect_id=NULL, stripe_connect_enabled=false WHERE id=$1', [req.userId])
    res.json({ success: true })
  } catch (err) {
    console.error('Connect disconnect error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/stripe/create-setup-intent', requireAuth, async (req, res) => {
  try {
    console.log('💳 Creating setup intent for user:', req.user.id)
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })

    let customerId = req.user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.full_name || req.user.business_name,
        metadata: { user_id: String(req.user.id) },
      })
      customerId = customer.id
      await pool.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [customerId, req.user.id])
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      metadata: { user_id: String(req.user.id) },
    })

    res.json({ clientSecret: setupIntent.client_secret, customerId })
  } catch (err) {
    console.error('💳 Setup intent error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/stripe/confirm-setup', requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })
    const { paymentMethodId } = req.body
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId required' })

    const customerId = req.user.stripe_customer_id
    if (!customerId) return res.status(400).json({ error: 'No Stripe customer found' })

    const priceId = process.env.STRIPE_PRICE_PORTALKIT
    if (!priceId) return res.status(500).json({ error: 'Price not configured' })

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: 14,
      metadata: { user_id: String(req.user.id) },
    })

    await pool.query(
      'UPDATE users SET stripe_subscription_id=$1, plan=$2 WHERE id=$3',
      [subscription.id, 'trial', req.user.id]
    )

    console.log(`💳 Subscription created for user ${req.user.id}: ${subscription.id}`)
    res.json({ success: true, subscription: subscription.id })
  } catch (err) {
    console.error('💳 Confirm setup error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/stripe/create-checkout-with-trial', requireAuth, async (req, res) => {
  try {
    console.log('💳 Creating Stripe checkout for user:', req.user.id)
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })
    const priceId = process.env.STRIPE_PRICE_PORTALKIT
    if (!priceId) return res.status(500).json({ error: 'Price not configured' })

    const userResult = await pool.query('SELECT email, stripe_customer_id FROM users WHERE id=$1', [req.userId])
    const user = userResult.rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })

    let customerId = user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: String(req.userId) },
      })
      customerId = customer.id
      await pool.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [customerId, req.userId])
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://getportalkit.com'
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { user_id: String(req.user.id), clerk_id: req.user.clerk_id || '' },
      },
      phone_number_collection: { enabled: false },
      custom_text: {
        submit: { message: 'You won\'t be charged for 14 days. Cancel anytime before your trial ends.' },
      },
      success_url: `${frontendUrl}/dashboard?payment=success`,
      cancel_url: `${frontendUrl}/dashboard/setup`,
      metadata: { user_id: String(req.user.id) },
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('💳 Stripe checkout error:', err)
    res.status(500).json({ error: 'Failed to create checkout session' })
  }
})

// ── DASHBOARD ─────────────────────────────────────────────────

app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const [clients, invoices, user, upcomingMain, upcomingEvents] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM clients WHERE user_id=$1', [req.userId]),
      pool.query("SELECT COUNT(*) FROM invoices WHERE user_id=$1 AND status != 'paid'", [req.userId]),
      pool.query('SELECT plan, trial_ends_at FROM users WHERE id=$1', [req.userId]),
      pool.query(`SELECT COUNT(*) FROM clients WHERE user_id=$1 AND event_date >= CURRENT_DATE AND event_date <= CURRENT_DATE + INTERVAL '30 days'`, [req.userId]),
      pool.query(`SELECT COUNT(*) FROM client_events ce JOIN clients c ON ce.client_id = c.id WHERE c.user_id=$1 AND ce.event_date >= CURRENT_DATE AND ce.event_date <= CURRENT_DATE + INTERVAL '30 days'`, [req.userId]),
    ])
    const u = user.rows[0]
    let trial_days_remaining = null
    if (u && u.plan !== 'active' && u.trial_ends_at) {
      const diff = new Date(u.trial_ends_at).getTime() - Date.now()
      trial_days_remaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
    }
    const clientCount = parseInt(clients.rows[0].count, 10)
    res.json({
      total_clients: clientCount,
      active_portals: clientCount,
      pending_invoices: parseInt(invoices.rows[0].count, 10),
      upcoming_events: parseInt(upcomingMain.rows[0].count, 10) + parseInt(upcomingEvents.rows[0].count, 10),
      trial_days_remaining,
    })
  } catch (err) {
    console.error('Dashboard stats error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CLIENTS ───────────────────────────────────────────────────

app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, event_date, event_type, notes, portal_token, created_at, updated_at FROM clients WHERE user_id=$1 ORDER BY created_at DESC',
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Get clients error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/clients', requireAuth, async (req, res) => {
  const { name, email, phone, event_date, event_type, notes } = req.body
  if (!name) return res.status(400).json({ error: 'Client name is required' })
  try {
    const portalToken = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    const result = await pool.query(
      `INSERT INTO clients (user_id, name, email, phone, event_date, event_type, notes, portal_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [req.userId, sanitize(name), email || null, sanitize(phone) || null, event_date || null, sanitize(event_type) || null, sanitize(notes) || null, portalToken]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('Create client error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/clients/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!result.rows.length) return res.status(404).json({ error: 'Client not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('Get client error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/clients/:id', requireAuth, async (req, res) => {
  const { name, email, phone, event_date, event_type, notes } = req.body
  console.log('📝 PUT client body:', JSON.stringify(req.body))
  console.log('📝 Notes value:', req.body.notes)
  console.log('📝 Notes type:', typeof req.body.notes)
  try {
    const sqlParams = [sanitize(name), email || null, sanitize(phone) || null, event_date || null, sanitize(event_type) || null, sanitize(notes) || null, req.params.id, req.userId]
    console.log('📝 SQL params:', sqlParams)
    const result = await pool.query(
      `UPDATE clients SET name=$1, email=$2, phone=$3, event_date=$4, event_type=$5, notes=$6, updated_at=NOW()
       WHERE id=$7 AND user_id=$8 RETURNING *`,
      sqlParams
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Client not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('Update client error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/clients/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    console.error('Delete client error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CLIENT EVENTS ─────────────────────────────────────────────

app.get('/api/clients/:id/events', requireAuth, async (req, res) => {
  try {
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const result = await pool.query(
      'SELECT * FROM client_events WHERE client_id=$1 ORDER BY event_date ASC NULLS LAST, created_at ASC',
      [req.params.id]
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Get client events error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/clients/:id/events', requireAuth, async (req, res) => {
  const { event_name, event_date, event_type, notes } = req.body
  if (!event_name) return res.status(400).json({ error: 'event_name is required' })
  try {
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const result = await pool.query(
      `INSERT INTO client_events (client_id, event_name, event_date, event_type, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, sanitize(event_name), event_date || null, sanitize(event_type) || null, sanitize(notes) || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('Create client event error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/clients/:id/events/:eventId', requireAuth, async (req, res) => {
  const { event_name, event_date, event_type, notes } = req.body
  try {
    const result = await pool.query(
      `UPDATE client_events SET event_name=$1, event_date=$2, event_type=$3, notes=$4
       WHERE id=$5 AND client_id=$6
         AND EXISTS (SELECT 1 FROM clients WHERE id=$6 AND user_id=$7)
       RETURNING *`,
      [sanitize(event_name), event_date || null, sanitize(event_type) || null, sanitize(notes) || null, req.params.eventId, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Event not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('Update client event error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/clients/:id/events/:eventId', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM client_events WHERE id=$1 AND client_id=$2
         AND EXISTS (SELECT 1 FROM clients WHERE id=$2 AND user_id=$3)
       RETURNING id`,
      [req.params.eventId, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Event not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('Delete client event error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CONTRACTS ─────────────────────────────────────────────────

app.get('/api/contracts', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, cl.name as client_name FROM contracts c
       LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE c.user_id=$1 ORDER BY c.created_at DESC`,
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Get contracts error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/contracts', requireAuth, async (req, res) => {
  const { client_id, title, content } = req.body
  if (!title) return res.status(400).json({ error: 'Contract title is required' })
  if (content && content.length > 50000) return res.status(400).json({ error: 'Contract too long' })
  try {
    const result = await pool.query(
      `INSERT INTO contracts (user_id, client_id, title, content) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.userId, client_id || null, sanitize(title), content || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('Create contract error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/contracts/:id', requireAuth, async (req, res) => {
  const { title, content, status, client_id } = req.body
  try {
    const result = await pool.query(
      `UPDATE contracts SET title=$1, content=$2, status=$3, client_id=$4, updated_at=NOW()
       WHERE id=$5 AND user_id=$6 RETURNING *`,
      [sanitize(title), content || null, status || 'draft', client_id || null, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Contract not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('Update contract error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/contracts/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM contracts WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    console.error('Delete contract error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── INVOICES ──────────────────────────────────────────────────

app.get('/api/invoices', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, cl.name as client_name FROM invoices i
       LEFT JOIN clients cl ON cl.id = i.client_id
       WHERE i.user_id=$1 ORDER BY i.created_at DESC`,
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Get invoices error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/invoices', requireAuth, async (req, res) => {
  const { client_id, invoice_number, amount_cents, due_date, notes } = req.body
  if (!amount_cents) return res.status(400).json({ error: 'Invoice amount is required' })
  try {
    const result = await pool.query(
      `INSERT INTO invoices (user_id, client_id, invoice_number, amount_cents, due_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.userId, client_id || null, invoice_number || null, amount_cents, due_date || null, sanitize(notes) || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('Create invoice error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/invoices/:id', requireAuth, async (req, res) => {
  const { status, paid_at, amount_cents, due_date, invoice_number, notes, notify_client } = req.body
  try {
    const result = await pool.query(
      `UPDATE invoices SET
         status=COALESCE($1, status),
         paid_at=CASE WHEN $2::text IS NOT NULL THEN $2::timestamptz ELSE paid_at END,
         amount_cents=COALESCE($3::integer, amount_cents),
         due_date=COALESCE($4::date, due_date),
         invoice_number=COALESCE($5, invoice_number),
         notes=COALESCE($6, notes),
         updated_at=NOW()
       WHERE id=$7 AND user_id=$8 RETURNING *`,
      [status || null, paid_at || null, amount_cents || null, due_date || null, invoice_number || null, sanitize(notes) || null, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Invoice not found' })
    const invoice = result.rows[0]

    if (notify_client && invoice.client_id && resend) {
      try {
        const infoResult = await pool.query(
          `SELECT cl.email, cl.portal_token, u.business_name, u.full_name
           FROM invoices i
           JOIN clients cl ON cl.id = i.client_id
           JOIN users u ON u.id = i.user_id
           WHERE i.id=$1`,
          [invoice.id]
        )
        if (infoResult.rows.length && infoResult.rows[0].email) {
          const info = infoResult.rows[0]
          const senderName = info.business_name || info.full_name || 'Your photographer'
          const amount = `$${(invoice.amount_cents / 100).toFixed(2)}`
          const invNum = invoice.invoice_number ? `#${invoice.invoice_number}` : ''
          const portalUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${info.portal_token}`
          console.log('📧 Sending invoice update email to:', info.email)
          const emailResult = await resend.emails.send({
            from: 'PortalKit <hello@mail.getportalkit.com>',
            to: info.email,
            subject: `Your invoice has been updated — ${senderName}`,
            html: emailTemplate({
              title: 'Invoice Updated',
              preheader: `Your invoice ${invNum} from ${senderName} has been updated.`,
              body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 8px;">Invoice updated</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 20px;">Your invoice ${invNum} from <strong>${senderName}</strong> has been updated.</p><p style="font-size:36px;font-weight:800;color:#1A1208;margin:0 0 8px;letter-spacing:-0.02em;">${amount}</p>${invoice.due_date ? `<p style="color:#6B5E4A;margin:0;">Due: ${new Date(invoice.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>` : ''}`,
              ctaText: 'View details →',
              ctaUrl: portalUrl,
              footerNote: `Sent on behalf of ${senderName} via PortalKit`,
            }),
          })
          console.log('📧 Invoice update email sent:', emailResult)
        }
      } catch (emailErr) {
        console.error('📧 Invoice update email failed:', emailErr)
      }
    }

    res.json(invoice)
  } catch (err) {
    console.error('Update invoice error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CONTRACT SEND ─────────────────────────────────────────────

app.post('/api/contracts/:id/send', requireAuth, async (req, res) => {
  try {
    const contractResult = await pool.query(
      `SELECT c.*, cl.email as client_email, cl.name as client_name, cl.portal_token,
              u.business_name, u.full_name as photographer_name
       FROM contracts c
       LEFT JOIN clients cl ON cl.id = c.client_id
       JOIN users u ON u.id = c.user_id
       WHERE c.id=$1 AND c.user_id=$2`,
      [req.params.id, req.userId]
    )
    if (!contractResult.rows.length) return res.status(404).json({ error: 'Contract not found' })
    const contract = contractResult.rows[0]

    const updated = await pool.query(
      `UPDATE contracts SET status='sent', updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    )

    console.log('📤 Contract client_email:', contract.client_email)
    console.log('📤 Resend configured:', !!resend)
    if (!contract.client_email) {
      return res.status(400).json({ error: 'This contract has no client assigned. Please assign a client first.' })
    }
    if (!resend) {
      return res.status(500).json({ error: 'Email service not configured' })
    }
    {
      const senderName = contract.business_name || contract.photographer_name || 'Your photographer'
      const portalUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${contract.portal_token}`
      console.log('📧 Sending contract email to:', contract.client_email)
      try {
        const emailResult = await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: contract.client_email,
          subject: `Please review and sign your contract — ${senderName}`,
          html: emailTemplate({
            title: 'Contract Ready to Sign',
            preheader: `${senderName} has sent you a contract to review and sign.`,
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 8px;">Hi ${contract.client_name},</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;"><strong>${senderName}</strong> has sent you a contract to review and sign:</p><p style="font-size:18px;font-weight:700;color:#1A1208;margin:0 0 16px;">${contract.title}</p><p style="color:#6B5E4A;line-height:1.6;margin:0;">Please open your client portal to read the contract and add your electronic signature. This only takes a minute.</p>`,
            ctaText: 'Review & Sign Contract →',
            ctaUrl: portalUrl,
            footerNote: `Sent on behalf of ${senderName} via PortalKit`,
          }),
        })
        console.log('📧 Contract email sent:', emailResult)
      } catch (emailErr) {
        console.error('📧 Contract email failed:', emailErr)
      }
    }

    res.json(updated.rows[0])
  } catch (err) {
    console.error('Send contract error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/contracts/:id/photographer-sign', requireAuth, async (req, res) => {
  const { signature_name } = req.body
  if (!signature_name?.trim()) return res.status(400).json({ error: 'Signature name is required' })
  try {
    const contractResult = await pool.query(
      'SELECT * FROM contracts WHERE id=$1 AND user_id=$2',
      [req.params.id, req.userId]
    )
    if (!contractResult.rows.length) return res.status(404).json({ error: 'Contract not found' })
    const contract = contractResult.rows[0]
    const newStatus = contract.signed_at ? 'fully_signed' : contract.status
    const result = await pool.query(
      `UPDATE contracts SET photographer_signed_at=NOW(), photographer_signature=$1, status=$2, updated_at=NOW()
       WHERE id=$3 AND user_id=$4 RETURNING *`,
      [sanitize(signature_name).slice(0, 200), newStatus, req.params.id, req.userId]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('Photographer sign error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── INVOICE SEND + DELETE ─────────────────────────────────────

app.post('/api/invoices/:id/send', requireAuth, async (req, res) => {
  try {
    const invoiceResult = await pool.query(
      `SELECT i.*, cl.email as client_email, cl.name as client_name, cl.portal_token,
              u.business_name, u.full_name as photographer_name
       FROM invoices i
       LEFT JOIN clients cl ON cl.id = i.client_id
       JOIN users u ON u.id = i.user_id
       WHERE i.id=$1 AND i.user_id=$2`,
      [req.params.id, req.userId]
    )
    if (!invoiceResult.rows.length) return res.status(404).json({ error: 'Invoice not found' })
    const invoice = invoiceResult.rows[0]

    const updated = await pool.query(
      `UPDATE invoices SET status='sent', updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    )

    if (invoice.client_email && resend) {
      const senderName = invoice.business_name || invoice.photographer_name || 'Your photographer'
      const portalUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${invoice.portal_token}`
      const amount = `$${((invoice.amount_cents || 0) / 100).toFixed(2)}`
      console.log('📧 Sending invoice email to:', invoice.client_email)
      try {
        const emailResult = await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: invoice.client_email,
          subject: `Invoice from ${senderName} — ${amount}`,
          html: emailTemplate({
            title: 'Invoice',
            preheader: `You have a new invoice for ${amount} from ${senderName}.`,
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 8px;">Invoice from ${senderName}</h2><p style="font-size:36px;font-weight:800;color:#1A1208;margin:16px 0 8px;letter-spacing:-0.02em;">${amount}</p>${invoice.invoice_number ? `<p style="color:#6B5E4A;margin:0 0 4px;">Invoice #${invoice.invoice_number}</p>` : ''}${invoice.due_date ? `<p style="color:#6B5E4A;margin:0;">Due: ${new Date(invoice.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>` : ''}`,
            ctaText: 'View portal to pay →',
            ctaUrl: portalUrl,
            footerNote: `Sent on behalf of ${senderName} via PortalKit`,
          }),
        })
        console.log('📧 Invoice email sent:', emailResult)
      } catch (emailErr) {
        console.error('📧 Invoice email failed:', emailErr)
      }
    }

    res.json(updated.rows[0])
  } catch (err) {
    console.error('Send invoice error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/invoices/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM invoices WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    console.error('Delete invoice error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── FILES ─────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'video/mp4', 'video/quicktime', 'application/zip']
    cb(null, allowed.includes(file.mimetype))
  },
})

async function generateDownloadUrl(storageKey) {
  if (!r2 || !storageKey) return null
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }), { expiresIn: 7 * 24 * 60 * 60 })
}

app.post('/api/files/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    const client_id = req.body.client_id ? parseInt(req.body.client_id) : null
    if (client_id) {
      const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [client_id, req.userId])
      if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    }

    let storageKey = null
    let storageUrl = null

    if (r2) {
      storageKey = `${req.userId}/${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: storageKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ContentDisposition: `attachment; filename="${req.file.originalname}"`,
      }))
      storageUrl = await generateDownloadUrl(storageKey)
    } else {
      return res.status(503).json({ error: 'File storage not configured. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.' })
    }

    const result = await pool.query(
      `INSERT INTO files (user_id, client_id, filename, original_name, mime_type, size_bytes, storage_url, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.userId, client_id || null, storageKey, req.file.originalname, req.file.mimetype, req.file.size, storageUrl, storageKey]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('File upload error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/files', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*, cl.name as client_name FROM files f
       LEFT JOIN clients cl ON cl.id = f.client_id
       WHERE f.user_id=$1 ORDER BY f.created_at DESC`,
      [req.userId]
    )
    // Refresh presigned URLs for R2 files
    const rows = await Promise.all(result.rows.map(async f => {
      if (f.storage_key && r2) {
        f.storage_url = await generateDownloadUrl(f.storage_key).catch(() => f.storage_url)
      }
      return f
    }))
    res.json(rows)
  } catch (err) {
    console.error('Get files error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/files/:id', requireAuth, async (req, res) => {
  try {
    const fileResult = await pool.query('SELECT storage_key FROM files WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (fileResult.rows.length && fileResult.rows[0].storage_key && r2) {
      await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: fileResult.rows[0].storage_key })).catch(e => console.error('R2 delete failed:', e))
    }
    await pool.query('DELETE FROM files WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    console.error('Delete file error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.patch('/api/files/:id/assign', requireAuth, async (req, res) => {
  const { client_id } = req.body
  try {
    const fileResult = await pool.query('SELECT id FROM files WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!fileResult.rows.length) return res.status(404).json({ error: 'File not found' })
    if (client_id) {
      const clientResult = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [client_id, req.userId])
      if (!clientResult.rows.length) return res.status(403).json({ error: 'Client not found' })
    }
    const result = await pool.query(
      'UPDATE files SET client_id=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
      [client_id || null, req.params.id, req.userId]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('Assign file error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CLIENT PORTAL (public) ────────────────────────────────────

app.get('/api/portals/:token', async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.id, c.name, c.event_date, c.event_type,
              u.full_name as photographer_name, u.business_name as photographer_business,
              u.logo_url as photographer_logo, u.brand_color as photographer_brand_color,
              u.stripe_connect_enabled as payments_enabled
       FROM clients c JOIN users u ON u.id = c.user_id
       WHERE c.portal_token=$1`,
      [req.params.token]
    )
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const client = clientResult.rows[0]

    const [contracts, invoices, files] = await Promise.all([
      pool.query(
        `SELECT id, title, status, content, signed_at, signed_by_name, content_hash FROM contracts WHERE client_id=$1 AND status != 'draft' ORDER BY created_at DESC`,
        [client.id]
      ),
      pool.query(
        `SELECT id, invoice_number, amount_cents, status, due_date FROM invoices WHERE client_id=$1 AND status != 'draft' ORDER BY created_at DESC`,
        [client.id]
      ),
      pool.query(
        `SELECT id, original_name, mime_type, size_bytes, storage_url, storage_key, created_at FROM files WHERE client_id=$1 ORDER BY created_at DESC`,
        [client.id]
      ),
    ])

    // Refresh presigned URLs for R2 files
    const fileRows = await Promise.all(files.rows.map(async f => {
      if (f.storage_key && r2) {
        f.storage_url = await generateDownloadUrl(f.storage_key).catch(() => f.storage_url)
      }
      return f
    }))

    res.json({
      ...client,
      contracts: contracts.rows,
      invoices: invoices.rows,
      files: fileRows,
    })
  } catch (err) {
    console.error('Portal error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CONTRACT SIGNING (public) ─────────────────────────────────

app.post('/api/portals/:token/contracts/:contractId/sign', async (req, res) => {
  const { signer_name } = req.body
  if (!signer_name?.trim()) return res.status(400).json({ error: 'signer_name is required' })
  try {
    const contractResult = await pool.query(
      `SELECT c.*, cl.email as client_email, cl.name as client_name, cl.portal_token,
              u.email as photographer_email, u.business_name, u.full_name as photographer_name
       FROM contracts c
       JOIN clients cl ON cl.id = c.client_id
       JOIN users u ON u.id = c.user_id
       WHERE c.id=$1 AND cl.portal_token=$2 AND c.status NOT IN ('signed', 'fully_signed')`,
      [req.params.contractId, req.params.token]
    )
    if (!contractResult.rows.length) return res.status(404).json({ error: 'Contract not found or already signed' })
    const contract = contractResult.rows[0]

    const signerIp = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown'
    const hash = crypto.createHash('sha256').update(contract.content || '').digest('hex')

    const newStatus = contract.photographer_signed_at ? 'fully_signed' : 'signed'
    const updated = await pool.query(
      `UPDATE contracts SET status=$1, signed_by_name=$2, signed_by_ip=$3, signed_at=NOW(), content_hash=$4
       WHERE id=$5 RETURNING *`,
      [newStatus, sanitize(signer_name), signerIp, hash, contract.id]
    )
    const signedContract = updated.rows[0]

    const senderName = contract.business_name || contract.photographer_name || 'Your photographer'
    const signedDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const portalLink = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${contract.portal_token}`

    if (contract.client_email && resend) {
      try {
        await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: contract.client_email,
          subject: `Contract signed — ${senderName}`,
          html: emailTemplate({
            title: 'Contract Signed',
            preheader: `You signed ${contract.title}. You can view it anytime in your portal.`,
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Contract signed</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">You signed <strong>${contract.title}</strong>. You can view the signed contract anytime in your portal.</p><div style="background:#F9F6F0;border:1px solid #E8E0D0;border-radius:8px;padding:16px;font-size:13px;color:#6B5E4A;line-height:1.8;"><strong>Signer:</strong> ${sanitize(signer_name)}<br><strong>Date:</strong> ${signedDate}<br><strong>Reference:</strong> ${hash.slice(-8).toUpperCase()}</div>`,
            ctaText: 'View Your Portal →',
            ctaUrl: portalLink,
            footerNote: `Signed on behalf of ${senderName} via PortalKit`,
          }),
        })
      } catch (emailErr) {
        console.error('Sign confirmation email failed:', emailErr)
      }
    }

    if (contract.photographer_email && resend) {
      try {
        await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: contract.photographer_email,
          subject: `${contract.client_name} signed their contract`,
          html: emailTemplate({
            title: 'Contract Signed',
            preheader: `${contract.client_name} signed ${contract.title}.`,
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 8px;">Contract signed</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;"><strong>${contract.client_name}</strong> signed <strong>${contract.title}</strong> on ${signedDate}.</p><div style="background:#F9F6F0;border:1px solid #E8E0D0;border-radius:8px;padding:16px;font-size:13px;color:#6B5E4A;line-height:1.8;"><strong>Signer:</strong> ${sanitize(signer_name)}<br><strong>Date:</strong> ${signedDate}</div>`,
            ctaText: 'View in Dashboard →',
            ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/contracts`,
            footerNote: 'PortalKit · contract management for photographers',
          }),
        })
      } catch (emailErr) {
        console.error('Sign notification email failed:', emailErr)
      }
    }

    res.json(signedContract)
  } catch (err) {
    console.error('Sign contract error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── MESSAGES ─────────────────────────────────────────────────

// Must be before /api/messages?client_id=X to avoid route conflicts
app.get('/api/messages/unread-count', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM messages m
       JOIN clients c ON c.id = m.client_id
       WHERE c.user_id=$1 AND m.sender='client' AND m.read_at IS NULL`,
      [req.userId]
    )
    res.json({ count: parseInt(result.rows[0].count, 10) })
  } catch (err) {
    console.error('Unread count error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/messages/summaries', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         c.id as client_id,
         (SELECT content FROM messages WHERE client_id=c.id ORDER BY created_at DESC LIMIT 1) as last_message,
         (SELECT sender FROM messages WHERE client_id=c.id ORDER BY created_at DESC LIMIT 1) as last_sender,
         (SELECT created_at FROM messages WHERE client_id=c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
         (SELECT COUNT(*) FROM messages WHERE client_id=c.id AND sender='client' AND read_at IS NULL)::int as unread_count
       FROM clients c WHERE c.user_id=$1`,
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Summaries error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/messages', requireAuth, async (req, res) => {
  const { client_id } = req.query
  if (!client_id) return res.status(400).json({ error: 'client_id required' })
  try {
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [client_id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    await pool.query(
      `UPDATE messages SET read_at=NOW() WHERE client_id=$1 AND sender='client' AND read_at IS NULL`,
      [client_id]
    )
    const result = await pool.query(
      'SELECT * FROM messages WHERE client_id=$1 ORDER BY created_at ASC',
      [client_id]
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Get messages error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/messages', requireAuth, async (req, res) => {
  const { client_id, content } = req.body
  if (!client_id || !content?.trim()) return res.status(400).json({ error: 'client_id and content required' })
  try {
    const clientResult = await pool.query(
      `SELECT c.*, u.business_name, u.full_name as photographer_name
       FROM clients c JOIN users u ON u.id=c.user_id
       WHERE c.id=$1 AND c.user_id=$2`,
      [client_id, req.userId]
    )
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Client not found' })
    const client = clientResult.rows[0]
    const msgResult = await pool.query(
      `INSERT INTO messages (client_id, user_id, sender, content) VALUES ($1,$2,'photographer',$3) RETURNING *`,
      [client_id, req.userId, sanitize(content)]
    )
    if (!client.email) {
      console.warn('⚠️ Client has no email - notification skipped')
    } else if (!resend) {
      console.warn('⚠️ Resend not configured - notification skipped')
    } else {
      const senderName = client.business_name || client.photographer_name || 'Your photographer'
      const portalUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${client.portal_token}`
      console.log('💬 Message created, sending email to client:', client.email)
      console.log('💬 Photographer business:', client.business_name || client.photographer_name)
      try {
        const emailResult = await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: client.email,
          subject: `New message from ${senderName}`,
          html: emailTemplate({
            title: `New message from ${senderName}`,
            preheader: `You have a new message from ${senderName}.`,
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 8px;">Hi ${client.name},</h2><p style="color:#6B5E4A;line-height:1.6;margin:0;">You have a new message from <strong>${senderName}</strong>.</p>`,
            ctaText: 'View your portal to reply →',
            ctaUrl: portalUrl,
            footerNote: `Sent on behalf of ${senderName} via PortalKit`,
          }),
        })
        console.log('📧 Message notification sent:', emailResult)
      } catch (emailErr) {
        console.error('📧 Message notification failed:', emailErr)
      }
    }
    res.status(201).json(msgResult.rows[0])
  } catch (err) {
    console.error('Send message error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/portals/:token/messages', async (req, res) => {
  try {
    const clientResult = await pool.query('SELECT id FROM clients WHERE portal_token=$1', [req.params.token])
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const result = await pool.query(
      'SELECT id, sender, content, read_at, created_at FROM messages WHERE client_id=$1 ORDER BY created_at ASC',
      [clientResult.rows[0].id]
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Get portal messages error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/portals/:token/messages', async (req, res) => {
  const { content, sender_name } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'content required' })
  try {
    const clientResult = await pool.query(
      `SELECT c.*, u.email as photographer_email, u.business_name, u.full_name as photographer_name
       FROM clients c JOIN users u ON u.id=c.user_id WHERE c.portal_token=$1`,
      [req.params.token]
    )
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const client = clientResult.rows[0]
    const msgResult = await pool.query(
      `INSERT INTO messages (client_id, user_id, sender, content) VALUES ($1,$2,'client',$3) RETURNING *`,
      [client.id, client.user_id, sanitize(content)]
    )
    if (client.photographer_email && resend) {
      const displaySender = client.name
      const dashUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/messages`
      console.log('📧 Sending client message notification to photographer:', client.photographer_email)
      try {
        const emailResult = await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: client.photographer_email,
          subject: `${displaySender} sent you a message`,
          html: emailTemplate({
            title: `New message from ${displaySender}`,
            preheader: `${displaySender} sent you a new message through their portal.`,
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 8px;">New message</h2><p style="color:#6B5E4A;margin:0 0 16px;"><strong>${displaySender}</strong> sent a message:</p><blockquote style="border-left:3px solid #C9A84C;padding:12px 16px;margin:0;background:#F9F6F0;border-radius:0 8px 8px 0;color:#2D2416;line-height:1.6;">${sanitize(content)}</blockquote>`,
            ctaText: 'Reply in dashboard →',
            ctaUrl: dashUrl,
            footerNote: 'PortalKit · your client communication hub',
          }),
        })
        console.log('📧 Client message notification sent:', emailResult)
      } catch (emailErr) {
        console.error('📧 Client message notification failed:', emailErr)
      }
    }
    res.status(201).json(msgResult.rows[0])
  } catch (err) {
    console.error('Client message error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/portals/:token/invoices/:invoiceId/pay', async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.*, u.stripe_connect_id, u.stripe_connect_enabled
       FROM clients c JOIN users u ON u.id = c.user_id
       WHERE c.portal_token=$1`,
      [req.params.token]
    )
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const client = clientResult.rows[0]

    if (!client.stripe_connect_id || !client.stripe_connect_enabled) {
      return res.status(400).json({ error: 'Photographer has not set up payments yet' })
    }

    const invoiceResult = await pool.query(
      "SELECT * FROM invoices WHERE id=$1 AND client_id=$2 AND status != 'paid'",
      [req.params.invoiceId, client.id]
    )
    if (!invoiceResult.rows.length) return res.status(404).json({ error: 'Invoice not found' })
    const invoice = invoiceResult.rows[0]

    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })

    const applicationFeeAmount = Math.round(invoice.amount_cents * 0.02)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: invoice.amount_cents,
      currency: 'usd',
      application_fee_amount: applicationFeeAmount,
      transfer_data: { destination: client.stripe_connect_id },
      metadata: { invoice_id: String(invoice.id), client_id: String(client.id) },
    })

    res.json({ clientSecret: paymentIntent.client_secret })
  } catch (err) {
    console.error('Portal payment intent error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/messages/:id', requireAuth, async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' })
  try {
    const result = await pool.query(
      `UPDATE messages SET content=$1
       WHERE id=$2 AND user_id=$3 AND sender='photographer'
         AND created_at > NOW() - INTERVAL '5 minutes'
       RETURNING *`,
      [content.trim(), req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(403).json({ error: 'Messages can only be edited within 5 minutes' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('Edit message error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/messages/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM messages WHERE id=$1 AND user_id=$2 AND sender='photographer' RETURNING id`,
      [req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Message not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('Delete message error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── AI ────────────────────────────────────────────────────────

const aiRateLimit = new Map()

async function checkAndIncrementAiCalls(userId) {
  const result = await pool.query(
    'SELECT ai_calls_today, ai_calls_reset_at FROM users WHERE id=$1', [userId]
  )
  if (!result.rows.length) return false
  const { ai_calls_today, ai_calls_reset_at } = result.rows[0]
  const hoursSinceReset = (Date.now() - new Date(ai_calls_reset_at).getTime()) / 3_600_000
  const currentCalls = hoursSinceReset >= 24 ? 0 : (ai_calls_today || 0)
  if (currentCalls >= 20) return false
  if (hoursSinceReset >= 24) {
    await pool.query('UPDATE users SET ai_calls_today=1, ai_calls_reset_at=NOW() WHERE id=$1', [userId])
  } else {
    await pool.query('UPDATE users SET ai_calls_today=ai_calls_today+1 WHERE id=$1', [userId])
  }
  return true
}

app.post('/api/ai/suggest-message', requireAuth, aiLimiter, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI not configured — set ANTHROPIC_API_KEY' })
  const now = Date.now()
  const timestamps = (aiRateLimit.get(req.userId) || []).filter(t => now - t < 3_600_000)
  if (timestamps.length >= 10) return res.status(429).json({ error: 'Rate limit: 10 AI suggestions per hour' })
  const allowed = await checkAndIncrementAiCalls(req.userId)
  if (!allowed) return res.status(429).json({ error: 'Daily AI limit reached (20/day)' })
  aiRateLimit.set(req.userId, [...timestamps, now])
  const { client_id, context: rawContext } = req.body
  const context = sanitizePrompt(rawContext)
  try {
    let clientContext = context || ''
    if (client_id) {
      const r = await pool.query('SELECT name, event_type, event_date, notes FROM clients WHERE id=$1 AND user_id=$2', [client_id, req.userId])
      if (r.rows.length) {
        const c = r.rows[0]
        clientContext = `Client: ${c.name}. Event: ${c.event_type || 'unspecified'}. Date: ${c.event_date || 'TBD'}. Notes: ${c.notes || 'none'}. Extra context: ${context || 'none'}`
      }
    }
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: 'You are a helpful assistant for a professional photographer. Write a professional, warm, concise message to send to a client. Keep it under 100 words. No subject line.',
      messages: [{ role: 'user', content: `Write a message for this client: ${clientContext}` }],
    })
    const suggestion = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    res.json({ suggestion })
  } catch (err) {
    console.error('AI suggest error:', err)
    res.status(500).json({ error: 'AI suggestion failed' })
  }
})

app.post('/api/ai/generate-contract', requireAuth, aiLimiter, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI not configured — set ANTHROPIC_API_KEY' })
  const now = Date.now()
  const timestamps = (aiRateLimit.get(req.userId) || []).filter(t => now - t < 3_600_000)
  if (timestamps.length >= 10) return res.status(429).json({ error: 'Rate limit: 10 AI requests per hour' })
  const allowed = await checkAndIncrementAiCalls(req.userId)
  if (!allowed) return res.status(429).json({ error: 'Daily AI limit reached (20/day)' })
  aiRateLimit.set(req.userId, [...timestamps, now])
  const { client_id, template_type: rawTemplateType, custom_instructions: rawCustomInstructions } = req.body
  const template_type = sanitizePrompt(rawTemplateType)
  const custom_instructions = rawCustomInstructions ? sanitizePrompt(String(rawCustomInstructions)) : ''
  console.log('🤖 AI contract request:', { client_id, template_type, user: req.user.id })
  try {
    const userResult = await pool.query('SELECT business_name, full_name FROM users WHERE id=$1', [req.userId])
    const photographer = userResult.rows[0]
    const businessName = photographer?.business_name || photographer?.full_name || 'the photographer'
    let clientContext = 'a photography client'
    if (client_id) {
      const r = await pool.query('SELECT name, event_type, event_date, notes FROM clients WHERE id=$1 AND user_id=$2', [client_id, req.userId])
      if (r.rows.length) {
        const c = r.rows[0]
        clientContext = `Client: ${c.name}. Event: ${c.event_type || 'photography session'}. Date: ${c.event_date ? new Date(c.event_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'TBD'}. Notes: ${c.notes || 'none'}`
      }
    }
    const userPrompt = [
      `Generate a ${template_type || 'photography services'} contract.`,
      `Photographer/business: ${businessName}.`,
      clientContext + '.',
      custom_instructions ? `Additional requirements and context from the photographer: ${custom_instructions}` : '',
      'Make the contract specific to these details, not generic.',
    ].filter(Boolean).join(' ')
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: 'You are a professional contract writer for photographers. Generate a complete, professional photography contract in clean plain text only. Do NOT use markdown formatting, asterisks, pound signs, or any special characters. Use ALL CAPS for section headers. Use plain dashes for lists. Write only the contract body — no preamble, no commentary, just the contract itself. Do NOT include any signature blocks, signature lines, acceptance sections, or "By signing below" language at the end — the platform handles signatures separately.',
      messages: [{ role: 'user', content: userPrompt }],
    })
    const rawContent = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    const content = rawContent
      .replace(/ACCEPTANCE AND SIGNATURES[\s\S]*$/gi, '')
      .replace(/By signing below[\s\S]*$/gi, '')
      .replace(/SIGNATURE[\s\S]{0,20}BLOCK[\s\S]*$/gi, '')
      .replace(/_{3,}[\s\S]{0,60}(Signature|Date|Name)[\s\S]{0,200}_{3,}/gi, '')
      .trim()
    res.json({ content })
  } catch (err) {
    console.error('🤖 AI contract error:', err.message, err.stack)
    res.status(500).json({ error: 'AI generation failed' })
  }
})

// ── CONTRACT TEMPLATES ────────────────────────────────────────

app.get('/api/contract-templates', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, content, created_at FROM contract_templates WHERE user_id=$1 ORDER BY created_at DESC',
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Get templates error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/contract-templates', requireAuth, async (req, res) => {
  const { name, content } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Template name is required.' })
  if (!content?.trim()) return res.status(400).json({ error: 'Template content is required.' })
  try {
    const result = await pool.query(
      'INSERT INTO contract_templates (user_id, name, content) VALUES ($1, $2, $3) RETURNING *',
      [req.userId, sanitize(name).slice(0, 80), content]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('Save template error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/contract-templates/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM contract_templates WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Template not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('Delete template error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── AI CHAT (legacy stub) ─────────────────────────────────────

app.post('/api/chat', requireAuth, async (req, res) => {
  res.status(501).json({ error: 'AI chat not yet implemented' })
})

// ── HEALTH ────────────────────────────────────────────────────

app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

app.get('/api/test-email', async (req, res) => {
  console.log('📧 Resend configured:', !!process.env.RESEND_API_KEY)
  if (!resend) return res.status(503).json({ error: 'Resend not configured — set RESEND_API_KEY', configured: false })
  try {
    const result = await resend.emails.send({
      from: 'PortalKit <hello@mail.getportalkit.com>',
      to: 'hello@mail.getportalkit.com',
      subject: 'PortalKit test email',
      html: '<p>Test email from PortalKit — email is working!</p>',
    })
    console.log('📧 Test email result:', result)
    res.json({ success: true, result })
  } catch (err) {
    console.error('📧 Test email failed:', err)
    res.status(500).json({ error: String(err), configured: true })
  }
})

app.post('/api/admin/test-reminders', async (req, res) => {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    await sendEventReminders()
    res.json({ success: true, message: 'Reminders triggered' })
  } catch (err) {
    console.error('Test reminders error:', err)
    res.status(500).json({ error: String(err) })
  }
})

async function startServer() {
  console.log('Starting server...')
  console.log('📧 Resend configured:', !!process.env.RESEND_API_KEY)
  console.log('🤖 Anthropic configured:', !!process.env.ANTHROPIC_API_KEY)
  await initDb()
  console.log('DB init complete, starting HTTP listener...')
  const server = app.listen(PORT, () => {
    console.log(`🚀 PortalKit server running on http://localhost:${PORT}`)
  })
  server.on('error', (err) => {
    console.error('Server error:', err)
  })
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err)
  })
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err)
  })
}

startServer().catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
