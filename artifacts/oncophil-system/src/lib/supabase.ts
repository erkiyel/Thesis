import {
  createClient,
  type Session,
  type User,
} from '@supabase/supabase-js';

export type UserRole = 'admin' | 'client';

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string;
  role: UserRole;
}

export type AuthUser = User & {
  profile: Profile | null;
};

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user: AuthUser;
}

const supabaseUrl = String(
  import.meta.env.VITE_SUPABASE_URL ??
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL ??
    '',
).replace(/\/$/, '');

const supabasePublishableKey = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    '',
);

export const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function isSupabaseConfigured() {
  return supabase !== null;
}

async function loadProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, role')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(`Unable to load your profile: ${error.message}`);
  return (data as Profile | null) ?? null;
}

export async function resolveSession(
  session: Session | null,
): Promise<AuthSession | null> {
  if (!session) return null;

  const profile = await loadProfile(session.user.id);
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: {
      ...session.user,
      profile,
    },
  };
}

export function getRole(user: AuthUser | null): UserRole | null {
  const role = user?.profile?.role;
  return role === 'admin' || role === 'client' ? role : null;
}

export function getUserLabel(user: AuthUser | null) {
  const profileName = user?.profile?.full_name;
  if (profileName?.trim()) return profileName.trim();

  const metadataName =
    user?.user_metadata?.full_name ?? user?.user_metadata?.name;
  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim();
  }

  return user?.email?.split('@')[0] ?? 'Account holder';
}

export function getUserAvatar(user: AuthUser | null) {
  return user?.profile?.avatar_url?.trim() || null;
}

export async function signIn(
  email: string,
  password: string,
): Promise<AuthSession> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(
      error.message || 'Sign in failed. Check your credentials.',
    );
  }

  if (!data.session) {
    throw new Error('Sign in did not return an authenticated session.');
  }

  const resolved = await resolveSession(data.session);
  if (!resolved) throw new Error('Unable to establish an authenticated session.');
  return resolved;
}

export async function getSession(): Promise<AuthSession | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Unable to restore your session: ${error.message}`);
  return resolveSession(data.session);
}

export async function signOut() {
  if (!supabase) return;

  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(`Unable to sign out: ${error.message}`);
}