import { Link } from 'react-router-dom'
import { SignUp } from '@clerk/clerk-react'

export default function SignUpPage() {
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Link to="/" className="auth-logo">
          Portal<em>Kit</em>
        </Link>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-dim)' }}>
          Have an account?{' '}
          <Link to="/signin" style={{ color: 'var(--green)', fontWeight: 600 }}>
            Sign in →
          </Link>
        </span>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
        <SignUp
          routing="path"
          path="/signup"
          afterSignUpUrl="/dashboard"
          appearance={{
            variables: {
              colorPrimary: '#1B4332',
              colorBackground: '#FDFAF5',
              fontFamily: 'Inter, sans-serif',
              borderRadius: '10px',
            },
            elements: {
              card: 'shadow-none border border-[#D4C9B4]',
              headerTitle: 'font-display',
            },
          }}
        />
      </main>

      <footer style={{ textAlign: 'center', padding: '20px 24px', borderTop: '1px solid var(--border-subtle)' }}>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>
          © {new Date().getFullYear()} Kilpian LLC dba PortalKit ·{' '}
          <Link to="/privacy" style={{ color: 'var(--text-dim)' }}>Privacy</Link> ·{' '}
          <Link to="/terms" style={{ color: 'var(--text-dim)' }}>Terms</Link>
        </p>
      </footer>
    </div>
  )
}
