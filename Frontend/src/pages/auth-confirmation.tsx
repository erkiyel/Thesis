import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';

type ConfirmationState = 'checking' | 'confirmed' | 'expired' | 'invalid';

function callbackError() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = query.get('error_code') ?? hash.get('error_code') ?? '';
  const message = query.get('error_description') ?? hash.get('error_description') ?? query.get('error') ?? hash.get('error') ?? '';
  if (!code && !message) return null;
  return /expired|otp_expired/i.test(`${code} ${message}`) ? 'expired' as const : 'invalid' as const;
}

export default function AuthConfirmation() {
  const { session, isLoading, logout } = useAuth();
  const initialError = useMemo(callbackError, []);
  const [state, setState] = useState<ConfirmationState>(initialError ?? 'checking');
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);

  useEffect(() => {
    if (initialError) {
      setState(initialError);
      return;
    }
    if (state !== 'checking') return;
    if (isLoading) return;
    if (session?.user.email_confirmed_at) {
      setApprovalStatus(session.user.profile?.approval_status ?? null);
      setState('confirmed');
      if (session.user.profile?.approval_status === 'pending' || session.user.profile?.approval_status === 'rejected') {
        void logout().catch(() => undefined);
      }
      return;
    }

    const timer = window.setTimeout(() => setState('invalid'), 8000);
    return () => window.clearTimeout(timer);
  }, [initialError, isLoading, logout, session, state]);

  const pendingApproval = approvalStatus === 'pending';
  const rejected = approvalStatus === 'rejected';

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-5 sm:p-8">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-9">
        <Link href="/login" className="font-serif text-xl font-extrabold">Jacdash</Link>
        <div className="mt-8 space-y-4" role={state === 'checking' ? 'status' : 'alert'}>
          {state === 'checking' ? <>
            <h1 className="font-serif text-3xl font-extrabold">Confirming your email</h1>
            <p className="text-sm leading-6 text-muted-foreground">Please wait while we verify your confirmation link.</p>
          </> : state === 'expired' ? <>
            <h1 className="font-serif text-3xl font-extrabold">Confirmation link expired</h1>
            <p className="text-sm leading-6 text-muted-foreground">This confirmation link has expired. Return to sign in and request a new confirmation email.</p>
          </> : state === 'invalid' ? <>
            <h1 className="font-serif text-3xl font-extrabold">Confirmation link unavailable</h1>
            <p className="text-sm leading-6 text-muted-foreground">This link is invalid or has already been used. Return to sign in and request a new confirmation email.</p>
          </> : <>
            <h1 className="font-serif text-3xl font-extrabold">Email confirmed</h1>
            {pendingApproval ? <p className="text-sm leading-6 text-muted-foreground">Your email address is confirmed. Your account still needs administrator approval and a workspace assignment before you can sign in.</p>
              : rejected ? <p className="text-sm leading-6 text-muted-foreground">Your email address is confirmed, but this registration was not approved. Contact the system administrator for help.</p>
                : <p className="text-sm leading-6 text-muted-foreground">Your email address is confirmed. You may now sign in. New registrations still require administrator approval before workspace access.</p>}
          </>}
        </div>
        {state !== 'checking' && <Button asChild className="mt-6"><Link href="/login">Return to sign in</Link></Button>}
      </section>
    </main>
  );
}
