/**
 * Detalle de un contrato: cabecera, clasificación, ítems, documentos oficiales y el
 * estado de su análisis (dictamen · en vivo · financiar capacidad · pendiente).
 * Server component; solo `ContratoEnVivo` y `Redact` son islas de cliente.
 */

import Link from "next/link";
import {
  ArrowLeft, ArrowUpRight, Building2, CheckCircle2, Clock, ExternalLink, FileText, Heart, MapPin, ShieldAlert,
} from "lucide-react";
import { ContratoEnVivo } from "@/components/auditoria/ContratoEnVivo";
import { Glass, PersonName } from "@/components/Redact";
import { EstadoContratoPill } from "./ContratosLista";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { FASES } from "@/lib/auditoria";
import {
  RIESGO_CLS, esPersonaNatural, etapaLabel, formatFecha, formatMonto, motivoLabel, riesgoDe, tipoDocLabel, tipoLabel,
  validacionLabel, type ContratoDetalle as Detalle,
} from "@/lib/contratos";
import { cn } from "@/lib/utils";

export function ContratoDetalle({ c }: { c: Detalle }) {
  const regionId = c.ubigeo ? UBIGEO_REGION[c.ubigeo.slice(0, 2)] : undefined;
  const mapaHref = regionId ? `/app/mapa?region=${regionId}&tab=cola${c.ubigeo && c.ubigeo.length === 6 ? `&ubigeo=${c.ubigeo}` : ""}` : "/app/mapa";
  const riesgo = riesgoDe(c.score);
  const natural = esPersonaNatural(c.proveedorRuc);

  return (
    <div className="space-y-6">
      <Link href="/app/contratos" className="inline-flex items-center gap-1.5 text-xs text-mute hover:text-ink">
        <ArrowLeft size={13} /> Contratos
      </Link>

      {/* Cabecera */}
      <header className="border-b border-line pb-5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-mute">
          <span className="text-ink">{c.codigo}</span>
          {c.nomenclatura && <span>· {c.nomenclatura}</span>}
          {c.ocid !== c.codigo && <span>· {c.ocid}</span>}
        </div>
        <h1 className="mt-1.5 max-w-4xl font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">{c.titulo ?? "(sin objeto)"}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {c.entidadRuc ? (
            <Link href={`/entidad/${c.entidadRuc}`} className="inline-flex items-center gap-1.5 text-ink hover:underline">
              <Building2 size={14} className="text-mute" /> {c.entidad ?? c.entidadRuc}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-mute"><Building2 size={14} /> {c.entidad ?? "Entidad no identificada"}</span>
          )}
          {c.zona && (
            <Link href={mapaHref} className="inline-flex items-center gap-1.5 text-ink hover:underline">
              <MapPin size={14} className="text-mute" /> {c.zona}
            </Link>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge tone="ink">{tipoLabel(c.tipo) ?? "Tipo sin clasificar"}</Badge>
          <Badge>{etapaLabel(c.etapa) ?? "Etapa sin clasificar"}</Badge>
          {c.modalidad && <Badge>{c.modalidad}</Badge>}
          <EstadoContratoPill estado={c.estadoProcesamiento} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {/* Datos */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line bg-paper p-4 text-sm sm:grid-cols-4">
            <Dato k="Valor referencial" v={formatMonto(c.montoPen, c.moneda)} mono />
            <Dato k="Convocatoria" v={formatFecha(c.fecha)} mono />
            <Dato k="Buena pro" v={formatFecha(c.fechaBuenaPro)} mono />
            <Dato k="Postores" v={c.postores != null ? String(c.postores) : "—"} mono />
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-[10px] uppercase tracking-wide text-mute">Proveedor adjudicado</dt>
              <dd className="mt-0.5 text-ink">
                {c.proveedor ? (
                  <>
                    {natural ? <PersonName name={c.proveedor} /> : c.proveedor}
                    {c.proveedorRuc && (
                      <span className="ml-2 font-mono text-[11px] text-mute">
                        RUC {natural ? <Glass label="RUC de persona natural — clic para revelar">{c.proveedorRuc}</Glass> : c.proveedorRuc}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-mute">Sin adjudicar todavía</span>
                )}
              </dd>
            </div>
            {c.descripcion && c.descripcion !== c.titulo && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-[10px] uppercase tracking-wide text-mute">Descripción</dt>
                <dd className="mt-0.5 text-[13px] leading-relaxed text-ink">{c.descripcion}</dd>
              </div>
            )}
          </dl>

          {/* Ítems */}
          <section>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-mute">Ítems ({c.items.length})</h2>
            {c.items.length ? (
              <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-paper">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-paperDeep text-[10px] uppercase tracking-wider text-mute">
                    <tr>
                      <th className="w-10 px-3 py-2 font-semibold">#</th>
                      <th className="px-3 py-2 font-semibold">Descripción</th>
                      <th className="w-28 px-3 py-2 text-right font-semibold">Cantidad</th>
                      <th className="w-28 px-3 py-2 text-right font-semibold">Monto</th>
                      <th className="w-28 px-3 py-2 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {c.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2 font-mono text-mute">{it.posicion}</td>
                        <td className="px-3 py-2 text-ink">
                          {it.descripcion ?? "—"}
                          {it.cubso && <span className="ml-2 font-mono text-[10px] text-mute">CUBSO {it.cubso}</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                          {it.cantidad != null ? it.cantidad.toLocaleString("es-PE") : "—"}{it.unidad ? <span className="ml-1 text-[10px] text-mute">{it.unidad}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{formatMonto(it.montoPen, c.moneda)}</td>
                        <td className="px-3 py-2 text-mute">{it.estado ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-sm text-mute">El registro OCDS no trae ítems para este proceso.</p>
            )}
          </section>

          {/* Documentos */}
          <section>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-mute">Documentos oficiales ({c.documentos.length})</h2>
            {c.documentos.length ? (
              <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-paper">
                {c.documentos.map((d, i) => (
                  <li key={`${d.url}-${i}`}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-paperSoft">
                      <FileText size={14} className="shrink-0 text-mute" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{d.titulo ?? tipoDocLabel(d.tipo)}</span>
                        <span className="block text-[10px] text-mute">{tipoDocLabel(d.tipo)}{d.formato ? ` · ${d.formato.toUpperCase()}` : ""}{d.fecha ? ` · ${formatFecha(d.fecha)}` : ""} · SEACE</span>
                      </span>
                      <ExternalLink size={13} className="shrink-0 text-mute opacity-60 group-hover:opacity-100" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-mute">Sin documentos publicados en el registro.</p>
            )}
          </section>
        </div>

        {/* Análisis */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <AnalisisCard c={c} riesgo={riesgo} />
          <ClasificacionCard c={c} />
        </aside>
      </div>
    </div>
  );
}

// ─── Estado del análisis ─────────────────────────────────────────────────────

function AnalisisCard({ c, riesgo }: { c: Detalle; riesgo: ReturnType<typeof riesgoDe> }) {
  const estado = c.estadoProcesamiento;
  const dossierId = c.alerta?.codigo?.replace(/^OECE-/, "") ?? c.ocid;

  if (estado === "procesado" && c.alerta) {
    const alta = c.alerta.banderas.filter((b) => b.severidad === "alta").length;
    return (
      <section className="rounded-2xl border border-line bg-paper p-4">
        <h2 className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute">
          <CheckCircle2 size={12} className="text-moss" /> Dictamen publicado
        </h2>
        <div className="mt-2 flex items-baseline gap-3">
          <span className={cn("font-mono text-3xl font-bold tabular-nums", RIESGO_CLS[riesgo])}>{c.alerta.score ?? "—"}</span>
          <span className="text-xs text-mute">
            score · {c.alerta.banderas.length} señal{c.alerta.banderas.length === 1 ? "" : "es"} de riesgo{alta ? ` (${alta} alta${alta === 1 ? "" : "s"})` : ""}
          </span>
        </div>
        {c.alerta.banderas.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {c.alerta.banderas.slice(0, 5).map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
                <span className={cn("mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full", b.severidad === "alta" ? "bg-rust" : b.severidad === "media" ? "bg-amber" : "bg-mute")} />
                <span className="min-w-0">
                  <span className="text-ink">{b.regla.replace(/_/g, " ")}</span>
                  {b.norma && <span className="ml-1 text-[10px] text-mute">· {b.norma}</span>}
                </span>
              </li>
            ))}
            {c.alerta.banderas.length > 5 && <li className="text-[11px] text-mute">y {c.alerta.banderas.length - 5} más en el dictamen</li>}
          </ul>
        )}
        <Link href={`/app/convocatoria/${encodeURIComponent(dossierId)}`} className="mt-4 flex items-center justify-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-card transition-transform hover:scale-[1.01]">
          Leer el dictamen completo <ArrowUpRight size={14} />
        </Link>
        {c.alerta.analizadoEn && <p className="mt-2 text-center text-[10px] text-mute">Analizado el {formatFecha(c.alerta.analizadoEn.slice(0, 10))}</p>}
      </section>
    );
  }

  if ((estado === "procesando" || estado === "encolado" || estado === "error") && c.procesamiento) {
    return <ContratoEnVivo ocid={c.ocid} initial={{ ...c.procesamiento, eventos: [] }} />;
  }

  if (estado === "pendiente_de_procesamiento" || c.procesable === false) {
    return (
      <section className="rounded-2xl border border-line bg-paper p-4">
        <h2 className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute">
          <Clock size={12} className="text-clay" /> Pendiente de procesamiento
        </h2>
        <p className="mt-2 text-sm text-ink">{motivoLabel(c.clasificacion.motivoNoProcesable)}</p>
        <Pendientes v={c.clasificacion.validacionesPendientes} />
        <p className="mt-3 text-[11px] leading-relaxed text-mute">
          Cuando el proceso avance de etapa o los agentes soporten este tipo, entrará a la cola de su zona. No se cobra por lo que no se puede analizar.
        </p>
      </section>
    );
  }

  // sin_analizar (o procesado sin alerta legible)
  return (
    <section className="rounded-2xl border border-line bg-paper p-4">
      <h2 className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute">
        <ShieldAlert size={12} className="text-amber" /> Sin analizar
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink">
        Este contrato espera en la cola{c.zona ? ` de ${c.zona}` : ""}. Los agentes lo leerán cuando alguien financie capacidad de auditoría para su zona; el orden es por llegada, nadie elige cuál.
      </p>
      <Pendientes v={c.clasificacion.validacionesPendientes} />
      {c.ubigeo && (
        <Link href={`/app/financiar/${c.ubigeo}`} className="mt-4 flex items-center justify-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-card transition-transform hover:scale-[1.01]">
          <Heart size={14} className="text-amber" /> Financiar la auditoría de {c.zona ?? "esta zona"}
        </Link>
      )}
    </section>
  );
}

function ClasificacionCard({ c }: { c: Detalle }) {
  const agentes = c.clasificacion.agentesAplicables;
  if (!agentes?.length && !c.clasificacion.clasificadoAt) return null;
  return (
    <section className="rounded-2xl border border-line bg-paperSoft p-4">
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-mute">Agentes que aplican</h2>
      {agentes?.length ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {FASES.filter((f) => agentes.includes(f.key)).map((f) => (
            <li key={f.key} className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-[10px] text-ink">{f.label}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-mute">Ninguno para esta combinación de tipo y etapa.</p>
      )}
      <p className="mt-2 text-[10px] text-mute">Según la matriz tipo × etapa. Los omitidos no aplican a este contrato.</p>
    </section>
  );
}

function Pendientes({ v }: { v: string[] | null }) {
  if (!v?.length) return null;
  return (
    <div className="mt-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-mute">Validaciones pendientes</div>
      <ul className="mt-1 space-y-0.5 text-[12px] text-ink">
        {v.map((x) => <li key={x} className="flex items-start gap-1.5"><span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-clay" />{validacionLabel(x)}</li>)}
      </ul>
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Badge({ children, tone }: { children: React.ReactNode; tone?: "ink" }) {
  return (
    <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", tone === "ink" ? "bg-paperDeep text-ink" : "border border-line text-mute")}>
      {children}
    </span>
  );
}

function Dato({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-mute">{k}</dt>
      <dd className={cn("mt-0.5 text-ink", mono && "font-mono tabular-nums")}>{v}</dd>
    </div>
  );
}
