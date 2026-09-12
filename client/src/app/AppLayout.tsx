import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MilkForm } from '../features/milk/MilkForm';
import { useApi } from '../lib/useApi';
import { useMeta } from '../lib/MetaContext';
import type { Animal } from '../lib/types';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quickRecord, setQuickRecord] = useState(false);
  const location = useLocation();
  const meta = useMeta();
  const { data: animals } = useApi<Animal[]>(quickRecord ? '/animals?sort=tag_number&dir=asc' : null);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="app">
      <Sidebar open={sidebarOpen} />
      {sidebarOpen ? <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} /> : null}
      <div className="main">
        <Topbar onMenu={() => setSidebarOpen(true)} onRecordMilk={() => setQuickRecord(true)} />
        <div className="content">
          <Outlet />
        </div>
      </div>
      <MilkForm
        open={quickRecord}
        onClose={() => setQuickRecord(false)}
        animals={animals ?? []}
        defaultUnit={meta.farm.milk_unit}
      />
    </div>
  );
}
