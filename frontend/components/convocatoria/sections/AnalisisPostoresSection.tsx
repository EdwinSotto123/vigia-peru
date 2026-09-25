"use client";

import { AlertTriangle } from "lucide-react";
import { PersonName, Ruc, esPersonaNatural } from "../../Redact";
import { oeceProcesoUrl } from "../utils";

/**
 * Claves de patrón del backend (`sospechas`) → castellano. Las que llevan ":N" traen un conteo.
 * En pantalla se llaman "patrones", nunca "sospechas": describen al proceso, no acusan a nadie.
 */
function sospechaLegible(s: string): string {
  const [clave, n] = s.split(":");
  switch (clave) {
    case "direccion_compartida_con_otro_postor":
      return "Misma dirección que otro postor";
    case "sin_historial_contractual":
      return "Sin contratos previos con el Estado";
    case "solo_1_contrato_historico":
      return "Un solo contrato previo";
    case "co_ocurrencia_en_base_vigia":
      return `Coincide con otros postores en ${n ?? "varios"} proceso${n === "1" ? "" : "s"} leído${n === "1" ? "" : "s"} por Vigía`;
    case "co_ocurrencia_otros_procesos":
      return `Coincide con otros postores en ${n ?? "varios"} proceso${n === "1" ? "" : "s"} más`;
    default: {
      const txt = clave.replace(/_/g, " ").trim();
      return (txt.charAt(0).toUpperCase() + txt.slice(1)) + (n ? ` (${n})` : "");
    }
  }
}

/** "ocds-dgv273-seacev3-1212799" y "1212799" son el mismo proceso. */
const normOcid = (o: unknown) => String(o ?? "").trim().replace(/^ocds-[a-z0-9]+-seacev3-/i, "");

export function AnalisisPostoresSection({ data, ocidActual }: { data: any; ocidActual?: string | null }) {
  const postores: any[] = Array.isArray(data?.postores) ? data.postores : [];
  const patrones = (data?.patrones_red && typeof data.patrones_red === "object") ? data.patrones_red : {};

  // El backend cuenta como "co-ocurrencia" el propio proceso que se está
  // leyendo: dos postores de ESTE contrato "aparecen juntos" en él, cosa que
  // no dice nada. Si sabemos cuál es el proceso actual, se lo descuenta.
  const actual = ocidActual ? normOcid(ocidActual) : null;
  const esOtroProceso = (o: unknown) => !actual || normOcid(o) !== actual;
  const otrosDe = (p: any): string[] | null =>
    Array.isArray(p?.ocids_co_ocurrencia) ? p.ocids_co_ocurrencia.map(String).filter(esOtroProceso) : null;
  const sospechasDe = (p: any): string[] => {
    const otros = otrosDe(p);
    return (Array.isArray(p?.sospechas) ? p.sospechas : []).flatMap((s: any) => {
      const txt = String(s);
      if (actual && otros && txt.startsWith("co_ocurrencia_en_base_vigia")) {
        const nuevos = new Set(otros.map(normOcid)).size;
        return nuevos > 0 ? [`co_ocurrencia_en_base_vigia:${nuevos}`] : [];
      }
      return [txt];
    });
  };
  const nConCoOcurrencia =
    actual && postores.every((p) => Array.isArray(p?.ocids_co_ocurrencia))
      ? postores.filter((p) => (otrosDe(p) ?? []).length > 0).length
      : patrones.n_con_co_ocurrencia || 0;
  const pares = Object.entries(patrones.pares_co_ocurrentes || {})
    .map(([par, ocids]: [string, any]) => {
      if (!Array.isArray(ocids)) return { par, list: [] as string[], n: Number(ocids) || 0 };
      const list = Array.from(new Set(ocids.filter(esOtroProceso).map(normOcid)));
      return { par, list, n: list.length };
    })
    .filter((x) => x.n > 0);

  // RUC → nombre, para leer los pares "RUC↔RUC" como nombres.
  const nombrePorRuc = new Map<string, string>();
  for (const p of postores) if (p?.ruc) nombrePorRuc.set(String(p.ruc), String(p.razon_social || ""));
  const nombreDe = (ruc: string) => {
    const r = ruc.trim();
    const n = nombrePorRuc.get(r);
    if (!n) return <span className="font-mono">RUC <Ruc value={r} /></span>;
    return esPersonaNatural(r) ? <PersonName name={n} orden="sunat" /> : <>{n}</>;
  };

  if (postores.length === 0) {
    return <p className="px-4 py-3 text-[12px] text-mute">No se identificaron postores en el OCDS.</p>;
  }

  return (
    <div className="p-4">
      {/* Stats agregados */}
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-paperDeep px-3 py-2">
          <div className="font-mono text-lg font-semibold tabular-nums text-ink">{patrones.n_postores_total || postores.length}</div>
          <div className="text-[11px] text-mute">postores totales</div>
        </div>
        <div className="rounded-xl bg-paperDeep px-3 py-2">
          <div className="font-mono text-lg font-semibold tabular-nums text-ink">
            {nConCoOcurrencia}
          </div>
          <div className="text-[11px] text-mute">coinciden en otros procesos leídos por Vigía</div>
        </div>
        <div className="rounded-xl bg-paperDeep px-3 py-2">
          <div className="font-mono text-lg font-semibold tabular-nums text-ink">
            {patrones.n_con_direccion_compartida || 0}
          </div>
          <div className="text-[11px] text-mute">comparten domicilio</div>
        </div>
      </div>

      {/* Tabla de postores */}
      <ul className="divide-y divide-line">
        {postores.map((p: any, i: number) => {
          const score = p.score_sospecha || 0;
          const natural = esPersonaNatural(p.ruc);
          return (
            <li key={i} className="flex items-start gap-3 py-2.5">
              {/* Puntaje del patrón (0–100) en tinta neutra: sólo color, sin ícono ni palabra, se
                  leía como un semáforo sobre una empresa. Lo que explica el número son los patrones de al lado. */}
              <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-paperDeep text-ink" title="Puntaje del patrón de competencia de este postor (0 a 100)">
                <span className="font-mono text-[12px] font-semibold tabular-nums leading-none">{score}</span>
                <span className="text-[11px] leading-none text-mute">/100</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="line-clamp-1 text-sm font-semibold text-ink">
                    {p.razon_social
                      ? natural
                        ? <PersonName name={p.razon_social} orden="sunat" />
                        : p.razon_social
                      : "Sin razón social"}
                  </span>
                  {p.ruc && <span className="font-mono text-[11px] text-mute">RUC <Ruc value={p.ruc} /></span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {sospechasDe(p).map((s: string, j: number) => (
                    <span key={j} className="inline-flex items-center gap-1 rounded-full bg-paperDeep px-2 py-0 text-[11px] font-medium text-ink">
                      <AlertTriangle size={11} className="text-inkSoft" aria-hidden />
                      {sospechaLegible(String(s))}
                    </span>
                  ))}
                  {sospechasDe(p).length === 0 && (
                    <span className="text-[11px] text-mute">Sin patrones</span>
                  )}
                </div>
                {p.direccion && (
                  <div className="mt-0.5 line-clamp-1 text-[11px] text-mute">{p.direccion}</div>
                )}
                {p.n_apariciones_base_vigia != null && (
                  <div className="mt-0.5 text-[11px] text-mute">
                    {p.n_apariciones_base_vigia || 0} aparició{(p.n_apariciones_base_vigia || 0) === 1 ? "n" : "nes"} en la base de Vigía
                    {" "}(no es su historial completo en el SEACE)
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Pares co-ocurrentes (señal de cartel) */}
      {pares.length > 0 && (
        <div className="mt-3 rounded-md border border-amber/30 bg-amber-soft/40 p-3">
          <div className="text-[12px] font-semibold text-amberTexto">
            <AlertTriangle size={10} className="mr-1 inline" aria-hidden />
            Postores que se repiten juntos
          </div>
          <p className="mt-1 text-[11px] text-inkSoft">
            Estos pares de postores aparecen juntos en otros procesos <strong>ya analizados por Vigía</strong>
            {" "}(no el universo completo del SEACE). Es una señal a investigar, no prueba de cartel.
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {pares.slice(0, 5).map(({ par, list, n }, i: number) => {
              const [a, b] = par.split("↔");
              return (
                <li key={i} className="text-[11px] text-ink">
                  <span className="font-semibold">{nombreDe(a ?? par)}</span>
                  {b && <> y <span className="font-semibold">{nombreDe(b)}</span></>}
                  {": "}
                  <strong>{n}</strong> proceso{n === 1 ? "" : "s"} compartido{n === 1 ? "" : "s"}
                  {list.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {list.slice(0, 8).map((oc, j) => (
                        <a key={j} href={oeceProcesoUrl(oc)}
                           target="_blank" rel="noreferrer"
                           className="rounded bg-paperDeep px-1.5 py-0 font-mono text-[11px] text-granate hover:bg-paperSoft">
                          {normOcid(oc)}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
