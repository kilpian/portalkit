import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

interface PortalData {
  id: number
  name: string
  event_date: string | null
  event_type: string | null
  photographer_name: string
  photographer_business: string | null
}

export default function ClientPortal() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PortalData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    axios.get(`/api/portals/${token}`)
      .then(r => setData(r.data))
      .catch(() => setError('This portal link is invalid or has expired.'))
  }, [token])

  if (error) {
    return (
      <div style={{ background: '#FDFAF5', minHeight: '100vh' }} className="flex items-center justify-center p-6">
        <p className="text-gray-500">{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ background: '#FDFAF5', minHeight: '100vh' }} className="flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div style={{ background: '#FDFAF5', minHeight: '100vh' }} className="p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: '1.25rem', fontWeight: 800, color: '#1B4332', letterSpacing: '-0.03em' }}>
            Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
          </span>
        </div>
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#1B4332' }}>Hello, {data.name}</h1>
        <p className="text-gray-500 text-sm mb-8">
          Your portal from {data.photographer_business || data.photographer_name}
        </p>
        {/* TODO: show contracts, invoices, files for this client */}
        <p className="text-gray-400 text-sm">Your documents and files will appear here.</p>
      </div>
    </div>
  )
}
