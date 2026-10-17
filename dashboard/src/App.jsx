import { Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Alerts from './pages/Alerts'
import RingDetail from './pages/RingDetail'
import AccountDetail from './pages/AccountDetail'
import WarningScreen from './pages/WarningScreen'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/alerts" element={<Alerts />} />
      <Route path="/ring/:ringId" element={<RingDetail />} />
      <Route path="/account/:accountId" element={<AccountDetail />} />
      <Route path="/warning/:accountId" element={<WarningScreen />} />
    </Routes>
  )
}

export default App