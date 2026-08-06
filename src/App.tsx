import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell.tsx'
import { ToastProvider } from './components/ui/ToastProvider.tsx'
import { AuthProvider } from './features/auth/AuthProvider.tsx'
import { RequireAuth } from './features/auth/RequireAuth.tsx'
import { SignInPage } from './features/auth/SignInPage.tsx'
import { WorkspaceProvider } from './data/WorkspaceProvider.tsx'
import { DashboardPage } from './features/dashboard/DashboardPage.tsx'
import { CustomersPage } from './features/customers/CustomersPage.tsx'
import { CustomerDetailPage } from './features/customers/CustomerDetailPage.tsx'
import { FollowUpsPage } from './features/follow-ups/FollowUpsPage.tsx'
import { ScreenshotInboxPage } from './features/screenshots/ScreenshotInboxPage.tsx'
import { WhatsAppPage } from './features/whatsapp/WhatsAppPage.tsx'
import { SettingsPage } from './features/settings/SettingsPage.tsx'

/**
 * Every route except sign-in sits behind RequireAuth. That guard is for
 * usability; Row Level Security is what actually keeps the rows private.
 *
 * The workspace is loaded inside the guard so no query is issued before there
 * is a session to issue it under.
 */
export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route
            element={
              <RequireAuth>
                <WorkspaceProvider>
                  <AppShell />
                </WorkspaceProvider>
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:customerId" element={<CustomerDetailPage />} />
            <Route path="follow-ups" element={<FollowUpsPage />} />
            <Route path="screenshots" element={<ScreenshotInboxPage />} />
            <Route path="whatsapp" element={<WhatsAppPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}
