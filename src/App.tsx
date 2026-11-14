import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, Outlet, Link } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Auth from "./pages/Auth";
import Shell from "./components/Shell";
const Landing = lazy(() => import("./pages/Landing"));
const Settings = lazy(() => import("./pages/Settings"));
const Rotation = lazy(() => import("./pages/Rotation"));
const Analytics = lazy(() => import("./pages/Analytics"));
const MapPage = lazy(() => import("./pages/Map"));
const Farms = lazy(() => import("./pages/Farms"));
function Protected() {
  const { user, demo, loading } = useAuth();
  return loading ? (
    <p>Загрузка…</p>
  ) : user || demo ? (
    <Outlet />
  ) : (
    <Navigate to="/auth" replace />
  );
}
export default function App() {
  return (
    <Suspense fallback={<div className="page">Загрузка…</div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth" element={<Auth />} />
        <Route element={<Protected />}>
          <Route element={<Shell />}>
            <Route path="/map" element={<MapPage />} />
            <Route path="/farms" element={<Farms />} />
            <Route path="/analytics/:fieldId" element={<Analytics />} />
            <Route path="/rotation/:fieldId" element={<Rotation />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
