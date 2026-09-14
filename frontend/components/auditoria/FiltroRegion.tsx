"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";

interface Opcion { ubigeo: string; nombre: string; hint?: string }

/** Select de región que navega con `?ubigeo=` (sin JS cae al valor de la URL). */
export function FiltroRegion({ opciones, valor }: { opciones: Opcion[]; valor?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, start] = useTransition();
  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink">
      <MapPin size={14} className="text-mute" aria-hidden />
      <span className="sr-only">Filtrar por región</span>
      <select
        value={valor ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          start(() => router.push(v ? `${pathname}?ubigeo=${v}` : pathname));
        }}
        className="bg-transparent pr-1 text-sm outline-none"
      >
        <option value="">Todo el Perú</option>
        {opciones.map((o) => (
          <option key={o.ubigeo} value={o.ubigeo}>
            {o.nombre}{o.hint ? ` · ${o.hint}` : ""}
          </option>
        ))}
      </select>
      {pendiente && <Loader2 size={14} className="animate-spin text-mute" aria-label="Cargando" />}
    </label>
  );
}
