import { Link } from 'react-router-dom'
import { SignIn } from '@clerk/clerk-react'

export default function SignInPage() {
  return (
    <div className="auth-page" style={{ background: '#FDFAF5', minHeight: '100vh' }}>
      <header className="auth-header">
        <Link to="/" className="auth-logo">
          Portal<em>Kit</em>
        </Link>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-dim)' }}>
          No account?{' '}
          <Link to="/signup" style={{ color: 'var(--green)', fontWeight: 600 }}>
            Start free →
          </Link>
        </span>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', background: '#FDFAF5' }}>
        <SignIn
          routing="path"
          path="/signin"
          afterSignInUrl="/dashboard"
          appearance={{
            variables: {
              colorPrimary: '#1B4332',
              colorBackground: '#FDFAF5',
              colorInputBackground: '#FFFFFF',
              colorInputText: '#374151',
              colorText: '#374151',
              colorTextSecondary: '#6B7280',
              colorNeutral: '#1B4332',
              fontFamily: 'Inter, sans-serif',
              borderRadius: '8px',
            },
            elements: {
              rootBox: { width: '100%' },
              card: {
                backgroundColor: '#FDFAF5',
                boxShadow: 'none',
                border: '1px solid #E8E0D0',
                borderRadius: '12px',
              },
              headerTitle: {
                color: '#1B4332',
                fontFamily: "'Bricolage Grotesque', sans-serif",
              },
              headerSubtitle: { color: '#6B7280' },
              socialButtonsBlockButton: {
                backgroundColor: '#FFFFFF',
                border: '1px solid #D4C9B4',
                color: '#374151',
                fontWeight: '500',
              },
              socialButtonsBlockButtonText: { color: '#374151', fontWeight: '500' },
              formButtonPrimary: { backgroundColor: '#1B4332', color: '#FDFAF5' },
              footerActionLink: { color: '#1B4332' },
              identityPreviewEditButton: { color: '#1B4332' },
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
