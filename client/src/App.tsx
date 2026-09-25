import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './app/AppLayout';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { AnimalsPage } from './features/animals/AnimalsPage';
import { AnimalProfilePage } from './features/animals/AnimalProfilePage';
import { HealthPage } from './features/health/HealthPage';
import { BreedingPage } from './features/breeding/BreedingPage';
import { MilkPage } from './features/milk/MilkPage';
import { FinancesPage } from './features/finances/FinancesPage';
import { InventoryPage } from './features/inventory/InventoryPage';
import { InventoryItemPage } from './features/inventory/InventoryItemPage';
import { EmployeesPage } from './features/employees/EmployeesPage';
import { EmployeeProfilePage } from './features/employees/EmployeeProfilePage';
import { SettingsPage } from './features/settings/SettingsPage';
import { LoginPage } from './features/auth/LoginPage';
import { SetupPage } from './features/auth/SetupPage';
import { useAuth } from './lib/AuthContext';

export default function App() {
  const auth = useAuth();

  if (auth.loading) {
    return (
      <div className="auth-screen">
        <div className="auth-card card">
          <p className="auth-subtitle">Loading…</p>
        </div>
      </div>
    );
  }

  if (auth.authEnabled && !auth.authenticated) {
    return auth.setupRequired ? <SetupPage /> : <LoginPage />;
  }

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
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="inventory/:id" element={<InventoryItemPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="employees/:id" element={<EmployeeProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
