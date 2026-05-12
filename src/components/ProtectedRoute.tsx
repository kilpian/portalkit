import { Navigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser()

  if (!isLoaded) {
    return (
      <div style={{ background: '#FDFAF5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!isSignedIn) return <Navigate to="/signin" replace />
  return <>{children}</>
}
