"use client";

import Link from "next/link";
import { CheckCircle2, Moon } from "lucide-react";
import type { ProgresoDocumentos } from "@/lib/admin";
import { Badge, Expandable, Panel, StatCard, StatGrid, estadoLote, fmtDia, fmtFechaHora, fmtNum, hace } from "@/components/admin/ui";

// ── Documentos del SEACE: cuánto hay, a qué ritmo llega y qué falló ────────

/** Mínimo de noches con descargas en la semana para que un promedio signifique algo. */
const NOCHES_MINIMAS = 3;

/**
 * Cuándo terminaría, dicho con honestidad. El API divide lo que falta por el
 * promedio de las noches con actividad; con una o dos noches ese promedio no es
 * un ritmo (así salió "1172 noches ≈ 09-dic": 3 años, con la fecha sin año).
 */
function estimacion(pr: ProgresoDocumentos): { valor: string; pista: string; tono: "ok" | "neutral" | "muted" } {
  const activas = pr.ritmo.filter((r) => r.n > 0).length;
  if (pr.restantes === 0) return { valor: "Completo", pista: "no falta ningún documento publicado", tono: "ok" };
  if (!pr.porNoche || activas < NOCHES_MINIMAS || pr.nochesRestantes == null)
    return {
      valor: "Sin estimar",
      pista: activas === 0 ? "sin descargas en 7 días" : `${activas} de ${NOCHES_MINIMAS} noches con descargas`,
      tono: "muted",
    };
  const fin = fmtDia(new Date(Date.now() + pr.nochesRestantes * 864e5));
  if (pr.nochesRestantes > 365) return { valor: "Más de un año", pista: `a ${fmtNum(pr.porNoche)} por noche faltarían ${fmtNum(pr.nochesRestantes)} noches`, tono: "neutral" };
  return { valor: `${fmtNum(pr.nochesRestantes)} ${pr.nochesRestantes === 1 ? "noche" : "noches"}`, pista: `hacia el ${fin}, si se mantiene el ritmo`, tono: "neutral" };
}

/** Errores conocidos del lote en palabras llanas; el texto crudo queda en el detalle. */
const ERROR_ITEM: Record<string, string> = {
  "sin archivo o sin sha256": "El expediente lista el documento pero no trae el archivo ni su huella para bajarlo",
};

/** Un estado sin nada que listar, en una línea con su ícono (en vez de un panel con cabecera y el cuerpo vacío). */
function LineaEstado({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2.5 text-meta leading-snug text-inkSoft">
      {icono}
      <span>
        <strong className="font-semibold text-ink">{titulo}</strong> {children}
      </span>
    </p>
  );
}

/**
 * El avance de las descargas, medido contra los contratos que pasaron a lectura (los únicos cuyos documentos se bajan;
 * antes contra todo lo que publica el SEACE, y el «fin estimado» daba años), en la pestaña Documentos de Cobertura:
 * arriba las cuatro cifras (cuánto hay, cuánto falta,
 * a qué ritmo, cuándo terminaría), una línea con el último lote y, en dos columnas, lo bajado por noche y los errores
 * agrupados por causa. Rediseño del 2026-10-30: la tarjeta con el porcentaje grande pasó a la franja de cifras y las
 * cajas plegables de cada causa, que iban dentro del panel de errores (cajas dentro de cajas), a filas con separador.
 */
export function Progreso({ pr }: { pr: ProgresoDocumentos }) {
  const lote = pr.loteActual;
  const est = estimacion(pr);
  const max = Math.max(1, ...pr.ritmo.map((x) => x.n));
  const dia = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" });

  // Errores agrupados por causa: 20 filas iguales se leen como una sola con su cuenta.
  const grupos = new Map<string, typeof pr.errores>();
  for (const e of pr.errores) grupos.set(e.error ?? "error sin detalle", [...(grupos.get(e.error ?? "error sin detalle") ?? []), e]);

  return (
    <div className="space-y-3">
      <StatGrid columnas={4}>
        <StatCard
          etiqueta="Ya en el almacén"
          valor={`${pr.pct.toLocaleString("es-PE")} %`}
          tono={pr.restantes ? "neutral" : "ok"}
          pista={`${fmtNum(pr.vigentes)} de ${fmtNum(pr.publicados)} publicados${pr.contratos != null ? `, de ${fmtNum(pr.contratos)} contratos en lectura` : ""}`}
        />
        <StatCard etiqueta="Faltan" valor={pr.restantes} tono={pr.restantes ? "warn" : "ok"} pista={`documentos, de ${fmtNum(pr.contratosSinBajar)} contratos`} />
        <StatCard
          etiqueta="Ritmo"
          valor={pr.porNoche ? `${fmtNum(pr.porNoche)} / noche` : "Sin descargas"}
          pista={pr.porNoche ? "noches con descargas, 7 días" : "en los últimos 7 días"}
        />
        <StatCard etiqueta="Fin estimado" valor={est.valor} tono={est.tono} pista={est.pista} />
      </StatGrid>

      {/* El último lote en una línea: su estado, cuánto bajó, lo que espera turno y dónde están sus corridas. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-rotulo text-inkSoft">
        {lote ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tono={estadoLote(lote.estado).tono} punto>
              {estadoLote(lote.estado).label}
            </Badge>
            <span title={lote.id}>
              Último lote {fmtFechaHora(lote.finalizadoAt ?? lote.iniciadoAt) ?? "sin fecha"}: {fmtNum(lote.ok)} de {fmtNum(lote.total)} documentos
              {lote.fallidos ? <span className="text-crimsonTexto">, {fmtNum(lote.fallidos)} fallidos</span> : null}
            </span>
          </span>
        ) : (
          <span>Todavía no corrió ningún lote de documentos.</span>
        )}
        {pr.itemsPendientes > 0 && <span>{fmtNum(pr.itemsPendientes)} documentos esperan turno en lotes abiertos.</span>}
        <Link href="/admin/fuentes?tab=documentos" className="font-medium text-ink underline underline-offset-2">
          Corridas en Fuentes y procesos
        </Link>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        {pr.ritmo.length ? (
          <Panel titulo="Descargados por noche" descripcion="Últimos 7 días">
            <ul className="grid gap-x-4 gap-y-1 text-rotulo sm:grid-cols-2 lg:grid-cols-1">
              {pr.ritmo.map((r) => (
                <li key={r.dia} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-inkSoft">{dia(r.dia)}</span>
                  <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                    <span className="block h-full rounded-full bg-moss" style={{ width: `${Math.round((r.n / max) * 100)}%` }} />
                  </span>
                  <span className="shrink-0 text-right text-mute">
                    <span className="font-mono text-ink">{fmtNum(r.n)}</span> docs, {fmtNum(r.contratos)} contr.
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : (
          <LineaEstado icono={<Moon size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />} titulo="Ninguna descarga en la última semana.">
            Sólo se bajan los documentos de contratos financiados.
          </LineaEstado>
        )}

        {pr.errores.length ? (
          <Panel titulo="Errores recientes" descripcion={`Los últimos ${pr.errores.length} documentos que fallaron, por causa`} sinRelleno>
            <ul className="divide-y divide-line">
              {Array.from(grupos.entries()).map(([causa, items]) => {
                const contratos = new Set(items.map((e) => e.clave.split("/")[0]));
                return (
                  <li key={causa} className="px-4 py-2.5 sm:px-5">
                    <Expandable
                      variante="linea"
                      resumen={
                        <span>
                          <span className="font-medium text-ink">{ERROR_ITEM[causa] ?? causa}</span>{" "}
                          <span className="text-mute">
                            {items.length} docs de {contratos.size} {contratos.size === 1 ? "contrato" : "contratos"}
                          </span>
                        </span>
                      }
                    >
                      <ul className="max-h-48 space-y-1 overflow-y-auto text-rotulo">
                        {items.map((e, i) => {
                          const [ocid, doc] = e.clave.split("/");
                          return (
                            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                              <span className="text-ink">
                                Contrato <span className="font-mono">{ocid}</span>
                                {doc && (
                                  <span className="text-mute">
                                    , documento <span className="font-mono">{doc}</span>
                                  </span>
                                )}
                              </span>
                              <span className="text-mute" title={e.loteId}>
                                {hace(e.procesadoAt) ?? "sin fecha"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {ERROR_ITEM[causa] && <p className="mt-2 font-mono text-micro text-mute">Mensaje del lote: {causa}</p>}
                    </Expandable>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : (
          <LineaEstado icono={<CheckCircle2 size={15} className="mt-0.5 shrink-0 text-moss" aria-hidden />} titulo="Ningún documento falló.">
            Los últimos lotes bajaron todo lo que intentaron.
          </LineaEstado>
        )}
      </div>
    </div>
  );
}
