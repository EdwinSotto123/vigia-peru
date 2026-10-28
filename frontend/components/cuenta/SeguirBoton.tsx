"use client";

/**
 * «Seguir» en la ficha de una entidad, una empresa o un partido (migraciones 26 y 191): lo que sigues aparece en
 * Mi impacto con lo nuevo de cada uno. Solo con sesión (sin sesión no aparece). Una empresa es siempre un RUC 20.
 */

import { useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { dejarDeSeguir, seguir, sigue, useCuenta } from "@/lib/cuentas";
import { cn } from "@/lib/utils";

type Tipo = "entidad" | "empresa" | "partido";

const ETIQUETA: Record<Tipo, string> = { entidad: "Seguir entidad", empresa: "Seguir empresa", partido: "Seguir partido" };
const VALIDO: Record<Tipo, RegExp> = { entidad: /^\d{11}$/, empresa: /^20\d{9}$/, partido: /^[a-z0-9-]{1,80}$/ };

export function SeguirBoton({ tipo, id, nombre, className }: { tipo: Tipo; id: string; nombre: string; className?: string }) {
  const { user } = useAuth();
  const { perfil } = useCuenta();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!user || !VALIDO[tipo].test(id)) return null;
  const activo = sigue(perfil, tipo, id);
  const toggle = async () => {
    setBusy(true);
    setError(false);
    try {
      if (activo) await dejarDeSeguir(tipo, id);
      else await seguir(tipo, id);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={activo}
      title={error ? "No se pudo guardar. Inténtalo otra vez." : activo ? `Dejar de seguir ${nombre}` : `Seguir ${nombre}: lo nuevo aparece en Mi impacto`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-rotulo leading-4 font-medium transition-colors duration-rapido disabled:opacity-60",
        activo ? "border-granate/40 bg-granate-soft text-granate" : "border-line bg-paperSoft text-inkSoft hover:bg-paper hover:text-ink",
        error && "border-crimsonTexto/40",
        className,
      )}
    >
      {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : activo ? <BellOff size={12} aria-hidden /> : <Bell size={12} aria-hidden />}
      {activo ? "Siguiendo" : ETIQUETA[tipo]}
    </button>
  );
}
