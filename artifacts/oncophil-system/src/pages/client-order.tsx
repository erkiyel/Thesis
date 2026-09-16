import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowLeft, Clock3 } from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { getMedicine, formatMedicinePrice } from '@/lib/medicines';
import type { UserRole } from '@/lib/supabase';

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}

export default function ClientOrderPlaceholder({ medicineId }: { medicineId: string }) {
  const medicine = useQuery({
    queryKey: ['medicines', 'detail', medicineId],
    queryFn: () => getMedicine(medicineId),
    enabled: Boolean(medicineId),
  });

  return (
    <AppShell role={'client' satisfies UserRole} title="Order medicine" eyebrow="Client workspace">
      <div className="page-enter max-w-3xl">
        <Link
          href="/client"
          className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
          data-testid="link-back-catalogue"
        >
          <ArrowLeft size={14} /> Back to available medicines
        </Link>

        {medicine.isLoading && (
          <div
            className="mt-8 h-72 animate-pulse rounded-2xl bg-muted"
            role="status"
            data-testid="status-order-loading"
          />
        )}

        {medicine.isError && (
          <div
            className="mt-8 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive"
            role="alert"
          >
            {errorMessage(medicine.error)}
          </div>
        )}

        {!medicine.isLoading && !medicine.isError && !medicine.data && (
          <div
            className="mt-8 rounded-2xl border border-destructive/25 bg-destructive/5 p-6 text-sm leading-6 text-destructive"
            role="alert"
            data-testid="status-order-unavailable"
          >
            This medicine is unavailable, hidden from client ordering, or the link is not valid.
          </div>
        )}

        {medicine.data && (
          <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="grid gap-0 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <img
                src={medicine.data.image_url}
                alt={medicine.data.name}
                className="h-56 w-full object-cover sm:h-full"
              />

              <div className="p-6 sm:p-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
                  Selected medicine
                </p>

                <h2
                  className="mt-3 font-serif text-3xl font-extrabold tracking-tight"
                  data-testid="text-order-medicine-name"
                >
                  {medicine.data.name}
                </h2>

                <p className="mt-3 text-lg font-semibold">
                  {formatMedicinePrice(medicine.data.price)}
                </p>

                <p className="mt-2 text-sm text-muted-foreground">
                  {medicine.data.stock_quantity > 0
                    ? `${medicine.data.stock_quantity} in stock`
                    : 'Currently out of stock'}
                </p>

                <div className="mt-6 rounded-xl border border-accent/35 bg-accent/10 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Clock3 size={16} /> Ordering is not open yet
                  </p>

                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Phase 3 will handle orders and payments. You can review this medicine now, but checkout is not available.
                  </p>
                </div>

                <Button
                  disabled
                  className="mt-6 h-11 w-full text-sm font-semibold"
                  data-testid="button-place-order-disabled"
                >
                  Place order · coming later
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}