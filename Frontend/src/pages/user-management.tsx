import { useState } from 'react';
import { UserPlus, UsersRound } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { DatabaseLoading } from '@/components/database-loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UserRole } from '@/lib/supabase';
import { apiRequest } from '@/lib/api';

type ClientAccount = { id: string; fullName: string; email: string; role: string; status: string };
type PendingAccount = { id: string; fullName: string; email: string; organizationName: string | null; approvalStatus: 'pending' };

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === 'string') return message;
    }
  }
  return error instanceof Error ? error.message : 'Unable to complete the request.';
}

function statusLabel(status: string) {
  if (status === 'active') return 'Active';
  if (status === 'unconfirmed') return 'Unconfirmed';
  return 'Disabled';
}

export default function UserManagement() {
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ['admin-clients'], queryFn: () => apiRequest<ClientAccount[]>('/admin/clients') });
  const pending = useQuery({ queryKey: ['admin-approvals'], queryFn: () => apiRequest<PendingAccount[]>('/admin/approvals') });
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [formMessage, setFormMessage] = useState('');

  const createClient = useMutation({
    mutationFn: (data: { fullName: string; email: string; initialPassword: string }) =>
      apiRequest<ClientAccount>('/admin/clients', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: async () => {
        setFullName('');
        setEmail('');
        setInitialPassword('');
        setFormMessage('Client account created successfully.');
        await queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
    },
    onError: (error) => {
      setFormMessage(errorMessage(error));
    },
  });

  const reviewRegistration = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve_manager' | 'approve_partnership' | 'reject' }) =>
      apiRequest(`/admin/approvals/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action }) }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-approvals'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-clients'] }),
      ]);
    },
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage('');
    const normalizedEmail = email.trim();
    if (!fullName.trim() || fullName.trim().length > 120) return setFormMessage('Enter a full name up to 120 characters.');
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return setFormMessage('Enter a valid email address.');
    if (initialPassword.length < 8 || initialPassword.length > 128) return setFormMessage('Initial password must be between 8 and 128 characters.');
    createClient.mutate({ fullName: fullName.trim(), email: normalizedEmail, initialPassword });
  }

  return (
    <AppShell role={'admin' satisfies UserRole} title="User management" eyebrow="Admin workspace">
      <div className="page-enter">
        <div className="mb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Account administration</p>
          <h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Manage account access.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Review public registration requests and manage existing Partnership Account access. Administrators cannot be created through this form.</p>
        </div>

        <section className="mb-6 rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Account approval</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Pending Approvals</h3></div>{!pending.isLoading && pending.data && <span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{pending.data.length} pending</span>}</div>
          {pending.isLoading && <DatabaseLoading className="mt-3" label="Loading pending registrations" />}
          {pending.isError && <div className="mt-5 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{errorMessage(pending.error)}</div>}
          {!pending.isLoading && !pending.isError && pending.data?.length === 0 && <p className="mt-5 rounded-lg border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground">There are no registrations awaiting review.</p>}
          {!!pending.data?.length && <div className="mt-5 space-y-3">{pending.data.map((account) => <article key={account.id} className="flex flex-col gap-4 rounded-xl border border-border p-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="font-semibold">{account.fullName}</p><p className="mt-1 text-sm text-muted-foreground">{account.email}{account.organizationName ? ` · ${account.organizationName}` : ''}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" disabled={reviewRegistration.isPending} onClick={() => reviewRegistration.mutate({ id: account.id, action: 'approve_manager' })}>Approve as Manager</Button><Button variant="outline" size="sm" disabled={reviewRegistration.isPending} onClick={() => reviewRegistration.mutate({ id: account.id, action: 'approve_partnership' })}>Approve as Partnership Account</Button><Button variant="destructive" size="sm" disabled={reviewRegistration.isPending} onClick={() => reviewRegistration.mutate({ id: account.id, action: 'reject' })}>Reject Registration</Button></div></article>)}</div>}
          {reviewRegistration.isError && <p className="mt-4 text-sm text-destructive" role="alert">{errorMessage(reviewRegistration.error)}</p>}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]">
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><UserPlus size={18} /></span>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">New Partnership Account</p>
                <h3 className="mt-2 font-serif text-2xl font-extrabold tracking-tight">Account details</h3>
              </div>
            </div>
            <form onSubmit={submit} className="mt-7 space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="client-full-name">Full name</Label>
                <Input id="client-full-name" required maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Maria Santos" className="h-11 bg-background" data-testid="input-client-full-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-email">Email</Label>
                <Input id="client-email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="maria@organisation.com" className="h-11 bg-background" data-testid="input-client-email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-initial-password">Initial password</Label>
                <Input id="client-initial-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={initialPassword} onChange={(event) => setInitialPassword(event.target.value)} placeholder="At least 8 characters" className="h-11 bg-background" data-testid="input-client-initial-password" />
                <p className="text-xs leading-5 text-muted-foreground">The password is sent securely to Supabase Auth and is never stored in profiles.</p>
              </div>
              {formMessage && (
                <div className={`rounded-lg border px-4 py-3 text-sm leading-5 ${formMessage.includes('successfully') ? 'border-emerald-600/25 bg-emerald-600/5 text-emerald-800' : 'border-destructive/25 bg-destructive/5 text-destructive'}`} role={formMessage.includes('successfully') ? 'status' : 'alert'} data-testid="status-client-account-form">
                  {formMessage}
                </div>
              )}
              <Button type="submit" disabled={createClient.isPending} className="h-11 w-full text-sm font-semibold" data-testid="button-create-client">
                {createClient.isPending ? 'Creating secure account…' : 'Create Partnership Account'} <UserPlus size={16} />
              </Button>
            </form>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><UsersRound size={18} /></span>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Existing accounts</p>
                  <h3 className="mt-2 font-serif text-2xl font-extrabold tracking-tight">Account directory</h3>
                </div>
              </div>
              {!clients.isLoading && clients.data && <span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{clients.data.length} clients</span>}
            </div>
            {clients.isLoading && <div data-testid="status-client-list-loading"><DatabaseLoading className="mt-4" label="Loading client directory" /></div>}
            {clients.isError && <div className="mt-8 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive" role="alert" data-testid="status-client-list-error">{errorMessage(clients.error)}</div>}
            {!clients.isLoading && !clients.isError && clients.data?.length === 0 && <div className="mt-8 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground" data-testid="status-client-list-empty">No client accounts found yet.</div>}
            {!clients.isLoading && !clients.isError && !!clients.data?.length && (
              <div className="mt-8 overflow-x-auto">
                <table className="w-full min-w-[540px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Client</th>
                      <th className="pb-3 pr-4 font-medium">Email</th>
                      <th className="pb-3 pr-4 font-medium">Role</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.data.map((client) => (
                      <tr key={client.id} className="border-b border-border/70 last:border-0">
                        <td className="py-4 pr-4 font-semibold">{client.fullName}</td>
                        <td className="py-4 pr-4 text-muted-foreground">{client.email}</td>
                        <td className="py-4 pr-4 capitalize text-muted-foreground">{client.role}</td>
                        <td className="py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${client.status === 'active' ? 'bg-emerald-600/10 text-emerald-700' : 'bg-secondary text-muted-foreground'}`}>{statusLabel(client.status)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
