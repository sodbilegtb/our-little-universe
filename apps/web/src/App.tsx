import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { PartyPage } from '@/pages/party/PartyPage';

// Guests load only the party bundle. Other surfaces are fetched on demand.
const TvPage = lazy(() => import('@/pages/tv/TvPage').then((m) => ({ default: m.TvPage })));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const DoctorPage = lazy(() => import('@/pages/doctor/DoctorPage').then((m) => ({ default: m.DoctorPage })));
const DevLauncher = lazy(() => import('@/pages/DevLauncher').then((m) => ({ default: m.DevLauncher })));

export function App() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-night" />}>
      <Routes>
        <Route path="/" element={import.meta.env.DEV ? <DevLauncher /> : <Navigate to="/party" replace />} />
        <Route path="/party" element={<PartyPage />} />
        <Route path="/tv" element={<TvPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/doctor/:token" element={<DoctorPage />} />
        <Route path="/doctor" element={<DoctorPage />} />
        <Route path="*" element={<Navigate to="/party" replace />} />
      </Routes>
    </Suspense>
  );
}
