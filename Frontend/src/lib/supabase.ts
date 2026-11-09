import {
  createClient,
  type Session,
  type User,
} from '@supabase/supabase-js';

export type UserRole = 'admin' | 'manager' | 'client' | 'partnership_account';

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string;
  role: UserRole;
  approval_status: 'pending' | 'approved' | 'rejected';
  organization_name: string | null;
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

export function emailConfirmationRedirect() {
  return new URL(`${import.meta.env.BASE_URL}auth/callback`, window.location.origin).toString();
}

export async function resendSignupConfirmation(email: string) {
  const client = requireSupabase();
  const normalizedEmail = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid email address before requesting a confirmation email.');
  }
  const { error } = await client.auth.resend({
    type: 'signup',
    email: normalizedEmail,
    options: { emailRedirectTo: emailConfirmationRedirect() },
  });
  if (error) throw new Error(error.message);
}

async function loadProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, role, approval_status, organization_name')
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
  if (user?.profile?.approval_status && user.profile.approval_status !== 'approved') return null;
  const role = user?.profile?.role;
  if (role === 'client' || role === 'partnership_account') return 'client';
  return role === 'admin' || role === 'manager' ? role : null;
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

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add the Supabase project URL and publishable key.');
  }
  return supabase;
}

export async function updateOwnProfileName(userId: string, fullName: string) {
  const client = requireSupabase();
  const normalizedName = fullName.trim();
  if (!normalizedName || normalizedName.length > 120) throw new Error('Enter your full name up to 120 characters.');

  const { data, error } = await client
    .from('profiles')
    .update({ full_name: normalizedName })
    .eq('id', userId)
    .select('id, full_name')
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Your name could not be saved: ${error?.message ?? 'your profile could not be updated.'}`);
  }
  return data.full_name as string;
}

export async function requestEmailChange(email: string) {
  const client = requireSupabase();
  const normalizedEmail = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) throw new Error('Enter a valid email address.');

  const { error } = await client.auth.updateUser({ email: normalizedEmail });
  if (error) throw new Error(error.message);
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
    const authError = new Error(error.message || 'Sign in failed. Check your credentials.') as Error & { code?: string; status?: number };
    authError.code = error.code;
    authError.status = error.status;
    throw authError;
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

export async function requestPasswordReset(email: string) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add the Supabase project URL and publishable key.',
    );
  }

  const redirectTo = new URL(
    `${import.meta.env.BASE_URL}reset-password`,
    window.location.origin,
  ).toString();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (error) throw new Error(error.message);
}

export async function getPasswordRecoverySession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session;
}

export async function updatePassword(password: string) {
  if (password.length < 8 || password.length > 128) throw new Error('Password must be between 8 and 128 characters.');
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add the Supabase project URL and publishable key.',
    );
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

export async function changePassword(currentPassword: string, newPassword: string) {
  if (!currentPassword) throw new Error('Enter your current password.');
  if (newPassword.length < 8 || newPassword.length > 128) throw new Error('Password must be between 8 and 128 characters.');
  const client = requireSupabase();
  const { data: current, error: userError } = await client.auth.getUser();
  if (userError || !current.user?.email) {
    throw new Error(userError?.message ?? 'Unable to identify the signed-in account.');
  }

  const { data: verified, error: verificationError } = await client.auth.signInWithPassword({
    email: current.user.email,
    password: currentPassword,
  });
  if (verificationError) throw new Error(verificationError.message);
  if (verified.user.id !== current.user.id) throw new Error('The current password could not be verified for this account.');

  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}
