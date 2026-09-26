"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "firebase/auth";
import {
  EVENTO_FIREBASE,
  emailToUserId,
  firebaseYaCargado,
  guardarPista,
  haySesionGuardada,
  leerPista,
} from "@/lib/sesion";

/**
 * Estado de la sesión para toda la app, con Firebase DIFERIDO (auditoría A14).
 *
 * Este proveedor vive en el layout raíz, así que todo lo que importa de forma estática
 * viaja a cada página. Antes importaba `lib/firebase` y Firebase Auth se bajaba y se
 * inicializaba para cada visitante de la portada, aunque nunca fuera a entrar. Ahora sólo
 * importa tipos y `lib/sesion` (sin Firebase), y conecta con `import()` cuando:
 *
 *  - la pista local dice que hay sesión guardada, o no hay pista pero el navegador tiene la
 *    base de IndexedDB de Firebase (quien ya había entrado antes de este cambio), o
 *  - una página que usa Firebase (entrar, crear cuenta, configuración, panel) ya lo cargó.
 *
 * Sin nada de eso, `loading` pasa a `false` con `user = null` sin haber bajado un byte de
 * Firebase. La API del contexto no cambia: `{ user, userId, loading }`.
 */

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
    let vivo = true;
    let conectado = false;
    let desuscribir: (() => void) | null = null;

    const conectar = () => {
      if (conectado) return;
      conectado = true;
      Promise.all([import("@/lib/firebase"), import("firebase/auth")])
        .then(([{ auth }, { onAuthStateChanged }]) => {
          if (!vivo) return;
          desuscribir = onAuthStateChanged(auth, (u) => {
            guardarPista(!!u);
            setUser(u);
            setLoading(false);
          });
        })
        .catch(() => {
          // Sin red para bajar Firebase: se muestra "Entrar" en vez de un esqueleto eterno.
          conectado = false;
          if (vivo) setLoading(false);
        });
    };

    // Una página que usa Firebase lo cargó (o lo va a cargar): se sigue la sesión desde ahí.
    const alCargarFirebase = () => conectar();
    window.addEventListener(EVENTO_FIREBASE, alCargarFirebase);

    const pista = leerPista();
    if (pista === "1" || firebaseYaCargado()) {
      conectar();
    } else if (pista === "0") {
      setLoading(false);
    } else {
      // Sin pista: quien entró antes de este cambio tiene su sesión en IndexedDB.
      void haySesionGuardada().then((hay) => {
        if (!vivo || conectado) return;
        if (hay) conectar();
        else {
          if (hay === false) guardarPista(false);
          setLoading(false);
        }
      });
    }

    return () => {
      vivo = false;
      window.removeEventListener(EVENTO_FIREBASE, alCargarFirebase);
      desuscribir?.();
    };
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
