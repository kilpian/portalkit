import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function SignIn() {
  const { signIn, isLoggedIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (isLoggedIn) navigate('/dashboard')
  }, [isLoggedIn, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Please fill in all fields.'); return }
    setLoading(true)
    try {
      await signIn({ email, password })
      navigate('/dashboard')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setError(axiosErr?.response?.data?.error || 'Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ background: '#FDFAF5', minHeight: '100vh' }} className="flex flex-col">
      <header className="px-8 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid #E8E0D0' }}>
        <Link to="/">
          <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: '1.25rem', fontWeight: 800, color: '#1B4332', letterSpacing: '-0.03em' }}>
            Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
          </span>
        </Link>
        <span className="text-sm text-gray-500">
          No account?{' '}
          <Link to="/signup" className="font-medium" style={{ color: '#1B4332' }}>Start free →</Link>
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div
          className="w-full max-w-sm transition-all duration-500"
          style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(12px)' }}
        >
          <h1 className="text-3xl font-bold mb-1" style={{ color: '#1B4332', letterSpacing: '-0.02em' }}>Welcome back.</h1>
          <p className="text-sm text-gray-500 mb-8">Sign in to your PortalKit account.</p>

          {error && (
            <div className="mb-5 px-4 py-3 rounded-lg text-sm border" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#DC2626' }}>{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: '#D4C9B4', focusRingColor: '#1B4332' }}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-600">Password</label>
                <Link to="/forgot-password" className="text-xs text-gray-400 hover:text-gray-600">Forgot password?</Link>
              </div>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none pr-10"
                  style={{ borderColor: '#D4C9B4' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {showPass
                      ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
                      : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>}
                  </svg>
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg text-sm font-semibold text-white transition-opacity"
              style={{ background: '#1B4332', opacity: loading ? 0.7 : 1 }}
            >
              {loading
                ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Signing in…</span>
                : 'Sign In'
              }
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Don't have an account?{' '}
            <Link to="/signup" className="font-semibold" style={{ color: '#1B4332' }}>Start free →</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
