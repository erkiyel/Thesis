import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Package } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { formatMedicinePrice, listAvailableMedicines } from '@/lib/medicines';
import { useAuth } from '@/hooks/use-auth';
import { getUserLabel, type UserRole } from '@/lib/supabase';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load available medicines.';
}

export default function ClientHome() {
  const { user } = useAuth();
  const label = getUserLabel(user);
  const medicines = useQuery({
    queryKey: ['medicines', 'available'],
    queryFn: listAvailableMedicines,
  });

  return (
    <AppShell role={'client' satisfies UserRole} title="Client home" eyebrow="Client workspace">
      <div className="page-enter">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-9">
          <div className="absolute right-0 top-0 h-full w-1/2 medical-grid opacity-60 [mask-image:linear-gradient(to_left,black,transparent)]" aria-hidden="true" />
          <div className="relative max-w-2xl">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
              <span className="size-1.5 rounded-full bg-accent" /> available medicines
            </div>
            <h2 className="mt-5 font-serif text-4xl font-extrabold leading-[1.04] tracking-[-0.05em] sm:text-5xl">
              Good to see you, {label.split(' ')[0]}.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              Review medicines currently available to your account. Selecting a medicine opens the ordering page; checkout and payment belong to a later phase.
            </p>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Catalogue</p>
              <h3 className="mt-2 font-serif text-2xl font-extrabold tracking-tight">Ready to order later</h3>
            </div>
            {!medicines.isLoading && medicines.data && (
              <span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{medicines.data.length} available</span>
            )}
          </div>

          {medicines.isLoading && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" data-testid="status-client-medicines-loading">
              <div className="h-64 animate-pulse rounded-2xl bg-muted" />
              <div className="h-64 animate-pulse rounded-2xl bg-muted" />
              <div className="h-64 animate-pulse rounded-2xl bg-muted" />
            </div>
          )}
          {medicines.isError && (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive" role="alert" data-testid="status-client-medicines-error">
              {errorMessage(medicines.error)}
            </div>
          )}
          {!medicines.isLoading && !medicines.isError && medicines.data?.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground" data-testid="status-client-medicines-empty">
              No medicines are available to order yet.
            </div>
          )}
          {!medicines.isLoading && !medicines.isError && !!medicines.data?.length && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {medicines.data.map((medicine) => (
                <Link
                  key={medicine.id}
                  href={`/client/order/${medicine.id}`}
                  className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:border-primary/40"
                  data-testid={`card-medicine-${medicine.id}`}
                >
                  <div className="aspect-[4/3] bg-secondary">
                    <img src={medicine.image_url} alt={medicine.name} className="h-full w-full object-cover" />
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-serif text-xl font-extrabold tracking-tight">{medicine.name}</h4>
                      <ArrowUpRight size={16} className="mt-1 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                    </div>
                    <p className="mt-2 text-sm font-semibold">{formatMedicinePrice(medicine.price)}</p>
                    <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Package size={14} />
                      {medicine.stock_quantity > 0 ? `${medicine.stock_quantity} in stock` : 'Out of stock'}
                      <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 font-semibold text-emerald-700">Available</span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
