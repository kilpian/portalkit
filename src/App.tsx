import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import DashboardLayout from './components/DashboardLayout'

import Landing from './pages/Landing'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import ClientPortal from './pages/ClientPortal'
import BookingPage from './pages/BookingPage'

import Dashboard from './pages/dashboard/Dashboard'
import Clients from './pages/dashboard/Clients'
import Pipeline from './pages/dashboard/Pipeline'
import NewPortal from './pages/dashboard/NewPortal'
import Contracts from './pages/dashboard/Contracts'
import Invoices from './pages/dashboard/Invoices'
import Files from './pages/dashboard/Files'
import Messages from './pages/dashboard/Messages'
import Settings from './pages/dashboard/Settings'
import Setup from './pages/dashboard/Setup'
import Questionnaires from './pages/dashboard/Questionnaires'
import Booking from './pages/dashboard/Booking'
import Workflows from './pages/dashboard/Workflows'
import LeadForm from './pages/dashboard/LeadForm'
import PaymentLinks from './pages/dashboard/PaymentLinks'
import Proposals from './pages/dashboard/Proposals'
import Gallery from './pages/dashboard/Gallery'
import ContentEngine from './pages/dashboard/ContentEngine'
import InquiryPage from './pages/InquiryPage'
import PaymentLinkPage from './pages/PaymentLinkPage'
import ProposalPage from './pages/ProposalPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Landing />} />
          <Route path="/signin/*" element={<SignIn />} />
          <Route path="/signup/*" element={<SignUp />} />
          <Route path="/portal/:token" element={<ClientPortal />} />
          <Route path="/book/:username" element={<BookingPage />} />
          <Route path="/inquire/:username" element={<InquiryPage />} />
          <Route path="/pay/:linkId" element={<PaymentLinkPage />} />
          <Route path="/proposal/:id" element={<ProposalPage />} />

          {/* Protected dashboard */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="clients" element={<Clients />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="clients/new" element={<NewPortal />} />
            <Route path="contracts" element={<Contracts />} />
            <Route path="questionnaires" element={<Questionnaires />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="booking" element={<Booking />} />
            <Route path="files" element={<Files />} />
            <Route path="gallery" element={<Gallery />} />
            <Route path="workflows" element={<Workflows />} />
            <Route path="leads" element={<LeadForm />} />
            <Route path="payment-links" element={<PaymentLinks />} />
            <Route path="proposals" element={<Proposals />} />
            <Route path="messages" element={<Messages />} />
            <Route path="settings" element={<Settings />} />
            <Route path="setup" element={<Setup />} />
            <Route path="content" element={<ContentEngine />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
