import { supabase } from '@/lib/supabase';

export const MEDICINE_IMAGE_BUCKET = 'medicine-images';
export const MEDICINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface Medicine {
  id: string;
  name: string;
  image_url: string;
  price: number;
  stock_quantity: number;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

export interface MedicineInput {
  name: string;
  image_url: string;
  price: number;
  stock_quantity: number;
  is_available: boolean;
}

const MEDICINE_COLUMNS =
  'id, name, image_url, price, stock_quantity, is_available, created_at, updated_at';

function requireClient() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add the Supabase project URL and publishable key.',
    );
  }
  return supabase;
}

function asMedicine(row: Medicine): Medicine {
  return {
    ...row,
    price: Number(row.price),
    stock_quantity: Number(row.stock_quantity),
    is_available: Boolean(row.is_available),
  };
}

export function formatMedicinePrice(price: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(price);
}

export function validateMedicineInput(input: {
  name: string;
  price: string;
  stockQuantity: string;
  imageUrl?: string;
  requireImage: boolean;
}): MedicineInput {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Medicine name is required.');
  }

  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Price must be a valid non-negative amount.');
  }

  const stockQuantity = Number(input.stockQuantity);
  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
    throw new Error('Stock quantity must be a valid non-negative whole number.');
  }

  const imageUrl = input.imageUrl?.trim() ?? '';
  if (input.requireImage && !imageUrl) {
    throw new Error('A medicine image is required.');
  }

  return {
    name,
    image_url: imageUrl,
    price,
    stock_quantity: stockQuantity,
    is_available: true,
  };
}

export function validateMedicineImage(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Upload an image file for the medicine.');
  }
  if (file.size > MEDICINE_IMAGE_MAX_BYTES) {
    throw new Error('Medicine images must be 5 MB or smaller.');
  }
}

export async function listAdminMedicines(): Promise<Medicine[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('medicines')
    .select(MEDICINE_COLUMNS)
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => asMedicine(row as Medicine));
}

export async function listAvailableMedicines(): Promise<Medicine[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('medicines')
    .select(MEDICINE_COLUMNS)
    .eq('is_available', true)
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => asMedicine(row as Medicine));
}

export async function getMedicine(id: string): Promise<Medicine | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('medicines')
    .select(MEDICINE_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? asMedicine(data as Medicine) : null;
}

export async function uploadMedicineImage(file: File): Promise<string> {
  const client = requireClient();
  validateMedicineImage(file);

  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage
    .from(MEDICINE_IMAGE_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (error) throw new Error(error.message);

  const { data } = client.storage.from(MEDICINE_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function createMedicine(input: MedicineInput): Promise<Medicine> {
  const client = requireClient();
  const { data, error } = await client
    .from('medicines')
    .insert(input)
    .select(MEDICINE_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return asMedicine(data as Medicine);
}

export async function updateMedicine(
  id: string,
  input: MedicineInput,
): Promise<Medicine> {
  const client = requireClient();
  const { data, error } = await client
    .from('medicines')
    .update(input)
    .eq('id', id)
    .select(MEDICINE_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return asMedicine(data as Medicine);
}
