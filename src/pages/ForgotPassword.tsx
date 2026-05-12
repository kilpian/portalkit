import { useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await axios.post('/api/auth/forgot-password', { email })
      setSent(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ background: '#FDFAF5', minHeight: '100vh' }} className="flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: '1.5rem', fontWeight: 800, color: '#1B4332', letterSpacing: '-0.03em' }}>
            Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
          </span>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <p style={{ color: '#1B4332' }} className="font-medium">Check your inbox</p>
            <p className="text-sm text-gray-600">If that email exists, a reset link has been sent.</p>
            <Link to="/signin" className="text-sm" style={{ color: '#C9A84C' }}>Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <h1 className="text-2xl font-bold" style={{ color: '#1B4332' }}>Reset password</h1>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none"
                style={{ borderColor: '#D4C9B4' }}
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity"
              style={{ background: '#1B4332', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="text-center text-sm text-gray-600">
              <Link to="/signin" style={{ color: '#C9A84C' }}>Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
