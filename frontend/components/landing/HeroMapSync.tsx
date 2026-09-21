"use client";

/**
 * Estado compartido entre HeroKpis y HeroMapPanel: qué región del mapa está elegida.
 * Antes eran hermanos sin nada en común — clickear el mapa no movía ni un KPI y
 * viceversa. Un Context evita subir también el copy/CTAs estáticos del hero a un
 * client component solo para poder pasar props entre las dos columnas del grid
 * (HeroCompacto sigue siendo un server component async; el Provider solo envuelve).
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Zona } from "@/lib/financiamiento";

interface HeroMapSyncValue {
  /** Ubigeo de la región elegida (clic en el mapa o en la lista top-5), o null = "todo el Perú". */
  ubigeo: string | null;
  /** La `Zona` completa correspondiente a `ubigeo` (ya viene de los datos reales cargados). */
  zona: Zona | null;
  setUbigeo: (ubigeo: string | null) => void;
}

const HeroMapSyncContext = createContext<HeroMapSyncValue | null>(null);

export function HeroMapSyncProvider({ zonas, children }: { zonas: Zona[]; children: ReactNode }) {
  const [ubigeo, setUbigeo] = useState<string | null>(null);
  const zona = useMemo(() => zonas.find((z) => z.ubigeo === ubigeo) ?? null, [zonas, ubigeo]);
  const value = useMemo<HeroMapSyncValue>(() => ({ ubigeo, zona, setUbigeo }), [ubigeo, zona]);
  return <HeroMapSyncContext.Provider value={value}>{children}</HeroMapSyncContext.Provider>;
}

export function useHeroMapSync(): HeroMapSyncValue {
  const ctx = useContext(HeroMapSyncContext);
  // Defensivo (no-op) en vez de lanzar: si algún día HeroKpis/HeroMapPanel se usan
  // sueltos fuera de HeroCompacto, la landing no debe romperse por esto.
  if (!ctx) return { ubigeo: null, zona: null, setUbigeo: () => {} };
  return ctx;
}
