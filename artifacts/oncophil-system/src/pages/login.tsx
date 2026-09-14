import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { getRole, isSupabaseConfigured } from '@/lib/supabase';

export default function Login() {
  const [, setLocation] = useLocation();
  const { session, isLoading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && session) {
      const role = getRole(session.user);
      if (role) setLocation(`/${role}`);
    }
  }, [isLoading, session, setLocation]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const next = await login(email.trim(), password);
      const role = getRole(next.user);
      if (!role) {
        setError('Your account is authenticated, but no admin or client role is assigned. Contact your system administrator.');
        return;
      }
      setLocation(`/${role}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-background">
      <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
        <section className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 medical-grid opacity-30" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="brand-mark" aria-hidden="true" />
              <div>
                <p className="font-serif text-xl font-extrabold tracking-tight">oncophil</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-sidebar-foreground/50">pharmaceutical management</p>
              </div>
            </div>
            <div className="mt-28 max-w-md">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">System foundation · 01</p>
              <h1 className="mt-5 font-serif text-5xl font-extrabold leading-[1.06] tracking-[-0.045em]">
                The clear start to careful work.
              </h1>
              <p className="mt-6 max-w-sm text-base leading-7 text-sidebar-foreground/65">
                A secure operations workspace for the people who keep pharmaceutical work moving with discipline.
              </p>
            </div>
          </div>
          <div className="relative grid max-w-lg grid-cols-2 gap-3">
            {[
              ['01', 'Verified access', 'Role-aware entry for every account.'],
              ['02', 'Quiet by design', 'Only the work you are ready to use.'],
            ].map(([number, title, copy]) => (
              <div key={number} className="border-l border-accent/60 pl-4">
                <p className="font-mono text-[10px] text-accent">{number}</p>
                <p className="mt-2 text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs leading-5 text-sidebar-foreground/50">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex min-h-[100dvh] flex-col justify-between px-5 py-6 sm:px-10 sm:py-9">
          <div className="flex items-center justify-between lg:justify-end">
            <Link href="/" className="flex items-center gap-2 lg:hidden" data-testid="link-login-brand">
              <span className="brand-mark size-8 rounded-md" aria-hidden="true" />
              <span className="font-serif text-lg font-extrabold tracking-tight">oncophil</span>
            </Link>
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <LockKeyhole size={13} /> encrypted sign in
            </span>
          </div>

          <div className="mx-auto w-full max-w-[420px] py-12 page-enter">
            <div className="mb-9">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Welcome back</p>
              <h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.04em]">Sign in to Oncophil</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Use your authorized account to continue to the right workspace.</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@organisation.com" className="h-12 bg-card" data-testid="input-email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="h-12 bg-card pr-11" data-testid="input-password" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-toggle-password">
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
              {error && (
                <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive" role="alert" data-testid="status-login-error">{error}</div>
              )}
              {!isSupabaseConfigured() && (
                <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-xs leading-5 text-foreground" role="status" data-testid="status-config-warning">
                  Authentication is not configured in this environment. Add the Supabase project URL and publishable key before signing in.
                </div>
              )}
              <Button type="submit" disabled={isSubmitting || isLoading} className="h-12 w-full text-sm font-semibold" data-testid="button-submit-login">
                {isSubmitting ? 'Checking secure access…' : 'Continue to workspace'} <ArrowRight size={16} />
              </Button>
            </form>
            <div className="mt-8 flex items-start gap-3 border-t border-border pt-6 text-xs leading-5 text-muted-foreground">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
              <p>Access is managed through Supabase Auth. If your role is not assigned, your account will not be routed into a workspace.</p>
            </div>
          </div>

          <footer className="flex items-center justify-between gap-4 border-t border-border/70 pt-5 font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
            <span>Waterfall / Linear Sequential Model</span>
            <span>Phase 1 · Foundation</span>
          </footer>
        </section>
      </div>
    </main>
  );
}