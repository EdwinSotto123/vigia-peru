"use client";

/**
 * El catálogo de reglas del perfil, cargado una sola vez y compartido por la matriz de reglas
 * y la lista de señales (las dos necesitan la etiqueta legible de cada `regla`).
 *
 * GET /financiamiento/procesamientos/reglas?perfil= es un JSON estático (revalidate 3600), así
 * que la caché de módulo alcanza: no hace falta un store global ni volver a pedirlo al navegar.
 */

import { useEffect, useState } from "react";
import { getReglasPerfil, reglaLabel, type ReglasPerfil } from "@/lib/auditoria";

const cache = new Map<string, ReglasPerfil>();

export function useReglasPerfil(perfil: string | null | undefined): { reglas: ReglasPerfil | null; cargando: boolean } {
  const key = (perfil ?? "").trim().toLowerCase();
  const [reglas, setReglas] = useState<ReglasPerfil | null>(key ? cache.get(key) ?? null : null);
  const [cargando, setCargando] = useState(!!key && !cache.has(key));

  useEffect(() => {
    if (!key) { setReglas(null); setCargando(false); return; }
    const guardado = cache.get(key);
    if (guardado) { setReglas(guardado); setCargando(false); return; }
    let vivo = true;
    setCargando(true);
    void getReglasPerfil(key)
      .then((r) => { if (vivo && r) { cache.set(key, r); setReglas(r); } })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [key]);

  return { reglas, cargando };
}

/** Etiqueta legible de una regla: la del catálogo si existe, si no el id humanizado. */
export function etiquetaDeRegla(id: string, reglas: ReglasPerfil | null): string {
  if (!reglas) return reglaLabel(id);
  return reglas.reglas.find((r) => r.id === id)?.etiqueta ?? reglas.otrasSenales[id]?.etiqueta ?? reglaLabel(id);
}

/** Descripción del catálogo, cuando la hay. */
export function descripcionDeRegla(id: string, reglas: ReglasPerfil | null): string | null {
  if (!reglas) return null;
  return reglas.reglas.find((r) => r.id === id)?.descripcion ?? reglas.otrasSenales[id]?.descripcion ?? null;
}
