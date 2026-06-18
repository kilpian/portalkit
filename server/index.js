import express from 'express'
import pkg from 'pg'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
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
import { TwitterApi } from 'twitter-api-v2'
import path from 'path'
import os from 'os'
import { execSync, exec } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
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

const twitterClient = process.env.TWITTER_API_KEY
  ? new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    }).readWrite
  : null

if (twitterClient) {
  console.log('🐦 Twitter/X client configured')
} else {
  console.log('🐦 Twitter/X not configured - posts stored only')
}

// Video generation deps — loaded via dynamic import (ESM-compatible)
let createCanvas = null
let FontLibrary = null
let ffmpegPath = null
let ffmpeg = null
;(async () => {
  try {
    const skia = await import('skia-canvas')
    createCanvas = (w, h) => new skia.Canvas(w, h)
    FontLibrary = skia.FontLibrary
    console.log('🎬 skia-canvas loaded (Skia engine)')
  } catch (e) {
    console.log('🎬 skia-canvas not available:', e.message)
  }
  try {
    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg')
    ffmpegPath = ffmpegInstaller.default?.path || ffmpegInstaller.path
    const fluentMod = await import('fluent-ffmpeg')
    ffmpeg = fluentMod.default
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
    console.log('🎬 FFmpeg loaded')
  } catch (e) {
    console.log('🎬 FFmpeg not available:', e.message)
  }
})()

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
const PEXELS_API_KEY = process.env.PEXELS_API_KEY

const BREVO_API_KEY = process.env.BREVO_API_KEY

// Pre-loaded Kokoro TTS instance — initialized at startup to avoid 20-30s cold load per video
let kokoroTTS = null
async function initKokoro() {
  try {
    const { KokoroTTS } = await import('kokoro-js')
    console.log('🎬 Pre-loading Kokoro TTS...')
    kokoroTTS = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', { dtype: 'q8' })
    console.log('🎬 Kokoro TTS pre-loaded and ready')
  } catch (err) {
    console.log('🎬 Kokoro pre-load failed:', err.message)
    kokoroTTS = null
  }
}

async function sendBrevoEmail({ from, to, subject, html }) {
  if (!BREVO_API_KEY) {
    console.log('Brevo not configured')
    return null
  }

  // from format: "Name <email@domain.com>"
  const fromMatch = from.match(/^(.+?)\s*<(.+?)>$/)
  const senderName = fromMatch ? fromMatch[1].trim() : 'PortalKit'
  const senderEmail = fromMatch ? fromMatch[2].trim() : from

  const response = await fetch(
    'https://api.brevo.com/v3/smtp/email',
    {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: to }],
        replyTo: { email: senderEmail },
        subject,
        htmlContent: html
      })
    }
  )

  const data = await response.json()

  if (!response.ok) {
    console.error('Brevo error:', response.status, data)
    return null
  }

  console.log('Brevo sent:', data.messageId)
  return data
}

const { Pool } = pkg
const app = express()
const PORT = process.env.PORT || 3001

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')
if (!process.env.CLERK_SECRET_KEY) throw new Error('CLERK_SECRET_KEY environment variable is required')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret', 'x-gallery-password', 'x-clerk-auth-token'],
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
              'SELECT id, email, full_name, booking_username FROM users WHERE stripe_customer_id=$1',
              [inv.customer]
            )
            const u = userResult.rows[0]
            if (u && resend) {
              try {
                const firstName = u.full_name?.split(' ')[0] || 'there'
                const frontendUrl = process.env.FRONTEND_URL || 'https://getportalkit.com'
                const bookingUrl = u.booking_username ? `${frontendUrl}/book/${u.booking_username}` : `${frontendUrl}/dashboard/booking`
                await resend.emails.send({
                  from: 'Chidera at PortalKit <hello@mail.getportalkit.com>',
                  reply_to: "hello@getportalkit.com",
                  to: u.email,
                  subject: `You're in, ${firstName}! Here's how to get your first portal live →`,
                  html: emailTemplate({
                    title: "You're in — let's get your first portal live",
                    preheader: "3 things to do in your first 10 minutes with PortalKit.",
                    body: `<h2 style="font-size:22px;color:#1B4332;margin:0 0 8px;">Hey ${firstName}, welcome to PortalKit! 🎉</h2>
<p style="color:#6B5E4A;line-height:1.7;margin:0 0 20px;font-size:15px;">I'm Chidera, founder of PortalKit. Here are the 3 things that'll make the biggest difference in your first session:</p>

<div style="background:#F9F6F0;border-radius:10px;padding:20px;margin:0 0 20px;">
  <p style="margin:0 0 14px;font-size:14px;color:#2D2416;"><strong style="color:#1B4332;">Step 1 → Add your first client</strong><br>Go to Dashboard → Clients → New Client. Enter their name and email — that's it. PortalKit generates a private portal link instantly.</p>
  <p style="margin:0 0 14px;font-size:14px;color:#2D2416;"><strong style="color:#1B4332;">Step 2 → Share their portal link</strong><br>Copy the link and send it in an email or text. Your client can view their contract, pay invoices, and message you — no login required.</p>
  <p style="margin:0;font-size:14px;color:#2D2416;"><strong style="color:#1B4332;">Step 3 → Send their contract</strong><br>Inside the client's portal, click "Send Contract." Use a template or write your own — clients sign with a click, and you get an email notification.</p>
</div>

<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;font-size:14px;">Your booking page is also live at: <a href="${bookingUrl}" style="color:#1B4332;font-weight:600;">${bookingUrl}</a> — add it to your Instagram bio today.</p>
<p style="color:#9C8E7A;font-size:13px;margin:0;">Reply to this email anytime — I read every message personally.</p>
<p style="color:#9C8E7A;font-size:13px;margin:4px 0 0;">— Chidera</p>`,
                    ctaText: 'Go to your dashboard →',
                    ctaUrl: `${frontendUrl}/dashboard`,
                    footerNote: 'PortalKit by Kilpian LLC',
                  }),
                })
              } catch (emailErr) {
                console.error('Welcome email failed:', emailErr)
              }
            }

            // Handle referral conversion — if this user was referred, reward referrer
            if (u) {
              try {
                const referralRow = await pool.query(
                  `SELECT r.*, ref_user.email as referrer_email, ref_user.full_name as referrer_name, ref_user.stripe_subscription_id
                   FROM referrals r
                   JOIN users ref_user ON ref_user.id = r.referrer_user_id
                   WHERE r.referred_user_id = $1 AND r.status != 'converted'`,
                  [u.id]
                )
                if (referralRow.rows.length > 0) {
                  const ref = referralRow.rows[0]
                  await pool.query(
                    `UPDATE referrals SET status='converted', reward_given_at=NOW() WHERE id=$1`,
                    [ref.id]
                  )
                  // Extend referrer's subscription by 30 days
                  if (stripe && ref.stripe_subscription_id) {
                    try {
                      const sub = await stripe.subscriptions.retrieve(ref.stripe_subscription_id)
                      const currentPeriodEnd = sub.current_period_end
                      await stripe.subscriptions.update(ref.stripe_subscription_id, {
                        trial_end: currentPeriodEnd + (30 * 24 * 60 * 60),
                      })
                    } catch (stripeErr) {
                      console.error('Referral subscription extend failed:', stripeErr.message)
                    }
                  }
                  // Send referrer a "you earned a free month" email
                  if (resend && ref.referrer_email) {
                    const refFirstName = ref.referrer_name?.split(' ')[0] || 'there'
                    await resend.emails.send({
                      from: 'Chidera at PortalKit <hello@mail.getportalkit.com>',
                      reply_to: "hello@getportalkit.com",
                      to: ref.referrer_email,
                      subject: "You just earned a free month of PortalKit! 🎉",
                      html: emailTemplate({
                        title: "You earned a free month!",
                        preheader: "Someone you referred just subscribed to PortalKit.",
                        body: `<h2 style="font-size:22px;color:#1B4332;margin:0 0 12px;">You earned a free month, ${refFirstName}! 🎉</h2>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">A photographer you referred just subscribed to PortalKit. As a thank-you, we've added <strong>30 free days</strong> to your subscription — no charge, no action needed.</p>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Keep sharing your referral link to earn more free months. You'll get one free month for every photographer who subscribes.</p>
<p style="color:#9C8E7A;font-size:13px;margin:0;">— Chidera at PortalKit</p>`,
                        ctaText: 'Share your referral link →',
                        ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/settings`,
                        footerNote: 'PortalKit by Kilpian LLC',
                      }),
                    }).catch(err => console.error('Referral reward email failed:', err))
                  }
                  console.log(`🎁 Referral converted: referrer ${ref.referrer_email} earned a free month`)
                }
              } catch (refErr) {
                console.error('Referral conversion error:', refErr.message)
              }
            }

            // Handle affiliate commission on first subscription payment
            if (u) {
              try {
                const affRow = await pool.query(
                  'SELECT a.id, a.commission_percent FROM affiliates a JOIN users usr ON usr.affiliate_id=a.id WHERE usr.id=$1',
                  [u.id]
                )
                if (affRow.rows.length > 0) {
                  const aff = affRow.rows[0]
                  const amountCents = inv.amount_paid || 0
                  const commissionCents = Math.round(amountCents * aff.commission_percent / 100)
                  await pool.query(
                    `INSERT INTO affiliate_conversions (affiliate_id, user_id, amount_cents, commission_cents)
                     VALUES ($1, $2, $3, $4)`,
                    [aff.id, u.id, amountCents, commissionCents]
                  )
                  await pool.query(
                    'UPDATE affiliates SET total_earned_cents=total_earned_cents+$1 WHERE id=$2',
                    [commissionCents, aff.id]
                  )
                  console.log(`💸 Affiliate commission: ${commissionCents}¢ for affiliate ${aff.id}`)
                }
              } catch (affErr) {
                console.error('Affiliate commission error:', affErr.message)
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
                  reply_to: "hello@getportalkit.com",
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
                reply_to: "hello@getportalkit.com",
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

            const clientEmail = pi.metadata?.client_email
            if (clientEmail && resend) {
              try {
                const amountStr = (pi.amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                const photographerName = pi.metadata?.photographer_name || 'Your photographer'
                const invoiceRef = pi.metadata?.invoice_number ? `Invoice #${pi.metadata.invoice_number}` : 'Photography services'
                const portalToken = pi.metadata?.portal_token
                const portalUrl = portalToken
                  ? `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${portalToken}`
                  : 'https://getportalkit.com'
                await resend.emails.send({
                  from: 'PortalKit <hello@mail.getportalkit.com>',
                  reply_to: "hello@getportalkit.com",
                  to: clientEmail,
                  subject: `Payment receipt — ${amountStr}`,
                  html: emailTemplate({
                    title: 'Payment Receipt',
                    preheader: `Your ${amountStr} payment to ${photographerName} was successful.`,
                    body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Payment received ✓</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Thank you — your payment was successful. Here are the details for your records:</p><table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;font-size:14px;color:#2D2416;"><tr><td style="padding:6px 0;color:#9C8E7A;">Amount paid</td><td style="padding:6px 0;text-align:right;font-weight:700;">${amountStr}</td></tr><tr><td style="padding:6px 0;color:#9C8E7A;">Paid to</td><td style="padding:6px 0;text-align:right;">${photographerName}</td></tr><tr><td style="padding:6px 0;color:#9C8E7A;">Reference</td><td style="padding:6px 0;text-align:right;">${invoiceRef}</td></tr></table><p style="color:#9C8E7A;font-size:13px;margin:0;">This receipt confirms your payment. No further action is needed.</p>`,
                    ctaText: 'View your portal →',
                    ctaUrl: portalUrl,
                    footerNote: 'PortalKit by Kilpian LLC',
                  }),
                })
                console.log(`📧 Payment receipt sent to ${clientEmail}`)
              } catch (emailErr) {
                console.error('Receipt email failed:', emailErr)
              }
            }
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
      // FIX 3: Welcome email is sent once on payment success (invoice.payment_succeeded),
      // NOT here at user creation — that fired a second email alongside Clerk's own
      // verification email. user.created is acknowledged with no email.
      res.json({ received: true })
    } catch (err) {
      console.error('Clerk webhook handler error:', err)
      res.status(500).json({ error: 'Webhook handler failed' })
    }
  }
)

app.use(compression())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    if (!res.headersSent) res.status(408).json({ error: 'Request timeout' })
  })
  next()
})

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}))

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
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

function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_{1,2}(.*?)_{1,2}/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*>{1,}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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
        ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly';
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

      // Trial-expiry reminders are account-level (no client), so client_id must be nullable
      await pool.query(`
        ALTER TABLE reminders_sent ALTER COLUMN client_id DROP NOT NULL;
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

      // ── Feature: CRM Pipeline ─────────────────────────────────
      await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'inquiry';`).catch(() => {})
      await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ DEFAULT NOW();`).catch(() => {})
      await pool.query(`
        DO $$ BEGIN
          ALTER TABLE clients ADD CONSTRAINT clients_stage_check
            CHECK (stage IN ('inquiry','consultation','booked','in_progress','delivered','archived'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `).catch(() => {})

      // ── Feature: Questionnaires ───────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS questionnaire_templates (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          questions JSONB NOT NULL DEFAULT '[]',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS questionnaire_responses (
          id SERIAL PRIMARY KEY,
          template_id INTEGER REFERENCES questionnaire_templates(id) ON DELETE SET NULL,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          questions JSONB NOT NULL DEFAULT '[]',
          responses JSONB NOT NULL DEFAULT '{}',
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed')),
          sent_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      // ── Feature: Booking/Scheduling ───────────────────────────
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS booking_username TEXT;`).catch(() => {})
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_booking_username_unique ON users (booking_username) WHERE booking_username IS NOT NULL;`).catch(() => {})
      await pool.query(`
        UPDATE users SET booking_username = LOWER(REGEXP_REPLACE(COALESCE(business_name, SPLIT_PART(email, '@', 1)), '[^a-zA-Z0-9]', '', 'g')) || id::text
        WHERE booking_username IS NULL;
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS session_types (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL DEFAULT 60,
          price_cents INTEGER DEFAULT 0,
          description TEXT,
          active BOOLEAN DEFAULT TRUE,
          color TEXT DEFAULT '#1B4332'
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS availability_slots (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          active BOOLEAN DEFAULT TRUE
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS bookings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
          session_type_id INTEGER REFERENCES session_types(id) ON DELETE SET NULL,
          booking_date DATE NOT NULL,
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          client_name TEXT NOT NULL,
          client_email TEXT NOT NULL,
          client_phone TEXT,
          notes TEXT,
          status TEXT DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled')),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      // ── Feature: Automated Workflows ──────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workflow_settings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
          send_welcome_on_client_create BOOLEAN DEFAULT FALSE,
          send_contract_reminder_3_days BOOLEAN DEFAULT TRUE,
          send_balance_reminder_7_days BOOLEAN DEFAULT TRUE,
          send_questionnaire_on_booking BOOLEAN DEFAULT FALSE,
          send_thank_you_on_delivery BOOLEAN DEFAULT TRUE,
          welcome_message TEXT,
          thank_you_message TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      // ── Feature: Gallery URL on clients ───────────────────────
      await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS gallery_url TEXT`).catch(() => {})

      // ── Feature: Secondary contact on clients ─────────────────
      await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_name TEXT`).catch(() => {})
      await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_email TEXT`).catch(() => {})
      await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS secondary_phone TEXT`).catch(() => {})

      // ── Feature: Lead Capture Forms ───────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lead_forms (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
          headline TEXT DEFAULT 'Book a Session',
          subheadline TEXT DEFAULT 'Fill out the form below and I''ll be in touch soon.',
          fields JSONB DEFAULT '["name","email","phone","event_type","event_date","message"]',
          brand_color TEXT DEFAULT '#1B4332',
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS lead_submissions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          event_type TEXT,
          event_date DATE,
          message TEXT,
          source TEXT DEFAULT 'embed',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'inquiry';`).catch(() => {})
      await pool.query(`ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;`).catch(() => {})

      // ── Feature: Payment Links ────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payment_links (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          amount_cents INTEGER,
          allow_custom_amount BOOLEAN DEFAULT FALSE,
          min_amount_cents INTEGER DEFAULT 100,
          link_type TEXT DEFAULT 'fixed' CHECK (link_type IN ('fixed','tip','custom')),
          active BOOLEAN DEFAULT TRUE,
          total_collected_cents INTEGER DEFAULT 0,
          transaction_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS payment_link_transactions (
          id SERIAL PRIMARY KEY,
          payment_link_id INTEGER NOT NULL REFERENCES payment_links(id) ON DELETE CASCADE,
          payer_name TEXT,
          payer_email TEXT,
          amount_cents INTEGER NOT NULL,
          stripe_payment_intent_id TEXT,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      // ── Feature: Shot Lists ───────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS shot_lists (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          shots JSONB DEFAULT '[]',
          client_notes TEXT,
          photographer_notes TEXT,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending','submitted','confirmed')),
          submitted_at TIMESTAMPTZ,
          confirmed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      // ── Feature: Vendors ──────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS vendors (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          name TEXT NOT NULL,
          contact_name TEXT,
          phone TEXT,
          email TEXT,
          website TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      // ── Feature: Day-of Timelines ─────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS timelines (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT DEFAULT 'Day-of Timeline',
          items JSONB DEFAULT '[]',
          status TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','approved')),
          client_approved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      // ── Feature: Review Request (workflow_settings columns) ────
      await pool.query(`ALTER TABLE workflow_settings ADD COLUMN IF NOT EXISTS google_review_url TEXT`).catch(() => {})
      await pool.query(`ALTER TABLE workflow_settings ADD COLUMN IF NOT EXISTS wedding_wire_url TEXT`).catch(() => {})
      await pool.query(`ALTER TABLE workflow_settings ADD COLUMN IF NOT EXISTS the_knot_url TEXT`).catch(() => {})
      await pool.query(`ALTER TABLE workflow_settings ADD COLUMN IF NOT EXISTS facebook_review_url TEXT`).catch(() => {})
      await pool.query(`ALTER TABLE workflow_settings ADD COLUMN IF NOT EXISTS send_review_request_on_delivery BOOLEAN DEFAULT TRUE`).catch(() => {})

      // ── Feature: Packages & Proposals ────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS packages (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          price_cents INTEGER NOT NULL DEFAULT 0,
          deposit_cents INTEGER DEFAULT 0,
          features JSONB DEFAULT '[]',
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposals (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          message TEXT,
          packages JSONB DEFAULT '[]',
          selected_package_id INTEGER,
          status TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','accepted','expired')),
          expires_at TIMESTAMPTZ,
          viewed_at TIMESTAMPTZ,
          accepted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS total_clients_created INTEGER DEFAULT 0
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS cancellations (
          id SERIAL PRIMARY KEY,
          user_id INTEGER,
          email TEXT,
          business_name TEXT,
          plan TEXT,
          reason TEXT,
          comment TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `).catch(() => {})

      // ── Feature: Gallery Delivery System ─────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS galleries (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          name TEXT NOT NULL DEFAULT 'Wedding Gallery',
          description TEXT,
          status TEXT DEFAULT 'hidden' CHECK (status IN ('hidden','preview','delivered')),
          password TEXT,
          password_protected BOOLEAN DEFAULT FALSE,
          allow_downloads BOOLEAN DEFAULT TRUE,
          allow_favorites BOOLEAN DEFAULT TRUE,
          cover_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
          delivered_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS gallery_id INTEGER REFERENCES galleries(id) ON DELETE SET NULL;`).catch(() => {})
      await pool.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;`).catch(() => {})
      await pool.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS caption TEXT;`).catch(() => {})
      await pool.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;`).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS gallery_favorites (
          id SERIAL PRIMARY KEY,
          gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
          file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          client_token TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(gallery_id, file_id, client_token)
        );
      `).catch(() => {})

      // ── Feature: Onboarding Email Sequence ───────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS onboarding_emails_sent (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email_type TEXT NOT NULL,
          sent_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(user_id, email_type)
        );
      `).catch(() => {})

      // ── Feature: Referral System ──────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS referrals (
          id SERIAL PRIMARY KEY,
          referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          referred_email TEXT NOT NULL,
          referred_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending','signed_up','converted')),
          reward_given_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE`).catch(() => {})
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_id INTEGER`).catch(() => {})

      // ── Feature: Affiliate System ─────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS affiliates (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          affiliate_code TEXT NOT NULL UNIQUE,
          commission_percent INTEGER DEFAULT 20,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending','active','paused')),
          total_referrals INTEGER DEFAULT 0,
          total_earned_cents INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS affiliate_conversions (
          id SERIAL PRIMARY KEY,
          affiliate_id INTEGER REFERENCES affiliates(id),
          user_id INTEGER REFERENCES users(id),
          amount_cents INTEGER NOT NULL,
          commission_cents INTEGER NOT NULL,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      // Backfill referral codes for existing users without one
      await pool.query(`
        UPDATE users SET referral_code = 'PK' || UPPER(SUBSTRING(MD5(id::text || email), 1, 6))
        WHERE referral_code IS NULL
      `).catch(() => {})

      // Performance indexes for common lookups
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
        CREATE INDEX IF NOT EXISTS idx_contracts_user_id ON contracts(user_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
        CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id);
        CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
        CREATE INDEX IF NOT EXISTS idx_files_client_id ON files(client_id);
        CREATE INDEX IF NOT EXISTS idx_clients_portal_token ON clients(portal_token);
        CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);
        CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
        CREATE INDEX IF NOT EXISTS idx_users_booking_username ON users(booking_username);
        CREATE INDEX IF NOT EXISTS idx_files_gallery_id ON files(gallery_id);
        CREATE INDEX IF NOT EXISTS idx_galleries_client_id ON galleries(client_id);
        CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
        CREATE INDEX IF NOT EXISTS idx_reminders_sent_client_id ON reminders_sent(client_id);
        CREATE INDEX IF NOT EXISTS idx_gallery_favorites_gallery_id ON gallery_favorites(gallery_id);
        CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
        CREATE INDEX IF NOT EXISTS idx_proposals_user_id ON proposals(user_id);
        CREATE INDEX IF NOT EXISTS idx_contracts_client_id ON contracts(client_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
      `).catch(err => console.error('Index creation warning:', err.message))

      await pool.query(`
        CREATE TABLE IF NOT EXISTS generated_content (
          id SERIAL PRIMARY KEY,
          content TEXT NOT NULL,
          twitter_content TEXT,
          angle TEXT,
          day_number INTEGER,
          week_start DATE,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending','posted','skipped')),
          scheduled_for TIMESTAMPTZ,
          postproxy_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS tool_leads (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          tool TEXT,
          source TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `)
      console.log('✅ tool_leads table ready')

      await pool.query(`
        CREATE TABLE IF NOT EXISTS tool_lead_nurture (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          email_type TEXT NOT NULL,
          sent_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(email, email_type)
        );
      `)
      console.log('✅ tool_lead_nurture table ready')

      // ── Feature: Cold Outreach Engine ────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cold_contacts (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          first_name TEXT,
          business_name TEXT,
          note TEXT,
          status TEXT DEFAULT 'queued'
            CHECK (status IN ('queued','sent','replied','opted_out','bounced')),
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS cold_suppression (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          reason TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `).catch(() => {})

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_cold_contacts_status
          ON cold_contacts(status);
      `).catch(() => {})

      await pool.query(`
        CREATE TABLE IF NOT EXISTS generated_videos (
          id SERIAL PRIMARY KEY,
          post_id INTEGER REFERENCES generated_content(id),
          title TEXT,
          script TEXT,
          status TEXT DEFAULT 'queued',
          r2_url TEXT,
          error TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        );
      `).catch(() => {})

      await pool.query(`ALTER TABLE generated_videos ADD COLUMN IF NOT EXISTS video_type TEXT DEFAULT 'pexels'`).catch(() => {})

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
            reply_to: "hello@getportalkit.com",
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
            reply_to: "hello@getportalkit.com",
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

  // ── Contract unsigned reminder (3 days after sending) ────────
  try {
    const unsignedContracts = await pool.query(`
      SELECT ct.id, ct.client_id, ct.user_id, ct.title,
             c.email, c.name as client_name, c.portal_token,
             u.business_name, u.full_name as photographer_name
      FROM contracts ct
      JOIN clients c ON ct.client_id = c.id
      JOIN users u ON ct.user_id = u.id
      LEFT JOIN workflow_settings ws ON ws.user_id = ct.user_id
      WHERE ct.status = 'sent'
        AND ct.created_at < NOW() - INTERVAL '3 days'
        AND c.email IS NOT NULL
        AND COALESCE(ws.send_contract_reminder_3_days, TRUE)
        AND NOT EXISTS (
          SELECT 1 FROM reminders_sent rs
          WHERE rs.client_id = c.id AND rs.reminder_type = 'contract_3day_' || ct.id
        )
    `)
    for (const row of unsignedContracts.rows) {
      try {
        const biz = row.business_name || row.photographer_name
        const portalLink = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${row.portal_token}`
        if (resend) {
          await resend.emails.send({
            from: 'PortalKit <hello@mail.getportalkit.com>',
            reply_to: "hello@getportalkit.com",
            to: row.email,
            subject: `Reminder: Please sign your contract — ${biz}`,
            html: emailTemplate({
              title: 'Please sign your contract',
              preheader: 'Your contract is waiting for your signature',
              body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Reminder: Your contract needs your signature</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Hi ${row.client_name}, ${biz} sent you a contract titled "<strong>${row.title}</strong>" that still needs your signature. Please review and sign it at your earliest convenience.</p>`,
              ctaText: 'Sign Your Contract →',
              ctaUrl: portalLink,
              footerNote: `Sent by ${biz} via PortalKit`,
            }),
          })
        }
        await pool.query('INSERT INTO reminders_sent (client_id, reminder_type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.client_id, `contract_3day_${row.id}`])
        console.log(`📋 Contract reminder sent to ${row.email}`)
      } catch (e) { console.error('Contract reminder email failed:', e.message) }
    }
  } catch (err) { console.error('Contract reminder error:', err.message) }

  // ── Balance due reminder (7 days before event) ────────────────
  try {
    const balanceDue = await pool.query(`
      SELECT inv.id, inv.client_id, inv.amount_cents,
             c.email, c.name as client_name, c.portal_token, c.event_date,
             u.business_name, u.full_name as photographer_name
      FROM invoices inv
      JOIN clients c ON inv.client_id = c.id
      JOIN users u ON inv.user_id = u.id
      LEFT JOIN workflow_settings ws ON ws.user_id = inv.user_id
      WHERE inv.status = 'sent'
        AND c.event_date = CURRENT_DATE + 7
        AND c.email IS NOT NULL
        AND COALESCE(ws.send_balance_reminder_7_days, TRUE)
        AND NOT EXISTS (
          SELECT 1 FROM reminders_sent rs
          WHERE rs.client_id = c.id AND rs.reminder_type = 'balance_7day_' || inv.id
        )
    `)
    for (const row of balanceDue.rows) {
      try {
        const biz = row.business_name || row.photographer_name
        const portalLink = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${row.portal_token}`
        const amount = `$${(row.amount_cents / 100).toFixed(2)}`
        if (resend) {
          await resend.emails.send({
            from: 'PortalKit <hello@mail.getportalkit.com>',
            reply_to: "hello@getportalkit.com",
            to: row.email,
            subject: `Balance due reminder — ${biz}`,
            html: emailTemplate({
              title: 'Your balance is due soon',
              preheader: 'Your event is 7 days away — please settle your balance',
              body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Your balance is due soon</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Hi ${row.client_name}, your event with ${biz} is 7 days away. You have an outstanding balance of <strong>${amount}</strong>. Please visit your portal to pay your invoice before the event.</p>`,
              ctaText: 'View Your Invoice →',
              ctaUrl: portalLink,
              footerNote: `Sent by ${biz} via PortalKit`,
            }),
          })
        }
        await pool.query('INSERT INTO reminders_sent (client_id, reminder_type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.client_id, `balance_7day_${row.id}`])
        console.log(`💰 Balance reminder sent to ${row.email}`)
      } catch (e) { console.error('Balance reminder email failed:', e.message) }
    }
  } catch (err) { console.error('Balance reminder error:', err.message) }
}

async function sendTrialExpiryReminders() {
  if (!resend) return
  try {
    // 3 days before trial ends
    const threeDayWarning = await pool.query(`
      SELECT u.* FROM users u
      WHERE u.plan = 'trial'
      AND DATE(u.trial_ends_at) = CURRENT_DATE + 3
      AND NOT EXISTS (
        SELECT 1 FROM reminders_sent rs
        WHERE rs.client_id IS NULL
        AND rs.reminder_type = 'trial_3day_' || u.id::text
      )
    `)

    for (const user of threeDayWarning.rows) {
      const firstName = user.full_name?.split(' ')[0] || 'there'
      const trialEndDate = new Date(user.trial_ends_at)
        .toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric'
        })
      const manageUrl = (process.env.FRONTEND_URL || 'https://getportalkit.com') +
        '/dashboard/settings'

      await resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: user.email,
        subject: 'Your PortalKit trial ends in 3 days',
        html: emailTemplate({
          title: 'Your trial ends in 3 days',
          preheader: 'Your free trial ends on ' + trialEndDate,
          body: `
            <h2 style="margin:0 0 16px;font-size:22px;
              font-weight:700;color:#1B4332;">
              Hi ${firstName} — your trial ends ${trialEndDate}
            </h2>
            <p style="margin:0 0 16px;color:#6B7280;font-size:15px;">
              Your 14-day free trial of PortalKit ends on
              <strong>${trialEndDate}</strong>. After that,
              your account will be charged $39/month
              (or $29/month if you're on annual).
            </p>
            <p style="margin:0 0 16px;color:#6B7280;font-size:15px;">
              If you'd like to cancel before being charged,
              you can do so anytime from your account settings.
            </p>
            <p style="margin:0 0 16px;color:#6B7280;font-size:15px;">
              If you're enjoying PortalKit, no action needed —
              your subscription continues automatically.
            </p>
          `,
          ctaText: 'Manage Your Subscription →',
          ctaUrl: manageUrl,
          footerNote: 'You are receiving this because you signed up for a PortalKit trial. Cancel anytime at ' + manageUrl
        })
      })

      // Record that we sent this
      await pool.query(
        `INSERT INTO reminders_sent (client_id, reminder_type)
         VALUES (NULL, $1) ON CONFLICT DO NOTHING`,
        ['trial_3day_' + user.id]
      )
      console.log('📧 Trial 3-day warning sent to:', user.email)
    }

    // 1 day before trial ends
    const oneDayWarning = await pool.query(`
      SELECT u.* FROM users u
      WHERE u.plan = 'trial'
      AND DATE(u.trial_ends_at) = CURRENT_DATE + 1
      AND NOT EXISTS (
        SELECT 1 FROM reminders_sent rs
        WHERE rs.client_id IS NULL
        AND rs.reminder_type = 'trial_1day_' || u.id::text
      )
    `)

    for (const user of oneDayWarning.rows) {
      const firstName = user.full_name?.split(' ')[0] || 'there'
      const trialEndDate = new Date(user.trial_ends_at)
        .toLocaleDateString('en-US', {
          month: 'long', day: 'numeric'
        })
      const manageUrl = (process.env.FRONTEND_URL || 'https://getportalkit.com') +
        '/dashboard/settings'

      await resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: user.email,
        subject: '⚠️ Your PortalKit trial ends tomorrow',
        html: emailTemplate({
          title: 'Trial ends tomorrow',
          preheader: 'Last chance to cancel before ' + trialEndDate,
          body: `
            <h2 style="margin:0 0 16px;font-size:22px;
              font-weight:700;color:#1B4332;">
              Hi ${firstName} — last reminder
            </h2>
            <p style="margin:0 0 16px;color:#6B7280;font-size:15px;">
              Your PortalKit trial ends <strong>tomorrow,
              ${trialEndDate}</strong>. Your card on file will
              be charged automatically to continue your
              subscription.
            </p>
            <p style="margin:0 0 16px;color:#6B7280;font-size:15px;">
              <strong>To cancel:</strong> Go to Dashboard →
              Settings → Subscription → Cancel before midnight
              tomorrow.
            </p>
            <p style="margin:0 0 16px;color:#6B7280;font-size:15px;">
              Questions? Reply to this email — we read every one.
            </p>
          `,
          ctaText: 'Manage Subscription →',
          ctaUrl: manageUrl,
          footerNote: 'You are receiving this because you signed up for a PortalKit trial. Cancel anytime at ' + manageUrl
        })
      })

      await pool.query(
        `INSERT INTO reminders_sent (client_id, reminder_type)
         VALUES (NULL, $1) ON CONFLICT DO NOTHING`,
        ['trial_1day_' + user.id]
      )
      console.log('📧 Trial 1-day warning sent to:', user.email)
    }

  } catch (err) {
    console.error('Trial reminder error:', err.message)
  }
}

async function sendOnboardingSequence() {
  if (!resend) return
  const frontendUrl = process.env.FRONTEND_URL || 'https://getportalkit.com'
  try {
    // Day 2: nudge to add first client (or push contracts if they already have clients)
    const day2Users = await pool.query(`
      SELECT u.* FROM users u
      WHERE u.plan = 'trial'
      AND DATE(u.created_at) = CURRENT_DATE - 2
      AND NOT EXISTS (
        SELECT 1 FROM onboarding_emails_sent oes
        WHERE oes.user_id = u.id AND oes.email_type = 'onboarding_day2'
      )
    `)
    for (const u of day2Users.rows) {
      try {
        const firstName = u.full_name?.split(' ')[0] || 'there'
        const clientCount = await pool.query('SELECT COUNT(*) as count FROM clients WHERE user_id=$1', [u.id])
        const hasClients = parseInt(clientCount.rows[0].count, 10) > 0
        const body = hasClients
          ? `<h2 style="font-size:20px;color:#1B4332;margin:0 0 12px;">Great start, ${firstName}!</h2>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">You've already added your first client — that's the hardest part. Now it's time to send contracts. PortalKit lets you send a professional contract in seconds, and clients sign with a single click from their portal.</p>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Head to your client's portal and click "Send Contract" to get started.</p>`
          : `<h2 style="font-size:20px;color:#1B4332;margin:0 0 12px;">Hey ${firstName} — have you added your first client yet?</h2>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Adding a client takes 30 seconds. Enter their name and email, and PortalKit generates a private portal link you can send right now.</p>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Your clients don't need to create an account — they just click the link and see everything in one place.</p>`
        await resend.emails.send({
          from: 'Chidera at PortalKit <hello@mail.getportalkit.com>',
          reply_to: "hello@getportalkit.com",
          to: u.email,
          subject: hasClients ? 'Time to send your first contract →' : 'Have you added your first client yet?',
          html: emailTemplate({
            title: hasClients ? 'Send your first contract' : 'Add your first client',
            preheader: hasClients ? 'Contracts sent from PortalKit get signed 3x faster.' : 'It takes 30 seconds.',
            body,
            ctaText: 'Go to your dashboard →',
            ctaUrl: `${frontendUrl}/dashboard/clients`,
            footerNote: 'PortalKit by Kilpian LLC',
          }),
        })
        await pool.query(
          `INSERT INTO onboarding_emails_sent (user_id, email_type) VALUES ($1, 'onboarding_day2') ON CONFLICT DO NOTHING`,
          [u.id]
        )
        console.log(`📧 Onboarding Day 2 sent to ${u.email}`)
      } catch (e) { console.error('Onboarding Day 2 email failed:', e.message) }
    }

    // Day 5: your booking page is live
    const day5Users = await pool.query(`
      SELECT u.* FROM users u
      WHERE u.plan = 'trial'
      AND DATE(u.created_at) = CURRENT_DATE - 5
      AND NOT EXISTS (
        SELECT 1 FROM onboarding_emails_sent oes
        WHERE oes.user_id = u.id AND oes.email_type = 'onboarding_day5'
      )
    `)
    for (const u of day5Users.rows) {
      try {
        const firstName = u.full_name?.split(' ')[0] || 'there'
        const bookingUrl = u.booking_username ? `${frontendUrl}/book/${u.booking_username}` : `${frontendUrl}/dashboard/booking`
        await resend.emails.send({
          from: 'Chidera at PortalKit <hello@mail.getportalkit.com>',
          reply_to: "hello@getportalkit.com",
          to: u.email,
          subject: 'Your booking page is live (add it to your Instagram bio) →',
          html: emailTemplate({
            title: 'Your booking page is live',
            preheader: 'Clients can request sessions directly — no back-and-forth.',
            body: `<h2 style="font-size:20px;color:#1B4332;margin:0 0 12px;">Hey ${firstName}, your booking page is already live!</h2>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">PortalKit automatically created a public booking page for you at:</p>
<p style="background:#F0F9F4;border:1px solid #BEE3CA;border-radius:8px;padding:10px 14px;font-family:monospace;font-size:14px;color:#1B4332;margin:0 0 16px;"><a href="${bookingUrl}" style="color:#1B4332;text-decoration:none;">${bookingUrl}</a></p>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;"><strong>Pro tip:</strong> Add this link to your Instagram bio right now. When someone taps it, they can request a session, pick a time, and you get notified instantly — no email tag.</p>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">You can customize your session types, pricing, and availability from Dashboard → Booking.</p>`,
            ctaText: 'Set up your booking page →',
            ctaUrl: `${frontendUrl}/dashboard/booking`,
            footerNote: 'PortalKit by Kilpian LLC',
          }),
        })
        await pool.query(
          `INSERT INTO onboarding_emails_sent (user_id, email_type) VALUES ($1, 'onboarding_day5') ON CONFLICT DO NOTHING`,
          [u.id]
        )
        console.log(`📧 Onboarding Day 5 sent to ${u.email}`)
      } catch (e) { console.error('Onboarding Day 5 email failed:', e.message) }
    }

    // Day 10: feature spotlight — 4 days left in trial
    const day10Users = await pool.query(`
      SELECT u.* FROM users u
      WHERE u.plan = 'trial'
      AND DATE(u.created_at) = CURRENT_DATE - 10
      AND NOT EXISTS (
        SELECT 1 FROM onboarding_emails_sent oes
        WHERE oes.user_id = u.id AND oes.email_type = 'onboarding_day10'
      )
    `)
    for (const u of day10Users.rows) {
      try {
        const firstName = u.full_name?.split(' ')[0] || 'there'
        await resend.emails.send({
          from: 'Chidera at PortalKit <hello@mail.getportalkit.com>',
          reply_to: "hello@getportalkit.com",
          to: u.email,
          subject: '4 days left — 3 features that save you the most time',
          html: emailTemplate({
            title: '3 features worth trying before your trial ends',
            preheader: 'Shot lists, timelines, and review requests — your clients will notice.',
            body: `<h2 style="font-size:20px;color:#1B4332;margin:0 0 12px;">Hey ${firstName}, 4 days left on your trial</h2>
<p style="color:#6B5E4A;line-height:1.6;margin:0 0 20px;">Before your trial ends, here are 3 features that save photographers the most time:</p>
<div style="background:#F9F6F0;border-radius:10px;padding:16px 20px;margin:0 0 12px;">
  <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1B4332;">📷 Shot List Builder</p>
  <p style="margin:0;font-size:13px;color:#6B5E4A;line-height:1.6;">Build a shot list and send it to your client. They confirm what they want, you review it, and both sides know exactly what's planned. Find it under each client's portal.</p>
</div>
<div style="background:#F9F6F0;border-radius:10px;padding:16px 20px;margin:0 0 12px;">
  <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1B4332;">⏰ Day-of Timeline</p>
  <p style="margin:0;font-size:13px;color:#6B5E4A;line-height:1.6;">Create a minute-by-minute wedding day schedule and share it with your client. They approve it with one click — no printing, no back-and-forth.</p>
</div>
<div style="background:#F9F6F0;border-radius:10px;padding:16px 20px;margin:0 0 20px;">
  <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1B4332;">⭐ Automated Review Requests</p>
  <p style="margin:0;font-size:13px;color:#6B5E4A;line-height:1.6;">When you mark delivery complete, PortalKit automatically emails your client links to leave reviews on Google, WeddingWire, or The Knot. Set it up once in Workflows.</p>
</div>
<p style="color:#9C8E7A;font-size:13px;margin:0;">Reply to this email with any questions — I'm here to help.</p>`,
            ctaText: 'Explore your dashboard →',
            ctaUrl: `${frontendUrl}/dashboard`,
            footerNote: 'PortalKit by Kilpian LLC',
          }),
        })
        await pool.query(
          `INSERT INTO onboarding_emails_sent (user_id, email_type) VALUES ($1, 'onboarding_day10') ON CONFLICT DO NOTHING`,
          [u.id]
        )
        console.log(`📧 Onboarding Day 10 sent to ${u.email}`)
      } catch (e) { console.error('Onboarding Day 10 email failed:', e.message) }
    }
  } catch (err) {
    console.error('Onboarding sequence error:', err.message)
  }
}

// ── Content Engine ────────────────────────────────────────────

async function postToX(content) {
  if (!twitterClient) {
    console.log('⚡ X not configured - skipping post')
    return null
  }

  try {
    // X has a 280 char limit
    const text = content.length > 270
      ? content.slice(0, 267) + '...'
      : content

    const tweet = await twitterClient.v2.tweet(text)
    console.log('⚡ Posted to X:', tweet.data?.id)
    return tweet.data
  } catch (err) {
    console.error('⚡ X post error:', err.message)
    return null
  }
}

async function generateVoiceAudio(text, outputPath) {
  // Try Kokoro TTS first (free, runs locally via ONNX)
  try {
    console.log('🎬 Kokoro loading model (first run)...')
    const { KokoroTTS } = await import('kokoro-js')
    const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', { dtype: 'q8' })
    const audio = await tts.generate(text.slice(0, 500), { voice: 'af_bella', speed: 1.18 })
    const wavPath = outputPath.replace(/\.[^.]+$/, '.wav')
    await audio.save(wavPath)
    console.log('🎬 Kokoro TTS audio generated')
    return wavPath
  } catch (kokoroErr) {
    console.log('🎬 Kokoro TTS failed:', kokoroErr.message)
  }

  // Fall back to ElevenLabs if configured
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('🎬 No voice fallback configured, silent video')
    return null
  }
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: text.slice(0, 800),
          model_id: 'eleven_turbo_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      }
    )
    if (!response.ok) {
      console.log('🎬 ElevenLabs error:', response.status, '- generating silent video')
      return null
    }
    const buffer = await response.arrayBuffer()
    fs.writeFileSync(outputPath, Buffer.from(buffer))
    return outputPath
  } catch (elErr) {
    console.log('🎬 ElevenLabs failed:', elErr.message)
    return null
  }
}

async function generateVideoFrames(text, outputDir, durationSeconds = 30) {
  if (!createCanvas) {
    console.log('🎬 skia-canvas not available, skipping frames')
    return null
  }

  try {
    const fontPaths = [
      '/usr/share/fonts/truetype/dejavu-fonts-ttf-2.37/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
      '/run/current-system/sw/share/X11/fonts/DejaVuSans-Bold.ttf',
    ]
    let fontRegistered = false
    for (const fontPath of fontPaths) {
      if (fs.existsSync(fontPath)) {
        FontLibrary.use('PortalKitFont', [fontPath])
        console.log('🎬 Font registered:', fontPath)
        fontRegistered = true
        break
      }
    }
    if (!fontRegistered) {
      console.log('🎬 Available fonts:', JSON.stringify(FontLibrary.families).slice(0, 200))
    }
  } catch (err) {
    console.log('🎬 Font registration error:', err.message)
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const W = 1080, H = 1920
  const fps = 30
  const wordsPerMinute = 150

  // Split into sentences, group short ones so each slide is a complete thought
  const sentences = text.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0)
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    const wc = sentence.split(/\s+/).length
    if (current && current.split(/\s+/).length + wc > 12) {
      chunks.push(current.trim())
      current = sentence
    } else {
      current = current ? current + ' ' + sentence : sentence
    }
  }
  if (current) chunks.push(current.trim())
  if (!chunks.length) chunks.push(text.trim() || 'Portal Kit')

  let frameCount = 0

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx]
    const wordCount = chunk.split(/\s+/).length
    const chunkDuration = Math.max(2, Math.ceil((wordCount / wordsPerMinute) * 60))
    const framesToGenerate = chunkDuration * fps
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext('2d')

    // Top gold accent bar
    ctx.fillStyle = '#C9A84C'
    ctx.fillRect(0, 0, W, 8)

    // Brand name
    ctx.font = 'bold 36px PortalKitFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('PORTALKIT', W / 2, 120)

    // Divider
    ctx.fillStyle = 'rgba(255,255,255,0.2)'
    ctx.fillRect(W / 2 - 80, 148, 160, 2)

    // Word-wrap main text
    ctx.font = 'bold 68px PortalKitFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const maxWidth = W - 120
    const lineHeight = 88
    const cWords = chunk.split(' ')
    const lines = []
    let currentLine = ''
    for (const word of cWords) {
      const test = currentLine ? currentLine + ' ' + word : word
      if (ctx.measureText(test).width > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = test
      }
    }
    if (currentLine) lines.push(currentLine)

    const totalTextHeight = lines.length * lineHeight
    const startY = (H - totalTextHeight) / 2
    lines.forEach((line, i) => {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillText(line, W / 2 + 3, startY + i * lineHeight + 3)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(line, W / 2, startY + i * lineHeight)
    })

    // CTA bar
    ctx.fillStyle = 'rgba(201,168,76,0.9)'
    ctx.fillRect(80, H - 200, W - 160, 80)
    ctx.fillStyle = '#0D1B2A'
    ctx.font = 'bold 32px PortalKitFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('getportalkit.com', W / 2, H - 160)

    // Progress bar
    const progress = (chunkIdx + 1) / chunks.length
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.fillRect(40, H - 60, W - 80, 6)
    ctx.fillStyle = '#C9A84C'
    ctx.fillRect(40, H - 60, (W - 80) * progress, 6)

    // skia-canvas toBuffer() is async and returns correct colors on Linux
    const frameBuffer = await canvas.toBuffer('image/png')

    for (let f = 0; f < framesToGenerate; f++) {
      fs.writeFileSync(
        path.join(outputDir, 'frame_' + String(frameCount).padStart(5, '0') + '.png'),
        frameBuffer
      )
      if (frameCount === 0) console.log('🎬 Frame check: transparent background, canvas elements only')
      frameCount++
    }
  }

  console.log('🎬 Generated ' + frameCount + ' frames (skia-canvas, sentence-based)')
  return outputDir
}

async function renderVideo(framesDir, audioPath, outputPath, fps = 30, bgVideoPath = null) {
  if (!ffmpeg) throw new Error('FFmpeg not available')

  return new Promise((resolve, reject) => {
    const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort()
    console.log('🎬 Frames to render:', frameFiles.length)
    if (!frameFiles.length) { reject(new Error('No frames in ' + framesDir)); return }

    const globPattern = path.join(framesDir, 'frame_*.png')
    const hasAudio = !!(audioPath && fs.existsSync(audioPath))
    const totalDuration = Math.ceil(frameFiles.length / fps) + 2
    const cmd = ffmpeg()

    if (bgVideoPath && fs.existsSync(bgVideoPath)) {
      cmd.input(bgVideoPath).inputOption('-stream_loop -1')
      cmd.input(globPattern).inputOptions(['-pattern_type glob', '-framerate ' + fps])
      if (hasAudio) cmd.input(audioPath)

      // Scale to cover 1080x1920 (increase AR), then center-crop to exact 1080x1920
      const filter = [
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bgscaled]`,
        `[bgscaled]curves=r='0/0.08 0.5/0.55 1/1':g='0/0.04 0.5/0.5 1/0.96':b='0/0.12 0.5/0.47 1/0.82'[bggraded]`,
        `[bggraded]vignette=PI/5[bgvign]`,
        `[bgvign]colorchannelmixer=rr=0.45:gg=0.45:bb=0.45[bgdark]`,
        `[bgdark][1:v]overlay=0:0:format=rgb[vout]`,
      ].join(';')
      console.log('🎬 Filter:', filter.slice(0, 100))

      cmd.complexFilter(filter).outputOption('-map [vout]')
      if (hasAudio) {
        cmd.outputOption('-map 2:a').outputOption('-shortest')
      } else {
        cmd.outputOption(`-t ${totalDuration}`)
      }
    } else {
      // Flat navy background via lavfi — d=300 so -shortest controls end time
      cmd.input(`color=c=0x0D1B2A:s=1080x1920:r=30:d=300`).inputOption('-f lavfi')
      cmd.input(globPattern).inputOptions(['-pattern_type glob', '-framerate ' + fps])
      if (hasAudio) cmd.input(audioPath)

      cmd.complexFilter('[0:v][1:v]overlay=0:0:format=rgb[vout]').outputOption('-map [vout]')
      if (hasAudio) {
        cmd.outputOption('-map 2:a').outputOption('-shortest')
      } else {
        cmd.outputOption(`-t ${totalDuration}`)
      }
    }

    cmd.outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-preset fast', '-crf 23', '-movflags +faststart', ...(hasAudio ? ['-c:a aac'] : [])])
    cmd.output(outputPath)
    cmd.on('start', c => console.log('🎬 FFmpeg command:', c))
    cmd.on('end', () => { console.log('🎬 Video rendered:', outputPath); resolve(outputPath) })
    cmd.on('error', (err, stdout, stderr) => {
      console.error('🎬 FFmpeg error:', err.message)
      if (stderr) console.error('🎬 FFmpeg stderr:', stderr.slice(-500))
      reject(err)
    })
    cmd.run()
  })
}

// Find a usable TTF font for FFmpeg drawtext. Checked once, result cached.
let _fontFileCache = undefined
function findFontFile() {
  if (_fontFileCache !== undefined) return _fontFileCache
  const candidates = [
    // Linux / Railway (Debian/Ubuntu)
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    // macOS (local dev)
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
  ]
  for (const p of candidates) {
    try { if (fs.existsSync(p)) { _fontFileCache = p; console.log('🎬 Font found:', p); return p } } catch {}
  }
  // Last resort: search system for any TTF (3 second timeout)
  try {
    const found = execSync(
      "find /usr /nix /Library /System -name '*.ttf' -type f 2>/dev/null | head -1",
      { timeout: 3000 }
    ).toString().trim()
    if (found) { _fontFileCache = found; console.log('🎬 Font found via find:', found); return found }
  } catch {}
  _fontFileCache = null
  console.log('🎬 No font found — install fonts-dejavu-core on Railway for text rendering')
  return null
}

async function prepareVideoScript(rawScript) {
  const fallback = { displayScript: rawScript, ttsScript: rawScript }
  if (!anthropic) return fallback
  try {
    const rewriteRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: `Rewrite for natural spoken audio. Short punchy sentences. Conversational. Remove hashtags, URLs, special characters. Keep key facts. Similar word count. Return ONLY the rewritten script, no explanation.\n\nScript: ${rawScript}` }]
    })

    let displayScript = (rewriteRes.content[0]?.text || rawScript).trim()

    // Cap at 8 sentences to keep total render time under ~4 min on Railway
    const scriptSentences = displayScript.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 4)
    if (scriptSentences.length > 8) {
      const trimmed = scriptSentences.slice(0, 7)
      trimmed.push('Try it free at getportalkit.com.')
      displayScript = trimmed.join(' ')
      console.log(`🎬 Script trimmed from ${scriptSentences.length} to 8 sentences`)
    }

    // TTS-only phonetic substitutions — applied AFTER Claude rewrite, never shown on screen
    const ttsScript = displayScript
      .replace(/PortalKit/gi, 'Portal Kit')
      .replace(/getportalkit\.com/gi, 'get portal kit dot com')
      .replace(/HoneyBook/gi, 'Honey Book')
      .replace(/DocuSign/gi, 'Docu Sign')
      .replace(/Pixieset/gi, 'Pixie set')
      .replace(/Calendly/gi, 'Calen lee')
      .replace(/Pic-Time/gi, 'Pic Time')
      .replace(/SaaS/gi, 'software')
      .replace(/CRM/gi, 'C R M')
      .replace(/resending/gi, 're sending')
      .replace(/\$(\d+)/g, (m, n) => parseInt(n) < 100 ? `${n} dollars` : m)
      .replace(/https?:\/\/[^\s]+/gi, url =>
        url.replace('https://', '').replace('http://', '')
          .replace(/\//g, ' slash ').replace(/\./g, ' dot '))
      .replace(/\.com\b/gi, ' dot com')
      .replace(/\s+/g, ' ').trim()

    console.log('🎬 Display script:', displayScript.slice(0, 80))
    console.log('🎬 TTS script:', ttsScript.slice(0, 80))
    return { displayScript, ttsScript }
  } catch (err) {
    console.log('🎬 Script prep failed:', err.message)
    return fallback
  }
}

async function getPexelsQuery(script) {
  if (!anthropic) return 'wedding photography couple'
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: `What 2-3 word Pexels stock video search term best matches this script theme? Return ONLY the search term, nothing else.\n\nScript: ${script.slice(0, 200)}` }]
    })
    const query = res.content[0]?.text?.trim() || 'wedding photography'
    console.log('🎬 Pexels query:', query)
    return query
  } catch {
    return 'wedding photography couple'
  }
}

const PEXELS_QUERIES = [
  // Couple moments
  'wedding couple golden hour portrait',
  'bride groom outdoor ceremony',
  'engagement shoot sunset bokeh',
  'couple dancing wedding reception',
  // Venue and details
  'wedding venue elegant ballroom',
  'wedding ceremony outdoor garden',
  'wedding venue floral decorations',
  'luxury wedding venue interior',
  // Close-up details
  'wedding rings close up macro',
  'wedding cake elegant tiered',
  'wedding bouquet flowers pink',
  'wedding table centerpiece floral',
  'wedding dress detail lace',
  // Photographer in action
  'wedding photographer camera couple',
  'photographer shooting portrait outdoor',
  'professional photographer studio light',
  // Generic romantic
  'romantic sunset silhouette couple',
  'champagne glasses celebration toast',
  'wedding day morning preparations',
  'bridal party getting ready',
]

async function getPexelsBackgroundVideo(query, tmpDir) {
  if (!PEXELS_API_KEY) return null
  try {
    const page = Math.floor(Math.random() * 5) + 1
    console.log('🎬 Pexels query:', query)
    const res = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=medium&per_page=15&page=${page}&min_duration=15`,
      { headers: { Authorization: PEXELS_API_KEY } }
    )
    if (!res.ok) { console.log('🎬 Pexels error:', res.status); return null }
    const data = await res.json()
    const videos = data.videos || []
    if (!videos.length) { console.log('🎬 No Pexels videos for:', query, 'page', page); return null }

    const randomIndex = Math.floor(Math.random() * Math.min(videos.length, 8))
    const video = videos[randomIndex]
    console.log(`🎬 Pexels: picked video ${randomIndex + 1}/${videos.length} (page ${page})`)
    const videoFile = video.video_files
      ?.filter(f => f.width <= 1080 && f.height >= 1280)
      ?.sort((a, b) => b.height - a.height)[0]
      || video.video_files?.[0]
    if (!videoFile?.link) return null

    console.log('🎬 Downloading Pexels video:', videoFile.link)
    const videoRes = await fetch(videoFile.link)
    if (!videoRes.ok) return null

    const videoPath = path.join(tmpDir, 'pexels_bg.mp4')
    fs.writeFileSync(videoPath, Buffer.from(await videoRes.arrayBuffer()))
    console.log('🎬 Pexels background downloaded:', videoPath)
    return videoPath
  } catch (err) {
    console.log('🎬 Pexels fetch error:', err.message)
    return null
  }
}

function getWavDurationSeconds(filePath) {
  try {
    // WAV header layout (all little-endian):
    //   22–23: num channels (uint16)
    //   24–27: sample rate (uint32)
    //   34–35: bits per sample (uint16)
    //   40–43: data chunk size (uint32)
    const buffer = Buffer.alloc(44)
    const fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, buffer, 0, 44, 0)
    fs.closeSync(fd)

    const sampleRate = buffer.readUInt32LE(24)
    const channels = buffer.readUInt16LE(22)
    const bitsPerSample = buffer.readUInt16LE(34)
    const dataChunkSize = buffer.readUInt32LE(40)

    if (!sampleRate || !channels || !bitsPerSample) return null

    const bytesPerSample = bitsPerSample / 8
    const totalSamples = dataChunkSize / (channels * bytesPerSample)
    const duration = totalSamples / sampleRate

    console.log(`🎬 WAV duration: ${duration.toFixed(2)}s (${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit)`)
    return isFinite(duration) && duration > 0 ? duration : null
  } catch (err) {
    console.log('🎬 WAV parse error:', err.message)
    return null
  }
}

async function generateChunkedVideo({ displayScript, ttsScript }, tmpDir, fps = 30) {
  // Split TTS sentences for audio timing
  const ttsSentences = ttsScript.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 4)
  // Split display sentences the same way for canvas text
  const displaySentences = displayScript.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 4)
  const count = Math.min(ttsSentences.length, displaySentences.length)
  if (!count) return null

  const framesDir = path.join(tmpDir, 'frames')
  fs.mkdirSync(framesDir, { recursive: true })

  // Use pre-loaded Kokoro instance; fall back to on-demand load if startup pre-load failed
  let tts = kokoroTTS
  if (!tts) {
    try {
      console.log('🎬 Kokoro not pre-loaded, loading on demand...')
      const { KokoroTTS } = await import('kokoro-js')
      tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', { dtype: 'q8' })
      console.log('🎬 Kokoro TTS ready (on-demand)')
    } catch (err) {
      console.log('🎬 Kokoro not available:', err.message)
    }
  } else {
    console.log('🎬 Kokoro TTS using pre-loaded instance')
  }

  // Register fonts
  if (FontLibrary) {
    try {
      const fontPaths = [
        '/usr/share/fonts/truetype/dejavu-fonts-ttf-2.37/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
        '/run/current-system/sw/share/X11/fonts/DejaVuSans-Bold.ttf',
      ]
      for (const fontPath of fontPaths) {
        if (fs.existsSync(fontPath)) { FontLibrary.use('PortalKitFont', [fontPath]); break }
      }
    } catch {}
  }

  const audioParts = []
  let frameIndex = 0
  const W = 1080, H = 1920
  const maxWidth = W - 120
  const lineHeight = 88

  for (let i = 0; i < count; i++) {
    const ttsSentence = ttsSentences[i]
    const displaySentence = displaySentences[i]
    const wordEst = ttsSentence.split(/\s+/).length
    let chunkDuration = Math.max(2, wordEst / 2.5)

    // Generate TTS audio from TTS sentence
    if (tts) {
      try {
        const audioChunkPath = path.join(tmpDir, `audio_chunk_${i}.wav`)
        const audio = await tts.generate(ttsSentence, { voice: 'af_bella', speed: 1.18 })
        await audio.save(audioChunkPath)
        audioParts.push(audioChunkPath)

        // Parse WAV header directly — no ffprobe needed
        const wavDuration = getWavDurationSeconds(audioChunkPath)
        if (wavDuration && wavDuration > 0.5) {
          chunkDuration = wavDuration + 0.15
          console.log(`🎬 Audio chunk duration: ${chunkDuration.toFixed(2)}s`)
        }
      } catch (err) {
        console.log('🎬 Audio chunk error:', err.message)
      }
    }

    const frameCount = Math.ceil(chunkDuration * fps)

    if (createCanvas) {
      // Pre-compute word layout from display sentence (so positions don't shift during reveal)
      const canvas = createCanvas(W, H)
      const ctx = canvas.getContext('2d')
      ctx.font = 'bold 68px PortalKitFont, sans-serif'

      const allWords = displaySentence.split(' ')
      const lineArrays = []
      let curLine = []
      for (const word of allWords) {
        const testLine = [...curLine, word].join(' ')
        if (ctx.measureText(testLine).width > maxWidth && curLine.length > 0) {
          lineArrays.push([...curLine]); curLine = [word]
        } else curLine.push(word)
      }
      if (curLine.length) lineArrays.push(curLine)

      const startY = (H - lineArrays.length * lineHeight) / 2
      const framesPerWord = Math.max(1, Math.floor(frameCount / allWords.length))
      let wordsSoFar = 0

      for (let li = 0; li < lineArrays.length; li++) {
        for (let wi = 0; wi < lineArrays[li].length; wi++) {
          wordsSoFar++

          ctx.clearRect(0, 0, W, H)

          // Gold top bar
          ctx.fillStyle = '#C9A84C'
          ctx.fillRect(0, 0, W, 8)

          // Brand label
          ctx.fillStyle = '#C9A84C'
          ctx.font = 'bold 36px PortalKitFont, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('PORTALKIT', W / 2, 120)

          // Divider
          ctx.fillStyle = 'rgba(255,255,255,0.2)'
          ctx.fillRect(W / 2 - 80, 148, 160, 2)

          // Main text — word-by-word reveal with drop shadow
          ctx.font = 'bold 68px PortalKitFont, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'

          let wIdx = 0
          for (let lineI = 0; lineI < lineArrays.length && wIdx < wordsSoFar; lineI++) {
            const wordsForLine = []
            for (let wordI = 0; wordI < lineArrays[lineI].length && wIdx < wordsSoFar; wordI++, wIdx++) {
              wordsForLine.push(lineArrays[lineI][wordI])
            }
            if (wordsForLine.length > 0) {
              const lineText = wordsForLine.join(' ')
              ctx.shadowColor = 'rgba(0,0,0,0.8)'
              ctx.shadowBlur = 15
              ctx.shadowOffsetX = 2
              ctx.shadowOffsetY = 2
              ctx.fillStyle = '#FFFFFF'
              ctx.fillText(lineText, W / 2, startY + lineI * lineHeight)
              ctx.shadowColor = 'transparent'
              ctx.shadowBlur = 0
              ctx.shadowOffsetX = 0
              ctx.shadowOffsetY = 0
            }
          }

          // CTA bar
          ctx.fillStyle = 'rgba(201,168,76,0.9)'
          ctx.fillRect(80, H - 200, W - 160, 80)
          ctx.fillStyle = '#0D1B2A'
          ctx.font = 'bold 32px PortalKitFont, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('getportalkit.com', W / 2, H - 160)

          // Progress bar
          const progress = (i + 1) / count
          ctx.fillStyle = 'rgba(255,255,255,0.15)'
          ctx.fillRect(40, H - 60, W - 80, 6)
          ctx.fillStyle = '#C9A84C'
          ctx.fillRect(40, H - 60, (W - 80) * progress, 6)

          // Last word of this sentence gets remaining frames to hit exact frameCount
          const isLastWord = li === lineArrays.length - 1 && wi === lineArrays[li].length - 1
          const framesToWrite = isLastWord
            ? Math.max(1, frameCount - framesPerWord * (allWords.length - 1))
            : framesPerWord

          const frameBuffer = await canvas.toBuffer('image/png')
          for (let f = 0; f < framesToWrite; f++) {
            fs.writeFileSync(
              path.join(framesDir, 'frame_' + String(frameIndex).padStart(6, '0') + '.png'),
              frameBuffer
            )
            frameIndex++
          }
        }
      }
    } else {
      frameIndex += frameCount
    }

    console.log(`🎬 Sentence ${i + 1}/${count}: ${chunkDuration.toFixed(1)}s, ${frameCount} frames`)
  }

  console.log(`🎬 generateChunkedVideo: ${frameIndex} frames, ${audioParts.length} audio chunks`)
  return { framesDir, audioParts, frameIndex }
}

async function generateSocialVideo(script, title, postId) {
  if (!ffmpeg) {
    console.log('🎬 FFmpeg not available, skipping')
    return null
  }

  const tmpDir = path.join(os.tmpdir(), `video-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  const outputPath = path.join(tmpDir, 'output.mp4')

  let videoId
  try {
    const { rows } = await pool.query(
      `INSERT INTO generated_videos (post_id, title, script, status) VALUES ($1, $2, $3, 'rendering') RETURNING id`,
      [postId || null, title, script]
    )
    videoId = rows[0].id
  } catch (err) {
    console.error('🎬 DB insert error:', err.message)
    return null
  }

  try {
    const { displayScript, ttsScript } = await prepareVideoScript(script)

    const seed = new Date().getDate() + Math.floor(Math.random() * 4)
    const queryIndex = seed % PEXELS_QUERIES.length
    const pexelsBgPath = await getPexelsBackgroundVideo(PEXELS_QUERIES[queryIndex], tmpDir).catch(() => null)
    console.log('🎬 Pexels background:', pexelsBgPath ? 'ready' : 'not available')

    const chunkedResult = await generateChunkedVideo({ displayScript, ttsScript }, tmpDir, 30)
    if (!chunkedResult || !chunkedResult.frameIndex) throw new Error('Frame generation failed — skia-canvas unavailable')

    const { framesDir, audioParts } = chunkedResult

    // Concatenate per-sentence audio into one file
    let finalAudioPath = null
    if (audioParts.length > 0) {
      finalAudioPath = path.join(tmpDir, 'final_audio.wav')
      if (audioParts.length === 1) {
        fs.copyFileSync(audioParts[0], finalAudioPath)
      } else {
        const concatFile = path.join(tmpDir, 'audio_list.txt')
        fs.writeFileSync(concatFile, audioParts.map(p => `file '${p}'`).join('\n'))
        await new Promise((resolve, reject) => {
          const cmd = ffmpeg()
          cmd.input(concatFile)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOption('-c copy')
            .output(finalAudioPath)
            .on('end', resolve)
            .on('error', reject)
            .run()
        })
      }
      console.log('🎬 Audio concatenated:', finalAudioPath)
    }

    await renderVideo(framesDir, finalAudioPath, outputPath, 30, pexelsBgPath)

    const videoKey = `videos/${Date.now()}-${videoId}.mp4`
    if (r2 && fs.existsSync(outputPath)) {
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: videoKey,
        Body: fs.readFileSync(outputPath),
        ContentType: 'video/mp4'
      }))
    }

    const videoUrl = process.env.R2_PUBLIC_URL
      ? `${process.env.R2_PUBLIC_URL}/${videoKey}`
      : null
    if (!process.env.R2_PUBLIC_URL) console.log('🎬 R2_PUBLIC_URL not set')

    await pool.query(
      `UPDATE generated_videos SET status='ready', r2_url=$1, completed_at=NOW() WHERE id=$2`,
      [videoUrl, videoId]
    )
    console.log(`🎬 Video ${videoId} ready: ${videoKey}`)
    return { videoId, r2Url: videoUrl }
  } catch (err) {
    console.error('🎬 Video error:', err.message)
    try {
      await pool.query(
        `UPDATE generated_videos SET status='error', error=$1 WHERE id=$2`,
        [err.message, videoId]
      )
    } catch {}
    return null
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function generateAndScheduleWeeklyContent() {
  if (!anthropic) {
    console.log('⚡ Content engine: no AI key, skipping')
    return
  }
  console.log('⚡ Content engine: generating weekly content...')
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: `You are the social media voice for PortalKit (getportalkit.com). Wedding photographer client portal. $29/month replaces DocuSign, Dropbox, Calendly, Pixieset. Write like a photographer helping peers. Direct. Zero corporate speak. Return ONLY valid JSON. No markdown. No code fences.`,
      messages: [{
        role: 'user',
        content: `Generate 7 social media posts. Vary the angle: pain_point, tip, feature, savings, social_proof, question, story. Return this JSON: {"posts":[{"day":1,"angle":"pain_point","content":"Full post for Instagram/Facebook. Use \\n for line breaks. Include 8-12 hashtags at end.","twitter_content":"Under 270 chars. 3-4 hashtags.","hook":"First line under 10 words"}]}`
      }]
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) { console.error('⚡ Content engine: invalid AI response'); return }
    const { posts } = JSON.parse(jsonMatch[0])
    console.log(`⚡ Generated ${posts.length} posts`)
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1)
    const times = ['09:00','19:00','08:30','12:00','18:00','10:00','20:00']
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]
      const schedDate = new Date(weekStart)
      schedDate.setDate(schedDate.getDate() + i)
      const [h, m] = times[i].split(':')
      schedDate.setHours(parseInt(h), parseInt(m), 0, 0)

      const inserted = await pool.query(
        `INSERT INTO generated_content
         (content, twitter_content, angle, day_number,
          week_start, scheduled_for)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [post.content, post.twitter_content,
         post.angle, post.day,
         weekStart.toISOString().split('T')[0],
         schedDate.toISOString()]
      ).catch(() => null)

      // Post twitter_content to X immediately
      const xContent = post.twitter_content ||
        post.content.slice(0, 270)
      const result = await postToX(xContent)

      if (result?.id) {
        await pool.query(
          `UPDATE generated_content
           SET status='posted', postproxy_id=$1
           WHERE id=$2`,
          ['x:' + result.id, inserted.rows[0].id]
        ).catch(() => {})
        console.log(`⚡ Post ${i+1}/7 posted to X`)
      } else {
        console.log(`⚡ Post ${i+1}/7 stored, X not posted`)
      }

      // Small delay between posts to avoid rate limits
      await new Promise(r => setTimeout(r, 1000))
    }
    console.log(`⚡ Content engine: ${posts.length} posts stored`)

    // Queue a background video for the first post
    if (posts.length > 0) {
      const firstPost = posts[0]
      const script = firstPost.twitter_content || firstPost.content.slice(0, 300)
      const title = `Weekly tip - ${new Date().toISOString().slice(0, 10)}`
      generateSocialVideo(script, title, null).catch(e =>
        console.error('🎬 Weekly video error:', e.message)
      )
    }
  } catch (err) {
    console.error('⚡ Content engine error:', err.message)
  }
}

async function monitorRedditAndGenerateContent() {
  if (!anthropic) return
  try {
    const redditRes = await fetch('https://www.reddit.com/r/weddingphotography/search.json?q=software+booking+client+invoice+contract&sort=new&limit=10&t=week', { headers: { 'User-Agent': 'PortalKit/1.0' } })
    if (!redditRes.ok) return
    const redditData = await redditRes.json()
    const redditPosts = redditData?.data?.children || []
    if (!redditPosts.length) return
    const painPoints = redditPosts.map(p => p.data.title).join('\n')
    console.log('⚡ Reddit: found', redditPosts.length, 'relevant posts')
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Photographers on Reddit are asking:\n\n${painPoints}\n\nWrite 1 social post addressing the most common pain point. Position PortalKit naturally as the solution. NOT salesy. End with soft CTA and 5-8 hashtags. Return only the post text.`
      }]
    })
    const content = msg.content[0]?.type === 'text' ? msg.content[0].text : null
    if (!content) return
    const schedDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const inserted = await pool.query(
      `INSERT INTO generated_content (content, angle, scheduled_for) VALUES ($1,'reddit_insight',$2) RETURNING id`,
      [content, schedDate.toISOString()]
    ).catch(() => null)
    const redditResult = await postToX(content.slice(0, 270))
    if (redditResult?.id) {
      await pool.query(
        `UPDATE generated_content SET status='posted', postproxy_id=$1 WHERE id=$2`,
        ['x:' + redditResult.id, inserted?.rows[0]?.id]
      ).catch(() => {})
      console.log('⚡ Reddit post posted to X')
    } else {
      console.log('⚡ Reddit post stored, X not posted')
    }
  } catch (err) {
    console.error('⚡ Reddit monitor error:', err.message)
  }
}

async function sendFreeToolNurtureEmails() {
  if (!resend) return
  try {
    // Day 3: Show them what PortalKit actually does
    const day3Leads = await pool.query(`
      SELECT tl.email FROM tool_leads tl
      WHERE tl.created_at < NOW() - INTERVAL '3 days'
      AND tl.created_at > NOW() - INTERVAL '4 days'
      AND NOT EXISTS (
        SELECT 1 FROM tool_lead_nurture tln
        WHERE tln.email = tl.email AND tln.email_type = 'day3_feature'
      )
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE LOWER(u.email) = LOWER(tl.email) AND u.plan IN ('trial','active')
      )
    `)
    for (const lead of day3Leads.rows) {
      await resend.emails.send({
        from: 'Chidera at PortalKit <hello@mail.getportalkit.com>',
        reply_to: 'hello@getportalkit.com',
        to: lead.email,
        subject: 'Quick question about your workflow',
        html: emailTemplate({
          title: 'How are you managing clients right now?',
          preheader: 'Most photographers use 6 tools. There is a better way.',
          body: `
            <h2>Hey there!</h2>
            <p>You used one of our free tools a few days ago. Hope it was useful.</p>
            <p>Quick honest question: how are you currently managing contracts, invoices, and file delivery for your clients?</p>
            <p>Most photographers I talk to are bouncing between DocuSign, PayPal, Dropbox, and their inbox for every single booking. It works but it is exhausting.</p>
            <p>PortalKit puts all of that in one private link you send each client. They sign, pay, fill out questionnaires, and download their gallery without you sending a single follow up email.</p>
            <p>14-day free trial if you want to see it in action.</p>
          `,
          ctaText: 'See How It Works →',
          ctaUrl: 'https://getportalkit.com',
          footerNote: 'Reply to this email if you have questions. I read every one.'
        })
      })
      await pool.query(
        `INSERT INTO tool_lead_nurture (email, email_type) VALUES ($1, 'day3_feature') ON CONFLICT DO NOTHING`,
        [lead.email]
      )
      console.log('📧 Day 3 nurture sent to:', lead.email)
    }

    // Day 7: Final nudge
    const day7Leads = await pool.query(`
      SELECT tl.email FROM tool_leads tl
      WHERE tl.created_at < NOW() - INTERVAL '7 days'
      AND tl.created_at > NOW() - INTERVAL '8 days'
      AND NOT EXISTS (
        SELECT 1 FROM tool_lead_nurture tln
        WHERE tln.email = tl.email AND tln.email_type = 'day7_trial'
      )
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE LOWER(u.email) = LOWER(tl.email) AND u.plan IN ('trial','active')
      )
    `)
    for (const lead of day7Leads.rows) {
      await resend.emails.send({
        from: 'Chidera at PortalKit <hello@mail.getportalkit.com>',
        reply_to: 'hello@getportalkit.com',
        to: lead.email,
        subject: 'Last thing, I promise',
        html: emailTemplate({
          title: 'One more thing before I stop emailing',
          preheader: 'After this I will leave you alone',
          body: `
            <h2>Last email from me, I promise.</h2>
            <p>You downloaded our free templates a week ago. If you tried PortalKit already, ignore this.</p>
            <p>If not, here is the one thing photographers tell me after they sign up: they wish they had done it sooner.</p>
            <p>Not because it is complicated. Because it is not. Most photographers send their first client portal within 10 minutes of signing up.</p>
            <p>14-day free trial. Your card is saved but not charged for 14 days. If you cancel before day 15 you pay nothing.</p>
            <p>That is genuinely the whole pitch.</p>
          `,
          ctaText: 'Start Free Trial →',
          ctaUrl: 'https://getportalkit.com/signup',
          footerNote: 'This is the last email in this sequence. Promise.'
        })
      })
      await pool.query(
        `INSERT INTO tool_lead_nurture (email, email_type) VALUES ($1, 'day7_trial') ON CONFLICT DO NOTHING`,
        [lead.email]
      )
      console.log('📧 Day 7 nurture sent to:', lead.email)
    }
  } catch (err) {
    console.error('Tool nurture error:', err.message)
  }
}

// ── Cold Outreach Engine ──────────────────────────────────────

const COLD_EMAIL_FROM = process.env.COLD_EMAIL_FROM
const COLD_EMAIL_ADDRESS = process.env.COLD_EMAIL_ADDRESS || 'Kilpian LLC, Maryland, USA'
const COLD_DAILY_LIMIT = parseInt(process.env.COLD_DAILY_LIMIT || '25')

function buildColdEmail(contact) {
  const firstName = contact.first_name
    ? contact.first_name.trim() : null
  const greeting = firstName
    ? `Hi ${firstName}` : 'Hi there'
  const biz = contact.business_name
    ? ` at ${contact.business_name}` : ''

  const subjects = [
    'a free shot list template for your weddings',
    'quick question about your client workflow',
    'something I made for wedding photographers',
  ]
  const subject = subjects[
    Math.floor(Math.random() * subjects.length)
  ]

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,
      'Inter',sans-serif; max-width:520px; color:#1a1a1a;
      font-size:15px; line-height:1.7;">

      <p>${greeting}${biz},</p>

      <p>I built a free wedding shot list generator for
      photographers and wanted to share it. No signup,
      no email required, just paste your details and get
      a full shot list in seconds.</p>

      <p>
        <a href="https://getportalkit.com/tools/shot-list"
          style="color:#1B4332; font-weight:600;">
          getportalkit.com/tools/shot-list
        </a>
      </p>

      <p>I also built the tool into a client portal
      platform called PortalKit where couples can submit
      their own shot list through a private link you send
      them, and you confirm it in one click. If that
      sounds useful there's a free trial at
      getportalkit.com.</p>

      <p>Either way, hope the free tool is helpful.</p>

      <p>Chidera<br>
      <span style="color:#6B7280; font-size:13px;">
        Founder, PortalKit
      </span></p>

      <hr style="border:none; border-top:1px solid #E5E7EB;
        margin:24px 0;">

      <p style="font-size:11px; color:#9CA3AF; margin:0;">
        ${COLD_EMAIL_ADDRESS}<br>
        Not relevant? Just reply and I'll take you off
        this list immediately.
      </p>
    </div>
  `

  return { subject, html }
}

async function sendColdOutreach() {
  if (!BREVO_API_KEY || !COLD_EMAIL_FROM) {
    console.log('Cold email disabled: COLD_EMAIL_FROM not set')
    return
  }

  try {
    const queued = await pool.query(`
      SELECT cc.* FROM cold_contacts cc
      WHERE cc.status = 'queued'
      AND cc.email NOT IN (
        SELECT email FROM cold_suppression
      )
      AND LOWER(cc.email) NOT IN (
        SELECT LOWER(email) FROM users
        WHERE plan IN ('trial','active')
      )
      ORDER BY cc.created_at ASC
      LIMIT $1
    `, [COLD_DAILY_LIMIT])

    if (!queued.rows.length) {
      console.log('Cold outreach: no queued contacts')
      return
    }

    let sent = 0
    let skipped = 0

    for (const contact of queued.rows) {
      try {
        const { subject, html } = buildColdEmail(contact)

        const result = await sendBrevoEmail({
          from: COLD_EMAIL_FROM,
          to: contact.email,
          subject,
          html
        })

        if (!result) {
          await pool.query(
            `UPDATE cold_contacts SET status='bounced'
             WHERE id=$1`,
            [contact.id]
          )
          skipped++
          continue
        }

        await pool.query(
          `UPDATE cold_contacts SET status='sent',
           sent_at=NOW() WHERE id=$1`,
          [contact.id]
        )

        sent++
        console.log(`Cold email sent to ${contact.email}`)

        await new Promise(r => setTimeout(r, 2000))

      } catch (err) {
        console.error(`Cold send failed for ${contact.email}:`,
          err.message)
        await pool.query(
          `UPDATE cold_contacts SET status='bounced'
           WHERE id=$1`,
          [contact.id]
        )
        skipped++
      }
    }

    console.log(`Cold outreach: ${sent} sent, ${skipped} failed`)

  } catch (err) {
    console.error('Cold outreach error:', err.message)
  }
}

const US_CITIES = [
  ['Nashville', 'tn'], ['Atlanta', 'ga'],
  ['Austin', 'tx'], ['Denver', 'co'],
  ['Seattle', 'wa'], ['Miami', 'fl'],
  ['Chicago', 'il'], ['Portland', 'or'],
  ['Charlotte', 'nc'], ['Phoenix', 'az'],
  ['Minneapolis', 'mn'], ['Detroit', 'mi'],
  ['Boston', 'ma'], ['Baltimore', 'md'],
  ['Tampa', 'fl'], ['Louisville', 'ky'],
  ['Memphis', 'tn'], ['New Orleans', 'la'],
  ['Indianapolis', 'in'], ['Columbus', 'oh'],
  ['San Diego', 'ca'], ['Dallas', 'tx'],
  ['Houston', 'tx'], ['San Antonio', 'tx'],
  ['Jacksonville', 'fl'], ['Sacramento', 'ca'],
  ['Raleigh', 'nc'], ['Richmond', 'va'],
  ['Salt Lake City', 'ut'], ['Tucson', 'az'],
  ['Albuquerque', 'nm'], ['Omaha', 'ne'],
  ['Kansas City', 'mo'], ['Pittsburgh', 'pa'],
  ['Cincinnati', 'oh'], ['Cleveland', 'oh']
]

const SEARCH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Directories/aggregators/socials — never the photographer's own site
const SKIP_DOMAINS = [
  'theknot.com', 'weddingwire.com', 'zola.com', 'yelp.com',
  'facebook.com', 'instagram.com', 'pinterest.', 'youtube.com',
  'google.com', 'wikipedia.org', 'thumbtack.com', 'expertise.com',
  'tripadvisor.', 'bark.com', 'linkedin.com', 'twitter.com',
  'x.com', 'tiktok.com', 'reddit.com', 'yellowpages.com',
  'bbb.org', 'angi.com', 'houzz.com', 'eventective.com',
  'gigsalad.com', 'herecomestheguide.com', 'junebugweddings.com',
  'fearlessphotographers.com', 'weddingchicks.com', 'peerspace.com',
  'snappr.com', 'zankyou.', 'smugmug.com', 'anthropic.com',
  'bing.com', 'duckduckgo.com', 'maps.', 'medium.com', 'quora.com',
  'weddingrule.com', 'caratsandcake.com', 'wezoree.com', 'vogue.com'
]

function isBusinessSiteUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return !SKIP_DOMAINS.some(d => host.includes(d))
  } catch {
    return false
  }
}

// Primary discovery: Anthropic web search server tool (uses existing
// ANTHROPIC_API_KEY — no new credentials). The model only DISCOVERS
// websites; emails are always scraped from the actual pages, never
// generated, so nothing can be hallucinated.
async function discoverSitesViaAnthropic(city, state) {
  if (!anthropic) return []
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{
        role: 'user',
        content: `Search the web for independent wedding photographers based in ${city}, ${String(state || '').toUpperCase()}. I need their OWN business websites (their own domains) — NOT directories like The Knot, WeddingWire, Yelp, Thumbtack, or social media profiles. List every photographer business website URL you find, one per line.`
      }]
    })
    const urls = new Set()
    for (const block of msg.content || []) {
      if (block.type === 'text' && block.text) {
        for (const m of block.text.match(/https?:\/\/[^\s)\]"'<>,]+/g) || []) {
          urls.add(m.replace(/[.,;]+$/, ''))
        }
      }
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r && r.url) urls.add(r.url)
        }
      }
    }
    console.log(`🔎 Anthropic web search: ${urls.size} URLs`)
    return [...urls]
  } catch (err) {
    console.log('🔎 Anthropic web search failed:', err.message)
    return []
  }
}

// Fallback 1: DuckDuckGo HTML endpoint (keyless)
async function discoverSitesViaDuckDuckGo(city, state) {
  try {
    const q = encodeURIComponent(`wedding photographer ${city} ${state} contact`)
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': SEARCH_UA, 'Accept': 'text/html' }
    })
    if (!res.ok) {
      console.log(`🔎 DuckDuckGo returned ${res.status}`)
      return []
    }
    const html = await res.text()
    const urls = new Set()
    for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
      try {
        const decoded = decodeURIComponent(m[1])
        if (decoded.startsWith('http')) urls.add(decoded)
      } catch {}
    }
    console.log(`🔎 DuckDuckGo: ${urls.size} URLs`)
    return [...urls]
  } catch (err) {
    console.log('🔎 DuckDuckGo failed:', err.message)
    return []
  }
}

// Fallback 2: Bing HTML scrape (keyless)
async function discoverSitesViaBing(city, state) {
  try {
    const q = encodeURIComponent(`wedding photographer ${city} ${state}`)
    const res = await fetch(`https://www.bing.com/search?q=${q}&count=30`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': SEARCH_UA, 'Accept': 'text/html' }
    })
    if (!res.ok) {
      console.log(`🔎 Bing returned ${res.status}`)
      return []
    }
    const html = await res.text()
    const urls = new Set()
    for (const m of html.matchAll(/<h2><a[^>]+href="(https?:\/\/[^"]+)"/g)) {
      urls.add(m[1])
    }
    for (const m of html.matchAll(/<cite[^>]*>(https?:\/\/[^<\s]+)/g)) {
      urls.add(m[1])
    }
    console.log(`🔎 Bing: ${urls.size} URLs`)
    return [...urls]
  } catch (err) {
    console.log('🔎 Bing failed:', err.message)
    return []
  }
}

async function findPhotographerEmails(city, state) {
  try {
    console.log(`Finding photographers in ${city}, ${state}`)

    // Hybrid discovery: Anthropic web search first, keyless HTML
    // search engines as fallbacks. Aggregate until we have enough
    // candidate business sites.
    let candidateUrls = await discoverSitesViaAnthropic(city, state)
    if (candidateUrls.length < 10) {
      candidateUrls = candidateUrls.concat(await discoverSitesViaDuckDuckGo(city, state))
    }
    if (candidateUrls.length < 10) {
      candidateUrls = candidateUrls.concat(await discoverSitesViaBing(city, state))
    }

    // One URL per domain, skip directories/socials
    const byDomain = new Map()
    for (const url of candidateUrls) {
      if (!isBusinessSiteUrl(url)) continue
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '')
        if (!byDomain.has(domain)) byDomain.set(domain, url)
      } catch {}
    }

    const sites = [...byDomain.values()].slice(0, 20)
    console.log(`🔎 ${sites.length} candidate photographer sites to scrape`)

    if (!sites.length) {
      console.log('All discovery methods returned 0 usable sites')
      return []
    }

    const foundEmails = []

    for (const url of sites) {
      try {
        await new Promise(r => setTimeout(r, 600))

        const siteRes = await fetch(url, {
          signal: AbortSignal.timeout(7000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
          }
        })

        if (!siteRes.ok) continue

        const html = await siteRes.text()

        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
        let emails = html.match(emailRegex) || []

        // If no email on homepage, try /contact
        if (!emails.length) {
          try {
            const base = new URL(url).origin
            const cRes = await fetch(`${base}/contact`, {
              signal: AbortSignal.timeout(5000),
              headers: { 'User-Agent': 'Mozilla/5.0' }
            })
            if (cRes.ok) {
              emails = (await cRes.text()).match(emailRegex) || []
            }
          } catch {}
        }

        const filtered = emails.filter(e => {
          const l = e.toLowerCase()
          return !l.includes('example')
            && !l.includes('@domain.')
            && !l.includes('@email.')
            && !l.includes('@yourdomain')
            && !l.includes('@mail.com')
            && !l.startsWith('user@')
            && !l.startsWith('name@')
            && !l.startsWith('email@')
            && !l.startsWith('your@')
            && !l.startsWith('info@example')
            && !l.includes('yourname')
            && !l.includes('youremail')
            && !l.includes('@test.')
            && !l.includes('placeholder')
            && !l.includes('sentry')
            && !l.includes('google')
            && !l.includes('schema.org')
            && !l.includes('w3.org')
            && !l.includes('wordpress')
            && !l.includes('jquery')
            && !l.includes('cloudflare')
            && !l.includes('cdn-')
            && !l.includes('.min.')
            && !l.includes('@2x')
            && !l.includes('.png')
            && !l.includes('.jpg')
            && !l.includes('.gif')
            && !l.includes('.svg')
            && !l.includes('.css')
            && !l.includes('.js')
            && e.length < 60
            && e.length > 6
            && e.split('@')[1]?.includes('.')
        })

        const email = [...new Set(filtered)][0]

        if (email) {
          // Extract business name from page title
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
          const businessName = (titleMatch?.[1] || new URL(url).hostname.replace(/^www\./, '') || '')
            .replace(/\s*[-|–|•|·].*$/, '')
            .replace(/\s*\|.*$/, '')
            .trim()
            .slice(0, 80)

          const firstName = businessName.split(' ')[0] || ''

          foundEmails.push({
            email: email.toLowerCase().trim(),
            business_name: businessName,
            first_name: firstName,
            note: `${city}, ${state}`
          })
          console.log(`✓ Found: ${email} (${businessName})`)
        }

      } catch (err) {
        console.log(`Scrape failed for ${url}: ${err.message}`)
      }
    }

    const seen = new Set()
    const unique = foundEmails.filter(c => {
      if (seen.has(c.email)) return false
      seen.add(c.email)
      return true
    })

    console.log(`✅ ${unique.length} emails found in ${city}`)
    return unique

  } catch (err) {
    console.error('Email finder error:', err.message)
    return []
  }
}

async function importFoundEmails(emails) {
  let added = 0
  let skipped = 0
  for (const contact of emails) {
    try {
      const result = await pool.query(
        `INSERT INTO cold_contacts
           (email, first_name, business_name, status, note)
         VALUES ($1, $2, $3, 'queued', $4)
         ON CONFLICT (email) DO NOTHING`,
        [
          contact.email,
          contact.first_name || null,
          contact.business_name || null,
          contact.note || null
        ]
      )
      if (result.rowCount > 0) added++
      else skipped++
    } catch {
      skipped++
    }
  }
  return { added, skipped }
}

async function runDailyJobs() {
  const now = new Date()
  const hour = now.getUTCHours()
  const day = now.getUTCDay()
  await sendEventReminders().catch(e => console.error('Reminders error:', e.message))
  await sendTrialExpiryReminders().catch(e => console.error('Trial reminder error:', e.message))
  await sendOnboardingSequence().catch(e => console.error('Onboarding seq error:', e.message))
  await sendFreeToolNurtureEmails().catch(e => console.error('Tool nurture:', e.message))
  if (hour === 13) {
    await sendColdOutreach().catch(e => console.error('Cold outreach:', e.message))
  }
  if (day === 1 && hour === 9) {
    await generateAndScheduleWeeklyContent().catch(e => console.error('Content engine error:', e.message))
  }
  if (day === 3 && hour === 9) {
    await monitorRedditAndGenerateContent().catch(e => console.error('Reddit monitor error:', e.message))
  }
  const isSunday = day === 0
  const isAutoFillHour = hour === 6
  if (isSunday && isAutoFillHour) {
    const queueCheck = await pool.query(
      'SELECT COUNT(*) as count FROM cold_contacts WHERE status=$1',
      ['queued']
    ).catch(() => ({ rows: [{ count: '999' }] }))
    const queued = parseInt(queueCheck.rows[0]?.count || '0')
    if (queued < 100) {
      const cityData = US_CITIES[
        Math.floor(Math.random() * US_CITIES.length)
      ]
      findPhotographerEmails(cityData[0], cityData[1])
        .then(importFoundEmails)
        .then(r => console.log(`Auto-fill: +${r.added} from ${cityData[0]}`))
        .catch(e => console.error('Auto-fill:', e.message))
    }
  }
}

// runDailyJobs is started in startServer() after initDb() completes

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  try {
    const token = authHeader?.replace('Bearer ', '')
    if (!token) return res.status(401).json({ error: 'Unauthorized' })

    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      skipJwksCache: true,
    })

    const clerkId = payload.sub
    const clerkUser = await clerk.users.getUser(clerkId)
    const email = clerkUser.emailAddresses[0]?.emailAddress
    const fullName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || email?.split('@')[0] || 'User'

    console.log('Auth/me called:', { clerkId, email, hasClerkRecord: false, hasEmailRecord: false })

    const byClerk = await pool.query('SELECT * FROM users WHERE clerk_id=$1', [clerkId])
    console.log('By clerk:', byClerk.rows.length, 'records')

    if (byClerk.rows.length > 0) {
      console.log('Returning user found:', byClerk.rows[0].plan, 'onboarding:', byClerk.rows[0].onboarding_completed)
      req.user = byClerk.rows[0]
    } else {
      const byEmail = email ? await pool.query('SELECT * FROM users WHERE email=$1', [email]) : { rows: [] }
      console.log('By email:', byEmail.rows.length, 'records found')

      if (byEmail.rows.length > 0) {
        console.log('Re-signup detected - resetting account')
        const updated = await pool.query(
          `UPDATE users SET
            clerk_id = $1,
            plan = 'trial',
            trial_ends_at = NOW() + INTERVAL '14 days',
            onboarding_completed = FALSE,
            stripe_subscription_id = NULL,
            stripe_customer_id = NULL,
            stripe_connect_id = NULL,
            stripe_connect_enabled = FALSE
          WHERE email = $2
          RETURNING *`,
          [clerkId, email]
        )
        console.log('Account reset:', updated.rows[0]?.plan, 'onboarding:', updated.rows[0]?.onboarding_completed)
        req.user = updated.rows[0]
      } else {
        console.log('Creating new user')
        const base = ((email || '').split('@')[0]).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || 'photographer'
        let bookingUsername = base
        const taken = await pool.query('SELECT 1 FROM users WHERE booking_username=$1', [base])
        if (taken.rows.length) {
          bookingUsername = base.slice(0, 24) + Math.floor(Math.random() * 9000 + 1000)
        }
        const referralCode = 'PK' + Math.random().toString(36).substring(2, 8).toUpperCase()
        const newUser = await pool.query(
          `INSERT INTO users (clerk_id, email, full_name, plan, trial_ends_at, onboarding_completed, booking_username, referral_code)
           VALUES ($1, $2, $3, 'trial', NOW() + INTERVAL '14 days', FALSE, $4, $5)
           RETURNING *`,
          [clerkId, email, fullName, bookingUsername, referralCode]
        )
        console.log('New user created:', newUser.rows[0].id)
        req.user = newUser.rows[0]
      }
    }

    req.userId = String(req.user.id)

    if (process.env.NODE_ENV !== 'production') {
      console.log(`${req.method} ${req.path} — user ${req.user?.id}`)
    }

    // Onboarding must come first — a non-onboarded user (including re-signups
    // with plan='expired') must never hit the paywall before completing setup.
    const ONBOARDING_EXEMPT = ['/api/auth/me', '/api/users/me', '/api/stripe/', '/api/health', '/api/debug/']
    if (!req.user.onboarding_completed) {
      if (ONBOARDING_EXEMPT.some(r => req.path.startsWith(r))) {
        return next() // Let stripe/auth routes through so onboarding can proceed
      }
      return res.status(403).json({
        error: 'onboarding_required',
        message: 'Please complete onboarding first',
      })
    }

    const allowedAfterExpiry = ['/api/auth/me', '/api/users/me', '/api/stripe/create-checkout', '/api/stripe/create-portal', '/api/stripe/create-setup-intent', '/api/stripe/confirm-setup', '/api/health']
    const isExempt = allowedAfterExpiry.some(p => req.path.startsWith(p))

    // Collection reads that return REDACTED placeholder data to expired-trial users.
    // Real names/emails/contract content never leave the server (no F12 bypass).
    const blurReadRoutes = ['/api/clients', '/api/contracts', '/api/invoices', '/api/messages', '/api/files', '/api/dashboard/stats']

    if (req.user.plan === 'trial' && req.user.trial_ends_at && new Date() > new Date(req.user.trial_ends_at)) {
      req.trialExpired = true
      // Reads pass through so handlers can return redacted data; writes & everything else are blocked.
      const blurRead = req.method === 'GET' && blurReadRoutes.includes(req.path)
      if (!isExempt && !blurRead) {
        return res.status(402).json({
          error: 'Trial expired',
          message: 'Your 14-day trial has ended. Please upgrade to continue.',
          upgradeRequired: true,
        })
      }
    }

    // Non-paying plans get no data at all (frontend shows an upgrade overlay).
    if (['free', 'expired', 'cancelled'].includes(req.user.plan)) {
      if (!isExempt) {
        return res.status(402).json({
          error: 'Subscription required',
          message: 'Please upgrade to a paid plan to continue.',
          upgradeRequired: true,
        })
      }
    }

    if (req.user.plan === 'grace' && req.user.grace_period_ends_at) {
      if (new Date() > new Date(req.user.grace_period_ends_at)) {
        if (!isExempt) {
          return res.status(402).json({
            error: 'Payment failed',
            message: 'Please update your payment method to continue.',
            upgradeRequired: true,
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
       RETURNING id, clerk_id, full_name, email, business_name, plan, trial_ends_at, stripe_customer_id, logo_url, brand_color, billing_cycle, onboarding_completed, stripe_connect_id, stripe_connect_enabled, booking_username, created_at`,
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
  const { reason, comment } = req.body || {}
  try {
    await pool.query(
      'INSERT INTO cancellations (user_id, email, business_name, plan, reason, comment) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, req.user.email, req.user.business_name, req.user.plan, reason || null, comment || null]
    ).catch(() => {})

    if (resend) {
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: 'hello@getportalkit.com',
        subject: `PortalKit account deleted: ${reason || 'No reason given'}`,
        html: emailTemplate({
          title: 'Account Deleted',
          preheader: `A PortalKit account was just deleted`,
          body: `<h2 style="font-size:20px;color:#1A1208;margin:0 0 12px;">Account deleted</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
              <tr><td style="padding:6px 0;font-weight:600;">Email:</td><td>${req.user.email}</td></tr>
              <tr><td style="padding:6px 0;font-weight:600;">Business:</td><td>${req.user.business_name || '—'}</td></tr>
              <tr><td style="padding:6px 0;font-weight:600;">Plan:</td><td>${req.user.plan || '—'}</td></tr>
              <tr><td style="padding:6px 0;font-weight:600;">Reason:</td><td>${reason || '—'}</td></tr>
              <tr><td style="padding:6px 0;font-weight:600;">Comment:</td><td>${comment || '—'}</td></tr>
            </table>`,
          ctaText: null,
          ctaUrl: null,
          footerNote: 'PortalKit Internal Notification',
        }),
      }).catch(err => console.error('Cancellation notification email failed:', err))
    }

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

// Track referral code after signup (called by frontend once with ref from localStorage)
app.post('/api/auth/me', requireAuth, async (req, res) => {
  const { ref, affiliate_code } = req.body || {}
  if (ref && typeof ref === 'string' && ref.length <= 20) {
    try {
      const referrer = await pool.query('SELECT id, email FROM users WHERE referral_code=$1', [ref.toUpperCase()])
      if (referrer.rows.length > 0 && referrer.rows[0].id !== req.user.id) {
        await pool.query(
          `INSERT INTO referrals (referrer_user_id, referred_email, referred_user_id, status)
           VALUES ($1, $2, $3, 'signed_up')
           ON CONFLICT DO NOTHING`,
          [referrer.rows[0].id, req.user.email, req.user.id]
        )
        console.log(`🔗 Referral tracked: ${req.user.email} referred by ${referrer.rows[0].email}`)
      }
    } catch (refErr) {
      console.error('Referral tracking error:', refErr.message)
    }
  }
  if (affiliate_code && typeof affiliate_code === 'string' && affiliate_code.length <= 50) {
    try {
      const aff = await pool.query("SELECT id FROM affiliates WHERE affiliate_code=$1 AND status='active'", [affiliate_code.trim()])
      if (aff.rows.length > 0) {
        await pool.query('UPDATE users SET affiliate_id=$1 WHERE id=$2 AND affiliate_id IS NULL', [aff.rows[0].id, req.user.id])
        await pool.query('UPDATE affiliates SET total_referrals=total_referrals+1 WHERE id=$1', [aff.rows[0].id])
        console.log(`🤝 Affiliate tracked: user ${req.user.id} from affiliate ${affiliate_code}`)
      }
    } catch (affErr) {
      console.error('Affiliate tracking error:', affErr.message)
    }
  }
  res.json(req.user)
})

// ── REFERRALS ─────────────────────────────────────────────────

app.get('/api/referrals', requireAuth, async (req, res) => {
  try {
    const user = await pool.query('SELECT referral_code FROM users WHERE id=$1', [req.userId])
    const referralCode = user.rows[0]?.referral_code
    const referrals = await pool.query(
      'SELECT referred_email, referred_user_id, status, reward_given_at, created_at FROM referrals WHERE referrer_user_id=$1 ORDER BY created_at DESC',
      [req.userId]
    )
    const rows = referrals.rows
    const totalReferred = rows.filter(r => r.referred_user_id).length
    const totalConverted = rows.filter(r => r.status === 'converted').length
    const frontendUrl = process.env.FRONTEND_URL || 'https://getportalkit.com'
    res.json({
      referral_code: referralCode,
      referral_url: referralCode ? `${frontendUrl}/signup?ref=${referralCode}` : null,
      referrals: rows,
      total_referred: totalReferred,
      total_converted: totalConverted,
      months_earned: totalConverted,
    })
  } catch (err) {
    console.error('Get referrals error:', err)
    res.status(500).json({ error: 'Server error' })
  }
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
      details_submitted: account.details_submitted,
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

app.post('/api/stripe/connect/account-session', requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })

    if (!req.user.stripe_connect_id) {
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
      await pool.query(
        'UPDATE users SET stripe_connect_id=$1 WHERE id=$2',
        [account.id, req.user.id]
      )
      req.user.stripe_connect_id = account.id
    }

    const accountSession = await stripe.accountSessions.create({
      account: req.user.stripe_connect_id,
      components: {
        account_onboarding: { enabled: true },
      },
    })

    res.json({
      client_secret: accountSession.client_secret,
      account_id: req.user.stripe_connect_id,
    })
  } catch (err) {
    console.error('Account session error:', { message: err.message, type: err.type, code: err.code })
    res.status(500).json({ error: err.message || 'Failed to create account session' })
  }
})

app.post('/api/stripe/create-setup-intent', requireAuth, async (req, res) => {
  try {
    const { billingCycle = 'monthly' } = req.body
    console.log('💳 Creating setup intent for user:', req.user.id, 'cycle:', billingCycle)
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
      metadata: { user_id: String(req.user.id), billing_cycle: billingCycle },
    })

    res.json({ clientSecret: setupIntent.client_secret, customerId })
  } catch (err) {
    console.error('Setup intent error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/stripe/confirm-setup', requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })
    const { paymentMethodId, immediate, billingCycle = 'monthly' } = req.body
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId required' })

    const customerId = req.user.stripe_customer_id
    if (!customerId) return res.status(400).json({ error: 'No Stripe customer found' })

    const priceId = billingCycle === 'annual'
      ? process.env.STRIPE_PRICE_PORTALKIT_ANNUAL
      : process.env.STRIPE_PRICE_PORTALKIT
    if (!priceId) return res.status(500).json({ error: 'Price not configured' })

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })

    // immediate === activate-now flow (expired trial / upgrade modal): bill now, plan='active'.
    // Otherwise === onboarding flow: start the 14-day trial, plan='trial'.
    if (immediate) {
      const existingSub = req.user.stripe_subscription_id
      const hasRealSubscription = existingSub && existingSub !== 'manual_activation'
      if (hasRealSubscription) {
        await stripe.subscriptions.update(existingSub, {
          default_payment_method: paymentMethodId,
        })
        await pool.query("UPDATE users SET plan='active', billing_cycle=$1 WHERE id=$2", [billingCycle, req.user.id])
        console.log(`💳 Subscription reactivated for user ${req.user.id}: ${existingSub}`)
        return res.json({ success: true, subscription: existingSub })
      }
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        default_payment_method: paymentMethodId,
        metadata: { user_id: String(req.user.id), billing_cycle: billingCycle },
      })
      await pool.query(
        'UPDATE users SET stripe_subscription_id=$1, plan=$2, billing_cycle=$3 WHERE id=$4',
        [subscription.id, 'active', billingCycle, req.user.id]
      )
      console.log(`💳 Subscription activated for user ${req.user.id}: ${subscription.id}`)
      return res.json({ success: true, subscription: subscription.id })
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: 14,
      metadata: { user_id: String(req.user.id), billing_cycle: billingCycle },
    })

    await pool.query(
      'UPDATE users SET stripe_subscription_id=$1, plan=$2, billing_cycle=$3 WHERE id=$4',
      [subscription.id, 'trial', billingCycle, req.user.id]
    )

    console.log(`💳 Subscription created for user ${req.user.id}: ${subscription.id} (${billingCycle})`)
    res.json({ success: true, subscription: subscription.id })
  } catch (err) {
    console.error('💳 Confirm setup error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/stripe/switch-to-annual', requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })
    const annualPriceId = process.env.STRIPE_PRICE_PORTALKIT_ANNUAL
    if (!annualPriceId) return res.status(500).json({ error: 'Annual price not configured' })

    const subId = req.user.stripe_subscription_id
    if (!subId || subId === 'manual_activation') {
      return res.status(400).json({ error: 'No active subscription to switch' })
    }

    const subscription = await stripe.subscriptions.retrieve(subId)
    const itemId = subscription.items.data[0].id

    await stripe.subscriptions.update(subId, {
      items: [{ id: itemId, price: annualPriceId }],
      proration_behavior: 'always_invoice',
    })

    await pool.query("UPDATE users SET billing_cycle='annual' WHERE id=$1", [req.user.id])
    console.log(`💳 Switched user ${req.user.id} to annual billing`)
    res.json({ success: true })
  } catch (err) {
    console.error('💳 Switch to annual error:', err)
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
    const [clients, invoices, user, upcomingMain, upcomingEvents, stageCounts] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM clients WHERE user_id=$1', [req.userId]),
      pool.query("SELECT COUNT(*) FROM invoices WHERE user_id=$1 AND status != 'paid'", [req.userId]),
      pool.query('SELECT plan, trial_ends_at FROM users WHERE id=$1', [req.userId]),
      pool.query(`SELECT COUNT(*) FROM clients WHERE user_id=$1 AND event_date >= CURRENT_DATE AND event_date <= CURRENT_DATE + INTERVAL '30 days'`, [req.userId]),
      pool.query(`SELECT COUNT(*) FROM client_events ce JOIN clients c ON ce.client_id = c.id WHERE c.user_id=$1 AND ce.event_date >= CURRENT_DATE AND ce.event_date <= CURRENT_DATE + INTERVAL '30 days'`, [req.userId]),
      pool.query(`SELECT COALESCE(stage,'inquiry') as stage, COUNT(*) FROM clients WHERE user_id=$1 GROUP BY stage`, [req.userId]),
    ])
    const u = user.rows[0]
    let trial_days_remaining = null
    if (u && u.plan !== 'active' && u.trial_ends_at) {
      const diff = new Date(u.trial_ends_at).getTime() - Date.now()
      trial_days_remaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
    }
    const clientCount = parseInt(clients.rows[0].count, 10)
    const pipeline_counts = { inquiry: 0, consultation: 0, booked: 0, in_progress: 0, delivered: 0, archived: 0 }
    for (const row of stageCounts.rows) {
      if (row.stage in pipeline_counts) pipeline_counts[row.stage] = parseInt(row.count, 10)
    }
    res.json({
      total_clients: clientCount,
      active_portals: clientCount,
      pending_invoices: parseInt(invoices.rows[0].count, 10),
      upcoming_events: parseInt(upcomingMain.rows[0].count, 10) + parseInt(upcomingEvents.rows[0].count, 10),
      trial_days_remaining,
      pipeline_counts,
      _expired: !!req.trialExpired,
    })
  } catch (err) {
    console.error('Dashboard stats error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CLIENTS ───────────────────────────────────────────────────

app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    if (req.trialExpired) {
      const countRes = await pool.query('SELECT COUNT(*) as count FROM clients WHERE user_id=$1', [req.userId])
      const count = parseInt(countRes.rows[0].count, 10)
      const placeholders = Array(Math.min(count, 5)).fill(null).map((_, i) => ({
        id: -(i + 1), name: '██████████', email: '████@████.com',
        phone: null, event_date: '████-██-██', event_type: '██████',
        notes: null, portal_token: '', stage: 'booked', _blurred: true,
      }))
      return res.json(placeholders)
    }
    if (req.query.page !== undefined) {
      const page = parseInt(req.query.page) || 1
      const limit = parseInt(req.query.limit) || 50
      const offset = (page - 1) * limit
      const [result, countRes] = await Promise.all([
        pool.query(
          `SELECT c.id, c.name, c.email, c.phone, c.event_date, c.event_type, c.notes, c.portal_token, c.stage, c.stage_changed_at, c.gallery_url, c.secondary_name, c.secondary_email, c.secondary_phone, c.created_at, c.updated_at, sl.status as shot_list_status
           FROM clients c LEFT JOIN shot_lists sl ON sl.client_id = c.id
           WHERE c.user_id=$1 ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
          [req.userId, limit, offset]
        ),
        pool.query('SELECT COUNT(*) as total FROM clients WHERE user_id=$1', [req.userId])
      ])
      const total = parseInt(countRes.rows[0].total)
      return res.json({ clients: result.rows, total, page, pages: Math.ceil(total / limit) })
    }
    const result = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.event_date, c.event_type, c.notes, c.portal_token, c.stage, c.stage_changed_at, c.gallery_url, c.secondary_name, c.secondary_email, c.secondary_phone, c.created_at, c.updated_at, sl.status as shot_list_status
       FROM clients c
       LEFT JOIN shot_lists sl ON sl.client_id = c.id
       WHERE c.user_id=$1 ORDER BY c.created_at DESC LIMIT 200`,
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
    const client = result.rows[0]

    if (email && resend) {
      const wsRes = await pool.query('SELECT * FROM workflow_settings WHERE user_id=$1', [req.userId])
      const ws = wsRes.rows[0]
      if (ws?.send_welcome_on_client_create) {
        const biz = req.user.business_name || req.user.full_name || 'Your photographer'
        const portalLink = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${client.portal_token}`
        resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          reply_to: "hello@getportalkit.com",
          to: email,
          subject: `Welcome to ${biz}'s client portal`,
          html: emailTemplate({
            title: 'Welcome!',
            preheader: 'Your client portal is ready',
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Hi ${sanitize(name)}!</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">You've been added to ${biz}'s client portal.</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">${ws.welcome_message || 'Looking forward to working with you!'}</p>`,
            ctaText: 'View Your Portal →',
            ctaUrl: portalLink,
            footerNote: `Sent by ${biz}`,
          }),
        }).catch(err => console.error('Welcome email failed:', err))
      }
    }

    res.status(201).json(client)
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
  const { name, email, phone, event_date, event_type, notes, gallery_url, secondary_name, secondary_email, secondary_phone } = req.body
  try {
    const result = await pool.query(
      `UPDATE clients SET name=$1, email=$2, phone=$3, event_date=$4, event_type=$5, notes=$6,
       gallery_url=$7, secondary_name=$8, secondary_email=$9, secondary_phone=$10, updated_at=NOW()
       WHERE id=$11 AND user_id=$12 RETURNING *`,
      [sanitize(name), email || null, sanitize(phone) || null, event_date || null, sanitize(event_type) || null, sanitize(notes) || null,
       gallery_url || null, sanitize(secondary_name) || null, secondary_email || null, sanitize(secondary_phone) || null,
       req.params.id, req.userId]
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
    if (req.trialExpired) {
      const countRes = await pool.query('SELECT COUNT(*) as count FROM contracts WHERE user_id=$1', [req.userId])
      const count = parseInt(countRes.rows[0].count, 10)
      const placeholders = Array(Math.min(count, 5)).fill(null).map((_, i) => ({
        id: i + 1, client_name: '████████', title: '████████████',
        content: null, status: 'sent', created_at: new Date().toISOString(), _blurred: true,
      }))
      return res.json(placeholders)
    }
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
    if (req.trialExpired) {
      const countRes = await pool.query('SELECT COUNT(*) as count FROM invoices WHERE user_id=$1', [req.userId])
      const count = parseInt(countRes.rows[0].count, 10)
      const placeholders = Array(Math.min(count, 5)).fill(null).map((_, i) => ({
        id: i + 1, client_name: '████████', invoice_number: '████',
        amount_cents: 0, status: 'sent', due_date: null,
        created_at: new Date().toISOString(), _blurred: true,
      }))
      return res.json(placeholders)
    }
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
            reply_to: "hello@getportalkit.com",
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
          reply_to: "hello@getportalkit.com",
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
          reply_to: "hello@getportalkit.com",
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

const presignedUrlCache = new Map()

async function generateDownloadUrl(storageKey) {
  if (!r2 || !storageKey) return null
  const cached = presignedUrlCache.get(storageKey)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }), { expiresIn: 3600 })

  presignedUrlCache.set(storageKey, { url, expiresAt: Date.now() + 50 * 60 * 1000 })

  if (presignedUrlCache.size > 1000) {
    const now = Date.now()
    for (const [k, v] of presignedUrlCache.entries()) {
      if (v.expiresAt < now) presignedUrlCache.delete(k)
    }
  }

  return url
}

app.post('/api/files/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    let client_id = req.body.client_id ? parseInt(req.body.client_id) : null
    const gallery_id = req.body.gallery_id ? parseInt(req.body.gallery_id) : null

    if (gallery_id) {
      // Derive client_id from gallery, verify ownership
      const galleryCheck = await pool.query('SELECT client_id FROM galleries WHERE id=$1 AND user_id=$2', [gallery_id, req.userId])
      if (!galleryCheck.rows.length) return res.status(404).json({ error: 'Gallery not found' })
      client_id = galleryCheck.rows[0].client_id
    } else if (client_id) {
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
      `INSERT INTO files (user_id, client_id, gallery_id, filename, original_name, mime_type, size_bytes, storage_url, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.userId, client_id || null, gallery_id || null, storageKey, req.file.originalname, req.file.mimetype, req.file.size, storageUrl, storageKey]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('File upload error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/files', requireAuth, async (req, res) => {
  try {
    if (req.trialExpired) return res.json([])
    const page = req.query.page !== undefined ? parseInt(req.query.page) || 1 : null
    const limit = parseInt(req.query.limit) || 50
    const offset = page ? (page - 1) * limit : 0
    const result = await pool.query(
      `SELECT f.*, cl.name as client_name FROM files f
       LEFT JOIN clients cl ON cl.id = f.client_id
       WHERE f.user_id=$1 ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
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

// ── GALLERY DELIVERY SYSTEM ───────────────────────────────────

app.get('/api/galleries', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.*,
              (SELECT COUNT(*) FROM files WHERE gallery_id = g.id)::int as file_count,
              c.name as client_name, c.portal_token, c.event_date, c.event_type,
              cf.storage_url as cover_url, cf.storage_key as cover_storage_key,
              first_img.storage_url as preview_url, first_img.storage_key as preview_storage_key
       FROM galleries g
       JOIN clients c ON g.client_id = c.id
       LEFT JOIN files cf ON cf.id = g.cover_file_id
       LEFT JOIN LATERAL (
         SELECT storage_url, storage_key
         FROM files
         WHERE gallery_id = g.id AND mime_type LIKE 'image/%'
         ORDER BY display_order ASC, created_at ASC
         LIMIT 1
       ) first_img ON true
       WHERE g.user_id = $1
       ORDER BY g.created_at DESC
       LIMIT 100`,
      [req.userId]
    )
    const rows = await Promise.all(result.rows.map(async row => {
      if (row.cover_storage_key && r2) {
        row.cover_url = await generateDownloadUrl(row.cover_storage_key).catch(() => row.cover_url)
      }
      if (row.preview_storage_key && r2) {
        row.preview_url = await generateDownloadUrl(row.preview_storage_key).catch(() => row.preview_url)
      }
      return row
    }))
    res.json(rows)
  } catch (err) {
    console.error('Get galleries error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/galleries/:id', requireAuth, async (req, res) => {
  try {
    const galleryResult = await pool.query(
      `SELECT g.*, c.name as client_name, c.portal_token, c.event_date, c.event_type, c.email as client_email
       FROM galleries g JOIN clients c ON g.client_id = c.id
       WHERE g.id=$1 AND g.user_id=$2`,
      [req.params.id, req.userId]
    )
    if (!galleryResult.rows.length) return res.status(404).json({ error: 'Gallery not found' })
    const gallery = galleryResult.rows[0]

    const filesResult = await pool.query(
      `SELECT * FROM files WHERE gallery_id=$1 ORDER BY display_order ASC, created_at ASC`,
      [gallery.id]
    )
    const files = await Promise.all(filesResult.rows.map(async f => {
      if (f.storage_key && r2) f.storage_url = await generateDownloadUrl(f.storage_key).catch(() => f.storage_url)
      return f
    }))
    res.json({ ...gallery, files })
  } catch (err) {
    console.error('Get gallery error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/galleries', requireAuth, async (req, res) => {
  try {
    const { client_id, name, description, allow_downloads = true, allow_favorites = true, password_protected = false, password } = req.body
    if (!client_id) return res.status(400).json({ error: 'client_id is required' })
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [client_id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const result = await pool.query(
      `INSERT INTO galleries (user_id, client_id, name, description, allow_downloads, allow_favorites, password_protected, password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.userId, client_id, name || 'Wedding Gallery', description || null, allow_downloads, allow_favorites, password_protected, password_protected ? password : null]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('Create gallery error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/galleries/:id', requireAuth, async (req, res) => {
  try {
    console.log(`PUT /api/galleries/${req.params.id} body:`, JSON.stringify(req.body))
    const current = await pool.query(
      `SELECT g.*, c.name as client_name, c.email as client_email, c.portal_token
       FROM galleries g JOIN clients c ON g.client_id = c.id
       WHERE g.id=$1 AND g.user_id=$2`,
      [req.params.id, req.userId]
    )
    if (!current.rows.length) return res.status(404).json({ error: 'Gallery not found' })
    const prev = current.rows[0]

    const { name, description, status, allow_downloads, allow_favorites, password_protected, password, cover_file_id } = req.body
    const delivering = (status === 'delivered' && prev.status !== 'delivered') || req.body.force_email === true

    const updates = []
    const vals = []
    let idx = 1

    if (name !== undefined) { updates.push(`name=$${idx++}`); vals.push(name) }
    if (description !== undefined) { updates.push(`description=$${idx++}`); vals.push(description) }
    if (status !== undefined) {
      updates.push(`status=$${idx++}`)
      vals.push(status)
      if (status === 'delivered' && prev.status !== 'delivered') updates.push(`delivered_at=NOW()`)
    }
    if (allow_downloads !== undefined) { updates.push(`allow_downloads=$${idx++}`); vals.push(allow_downloads) }
    if (allow_favorites !== undefined) { updates.push(`allow_favorites=$${idx++}`); vals.push(allow_favorites) }
    if (password_protected !== undefined) { updates.push(`password_protected=$${idx++}`); vals.push(password_protected) }
    if (password !== undefined && password !== null && password !== '') {
      updates.push(`password=$${idx++}`)
      vals.push(password)
    } else if (password_protected === false) {
      updates.push(`password=NULL`)
    }
    if (cover_file_id !== undefined) { updates.push(`cover_file_id=$${idx++}`); vals.push(cover_file_id) }

    console.log('Gallery password save:', { id: req.params.id, password_protected, password_set: !!(password !== undefined && password !== null && password !== ''), updates })

    if (updates.length === 0) return res.json(prev)

    vals.push(req.params.id, req.userId)
    const idIdx = idx; const uidIdx = idx + 1

    const result = await pool.query(
      `UPDATE galleries SET ${updates.join(', ')} WHERE id=$${idIdx} AND user_id=$${uidIdx} RETURNING *`,
      vals
    )

    if (delivering && resend && prev.client_email) {
      try {
        const photoCount = (await pool.query('SELECT COUNT(*) FROM files WHERE gallery_id=$1', [req.params.id])).rows[0].count
        const portalLink = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${prev.portal_token}`
        const userResult = await pool.query('SELECT business_name, full_name FROM users WHERE id=$1', [req.userId])
        const bizName = userResult.rows[0]?.business_name || userResult.rows[0]?.full_name || 'Your photographer'
        const clientFirst = prev.client_name?.split(' ')[0] || 'there'
        await resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          reply_to: "hello@getportalkit.com",
          to: prev.client_email,
          subject: 'Your wedding photos are ready! 📸',
          html: emailTemplate({
            title: 'Your photos are ready!',
            preheader: `Your wedding gallery from ${bizName} is ready to view`,
            body: `<h2 style="font-size:24px;color:#1A1208;margin:0 0 12px;">Hi ${clientFirst}!</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Your wedding photos from <strong>${bizName}</strong> are ready to view and download.</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;"><strong>${photoCount} photo${photoCount == 1 ? '' : 's'}</strong> are waiting for you in your private gallery.</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">You can view, favorite, and download your photos directly from your client portal.</p>`,
            ctaText: 'View Your Gallery →',
            ctaUrl: portalLink,
            footerNote: `Delivered by ${bizName} via PortalKit`,
          }),
        })
        console.log(`📧 Gallery delivery email sent to ${prev.client_email}`)
      } catch (emailErr) {
        console.error('Gallery delivery email failed:', emailErr)
      }
    }

    res.json(result.rows[0])
  } catch (err) {
    console.error('Update gallery error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/galleries/:id', requireAuth, async (req, res) => {
  try {
    const galleryCheck = await pool.query('SELECT id FROM galleries WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!galleryCheck.rows.length) return res.status(404).json({ error: 'Gallery not found' })
    // Delete all R2 files in gallery
    const filesResult = await pool.query('SELECT storage_key FROM files WHERE gallery_id=$1 AND user_id=$2', [req.params.id, req.userId])
    await Promise.all(filesResult.rows.map(f => f.storage_key && r2
      ? r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: f.storage_key })).catch(() => {})
      : Promise.resolve()
    ))
    await pool.query('DELETE FROM galleries WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    console.error('Delete gallery error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/galleries/:id/add-files', requireAuth, async (req, res) => {
  try {
    const { file_ids } = req.body
    if (!Array.isArray(file_ids) || file_ids.length === 0) return res.status(400).json({ error: 'file_ids required' })
    const galleryCheck = await pool.query('SELECT id FROM galleries WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!galleryCheck.rows.length) return res.status(404).json({ error: 'Gallery not found' })
    await pool.query(
      'UPDATE files SET gallery_id=$1 WHERE id = ANY($2::int[]) AND user_id=$3',
      [req.params.id, file_ids, req.userId]
    )
    res.json({ success: true })
  } catch (err) {
    console.error('Add files to gallery error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.patch('/api/files/:id/gallery-order', requireAuth, async (req, res) => {
  try {
    const { display_order } = req.body
    if (display_order === undefined) return res.status(400).json({ error: 'display_order required' })
    const result = await pool.query(
      'UPDATE files SET display_order=$1 WHERE id=$2 AND user_id=$3 RETURNING id, display_order',
      [display_order, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'File not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('Gallery order error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── PUBLIC GALLERY ROUTES ─────────────────────────────────────

app.get('/api/portals/:token/gallery', async (req, res) => {
  try {
    console.log(`GET /api/portals/${req.params.token}/gallery password-header:`, req.headers['x-gallery-password'] ? 'provided' : 'none')
    const clientResult = await pool.query(
      `SELECT c.id FROM clients c WHERE c.portal_token=$1`,
      [req.params.token]
    )
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const client_id = clientResult.rows[0].id

    const galleryResult = await pool.query(
      `SELECT g.*, COUNT(f.id)::int as file_count FROM galleries g
       LEFT JOIN files f ON f.gallery_id = g.id
       WHERE g.client_id=$1 AND g.status != 'hidden'
       GROUP BY g.id ORDER BY g.created_at DESC LIMIT 1`,
      [client_id]
    )
    if (!galleryResult.rows.length) return res.status(404).json({ error: 'No gallery available' })
    const gallery = galleryResult.rows[0]

    if (gallery.password_protected) {
      const provided = (req.headers['x-gallery-password'] || '').trim()
      const stored = (gallery.password || '').trim()
      console.log('Gallery auth check:', {
        gallery_id: gallery.id,
        password_protected: gallery.password_protected,
        stored_password: stored ? '[HAS PASSWORD]' : '[NULL/EMPTY]',
        provided_header: provided ? '[PROVIDED]' : '[NONE]',
        match: provided === stored,
      })
      if (!provided || provided !== stored) {
        return res.status(401).json({ error: 'incorrect_password' })
      }
    }

    const filesResult = await pool.query(
      `SELECT id, original_name, mime_type, size_bytes, storage_url, storage_key, caption, display_order, is_favorite, created_at
       FROM files WHERE gallery_id=$1 ORDER BY display_order ASC, created_at ASC`,
      [gallery.id]
    )
    const files = await Promise.all(filesResult.rows.map(async f => {
      if (f.storage_key && r2) f.storage_url = await generateDownloadUrl(f.storage_key).catch(() => f.storage_url)
      return f
    }))

    res.json({ ...gallery, password: undefined, files })
  } catch (err) {
    console.error('Portal gallery error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/portals/:token/gallery/favorites', async (req, res) => {
  try {
    const clientResult = await pool.query(`SELECT c.id FROM clients c WHERE c.portal_token=$1`, [req.params.token])
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const galleryResult = await pool.query(`SELECT g.id FROM galleries g WHERE g.client_id=$1 AND g.status != 'hidden' LIMIT 1`, [clientResult.rows[0].id])
    if (!galleryResult.rows.length) return res.json([])
    const favs = await pool.query(
      `SELECT file_id FROM gallery_favorites WHERE gallery_id=$1 AND client_token=$2`,
      [galleryResult.rows[0].id, req.params.token]
    )
    res.json(favs.rows.map(r => r.file_id))
  } catch (err) {
    console.error('Gallery favorites error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/portals/:token/gallery/favorite/:fileId', async (req, res) => {
  try {
    const clientResult = await pool.query(`SELECT c.id FROM clients c WHERE c.portal_token=$1`, [req.params.token])
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const galleryResult = await pool.query(`SELECT g.id FROM galleries g WHERE g.client_id=$1 AND g.allow_favorites=TRUE AND g.status != 'hidden' LIMIT 1`, [clientResult.rows[0].id])
    if (!galleryResult.rows.length) return res.status(404).json({ error: 'Gallery not found' })
    const gallery_id = galleryResult.rows[0].id
    const file_id = parseInt(req.params.fileId)
    const existing = await pool.query(`SELECT id FROM gallery_favorites WHERE gallery_id=$1 AND file_id=$2 AND client_token=$3`, [gallery_id, file_id, req.params.token])
    if (existing.rows.length) {
      await pool.query(`DELETE FROM gallery_favorites WHERE gallery_id=$1 AND file_id=$2 AND client_token=$3`, [gallery_id, file_id, req.params.token])
      res.json({ favorited: false })
    } else {
      await pool.query(`INSERT INTO gallery_favorites (gallery_id, file_id, client_token) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [gallery_id, file_id, req.params.token])
      res.json({ favorited: true })
    }
  } catch (err) {
    console.error('Gallery favorite error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/portals/:token/gallery/download-request', async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.id, c.name, c.portal_token, u.email as photographer_email, u.business_name, u.full_name
       FROM clients c JOIN users u ON c.user_id = u.id
       WHERE c.portal_token=$1`,
      [req.params.token]
    )
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const c = clientResult.rows[0]
    const galleryResult = await pool.query(`SELECT id FROM galleries g WHERE g.client_id=$1 AND g.status='delivered' LIMIT 1`, [c.id])
    if (!galleryResult.rows.length) return res.status(404).json({ error: 'Gallery not found' })

    const filesResult = await pool.query(
      `SELECT storage_url, storage_key FROM files WHERE gallery_id=$1 AND mime_type LIKE 'image/%' ORDER BY display_order ASC, created_at ASC`,
      [galleryResult.rows[0].id]
    )
    const urls = await Promise.all(filesResult.rows.map(async f => {
      if (f.storage_key && r2) return generateDownloadUrl(f.storage_key).catch(() => f.storage_url)
      return f.storage_url
    }))

    if (resend && c.photographer_email) {
      const bizName = c.business_name || c.full_name || 'Your photographer'
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: c.photographer_email,
        subject: `${c.name} has downloaded their gallery`,
        html: emailTemplate({
          title: 'Gallery Download',
          preheader: `${c.name} has downloaded their gallery`,
          body: `<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;"><strong>${c.name}</strong> just downloaded their gallery from their client portal.</p>`,
          ctaText: 'View client →',
          ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${c.portal_token}`,
          footerNote: bizName,
        }),
      }).catch(() => {})
    }

    res.json({ download_urls: urls.filter(Boolean) })
  } catch (err) {
    console.error('Download request error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── CLIENT PORTAL (public) ────────────────────────────────────

app.get('/api/portals/:token', async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.id, c.name, c.event_date, c.event_type, c.portal_token,
              c.gallery_url, c.secondary_name,
              u.full_name as photographer_name, u.business_name as photographer_business,
              u.logo_url as photographer_logo, u.brand_color as photographer_brand_color,
              (u.stripe_connect_enabled = TRUE AND u.stripe_connect_id IS NOT NULL) as payments_enabled
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
        `SELECT id, original_name, mime_type, size_bytes, storage_url, storage_key, created_at FROM files WHERE client_id=$1 AND gallery_id IS NULL ORDER BY created_at DESC`,
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
          reply_to: "hello@getportalkit.com",
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
          reply_to: "hello@getportalkit.com",
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
  if (req.trialExpired) return res.json([])
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
          reply_to: "hello@getportalkit.com",
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
          reply_to: "hello@getportalkit.com",
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

const paymentAttempts = new Map()

app.post('/api/portals/:token/invoices/:invoiceId/pay', async (req, res) => {
  try {
    // Rate limit: max 5 payment attempts per portal token per hour
    const attempts = (paymentAttempts.get(req.params.token) || [])
      .filter(t => Date.now() - t < 3600000)
    if (attempts.length >= 5) {
      return res.status(429).json({ error: 'Too many payment attempts. Try again later.' })
    }
    paymentAttempts.set(req.params.token, [...attempts, Date.now()])

    console.log('💳 Payment attempt:', {
      token: req.params.token.slice(0, 8) + '...',
      invoiceId: req.params.invoiceId,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      time: new Date().toISOString(),
    })

    const clientResult = await pool.query(
      `SELECT c.*, u.stripe_connect_id, u.stripe_connect_enabled,
              u.business_name as photographer_business, u.full_name as photographer_name
       FROM clients c JOIN users u ON u.id = c.user_id
       WHERE c.portal_token=$1`,
      [req.params.token]
    )
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const client = clientResult.rows[0]

    if (!client.stripe_connect_id || !client.stripe_connect_enabled) {
      return res.status(400).json({ error: 'Photographer has not set up payments yet' })
    }

    // Invoice must belong to THIS client (prevents cross-portal payment)
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE id=$1 AND client_id=$2',
      [req.params.invoiceId, client.id]
    )
    if (!invoiceResult.rows.length) return res.status(404).json({ error: 'Invoice not found' })
    const invoice = invoiceResult.rows[0]

    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'This invoice has already been paid.' })
    }

    if (!stripe) return res.status(503).json({ error: 'Payments not configured' })

    // Amount is ALWAYS taken from the database, never from the request body
    const applicationFeeAmount = Math.round(invoice.amount_cents * 0.02)
    const idempotencyKey = `invoice_${req.params.invoiceId}_${req.params.token.slice(0, 8)}`
    const paymentIntent = await stripe.paymentIntents.create({
      amount: invoice.amount_cents,
      currency: 'usd',
      application_fee_amount: applicationFeeAmount,
      transfer_data: { destination: client.stripe_connect_id },
      metadata: {
        invoice_id: String(invoice.id),
        client_id: String(client.id),
        invoice_number: invoice.invoice_number || '',
        client_email: client.email || '',
        portal_token: req.params.token,
        photographer_name: client.photographer_business || client.photographer_name || 'Your photographer',
      },
    }, { idempotencyKey })

    res.json({
      clientSecret: paymentIntent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    })
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

app.post('/api/ai/generate-proposal', requireAuth, aiLimiter, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI not configured — set ANTHROPIC_API_KEY' })
  const now = Date.now()
  const timestamps = (aiRateLimit.get(req.userId) || []).filter(t => now - t < 3_600_000)
  if (timestamps.length >= 10) return res.status(429).json({ error: 'Rate limit: 10 AI requests per hour' })
  const allowed = await checkAndIncrementAiCalls(req.userId)
  if (!allowed) return res.status(429).json({ error: 'Daily AI limit reached (20/day)' })
  aiRateLimit.set(req.userId, [...timestamps, now])
  const { client_id, notes: rawNotes } = req.body
  const notes = rawNotes ? sanitizePrompt(String(rawNotes)) : ''
  try {
    const userResult = await pool.query('SELECT business_name, full_name FROM users WHERE id=$1', [req.userId])
    const photographer = userResult.rows[0]
    const businessName = photographer?.business_name || photographer?.full_name || 'the photographer'
    let clientContext = 'a photography client'
    if (client_id) {
      const r = await pool.query('SELECT name, event_type, event_date, notes FROM clients WHERE id=$1 AND user_id=$2', [client_id, req.userId])
      if (r.rows.length) {
        const c = r.rows[0]
        clientContext = `Client: ${c.name}. Event: ${c.event_type || 'photography session'}. Date: ${c.event_date ? new Date(c.event_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'TBD'}.`
      }
    }
    const userPrompt = `Generate 3 wedding photography packages (Silver, Gold, Platinum) for ${businessName}. Client: ${clientContext}. ${notes ? 'Extra context: ' + notes : ''} Return ONLY valid JSON with this exact shape: {"packages":[{"name":"Silver","description":"...","price_cents":0,"deposit_cents":0,"features":["..."]},...],"message":"..."} where message is a warm 2-sentence proposal intro.`
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: 'You are a pricing expert for professional wedding photographers. Return only valid JSON, no markdown, no code fences.',
      messages: [{ role: 'user', content: userPrompt }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(500).json({ error: 'AI returned invalid response' })
    const parsed = JSON.parse(jsonMatch[0])
    res.json(parsed)
  } catch (err) {
    console.error('AI proposal error:', err.message)
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

app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT NOW()')
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      db: 'connected',
      dbTime: dbCheck.rows[0].now,
      uptime: process.uptime(),
      memory: process.memoryUsage().heapUsed,
      version: '1.0.0',
    })
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message })
  }
})

app.get('/api/test-email', async (req, res) => {
  console.log('📧 Resend configured:', !!process.env.RESEND_API_KEY)
  if (!resend) return res.status(503).json({ error: 'Resend not configured — set RESEND_API_KEY', configured: false })
  try {
    const result = await resend.emails.send({
      from: 'PortalKit <hello@mail.getportalkit.com>',
      reply_to: "hello@getportalkit.com",
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


// ── CRM PIPELINE ──────────────────────────────────────────────

const VALID_STAGES = ['inquiry','consultation','booked','in_progress','delivered','archived']

app.get('/api/pipeline/stats', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COALESCE(c.stage, 'inquiry') as stage,
             COUNT(DISTINCT c.id) as client_count,
             COALESCE(SUM(i.amount_cents), 0) as total_cents
      FROM clients c
      LEFT JOIN invoices i ON i.client_id = c.id AND i.status != 'paid'
      WHERE c.user_id = $1
      GROUP BY COALESCE(c.stage, 'inquiry')`, [req.userId])
    res.json(result.rows)
  } catch (err) {
    console.error('Pipeline stats error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.patch('/api/clients/:id/stage', requireAuth, async (req, res) => {
  const { stage } = req.body
  if (!VALID_STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' })
  try {
    const result = await pool.query(
      'UPDATE clients SET stage=$1, stage_changed_at=NOW(), updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *',
      [stage, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Client not found' })
    const client = result.rows[0]

    if (stage === 'delivered' && client.email && resend) {
      const wsRes = await pool.query('SELECT * FROM workflow_settings WHERE user_id=$1', [req.userId])
      const ws = wsRes.rows[0]
      if (ws?.send_thank_you_on_delivery) {
        const biz = req.user.business_name || req.user.full_name || 'Your photographer'
        const portalLink = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${client.portal_token}`
        const reviewLinks = [
          ws?.google_review_url && `<a href="${ws.google_review_url}" style="display:inline-block;margin:4px 6px;padding:8px 16px;background:#4285F4;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;">⭐ Google Review</a>`,
          ws?.wedding_wire_url && `<a href="${ws.wedding_wire_url}" style="display:inline-block;margin:4px 6px;padding:8px 16px;background:#AE0C00;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;">💍 WeddingWire</a>`,
          ws?.the_knot_url && `<a href="${ws.the_knot_url}" style="display:inline-block;margin:4px 6px;padding:8px 16px;background:#FF69B4;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;">💐 The Knot</a>`,
          ws?.facebook_review_url && `<a href="${ws.facebook_review_url}" style="display:inline-block;margin:4px 6px;padding:8px 16px;background:#1877F2;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;">👍 Facebook</a>`,
        ].filter(Boolean)
        const reviewSection = (ws?.send_review_request_on_delivery !== false && reviewLinks.length)
          ? `<p style="color:#6B5E4A;line-height:1.6;margin:16px 0 8px;">If you loved your experience, I'd be so grateful for a review:</p><div style="margin:8px 0 16px;">${reviewLinks.join('')}</div>`
          : `<p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">If you loved your experience, I'd be so grateful for a referral or review.</p>`
        const toList = [client.email, client.secondary_email].filter(Boolean)
        resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          reply_to: "hello@getportalkit.com",
          to: toList,
          subject: `Thank you, ${client.name}! — ${biz}`,
          html: emailTemplate({
            title: 'Thank you!',
            preheader: 'It was a pleasure working with you',
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Thank you, ${client.name}!</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">${ws.thank_you_message || `It was an absolute pleasure working with you. Your photos are ready in your client portal!`}</p>${reviewSection}`,
            ctaText: 'View Your Portal →',
            ctaUrl: portalLink,
            footerNote: `Sent by ${biz}`,
          }),
        }).catch(err => console.error('Thank you email failed:', err))
      }
    }

    res.json(client)
  } catch (err) {
    console.error('Stage update error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── QUESTIONNAIRE TEMPLATES ────────────────────────────────────

app.get('/api/questionnaire-templates', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM questionnaire_templates WHERE user_id=$1 ORDER BY created_at DESC', [req.userId])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/questionnaire-templates', requireAuth, async (req, res) => {
  const { name, questions } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Template name is required' })
  try {
    const result = await pool.query(
      'INSERT INTO questionnaire_templates (user_id, name, questions) VALUES ($1,$2,$3) RETURNING *',
      [req.userId, sanitize(name), JSON.stringify(questions || [])]
    )
    res.status(201).json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/questionnaire-templates/:id', requireAuth, async (req, res) => {
  const { name, questions } = req.body
  try {
    const result = await pool.query(
      'UPDATE questionnaire_templates SET name=$1, questions=$2 WHERE id=$3 AND user_id=$4 RETURNING *',
      [sanitize(name), JSON.stringify(questions || []), req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Template not found' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.delete('/api/questionnaire-templates/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM questionnaire_templates WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── QUESTIONNAIRE RESPONSES ────────────────────────────────────

app.get('/api/questionnaires', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT qr.*, c.name as client_name, c.email as client_email
      FROM questionnaire_responses qr
      LEFT JOIN clients c ON qr.client_id = c.id
      WHERE qr.user_id=$1
      ORDER BY qr.created_at DESC
    `, [req.userId])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/questionnaires', requireAuth, async (req, res) => {
  const { template_id, client_id, title } = req.body
  if (!client_id || !title?.trim()) return res.status(400).json({ error: 'client_id and title are required' })
  try {
    let questions = []
    if (template_id) {
      const tpl = await pool.query('SELECT questions FROM questionnaire_templates WHERE id=$1 AND user_id=$2', [template_id, req.userId])
      if (tpl.rows.length) questions = tpl.rows[0].questions
    }
    const result = await pool.query(
      `INSERT INTO questionnaire_responses (template_id, client_id, user_id, title, questions, sent_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [template_id || null, client_id, req.userId, sanitize(title), JSON.stringify(questions)]
    )
    const qr = result.rows[0]

    const clientRes = await pool.query('SELECT email, name, portal_token FROM clients WHERE id=$1 AND user_id=$2', [client_id, req.userId])
    const client = clientRes.rows[0]
    if (client?.email && resend) {
      const biz = req.user.business_name || req.user.full_name || 'Your photographer'
      const portalLink = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${client.portal_token}`
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: client.email,
        subject: `Please fill out your questionnaire — ${biz}`,
        html: emailTemplate({
          title: 'Questionnaire ready for you',
          preheader: `${biz} sent you a questionnaire to fill out`,
          body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Hi ${client.name}!</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">${biz} has sent you a questionnaire: <strong>${sanitize(title)}</strong>. It only takes a few minutes to fill out and helps them prepare for your session.</p>`,
          ctaText: 'Fill Out Questionnaire →',
          ctaUrl: portalLink,
          footerNote: `Sent by ${biz} via PortalKit`,
        }),
      }).catch(err => console.error('Questionnaire email failed:', err))
    }

    res.status(201).json(qr)
  } catch (err) {
    console.error('Send questionnaire error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/questionnaires/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT qr.*, c.name as client_name FROM questionnaire_responses qr LEFT JOIN clients c ON qr.client_id = c.id WHERE qr.id=$1 AND qr.user_id=$2',
      [req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Questionnaire not found' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── PORTAL: QUESTIONNAIRES ─────────────────────────────────────

app.get('/api/portals/:token/questionnaires', async (req, res) => {
  try {
    const clientRes = await pool.query('SELECT id FROM clients WHERE portal_token=$1', [req.params.token])
    if (!clientRes.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const clientId = clientRes.rows[0].id
    const result = await pool.query(
      'SELECT * FROM questionnaire_responses WHERE client_id=$1 AND sent_at IS NOT NULL ORDER BY created_at DESC',
      [clientId]
    )
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/portals/:token/questionnaires/:id/respond', async (req, res) => {
  const { responses } = req.body
  try {
    const clientRes = await pool.query('SELECT id FROM clients WHERE portal_token=$1', [req.params.token])
    if (!clientRes.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const clientId = clientRes.rows[0].id

    const qrRes = await pool.query(
      "UPDATE questionnaire_responses SET responses=$1, status='completed', completed_at=NOW() WHERE id=$2 AND client_id=$3 RETURNING *, (SELECT u.email FROM users u WHERE u.id = questionnaire_responses.user_id) as photographer_email",
      [JSON.stringify(responses || {}), req.params.id, clientId]
    )
    if (!qrRes.rows.length) return res.status(404).json({ error: 'Questionnaire not found' })
    const qr = qrRes.rows[0]

    if (qr.photographer_email && resend) {
      const clientInfo = await pool.query('SELECT name, portal_token FROM clients WHERE id=$1', [clientId])
      const c = clientInfo.rows[0]
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: qr.photographer_email,
        subject: `${c?.name || 'Your client'} filled out their questionnaire`,
        html: emailTemplate({
          title: 'Questionnaire completed',
          preheader: 'A client just submitted their questionnaire',
          body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Questionnaire completed!</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;"><strong>${c?.name || 'Your client'}</strong> has filled out their questionnaire: <strong>${qr.title}</strong>.</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Log in to view their responses.</p>`,
          ctaText: 'View Responses →',
          ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/questionnaires`,
          footerNote: 'Sent by PortalKit',
        }),
      }).catch(() => {})
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Questionnaire respond error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── WORKFLOW SETTINGS ──────────────────────────────────────────

app.get('/api/workflow-settings', requireAuth, async (req, res) => {
  try {
    let result = await pool.query('SELECT * FROM workflow_settings WHERE user_id=$1', [req.userId])
    if (!result.rows.length) {
      result = await pool.query('INSERT INTO workflow_settings (user_id) VALUES ($1) RETURNING *', [req.userId])
    }
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/workflow-settings', requireAuth, async (req, res) => {
  const {
    send_welcome_on_client_create, send_contract_reminder_3_days, send_balance_reminder_7_days,
    send_questionnaire_on_booking, send_thank_you_on_delivery, welcome_message, thank_you_message,
    send_review_request_on_delivery, google_review_url, wedding_wire_url, the_knot_url, facebook_review_url,
  } = req.body
  try {
    const result = await pool.query(`
      INSERT INTO workflow_settings (user_id, send_welcome_on_client_create, send_contract_reminder_3_days, send_balance_reminder_7_days, send_questionnaire_on_booking, send_thank_you_on_delivery, welcome_message, thank_you_message, send_review_request_on_delivery, google_review_url, wedding_wire_url, the_knot_url, facebook_review_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (user_id) DO UPDATE SET
        send_welcome_on_client_create=$2, send_contract_reminder_3_days=$3,
        send_balance_reminder_7_days=$4, send_questionnaire_on_booking=$5,
        send_thank_you_on_delivery=$6, welcome_message=$7, thank_you_message=$8,
        send_review_request_on_delivery=$9, google_review_url=$10, wedding_wire_url=$11,
        the_knot_url=$12, facebook_review_url=$13
      RETURNING *
    `, [req.userId,
        send_welcome_on_client_create ?? false, send_contract_reminder_3_days ?? true,
        send_balance_reminder_7_days ?? true, send_questionnaire_on_booking ?? false,
        send_thank_you_on_delivery ?? true, welcome_message || null, thank_you_message || null,
        send_review_request_on_delivery ?? true, google_review_url || null, wedding_wire_url || null,
        the_knot_url || null, facebook_review_url || null])
    res.json(result.rows[0])
  } catch (err) {
    console.error('Workflow settings error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── SESSION TYPES ──────────────────────────────────────────────

app.get('/api/session-types', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM session_types WHERE user_id=$1 ORDER BY name', [req.userId])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/session-types', requireAuth, async (req, res) => {
  const { name, duration_minutes, price_cents, description, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Session type name is required' })
  try {
    const result = await pool.query(
      'INSERT INTO session_types (user_id, name, duration_minutes, price_cents, description, color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.userId, sanitize(name), duration_minutes || 60, price_cents || 0, sanitize(description) || null, color || '#1B4332']
    )
    res.status(201).json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/session-types/:id', requireAuth, async (req, res) => {
  const { name, duration_minutes, price_cents, description, color, active } = req.body
  try {
    const result = await pool.query(
      'UPDATE session_types SET name=$1, duration_minutes=$2, price_cents=$3, description=$4, color=$5, active=$6 WHERE id=$7 AND user_id=$8 RETURNING *',
      [sanitize(name), duration_minutes || 60, price_cents || 0, sanitize(description) || null, color || '#1B4332', active !== false, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Session type not found' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.delete('/api/session-types/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE session_types SET active=FALSE WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── AVAILABILITY ──────────────────────────────────────────────

app.get('/api/availability', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM availability_slots WHERE user_id=$1 ORDER BY day_of_week', [req.userId])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/availability', requireAuth, async (req, res) => {
  const { slots } = req.body
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots array required' })
  try {
    await pool.query('DELETE FROM availability_slots WHERE user_id=$1', [req.userId])
    for (const slot of slots) {
      if (slot.active && slot.start_time && slot.end_time) {
        await pool.query(
          'INSERT INTO availability_slots (user_id, day_of_week, start_time, end_time, active) VALUES ($1,$2,$3,$4,$5)',
          [req.userId, slot.day_of_week, slot.start_time, slot.end_time, true]
        )
      }
    }
    const result = await pool.query('SELECT * FROM availability_slots WHERE user_id=$1 ORDER BY day_of_week', [req.userId])
    res.json(result.rows)
  } catch (err) {
    console.error('Availability save error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── BOOKINGS ─────────────────────────────────────────────────

app.get('/api/bookings', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, st.name as session_type_name, st.color as session_color
      FROM bookings b
      LEFT JOIN session_types st ON b.session_type_id = st.id
      WHERE b.user_id=$1
      ORDER BY b.booking_date DESC, b.start_time DESC
    `, [req.userId])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.patch('/api/bookings/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body
  if (!['pending','confirmed','cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    const result = await pool.query(
      'UPDATE bookings SET status=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
      [status, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Booking not found' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.delete('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM bookings WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Booking not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('Delete booking error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── PUBLIC BOOKING ROUTES ─────────────────────────────────────

app.get('/api/book/:username', async (req, res) => {
  try {
    const userRes = await pool.query('SELECT id, full_name, business_name, logo_url, brand_color FROM users WHERE booking_username=$1', [req.params.username])
    if (!userRes.rows.length) return res.status(404).json({ error: 'Photographer not found' })
    const photographer = userRes.rows[0]
    const sessionTypes = await pool.query('SELECT id, name, duration_minutes, price_cents, description, color FROM session_types WHERE user_id=$1 AND active=TRUE ORDER BY name', [photographer.id])
    res.json({ photographer, session_types: sessionTypes.rows })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.get('/api/book/:username/availability', async (req, res) => {
  const { date, session_type_id } = req.query
  if (!date) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' })
  try {
    const userRes = await pool.query('SELECT id FROM users WHERE booking_username=$1', [req.params.username])
    if (!userRes.rows.length) return res.status(404).json({ error: 'Photographer not found' })
    const userId = userRes.rows[0].id

    const dateObj = new Date(date + 'T00:00:00')
    const dayOfWeek = dateObj.getDay()

    const slotRes = await pool.query('SELECT * FROM availability_slots WHERE user_id=$1 AND day_of_week=$2 AND active=TRUE', [userId, dayOfWeek])
    console.log('Availability check:', { date, dayOfWeek, slotsFound: slotRes.rows.length, slotRows: slotRes.rows })
    if (!slotRes.rows.length) return res.json({ available: false, slots: [] })
    const avail = slotRes.rows[0]

    let durationMins = 60
    if (session_type_id) {
      const stRes = await pool.query('SELECT duration_minutes FROM session_types WHERE id=$1 AND user_id=$2', [session_type_id, userId])
      if (stRes.rows.length) durationMins = stRes.rows[0].duration_minutes
    }

    const existingBookings = await pool.query(
      "SELECT start_time, end_time FROM bookings WHERE user_id=$1 AND booking_date=$2 AND status != 'cancelled'",
      [userId, date]
    )

    const [startH, startM] = avail.start_time.split(':').map(Number)
    const [endH, endM] = avail.end_time.split(':').map(Number)
    const startMins = startH * 60 + startM
    const endMins = endH * 60 + endM

    const slots = []
    for (let m = startMins; m + durationMins <= endMins; m += durationMins) {
      const slotEnd = m + durationMins
      const hh = String(Math.floor(m / 60)).padStart(2, '0')
      const mm = String(m % 60).padStart(2, '0')
      const slotStr = `${hh}:${mm}`
      const slotEndStr = `${String(Math.floor(slotEnd / 60)).padStart(2,'0')}:${String(slotEnd % 60).padStart(2,'0')}`

      const conflict = existingBookings.rows.some(b => {
        const bStart = b.start_time.slice(0, 5)
        const bEnd = b.end_time.slice(0, 5)
        return slotStr < bEnd && slotEndStr > bStart
      })
      if (!conflict) slots.push(slotStr)
    }
    res.json({ available: true, slots })
  } catch (err) {
    console.error('Availability error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/book/:username/book', async (req, res) => {
  const { session_type_id, date, start_time, client_name, client_email, client_phone, notes } = req.body
  if (!date || !start_time || !client_name || !client_email) {
    return res.status(400).json({ error: 'date, start_time, client_name, and client_email are required' })
  }
  try {
    const userRes = await pool.query('SELECT id, full_name, business_name, email FROM users WHERE booking_username=$1', [req.params.username])
    if (!userRes.rows.length) return res.status(404).json({ error: 'Photographer not found' })
    const photographer = userRes.rows[0]

    let durationMins = 60
    let sessionTypeName = 'Photography Session'
    if (session_type_id) {
      const stRes = await pool.query('SELECT duration_minutes, name FROM session_types WHERE id=$1 AND user_id=$2', [session_type_id, photographer.id])
      if (stRes.rows.length) { durationMins = stRes.rows[0].duration_minutes; sessionTypeName = stRes.rows[0].name }
    }

    const [startH, startM] = start_time.split(':').map(Number)
    const endMins = startH * 60 + startM + durationMins
    const end_time = `${String(Math.floor(endMins / 60)).padStart(2,'0')}:${String(endMins % 60).padStart(2,'0')}`

    const existingCheck = await pool.query(
      "SELECT id FROM bookings WHERE user_id=$1 AND booking_date=$2 AND start_time=$3 AND status != 'cancelled'",
      [photographer.id, date, start_time]
    )
    if (existingCheck.rows.length) return res.status(409).json({ error: 'This time slot is no longer available' })

    // Find or create client record so booking appears in pipeline
    let clientId = null
    let clientCreated = false
    try {
      const existingClient = await pool.query('SELECT id FROM clients WHERE user_id=$1 AND email=$2', [photographer.id, client_email])
      if (existingClient.rows.length > 0) {
        clientId = existingClient.rows[0].id
        await pool.query(
          `UPDATE clients SET stage='booked', stage_changed_at=NOW(), updated_at=NOW() WHERE id=$1 AND stage IN ('inquiry','consultation')`,
          [clientId]
        )
      } else {
        const portalToken = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        const newClient = await pool.query(
          `INSERT INTO clients (user_id, name, email, phone, stage, stage_changed_at, portal_token)
           VALUES ($1,$2,$3,$4,'booked',NOW(),$5) RETURNING id`,
          [photographer.id, sanitize(client_name), client_email, sanitize(client_phone) || null, portalToken]
        )
        clientId = newClient.rows[0].id
        clientCreated = true
      }
    } catch (clientErr) {
      console.error('Booking client link error:', clientErr)
    }

    const booking = await pool.query(
      `INSERT INTO bookings (user_id, client_id, session_type_id, booking_date, start_time, end_time, client_name, client_email, client_phone, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed') RETURNING *`,
      [photographer.id, clientId, session_type_id || null, date, start_time, end_time, sanitize(client_name), client_email, sanitize(client_phone) || null, sanitize(notes) || null]
    )

    console.log('Booking created:', { booking_id: booking.rows[0].id, client_id: clientId, client_created: clientCreated })

    const biz = photographer.business_name || photographer.full_name || 'Your photographer'
    const dateDisplay = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    if (resend) {
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: client_email,
        subject: `Booking confirmed — ${sessionTypeName} with ${biz}`,
        html: emailTemplate({
          title: 'Booking Confirmed',
          preheader: `Your session with ${biz} is confirmed`,
          body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Your booking is confirmed! 🎉</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;">Hi ${sanitize(client_name)}, your <strong>${sessionTypeName}</strong> with ${biz} has been confirmed.</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 8px;"><strong>Date:</strong> ${dateDisplay}</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 16px;"><strong>Time:</strong> ${start_time}</p>`,
          ctaText: null,
          ctaUrl: null,
          footerNote: `Booking confirmed by ${biz} via PortalKit`,
        }),
      }).catch(() => {})

      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: photographer.email,
        subject: `New booking: ${sanitize(client_name)} — ${sessionTypeName}`,
        html: emailTemplate({
          title: 'New Booking',
          preheader: `${sanitize(client_name)} just booked a session`,
          body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">New booking received!</h2><p style="color:#6B5E4A;line-height:1.6;margin:0 0 8px;"><strong>Client:</strong> ${sanitize(client_name)} (${client_email})</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 8px;"><strong>Session:</strong> ${sessionTypeName}</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 8px;"><strong>Date:</strong> ${dateDisplay}</p><p style="color:#6B5E4A;line-height:1.6;margin:0 0 8px;"><strong>Time:</strong> ${start_time} – ${end_time}</p>${notes ? `<p style="color:#6B5E4A;line-height:1.6;margin:0 0 8px;"><strong>Notes:</strong> ${sanitize(notes)}</p>` : ''}`,
          ctaText: 'View Bookings →',
          ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/booking`,
          footerNote: 'Sent by PortalKit',
        }),
      }).catch(() => {})
    }

    res.status(201).json({ booking_id: booking.rows[0].id, date, start_time, end_time, session_type_name: sessionTypeName })
  } catch (err) {
    console.error('Booking error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── LEAD CAPTURE FORMS ────────────────────────────────────────
const publicCors = cors({ origin: '*' })

const freeToolRateLimit = new Map()
function checkFreeToolLimit(ip) {
  const now = Date.now()
  const window = 60 * 60 * 1000
  const limit = 10
  const existing = freeToolRateLimit.get(ip) || []
  const recent = existing.filter(t => now - t < window)
  if (recent.length >= limit) return false
  freeToolRateLimit.set(ip, [...recent, now])
  if (freeToolRateLimit.size > 5000) {
    for (const [k, v] of freeToolRateLimit.entries()) {
      const valid = v.filter(t => now - t < window)
      if (valid.length === 0) freeToolRateLimit.delete(k)
      else freeToolRateLimit.set(k, valid)
    }
  }
  return true
}

async function generateAndSendAllTemplates(email, fromTool) {
  if (!anthropic || !resend) return
  try {
    const [shotListMsg, timelineMsg, questionnaireMsg, pricingMsg] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: 'Generate a concise wedding photography shot list template with sections: GETTING READY, CEREMONY, FAMILY FORMALS, PORTRAITS, RECEPTION. Use plain dashes for bullets. Section headers in ALL CAPS. No markdown. Max 40 shots.' }]
      }),
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: 'Generate a sample wedding day photography timeline for a 4pm ceremony. Format as TIME - Activity. Plain text only, no markdown.' }]
      }),
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: 'Generate 12 essential wedding photography client questionnaire questions. Number each one. Plain text only, no markdown.' }]
      }),
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: 'Generate a simple 3-package wedding photography pricing structure (Silver/Gold/Platinum) for a US market photographer. Plain text, no markdown.' }]
      })
    ])

    const shotList = stripMarkdown(shotListMsg.content[0]?.text || '')
    const timeline = stripMarkdown(timelineMsg.content[0]?.text || '')
    const questionnaire = stripMarkdown(questionnaireMsg.content[0]?.text || '')
    const pricing = stripMarkdown(pricingMsg.content[0]?.text || '')

    await resend.emails.send({
      from: 'PortalKit <hello@mail.getportalkit.com>',
      reply_to: 'hello@getportalkit.com',
      to: email,
      subject: 'Your 4 free wedding photography templates',
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
          <div style="background:#1B4332;padding:24px;text-align:center;">
            <h1 style="color:white;margin:0;font-size:20px;">Portal<em style="color:#C9A84C;font-style:normal;">Kit</em></h1>
          </div>
          <div style="padding:32px 24px;">
            <h2 style="font-size:20px;margin:0 0 8px;color:#1B4332;">Here are your 4 free templates</h2>
            <p style="color:#6B7280;margin:0 0 32px;font-size:14px;">Save these — you'll use them for every wedding.</p>

            <div style="background:#F9FAFB;border-radius:10px;padding:20px;margin-bottom:20px;">
              <h3 style="color:#1B4332;margin:0 0 12px;font-size:16px;">📋 Shot List Template</h3>
              <pre style="font-size:13px;line-height:1.7;color:#374151;white-space:pre-wrap;font-family:inherit;margin:0;">${shotList}</pre>
            </div>

            <div style="background:#F9FAFB;border-radius:10px;padding:20px;margin-bottom:20px;">
              <h3 style="color:#1B4332;margin:0 0 12px;font-size:16px;">⏰ Wedding Day Timeline Template</h3>
              <pre style="font-size:13px;line-height:1.7;color:#374151;white-space:pre-wrap;font-family:inherit;margin:0;">${timeline}</pre>
            </div>

            <div style="background:#F9FAFB;border-radius:10px;padding:20px;margin-bottom:20px;">
              <h3 style="color:#1B4332;margin:0 0 12px;font-size:16px;">📝 Client Questionnaire Template</h3>
              <pre style="font-size:13px;line-height:1.7;color:#374151;white-space:pre-wrap;font-family:inherit;margin:0;">${questionnaire}</pre>
            </div>

            <div style="background:#F9FAFB;border-radius:10px;padding:20px;margin-bottom:28px;">
              <h3 style="color:#1B4332;margin:0 0 12px;font-size:16px;">💰 Pricing Guide Template</h3>
              <pre style="font-size:13px;line-height:1.7;color:#374151;white-space:pre-wrap;font-family:inherit;margin:0;">${pricing}</pre>
            </div>

            <div style="background:#1B4332;border-radius:12px;padding:24px;text-align:center;">
              <h3 style="color:white;margin:0 0 8px;font-size:17px;">Use these inside a professional client portal</h3>
              <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:0 0 16px;line-height:1.6;">PortalKit lets your clients fill out shot lists and questionnaires directly in their private portal. You get notified instantly.</p>
              <a href="https://getportalkit.com/signup" style="display:inline-block;background:#C9A84C;color:#1B4332;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Start Free Trial →</a>
              <p style="color:rgba(255,255,255,0.6);font-size:11px;margin:10px 0 0;">14-day free trial · $0 today · Cancel anytime</p>
            </div>
          </div>
          <div style="padding:16px 24px;text-align:center;border-top:1px solid #E5E7EB;">
            <p style="font-size:11px;color:#9CA3AF;margin:0;">You received this because you used a free tool at getportalkit.com.<br>Questions? Reply to this email.</p>
          </div>
        </div>
      `
    })
    console.log('📧 All 4 templates sent to:', email)
  } catch (err) {
    console.error('Template email error:', err.message)
  }
}

// ── Free Tool API Routes (public, no auth) ────────────────

app.options('/api/tools/capture-lead', publicCors)
app.post('/api/tools/capture-lead', publicCors, async (req, res) => {
  try {
    const { email, tool, source } = req.body
    if (!email || !email.includes('@')) return res.json({ success: false })
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tool_leads (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        tool TEXT,
        source TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {})
    await pool.query(
      'INSERT INTO tool_leads (email, tool, source) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [email.toLowerCase().trim(), tool || null, source || null]
    )
    generateAndSendAllTemplates(email.toLowerCase().trim(), tool || 'free-tool').catch(() => {})
    res.json({ success: true })
  } catch (err) {
    console.error('Lead capture error:', err)
    res.json({ success: false })
  }
})

app.options('/api/tools/shot-list', publicCors)
app.post('/api/tools/shot-list', publicCors, async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown'
  if (!checkFreeToolLimit(ip)) return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' })
  try {
    const { venue, style, family, special } = req.body
    if (!venue || !style || !family) return res.status(400).json({ error: 'Please fill in venue type, photography style, and family size.' })
    if (!anthropic) return res.status(503).json({ error: 'AI not configured' })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Generate a complete wedding photography shot list for these details:
Venue: ${venue}
Photography style: ${style}
Family size: ${family}
Special requests: ${special || 'None specified'}

Format as clear sections with dash-prefixed items:
- Getting Ready (Bride / Groom)
- Pre-Ceremony Details
- Ceremony
- Family Formals (list specific groupings)
- Wedding Party
- Couple Portraits
- Reception
- End of Night

Keep it practical and professional. Maximum 60 shots total.
Return ONLY plain text. No markdown. No pound signs. No asterisks. No hashtags. Use plain dashes for bullets. Use ALL CAPS for section headers like GETTING READY.`
      }]
    })
    res.json({ result: stripMarkdown(msg.content[0]?.type === 'text' ? msg.content[0].text : 'Could not generate. Please try again.') })
  } catch (err) {
    console.error('Shot list generation error:', err)
    res.status(500).json({ error: 'Generation failed' })
  }
})

app.options('/api/tools/timeline', publicCors)
app.post('/api/tools/timeline', publicCors, async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown'
  if (!checkFreeToolLimit(ip)) return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' })
  try {
    const { ceremony_time, ceremony_duration, distance, golden_hour, reception_end, notes } = req.body
    if (!ceremony_time) return res.status(400).json({ error: 'Please enter the ceremony start time.' })
    if (!anthropic) return res.status(503).json({ error: 'AI not configured' })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `Generate a professional wedding day photography timeline:
Ceremony start: ${ceremony_time}
Ceremony duration: ${ceremony_duration}
Travel between venues: ${distance}
Golden hour: ${golden_hour || 'estimate from typical sunset'}
Reception end: ${reception_end}
Additional notes: ${notes || 'None'}

Create a minute-by-minute schedule for the photographer.
Format each line as: TIME - Activity (duration)
Include buffer time, travel, and golden hour portraits.
Be specific and practical. Cover from getting-ready through reception end.
Return ONLY plain text. No markdown. No pound signs. No asterisks. Use ALL CAPS for section headers like GETTING READY.`
      }]
    })
    res.json({ result: stripMarkdown(msg.content[0]?.type === 'text' ? msg.content[0].text : 'Could not generate. Please try again.') })
  } catch (err) {
    console.error('Timeline generation error:', err)
    res.status(500).json({ error: 'Generation failed' })
  }
})

app.options('/api/tools/questionnaire', publicCors)
app.post('/api/tools/questionnaire', publicCors, async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown'
  if (!checkFreeToolLimit(ip)) return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' })
  try {
    const { wedding_type, style, events, focus } = req.body
    if (!anthropic) return res.status(503).json({ error: 'AI not configured' })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1400,
      messages: [{
        role: 'user',
        content: `Generate a professional wedding photography client questionnaire:
Wedding type: ${wedding_type}
Couple's style: ${style}
Events to cover: ${events}
Special focus areas: ${focus || 'None specified'}

Create 15-20 thoughtful questions covering:
- Logistics (venue, timeline, getting ready location)
- Family and VIP list
- Style and vision
- Shot priorities and must-haves
- Any concerns or special circumstances

Format as numbered questions. Keep questions clear and conversational.
Return ONLY plain text. No markdown. No pound signs. No asterisks. No hashtags. Use plain dashes for bullets. Use ALL CAPS for section headers.`
      }]
    })
    res.json({ result: stripMarkdown(msg.content[0]?.type === 'text' ? msg.content[0].text : 'Could not generate. Please try again.') })
  } catch (err) {
    console.error('Questionnaire generation error:', err)
    res.status(500).json({ error: 'Generation failed' })
  }
})

app.options('/api/tools/pricing-guide', publicCors)
app.post('/api/tools/pricing-guide', publicCors, async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown'
  if (!checkFreeToolLimit(ip)) return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' })
  try {
    const { city, experience, packages, hours, differentiator } = req.body
    if (!anthropic) return res.status(503).json({ error: 'AI not configured' })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1400,
      messages: [{
        role: 'user',
        content: `Generate a professional photography pricing guide:
Market: ${city}
Experience level: ${experience}
Package types: ${packages}
Hours offered: ${hours}
Differentiator: ${differentiator || 'Professional editing and online gallery delivery'}

Create 2-3 package options with:
- Package name
- Price (realistic for this market and experience level)
- What's included (hours, images, deliverables)
- Who it's best for

Also include:
- A la carte add-ons section (2nd shooter, engagement session, album, etc)
- A short "Why invest in professional photography" paragraph
- A call to action

Keep pricing realistic for the market. Format professionally.
Return ONLY plain text. No markdown. No pound signs. No asterisks. No hashtags. Use ALL CAPS for section headers like SILVER PACKAGE.`
      }]
    })
    res.json({ result: stripMarkdown(msg.content[0]?.type === 'text' ? msg.content[0].text : 'Could not generate. Please try again.') })
  } catch (err) {
    console.error('Pricing guide generation error:', err)
    res.status(500).json({ error: 'Generation failed' })
  }
})

app.get('/api/lead-form', requireAuth, async (req, res) => {
  try {
    let result = await pool.query('SELECT * FROM lead_forms WHERE user_id=$1', [req.userId])
    if (!result.rows.length) {
      result = await pool.query('INSERT INTO lead_forms (user_id) VALUES ($1) RETURNING *', [req.userId])
    }
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/lead-form', requireAuth, async (req, res) => {
  const { headline, subheadline, fields, brand_color, active } = req.body
  try {
    const result = await pool.query(`
      INSERT INTO lead_forms (user_id, headline, subheadline, fields, brand_color, active)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (user_id) DO UPDATE SET
        headline=$2, subheadline=$3, fields=$4, brand_color=$5, active=$6
      RETURNING *
    `, [req.userId, sanitize(headline) || 'Book a Session', sanitize(subheadline) || null, JSON.stringify(fields || []), brand_color || '#1B4332', active !== false])
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.get('/api/lead-submissions', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM lead_submissions WHERE user_id=$1 ORDER BY created_at DESC', [req.userId])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.delete('/api/lead-submissions/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM lead_submissions WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    console.error('Delete lead error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.patch('/api/lead-submissions/:id/stage', requireAuth, async (req, res) => {
  const { stage } = req.body
  if (!stage) return res.status(400).json({ error: 'stage required' })
  try {
    const result = await pool.query('UPDATE lead_submissions SET stage=$1 WHERE id=$2 AND user_id=$3 RETURNING client_id', [stage, req.params.id, req.userId])
    const clientId = result.rows[0]?.client_id
    if (clientId) {
      await pool.query('UPDATE clients SET stage=$1, stage_changed_at=NOW(), updated_at=NOW() WHERE id=$2 AND user_id=$3', [stage, clientId, req.userId]).catch(() => {})
    }
    res.json({ success: true })
  } catch (err) {
    console.error('Lead stage error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.options('/api/lead/:username', publicCors)
app.get('/api/lead/:username', publicCors, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT id, full_name, business_name, logo_url, brand_color FROM users WHERE booking_username=$1', [req.params.username])
    if (!userRes.rows.length) return res.status(404).json({ error: 'Not found' })
    const u = userRes.rows[0]
    const result = await pool.query('SELECT * FROM lead_forms WHERE user_id=$1', [u.id])
    if (!result.rows.length || !result.rows[0].active) return res.status(404).json({ error: 'Form not found' })
    const form = result.rows[0]
    res.json({
      ...form,
      business_name: u.business_name,
      full_name: u.full_name,
      logo_url: u.logo_url,
      brand_color: form.brand_color || u.brand_color || '#1B4332',
    })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.options('/api/lead/:username/submit', publicCors)
app.post('/api/lead/:username/submit', publicCors, async (req, res) => {
  console.log('Lead form submission:', req.body)
  console.log('event_date received:', req.body.event_date)
  const { name, email, phone, event_type, event_date, message } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  try {
    const userRes = await pool.query('SELECT id, email, full_name, business_name FROM users WHERE booking_username=$1', [req.params.username])
    if (!userRes.rows.length) return res.status(404).json({ error: 'Not found' })
    const photographer = userRes.rows[0]

    const leadRes = await pool.query(
      'INSERT INTO lead_submissions (user_id, name, email, phone, event_type, event_date, message) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [photographer.id, sanitize(name), email || null, sanitize(phone) || null, sanitize(event_type) || null, event_date || null, sanitize(message) || null]
    )
    const leadId = leadRes.rows[0].id

    // Create or find a corresponding client so the lead appears in the pipeline
    try {
      let clientId = null
      if (email) {
        const existingClient = await pool.query('SELECT id FROM clients WHERE user_id=$1 AND email=$2', [photographer.id, email])
        clientId = existingClient.rows[0]?.id || null
      }
      if (!clientId) {
        const portalToken = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        const newClient = await pool.query(
          `INSERT INTO clients (user_id, name, email, phone, event_date, event_type, notes, portal_token, stage, stage_changed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'inquiry',NOW()) RETURNING id`,
          [photographer.id, sanitize(name), email || null, sanitize(phone) || null, event_date || null, sanitize(event_type) || null, sanitize(message) || null, portalToken]
        )
        clientId = newClient.rows[0].id
        console.log('Lead client created:', { client_id: clientId, lead_id: leadId })
      } else {
        console.log('Lead linked to existing client:', { client_id: clientId, lead_id: leadId })
      }
      await pool.query('UPDATE lead_submissions SET client_id=$1 WHERE id=$2', [clientId, leadId])
    } catch (clientErr) {
      console.error('Lead→client link error:', clientErr)
    }

    if (photographer.email && resend) {
      const biz = photographer.business_name || photographer.full_name || 'You'
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: photographer.email,
        subject: `New lead from ${sanitize(name)}`,
        html: emailTemplate({
          title: 'New Lead Inquiry',
          preheader: `${name} submitted your lead form`,
          body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">New inquiry from ${sanitize(name)}</h2>
            ${email ? `<p style="color:#6B5E4A;margin:4px 0;"><strong>Email:</strong> ${email}</p>` : ''}
            ${phone ? `<p style="color:#6B5E4A;margin:4px 0;"><strong>Phone:</strong> ${sanitize(phone)}</p>` : ''}
            ${event_type ? `<p style="color:#6B5E4A;margin:4px 0;"><strong>Event type:</strong> ${sanitize(event_type)}</p>` : ''}
            ${event_date ? `<p style="color:#6B5E4A;margin:4px 0;"><strong>Event date:</strong> ${event_date}</p>` : ''}
            ${message ? `<p style="color:#6B5E4A;margin:8px 0 0;"><strong>Message:</strong><br>${sanitize(message)}</p>` : ''}`,
          ctaText: 'View Leads →',
          ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/leads`,
          footerNote: 'Sent by PortalKit',
        }),
      }).catch(() => {})
    }

    res.status(201).json({ success: true })
  } catch (err) {
    console.error('Lead submit error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── PAYMENT LINKS ─────────────────────────────────────────────

app.get('/api/payment-links', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payment_links WHERE user_id=$1 ORDER BY created_at DESC', [req.userId])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/payment-links', requireAuth, async (req, res) => {
  const { title, description, amount_cents, allow_custom_amount, min_amount_cents, link_type } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
  try {
    const result = await pool.query(
      'INSERT INTO payment_links (user_id, title, description, amount_cents, allow_custom_amount, min_amount_cents, link_type) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.userId, sanitize(title), sanitize(description) || null, amount_cents || null, allow_custom_amount || false, min_amount_cents || 100, link_type || 'fixed']
    )
    res.status(201).json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/payment-links/:id', requireAuth, async (req, res) => {
  const { title, description, amount_cents, allow_custom_amount, min_amount_cents, link_type, active } = req.body
  try {
    const result = await pool.query(
      'UPDATE payment_links SET title=$1, description=$2, amount_cents=$3, allow_custom_amount=$4, min_amount_cents=$5, link_type=$6, active=$7 WHERE id=$8 AND user_id=$9 RETURNING *',
      [sanitize(title), sanitize(description) || null, amount_cents || null, allow_custom_amount || false, min_amount_cents || 100, link_type || 'fixed', active !== false, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.delete('/api/payment-links/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM payment_links WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.options('/api/pay/:linkId', publicCors)
app.get('/api/pay/:linkId', publicCors, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pl.*, u.full_name, u.business_name, u.logo_url, u.brand_color, u.stripe_connect_enabled, u.stripe_connect_account_id
       FROM payment_links pl JOIN users u ON u.id = pl.user_id
       WHERE pl.id=$1 AND pl.active=true`, [req.params.linkId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Payment link not found' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.options('/api/pay/:linkId/charge', publicCors)
app.post('/api/pay/:linkId/charge', publicCors, async (req, res) => {
  const { amount_cents, payer_name, payer_email } = req.body
  if (!amount_cents || amount_cents < 50) return res.status(400).json({ error: 'Invalid amount' })
  try {
    const linkRes = await pool.query(
      `SELECT pl.*, u.stripe_connect_enabled, u.stripe_connect_account_id
       FROM payment_links pl JOIN users u ON u.id = pl.user_id
       WHERE pl.id=$1 AND pl.active=true`, [req.params.linkId]
    )
    if (!linkRes.rows.length) return res.status(404).json({ error: 'Not found' })
    const link = linkRes.rows[0]
    if (!link.stripe_connect_enabled || !link.stripe_connect_account_id || !stripe) {
      return res.status(400).json({ error: 'Payments not configured' })
    }
    const pi = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      transfer_data: { destination: link.stripe_connect_account_id },
      metadata: { payment_link_id: link.id, payer_name: payer_name || '', payer_email: payer_email || '' },
    })
    await pool.query(
      'INSERT INTO payment_link_transactions (payment_link_id, payer_name, payer_email, amount_cents, stripe_payment_intent_id) VALUES ($1,$2,$3,$4,$5)',
      [link.id, sanitize(payer_name) || null, payer_email || null, amount_cents, pi.id]
    )
    res.json({ client_secret: pi.client_secret, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY })
  } catch (err) {
    console.error('Payment link charge error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.options('/api/pay/:linkId/confirm', publicCors)
app.post('/api/pay/:linkId/confirm', publicCors, async (req, res) => {
  const { payment_intent_id } = req.body
  try {
    const txRes = await pool.query(
      'UPDATE payment_link_transactions SET status=$1 WHERE stripe_payment_intent_id=$2 RETURNING *',
      ['succeeded', payment_intent_id]
    )
    if (txRes.rows.length) {
      const tx = txRes.rows[0]
      await pool.query(
        'UPDATE payment_links SET total_collected_cents = total_collected_cents + $1, transaction_count = transaction_count + 1 WHERE id=$2',
        [tx.amount_cents, tx.payment_link_id]
      )
    }
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── SHOT LISTS ────────────────────────────────────────────────

app.get('/api/clients/:id/shot-list', requireAuth, async (req, res) => {
  try {
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const result = await pool.query('SELECT * FROM shot_lists WHERE client_id=$1', [req.params.id])
    if (!result.rows.length) {
      const newList = await pool.query(
        'INSERT INTO shot_lists (client_id, user_id) VALUES ($1,$2) RETURNING *',
        [req.params.id, req.userId]
      )
      return res.json(newList.rows[0])
    }
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/clients/:id/shot-list', requireAuth, async (req, res) => {
  const { shots, photographer_notes } = req.body
  try {
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const result = await pool.query(`
      INSERT INTO shot_lists (client_id, user_id, shots, photographer_notes)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (client_id) DO UPDATE SET shots=$3, photographer_notes=$4
      RETURNING *
    `, [req.params.id, req.userId, JSON.stringify(shots || []), sanitize(photographer_notes) || null])
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/clients/:id/shot-list/confirm', requireAuth, async (req, res) => {
  try {
    const clientCheck = await pool.query('SELECT id, email, name, portal_token FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const client = clientCheck.rows[0]
    const result = await pool.query(
      "UPDATE shot_lists SET status='confirmed', confirmed_at=NOW() WHERE client_id=$1 RETURNING *",
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Shot list not found' })
    if (client.email && resend) {
      const biz = req.user.business_name || req.user.full_name || 'Your photographer'
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: client.email,
        subject: `Your shot list has been confirmed! — ${biz}`,
        html: emailTemplate({
          title: 'Shot List Confirmed!',
          preheader: 'Your shot list has been reviewed and confirmed',
          body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Shot list confirmed, ${client.name}!</h2><p style="color:#6B5E4A;line-height:1.6;">Your shot list has been reviewed and confirmed. You can view it any time in your portal.</p>`,
          ctaText: 'View Your Portal →',
          ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${client.portal_token}`,
          footerNote: `Sent by ${biz}`,
        }),
      }).catch(() => {})
    }
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.get('/api/portals/:token/shot-list', async (req, res) => {
  try {
    const clientRes = await pool.query('SELECT id FROM clients WHERE portal_token=$1', [req.params.token])
    if (!clientRes.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const result = await pool.query('SELECT * FROM shot_lists WHERE client_id=$1', [clientRes.rows[0].id])
    res.json(result.rows[0] || null)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/portals/:token/shot-list', async (req, res) => {
  const { shots, client_notes } = req.body
  try {
    const clientRes = await pool.query(
      'SELECT c.id, c.name, c.email, c.portal_token, u.id as user_id, u.email as photographer_email, u.full_name as photographer_name, u.business_name FROM clients c JOIN users u ON u.id=c.user_id WHERE c.portal_token=$1',
      [req.params.token]
    )
    if (!clientRes.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const client = clientRes.rows[0]
    const result = await pool.query(`
      INSERT INTO shot_lists (client_id, user_id, shots, client_notes, status, submitted_at)
      VALUES ($1,$2,$3,$4,'submitted',NOW())
      ON CONFLICT (client_id) DO UPDATE SET shots=$3, client_notes=$4, status='submitted', submitted_at=NOW()
      RETURNING *
    `, [client.id, client.user_id, JSON.stringify(shots || []), sanitize(client_notes) || null])
    if (client.photographer_email && resend) {
      const biz = client.business_name || client.photographer_name || 'Your client'
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: client.photographer_email,
        subject: `${client.name} submitted their shot list`,
        html: emailTemplate({
          title: 'Shot List Submitted',
          preheader: `${client.name} has submitted their shot list`,
          body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">${client.name} submitted a shot list</h2><p style="color:#6B5E4A;line-height:1.6;">Log in to review and confirm their shot list.</p>`,
          ctaText: 'Review Shot List →',
          ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/clients`,
          footerNote: 'Sent by PortalKit',
        }),
      }).catch(() => {})
    }
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── VENDORS ───────────────────────────────────────────────────

app.get('/api/clients/:id/vendors', requireAuth, async (req, res) => {
  try {
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const result = await pool.query('SELECT * FROM vendors WHERE client_id=$1 ORDER BY category, name', [req.params.id])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/clients/:id/vendors', requireAuth, async (req, res) => {
  const { category, name, contact_name, phone, email, website, notes } = req.body
  if (!category?.trim() || !name?.trim()) return res.status(400).json({ error: 'category and name are required' })
  try {
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const result = await pool.query(
      'INSERT INTO vendors (client_id, user_id, category, name, contact_name, phone, email, website, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.params.id, req.userId, sanitize(category), sanitize(name), sanitize(contact_name) || null, sanitize(phone) || null, email || null, website || null, sanitize(notes) || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/clients/:id/vendors/:vendorId', requireAuth, async (req, res) => {
  const { category, name, contact_name, phone, email, website, notes } = req.body
  try {
    const result = await pool.query(
      'UPDATE vendors SET category=$1, name=$2, contact_name=$3, phone=$4, email=$5, website=$6, notes=$7 WHERE id=$8 AND user_id=$9 RETURNING *',
      [sanitize(category), sanitize(name), sanitize(contact_name) || null, sanitize(phone) || null, email || null, website || null, sanitize(notes) || null, req.params.vendorId, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Vendor not found' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.delete('/api/clients/:id/vendors/:vendorId', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM vendors WHERE id=$1 AND user_id=$2', [req.params.vendorId, req.userId])
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.get('/api/portals/:token/vendors', async (req, res) => {
  try {
    const clientRes = await pool.query('SELECT id FROM clients WHERE portal_token=$1', [req.params.token])
    if (!clientRes.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const result = await pool.query('SELECT * FROM vendors WHERE client_id=$1 ORDER BY category, name', [clientRes.rows[0].id])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── DAY-OF TIMELINES ──────────────────────────────────────────

app.get('/api/clients/:id/timeline', requireAuth, async (req, res) => {
  try {
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const result = await pool.query('SELECT * FROM timelines WHERE client_id=$1', [req.params.id])
    if (!result.rows.length) {
      const newTl = await pool.query(
        'INSERT INTO timelines (client_id, user_id) VALUES ($1,$2) RETURNING *',
        [req.params.id, req.userId]
      )
      return res.json(newTl.rows[0])
    }
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/clients/:id/timeline', requireAuth, async (req, res) => {
  const { title, items } = req.body
  try {
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const result = await pool.query(`
      INSERT INTO timelines (client_id, user_id, title, items)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (client_id) DO UPDATE SET title=$3, items=$4
      RETURNING *
    `, [req.params.id, req.userId, sanitize(title) || 'Day-of Timeline', JSON.stringify(items || [])])
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/clients/:id/timeline/send', requireAuth, async (req, res) => {
  try {
    const clientCheck = await pool.query('SELECT id, email, name, portal_token FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    if (!clientCheck.rows.length) return res.status(404).json({ error: 'Client not found' })
    const client = clientCheck.rows[0]
    const result = await pool.query(
      "UPDATE timelines SET status='sent' WHERE client_id=$1 RETURNING *",
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Timeline not found' })
    if (client.email && resend) {
      const biz = req.user.business_name || req.user.full_name || 'Your photographer'
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: client.email,
        subject: `Your day-of timeline is ready — ${biz}`,
        html: emailTemplate({
          title: 'Your Timeline is Ready',
          preheader: 'Your day-of timeline has been shared',
          body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Your day-of timeline is ready, ${client.name}!</h2><p style="color:#6B5E4A;line-height:1.6;">Your photographer has shared a day-of timeline with you. View it in your portal and approve when you're ready.</p>`,
          ctaText: 'View Timeline →',
          ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/portal/${client.portal_token}`,
          footerNote: `Sent by ${biz}`,
        }),
      }).catch(() => {})
    }
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.get('/api/portals/:token/timeline', async (req, res) => {
  try {
    const clientRes = await pool.query('SELECT id FROM clients WHERE portal_token=$1', [req.params.token])
    if (!clientRes.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const result = await pool.query("SELECT * FROM timelines WHERE client_id=$1 AND status != 'draft'", [clientRes.rows[0].id])
    res.json(result.rows[0] || null)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/portals/:token/timeline/approve', async (req, res) => {
  try {
    const clientRes = await pool.query(
      'SELECT c.id, c.name, c.portal_token, u.email as photographer_email, u.full_name as photographer_name, u.business_name FROM clients c JOIN users u ON u.id=c.user_id WHERE c.portal_token=$1',
      [req.params.token]
    )
    if (!clientRes.rows.length) return res.status(404).json({ error: 'Portal not found' })
    const client = clientRes.rows[0]
    const result = await pool.query(
      "UPDATE timelines SET status='approved', client_approved_at=NOW() WHERE client_id=$1 RETURNING *",
      [client.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Timeline not found' })
    if (client.photographer_email && resend) {
      resend.emails.send({
        from: 'PortalKit <hello@mail.getportalkit.com>',
        reply_to: "hello@getportalkit.com",
        to: client.photographer_email,
        subject: `${client.name} approved the day-of timeline`,
        html: emailTemplate({
          title: 'Timeline Approved',
          preheader: `${client.name} approved their timeline`,
          body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">${client.name} approved the timeline!</h2><p style="color:#6B5E4A;line-height:1.6;">Your client has reviewed and approved the day-of timeline.</p>`,
          ctaText: 'View in Dashboard →',
          ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/clients`,
          footerNote: 'Sent by PortalKit',
        }),
      }).catch(() => {})
    }
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── PACKAGES ──────────────────────────────────────────────────

app.get('/api/packages', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM packages WHERE user_id=$1 AND active=true ORDER BY price_cents ASC', [req.userId])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/packages', requireAuth, async (req, res) => {
  const { name, description, price_cents, deposit_cents, features } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  try {
    const result = await pool.query(
      'INSERT INTO packages (user_id, name, description, price_cents, deposit_cents, features) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.userId, sanitize(name), sanitize(description) || null, price_cents || 0, deposit_cents || 0, JSON.stringify(features || [])]
    )
    res.status(201).json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/packages/:id', requireAuth, async (req, res) => {
  const { name, description, price_cents, deposit_cents, features } = req.body
  try {
    const result = await pool.query(
      'UPDATE packages SET name=$1, description=$2, price_cents=$3, deposit_cents=$4, features=$5 WHERE id=$6 AND user_id=$7 RETURNING *',
      [sanitize(name), sanitize(description) || null, price_cents || 0, deposit_cents || 0, JSON.stringify(features || []), req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Package not found' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.delete('/api/packages/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE packages SET active=false WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── PROPOSALS ─────────────────────────────────────────────────

app.get('/api/proposals', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, c.name as client_name FROM proposals p
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.user_id=$1 ORDER BY p.created_at DESC
    `, [req.userId])
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/proposals', requireAuth, async (req, res) => {
  const { client_id, title, message, packages, expires_at } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
  try {
    const result = await pool.query(
      'INSERT INTO proposals (user_id, client_id, title, message, packages, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.userId, client_id || null, sanitize(title), sanitize(message) || null, JSON.stringify(packages || []), expires_at || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.put('/api/proposals/:id', requireAuth, async (req, res) => {
  const { title, message, packages, expires_at } = req.body
  try {
    const result = await pool.query(
      'UPDATE proposals SET title=$1, message=$2, packages=$3, expires_at=$4 WHERE id=$5 AND user_id=$6 RETURNING *',
      [sanitize(title), sanitize(message) || null, JSON.stringify(packages || []), expires_at || null, req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Proposal not found' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.delete('/api/proposals/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM proposals WHERE id=$1 AND user_id=$2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/proposals/:id/send', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE proposals SET status='sent' WHERE id=$1 AND user_id=$2 RETURNING *",
      [req.params.id, req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Proposal not found' })
    const proposal = result.rows[0]
    if (proposal.client_id) {
      const clientRes = await pool.query('SELECT email, name FROM clients WHERE id=$1', [proposal.client_id])
      const client = clientRes.rows[0]
      if (client?.email && resend) {
        const biz = req.user.business_name || req.user.full_name || 'Your photographer'
        const proposalUrl = `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/proposal/${proposal.id}`
        resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          reply_to: "hello@getportalkit.com",
          to: client.email,
          subject: `${proposal.title} — from ${biz}`,
          html: emailTemplate({
            title: 'Your Proposal is Ready',
            preheader: `${biz} has sent you a proposal`,
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Hi ${client.name}!</h2><p style="color:#6B5E4A;line-height:1.6;">${biz} has sent you a proposal. Review the packages and accept when you're ready.</p>`,
            ctaText: 'View Proposal →',
            ctaUrl: proposalUrl,
            footerNote: `Sent by ${biz}`,
          }),
        }).catch(() => {})
      }
    }
    res.json(proposal)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.get('/api/proposals/:id/public', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.full_name as photographer_name, u.business_name as photographer_business,
              u.logo_url as photographer_logo, u.brand_color as photographer_brand_color,
              c.name as client_name
       FROM proposals p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN clients c ON c.id = p.client_id
       WHERE p.id=$1 AND p.status IN ('sent','viewed','accepted')`,
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Proposal not found' })
    await pool.query(
      'UPDATE proposals SET status=CASE WHEN status=\'sent\' THEN \'viewed\' ELSE status END, viewed_at=COALESCE(viewed_at,NOW()) WHERE id=$1',
      [req.params.id]
    )
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/proposals/:id/accept', async (req, res) => {
  const { selected_package_id } = req.body
  try {
    const proposalRes = await pool.query(
      "SELECT * FROM proposals WHERE id=$1 AND status IN ('sent','viewed')",
      [req.params.id]
    )
    if (!proposalRes.rows.length) return res.status(404).json({ error: 'Proposal not found or already processed' })
    const proposal = proposalRes.rows[0]
    await pool.query(
      "UPDATE proposals SET status='accepted', accepted_at=NOW(), selected_package_id=$1 WHERE id=$2",
      [selected_package_id || null, proposal.id]
    )
    if (proposal.user_id) {
      const photographerRes = await pool.query('SELECT email, full_name, business_name FROM users WHERE id=$1', [proposal.user_id])
      const photographer = photographerRes.rows[0]
      if (photographer?.email && resend) {
        resend.emails.send({
          from: 'PortalKit <hello@mail.getportalkit.com>',
          reply_to: "hello@getportalkit.com",
          to: photographer.email,
          subject: `Proposal accepted: ${proposal.title}`,
          html: emailTemplate({
            title: 'Proposal Accepted!',
            preheader: 'A client accepted your proposal',
            body: `<h2 style="font-size:22px;color:#1A1208;margin:0 0 12px;">Your proposal was accepted!</h2><p style="color:#6B5E4A;line-height:1.6;">A client has accepted your proposal "<strong>${proposal.title}</strong>".</p>`,
            ctaText: 'View Proposals →',
            ctaUrl: `${process.env.FRONTEND_URL || 'https://getportalkit.com'}/dashboard/proposals`,
            footerNote: 'Sent by PortalKit',
          }),
        }).catch(() => {})
      }
    }
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/admin/activate-account', async (req, res) => {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })
  const { email } = req.body
  const result = await pool.query(
    `UPDATE users SET onboarding_completed=true, plan='active', stripe_subscription_id='manual_activation' WHERE email=$1 RETURNING id, email, plan`,
    [email]
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' })
  res.json({ success: true, user: result.rows[0] })
})

app.post('/api/admin/reset-account', async (req, res) => {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { email } = req.body
  try {
    const result = await pool.query(
      `UPDATE users SET
        plan = 'trial',
        trial_ends_at = NOW() + INTERVAL '14 days',
        onboarding_completed = FALSE,
        stripe_subscription_id = NULL,
        stripe_customer_id = NULL
      WHERE email = $1
      RETURNING id, email, plan, onboarding_completed, trial_ends_at`,
      [email]
    )
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' })
    }
    res.json({ success: true, user: result.rows[0] })
  } catch (err) {
    console.error('Reset account error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── ADMIN: AFFILIATES ─────────────────────────────────────────

app.get('/api/admin/affiliates', async (req, res) => {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const result = await pool.query('SELECT * FROM affiliates ORDER BY created_at DESC')
    const conversions = await pool.query('SELECT affiliate_id, COUNT(*) as count, SUM(commission_cents) as total FROM affiliate_conversions GROUP BY affiliate_id')
    const convMap = {}
    conversions.rows.forEach(r => { convMap[r.affiliate_id] = r })
    const affiliates = result.rows.map(a => ({
      ...a,
      conversions: parseInt(convMap[a.id]?.count || 0),
      total_earned_dollars: ((convMap[a.id]?.total || 0) / 100).toFixed(2),
    }))
    res.json(affiliates)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

app.post('/api/admin/affiliates', async (req, res) => {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })
  const { name, email, affiliate_code, commission_percent } = req.body
  if (!name || !email || !affiliate_code) return res.status(400).json({ error: 'name, email, and affiliate_code are required' })
  try {
    const result = await pool.query(
      `INSERT INTO affiliates (name, email, affiliate_code, commission_percent)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name=$1, affiliate_code=$3, commission_percent=$4, status='active'
       RETURNING *`,
      [name, email, affiliate_code.trim().toUpperCase(), commission_percent || 20]
    )
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/admin/affiliates/:id', async (req, res) => {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })
  const { status } = req.body
  try {
    const result = await pool.query('UPDATE affiliates SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id])
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── ADMIN: CONTENT ENGINE ─────────────────────────────────────

function checkAdminSecret(req, res) {
  const provided = req.headers['x-admin-secret']
  const match = provided === process.env.ADMIN_SECRET
  console.log('Admin auth check:', {
    route: req.method + ' ' + req.path,
    provided: provided ? provided.slice(0, 4) + '...' : '[missing]',
    expected: process.env.ADMIN_SECRET ? '[SET]' : '[NOT SET]',
    match
  })
  if (!match) { res.status(401).json({ error: 'Unauthorized' }); return false }
  return true
}

app.post('/api/admin/generate-content', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    await generateAndScheduleWeeklyContent()
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/admin/generate-reddit-content', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    await monitorRedditAndGenerateContent()
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/admin/reddit-content', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    await monitorRedditAndGenerateContent()
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/admin/generated-content', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    const result = await pool.query('SELECT * FROM generated_content ORDER BY created_at DESC LIMIT 50')
    res.json(result.rows)
  } catch { res.json([]) }
})

app.patch('/api/admin/generated-content/:id', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    const { status } = req.body
    const result = await pool.query('UPDATE generated_content SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id])
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/admin/tool-leads', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    const result = await pool.query('SELECT * FROM tool_leads ORDER BY created_at DESC LIMIT 100')
    res.json(result.rows)
  } catch { res.json([]) }
})

// ── ADMIN: COLD OUTREACH ──────────────────────────────────────

app.post('/api/admin/cold-contacts/import', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    const { contacts } = req.body
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'contacts array required' })
    }

    let added = 0
    const skipped = []
    const skippedReasons = []

    for (const c of contacts) {
      const email = (c.email || '').toLowerCase().trim()
      if (!email || !email.includes('@')) {
        skipped.push(email)
        skippedReasons.push(`${email}: invalid email`)
        continue
      }

      const suppressed = await pool.query(
        'SELECT 1 FROM cold_suppression WHERE LOWER(email)=$1', [email]
      )
      if (suppressed.rows.length > 0) {
        skipped.push(email)
        skippedReasons.push(`${email}: on suppression list`)
        continue
      }

      const existingUser = await pool.query(
        'SELECT 1 FROM users WHERE LOWER(email)=$1', [email]
      )
      if (existingUser.rows.length > 0) {
        skipped.push(email)
        skippedReasons.push(`${email}: existing user`)
        continue
      }

      const result = await pool.query(
        `INSERT INTO cold_contacts (email, first_name, business_name, note)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [email, c.first_name || null, c.business_name || null, c.note || null]
      )
      if (result.rows.length > 0) {
        added++
      } else {
        skipped.push(email)
        skippedReasons.push(`${email}: already in list`)
      }
    }

    res.json({ added, skipped: skipped.length, skippedReasons })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/admin/cold-contacts/stats', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    const [stats, total, queuedToday, sentToday, recentSends, replies] = await Promise.all([
      pool.query(`
        SELECT status, COUNT(*)::int as count
        FROM cold_contacts
        GROUP BY status
      `),
      pool.query('SELECT COUNT(*)::int as count FROM cold_contacts'),
      pool.query(
        `SELECT COUNT(*)::int as count FROM cold_contacts
         WHERE created_at >= CURRENT_DATE`
      ),
      pool.query(
        `SELECT COUNT(*)::int as count FROM cold_contacts
         WHERE sent_at >= CURRENT_DATE`
      ),
      pool.query(
        `SELECT email, business_name, status, sent_at
         FROM cold_contacts
         WHERE status IN ('sent', 'replied', 'bounced', 'opted_out')
         ORDER BY sent_at DESC NULLS LAST LIMIT 20`
      ),
      pool.query(
        `SELECT email, business_name, sent_at
         FROM cold_contacts
         WHERE status='replied'
         ORDER BY sent_at DESC NULLS LAST LIMIT 20`
      )
    ])
    res.json({
      byStatus: stats.rows,
      total: total.rows[0]?.count || 0,
      queuedToday: queuedToday.rows[0]?.count || 0,
      sentToday: sentToday.rows[0]?.count || 0,
      recentSends: recentSends.rows,
      replies: replies.rows
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/admin/cold-suppression', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    const email = (req.body.email || '').toLowerCase().trim()
    if (!email) return res.status(400).json({ error: 'email required' })
    await pool.query(
      `INSERT INTO cold_suppression (email, reason) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [email, req.body.reason || 'manual']
    )
    await pool.query(
      `UPDATE cold_contacts SET status='opted_out' WHERE LOWER(email)=$1`,
      [email]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/admin/cold-send-test', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  if (!BREVO_API_KEY || !COLD_EMAIL_FROM) {
    return res.status(400).json({
      error: 'BREVO_API_KEY or COLD_EMAIL_FROM not set in Railway'
    })
  }
  try {
    const to = (req.body.email || '').trim()
    if (!to || !to.includes('@')) return res.status(400).json({ error: 'email required' })
    const { subject, html } = buildColdEmail({ email: to, first_name: 'Test', business_name: 'Test Studio' })
    const result = await sendBrevoEmail({
      from: COLD_EMAIL_FROM,
      to,
      subject: '[TEST] ' + subject,
      html
    })
    if (!result) {
      return res.status(500).json({ error: 'Brevo send failed' })
    }
    res.json({ success: true, messageId: result.messageId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/find-emails — web discovery + website scrape for photographer emails
app.post('/api/admin/find-emails', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  const { city, state = 'USA' } = req.body
  if (!city) return res.status(400).json({ error: 'city required' })

  // Respond immediately, run in background
  res.json({
    success: true,
    message: `Finding photographers in ${city}. Check stats in 60 seconds.`
  })

  findPhotographerEmails(city, state)
    .then(emails => importFoundEmails(emails))
    .then(r => console.log(`Find emails complete: +${r.added} added`))
    .catch(err => console.error('Find emails error:', err.message))
})

async function generateManimVideo(displayScript, tmpDir) {
  return new Promise((resolve) => {
    try {
      const sentences = displayScript
        .replace(/\n/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.trim().length > 4)
        .join('|')

      const outputPath = path.join(tmpDir, 'manim_output.mp4')
      const scriptPath = path.join(__dirname, 'manim_script.py')

      if (!fs.existsSync(scriptPath)) {
        console.log('🎨 Manim script not found at:', scriptPath)
        return resolve(null)
      }

      const escapedSentences = sentences.replace(/"/g, '\\"')
      const cmd = `python3 "${scriptPath}" --script "${escapedSentences}" --output "${outputPath}"`
      console.log('🎨 Starting Manim render...')

      exec(cmd, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          console.error('🎨 Manim error:', err.message)
          if (stderr) console.error('🎨 stderr:', stderr.slice(-500))
          return resolve(null)
        }
        if (fs.existsSync(outputPath)) {
          console.log('🎨 Manim render complete:', outputPath)
          resolve(outputPath)
        } else {
          console.error('🎨 Manim output file not found')
          resolve(null)
        }
      })
    } catch (err) {
      console.error('🎨 Manim setup error:', err.message)
      resolve(null)
    }
  })
}

// POST /api/admin/generate-video — queue a video for a specific post
app.post('/api/admin/generate-video', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  const { post_id, script, title } = req.body
  if (!script) return res.status(400).json({ error: 'script required' })
  res.json({ queued: true })
  generateSocialVideo(script, title || 'Admin video', post_id || null).catch(e =>
    console.error('🎬 Admin video error:', e.message)
  )
})

// POST /api/admin/generate-manim-video — render animated explainer via Manim
app.post('/api/admin/generate-manim-video', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  const { post_id, script } = req.body
  if (!script) return res.status(400).json({ error: 'script required' })

  try {
    const { rows } = await pool.query(
      `INSERT INTO generated_videos (post_id, title, script, status, video_type) VALUES ($1, $2, $3, 'rendering', 'manim') RETURNING id`,
      [post_id || null, 'Manim Explainer', script]
    )
    const videoId = rows[0].id
    res.json({ queued: true, id: videoId })

    // Render async — don't await
    ;(async () => {
      const tmpDir = path.join(os.tmpdir(), `manim-${Date.now()}`)
      fs.mkdirSync(tmpDir, { recursive: true })
      try {
        const { displayScript } = await prepareVideoScript(script)
        const manimPath = await generateManimVideo(displayScript, tmpDir)

        if (!manimPath) {
          await pool.query(`UPDATE generated_videos SET status='error', error='Manim render failed' WHERE id=$1`, [videoId])
          return
        }

        const videoKey = `videos/manim-${Date.now()}-${videoId}.mp4`
        if (r2 && R2_BUCKET) {
          await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: videoKey,
            Body: fs.readFileSync(manimPath),
            ContentType: 'video/mp4'
          }))
        }
        const videoUrl = process.env.R2_PUBLIC_URL ? `${process.env.R2_PUBLIC_URL}/${videoKey}` : null
        await pool.query(
          `UPDATE generated_videos SET status='ready', r2_url=$1, completed_at=NOW() WHERE id=$2`,
          [videoUrl, videoId]
        )
        console.log('🎨 Manim video ready:', videoUrl)
      } catch (err) {
        console.error('🎨 Manim async error:', err.message)
        await pool.query(`UPDATE generated_videos SET status='error', error=$1 WHERE id=$2`, [err.message, videoId]).catch(() => {})
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })()
  } catch (err) {
    console.error('Manim endpoint error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/generated-videos — list all videos
app.get('/api/admin/generated-videos', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    const { rows } = await pool.query(
      `SELECT id, post_id, title, script, status, r2_url, error, video_type, created_at, completed_at
       FROM generated_videos ORDER BY created_at DESC LIMIT 100`
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/admin/generate-captions', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  const { script } = req.body
  console.log('📝 Caption generation started, script length:', script?.length || 0)
  if (!script) {
    console.log('📝 Caption failed: no script')
    return res.status(400).json({ error: 'Script required' })
  }
  if (!anthropic) return res.status(503).json({ error: 'AI not configured' })
  try {
    console.log('📝 Calling Claude Haiku for captions...')
    const captionRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Generate platform captions for this PortalKit video. PortalKit is a client portal SaaS for wedding photographers, $29-39/month, free trial at getportalkit.com.

Script: ${script.slice(0, 400)}

Return ONLY a JSON object, no markdown, no explanation:
{"instagram":"2-3 sentences + 3-5 hashtags, max 300 chars","tiktok":"hook + 1 sentence, max 100 chars, 2 hashtags","twitter":"punchy, max 240 chars, 1-2 hashtags","linkedin":"professional, value-first, max 400 chars, no hashtags","youtube_shorts":"descriptive, max 80 chars"}`
      }]
    })

    console.log('📝 Claude response received')
    const raw = captionRes.content[0]?.text || '{}'
    const clean = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    console.log('📝 Raw caption response:', clean.slice(0, 100))

    let captions
    try {
      captions = JSON.parse(clean)
    } catch (parseErr) {
      console.error('📝 JSON parse failed:', clean.slice(0, 200))
      return res.status(500).json({ error: 'Failed to parse captions', raw: clean.slice(0, 200) })
    }

    console.log('📝 Captions generated successfully')
    return res.json({ captions })
  } catch (err) {
    console.error('📝 Caption generation error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

app.delete('/api/admin/generated-videos/:id', async (req, res) => {
  if (!checkAdminSecret(req, res)) return
  try {
    const record = await pool.query('SELECT r2_url FROM generated_videos WHERE id=$1', [req.params.id])
    const r2Url = record.rows[0]?.r2_url
    if (r2Url && r2 && R2_BUCKET) {
      try {
        const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
        const key = r2Url.replace(R2_PUBLIC_URL + '/', '')
        if (key && key !== r2Url) {
          await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
          console.log('🗑️ Deleted from R2:', key)
        }
      } catch (r2Err) {
        console.error('R2 delete error:', r2Err.message)
      }
    }
    await pool.query('DELETE FROM generated_videos WHERE id=$1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error('Delete video error:', err.message)
    res.status(500).json({ error: 'Delete failed' })
  }
})

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message)
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  })
})

async function startServer() {
  console.log('Starting server...')
  console.log('📧 Resend configured:', !!process.env.RESEND_API_KEY)
  console.log('🤖 Anthropic configured:', !!process.env.ANTHROPIC_API_KEY)
  await initDb()
  console.log('DB init complete, starting HTTP listener...')

  // Pre-load Kokoro TTS model so video generation doesn't pay the cold-load penalty
  initKokoro()

  // Start cron jobs only after tables are guaranteed to exist
  runDailyJobs()
  setInterval(runDailyJobs, 60 * 60 * 1000)

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
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing gracefully...')
    server.close(async () => {
      await pool.end()
      process.exit(0)
    })
  })
  process.on('SIGINT', async () => {
    console.log('SIGINT received, closing gracefully...')
    server.close(async () => {
      await pool.end()
      process.exit(0)
    })
  })
}

const PHOTO_CITIES = [
  'Austin', 'Nashville', 'Denver', 'Atlanta',
  'Chicago', 'Dallas', 'Houston', 'Phoenix',
  'San Diego', 'Portland', 'Seattle', 'Charlotte',
  'Miami', 'Boston', 'Philadelphia', 'Las Vegas',
  'Salt Lake City', 'New Orleans', 'San Antonio',
]
let cityIndex = 0

async function autoFindEmails() {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM cold_contacts WHERE sent_at IS NULL AND (unsubscribed IS NULL OR unsubscribed = false)`
    )
    const unseenCount = parseInt(result.rows[0].count)
    console.log(`📧 Auto email check: ${unseenCount} unsent contacts`)
    if (unseenCount < 50) {
      const city = PHOTO_CITIES[cityIndex % PHOTO_CITIES.length]
      cityIndex++
      console.log(`📧 Auto-finding emails in ${city}...`)
      const emails = await findPhotographerEmails(city, 'USA')
      const r = await importFoundEmails(emails)
      console.log(`📧 Auto email finder complete for ${city}: +${r.added} added`)
    }
  } catch (err) {
    console.error('📧 Auto email finder error:', err.message)
  }
}

startServer().catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})

// Run auto email finder every 6 hours; first run 5 min after startup
setTimeout(() => {
  autoFindEmails()
  setInterval(autoFindEmails, 6 * 60 * 60 * 1000)
}, 5 * 60 * 1000)
