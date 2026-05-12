import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ background: '#FDFAF5', minHeight: '100vh' }} className="flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
      </div>
    )
  }
  if (!isLoggedIn) return <Navigate to="/signin" replace />
  return <>{children}</>
}
