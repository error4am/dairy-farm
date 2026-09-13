import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './app/AppLayout';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { AnimalsPage } from './features/animals/AnimalsPage';
import { AnimalProfilePage } from './features/animals/AnimalProfilePage';
import { HealthPage } from './features/health/HealthPage';
import { BreedingPage } from './features/breeding/BreedingPage';
import { MilkPage } from './features/milk/MilkPage';
import { FinancesPage } from './features/finances/FinancesPage';
import { SettingsPage } from './features/settings/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="animals" element={<AnimalsPage />} />
        <Route path="animals/:id" element={<AnimalProfilePage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="breeding" element={<BreedingPage />} />
        <Route path="milk" element={<MilkPage />} />
        <Route path="finances" element={<FinancesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
