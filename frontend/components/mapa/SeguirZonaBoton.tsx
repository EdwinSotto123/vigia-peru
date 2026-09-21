"use client";

/**
 * "Seguir zona" en el panel de zona del mapa. Solo aparece con sesión; sin sesión el panel es
 * idéntico sin este botón (docs/design/CUENTAS.md). Al seguir, la zona se resalta con el chip
 * "Mis zonas" y aparece en /app/mi-impacto.
 */

import { useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { dejarDeSeguir, seguir, sigueZona, useCuenta } from "@/lib/cuentas";
import { cn } from "@/lib/utils";

export function SeguirZonaBoton({ ubigeo, nombre, className }: { ubigeo: string; nombre: string; className?: string }) {
  const { user } = useAuth();
  const { perfil } = useCuenta();
  const [busy, setBusy] = useState(false);
  if (!user || !ubigeo) return null;
  const activo = sigueZona(perfil, ubigeo);
  const toggle = async () => {
    setBusy(true);
    try { if (activo) await dejarDeSeguir("zona", ubigeo); else await seguir("zona", ubigeo); } catch { /* sin red */ } finally { setBusy(false); }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={activo}
      title={activo ? `Dejar de seguir ${nombre}` : `Seguir ${nombre}: se resalta en "Mis zonas" y aparece en Mi impacto`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60",
        activo ? "border-heroGreen bg-heroGreen-soft text-ink" : "border-line bg-paperSoft text-mute hover:bg-paper hover:text-ink",
        className,
      )}
    >
      {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : activo ? <BellOff size={12} aria-hidden /> : <Bell size={12} aria-hidden />}
      {activo ? "Siguiendo" : "Seguir zona"}
    </button>
  );
}
