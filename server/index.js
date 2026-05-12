import express from 'express'
import pkg from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import Stripe from 'stripe'

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

const { Pool } = pkg
const app = express()
const PORT = process.env.PORT || 3001

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is required')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const JWT_SECRET = process.env.JWT_SECRET

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    process.env.FRONTEND_URL || 'https://getportalkit.com',
  ],
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

app.use('/api/auth/signin', authLimiter)
app.use('/api/auth/signup', authLimiter)
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
          full_name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          business_name TEXT,
          plan TEXT DEFAULT 'trial',
          trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          reset_password_token TEXT,
          reset_password_expires TIMESTAMPTZ,
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
      `)
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

function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET)
    req.userId = String(payload.userId)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ── AUTH ──────────────────────────────────────────────────────

app.post('/api/auth/signup', async (req, res) => {
  const { full_name, email, password, business_name } = req.body
  if (!full_name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' })
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()])
    if (exists.rows.length > 0) return res.status(409).json({ error: 'An account with this email already exists.' })
    const hashed = await bcrypt.hash(password, 12)
    const result = await pool.query(
      `INSERT INTO users (full_name, email, password, business_name)
       VALUES ($1,$2,$3,$4)
       RETURNING id, full_name, email, business_name, plan, trial_ends_at, created_at`,
      [sanitize(full_name), email.toLowerCase().trim(), hashed, sanitize(business_name) || null]
    )
    const user = result.rows[0]
    const token = jwt.sign({ userId: String(user.id) }, JWT_SECRET, { expiresIn: '7d' })
    res.status(201).json({ token, user })
  } catch (err) {
    console.error('Signup error:', err)
    res.status(500).json({ error: 'Server error. Please try again.' })
  }
})

app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' })
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, password, business_name, plan, trial_ends_at, stripe_customer_id, created_at FROM users WHERE email=$1',
      [email.toLowerCase().trim()]
    )
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password.' })
    const user = result.rows[0]
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' })
    const { password: _, ...safeUser } = user
    const token = jwt.sign({ userId: String(safeUser.id) }, JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: safeUser })
  } catch (err) {
    console.error('Signin error:', err)
    res.status(500).json({ error: 'Server error. Please try again.' })
  }
})

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, business_name, plan, trial_ends_at, stripe_customer_id, created_at FROM users WHERE id=$1',
      [req.userId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    res.json(result.rows[0])
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email required' })
  try {
    const result = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()])
    if (result.rows.length === 0) return res.json({ message: 'If that email exists, a reset link has been sent.' })
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2)
    const expires = new Date(Date.now() + 60 * 60 * 1000)
    await pool.query(
      'UPDATE users SET reset_password_token=$1, reset_password_expires=$2 WHERE email=$3',
      [token, expires, email.toLowerCase()]
    )
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`
    console.log(`Reset link for ${email}: ${resetLink}`)
    // TODO: send email via Resend
    res.json({ message: 'If that email exists, a reset link has been sent.' })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' })
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE reset_password_token=$1 AND reset_password_expires > NOW()',
      [token]
    )
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired reset token' })
    const hashed = await bcrypt.hash(password, 12)
    await pool.query(
      'UPDATE users SET password=$1, reset_password_token=NULL, reset_password_expires=NULL WHERE id=$2',
      [hashed, result.rows[0].id]
    )
    res.json({ message: 'Password updated successfully' })
  } catch (err) {
    console.error('Reset password error:', err)
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

// ── CLIENTS ───────────────────────────────────────────────────

app.get('/api/clients', requireAuth, async (req, res) => {
  // TODO: implement client list
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
  // TODO: implement client creation
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
  // TODO: implement single client fetch
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
  // TODO: implement client update
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
  // TODO: implement client deletion
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
  // TODO: implement contract list
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
  // TODO: implement contract creation
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
  // TODO: implement contract update
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
  // TODO: implement contract deletion
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
  // TODO: implement invoice list
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
  // TODO: implement invoice creation
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
  // TODO: implement invoice update
  const { status, paid_at } = req.body
  try {
    const result = await pool.query(
      `UPDATE invoices SET status=$1, paid_at=$2, updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *`,
      [status || 'draft', paid_at || null, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Invoice not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('Update invoice error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── FILES ─────────────────────────────────────────────────────

app.get('/api/files', requireAuth, async (req, res) => {
  // TODO: implement file list
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
  // TODO: implement file deletion (also delete from storage)
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
  // TODO: implement public client portal view
  try {
    const client = await pool.query(
      `SELECT c.id, c.name, c.event_date, c.event_type,
              u.full_name as photographer_name, u.business_name as photographer_business
       FROM clients c JOIN users u ON u.id = c.user_id
       WHERE c.portal_token=$1`,
      [req.params.token]
    )
    if (!client.rows.length) return res.status(404).json({ error: 'Portal not found' })
    res.json(client.rows[0])
  } catch (err) {
    console.error('Portal error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── AI CHAT ───────────────────────────────────────────────────

app.post('/api/chat', requireAuth, async (req, res) => {
  // TODO: implement AI assistant using Anthropic API
  res.status(501).json({ error: 'AI chat not yet implemented' })
})

// ── HEALTH ────────────────────────────────────────────────────

app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

initDb().then(() => {
  app.listen(PORT, () => console.log(`🚀 PortalKit server running on http://localhost:${PORT}`))
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
