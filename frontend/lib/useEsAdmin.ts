"use client";

import { useEffect, useState } from "react";

/**
 * ¿Esta sesión del navegador tiene la cookie de admin activa (httpOnly, la deja /admin/login)?
 * A diferencia de `adminFetch` (lib/admin.ts), NUNCA redirige — se usa en páginas públicas
 * (/app/mapa, /app/financiar/[ubigeo]…) que ve cualquier visitante, así que un 401 acá solo
 * significa "no es admin", no "hay que mandarlo a /admin/login".
 *
 * Uso: `const esAdmin = useEsAdmin();` — empieza en `false` (lo que ve una persona normal) y
 * pasa a `true` solo si el ping confirma la cookie; nunca hay parpadeo hacia atrás.
 */
export function useEsAdmin(): boolean {
  const [esAdmin, setEsAdmin] = useState(false);
  useEffect(() => {
    let vivo = true;
    fetch("/api/admin/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j?.admin) setEsAdmin(true); })
      .catch(() => { /* red caída: sigue viendo la vista normal */ });
    return () => { vivo = false; };
  }, []);
  return esAdmin;
}
