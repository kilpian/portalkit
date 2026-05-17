import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'

export default function Landing() {
  const { isLoaded, isSignedIn } = useUser()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn) navigate('/dashboard', { replace: true })
  }, [isLoaded, isSignedIn, navigate])

  return null
}
