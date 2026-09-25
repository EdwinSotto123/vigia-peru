"use client";

/**
 * /admin/analisis: despachar un análisis (corrida pagada, sólo equipo) y, debajo, los
 * análisis publicados.
 *
 * La página pública /app/convocatoria ya no usa este componente: es un Listado de servidor
 * (§14.1) y el despacho del equipo quedó como acción de su cabecera (DespachoEquipo).
 *
 * Seguridad (sin cambios): `?run=` no dispara nada; `?ocid=<código>` sólo PRELLENA el campo
 * (lo usa "Procesar ahora" del informe); las rutas /api/agent/analyze*, /upload-doc y
 * /random exigen la cookie de admin verificada contra el API (401 si no).
 *
 * `enPanel`: el modo equipo se pinta desde el primer render, sin esperar al ping de sesión
 * (el middleware ya exigió la sesión para entrar al panel).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, ChevronRight, Search } from "lucide-react";
import { getAnalyzedList } from "@/lib/dossier-cache";
import { useEsAdmin } from "@/lib/useEsAdmin";
import { Ayuda } from "@/components/patrones";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { codigoCorto } from "./utils";
import { esAnalisisPublicado, hrefAnalisis, type AnalisisPublicado } from "./analisisPublicados";
import { ChipNivel } from "./TablaAnalisis";
import { useDespacho } from "./useDespacho";
import { SortearSeace } from "./sections/SortearSeace";
import { LoadingView } from "./sections/LoadingView";
import { AnalisisPublicadosPanel } from "./sections/AnalisisPublicadosPanel";

/** ¿El análisis coincide con lo que se escribió? (código, OCID, objeto, entidad o RUC). */
const coincide = (it: AnalisisPublicado, qLower: string) =>
  [it.codigo_convocatoria, it.ocid, it.objeto, it.entidad, it.entidad_ruc, it.proveedor_ruc]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(qLower);

export function ConvocatoriaSearch({ enPanel = false }: { enPanel?: boolean } = {}) {
  const sesionAdmin = useEsAdmin();
  const esAdmin = enPanel || sesionAdmin;
  const router = useRouter();
  const d = useDespacho();
  const [id, setId] = useState("");
  const [cached, setCached] = useState<AnalisisPublicado[] | null>(null);
  const [showSugg, setShowSugg] = useState(false);

  // Análisis ya publicados para el autocompletado: abrir uno en vez de volver a pagarlo.
  // getAnalyzedList deduplica con la lista de abajo → 1 sola request.
  useEffect(() => {
    getAnalyzedList(500)
      .then((r) => setCached(!r?.error && Array.isArray(r?.items) ? r.items.filter(esAnalisisPublicado) : []))
      .catch(() => setCached([]));
  }, []);

  // `?ocid=<código>` sólo PRELLENA el campo: nunca despacha nada solo.
  useEffect(() => {
    try {
      const pre = new URLSearchParams(window.location.search).get("ocid");
      if (pre) setId(pre.trim().slice(0, 120));
    } catch {
      /* sin window.location: nada que prellenar */
    }
  }, []);

  if (d.cargando) return <LoadingView stepIdx={d.stepIdx} elapsed={d.elapsed} codigo={d.codigo} liveEvents={d.liveEvents} />;

  const qLower = id.trim().toLowerCase();
  const sugerencias = esAdmin && showSugg && qLower && cached ? cached.filter((it) => coincide(it, qLower)).slice(0, 6) : [];
  const despachar = (e: React.FormEvent) => {
    e.preventDefault();
    if (esAdmin) void d.despachar(id);
  };

  return (
    <div className="space-y-6">
      {esAdmin && (
        <section aria-labelledby="despacho-titulo" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <div className="flex items-center gap-1.5">
            <h2 id="despacho-titulo" className="font-display text-[20px] font-bold leading-tight text-ink">
              Analiza un contrato del SEACE
            </h2>
            <Ayuda titulo="¿Qué hace despachar?">
              Pega el código de la convocatoria o su OCID: los {TOTAL_AGENTES} agentes leen el expediente y el informe queda
              público al terminar. Si ya está analizado, elígelo en la lista que aparece al escribir y se abre sin volver a
              procesarlo.
            </Ayuda>
          </div>

          <div className="mt-3 flex flex-wrap items-start gap-3">
            <form onSubmit={despachar} className="relative min-w-0 flex-1 basis-[420px]" role="search">
              <label htmlFor="despachar-convocatoria" className="sr-only">
                Código u OCID de la convocatoria
              </label>
              <Search size={17} aria-hidden className="absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
              <input
                id="despachar-convocatoria"
                type="text"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setShowSugg(true);
                }}
                onFocus={() => setShowSugg(true)}
                onBlur={() => setTimeout(() => setShowSugg(false), 180)}
                placeholder="Código de convocatoria u OCID"
                autoComplete="off"
                inputMode="search"
                className="h-12 w-full rounded-xl border border-line bg-paperSoft pl-11 pr-44 font-mono text-[15px] placeholder:font-sans placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
              />
              <button
                type="submit"
                disabled={!id.trim()}
                className="absolute right-1.5 top-1/2 inline-flex min-h-[40px] -translate-y-1/2 items-center gap-2 rounded-full bg-granate px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-granate-deep disabled:opacity-50"
              >
                Despachar agentes <ArrowRight size={15} aria-hidden />
              </button>

              {/* Autocompletado con los análisis ya publicados: abrir en vez de volver a pagar. */}
              {sugerencias.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-line bg-paper shadow-dialog">
                  <p className="border-b border-line bg-paperSoft px-4 py-2 text-[12px] font-semibold text-inkSoft">
                    {sugerencias.length === 1
                      ? "1 ya analizado: ábrelo sin volver a procesarlo"
                      : `${sugerencias.length} ya analizados: ábrelos sin volver a procesarlos`}
                  </p>
                  <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                    {sugerencias.map((it) => (
                      <li key={it.codigo_convocatoria || it.ocid}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            router.push(hrefAnalisis(it));
                          }}
                          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-paperDeep"
                        >
                          <ChipNivel it={it} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium text-ink">{it.objeto}</span>
                            <span className="block truncate text-[12px] text-mute">
                              <span className="font-mono">{codigoCorto(it.codigo_convocatoria || it.ocid)}</span> {it.entidad || "Entidad sin dato"}
                            </span>
                          </span>
                          <ChevronRight size={13} aria-hidden className="text-mute" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </form>

            <SortearSeace
              onRunNew={(codigo) => {
                setId(codigo);
                void d.despachar(codigo);
              }}
            />
          </div>

          {d.error && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-crimson/25 bg-crimson-soft/60 p-3 text-[13px] text-crimsonTexto">
              <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
              <span>{d.error}</span>
            </div>
          )}
        </section>
      )}

      <AnalisisPublicadosPanel />
    </div>
  );
}
