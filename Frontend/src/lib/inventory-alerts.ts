import type { Medicine } from '@/lib/api';

export type InventoryAlertSettings = { lowStockThreshold: number; expiryWarningDays: number };
export type InventoryAlert = {
  medicine: Medicine;
  stockClass: 'out_of_stock' | 'low_stock' | null;
  expiryClass: 'expired' | 'expiring_soon' | null;
  daysUntilExpiry: number | null;
};

export const INVENTORY_ALERT_SETTINGS_KEY = 'jacdash-inventory-alert-settings-v1';
export const DEFAULT_INVENTORY_ALERT_SETTINGS: InventoryAlertSettings = { lowStockThreshold: 10, expiryWarningDays: 90 };

export function getInventoryAlertSettings(): InventoryAlertSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(INVENTORY_ALERT_SETTINGS_KEY) ?? '{}') as Partial<InventoryAlertSettings>;
    return {
      lowStockThreshold: Number.isInteger(stored.lowStockThreshold) ? Math.max(0, Math.min(1_000_000, stored.lowStockThreshold!)) : DEFAULT_INVENTORY_ALERT_SETTINGS.lowStockThreshold,
      expiryWarningDays: Number.isInteger(stored.expiryWarningDays) ? Math.max(1, Math.min(3650, stored.expiryWarningDays!)) : DEFAULT_INVENTORY_ALERT_SETTINGS.expiryWarningDays,
    };
  } catch {
    return DEFAULT_INVENTORY_ALERT_SETTINGS;
  }
}

export function manilaDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function classifyInventory(medicines: Medicine[], settings = getInventoryAlertSettings(), today = manilaDate()): InventoryAlert[] {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  return medicines.map((medicine) => {
    const stockClass: InventoryAlert['stockClass'] = medicine.stockQuantity === 0 ? 'out_of_stock' : medicine.stockQuantity > 0 && medicine.stockQuantity <= settings.lowStockThreshold ? 'low_stock' : null;
    const rawExpiry = medicine.expirationDate?.slice(0, 10) ?? null;
    const expiryMs = rawExpiry ? Date.parse(`${rawExpiry}T00:00:00Z`) : Number.NaN;
    const daysUntilExpiry = Number.isFinite(expiryMs) ? Math.floor((expiryMs - todayMs) / 86_400_000) : null;
    const expiryClass: InventoryAlert['expiryClass'] = daysUntilExpiry === null ? null : daysUntilExpiry < 0 ? 'expired' : daysUntilExpiry <= settings.expiryWarningDays ? 'expiring_soon' : null;
    return { medicine, stockClass, expiryClass, daysUntilExpiry };
  }).filter((entry) => entry.stockClass !== null || entry.expiryClass !== null);
}
