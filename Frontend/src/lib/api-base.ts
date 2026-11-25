export function resolveApiRoot(configuredBaseUrl: string | undefined): string {
  const baseUrl = String(configuredBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) return '/api';
  return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
}

export function rejectHtmlApiResponse(contentType: string | null, path: string): void {
  if (contentType?.toLowerCase().includes('text/html')) {
    throw new Error(`API endpoint ${path} returned an HTML page instead of JSON. Check VITE_API_BASE_URL and backend routing.`);
  }
}

export function requireApiArray<T>(value: unknown, path: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`API endpoint ${path} returned an invalid response: expected a JSON array.`);
  }
  return value as T[];
}
