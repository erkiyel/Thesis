import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  resolveSession,
  supabase,
  signIn,
  signOut,
  type AuthSession,
} from '@/lib/supabase';

type AuthValue = {
  session: AuthSession | null;
  user: AuthSession['user'] | null;
  isLoading: boolean;
  loginEventId: number;
  profileError: string;
  error: string;
  setError: (value: string) => void;
  login: (email: string, password: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function useAuthState(): AuthValue {
  const [session, setSession] = useState<AuthSession | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [loginEventId, setLoginEventId] = useState(0);
  const queryClient = useQueryClient();

  const commitSession = useCallback((next: AuthSession | null) => {
    sessionRef.current = next;
    setSession(next);
    if (!next) queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let active = true;
    let authRevision = 0;

    const subscription = supabase.auth.onAuthStateChange((_event, next) => {
      const revision = ++authRevision;
      if (!next) {
        commitSession(null);
        setIsLoading(false);
        return;
      }

      // Supabase invokes listeners while its auth lock is held. Defer profile
      // queries until after this synchronous callback has returned.
      window.setTimeout(() => {
        void resolveSession(next, sessionRef.current).then((resolved) => {
          if (!active || revision !== authRevision) return;
          commitSession(resolved);
          setIsLoading(false);
        }).catch(() => {
          // A profile lookup failure is represented on the resolved session;
          // only Supabase's signed-out/null-session event clears authentication.
          if (active && revision === authRevision && sessionRef.current) setIsLoading(false);
        });
      }, 0);
    }).data.subscription;

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [commitSession]);

  const login = useCallback(async (email: string, password: string) => {
    setError('');
    const next = await signIn(email, password);
    commitSession(next);
    setLoginEventId((value) => value + 1);
    return next;
  }, [commitSession]);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } catch {
      // Local sign-out has already cleared the current tab. The optional
      // server revocation request is best-effort and must not restore access.
    } finally {
      commitSession(null);
      setIsLoading(false);
    }
  }, [commitSession]);

  const refreshUser = useCallback(async () => {
    if (!supabase) return;
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw new Error('Unable to check the current session. Check your connection and retry.');
    const next = await resolveSession(data.session, sessionRef.current);
    commitSession(next);
  }, [commitSession]);

  return {
    session,
    user: session?.user ?? null,
    isLoading,
    loginEventId,
    profileError: session?.profileLoadError ?? '',
    error,
    setError,
    login,
    logout,
    refreshUser,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthState();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
