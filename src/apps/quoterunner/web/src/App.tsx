import { BrowserRouter, Link, Route, Routes } from "react-router";
import { AppShell } from "@ui/AppShell";
import { AuthProvider, RedirectIfSignedIn, RequireAuth } from "@ui/auth";
import { ToastProvider } from "@ui/components/toast";
import { AcceptInvitePage, ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from "@ui/pages/auth";
import { BillingSettings, ProfileSettings, SettingsLayout, TeamSettings } from "@ui/pages/settings";
import { EmptyState } from "@ui/components/display";
import { buttonClass } from "@ui/components/button";
import { brand, nav } from "./brand";
import { Dashboard } from "./pages/Dashboard";
import { RequestsList } from "./pages/RequestsList";
import { NewRequest } from "./pages/NewRequest";
import { RequestDetail } from "./pages/RequestDetail";
import { Suppliers } from "./pages/Suppliers";
import { Orders, OrderDetail } from "./pages/Orders";
import { Prices } from "./pages/Prices";
import { CompanySettings } from "./pages/CompanySettings";
import { SupplierPortal } from "./pages/SupplierPortal";

function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      action={
        <Link to="/app" className={buttonClass("secondary")}>
          Go to overview
        </Link>
      }
    >
      The link may be old, or the page moved.
    </EmptyState>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<RedirectIfSignedIn><LoginPage brand={brand} /></RedirectIfSignedIn>} />
            <Route path="/signup" element={<RedirectIfSignedIn><SignupPage brand={brand} /></RedirectIfSignedIn>} />
            <Route path="/forgot-password" element={<ForgotPasswordPage brand={brand} />} />
            <Route path="/reset-password" element={<ResetPasswordPage brand={brand} />} />
            <Route path="/invite/:token" element={<AcceptInvitePage brand={brand} />} />
            <Route path="/q/:token" element={<SupplierPortal />} />
            <Route
              path="/app"
              element={
                <RequireAuth>
                  <AppShell brand={brand} nav={nav} />
                </RequireAuth>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="requests" element={<RequestsList />} />
              <Route path="requests/new" element={<NewRequest />} />
              <Route path="requests/:id" element={<RequestDetail />} />
              <Route path="suppliers" element={<Suppliers />} />
              <Route path="orders" element={<Orders />} />
              <Route path="orders/:id" element={<OrderDetail />} />
              <Route path="prices" element={<Prices />} />
              <Route path="settings" element={<SettingsLayout extraTabs={[{ to: "/app/settings/company", label: "Company" }]} />}>
                <Route index element={<ProfileSettings />} />
                <Route path="company" element={<CompanySettings />} />
                <Route path="team" element={<TeamSettings />} />
                <Route path="billing" element={<BillingSettings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="*" element={<div className="p-6"><NotFound /></div>} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
