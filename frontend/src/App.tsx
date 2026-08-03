import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "./state";
import PinDialog from "./components/PinDialog";
import Home from "./pages/Home";
import NewTest from "./pages/NewTest";
import GuidedTest from "./pages/GuidedTest";
import Review from "./pages/Review";
import ReportComplete from "./pages/ReportComplete";
import ManualPatterns from "./pages/ManualPatterns";
import Maintenance from "./pages/Maintenance";
import Setup from "./pages/Setup";
import SessionDetail from "./pages/SessionDetail";

function Chrome() {
  const { status, needsPin, lastFault, clearFault } = useApp();
  const location = useLocation();
  const isSetup = location.pathname === "/setup";

  return (
    <div className="shell">
      <div className="topbar">
        <img className="logo" src="/tl-logo-mark.png" alt="" aria-hidden="true" />
        <span
          className={`statusdot ${status?.health_ok ? "ok" : "bad"}`}
          title={status?.health_ok ? "Healthy" : "Attention required"}
        />
        <span className="title">
          {status?.identity.friendly_name ?? "TL Test Source"}
        </span>
        <span className="srcnum">
          {status ? `SOURCE ${status.identity.source_number}` : "OFFLINE"}
        </span>
      </div>

      {lastFault && (
        <div className="alert error" role="alert" onClick={clearFault}>
          ⚠ {lastFault} — tap to dismiss
        </div>
      )}
      {status && !status.setup_complete && !isSetup && (
        <div className="alert warn">
          First-run setup has not been completed.{" "}
          <NavLink to="/setup">Run setup now</NavLink>
        </div>
      )}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewTest />} />
        <Route path="/session/:id" element={<SessionDetail />} />
        <Route path="/session/:id/test" element={<GuidedTest />} />
        <Route path="/session/:id/review" element={<Review />} />
        <Route path="/session/:id/report" element={<ReportComplete />} />
        <Route path="/patterns" element={<ManualPatterns />} />
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/setup" element={<Setup />} />
        {/* Unknown paths land on Home rather than an empty shell. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {needsPin && <PinDialog />}

      <nav className="tabbar">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
          <span className="icon">⌂</span>Home
        </NavLink>
        <NavLink to="/patterns" className={({ isActive }) => (isActive ? "active" : "")}>
          <span className="icon">▦</span>Patterns
        </NavLink>
        <NavLink to="/new" className={({ isActive }) => (isActive ? "active" : "")}>
          <span className="icon">＋</span>New test
        </NavLink>
        <NavLink to="/maintenance" className={({ isActive }) => (isActive ? "active" : "")}>
          <span className="icon">⚙</span>Maintain
        </NavLink>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Chrome />
      </BrowserRouter>
    </AppProvider>
  );
}
