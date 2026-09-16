import { useState } from 'react';
import { UserPlus, UsersRound } from 'lucide-react';
import {
  getListAdminClientsQueryKey,
  useCreateAdminClient,
  useListAdminClients,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UserRole } from '@/lib/supabase';

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
  const clients = useListAdminClients();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [formMessage, setFormMessage] = useState('');

  const createClient = useCreateAdminClient({
    mutation: {
      onSuccess: async () => {
        setFullName('');
        setEmail('');
        setInitialPassword('');
        setFormMessage('Client account created successfully.');
        await queryClient.invalidateQueries({ queryKey: getListAdminClientsQueryKey() });
      },
      onError: (error) => {
        setFormMessage(errorMessage(error));
      },
    },
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage('');
    createClient.mutate({
      data: { fullName, email, initialPassword },
    });
  }

  return (
    <AppShell role={'admin' satisfies UserRole} title="User management" eyebrow="Admin workspace">
      <div className="page-enter">
        <div className="mb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Account administration</p>
          <h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Create client access.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Create client accounts from the protected admin workspace. New accounts are always assigned the client role; this feature cannot create administrators.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]">
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><UserPlus size={18} /></span>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">New client</p>
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
                <Input id="client-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="maria@organisation.com" className="h-11 bg-background" data-testid="input-client-email" />
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
                {createClient.isPending ? 'Creating secure account…' : 'Create client account'} <UserPlus size={16} />
              </Button>
            </form>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><UsersRound size={18} /></span>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Existing accounts</p>
                  <h3 className="mt-2 font-serif text-2xl font-extrabold tracking-tight">Client directory</h3>
                </div>
              </div>
              {!clients.isLoading && clients.data && <span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{clients.data.length} clients</span>}
            </div>
            {clients.isLoading && <div className="mt-8 space-y-3" role="status" data-testid="status-client-list-loading"><div className="h-12 animate-pulse rounded-lg bg-muted" /><div className="h-12 animate-pulse rounded-lg bg-muted" /></div>}
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