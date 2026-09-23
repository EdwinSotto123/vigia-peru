"use client";

/**
 * Columna derecha de /app/convocatoria.
 *
 * Antes era una segunda lista de "análisis recientes" (el top 3 que ya encabeza
 * la lista de abajo), con dos botones de sorteo y un recuento por severidad que
 * contaba distinto que la lista: "media 52" acá, "media 70" abajo, sobre los
 * mismos datos. Además ofrecía a cualquier visitante "Sortear nueva del SEACE",
 * que despachaba un análisis pagado.
 *
 * Ahora dice lo que la lista no dice: cómo llega un contrato a Vigía (cola +
 * financiamiento, para el público) o la acción de equipo (sortear y despachar,
 * sólo con sesión de admin), más el recuento por nivel con la misma función
 * que usa la lista (conteoRiesgo).
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEVERIDAD } from "@/lib/severidad";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { contarPorNivel, duracionEnPalabras, NIVEL_ANALISIS, type NivelAnalisis } from "./conteoRiesgo";

export function QuickAccessPanel({
  cached,
  esAdmin = false,
  medianaSeg = null,
  nLecturas = null,
  onRunNew,
}: {
  cached: any[] | null;
  esAdmin?: boolean;
  /** Mediana real de duración de una lectura (API /financiamiento/procesamientos/resumen). */
  medianaSeg?: number | null;
  /** Sobre cuántas lecturas se calculó esa mediana. */
  nLecturas?: number | null;
  onRunNew?: (codigo: string) => void;
}) {
  const loading = cached === null;
  const items = cached || [];
  const conteo = contarPorNivel(items);
  const [randomLoading, setRandomLoading] = useState(false);
  const [randomError, setRandomError] = useState<string | null>(null);
  const duracion = duracionEnPalabras(medianaSeg);

  // Sortear un contrato del SEACE que todavía no se leyó y despachar los agentes (solo equipo).
  const handleShuffleSeace = async () => {
    if (!onRunNew) return;
    setRandomLoading(true);
    setRandomError(null);
    try {
      const r = await fetch("/api/agent/random", { cache: "no-store" });
      let d: any = null;
      try { d = await r.json(); } catch { /* respuesta no-JSON */ }
      if (r.status === 401) {
        setRandomError(d?.detail || "Tu sesión de equipo venció. Vuelve a entrar desde /admin/login.");
      } else if (d?.found && d.codigo_convocatoria) {
        onRunNew(d.codigo_convocatoria);
      } else {
        setRandomError("No se encontró un contrato sin leer para sortear. Reintenta en un momento.");
      }
    } catch {
      setRandomError("No se pudo sortear un contrato. Revisa tu conexión y reintenta.");
    } finally {
      setRandomLoading(false);
    }
  };

  return (
    <aside className="surface flex flex-col gap-3 p-4">
      {esAdmin ? (
        <div className="space-y-2">
          <h2 className="font-serif text-base font-bold text-ink">Acción de equipo</h2>
          <p className="text-[12px] leading-relaxed text-mute">
            Elige al azar un contrato del SEACE que Vigía todavía no leyó y despacha los agentes.
            La corrida no se acredita a ningún aporte.
          </p>
          {onRunNew && (
            <button
              type="button"
              onClick={handleShuffleSeace}
              disabled={randomLoading}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-heroViolet px-2 py-2 text-[12px] font-bold text-paper transition-colors hover:bg-heroViolet/90 disabled:opacity-50"
            >
              <Shuffle size={12} className={randomLoading ? "animate-spin" : ""} aria-hidden />
              <span>{randomLoading ? "Buscando…" : "Sortear nueva del SEACE"}</span>
            </button>
          )}
          {randomError && (
            <p role="alert" className="rounded-md bg-crimson-soft px-2 py-1.5 text-[11px] text-crimsonTexto">
              {randomError}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="font-serif text-base font-bold text-ink">Cómo llega un contrato a Vigía</h2>
          <p className="text-[12px] leading-relaxed text-inkSoft">
            Vigía no analiza contratos a pedido. Los lee en orden de cola, zona por zona, cuando
            alguien financia la auditoría de esa zona.
          </p>
          <p className="text-[12px] leading-relaxed text-inkSoft">
            {TOTAL_AGENTES} agentes revisan cada expediente
            {duracion ? (
              <>
                {" "}y una lectura tarda {duracion}
                {nLecturas ? ` (mediana de ${nLecturas} lecturas recientes)` : ""}.
              </>
            ) : (
              "."
            )}
          </p>
          <div className="flex flex-col gap-1.5 pt-1">
            <Link
              href="/app/financiar"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12px] font-bold text-paper transition-colors hover:bg-ink/90"
            >
              Financiar la auditoría de tu zona <ArrowRight size={13} aria-hidden />
            </Link>
            <Link
              href="/app/auditoria"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-paperDeep"
            >
              Ver la cola en vivo
            </Link>
          </div>
        </div>
      )}

      {/* Recuento por nivel: la misma función que los chips de la lista de abajo */}
      <div className="border-t border-line pt-3">
        <h3 className="text-[12px] font-semibold text-ink">Lo publicado hasta hoy</h3>
        {loading ? (
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-paperDeep" />
            ))}
          </div>
        ) : conteo.total === 0 ? (
          <p className="mt-1 text-[11px] text-mute">Todavía no hay análisis publicados.</p>
        ) : (
          <>
            <p className="mt-0.5 text-[11px] text-mute">
              {conteo.total} {conteo.total === 1 ? "análisis publicado" : "análisis publicados"}, por nivel de riesgo según
              su puntaje:
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              {(["alta", "media", "baja"] as NivelAnalisis[]).map((k) => (
                <div key={k} className={cn("flex flex-col rounded-md px-1 py-1.5", SEVERIDAD[k].fondo)} title={NIVEL_ANALISIS[k].rango}>
                  <dt className={cn("order-2 text-[10px] font-medium", SEVERIDAD[k].texto)}>{NIVEL_ANALISIS[k].etiqueta}</dt>
                  <dd className={cn("order-1 font-mono text-lg font-bold tabular-nums", SEVERIDAD[k].texto)}>{conteo[k]}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </aside>
  );
}
