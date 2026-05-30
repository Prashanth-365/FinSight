import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { AppShell } from '@/components/layout/AppShell.jsx';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute.jsx';
import { AuthLanding } from '@/pages/AuthLanding.jsx';
import Home from '@/pages/Home.jsx';
import Transactions from '@/pages/Transactions.jsx';
import Investments from '@/pages/Investments.jsx';
import SmsQueue from '@/pages/SmsQueue.jsx';
import Statements from '@/pages/Statements.jsx';
import Settings, { SettingsLayout } from '@/pages/Settings/Settings.jsx';
import Profiles from '@/pages/Settings/Profiles.jsx';
import Accounts from '@/pages/Settings/Accounts.jsx';
import Categories from '@/pages/Settings/Categories.jsx';
import InvestmentsSettings from '@/pages/Settings/InvestmentsSettings.jsx';
import Preferences from '@/pages/Settings/Preferences.jsx';
import Data from '@/pages/Settings/Data.jsx';

export default function App() {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-fg">
          <span className="inline-block w-3 h-3 rounded-full bg-primary animate-pulse" />
          Loading FinSight…
        </div>
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<AuthLanding />} />
      <Route path="/register" element={<AuthLanding />} />

      <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route index element={<Home />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/sms" element={<SmsQueue />} />
        <Route path="/statements" element={<Statements />} />
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Settings />} />
          <Route path="profiles" element={<Profiles />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="categories" element={<Categories />} />
          <Route path="investments" element={<InvestmentsSettings />} />
          <Route path="preferences" element={<Preferences />} />
          <Route path="data" element={<Data />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
