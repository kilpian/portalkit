import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function SignUp() {
  const { signUp, isLoggedIn } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (isLoggedIn) navigate('/dashboard')
  }, [isLoggedIn, navigate])

  const validateStep1 = () => {
    if (!fullName.trim()) { setError('Please enter your full name.'); return false }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) { setError('Please enter a valid email.'); return false }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return false }
    return true
  }

  const handleNext = () => { setError(''); if (validateStep1()) setStep(2) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signUp({ full_name: fullName, email, password, business_name: businessName || undefined })
      navigate('/dashboard')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setError(axiosErr?.response?.data?.error || 'Something went wrong. Please try again.')
      setStep(1)
    } finally {
      setLoading(false)
    }
  }

  const strengthScore = () => {
    let s = 0
    if (password.length >= 8) s++
    if (/[A-Z]/.test(password)) s++
    if (/[0-9]/.test(password)) s++
    if (/[^A-Za-z0-9]/.test(password)) s++
    return s
  }
  const strength = strengthScore()
  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][strength]
  const strengthColor = ['', '#EF4444', '#F59E0B', '#C9A84C', '#22C55E'][strength]

  return (
    <div style={{ background: '#FDFAF5', minHeight: '100vh' }} className="flex flex-col">
      <header className="px-8 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid #E8E0D0' }}>
        <Link to="/">
          <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: '1.25rem', fontWeight: 800, color: '#1B4332', letterSpacing: '-0.03em' }}>
            Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
          </span>
        </Link>
        <span className="text-sm text-gray-500">
          Have an account?{' '}
          <Link to="/signin" className="font-medium" style={{ color: '#1B4332' }}>Sign in →</Link>
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div
          className="w-full max-w-sm transition-all duration-500"
          style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(12px)' }}
        >
          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-8">
            {[1, 2].map(s => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{ background: step >= s ? '#1B4332' : '#E8E0D0', color: step >= s ? '#FDFAF5' : '#9CA3AF' }}
                >
                  {step > s
                    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    : s
                  }
                </div>
                {s < 2 && <div className="w-12 h-px" style={{ background: step > s ? '#1B4332' : '#E8E0D0' }} />}
              </div>
            ))}
            <span className="text-xs text-gray-400 ml-1">Step {step} of 2 — {step === 1 ? 'Account' : 'Business'}</span>
          </div>

          <h1 className="text-3xl font-bold mb-1" style={{ color: '#1B4332', letterSpacing: '-0.02em' }}>
            {step === 1 ? 'Create your account.' : 'Your business name.'}
          </h1>
          <p className="text-sm text-gray-500 mb-8">
            {step === 1 ? '14-day free trial. No credit card required.' : 'Optional — you can always add this later.'}
          </p>

          {error && (
            <div className="mb-5 px-4 py-3 rounded-lg text-sm border" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#DC2626' }}>{error}</div>
          )}

          <form onSubmit={step === 1 ? (e) => { e.preventDefault(); handleNext() } : handleSubmit} className="space-y-4">
            {step === 1 && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Full name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none"
                    style={{ borderColor: '#D4C9B4' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none"
                    style={{ borderColor: '#D4C9B4' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      className="w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none pr-10"
                      style={{ borderColor: '#D4C9B4' }}
                    />
                    <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {showPass
                          ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
                          : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>}
                      </svg>
                    </button>
                  </div>
                  {password.length > 0 && (
                    <div className="mt-2">
                      <div className="flex gap-1 mb-1">
                        {[1,2,3,4].map(i => (
                          <div key={i} className="h-1 flex-1 rounded-full transition-all" style={{ background: i <= strength ? strengthColor : '#E8E0D0' }} />
                        ))}
                      </div>
                      <span className="text-xs" style={{ color: strengthColor }}>{strengthLabel}</span>
                    </div>
                  )}
                </div>
                <button type="submit" className="w-full py-3 rounded-lg text-sm font-semibold text-white" style={{ background: '#1B4332' }}>
                  Continue →
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Business / studio name</label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={e => setBusinessName(e.target.value)}
                    placeholder="Jane Smith Photography"
                    className="w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none"
                    style={{ borderColor: '#D4C9B4' }}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-1 py-3 rounded-lg text-sm font-medium border text-gray-600"
                    style={{ borderColor: '#D4C9B4' }}
                  >
                    ← Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-3 rounded-lg text-sm font-semibold text-white transition-opacity"
                    style={{ background: '#1B4332', opacity: loading ? 0.7 : 1 }}
                  >
                    {loading
                      ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Creating…</span>
                      : 'Create Account'
                    }
                  </button>
                </div>
                <p className="text-center text-xs text-gray-400">You can always add details later in settings.</p>
              </>
            )}
          </form>

          {step === 1 && (
            <p className="text-center text-sm text-gray-500 mt-6">
              Already have an account?{' '}
              <Link to="/signin" className="font-semibold" style={{ color: '#1B4332' }}>Sign in →</Link>
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
