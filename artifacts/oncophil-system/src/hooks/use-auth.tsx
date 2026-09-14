import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  getSession,
  resolveSession,
  signIn,
  signOut,
  supabase,
  type AuthSession,
} from '@/lib/supabase';

type AuthValue = {
  session: AuthSession | null;
  user: AuthSession['user'] | null;
  isLoading: boolean;
  error: string;
  setError: (value: string) => void;
  login: (email: string, password: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function useAuthState(): AuthValue {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    getSession()
      .then((next) => {
        if (active) setSession(next);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    const subscription = supabase?.auth.onAuthStateChange((_event, next) => {
      void resolveSession(next)
        .then((resolved) => {
          if (active) setSession(resolved);
        })
        .catch(() => {
          if (active) setSession(null);
        });
    }).data.subscription;

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError('');
    const next = await signIn(email, password);
    setSession(next);
    return next;
  }, []);

  const logout = useCallback(async () => {
    await signOut();
    setSession(null);
  }, []);

  return { session, user: session?.user ?? null, isLoading, error, setError, login, logout };
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