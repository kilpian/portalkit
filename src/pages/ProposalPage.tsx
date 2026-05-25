import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'https://portalkit-production.up.railway.app'

interface PackageData {
  id: number
  name: string
  description: string | null
  price_cents: number
  deposit_cents: number
  features: string[]
}

interface ProposalData {
  id: number
  title: string
  message: string | null
  packages: PackageData[]
  status: string
  expires_at: string | null
  accepted_at: string | null
  photographer_name: string
  photographer_business: string | null
  photographer_logo: string | null
  photographer_brand_color: string | null
  client_name: string | null
}

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export default function ProposalPage() {
  const { id } = useParams<{ id: string }>()
  const [proposal, setProposal] = useState<ProposalData | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!id) return
    axios.get<ProposalData>(`${API_URL}/api/proposals/${id}/public`)
      .then(r => setProposal(r.data))
      .catch(() => setError('Proposal not found or no longer available.'))
  }, [id])

  const handleAccept = async () => {
    if (!proposal || !id) return
    setAccepting(true)
    try {
      await axios.post(`${API_URL}/api/proposals/${id}/accept`, { selected_package_id: selected })
      setAccepted(true)
      setProposal(prev => prev ? { ...prev, status: 'accepted' } : prev)
    } catch {
      // silent fail
    } finally {
      setAccepting(false)
    }
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: '40px 32px', textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📄</div>
          <p style={{ fontSize: 16, color: '#374151' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB' }}>
        <p style={{ color: '#9CA3AF' }}>Loading...</p>
      </div>
    )
  }

  const brandColor = proposal.photographer_brand_color || '#1B4332'
  const businessName = proposal.photographer_business || proposal.photographer_name
  const isExpired = proposal.expires_at && new Date(proposal.expires_at) < new Date()
  const isAccepted = accepted || proposal.status === 'accepted'

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB' }}>
      <header style={{ background: brandColor, padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {proposal.photographer_logo && (
            <img src={proposal.photographer_logo} alt={businessName} style={{ height: 32, maxWidth: 120, objectFit: 'contain' }} />
          )}
          <span style={{ fontWeight: 700, fontSize: 15, color: '#FDFAF5' }}>{businessName}</span>
        </div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Powered by PortalKit</span>
      </header>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 20px 80px' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: brandColor, marginBottom: 8 }}>{proposal.title}</h1>
          {proposal.client_name && <p style={{ fontSize: 15, color: '#6B7280', marginBottom: 10 }}>Prepared for {proposal.client_name}</p>}
          {proposal.message && <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.7 }}>{proposal.message}</p>}
          {proposal.expires_at && !isAccepted && (
            <p style={{ fontSize: 13, color: isExpired ? '#DC2626' : '#D97706', marginTop: 12, fontWeight: 500 }}>
              {isExpired ? '⚠ This proposal has expired.' : `⏰ Offer expires ${new Date(proposal.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
            </p>
          )}
        </div>

        {isAccepted && (
          <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, padding: '20px 24px', marginBottom: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#059669', marginBottom: 6 }}>Proposal Accepted!</h2>
            <p style={{ fontSize: 14, color: '#065F46' }}>{businessName} has been notified. They'll be in touch shortly.</p>
          </div>
        )}

        {proposal.packages.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Choose a Package</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {proposal.packages.map(pkg => {
                const isSelected = selected === pkg.id
                return (
                  <div
                    key={pkg.id}
                    onClick={() => !isAccepted && setSelected(pkg.id)}
                    style={{
                      background: '#fff', borderRadius: 12, padding: '20px 22px', cursor: isAccepted ? 'default' : 'pointer',
                      border: `2px solid ${isSelected ? brandColor : '#E5E7EB'}`,
                      boxShadow: isSelected ? `0 0 0 4px ${brandColor}18` : 'none',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <p style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 2px' }}>{pkg.name}</p>
                        {pkg.description && <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>{pkg.description}</p>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                        <p style={{ fontSize: 22, fontWeight: 800, color: brandColor, margin: 0 }}>{formatCents(pkg.price_cents)}</p>
                        {pkg.deposit_cents > 0 && <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>{formatCents(pkg.deposit_cents)} deposit</p>}
                      </div>
                    </div>
                    {pkg.features.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                        {pkg.features.map((f, i) => (
                          <span key={i} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 99, background: isSelected ? brandColor + '12' : '#F3F4F6', color: isSelected ? brandColor : '#374151', border: `1px solid ${isSelected ? brandColor + '30' : '#E5E7EB'}` }}>
                            ✓ {f}
                          </span>
                        ))}
                      </div>
                    )}
                    {isSelected && (
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', background: brandColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: brandColor }}>Selected</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!isAccepted && !isExpired && (
          <button
            onClick={handleAccept}
            disabled={accepting || (proposal.packages.length > 0 && !selected)}
            style={{
              width: '100%', padding: '15px 0', borderRadius: 12, border: 'none',
              background: brandColor, color: '#fff', fontSize: 16, fontWeight: 700,
              cursor: accepting || (proposal.packages.length > 0 && !selected) ? 'not-allowed' : 'pointer',
              opacity: accepting || (proposal.packages.length > 0 && !selected) ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {accepting ? 'Accepting...' : proposal.packages.length > 0 ? (selected ? 'Accept Proposal & Package' : 'Select a Package to Accept') : 'Accept Proposal'}
          </button>
        )}
      </div>
    </div>
  )
}
