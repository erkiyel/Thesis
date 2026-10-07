import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { lazy, Suspense } from 'react';
import {
  ImagePlus,
  PackageCheck,
  Pencil,
  Plus,
  Trash2,
  ShoppingCart,
  Stethoscope,
  Truck,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DatabaseLoading } from '@/components/database-loading';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from 'wouter';
import { apiRequest, formatCurrency, formatDate, type Medicine, type Order } from '@/lib/api';

const ForecastDashboard = lazy(() => import('@/pages/forecast-dashboard'));

function ErrorNotice({ message }: { message: string }) {
  return message ? <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{message}</div> : null;
}

function StatusPill({ value }: { value: string }) {
  return <span className="inline-flex items-center justify-center rounded-full bg-secondary px-2.5 py-1 text-center text-xs font-semibold capitalize text-foreground">{value.replaceAll('_', ' ')}</span>;
}

const orderStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

type AdminPageView = 'home' | 'inventory' | 'orders';

export function AdminDashboardPage({ view = 'home' }: { view?: AdminPageView }) {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      setError('');
      if (view === 'orders') setOrders(await apiRequest<Order[]>('/orders'));
      else if (view === 'inventory') setMedicines(await apiRequest<Medicine[]>('/medicines'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the admin workspace.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [view]);

  async function updateOrder(orderId: string, data: Record<string, unknown>) {
    const updated = await apiRequest<Order>(`/admin/orders/${encodeURIComponent(orderId)}`, { method: 'PATCH', body: JSON.stringify(data) });
    setOrders((current) => current.map((order) => order.id === orderId ? updated : order));
    return updated;
  }

  if (view === 'home') return <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading forecasting dashboard…</div>}><ForecastDashboard /></Suspense>;

  return (
    <AppShell role="admin" title={view === 'inventory' ? 'Medicine inventory' : 'Orders & tracking'} eyebrow="Operations workspace">
      <div className="page-enter space-y-8">
        <div>
          <h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">{view === 'inventory' ? 'Manage medicine inventory.' : 'Keep every order moving.'}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{view === 'inventory' ? 'Add and update medicine details, prices, stock, availability, and images.' : 'Review payment records and update order status and package tracking.'}</p>
        </div>
        <ErrorNotice message={error} />
        {view === 'inventory' && <AdminInventory medicines={medicines} loading={loading} loadError={error} onChanged={refresh} />}
        {view === 'orders' && <section className="rounded-2xl border border-border bg-card p-6 sm:p-8" id="orders">
          <div className="flex items-start gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><Truck size={18} /></span><div><h3 className="font-serif text-2xl font-extrabold">Orders & package tracking</h3></div></div>
          {loading ? <DatabaseLoading className="mt-5" label="Loading orders" /> : error ? null : orders.length === 0 ? <p className="mt-8 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No orders have been placed yet.</p> : (
            <div className="mt-8 space-y-4">
              {orders.map((order) => <AdminOrderRow key={order.id} order={order} onUpdate={updateOrder} />)}
            </div>
          )}
        </section>}
      </div>
    </AppShell>
  );
}

function AdminInventory({ medicines, loading, loadError, onChanged }: { medicines: Medicine[]; loading: boolean; loadError: string; onChanged: () => Promise<void> }) {
  const emptyForm = { name: '', price: '', stockQuantity: '0', isAvailable: true };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Medicine | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function edit(medicine: Medicine) {
    setEditingId(medicine.id);
    setForm({ name: medicine.name, price: String(medicine.price), stockQuantity: String(medicine.stockQuantity), isAvailable: medicine.isAvailable });
    setMessage('');
    setError('');
  }

  function reset() { setEditingId(null); setForm(emptyForm); setImage(null); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setMessage(''); setError('');
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, String(value)));
    if (image) data.append('image', image);
    try {
      await apiRequest<Medicine>(editingId ? `/admin/medicines/${editingId}` : '/admin/medicines', { method: 'POST', body: data });
      setMessage(editingId ? 'Medicine updated.' : 'Medicine added to inventory.');
      reset();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the medicine.');
    } finally { setSaving(false); }
  }

  async function deleteMedicine() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeletingId(target.id);
    setError(''); setMessage('');
    try {
      await apiRequest<{ id: string; deleted: boolean }>(`/admin/medicines/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      if (editingId === target.id) reset();
      setDeleteTarget(null);
      setMessage(`${target.name} was deleted.`);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete this medicine.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-8" id="inventory">
      <div className="flex items-start gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><Stethoscope size={18} /></span><div><h3 className="font-serif text-2xl font-extrabold">Medicine inventory</h3></div></div>
      <div className="mt-8 grid gap-8 xl:grid-cols-[340px_minmax(0,1fr)]">
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-secondary/30 p-5">
          <div className="flex items-center justify-between"><p className="font-semibold">{editingId ? 'Edit medicine' : 'Add medicine'}</p>{editingId && <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>}</div>
          <div className="space-y-2"><Label htmlFor="medicine-name">Medicine name</Label><Input id="medicine-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Amoxicillin 500mg" /></div>
          <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="medicine-price">Price (PHP)</Label><Input id="medicine-price" required type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div><div className="space-y-2"><Label htmlFor="medicine-stock">Stock</Label><Input id="medicine-stock" required type="number" min="0" step="1" value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })} /></div></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isAvailable} onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })} /> Available for clients</label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground"><ImagePlus size={16} />{image ? image.name : 'Upload product image'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setImage(e.target.files?.[0] ?? null)} /></label>
          {loadError && <ErrorNotice message={loadError} />}{error && <ErrorNotice message={error} />}{message && <p className="rounded-lg bg-emerald-600/10 px-3 py-2 text-sm text-emerald-700">{message}</p>}
          <Button type="submit" disabled={saving} className="w-full">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add medicine'} <Plus size={16} /></Button>
        </form>
        <div className="overflow-x-auto">
          {loading ? <DatabaseLoading label="Loading inventory" /> : loadError ? null : medicines.length === 0 ? <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No medicines have been added.</div> : <table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><th className="pb-3 pr-3">Medicine</th><th className="pb-3 pr-3">Price</th><th className="pb-3 pr-3">Stock</th><th className="pb-3 pr-3">Availability</th><th /></tr></thead><tbody>{medicines.map((medicine) => <tr key={medicine.id} className="border-b border-border/70 last:border-0"><td className="py-4 pr-3 font-semibold">{medicine.name}</td><td className="py-4 pr-3">{formatCurrency(medicine.price)}</td><td className="py-4 pr-3">{medicine.stockQuantity}</td><td className="py-4 pr-3"><StatusPill value={medicine.isAvailable && medicine.stockQuantity > 0 ? 'available' : 'unavailable'} /></td><td className="py-4 text-right"><Button variant="ghost" size="sm" onClick={() => edit(medicine)}><Pencil size={15} /> Edit</Button><Button variant="ghost" size="sm" disabled={deletingId === medicine.id} onClick={() => setDeleteTarget(medicine)}><Trash2 size={15} /> {deletingId === medicine.id ? 'Deleting…' : 'Delete'}</Button></td></tr>)}</tbody></table>}
        </div>
      </div>
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && deletingId === null) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the medicine from inventory. Medicines referenced by orders or forecasts cannot be deleted, so their history remains intact.</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <ErrorNotice message={error} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deletingId !== null} onClick={(event) => { event.preventDefault(); void deleteMedicine(); }}>{deletingId ? 'Deleting…' : 'Delete medicine'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function AdminOrderRow({ order, onUpdate }: { order: Order; onUpdate: (id: string, data: Record<string, unknown>) => Promise<Order> }) {
  const [status, setStatus] = useState(order.status);
  const [paymentStatus, setPaymentStatus] = useState(order.payment?.status ?? 'unpaid');
  const [location, setLocation] = useState(order.tracking[0]?.location ?? '');
  const [estimatedDelivery, setEstimatedDelivery] = useState(order.tracking[0]?.estimatedDelivery?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { await onUpdate(order.id, { status, paymentStatus, location, estimatedDelivery: estimatedDelivery || null }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update this order.'); }
    finally { setBusy(false); }
  }
  return <article className="rounded-xl border border-border p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Order {order.id.slice(0, 8)}</p><p className="mt-2 font-semibold">{formatCurrency(order.total)} · {formatDate(order.createdAt)}</p><div className="mt-2 flex flex-wrap gap-2">{order.items.map((item) => <span key={item.id} className="rounded-md bg-secondary px-2 py-1 text-xs">{item.medicineName} × {item.quantity}</span>)}</div></div><StatusPill value={order.status} /></div><div className="mt-5 grid gap-3 md:grid-cols-4"><select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">{orderStatuses.map((option) => <option key={option}>{option}</option>)}</select><select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="unpaid">Payment unpaid</option><option value="pending">Payment pending</option><option value="paid">Payment paid</option><option value="refunded">Refunded</option></select><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Current location" /><Input type="date" value={estimatedDelivery} onChange={(e) => setEstimatedDelivery(e.target.value)} /></div>{error && <div className="mt-3"><ErrorNotice message={error} /></div>}<div className="mt-3 flex justify-end"><Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Updating…' : 'Update order & tracking'} <PackageCheck size={15} /></Button></div>{order.tracking.length > 0 && <div className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">Latest update: {order.tracking[0].status} · {order.tracking[0].location || 'Location pending'} · {formatDate(order.tracking[0].createdAt)}</div>}</article>;
}

type ClientPageView = 'home' | 'catalogue' | 'tracking' | 'history';

export function ClientCataloguePage({ view = 'catalogue' }: { view?: ClientPageView }) {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh(showLoading = true) {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const nextMedicines = view === 'home' || view === 'catalogue' ? await apiRequest<Medicine[]>('/medicines') : [];
      const nextOrders = view === 'tracking' || view === 'history' ? await apiRequest<Order[]>('/orders') : [];
      setMedicines(nextMedicines); setOrders(nextOrders);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load the page data.'); }
    finally { if (showLoading) setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [view]);
  const cartLines = useMemo(() => medicines.filter((medicine) => cart[medicine.id]).map((medicine) => ({ medicine, quantity: cart[medicine.id] })), [cart, medicines]);
  const total = cartLines.reduce((sum, line) => sum + line.medicine.price * line.quantity, 0);

  async function checkout() {
    setBusy(true); setMessage(''); setError('');
    try {
      await apiRequest<Order>('/orders', { method: 'POST', body: JSON.stringify({ paymentMethod, items: cartLines.map(({ medicine, quantity }) => ({ medicineId: medicine.id, quantity })) }) });
      setCart({}); setMessage('Order placed successfully. Your package updates will appear below.'); await refresh(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to place the order.'); } finally { setBusy(false); }
  }

  if (view === 'home') {
    const available = medicines.filter((medicine) => medicine.isAvailable && medicine.stockQuantity > 0);
    return <AppShell role="client" title="Client home" eyebrow="Client workspace"><div className="page-enter space-y-8"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Medicine catalogue</p><h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Welcome to Oncophil.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Browse medicines available for ordering and follow your packages from the navigation.</p></div><ErrorNotice message={error} /><section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Available products</p><p className="mt-2 font-serif text-3xl font-extrabold">{loading || error ? '—' : available.length}</p></div><Link href="/client/catalogue" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Open ordering</Link></div>{loading ? <DatabaseLoading className="mt-5" label="Loading available products" /> : !error && available.length > 0 && <div className="mt-6 grid gap-3 sm:grid-cols-2">{available.slice(0, 4).map((medicine) => <article key={medicine.id} className="rounded-xl border border-border p-4"><p className="font-semibold">{medicine.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatCurrency(medicine.price)} · {medicine.stockQuantity} in stock</p></article>)}</div>}</section></div></AppShell>;
  }

  if (view === 'tracking' || view === 'history') {
    const records = view === 'tracking'
      ? orders.filter((order) => !['delivered', 'cancelled'].includes(order.status))
      : orders.filter((order) => ['delivered', 'cancelled'].includes(order.status));
    return <AppShell role="client" title={view === 'tracking' ? 'Package tracking' : 'Purchase history'} eyebrow="Client workspace"><div className="page-enter space-y-8"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Client orders</p><h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">{view === 'tracking' ? 'Follow your packages.' : 'Past purchases.'}</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{view === 'tracking' ? 'Current order status, estimated delivery, and tracking updates.' : 'Orders that have been delivered or cancelled.'}</p></div><ErrorNotice message={error} />{loading ? <DatabaseLoading label={view === 'tracking' ? 'Loading package tracking' : 'Loading purchase history'} /> : error ? null : records.length === 0 ? <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{view === 'tracking' ? 'There are no active packages to track.' : 'There are no previous orders yet.'}</p> : <div className="space-y-4">{records.map((order) => <article key={order.id} className="rounded-xl border border-border bg-card p-5"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Order {order.id.slice(0, 8)} · {formatDate(order.createdAt)}</p><p className="mt-2 font-semibold">{formatCurrency(order.total)} · {order.payment?.method?.toUpperCase() ?? 'PAYMENT'} <span className="ml-2 text-xs font-normal text-muted-foreground">{order.payment?.status ?? 'unpaid'}</span></p></div><StatusPill value={order.status} /></div><div className="mt-4 flex flex-wrap gap-2">{order.items.map((item) => <span key={item.id} className="rounded-md bg-secondary px-2 py-1 text-xs">{item.medicineName} × {item.quantity}</span>)}</div>{order.tracking.length > 0 && <div className="mt-5 space-y-2 border-t border-border pt-4">{order.tracking.map((event) => <div key={event.id} className="flex gap-3 text-sm"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><div><p className="font-semibold capitalize">{event.status.replaceAll('_', ' ')}{event.location ? ` · ${event.location}` : ''}</p><p className="text-xs text-muted-foreground">{event.notes || 'Package update recorded'} · {formatDate(event.createdAt)}{event.estimatedDelivery ? ` · ETA ${formatDate(event.estimatedDelivery)}` : ''}</p></div></div>)}</div>}</article>)}</div>}</div></AppShell>;
  }

  return <AppShell role="client" title="Medicine catalogue" eyebrow="Client workspace"><div className="page-enter space-y-8"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Medicine catalogue</p><h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Order what you need.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Browse medicines, choose a payment method, and follow every order through delivery.</p></div><ErrorNotice message={error} />{message && <div className="rounded-lg border border-emerald-600/25 bg-emerald-600/5 px-4 py-3 text-sm text-emerald-700">{message}</div>}<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]"><section className="grid gap-4 sm:grid-cols-2">{loading ? <div className="col-span-full"><DatabaseLoading label="Loading medicines" /></div> : error ? null : medicines.length === 0 ? <div className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No medicines are currently available.</div> : medicines.map((medicine) => <article key={medicine.id} className="rounded-2xl border border-border bg-card p-5">{medicine.imageUrl ? <img src={medicine.imageUrl} alt={medicine.name} className="mb-4 h-40 w-full rounded-xl bg-secondary object-contain" /> : <div className="flex size-12 items-center justify-center rounded-xl bg-secondary text-primary"><Stethoscope size={20} /></div>}<h3 className="mt-2 font-serif text-xl font-extrabold">{medicine.name}</h3><div className="mt-5 flex items-center justify-between"><span className="font-semibold">{formatCurrency(medicine.price)}</span><span className="text-xs text-muted-foreground">{medicine.stockQuantity} in stock</span></div><div className="mt-4 flex items-center gap-2"><Button variant="outline" size="sm" disabled={!cart[medicine.id]} onClick={() => setCart({ ...cart, [medicine.id]: Math.max(0, (cart[medicine.id] ?? 0) - 1) })}>−</Button><span className="min-w-6 text-center text-sm">{cart[medicine.id] ?? 0}</span><Button variant="outline" size="sm" disabled={(cart[medicine.id] ?? 0) >= medicine.stockQuantity} onClick={() => setCart({ ...cart, [medicine.id]: (cart[medicine.id] ?? 0) + 1 })}>+</Button><Button className="ml-auto" size="sm" onClick={() => setCart({ ...cart, [medicine.id]: Math.max(1, cart[medicine.id] ?? 0) })}><ShoppingCart size={15} /> Add</Button></div></article>)}</section><aside className="h-fit rounded-2xl border border-border bg-card p-6"><div className="flex items-center gap-3"><ShoppingCart size={18} className="text-primary" /><h3 className="font-serif text-2xl font-extrabold">Your order</h3></div>{cartLines.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">Your cart is empty.</p> : <><div className="mt-6 space-y-3">{cartLines.map(({ medicine, quantity }) => <div key={medicine.id} className="flex justify-between gap-3 text-sm"><span>{medicine.name} × {quantity}</span><span className="font-semibold">{formatCurrency(medicine.price * quantity)}</span></div>)}</div><div className="mt-6 border-t border-border pt-4"><div className="flex justify-between font-semibold"><span>Total</span><span>{formatCurrency(total)}</span></div><label className="mt-5 block text-xs font-semibold text-muted-foreground">Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground"><option value="cash">Cash</option><option value="gcash">GCash record (no online processing)</option></select></label><Button disabled={busy} onClick={() => void checkout()} className="mt-5 w-full">{busy ? 'Placing order…' : 'Place order'} <PackageCheck size={15} /></Button></div></>}</aside></div><section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><div className="flex items-start gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><Truck size={18} /></span><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Client archive</p><h3 className="mt-2 font-serif text-2xl font-extrabold">Order history & tracking</h3></div></div>{loading ? <DatabaseLoading className="mt-5" label="Loading order history" /> : error ? null : orders.length === 0 ? <p className="mt-8 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Your completed and current orders will appear here.</p> : <div className="mt-8 space-y-4">{orders.map((order) => <article key={order.id} className="rounded-xl border border-border p-5"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Order {order.id.slice(0, 8)} · {formatDate(order.createdAt)}</p><p className="mt-2 font-semibold">{formatCurrency(order.total)} · {order.payment?.method?.toUpperCase() ?? 'PAYMENT'} <span className="ml-2 text-xs font-normal text-muted-foreground">{order.payment?.status ?? 'unpaid'}</span></p></div><StatusPill value={order.status} /></div><div className="mt-4 flex flex-wrap gap-2">{order.items.map((item) => <span key={item.id} className="rounded-md bg-secondary px-2 py-1 text-xs">{item.medicineName} × {item.quantity}</span>)}</div>{order.tracking.length > 0 && <div className="mt-5 space-y-2 border-t border-border pt-4">{order.tracking.map((event) => <div key={event.id} className="flex gap-3 text-sm"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><div><p className="font-semibold capitalize">{event.status.replaceAll('_', ' ')}{event.location ? ` · ${event.location}` : ''}</p><p className="text-xs text-muted-foreground">{event.notes || 'Package update recorded'} · {formatDate(event.createdAt)}{event.estimatedDelivery ? ` · ETA ${formatDate(event.estimatedDelivery)}` : ''}</p></div></div>)}</div>}</article>)}</div>}</section></div></AppShell>;
}
