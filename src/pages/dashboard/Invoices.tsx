export default function Invoices() {
  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>
          Invoices
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Track payments and send invoices to clients.</p>
      </div>

      <div className="card" style={{ padding: '48px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>💳</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          Invoices coming soon
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
          Create invoices, accept payments, and track what's been paid — all linked to each client's portal.
        </p>
      </div>
    </div>
  )
}
