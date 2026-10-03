import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPasswordRecoverySession, signOut, supabase, updatePassword } from '@/lib/supabase';

type ResetState = 'checking' | 'ready' | 'invalid' | 'success';

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<ResetState>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const hashError = hashParams.get('error_description') ?? hashParams.get('error');
    if (hashError) {
      setError(hashError.replaceAll('+', ' '));
      setState('invalid');
      return;
    }

    let active = true;
    let recoveryEventReceived = false;
    const hasRecoveryParams =
      hashParams.has('access_token') ||
      hashParams.get('type') === 'recovery' ||
      new URLSearchParams(window.location.search).has('code');
    const checkSession = async () => {
      try {
        const session = await getPasswordRecoverySession();
        if (active) {
          setState(session && (hasRecoveryParams || recoveryEventReceived) ? 'ready' : 'invalid');
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'This reset link is no longer valid.');
          setState('invalid');
        }
      }
    };

    const timer = window.setTimeout(() => void checkSession(), 250);
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        recoveryEventReceived = event === 'PASSWORD_RECOVERY' || recoveryEventReceived;
        setState('ready');
      }
    }).data.subscription;

    return () => {
      active = false;
      window.clearTimeout(timer);
      subscription?.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await updatePassword(password);
      await signOut();
      setState('success');
      setLocation('/login?reset=success');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to change the password.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-background">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[620px] flex-col px-5 py-6 sm:px-10 sm:py-9">
        <div className="flex items-center justify-between">
          <Link href="/login" className="flex items-center gap-2" data-testid="link-reset-brand">
            <span className="brand-mark size-8 rounded-md" aria-hidden="true" />
            <span className="font-serif text-lg font-extrabold tracking-tight">oncophil</span>
          </Link>
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <KeyRound size={13} /> password reset
          </span>
        </div>

        <section className="mx-auto my-auto w-full max-w-[420px] py-12 page-enter">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Choose a new password</p>
          <h1 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.04em]">Reset your access.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Use a new password for your Oncophil account. Your reset link can only be used within its validity window.
          </p>

          {state === 'checking' && (
            <div className="mt-8 rounded-lg border border-border bg-card px-4 py-4 text-sm text-muted-foreground" role="status" data-testid="status-reset-checking">
              Verifying your secure reset link…
            </div>
          )}

          {state === 'ready' && (
            <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" className="h-12 bg-card" data-testid="input-new-password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repeat your new password" className="h-12 bg-card" data-testid="input-confirm-password" />
              </div>
              {error && (
                <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive" role="alert" data-testid="status-reset-error">
                  {error}
                </div>
              )}
              <Button type="submit" disabled={isSubmitting} className="h-12 w-full text-sm font-semibold" data-testid="button-update-password">
                {isSubmitting ? 'Updating password…' : 'Update password'} <ArrowRight size={16} />
              </Button>
            </form>
          )}

          {state === 'invalid' && (
            <div className="mt-8 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-4 text-sm leading-6 text-destructive" role="alert" data-testid="status-reset-invalid">
              {error || 'This reset link is invalid, expired, or has already been used. Request a new link and try again.'}
              <Link href="/forgot-password" className="mt-4 inline-flex font-semibold underline underline-offset-4">Request another reset link</Link>
            </div>
          )}

          {state === 'success' && (
            <div className="mt-8 rounded-lg border border-emerald-600/25 bg-emerald-600/5 px-4 py-4 text-sm leading-6 text-emerald-800" role="status" data-testid="status-reset-success">
              Your password was updated. Returning you to sign in…
            </div>
          )}

          <div className="mt-8 flex items-start gap-3 border-t border-border pt-6 text-xs leading-5 text-muted-foreground">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
            <p>Your password is managed by Supabase Auth and is never stored in the Oncophil application tables.</p>
          </div>
        </section>
      </div>
    </main>
  );
}