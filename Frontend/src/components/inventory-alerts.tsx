import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest, type Medicine } from '@/lib/api';
import { classifyInventory, getInventoryAlertSettings, type InventoryAlert } from '@/lib/inventory-alerts';

function AlertTag({ children, danger = false }: { children: string; danger?: boolean }) {
  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${danger ? 'bg-destructive/10 text-destructive' : 'bg-orange-500/10 text-orange-700'}`}>{children}</span>;
}

export function AdminInventoryAlertHost() {
  const { user, loginEventId } = useAuth();
  const [location, setLocation] = useLocation();
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastLoginEvent = useRef(loginEventId);
  const previousLocation = useRef<string | null>(null);
  const inFlight = useRef(false);
  const refreshPending = useRef(false);
  const pendingShouldShow = useRef(false);

  const refreshAlerts = useCallback(async (showDialog = true) => {
    if (user?.profile?.role !== 'admin') return;
    if (inFlight.current) {
      refreshPending.current = true;
      pendingShouldShow.current ||= showDialog;
      return;
    }
    inFlight.current = true;
    setLoading(true);
    try {
      const inventory = await apiRequest<Medicine[]>('/medicines', { cache: 'no-store' });
      const next = classifyInventory(inventory, getInventoryAlertSettings());
      setAlerts(next);
      if (showDialog && next.length) setOpen(true);
      if (!next.length) setOpen(false);
    } catch {
      // Workspace page requests show the API error themselves; an alert probe
      // must not replace or obscure that page state.
    } finally {
      inFlight.current = false;
      setLoading(false);
      if (refreshPending.current) {
        const shouldShow = pendingShouldShow.current;
        refreshPending.current = false;
        pendingShouldShow.current = false;
        void refreshAlerts(shouldShow);
      }
    }
  }, [user?.profile?.role]);

  useEffect(() => {
    if (user?.profile?.role !== 'admin') {
      setOpen(false);
      previousLocation.current = location;
      lastLoginEvent.current = loginEventId;
      return;
    }
    const isInventoryPath = location === '/admin/inventory';
    const wasInventoryPath = previousLocation.current === '/admin/inventory';
    const enteredInventory = isInventoryPath && !wasInventoryPath;
    const completedLogin = loginEventId > lastLoginEvent.current;
    lastLoginEvent.current = loginEventId;
    previousLocation.current = location;
    if (completedLogin || enteredInventory) void refreshAlerts(true);
  }, [location, loginEventId, refreshAlerts, user?.profile?.role]);

  useEffect(() => {
    if (user?.profile?.role !== 'admin') return;
    const onInventoryChanged = () => void refreshAlerts(true);
    window.addEventListener('jacdash-inventory-updated', onInventoryChanged);
    window.addEventListener('jacdash-inventory-alert-settings-updated', onInventoryChanged);
    return () => {
      window.removeEventListener('jacdash-inventory-updated', onInventoryChanged);
      window.removeEventListener('jacdash-inventory-alert-settings-updated', onInventoryChanged);
    };
  }, [refreshAlerts, user?.profile?.role]);

  const lowStock = alerts.filter((entry) => entry.stockClass === 'low_stock').length;
  const outOfStock = alerts.filter((entry) => entry.stockClass === 'out_of_stock').length;
  const expiring = alerts.filter((entry) => entry.expiryClass === 'expiring_soon').length;
  const expired = alerts.filter((entry) => entry.expiryClass === 'expired').length;
  const settings = getInventoryAlertSettings();

  return <AlertDialog open={open} onOpenChange={setOpen}>
    <AlertDialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto">
      <AlertDialogHeader>
        <AlertDialogTitle>Inventory needs attention</AlertDialogTitle>
        <AlertDialogDescription>Latest stock and medicine expiration warnings. Dismissing this dialog does not disable future alerts.</AlertDialogDescription>
      </AlertDialogHeader>
      {loading ? <p className="py-6 text-center text-sm text-muted-foreground">Checking the latest inventory…</p> : <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-orange-500/10 p-3"><p className="text-2xl font-bold text-orange-700">{lowStock}</p><p className="text-xs">Low stock</p></div>
          <div className="rounded-lg bg-destructive/10 p-3"><p className="text-2xl font-bold text-destructive">{outOfStock}</p><p className="text-xs">Out of stock</p></div>
          <div className="rounded-lg bg-orange-500/10 p-3"><p className="text-2xl font-bold text-orange-700">{expiring}</p><p className="text-xs">Expiring soon</p></div>
          <div className="rounded-lg bg-destructive/10 p-3"><p className="text-2xl font-bold text-destructive">{expired}</p><p className="text-xs">Expired</p></div>
        </div>
        <p className="text-xs text-muted-foreground">Low stock is 1–{settings.lowStockThreshold} units. Expiring soon means within {settings.expiryWarningDays} days, using the Asia/Manila calendar.</p>
        <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {alerts.map((entry) => <li key={entry.medicine.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><span className="font-semibold">{entry.medicine.name}</span><div className="flex flex-wrap gap-1.5">
              {entry.stockClass === 'out_of_stock' && <AlertTag danger>Out of stock</AlertTag>}
              {entry.stockClass === 'low_stock' && <AlertTag>Low stock</AlertTag>}
              {entry.expiryClass === 'expired' && <AlertTag danger>Expired</AlertTag>}
              {entry.expiryClass === 'expiring_soon' && <AlertTag>Expiring soon</AlertTag>}
            </div></div>
            <p className="mt-2 text-xs text-muted-foreground">Stock: {entry.medicine.stockQuantity} · Threshold: {settings.lowStockThreshold}{entry.medicine.expirationDate ? ` · Expires ${entry.medicine.expirationDate.slice(0, 10)}${entry.daysUntilExpiry !== null ? ` · ${entry.daysUntilExpiry < 0 ? `${Math.abs(entry.daysUntilExpiry)} days past` : `${entry.daysUntilExpiry} days remaining`}` : ''}` : ' · No expiration date recorded'}</p>
          </li>)}
        </ul>
      </>}
      <AlertDialogFooter>
        <Button variant="outline" onClick={() => setOpen(false)}>Dismiss</Button>
        <Button onClick={() => { setOpen(false); setLocation(user?.profile?.role === 'admin' ? '/admin/inventory' : location); }}>View Inventory</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
