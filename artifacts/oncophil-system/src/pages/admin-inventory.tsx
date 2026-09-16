import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, Pencil, Pill } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  createMedicine,
  formatMedicinePrice,
  listAdminMedicines,
  type Medicine,
  updateMedicine,
  uploadMedicineImage,
  validateMedicineInput,
} from '@/lib/medicines';
import type { UserRole } from '@/lib/supabase';

const ADMIN_MEDICINES_QUERY_KEY = ['medicines', 'admin'] as const;

type FormState = {
  name: string;
  price: string;
  stockQuantity: string;
  isAvailable: boolean;
  imageFile: File | null;
};

const emptyForm: FormState = {
  name: '',
  price: '',
  stockQuantity: '',
  isAvailable: true,
  imageFile: null,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to complete the request.';
}

export default function AdminInventory() {
  const queryClient = useQueryClient();
  const medicines = useQuery({
    queryKey: ADMIN_MEDICINES_QUERY_KEY,
    queryFn: listAdminMedicines,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Medicine | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const previewUrl = useMemo(() => {
    if (form.imageFile) return URL.createObjectURL(form.imageFile);
    return editing?.image_url ?? '';
  }, [editing?.image_url, form.imageFile]);

  const saveMedicine = useMutation({
    mutationFn: async () => {
      const parsed = validateMedicineInput({
        name: form.name,
        price: form.price,
        stockQuantity: form.stockQuantity,
        imageUrl: editing?.image_url,
        requireImage: !editing && !form.imageFile,
      });
      const imageUrl = form.imageFile
        ? await uploadMedicineImage(form.imageFile)
        : parsed.image_url;
      if (!imageUrl) throw new Error('A medicine image is required.');

      const payload = {
        ...parsed,
        image_url: imageUrl,
        is_available: form.isAvailable,
      };

      return editing
        ? updateMedicine(editing.id, payload)
        : createMedicine(payload);
    },
    onSuccess: async () => {
      setStatusMessage(editing ? 'Medicine updated successfully.' : 'Medicine added to inventory.');
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      setFormError('');
      await queryClient.invalidateQueries({ queryKey: ADMIN_MEDICINES_QUERY_KEY });
    },
    onError: (error) => {
      setFormError(errorMessage(error));
    },
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(medicine: Medicine) {
    setEditing(medicine);
    setForm({
      name: medicine.name,
      price: String(medicine.price),
      stockQuantity: String(medicine.stock_quantity),
      isAvailable: medicine.is_available,
      imageFile: null,
    });
    setFormError('');
    setDialogOpen(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setStatusMessage('');
    saveMedicine.mutate();
  }

  return (
    <AppShell role={'admin' satisfies UserRole} title="Medicines & inventory" eyebrow="Admin workspace">
      <div className="page-enter">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Inventory control</p>
            <h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Medicines on hand.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Add and update catalogue records. Medicines marked unavailable stay in this table but are hidden from client ordering views.
            </p>
          </div>
          <Button onClick={openCreate} className="h-11 px-4 text-sm font-semibold" data-testid="button-add-medicine">
            <PackagePlus size={16} /> Add medicine
          </Button>
        </div>

        {statusMessage && (
          <div className="mb-6 rounded-lg border border-emerald-600/25 bg-emerald-600/5 px-4 py-3 text-sm leading-5 text-emerald-800" role="status" data-testid="status-inventory-success">
            {statusMessage}
          </div>
        )}

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><Pill size={18} /></span>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Catalogue</p>
                <h3 className="mt-2 font-serif text-2xl font-extrabold tracking-tight">Inventory table</h3>
              </div>
            </div>
            {!medicines.isLoading && medicines.data && (
              <span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{medicines.data.length} medicines</span>
            )}
          </div>

          {medicines.isLoading && (
            <div className="mt-8 space-y-3" role="status" data-testid="status-inventory-loading">
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
            </div>
          )}
          {medicines.isError && (
            <div className="mt-8 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive" role="alert" data-testid="status-inventory-error">
              {errorMessage(medicines.error)}
            </div>
          )}
          {!medicines.isLoading && !medicines.isError && medicines.data?.length === 0 && (
            <div className="mt-8 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground" data-testid="status-inventory-empty">
              No medicines in inventory yet. Add the first record to begin the catalogue.
            </div>
          )}
          {!medicines.isLoading && !medicines.isError && !!medicines.data?.length && (
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Medicine</th>
                    <th className="pb-3 pr-4 font-medium">Price</th>
                    <th className="pb-3 pr-4 font-medium">Stock</th>
                    <th className="pb-3 pr-4 font-medium">Availability</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {medicines.data.map((medicine) => (
                    <tr key={medicine.id} className="border-b border-border/70 last:border-0" data-testid={`row-medicine-${medicine.id}`}>
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-3">
                          <img src={medicine.image_url} alt={medicine.name} className="size-12 rounded-lg border border-border object-cover" />
                          <span className="font-semibold">{medicine.name}</span>
                        </div>
                      </td>
                      <td className="py-4 pr-4 text-muted-foreground">{formatMedicinePrice(medicine.price)}</td>
                      <td className="py-4 pr-4 text-muted-foreground">{medicine.stock_quantity}</td>
                      <td className="py-4 pr-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${medicine.is_available ? 'bg-emerald-600/10 text-emerald-700' : 'bg-secondary text-muted-foreground'}`}>
                          {medicine.is_available ? 'Available' : 'Unavailable'}
                        </span>
                      </td>
                      <td className="py-4">
                        <Button variant="outline" size="sm" onClick={() => openEdit(medicine)} data-testid={`button-edit-medicine-${medicine.id}`}>
                          <Pencil size={14} /> Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-extrabold">{editing ? 'Edit medicine' : 'Add medicine'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update catalogue details. Unavailable medicines remain visible only to administrators.'
                : 'Create a catalogue record. Required fields must be completed before saving.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="medicine-name">Medicine name</Label>
              <Input
                id="medicine-name"
                required
                maxLength={200}
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Amoxicillin 500 mg"
                className="h-11 bg-background"
                data-testid="input-medicine-name"
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="medicine-price">Price</Label>
                <Input
                  id="medicine-price"
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                  placeholder="0.00"
                  className="h-11 bg-background"
                  data-testid="input-medicine-price"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="medicine-stock">Stock quantity</Label>
                <Input
                  id="medicine-stock"
                  type="number"
                  required
                  min="0"
                  step="1"
                  value={form.stockQuantity}
                  onChange={(event) => setForm((current) => ({ ...current, stockQuantity: event.target.value }))}
                  placeholder="0"
                  className="h-11 bg-background"
                  data-testid="input-medicine-stock"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="medicine-image">Medicine image</Label>
              <Input
                id="medicine-image"
                type="file"
                accept="image/*"
                required={!editing}
                onChange={(event) => setForm((current) => ({ ...current, imageFile: event.target.files?.[0] ?? null }))}
                className="h-11 bg-background pt-2"
                data-testid="input-medicine-image"
              />
              {previewUrl && (
                <img src={previewUrl} alt="Medicine preview" className="mt-2 size-20 rounded-lg border border-border object-cover" />
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Available to clients</p>
                <p className="text-xs leading-5 text-muted-foreground">Turn this off to hide the medicine from the client catalogue.</p>
              </div>
              <Switch
                checked={form.isAvailable}
                onCheckedChange={(checked) => setForm((current) => ({ ...current, isAvailable: checked }))}
                data-testid="switch-medicine-available"
              />
            </div>
            {formError && (
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive" role="alert" data-testid="status-medicine-form-error">
                {formError}
              </div>
            )}
            <DialogFooter>
              <Button type="submit" disabled={saveMedicine.isPending} className="h-11 text-sm font-semibold" data-testid="button-save-medicine">
                {saveMedicine.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add medicine'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
