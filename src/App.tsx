import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LogOut, ShieldAlert } from 'lucide-react';
import { AuthScreen } from '@/components/Auth/AuthScreen';
import { ResetPasswordScreen } from '@/components/Auth/ResetPasswordScreen';
import { AppShell } from '@/components/Layout/AppShell';
import { AppProvider, useApp } from '@/context/AppContext';
import { AIAssistantPage } from '@/pages/AIAssistantPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { AutomationPage } from '@/pages/AutomationPage';
import { BroadcastsPage } from '@/pages/BroadcastsPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { HomePage } from '@/pages/HomePage';
import { OverviewPage } from '@/pages/OverviewPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TeamInboxPage } from '@/pages/TeamInboxPage';
import { TeamMembersPage } from '@/pages/TeamMembersPage';
import { TemplatesPage } from '@/pages/TemplatesPage';

function ProtectedAppRoute() {
  const {
    authStatus,
    authLoading,
    passwordRecoveryActive,
    profileAccessError,
    logout,
  } = useApp();

  if (authLoading || authStatus === 'loading') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 rounded-full border-2 border-[#2563EB] border-t-transparent animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-500">Verifying Zoqniva AI session...</p>
        </div>
      </div>
    );
  }

  if (passwordRecoveryActive) {
    return <Navigate to="/reset-password" replace />;
  }

  if (authStatus === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  if (authStatus === 'unauthorized_access') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-[#E2E8F0] bg-white p-6 sm:p-8 shadow-luxury space-y-4 text-center">
          <div className="h-12 w-12 rounded-2xl bg-rose-50 text-[#E11D48] flex items-center justify-center mx-auto">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-lg font-bold text-[#0F172A]">
              Workspace Access Denied
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              {profileAccessError ||
                'Your account does not have an active business membership in this workspace.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  return <AppShell />;
}

function LoginRoute() {
  const { authStatus, authLoading, passwordRecoveryActive } = useApp();
  if (!authLoading && passwordRecoveryActive) {
    return <Navigate to="/reset-password" replace />;
  }
  if (!authLoading && authStatus === 'authenticated') {
    return <Navigate to="/app" replace />;
  }
  return <AuthScreen />;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Marketing Homepage */}
          <Route path="/" element={<HomePage />} />

          {/* Sign-In & Password Recovery */}
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/reset-password" element={<ResetPasswordScreen />} />

          {/* Protected CRM Workspace */}
          <Route path="/app" element={<ProtectedAppRoute />}>
            <Route index element={<OverviewPage />} />
            <Route path="inbox" element={<TeamInboxPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="broadcasts" element={<BroadcastsPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="automation" element={<AutomationPage />} />
            <Route path="ai-assistant" element={<AIAssistantPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="team" element={<TeamMembersPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          {/* Clean Legacy Path Redirects */}
          <Route path="/inbox" element={<Navigate to="/app/inbox" replace />} />
          <Route path="/contacts" element={<Navigate to="/app/contacts" replace />} />
          <Route path="/broadcasts" element={<Navigate to="/app/broadcasts" replace />} />
          <Route path="/templates" element={<Navigate to="/app/templates" replace />} />
          <Route path="/automation" element={<Navigate to="/app/automation" replace />} />
          <Route path="/ai-assistant" element={<Navigate to="/app/ai-assistant" replace />} />
          <Route path="/analytics" element={<Navigate to="/app/analytics" replace />} />
          <Route path="/team" element={<Navigate to="/app/team" replace />} />
          <Route path="/settings" element={<Navigate to="/app/settings" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
