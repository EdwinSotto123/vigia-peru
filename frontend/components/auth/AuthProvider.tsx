"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { emailToUserId } from "@/lib/auth";

interface AuthState {
  user: User | null;
  /** El user-id (display) — preferimos `displayName`, sino lo extraemos del email sintético. */
  userId: string | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  userId: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const userId =
    user?.displayName ??
    emailToUserId(user?.email ?? null) ??
    null;

  return (
    <AuthContext.Provider value={{ user, userId, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
