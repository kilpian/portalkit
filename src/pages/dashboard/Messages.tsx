export default function Messages() {
  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>
          Messages
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Communicate with your clients directly from their portal.</p>
      </div>

      <div className="card" style={{ padding: '64px 20px', textAlign: 'center' }}>
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={{ margin: '0 auto 20px', display: 'block' }}>
          <rect x="4" y="10" width="56" height="36" rx="6" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="2"/>
          <rect x="4" y="10" width="56" height="36" rx="6" fill="none" stroke="var(--border)" strokeWidth="2"/>
          <path d="M16 22h32M16 30h24" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
          <path d="M20 46l-8 8v-8" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="2" strokeLinejoin="round"/>
          <circle cx="46" cy="16" r="8" fill="var(--gold)" opacity="0.15" stroke="var(--gold)" strokeWidth="1.5"/>
          <path d="M43 16l2 2 4-4" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>

        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
          Client Messaging — Coming Soon
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', maxWidth: 380, margin: '0 auto 24px' }}>
          Send messages and updates directly to your clients through their personal portal. No back-and-forth emails.
        </p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--gold)', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 20, padding: '6px 16px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block' }} />
          In Development
        </div>
      </div>
    </div>
  )
}
