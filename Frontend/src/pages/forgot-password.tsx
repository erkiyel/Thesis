import { FormEvent, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isSupabaseConfigured, requestPasswordReset } from '@/lib/supabase';

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSent(false);
    setIsSubmitting(true);

    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send the reset email.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-background">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[620px] flex-col px-5 py-6 sm:px-10 sm:py-9">
        <div className="flex items-center justify-between">
          <Link href="/login" className="flex items-center gap-2" data-testid="link-forgot-back">
            <span className="brand-mark size-8 rounded-md" aria-hidden="true" />
            <span className="font-serif text-lg font-extrabold tracking-tight">oncophil</span>
          </Link>
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <KeyRound size={13} /> account recovery
          </span>
        </div>

        <section className="mx-auto my-auto w-full max-w-[420px] py-12 page-enter">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Secure recovery</p>
          <h1 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.04em]">Forgot your password?</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Enter your authorized account email and Supabase Auth will send a secure password reset link.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="recovery-email">Work email</Label>
              <Input
                id="recovery-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@organisation.com"
                className="h-12 bg-card"
                data-testid="input-recovery-email"
              />
            </div>
            {error && (
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive" role="alert" data-testid="status-recovery-error">
                {error}
              </div>
            )}
            {sent && (
              <div className="rounded-lg border border-emerald-600/25 bg-emerald-600/5 px-4 py-3 text-sm leading-5 text-emerald-800" role="status" data-testid="status-recovery-sent">
                If an account exists for that email, a reset link has been sent. Check your inbox and follow the link to choose a new password.
              </div>
            )}
            {!isSupabaseConfigured() && (
              <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-xs leading-5" role="status">
                Authentication is not configured in this environment.
              </div>
            )}
            <Button type="submit" disabled={isSubmitting} className="h-12 w-full text-sm font-semibold" data-testid="button-send-recovery">
              {isSubmitting ? 'Sending secure link…' : 'Send reset link'} <ArrowRight size={16} />
            </Button>
          </form>

          <div className="mt-8 flex items-start gap-3 border-t border-border pt-6 text-xs leading-5 text-muted-foreground">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
            <p>Reset links are time-limited and can be used for both admin and client accounts.</p>
          </div>
        </section>

        <footer className="border-t border-border/70 pt-5">
          <button type="button" onClick={() => setLocation('/login')} className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="button-return-login">
            <ArrowLeft size={14} /> Return to sign in
          </button>
        </footer>
      </div>
    </main>
  );
}