import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/lib/api';
import { emailConfirmationRedirect } from '@/lib/supabase';

export default function Register() {
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const normalizedName = fullName.trim();
    const normalizedEmail = email.trim();
    if (!normalizedName || normalizedName.length > 120) { setError('Enter your full name up to 120 characters.'); return; }
    if (organizationName.trim().length > 160) { setError('Company or organization name must be 160 characters or fewer.'); return; }
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError('Enter a valid email address.'); return; }
    if (password.length < 8 || password.length > 128) { setError('Password must be between 8 and 128 characters.'); return; }
    if (password !== confirmPassword) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      await apiRequest('/register', { method: 'POST', body: JSON.stringify({ fullName: normalizedName, organizationName: organizationName.trim(), email: normalizedEmail, password, emailRedirectTo: emailConfirmationRedirect() }) });
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit the registration.');
    } finally { setBusy(false); }
  }

  return <main className="flex min-h-[100dvh] items-center justify-center bg-background p-5 sm:p-8">
    <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-9">
      <Link href="/login" className="font-serif text-xl font-extrabold">Jacdash</Link>
      {complete ? <div className="mt-8 space-y-5" role="status"><h1 className="font-serif text-3xl font-extrabold">Registration submitted</h1><p className="text-sm leading-6 text-muted-foreground">Registration successful. Please check your email and click the confirmation link to verify your email address. Your account will still need administrator approval.</p><Button asChild><Link href="/login">Return to sign in</Link></Button></div> : <>
        <div className="mb-7 mt-8"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Account registration</p><h1 className="mt-3 font-serif text-3xl font-extrabold">Request access.</h1><p className="mt-2 text-sm text-muted-foreground">An administrator will review your details and assign your workspace.</p></div>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2"><Label htmlFor="register-name">Full name</Label><Input id="register-name" required maxLength={120} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="register-organization">Company or organization (optional)</Label><Input id="register-organization" maxLength={160} autoComplete="organization" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="register-email">Email address</Label><Input id="register-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="register-password">Password</Label><div className="relative"><Input id="register-password" type={showPassword ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="pr-11" /><button type="button" className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded text-muted-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
          <div className="grid gap-2"><Label htmlFor="register-confirm-password">Confirm password</Label><div className="relative"><Input id="register-confirm-password" type={showConfirmPassword ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="pr-11" /><button type="button" className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded text-muted-foreground" aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'} onClick={() => setShowConfirmPassword((value) => !value)}>{showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
          {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Submitting…' : 'Submit registration'} <ArrowRight size={16} /></Button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">Already have an account? <Link className="font-semibold text-primary underline-offset-4 hover:underline" href="/login">Sign in</Link></p>
      </>}
    </section>
  </main>;
}
