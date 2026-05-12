import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePortalAuth } from '../context/AuthContext'

export default function Landing() {
  const { isLoggedIn, isLoaded } = usePortalAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoaded) return
    if (isLoggedIn) {
      navigate('/dashboard', { replace: true })
    } else {
      navigate('/signin', { replace: true })
    }
  }, [isLoggedIn, isLoaded, navigate])

  return (
    <div style={{ background: '#FDFAF5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )
}
