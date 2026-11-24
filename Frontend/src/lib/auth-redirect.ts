export const DEFAULT_PRODUCTION_APP_URL = 'https://jacdash.pages.dev';

export type AuthRedirectOptions = {
  production: boolean;
  currentOrigin: string;
  configuredAppUrl?: string;
  baseUrl?: string;
};

export function buildAuthRedirectUrl(path: string, options: AuthRedirectOptions): string {
  const target = options.production
    ? (options.configuredAppUrl?.trim() || DEFAULT_PRODUCTION_APP_URL)
    : options.currentOrigin;
  const parsedTarget = new URL(target);
  if (options.production && (
    parsedTarget.protocol !== 'https:'
    || parsedTarget.origin !== new URL(DEFAULT_PRODUCTION_APP_URL).origin
    || parsedTarget.pathname !== '/'
    || parsedTarget.username
    || parsedTarget.password
    || parsedTarget.search
    || parsedTarget.hash
  )) {
    throw new Error('Production authentication redirects must use the configured JacDASH Pages origin.');
  }

  const baseUrl = options.baseUrl ?? '/';
  const basePath = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const relativePath = path.replace(/^\/+/, '');
  return new URL(`${basePath}${relativePath}`, `${parsedTarget.origin}/`).toString();
}
