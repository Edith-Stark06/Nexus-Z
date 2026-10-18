import { Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing'
import { RoleChooser, RoleLogin } from './pages/Login'
import Dashboard from './pages/Dashboard'
import Alerts from './pages/Alerts'
import RingDetail from './pages/RingDetail'
import AccountDetail from './pages/AccountDetail'
import WarningScreen from './pages/WarningScreen'
import Assistant from './pages/Assistant'
import Protect from './pages/Protect'
import Admin from './pages/Admin'
import Oversight from './pages/Oversight'
import RequireRole from './auth/RequireRole'
import './App.css'

const guard = (el) => <RequireRole>{el}</RequireRole>

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<RoleChooser />} />
      <Route path="/login/:role" element={<RoleLogin />} />
      <Route path="/monitor" element={guard(<Dashboard />)} />
      <Route path="/alerts" element={guard(<Alerts />)} />
      <Route path="/ring/:ringId" element={guard(<RingDetail />)} />
      <Route path="/account/:accountId" element={guard(<AccountDetail />)} />
      <Route path="/warning/:accountId" element={guard(<WarningScreen />)} />
      <Route path="/assistant" element={guard(<Assistant />)} />
      <Route path="/protect" element={guard(<Protect />)} />
      <Route path="/admin" element={guard(<Admin />)} />
      <Route path="/oversight" element={guard(<Oversight />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
