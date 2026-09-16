import { Router, type IRouter } from "express";
import {
  CreateAdminClientBody,
  CreateAdminClientResponse,
  ListAdminClientsResponse,
} from "@workspace/api-zod";
import {
  SupabaseAdminError,
  createAuthUser,
  createClientProfile,
  deleteAuthUser,
  getProfilesById,
  listAuthUsers,
  verifyAdminAccess,
  type SupabaseAuthUser,
} from "../lib/supabase-admin";

const router: IRouter = Router();

function clientStatus(user: SupabaseAuthUser) {
  if (user.deleted_at || user.banned_until) return "disabled" as const;
  if (!user.email_confirmed_at) return "unconfirmed" as const;
  return "active" as const;
}

async function requireAdmin(
  authorizationHeader: string | undefined,
): Promise<boolean> {
  return verifyAdminAccess(authorizationHeader);
}

router.get("/admin/clients", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req.headers.authorization))) {
      res.status(403).json({ error: "Administrator access required." });
      return;
    }

    const [profiles, users] = await Promise.all([
      getProfilesById(),
      listAuthUsers(),
    ]);
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const accounts = users
      .map((user) => {
        const profile = profileById.get(user.id);
        if (!profile || profile.role !== "client" || !user.email) return null;
        return CreateAdminClientResponse.parse({
          id: user.id,
          fullName: profile.full_name,
          email: user.email,
          role: "client",
          status: clientStatus(user),
        });
      })
      .filter((account): account is NonNullable<typeof account> => account !== null);

    res.json(ListAdminClientsResponse.parse(accounts));
  } catch (error) {
    req.log.error({ err: error }, "Unable to list client accounts");
    if (error instanceof SupabaseAdminError) {
      res.status(error.status >= 500 ? 500 : error.status).json({
        error: error.message,
      });
      return;
    }
    res.status(500).json({ error: "Unable to list client accounts." });
  }
});

router.post("/admin/clients", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req.headers.authorization))) {
      res.status(403).json({ error: "Administrator access required." });
      return;
    }

    const parsed = CreateAdminClientBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const input = {
      fullName: parsed.data.fullName.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      password: parsed.data.initialPassword,
    };
    if (!input.fullName) {
      res.status(400).json({ error: "Full name is required." });
      return;
    }

    let authUser: SupabaseAuthUser;
    try {
      authUser = await createAuthUser(input);
    } catch (error) {
      if (
        error instanceof SupabaseAdminError &&
        (error.status === 422 || /already|exist|registered/i.test(error.message))
      ) {
        res.status(409).json({
          error: "An account with that email already exists.",
        });
        return;
      }
      throw error;
    }

    try {
      const profile = await createClientProfile({
        id: authUser.id,
        fullName: input.fullName,
      });
      const account = CreateAdminClientResponse.parse({
        id: authUser.id,
        fullName: profile.full_name,
        email: authUser.email ?? input.email,
        role: "client",
        status: "active",
      });
      res.status(201).json(account);
    } catch (error) {
      await deleteAuthUser(authUser.id).catch((cleanupError) => {
        req.log.error(
          { err: cleanupError, userId: authUser.id },
          "Unable to clean up Auth user after profile creation failed",
        );
      });
      throw error;
    }
  } catch (error) {
    req.log.error({ err: error }, "Unable to create client account");
    if (error instanceof SupabaseAdminError) {
      res.status(error.status >= 500 ? 500 : error.status).json({
        error: error.message,
      });
      return;
    }
    res.status(500).json({ error: "Unable to create client account." });
  }
});

export default router;