"use client";

/** "Seguir entidad" en la ficha de una entidad. Solo con sesión (sin sesión no aparece). */

import { useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { dejarDeSeguir, seguir, useCuenta } from "@/lib/cuentas";
import { cn } from "@/lib/utils";

export function SeguirEntidadBoton({ ruc, nombre, className }: { ruc: string; nombre: string; className?: string }) {
  const { user } = useAuth();
  const { perfil } = useCuenta();
  const [busy, setBusy] = useState(false);
  if (!user || !/^\d{11}$/.test(ruc)) return null;
  const activo = perfil?.entidadesSeguidas.includes(ruc) ?? false;
  const toggle = async () => {
    setBusy(true);
    try { if (activo) await dejarDeSeguir("entidad", ruc); else await seguir("entidad", ruc); } catch { /* sin red */ } finally { setBusy(false); }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={activo}
      title={activo ? `Dejar de seguir ${nombre}` : `Seguir ${nombre}: aparece en Mi impacto`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
        activo ? "border-amber bg-amber-soft text-ink" : "border-line bg-paperSoft text-mute hover:bg-paper hover:text-ink",
        className,
      )}
    >
      {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : activo ? <BellOff size={12} aria-hidden /> : <Bell size={12} aria-hidden />}
      {activo ? "Siguiendo" : "Seguir entidad"}
    </button>
  );
}
