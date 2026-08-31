import { useEffect, useState } from 'react'
import { useApi } from '../lib/api'

// TODO: swap in the real Google Business review link once available.
const GOOGLE_REVIEW_URL_PLACEHOLDER = '[GOOGLE_REVIEW_URL_PLACEHOLDER]'

type Sentiment = 'loving_it' | 'its_okay' | 'having_issues'

const SENTIMENT_OPTIONS: { value: Sentiment; label: string }[] = [
  { value: 'loving_it', label: 'Loving it' },
  { value: 'its_okay', label: "It's okay" },
  { value: 'having_issues', label: 'Having issues' },
]

export default function FeedbackCard() {
  const { authFetch } = useApi()
  const [status, setStatus] = useState<'loading' | 'hidden' | 'ask' | 'thanks'>('loading')
  const [sentiment, setSentiment] = useState<Sentiment | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const [sendingFeedback, setSendingFeedback] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)

  useEffect(() => {
    authFetch('/api/feedback/should-show', { method: 'get' })
      .then(res => setStatus(res.data.shouldShow ? 'ask' : 'hidden'))
      .catch(() => setStatus('hidden'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDismiss = () => {
    setStatus('hidden')
    authFetch('/api/feedback/dismiss', { method: 'post' }).catch(() => {})
  }

  const handleSelectSentiment = (value: Sentiment) => {
    setSentiment(value)
    setStatus('thanks')
    authFetch('/api/feedback', { method: 'post', data: { sentiment: value } }).catch(() => {})
  }

  const handleSendFeedback = async () => {
    if (!sentiment || !feedbackText.trim()) return
    setSendingFeedback(true)
    try {
      await authFetch('/api/feedback', { method: 'post', data: { sentiment, feedback_text: feedbackText.trim() } })
      setFeedbackSent(true)
    } catch {
      // Best-effort — the review ask above already succeeded regardless.
    } finally {
      setSendingFeedback(false)
    }
  }

  if (status === 'loading' || status === 'hidden') return null

  const wantsMoreDetail = sentiment === 'its_okay' || sentiment === 'having_issues'

  return (
    <div className="card" style={{ padding: '18px 22px', marginBottom: 24, position: 'relative' }}>
      {status === 'ask' && (
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 16, lineHeight: 1, padding: 4 }}
        >
          ✕
        </button>
      )}

      {status === 'ask' ? (
        <>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, paddingRight: 24 }}>
            How's PortalKit working for you so far?
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {SENTIMENT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => handleSelectSentiment(opt.value)} className="btn btn-ghost btn-sm">
                {opt.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 14 }}>
            Thanks for letting us know! Would you mind leaving us a review? It really helps other photographers find us.
          </p>
          <a
            href={GOOGLE_REVIEW_URL_PLACEHOLDER}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm"
            style={{ display: 'inline-block', textDecoration: 'none', marginBottom: wantsMoreDetail ? 20 : 0 }}
          >
            Leave a Google Review →
          </a>

          {wantsMoreDetail && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
              {feedbackSent ? (
                <p style={{ fontSize: 13, color: 'var(--color-green)' }}>Thanks — we'll follow up personally.</p>
              ) : (
                <>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>What could we do better?</p>
                  <textarea
                    value={feedbackText}
                    onChange={e => setFeedbackText(e.target.value)}
                    rows={3}
                    placeholder="Tell us what's not working..."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
                  />
                  <button
                    onClick={handleSendFeedback}
                    disabled={sendingFeedback || !feedbackText.trim()}
                    className="btn btn-ghost btn-sm"
                    style={{ opacity: sendingFeedback || !feedbackText.trim() ? 0.6 : 1, cursor: sendingFeedback || !feedbackText.trim() ? 'not-allowed' : 'pointer' }}
                  >
                    {sendingFeedback ? 'Sending...' : 'Send feedback'}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
