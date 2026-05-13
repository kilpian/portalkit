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

const { Pool } = pkg
const app = express()
const PORT = process.env.PORT || 3001

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')
if (!process.env.CLERK_SECRET_KEY) throw new Error('CLERK_SECRET_KEY environment variable is required')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'https://getportalkit.com',
    'https://www.getportalkit.com',
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// Webhook must be before express.json() to get raw body
app.post('/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature']
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    let event
    try {
      if (webhookSecret && webhookSecret !== 'whsec_placeholder' && stripe) {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
      } else {
        event = JSON.parse(req.body.toString())
      }
    } catch (err) {
      console.error('Webhook error:', err.message)
      return res.status(400).json({ error: 'Webhook error' })
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
          await pool.query(
            'UPDATE users SET plan=$1, stripe_subscription_id=$2 WHERE stripe_customer_id=$3',
            ['active', sub.id, sub.customer]
          )
          break
        }
        case 'invoice.payment_succeeded': {
          const inv = event.data.object
          if (inv.billing_reason === 'subscription_create') {
            const userResult = await pool.query(
              'SELECT email, full_name FROM users WHERE stripe_customer_id=$1',
              [inv.customer]
            )
            const u = userResult.rows[0]
            if (u && resend) {
              try {
                await resend.emails.send({
                  from: 'PortalKit <hello@mail.getportalkit.com>',
                  to: u.email,
                  subject: 'Welcome to PortalKit!',
                  html: `
                    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
                      <h1 style="color:#1B4332;font-size:24px;margin-bottom:8px">Welcome to PortalKit, ${u.full_name.split(' ')[0]}!</h1>
                      <p style="color:#4B5563;font-size:15px;line-height:1.6">Your subscription is now active. You have unlimited access to create client portals, share contracts, and manage invoices.</p>
                      <a href="${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#1B4332;color:#FDFAF5;text-decoration:none;border-radius:8px;font-weight:600">Go to Dashboard →</a>
                      <p style="color:#9CA3AF;font-size:12px;margin-top:32px">PortalKit by Kilpian LLC</p>
                    </div>
                  `,
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
          console.warn(`Payment failed for customer ${inv.customer}: ${inv.id}`)
          break
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object
          await pool.query(
            'UPDATE users SET plan=$1 WHERE stripe_subscription_id=$2',
            ['free', sub.id]
          )
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
            from: 'hello@mail.getportalkit.com',
            to: email,
            subject: 'Welcome to PortalKit — you\'re all set 🎉',
            html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;"><h1 style="font-family:Georgia,serif;color:#1B4332;font-size:28px;margin-bottom:4px;">Portal<span style="color:#C9A84C">Kit</span></h1><h2 style="font-size:22px;color:#1A1208;margin-bottom:12px;">Welcome${firstName ? `, ${firstName}` : ''}!</h2><p style="color:#6B5E4A;margin-bottom:24px;">Your 14-day free trial has started. Here's how to get going:</p><ol style="color:#2D2416;line-height:2.2;padding-left:20px;margin-bottom:28px;"><li>Create your first client</li><li>Share their private portal link</li><li>Get paid faster</li></ol><a href="${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard" style="display:inline-block;padding:14px 28px;background:#1B4332;color:#FDFAF5;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">Go to Dashboard →</a><p style="margin-top:32px;color:#9C8E7A;font-size:13px;">Questions? Reply to this email — we read every one.</p></div>`,
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

app.use(express.json())

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}))

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

function sanitize(str) {
  if (!str) return ''
  return str.replace(/[<>"';()&+]/g, '').trim().slice(0, 500)
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

async function requireAuth(req, res, next) {
  console.log('🔐 requireAuth called for:', req.method, req.path)
  const authHeader = req.headers.authorization
  console.log('🔑 Authorization header:', authHeader ? 'present' : 'MISSING')

  try {
    const token = authHeader?.replace('Bearer ', '')
    if (!token) {
      console.log('❌ No token provided')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    console.log('✅ Token found, verifying with Clerk...')

    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    })

    console.log('✅ Token verified, clerk user ID:', payload.sub)

    const result = await pool.query(
      'SELECT * FROM users WHERE clerk_id = $1',
      [payload.sub]
    )

    if (result.rows.length === 0) {
      console.log('🆕 New user, creating in DB...')
      const clerkUser = await clerk.users.getUser(payload.sub)
      const email = clerkUser.emailAddresses[0]?.emailAddress
      const fullName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim()
        || email?.split('@')[0]
        || 'User'

      const newUser = await pool.query(
        `INSERT INTO users (clerk_id, email, full_name, plan, trial_ends_at)
         VALUES ($1, $2, $3, 'trial', NOW() + INTERVAL '14 days')
         ON CONFLICT (email) DO UPDATE SET clerk_id = $1
         RETURNING *`,
        [payload.sub, email, fullName]
      )
      req.user = newUser.rows[0]
      console.log('✅ New user created:', req.user.id)
    } else {
      req.user = result.rows[0]
      console.log('✅ Existing user found:', req.user.id)
    }

    req.userId = String(req.user.id)
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
  const { full_name, business_name, logo_url, brand_color } = req.body
  if (!full_name) return res.status(400).json({ error: 'Name is required.' })
  try {
    const result = await pool.query(
      `UPDATE users SET full_name=$1, business_name=$2, logo_url=$3, brand_color=$4
       WHERE id=$5
       RETURNING id, clerk_id, full_name, email, business_name, plan, trial_ends_at, stripe_customer_id, logo_url, brand_color, created_at`,
      [sanitize(full_name), sanitize(business_name) || null, logo_url || null, brand_color || null, req.userId]
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

// ── DASHBOARD ─────────────────────────────────────────────────

app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const [clients, invoices, user] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM clients WHERE user_id=$1', [req.userId]),
      pool.query("SELECT COUNT(*) FROM invoices WHERE user_id=$1 AND status != 'paid'", [req.userId]),
      pool.query('SELECT plan, trial_ends_at FROM users WHERE id=$1', [req.userId]),
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
      'SELECT id, name, email, phone, event_date, event_type, portal_token, created_at FROM clients WHERE user_id=$1 ORDER BY created_at DESC',
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
    const result = await pool.query(
      `INSERT INTO clients (user_id, name, email, phone, event_date, event_type, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [req.userId, sanitize(name), email || null, sanitize(phone) || null, event_date || null, sanitize(event_type) || null, sanitize(notes) || null]
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
  try {
    const result = await pool.query(
      `UPDATE clients SET name=$1, email=$2, phone=$3, event_date=$4, event_type=$5, notes=$6, updated_at=NOW()
       WHERE id=$7 AND user_id=$8 RETURNING *`,
      [sanitize(name), email || null, sanitize(phone) || null, event_date || null, sanitize(event_type) || null, sanitize(notes) || null, req.params.id, req.userId]
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
  const { title, content, status } = req.body
  try {
    const result = await pool.query(
      `UPDATE contracts SET title=$1, content=$2, status=$3, updated_at=NOW()
       WHERE id=$4 AND user_id=$5 RETURNING *`,
      [sanitize(title), content || null, status || 'draft', req.params.id, req.userId]
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
  const { status, paid_at, amount_cents, due_date, invoice_number, notes } = req.body
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
    res.json(result.rows[0])
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

    if (contract.client_email && resend) {
      const senderName = contract.business_name || contract.photographer_name || 'Your photographer'
      const portalUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${contract.portal_token}`
      console.log('📧 Sending contract email to:', contract.client_email)
      try {
        const emailResult = await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: contract.client_email,
          subject: `Contract ready to review: ${contract.title}`,
          html: `<p>Hi ${contract.client_name},</p><p>${senderName} has sent you a contract to review: <strong>${contract.title}</strong></p><p><a href="${portalUrl}">View your portal →</a></p>`,
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
      const dueStr = invoice.due_date ? `<p style="color:#6B5E4A">Due: ${new Date(invoice.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>` : ''
      console.log('📧 Sending invoice email to:', invoice.client_email)
      try {
        const emailResult = await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: invoice.client_email,
          subject: `Invoice from ${senderName} — ${amount}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px"><h2 style="color:#1B4332;margin-bottom:4px">Invoice from ${senderName}</h2><p style="font-size:32px;font-weight:700;color:#1A1208;margin:16px 0">${amount}</p>${invoice.invoice_number ? `<p style="color:#6B5E4A">Invoice #${invoice.invoice_number}</p>` : ''}${dueStr}<a href="${portalUrl}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#1B4332;color:#FDFAF5;border-radius:8px;text-decoration:none;font-weight:600">View portal to pay →</a></div>`,
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

const upload = multer({ dest: 'uploads/' })
app.use('/uploads', express.static('uploads'))

app.post('/api/files/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    const { client_id } = req.body
    if (!client_id) return res.status(400).json({ error: 'client_id required' })
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [client_id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const storageUrl = `/uploads/${req.file.filename}`
    const result = await pool.query(
      `INSERT INTO files (user_id, client_id, original_name, storage_url, size_bytes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.userId, client_id, req.file.originalname, storageUrl, req.file.size]
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
    res.json(result.rows)
  } catch (err) {
    console.error('Get files error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/files/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM files WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    console.error('Delete file error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CLIENT PORTAL (public) ────────────────────────────────────

app.get('/api/portals/:token', async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.id, c.name, c.event_date, c.event_type,
              u.full_name as photographer_name, u.business_name as photographer_business,
              u.logo_url as photographer_logo, u.brand_color as photographer_brand_color
       FROM clients c JOIN users u ON u.id = c.user_id
       WHERE c.portal_token=$1`,
      [req.params.token]
    )
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const client = clientResult.rows[0]

    const [contracts, invoices, files] = await Promise.all([
      pool.query(
        `SELECT id, title, status, signed_at FROM contracts WHERE client_id=$1 AND status != 'draft' ORDER BY created_at DESC`,
        [client.id]
      ),
      pool.query(
        `SELECT id, invoice_number, amount_cents, status, due_date FROM invoices WHERE client_id=$1 AND status != 'draft' ORDER BY created_at DESC`,
        [client.id]
      ),
      pool.query(
        `SELECT id, original_name, size_bytes, storage_url, created_at FROM files WHERE client_id=$1 ORDER BY created_at DESC`,
        [client.id]
      ),
    ])

    res.json({
      ...client,
      contracts: contracts.rows,
      invoices: invoices.rows,
      files: files.rows,
    })
  } catch (err) {
    console.error('Portal error:', err)
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
    if (client.email && resend) {
      const senderName = client.business_name || client.photographer_name || 'Your photographer'
      const portalUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${client.portal_token}`
      console.log('📧 Sending message notification to:', client.email)
      try {
        const emailResult = await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: client.email,
          subject: `New message from ${senderName}`,
          html: `<p>Hi ${client.name},</p><p>You have a new message from ${senderName}.</p><p><a href="${portalUrl}">View your portal to reply →</a></p>`,
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
      const displaySender = sender_name ? sanitize(sender_name) : client.name
      const dashUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/messages`
      console.log('📧 Sending client message notification to photographer:', client.photographer_email)
      try {
        const emailResult = await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          to: client.photographer_email,
          subject: `${displaySender} sent you a message`,
          html: `<p><strong>${displaySender}</strong> sent a message:</p><blockquote style="border-left:3px solid #C9A84C;padding-left:12px;color:#555">${sanitize(content)}</blockquote><p><a href="${dashUrl}">Reply in dashboard →</a></p>`,
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

app.post('/api/ai/suggest-message', requireAuth, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI not configured — set ANTHROPIC_API_KEY' })
  const now = Date.now()
  const timestamps = (aiRateLimit.get(req.userId) || []).filter(t => now - t < 3_600_000)
  if (timestamps.length >= 10) return res.status(429).json({ error: 'Rate limit: 10 AI suggestions per hour' })
  aiRateLimit.set(req.userId, [...timestamps, now])
  const { client_id, context } = req.body
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
      max_tokens: 200,
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

app.post('/api/ai/generate-contract', requireAuth, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI not configured — set ANTHROPIC_API_KEY' })
  const now = Date.now()
  const timestamps = (aiRateLimit.get(req.userId) || []).filter(t => now - t < 3_600_000)
  if (timestamps.length >= 10) return res.status(429).json({ error: 'Rate limit: 10 AI requests per hour' })
  aiRateLimit.set(req.userId, [...timestamps, now])
  const { client_id, template_type } = req.body
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
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: [{ type: 'text', text: 'You are a professional contract writer for photographers. Generate a complete, professional photography contract. Protect the photographer legally, keep it clear for clients. Write only the contract text — no preamble, no "here is your contract", just the contract itself.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Generate a ${template_type || 'photography services'} contract. Photographer/business: ${businessName}. ${clientContext}.` }],
    })
    const content = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    res.json({ content })
  } catch (err) {
    console.error('AI contract error:', err)
    res.status(500).json({ error: 'AI generation failed' })
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
