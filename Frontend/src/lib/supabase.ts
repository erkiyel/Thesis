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

const profileImageBucket = 'medicine-images';

function profileImagePathFromUrl(value: string | null) {
  if (!value) return null;
  try {
    const marker = `/storage/v1/object/public/${profileImageBucket}/`;
    const pathname = new URL(value).pathname;
    const markerIndex = pathname.indexOf(marker);
    return markerIndex < 0 ? null : decodeURIComponent(pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
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
  if (!normalizedName) throw new Error('Enter your full name.');

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
  if (!normalizedEmail) throw new Error('Enter your new email address.');

  const { error } = await client.auth.updateUser({ email: normalizedEmail });
  if (error) throw new Error(error.message);
}

export async function saveProfileImage(userId: string, file: File, previousUrl: string | null) {
  const client = requireSupabase();
  const extensionByType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const extension = extensionByType[file.type];
  if (!extension) throw new Error('Profile photos must be JPG, PNG, or WebP.');

  const objectPath = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await client.storage
    .from(profileImageBucket)
    .upload(objectPath, file, { contentType: file.type, cacheControl: '3600' });
  if (uploadError) throw new Error(`Profile photo upload failed: ${uploadError.message}`);

  const { data } = client.storage.from(profileImageBucket).getPublicUrl(objectPath);
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .update({ avatar_url: data.publicUrl })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (profileError || !profile) {
    await client.storage.from(profileImageBucket).remove([objectPath]);
    throw new Error(`Profile photo could not be saved: ${profileError?.message ?? 'your profile could not be updated.'}`);
  }

  const previousPath = profileImagePathFromUrl(previousUrl);
  const cleanup = previousPath
    ? await client.storage.from(profileImageBucket).remove([previousPath])
    : null;
  return {
    url: data.publicUrl,
    warning: cleanup?.error ? `The new photo was saved, but the previous file could not be removed: ${cleanup.error.message}` : null,
  };
}

export async function removeProfileImage(userId: string, previousUrl: string | null) {
  const client = requireSupabase();
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .update({ avatar_url: '' })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (profileError || !profile) {
    throw new Error(`Profile photo could not be removed: ${profileError?.message ?? 'your profile could not be updated.'}`);
  }

  const previousPath = profileImagePathFromUrl(previousUrl);
  const cleanup = previousPath
    ? await client.storage.from(profileImageBucket).remove([previousPath])
    : null;
  return cleanup?.error
    ? `The profile photo was cleared, but its stored file could not be deleted: ${cleanup.error.message}`
    : null;
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
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add the Supabase project URL and publishable key.',
    );
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}
