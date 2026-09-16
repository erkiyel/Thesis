type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
  deleted_at?: string | null;
};

type SupabaseProfile = {
  id: string;
  full_name: string;
  avatar_url: string;
  role: "admin" | "client";
};

type SupabaseErrorPayload = {
  message?: string;
  error?: string;
  msg?: string;
};

export class SupabaseAdminError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SupabaseAdminError";
    this.status = status;
  }
}

function getSupabaseConfig() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"]?.replace(/\/$/, "");
  const publishableKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url || !publishableKey || !serviceRoleKey) {
    throw new SupabaseAdminError(
      500,
      "Supabase server configuration is incomplete.",
    );
  }

  return { url, publishableKey, serviceRoleKey };
}

function serviceHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function payloadMessage(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null) {
    const candidate = payload as SupabaseErrorPayload;
    return candidate.message ?? candidate.error ?? candidate.msg ?? fallback;
  }
  return typeof payload === "string" && payload.trim() ? payload : fallback;
}

async function adminRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      ...serviceHeaders(serviceRoleKey),
      ...init.headers,
    },
  });
  const payload = await readPayload(response);

  if (!response.ok) {
    throw new SupabaseAdminError(
      response.status,
      payloadMessage(payload, "Supabase request failed."),
    );
  }

  return payload as T;
}

export async function verifyAdminAccess(
  authorizationHeader: string | undefined,
): Promise<boolean> {
  const { url, publishableKey } = getSupabaseConfig();
  if (!authorizationHeader?.startsWith("Bearer ")) return false;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: authorizationHeader,
    },
  });

  if (!response.ok) return false;
  const authUser = (await readPayload(response)) as SupabaseAuthUser;
  if (!authUser?.id) return false;

  const profiles = await getProfilesById(authUser.id);
  return profiles[0]?.role === "admin";
}

export async function getProfilesById(
  userId?: string,
): Promise<SupabaseProfile[]> {
  const query = new URLSearchParams({
    select: "id,full_name,avatar_url,role",
  });
  if (userId) query.set("id", `eq.${userId}`);
  return adminRequest<SupabaseProfile[]>(
    `/rest/v1/profiles?${query.toString()}`,
  );
}

export async function createAuthUser(input: {
  email: string;
  password: string;
  fullName: string;
}) {
  return adminRequest<SupabaseAuthUser>("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
      app_metadata: { role: "client" },
    }),
  });
}

export async function createClientProfile(input: {
  id: string;
  fullName: string;
}) {
  const profiles = await adminRequest<SupabaseProfile[]>("/rest/v1/profiles", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      id: input.id,
      full_name: input.fullName,
      avatar_url: "",
      role: "client",
    }),
  });
  return profiles[0];
}

export async function deleteAuthUser(userId: string) {
  await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export async function listAuthUsers() {
  return adminRequest<SupabaseAuthUser[]>(
    "/auth/v1/admin/users?page=1&per_page=1000",
  );
}

export type { SupabaseAuthUser, SupabaseProfile };