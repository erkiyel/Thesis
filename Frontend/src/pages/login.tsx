import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { getRole, isSupabaseConfigured, resendSignupConfirmation } from '@/lib/supabase';

export default function Login() {
  const [, setLocation] = useLocation();
  const { session, isLoading, login, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === 'success') {
      setResetMessage('Your password was changed. Sign in with your new password.');
    }
  }, []);

  useEffect(() => {
    if (!isLoading && session) {
      const role = getRole(session.user);
      if (role) setLocation(`/${role}`);
    }
  }, [isLoading, session, setLocation]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const normalizedEmail = email.trim();
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError('Enter a valid email address.'); return; }
    if (!password || password.length > 128) { setError('Enter a password of 128 characters or fewer.'); return; }
    setRequiresConfirmation(false);
    setResendMessage('');
    setResendError('');
    setIsSubmitting(true);
    try {
      const next = await login(normalizedEmail, password);
      const role = getRole(next.user);
      if (!role) {
        const approvalStatus = next.user.profile?.approval_status;
        if (approvalStatus === 'pending' || approvalStatus === 'rejected') await logout();
        setError(approvalStatus === 'pending'
          ? 'Your email is confirmed, but your account is still pending administrator approval. You can sign in after an administrator approves it and assigns your workspace.'
          : approvalStatus === 'rejected'
            ? 'This registration was not approved. Contact the system administrator for help.'
            : 'Your account is authenticated, but no workspace role is assigned. Contact your system administrator.');
        return;
      }
      setLocation(`/${role}`);
    } catch (caught) {
      const authError = caught as (Error & { code?: string });
      const message = authError instanceof Error ? authError.message : 'Sign in failed. Please try again.';
      const unconfirmed = authError.code === 'email_not_confirmed' || /email not confirmed|confirm your email|email.*not verified/i.test(message);
      setRequiresConfirmation(unconfirmed);
      setError(unconfirmed
        ? 'Your email address has not been confirmed. Confirm it before signing in, then wait for administrator approval.'
        : message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendConfirmation() {
    setResendError('');
    setResendMessage('');
    if (resendCooldown > 0) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) { setResendError('Enter a valid email address first.'); return; }
    setResendBusy(true);
    try {
      await resendSignupConfirmation(email);
      setResendMessage('If this address belongs to an unconfirmed account, a confirmation email has been sent. Check your inbox and spam folder.');
      const until = Date.now() + 60_000;
      try { window.sessionStorage.setItem(`oncophil-confirm-resend:${email.trim().toLowerCase()}`, String(until)); } catch {}
      setResendCooldown(60);
    } catch (cause) {
      setResendError(cause instanceof Error ? cause.message : 'Unable to resend the confirmation email. Please try again later.');
    } finally {
      setResendBusy(false);
    }
  }

  useEffect(() => {
    if (!requiresConfirmation) return;
    try {
      const until = Number(window.sessionStorage.getItem(`oncophil-confirm-resend:${email.trim().toLowerCase()}`) ?? 0);
      setResendCooldown(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    } catch { setResendCooldown(0); }
  }, [email, requiresConfirmation]);

  return (
    <main className="min-h-[100dvh] bg-background">
      <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
        <section className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col lg:justify-center">
          <div className="absolute inset-0 medical-grid opacity-30" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="brand-mark" aria-hidden="true" />
              <div>
                <p className="font-serif text-xl font-extrabold tracking-tight">Jacdash</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-sidebar-foreground/50">pharmaceutical management</p>
              </div>
            </div>
            <div className="mt-24 max-w-md">
              <h1 className="font-serif text-5xl font-extrabold leading-[1.06] tracking-[-0.045em]">
                The clear start to careful work.
              </h1>
              <p className="mt-6 max-w-sm text-base leading-7 text-sidebar-foreground/65">
                A secure operations workspace for the people who keep pharmaceutical work moving with discipline.
              </p>
            </div>
          </div>
        </section>

        <section className="flex min-h-[100dvh] flex-col justify-between px-5 py-6 sm:px-10 sm:py-9">
          <div className="flex items-center lg:hidden">
            <Link href="/" className="flex items-center gap-2" data-testid="link-login-brand">
              <span className="brand-mark size-8 rounded-md" aria-hidden="true" />
              <span className="font-serif text-lg font-extrabold tracking-tight">Jacdash</span>
            </Link>
          </div>

          <div className="mx-auto w-full max-w-[420px] py-12 page-enter">
            <div className="mb-9">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Welcome back</p>
              <h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.04em]">Sign in to Jacdash Asia Corp.</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Use your authorized account to continue to the right workspace.</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <Input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@organisation.com" className="h-12 bg-card" data-testid="input-email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="h-12 bg-card pr-11" data-testid="input-password" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-toggle-password">
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-xs font-semibold text-primary underline-offset-4 hover:underline" data-testid="link-forgot-password">
                  Forgot password?
                </Link>
              </div>
              {resetMessage && (
                <div className="rounded-lg border border-emerald-600/25 bg-emerald-600/5 px-4 py-3 text-sm leading-5 text-emerald-800" role="status" data-testid="status-password-reset-success">
                  {resetMessage}
                </div>
              )}
              {error && (
                <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive" role="alert" data-testid="status-login-error">{error}</div>
              )}
              {requiresConfirmation && (
                <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
                  <Button type="button" variant="outline" disabled={resendBusy || resendCooldown > 0 || !email.trim()} onClick={() => void handleResendConfirmation()} className="w-full" data-testid="button-resend-confirmation">
                    {resendBusy ? 'Sending confirmation email…' : resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : 'Resend confirmation email'}
                  </Button>
                  {resendMessage && <p className="text-sm leading-5 text-emerald-800" role="status">{resendMessage}</p>}
                  {resendError && <p className="text-sm leading-5 text-destructive" role="alert">{resendError}</p>}
                </div>
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
            <p className="mt-6 text-center text-sm text-muted-foreground">Need an account? <Link href="/register" className="font-semibold text-primary underline-offset-4 hover:underline">Register</Link></p>
          </div>

          <footer className="flex items-center justify-between gap-4 border-t border-border/70 pt-5 font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
            <span>Jacdash Asia Corp.</span>
            <span>Secure access</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
