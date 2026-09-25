"use client";

/**
 * Acción de equipo: sortear un contrato del SEACE que Vigía todavía no leyó y despachar los
 * agentes. Vivía en una columna lateral junto a un recuento por nivel que repetía los chips de
 * la lista; ahora es un botón al lado del campo de despacho, con su explicación a un clic.
 *
 * Sólo se monta con sesión de equipo: /api/agent/random exige la cookie de admin (401 si no).
 */

import { useState } from "react";
import { Shuffle } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { claseAccion } from "@/components/ui/EnlaceAccion";

export function SortearSeace({ onRunNew }: { onRunNew: (codigo: string) => void }) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortear = async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/agent/random", { cache: "no-store" });
      let d: any = null;
      try {
        d = await r.json();
      } catch {
        /* respuesta no-JSON */
      }
      if (r.status === 401) {
        setError(d?.detail || "Tu sesión de equipo venció. Vuelve a entrar desde /admin/login.");
      } else if (d?.found && d.codigo_convocatoria) {
        onRunNew(d.codigo_convocatoria);
      } else {
        setError("No se encontró un contrato sin leer para sortear. Reintenta en un momento.");
      }
    } catch {
      setError("No se pudo sortear un contrato. Revisa tu conexión y reintenta.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={sortear} disabled={cargando} className={claseAccion("secundario", "disabled:opacity-50")}>
          <Shuffle size={13} className={cargando ? "animate-spin" : ""} aria-hidden />
          {cargando ? "Buscando…" : "Sortear nueva del SEACE"}
        </button>
        <Ayuda titulo="¿Qué hace sortear?">
          Elige al azar un contrato del SEACE que Vigía todavía no leyó y despacha los agentes. La corrida no se acredita
          a ningún aporte.
        </Ayuda>
      </span>
      {error && (
        <p role="alert" className="text-[12px] text-crimsonTexto">
          {error}
        </p>
      )}
    </div>
  );
}
