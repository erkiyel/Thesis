import { Link } from 'wouter';
import { ArrowUpRight, CheckCircle2, Clock3, FileLock2, KeyRound, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { getUserAvatar, getUserLabel, type UserRole } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export function FoundationHome({ role }: { role: UserRole }) {
  const { user } = useAuth();
  const label = getUserLabel(user);
  const avatarUrl = getUserAvatar(user);
  const isAdmin = role === 'admin';
  const basePath = isAdmin ? '/admin' : '/client';

  return (
    <AppShell role={role} title={isAdmin ? 'Admin home' : 'Client home'} eyebrow={isAdmin ? 'Admin workspace' : 'Client workspace'}>
      <div className="page-enter">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-9">
          <div className="absolute right-0 top-0 h-full w-1/2 medical-grid opacity-60 [mask-image:linear-gradient(to_left,black,transparent)]" aria-hidden="true" />
          <div className="relative max-w-2xl">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
              <span className="size-1.5 rounded-full bg-accent" /> authenticated foundation
            </div>
            <h2 className="mt-5 font-serif text-4xl font-extrabold leading-[1.04] tracking-[-0.05em] sm:text-5xl">
              Good to see you, {label.split(' ')[0]}.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              {isAdmin
                ? 'Your administrative workspace is ready. Manage client access and keep the medicine catalogue accurate for the next operational phases.'
                : 'Your client workspace is ready. The foundation is intentionally quiet while the next Waterfall / Linear Sequential Model phase is prepared.'}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              {isAdmin && (
                <Link href="/admin/inventory" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-105" data-testid="link-open-inventory">
                  Open inventory <ArrowUpRight size={15} />
                </Link>
              )}
              <Link href={`${basePath}/profile`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-secondary" data-testid="link-open-profile">
                Review profile & access <ArrowUpRight size={15} />
              </Link>
              <span className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-xs text-muted-foreground">
                <CheckCircle2 size={15} className="text-emerald-600" /> Session verified
              </span>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Workspace status</p>
                <h3 className="mt-3 font-serif text-2xl font-extrabold tracking-tight">A clean starting point</h3>
              </div>
              <Avatar className="size-14 border border-border">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={`${label} profile`} />}
                <AvatarFallback className="bg-secondary text-sm font-bold text-secondary-foreground">{label.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><Clock3 size={18} /></span>
            </div>
            <div className="mt-8 space-y-0">
              {[
                ['Identity verified', 'Your Supabase Auth session is active.', true],
                ['Role boundary applied', `You are viewing the ${role} workspace.`, true],
                ['Operational modules', isAdmin ? 'Medicine inventory is available in this phase.' : 'Operational modules will appear in later phases.', isAdmin],
              ].map(([title, copy, complete], index) => (
                <div key={String(title)} className="flex gap-4 border-l border-border pb-7 pl-5 last:pb-0">
                  <span className={`-ml-[26px] flex size-3 shrink-0 items-center justify-center rounded-full border-4 border-card ${complete ? 'bg-primary' : 'bg-muted-foreground/40'}`} aria-hidden="true" />
                  <div className="-mt-1">
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">{copy}</p>
                  </div>
                  {index === 2 && (
                    <span className="ml-auto rounded-full bg-secondary px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      {complete ? 'ready' : 'queued'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-sidebar p-6 text-sidebar-foreground sm:p-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Access note</p>
            <h3 className="mt-3 font-serif text-2xl font-extrabold tracking-tight">Designed to stay clear.</h3>
            <p className="mt-4 text-sm leading-6 text-sidebar-foreground/60">This workspace will grow in sequenced phases. For now, the important work is dependable authentication and the correct boundary for your role.</p>
            <div className="mt-8 grid gap-3">
              <div className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3"><FileLock2 size={16} className="text-accent" /><span className="text-xs">Protected route</span></div>
              <div className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3"><KeyRound size={16} className="text-accent" /><span className="text-xs">Role-specific access</span></div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

export function ProfilePage({ role }: { role: UserRole }) {
  const { user } = useAuth();
  const label = getUserLabel(user);
  const avatarUrl = getUserAvatar(user);
  const basePath = role === 'admin' ? '/admin' : '/client';
  const email = user?.email ?? 'No email on account';
  const accountId = user?.id ?? 'Unavailable';

  return (
    <AppShell role={role} title="Profile & access" eyebrow="Account foundation">
      <div className="page-enter">
        <div className="mb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Identity record</p>
          <h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Your access, at a glance.</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">This is the account foundation for the current phase. Personal details are managed through your organization’s authenticated account.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Signed-in identity</p>
                <h3 className="mt-3 font-serif text-2xl font-extrabold tracking-tight" data-testid="text-profile-name">{label}</h3>
                <p className="mt-1 text-sm text-muted-foreground" data-testid="text-profile-email">{email}</p>
              </div>
              <Avatar className="size-14 border border-border">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={`${label} profile`} />}
                <AvatarFallback className="bg-secondary text-sm font-bold text-secondary-foreground">{label.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-600/20 bg-emerald-600/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-700"><ShieldCheck size={13} /> verified</span>
            </div>
            <dl className="grid gap-6 py-7 sm:grid-cols-2">
              <div><dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Workspace role</dt><dd className="mt-2 text-sm font-semibold capitalize" data-testid="text-profile-role">{role}</dd></div>
              <div><dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Account ID</dt><dd className="mt-2 break-all font-mono text-xs text-foreground" data-testid="text-profile-id">{accountId}</dd></div>
            </dl>
            <div className="rounded-xl border border-border bg-secondary/45 p-4 text-sm leading-6 text-muted-foreground">Your role determines which workspace you can access. If these details look incorrect, sign out and contact your Oncophil system administrator.</div>
          </section>
          <aside className="space-y-6">
            <section className="rounded-2xl border border-border bg-card p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Available now</p>
              <div className="mt-5 space-y-4">
                {['Secure sign in', 'Role-specific home', 'Authenticated sign out'].map((item) => <div key={item} className="flex items-center gap-3 text-sm"><CheckCircle2 size={16} className="text-emerald-600" />{item}</div>)}
              </div>
            </section>
            <section className="rounded-2xl border border-accent/35 bg-accent/10 p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/60">Next phase</p>
              <p className="mt-3 text-sm leading-6 text-foreground/75">Operational capabilities will appear here only when their phase is ready.</p>
              <Button asChild variant="outline" className="mt-5 w-full bg-card" data-testid="button-back-home"><Link href={basePath}>Return to home</Link></Button>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}