/**
 * Detalle de un contrato: cabecera, clasificación, ítems, documentos oficiales y el
 * estado de su análisis (dictamen · en vivo · financiar capacidad · pendiente).
 * Server component; solo `ContratoEnVivo` y `Redact` son islas de cliente.
 */

import Link from "next/link";
import {
  ArrowLeft, Building2, ChevronDown, Clock, Heart, MapPin, ShieldAlert,
} from "lucide-react";
import { ContratoEnVivo } from "@/components/auditoria/ContratoEnVivo";
import { ResultadoAnalisis } from "@/components/auditoria/ResultadoAnalisis";
import { Glass, PersonName } from "@/components/Redact";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { EstadoContratoPill } from "./ContratosLista";
import { DocumentosContrato } from "./DocumentosContrato";
import { CitaPagina } from "./CitaPagina";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { FASES } from "@/lib/auditoria";
import {
  esPersonaNatural, etapaLabel, formatFecha, formatMonto, motivoLabel, tipoLabel,
  validacionLabel, type ContratoDetalle as Detalle,
} from "@/lib/contratos";
import { cn } from "@/lib/utils";

export function ContratoDetalle({ c }: { c: Detalle }) {
  const regionId = c.ubigeo ? UBIGEO_REGION[c.ubigeo.slice(0, 2)] : undefined;
  const mapaHref = regionId ? `/app/mapa?region=${regionId}&tab=cola${c.ubigeo && c.ubigeo.length === 6 ? `&ubigeo=${c.ubigeo}` : ""}` : "/app/mapa";
  const natural = esPersonaNatural(c.proveedorRuc);
  const postores = c.postoresDetalle ?? [];
  const itemsAnalizados = (c.itemsAnalizados ?? []).filter((it) => it.precioUnitarioContratado != null || it.precioUnitarioOfertado != null);
  const senalesConCita = (c.alerta?.banderas ?? []).filter((b) => (b.citas?.length ?? 0) > 0);

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
          {c.alerta?.estado === "revision" ? <EstadoPill estado="revision" /> : <EstadoContratoPill estado={c.estadoProcesamiento} operativo={c.estadoOperativo} />}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {/* Datos */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line bg-paper p-4 text-sm shadow-card sm:grid-cols-4">
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

          {/* Ítems — colapsable: procesos con muchos ítems (hasta 73 en casos reales) ya no
              fuerzan todo ese scroll de entrada; con pocos (el caso típico) queda abierto igual
              que antes, sin ningún cambio visible. */}
          <details className="group" open={c.items.length <= 10}>
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
              Ítems ({c.items.length})
              <ChevronDown size={12} className="text-mute/60 transition-transform duration-200 group-open:rotate-180" />
            </summary>
            {c.items.length ? (
              <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-paper shadow-card">
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
                      <tr key={it.id} className="transition-colors hover:bg-paperSoft">
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
              <p className="mt-2 rounded-2xl border border-dashed border-line bg-paper px-4 py-6 text-center text-sm text-mute">El registro OCDS no trae ítems para este proceso.</p>
            )}
          </details>

          {/* Postores y ofertas (leídos del expediente) — colapsable cuando hay muchos postores;
              con pocos (el caso típico) queda abierto igual que antes. */}
          {postores.length > 0 && (
            <details className="group" open={postores.length <= 8}>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                Postores y ofertas ({postores.length})
                <ChevronDown size={12} className="text-mute/60 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-paper shadow-card">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <caption className="sr-only">Postores con su oferta económica, leídos de las actas del expediente</caption>
                  <thead className="bg-paperDeep text-[10px] uppercase tracking-wider text-mute">
                    <tr>
                      <th className="w-8 px-3 py-2 font-semibold">#</th>
                      <th className="px-3 py-2 font-semibold">Postor</th>
                      <th className="w-28 px-3 py-2 font-semibold">Estado</th>
                      <th className="w-32 px-3 py-2 text-right font-semibold">Oferta</th>
                      <th className="w-24 px-3 py-2 text-right font-semibold">vs. referencia</th>
                      <th className="w-24 px-3 py-2 font-semibold">Fuente</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[...postores].sort((a, b) => Number(b.esGanador) - Number(a.esGanador) || (a.ordenPrelacion ?? 99) - (b.ordenPrelacion ?? 99)).map((p, i) => {
                      const nat = esPersonaNatural(p.ruc);
                      const dif = p.montoOferta != null && c.montoPen ? ((p.montoOferta - c.montoPen) / c.montoPen) * 100 : null;
                      return (
                        <tr key={`${p.ruc ?? p.razonSocial}-${i}`} className={cn("transition-colors hover:bg-paperSoft", p.esGanador && "bg-moss/5")}>
                          <td className="px-3 py-2 font-mono text-mute">{p.ordenPrelacion ?? i + 1}</td>
                          <td className="px-3 py-2 text-ink">
                            {p.razonSocial ? (nat ? <PersonName name={p.razonSocial} /> : p.razonSocial) : "—"}
                            {p.ruc && <span className="ml-2 font-mono text-[10px] text-mute">RUC {nat ? <Glass label="RUC de persona natural — clic para revelar">{p.ruc}</Glass> : p.ruc}</span>}
                            {p.esGanador && <span className="ml-2 rounded-full bg-moss px-1.5 py-0.5 text-[9px] font-semibold uppercase text-paper">ganador</span>}
                          </td>
                          <td className="px-3 py-2 text-mute" title={p.motivoEstado ?? undefined}>{p.estado ? p.estado.replace(/_/g, " ") : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{p.montoOferta != null ? formatMonto(p.montoOferta, c.moneda) : "—"}</td>
                          <td className={cn("px-3 py-2 text-right font-mono tabular-nums", dif == null ? "text-mute" : dif > 0 ? "text-rust" : "text-moss")}>{dif == null ? "—" : `${dif > 0 ? "+" : ""}${dif.toFixed(1)} %`}</td>
                          <td className="px-3 py-2">{p.citas[0] ? <CitaPagina ocid={c.ocid} cita={p.citas[0]} corto /> : <span className="text-[10px] text-mute">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-mute">Ofertas leídas de las actas y cuadros comparativos del expediente; “vs. referencia” compara con el valor referencial del proceso. Toca la fuente para abrir la página citada del PDF.</p>
            </details>
          )}

          {/* Precio contratado vs. referencia — colapsable cuando hay muchos ítems analizados
              (mismo caso de contratos con decenas de ítems); con pocos queda abierto igual que antes. */}
          {itemsAnalizados.length > 0 && (
            <details className="group" open={itemsAnalizados.length <= 10}>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                Precio contratado vs. referencia ({itemsAnalizados.length})
                <ChevronDown size={12} className="text-mute/60 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-paper shadow-card">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <caption className="sr-only">Ítems con su precio unitario ofertado o contratado frente al valor referencial</caption>
                  <thead className="bg-paperDeep text-[10px] uppercase tracking-wider text-mute">
                    <tr>
                      <th className="w-8 px-3 py-2 font-semibold">#</th>
                      <th className="px-3 py-2 font-semibold">Ítem</th>
                      <th className="w-20 px-3 py-2 text-right font-semibold">Cant.</th>
                      <th className="w-28 px-3 py-2 text-right font-semibold">Ref. unit.</th>
                      <th className="w-28 px-3 py-2 text-right font-semibold">Contratado unit.</th>
                      <th className="w-20 px-3 py-2 text-right font-semibold">Δ</th>
                      <th className="w-24 px-3 py-2 font-semibold">Fuente</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {itemsAnalizados.map((it) => {
                      const unit = it.precioUnitarioContratado ?? it.precioUnitarioOfertado;
                      const d = unit != null && it.referenciaUnitaria ? ((unit - it.referenciaUnitaria) / it.referenciaUnitaria) * 100 : null;
                      return (
                        <tr key={it.numero} className="transition-colors hover:bg-paperSoft">
                          <td className="px-3 py-2 font-mono text-mute">{it.numero}</td>
                          <td className="px-3 py-2 text-ink">
                            <span className="line-clamp-2" title={it.descripcion ?? undefined}>{it.descripcion ?? "—"}</span>
                            {it.marca && <span className="block text-[10px] text-mute">marca ofertada: {it.marca}</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{it.cantidad != null ? it.cantidad.toLocaleString("es-PE") : "—"}{it.unidad ? <span className="ml-1 text-[10px] text-mute">{it.unidad}</span> : null}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-mute">{it.referenciaUnitaria != null ? formatMonto(it.referenciaUnitaria, c.moneda) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{unit != null ? formatMonto(unit, c.moneda) : "—"}{it.precioUnitarioContratado == null && it.precioUnitarioOfertado != null && <span className="block text-[9px] text-mute">ofertado</span>}</td>
                          <td className={cn("px-3 py-2 text-right font-mono tabular-nums", d == null ? "text-mute" : d > 0 ? "text-rust" : "text-moss")}>{d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(1)} %`}</td>
                          <td className="px-3 py-2">{it.citas[0] ? <CitaPagina ocid={c.ocid} cita={it.citas[0]} corto /> : <span className="text-[10px] text-mute">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-mute">Referencia unitaria = valor referencial del ítem en el registro OCDS ÷ cantidad. El contratado sale del contrato u orden de compra leída por los agentes.</p>
            </details>
          )}

          {/* Señales con página citada — colapsable: es evidencia de profundización, no la
              primera lectura; con pocas señales (el caso típico) queda abierto igual que antes. */}
          {senalesConCita.length > 0 && (
            <details className="group" open={senalesConCita.length <= 6}>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                Dónde dice cada señal en el expediente ({senalesConCita.length})
                <ChevronDown size={12} className="text-mute/60 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-paper shadow-card">
                {senalesConCita.map((b, i) => (
                  <li key={`${b.regla}-${i}`} className="px-4 py-2.5 text-sm">
                    <div className="text-[13px] font-semibold text-ink">{b.regla.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase())}</div>
                    {b.evidencia && <p className="mt-0.5 line-clamp-2 text-[12px] text-inkSoft">{b.evidencia}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(b.citas ?? []).slice(0, 4).map((ct, j) => <CitaPagina key={j} ocid={c.ocid} cita={ct} />)}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Documentos — colapsable: los expedientes reales suelen traer muchos archivos (bases,
              addendas, actas, contrato…); con pocos (el caso típico) queda abierto igual que antes.
              El <summary> tiene que ser hijo directo de <details>, así que el título y el estado del
              almacén (antes en un <div> aparte junto al <h2>) se juntan en un único <summary>. */}
          <details className="group" open={c.documentos.length <= 10}>
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute transition-colors hover:text-ink">
                Documentos oficiales ({c.documentos.length})
                <ChevronDown size={12} className="text-mute/60 transition-transform duration-200 group-open:rotate-180" />
              </span>
              {c.documentosEnVigia && c.documentos.length > 0 && (
                <span className="text-[10px] text-mute" title="Los documentos se conservan 90 días en el almacén de Vigía; después se vuelven a descargar solo si alguien financia el análisis.">
                  {c.documentosEnVigia.n > 0 && c.documentosEnVigia.expiraAt
                    ? `${c.documentosEnVigia.n} en el almacén de Vigía hasta el ${formatFecha(c.documentosEnVigia.expiraAt.slice(0, 10))}`
                    : "no descargados: se bajan al financiar"}
                </span>
              )}
            </summary>
            <DocumentosContrato ocid={c.ocid} documentos={c.documentos} />
          </details>
        </div>

        {/* Análisis */}
        {/* En móvil el resultado del análisis va antes de ítems/postores/documentos; en escritorio, columna derecha pegajosa. */}
        <aside className="order-first space-y-4 lg:order-none lg:sticky lg:top-6 lg:self-start">
          <AnalisisCard c={c} />
          {/* Con procesamiento en vivo los carriles ya muestran qué agente aplica y cuál se omitió. */}
          {!c.procesamiento && <ClasificacionCard c={c} />}
        </aside>
      </div>
    </div>
  );
}

// ─── Estado del análisis ─────────────────────────────────────────────────────

function AnalisisCard({ c }: { c: Detalle }) {
  const estado = c.estadoProcesamiento;

  if (estado === "procesado" && c.alerta) {
    // Con procesamiento financiado, ContratoEnVivo (compacto) trae resultado + cómo se ejecutó (carriles + bitácora).
    if (c.procesamiento) {
      return <ContratoEnVivo ocid={c.ocid} initial={{ ...c.procesamiento, eventos: [], resultado: c.alerta }} compacto />;
    }
    return (
      <div className="space-y-2">
        <ResultadoAnalisis resultado={c.alerta} ocid={c.ocid} compacto sharePath={`/app/contratos/${encodeURIComponent(c.ocid)}`} />
        {c.alerta.analizadoEn && <p className="text-center text-[10px] text-mute">Analizado el {formatFecha(c.alerta.analizadoEn.slice(0, 10))}</p>}
      </div>
    );
  }

  if (estado === "esperando_documentos") {
    return (
      <section className="rounded-2xl border border-line bg-paper p-4 shadow-card">
        <h2 className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute">
          <Clock size={12} className="text-clay" /> Esperando documentos
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink">
          Este contrato ya fue financiado. Sus documentos {c.documentosEnVigia?.n ? "expiraron en el almacén de Vigía" : "todavía no se descargaron"}: el lote nocturno los baja desde el SEACE y el análisis arranca al día siguiente.
        </p>
        {c.pedidoDescarga && (
          <p className="mt-2 text-[11px] text-mute">
            Pedido {c.pedidoDescarga.estado === "descargando" ? "en descarga" : "en cola para esta noche"} · solicitado el {formatFecha(c.pedidoDescarga.solicitadoAt.slice(0, 10))}
          </p>
        )}
      </section>
    );
  }

  if ((estado === "procesando" || estado === "encolado" || estado === "error") && c.procesamiento) {
    return <ContratoEnVivo ocid={c.ocid} initial={{ ...c.procesamiento, eventos: [] }} compacto />;
  }

  if (estado === "pendiente_de_procesamiento" || c.procesable === false) {
    return (
      <section className="rounded-2xl border border-line bg-paper p-4 shadow-card">
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

  // Migración 19: tipo/etapa fuera del alcance activo → decir qué hay, sin CTA de financiar.
  if (c.estadoOperativo && c.estadoOperativo !== "en_cola") {
    const listo = c.estadoOperativo === "documentos_listos";
    return (
      <section className="rounded-2xl border border-line bg-paper p-4 shadow-card">
        <h2 className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute">
          <Clock size={12} className={listo ? "text-moss" : "text-mute"} /> {listo ? "Documentos listos para procesarse" : "Análisis en preparación"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink">
          {listo
            ? `Los documentos de este contrato ya están descargados y clasificados. El análisis de ${tipoLabel(c.tipo)?.toLowerCase() ?? "este tipo de contratación"} en esta etapa todavía no está activo; cuando se active, entrará a la cola de su zona en orden de llegada.`
            : `El análisis de ${tipoLabel(c.tipo)?.toLowerCase() ?? "este tipo de contratación"} en esta etapa todavía no está activo. Hoy se procesan contratos de bienes con adjudicación o contrato.`}
        </p>
        <Pendientes v={c.clasificacion.validacionesPendientes} />
      </section>
    );
  }

  // sin_analizar (o procesado sin alerta legible)
  return (
    <section className="rounded-2xl border border-line bg-paper p-4 shadow-card">
      <h2 className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute">
        {/* mute, no amber: "sin analizar" es el estado neutral/mayoritario (así se pinta en
            la píldora de la lista y en la leyenda del mapa), no una advertencia real. */}
        <ShieldAlert size={12} className="text-mute" /> Sin analizar
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink">
        Este contrato espera en la cola{c.zona ? ` de ${c.zona}` : ""}. Los agentes lo leerán cuando alguien financie capacidad de auditoría para su zona; el orden es por llegada, nadie elige cuál.
      </p>
      <Pendientes v={c.clasificacion.validacionesPendientes} />
      {/* Mismo tratamiento que el CTA "Financiar una auditoría" de Header/Footer:
          heroViolet es el CTA principal de la marca — bg-ink era el color equivocado. */}
      {c.ubigeo && (
        <Link href={`/app/financiar/${c.ubigeo}`} className="mt-4 flex items-center justify-center gap-1.5 rounded-full bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper">
          <Heart size={14} className="fill-paper text-paper" /> Financiar la auditoría de {c.zona ?? "esta zona"}
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
