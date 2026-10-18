import { Routes, Route, Navigate } from "react-router-dom";
import Overview from "./pages/Overview";
import Explorer from "./pages/Explorer";
import Alerts from "./pages/Alerts";
import AccountDetail from "./pages/AccountDetail";
import WarningScreen from "./pages/WarningScreen";
import Assistant from "./pages/Assistant";
import Platform from "./pages/Platform";

// Routes keep the paths the rest of the project links to (/ring/:id, /account/:id, /warning/:id, /alerts, /assistant).
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/rings" element={<Explorer />} />
      <Route path="/ring/:ringId" element={<Explorer />} />
      <Route path="/account/:accountId" element={<AccountDetail />} />
      <Route path="/alerts" element={<Alerts />} />
      <Route path="/warning/:accountId" element={<WarningScreen />} />
      <Route path="/assistant" element={<Assistant />} />
      <Route path="/platform" element={<Platform />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
