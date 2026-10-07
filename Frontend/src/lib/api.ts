import { supabase } from '@/lib/supabase';

export type Medicine = {
  id: string;
  name: string;
  price: number;
  stockQuantity: number;
  isAvailable: boolean;
  imageUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type OrderItem = {
  id: string;
  medicineId: string;
  medicineName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

export type TrackingEvent = {
  id: string;
  status: string;
  location: string;
  estimatedDelivery: string | null;
  notes: string;
  createdAt: string | null;
};

export type Order = {
  id: string;
  clientId: string;
  total: number;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  items: OrderItem[];
  payment: { id: string; method: string; status: string; amount: number } | null;
  tracking: TrackingEvent[];
};

export type DashboardMetrics = {
  medicineCount: number;
  availableMedicineCount: number;
  lowStockCount: number;
  orderCount: number;
  pendingOrderCount: number;
  revenue: number;
};

async function getToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...init, headers });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
}

export function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
