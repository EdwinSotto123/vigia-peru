"use client";

/**
 * Seguir la zona o la entidad que todavía no se puede financiar: con sesión, el botón de
 * seguir; sin sesión, el enlace para entrar y volver a esta misma página. Mientras la sesión
 * se resuelve no se dibuja nada (ni un botón que después cambia).
 *
 * Props planas (el alcance): la usa también un server component, dentro de TarjetaConfirmacion.
 */

import { Bell } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { SeguirEntidadBoton } from "@/components/mapa/SeguirEntidadBoton";
import { SeguirZonaBoton } from "@/components/mapa/SeguirZonaBoton";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { hrefAlcance, type AlcanceAporte } from "./alcanceAporte";

export function SeguirAlcance({ alcance }: { alcance: AlcanceAporte }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <EnlaceAccion variante="secundario" href={`/login?next=${encodeURIComponent(hrefAlcance(alcance))}`} prefetch={false}>
        <Bell size={14} aria-hidden /> {alcance.tipo === "zona" ? `Entra para seguir ${alcance.nombre}` : "Entra para seguir esta entidad"}
      </EnlaceAccion>
    );
  }
  return alcance.tipo === "zona" ? (
    <SeguirZonaBoton ubigeo={alcance.ubigeo} nombre={alcance.nombre} className="min-h-[40px] text-[13px]" />
  ) : (
    <SeguirEntidadBoton ruc={alcance.ruc} nombre={alcance.nombre} className="min-h-[40px] text-[13px]" />
  );
}

/** La línea que dice dónde se ve lo seguido. Sólo con sesión. */
export function PieSeguir({ alcance }: { alcance: AlcanceAporte }) {
  const { user, loading } = useAuth();
  if (loading || !user) return null;
  return <p>{alcance.tipo === "zona" ? "Siguiendo la zona" : "Siguiendo la entidad"}, la ves en Mi impacto con cada contrato que se lea.</p>;
}
