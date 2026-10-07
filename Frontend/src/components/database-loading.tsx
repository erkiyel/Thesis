import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export function DatabaseLoading({ label = 'Loading data', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-40 items-center justify-center', className)} aria-busy="true">
      <Spinner className="size-6 text-primary" aria-label={label} />
    </div>
  );
}
