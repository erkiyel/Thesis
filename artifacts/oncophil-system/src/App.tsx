import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Login from '@/pages/login';
import ForgotPassword from '@/pages/forgot-password';
import ResetPassword from '@/pages/reset-password';
import { FoundationHome, ProfilePage } from '@/pages/foundation';
import UserManagement from '@/pages/user-management';
import AdminInventory from '@/pages/admin-inventory';
import ClientHome from '@/pages/client-home';
import ClientOrderPlaceholder from '@/pages/client-order';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { getRole } from '@/lib/supabase';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function LoadingScreen() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4" aria-label="Loading workspace">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="h-10 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      </div>
    </main>
  );
}

function AccessBoundary() {
  const { user, logout } = useAuth();
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <span className="font-serif text-xl font-extrabold">!</span>
        </div>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Access boundary</p>
        <h1 className="mt-3 font-serif text-3xl font-extrabold tracking-tight">Role assignment required</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          This account is authenticated, but it is not assigned an admin or client role. Ask your system administrator to update your Supabase account metadata.
        </p>
        <p className="mt-4 break-all font-mono text-[10px] text-muted-foreground" data-testid="text-unassigned-user">{user?.email ?? user?.id}</p>
        <button onClick={() => void logout()} className="mt-7 inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground" data-testid="button-boundary-logout">Sign out</button>
      </section>
    </main>
  );
}

function Protected({ role, children }: { role: 'admin' | 'client'; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) setLocation('/login');
    if (!isLoading && user) {
      const actualRole = getRole(user);
      if (!actualRole) return;
      if (actualRole !== role) setLocation(`/${actualRole}`);
    }
  }, [isLoading, role, setLocation, user]);

  if (isLoading) return <LoadingScreen />;
  if (!user) return <LoadingScreen />;
  if (!getRole(user)) return <AccessBoundary />;
  if (getRole(user) !== role) return <LoadingScreen />;
  return <>{children}</>;
}

function Home() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading) setLocation(user ? `/${getRole(user) ?? 'login'}` : '/login');
  }, [isLoading, setLocation, user]);
  return <LoadingScreen />;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/admin/profile">
          <Protected role="admin"><ProfilePage role="admin" /></Protected>
        </Route>
        <Route path="/admin/users">
          <Protected role="admin"><UserManagement /></Protected>
        </Route>
        <Route path="/admin/inventory">
          <Protected role="admin"><AdminInventory /></Protected>
        </Route>
        <Route path="/admin">
          <Protected role="admin"><FoundationHome role="admin" /></Protected>
        </Route>
        <Route path="/client/order/:id">
          {(params) => (
            <Protected role="client">
              <ClientOrderPlaceholder medicineId={params.id ?? ''} />
            </Protected>
          )}
        </Route>
        <Route path="/client/profile">
          <Protected role="client"><ProfilePage role="client" /></Protected>
        </Route>
        <Route path="/client">
          <Protected role="client"><ClientHome /></Protected>
        </Route>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
