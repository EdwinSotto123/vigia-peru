/**
 * Detalle de un contrato (DESIGN_SYSTEM.md §14, "Detalle"): primero su identidad (qué, quién
 * compra, quién ganó, cuánto y cuándo), después el estado de su lectura (resultado, en vivo,
 * financiar o pendiente) y, debajo, la evidencia oficial: ítems, ofertas, precios, dónde dice
 * cada señal en el expediente y los documentos.
 *
 * Server component; sólo `ContratoEnVivo`, `Redact` y `TextoRedactado` son islas de cliente.
 * Montos con `soles` (tablas: completos, sin compactar) y fechas con `fecha`/`fechaCorta`, de
 * lib/formato: un solo formato por columna.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Building2, ChevronDown, Clock, MapPin, ShieldAlert } from "lucide-react";
import { ContratoEnVivo } from "@/components/auditoria/ContratoEnVivo";
import { ResultadoAnalisis } from "@/components/auditoria/ResultadoAnalisis";
import { PersonName, Ruc } from "@/components/Redact";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { Ayuda, FuenteDato } from "@/components/patrones";
import { EstadoContratoPill } from "./ContratosLista";
import { DocumentosContrato } from "./DocumentosContrato";
import { CitaPagina } from "./CitaPagina";
import { TextoRedactado } from "./TextoRedactado";
import { recortar } from "./recortar";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { FASES } from "@/lib/auditoria";
import { etiquetaRegla, type CatalogoReglas } from "@/lib/revision";
import { fecha, fechaCorta, numero, porcentaje, soles } from "@/lib/formato";
import {
  esPersonaNatural, etapaLabel, humanizarCodigo, motivoLabel, ordenNombrePostor,
  personasNaturalesDe, tipoLabel, validacionLabel, type ContratoDetalle as Detalle, type PostorContrato,
} from "@/lib/contratos";
import { cn } from "@/lib/utils";

/** Qué se analiza hoy, tal como lo informa la API (`procesamientoActivo` del resumen de procesamientos). */
export interface AlcanceActivo {
  tipos_activos?: string[];
  etapas_activas?: string[];
  nota?: string;
}

/** Monto en tabla: soles completos (lib/formato). Si el registro trae otra moneda, se dice cuál. */
function monto(n: number | null | undefined, moneda: string | null): string {
  if (n == null) return "Sin dato";
  return moneda && moneda !== "PEN" ? `${moneda} ${numero(n)}` : soles(n);
}

/** "+12.3 %" · "−4 %": diferencia con signo, en tinta neutra (un número no es una señal). */
function diferencia(pct: number): string {
  const signo = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${signo}${porcentaje(Math.abs(pct), { decimales: 1 })}`;
}

/**
 * Referencia contra la que se compara la oferta de UN postor. La oferta es por ítem
 * (`p.item`): compararla con el valor referencial del proceso entero daba "−71 %"
 * a un postor que ofertó exactamente el valor de su ítem en un proceso de tres
 * ítems. Se usa la referencia del ítem que ofertó; con un solo ítem, el total del
 * proceso es la misma cifra. Sin ítem identificable, no se compara.
 */
function referenciaDe(p: PostorContrato, c: Detalle): number | null {
  const n = p.item != null ? Number(String(p.item).trim()) : NaN;
  if (Number.isFinite(n)) {
    const it = c.items.find((x) => x.posicion === n);
    if (it?.montoPen) return it.montoPen;
  }
  if (c.items.length <= 1 && c.montoPen) return c.montoPen;
  return null;
}

export function ContratoDetalle({ c, alcance = null, catalogo = {} }: { c: Detalle; alcance?: AlcanceActivo | null; catalogo?: CatalogoReglas }) {
  const regionId = c.ubigeo ? UBIGEO_REGION[c.ubigeo.slice(0, 2)] : undefined;
  const mapaHref = regionId ? `/app/mapa?region=${regionId}&tab=cola${c.ubigeo && c.ubigeo.length === 6 ? `&ubigeo=${c.ubigeo}` : ""}` : "/app/mapa";
  const natural = esPersonaNatural(c.proveedorRuc);
  const postores = c.postoresDetalle ?? [];
  const itemsAnalizados = (c.itemsAnalizados ?? []).filter((it) => it.precioUnitarioContratado != null || it.precioUnitarioOfertado != null);
  const senalesConCita = (c.alerta?.banderas ?? []).filter((b) => (b.citas?.length ?? 0) > 0);
  const personas = personasNaturalesDe(c);
  // En revisión humana se dice "En revisión" y nada más (DESIGN_SYSTEM.md §10.4): ni señales ni
  // comparaciones de precio del análisis, que son los montos que la lectura cuestionaría.
  const enRevision = c.alerta?.estado === "revision";
  // La columna "vs. referencia" solo existe si al menos un postor tiene contra qué compararse.
  const hayReferencia = !enRevision && postores.some((p) => p.montoOferta != null && referenciaDe(p, c) != null);
  // Lo adjudicado es la suma de las adjudicaciones del registro; el referencial, lo presupuestado.
  const adjudicado = (c.adjudicaciones ?? []).reduce((s, a) => s + (a.montoPen ?? 0), 0) || null;

  return (
    <div className="space-y-6">
      <Link href="/app/contratos" className="inline-flex min-h-[32px] items-center gap-1.5 text-sm text-mute hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Contratos
      </Link>

      {/* 1. Identidad: qué se contrató y quién compra */}
      <header className="border-b border-line pb-5">
        <h1 className="max-w-4xl font-display text-[26px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[32px]">
          {c.titulo ?? "Contrato sin objeto registrado"}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {c.entidadRuc ? (
            <Link href={`/entidad/${c.entidadRuc}`} className="inline-flex items-center gap-1.5 text-ink hover:underline">
              <Building2 size={14} className="text-mute" aria-hidden /> {c.entidad ?? c.entidadRuc}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-mute"><Building2 size={14} aria-hidden /> {c.entidad ?? "Entidad no identificada"}</span>
          )}
          {c.zona && (
            <Link href={mapaHref} className="inline-flex items-center gap-1.5 text-ink hover:underline">
              <MapPin size={14} className="text-mute" aria-hidden /> {c.zona}
            </Link>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Etiqueta fuerte>{tipoLabel(c.tipo) ?? "Tipo sin clasificar"}</Etiqueta>
          <Etiqueta>{etapaLabel(c.etapa) ?? "Etapa sin clasificar"}</Etiqueta>
          {c.modalidad && <Etiqueta>{c.modalidad}</Etiqueta>}
          {enRevision ? <EstadoPill estado="revision" /> : <EstadoContratoPill estado={c.estadoProcesamiento} operativo={c.estadoOperativo} />}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-mute">
          <span>Código SEACE <span className="font-mono text-inkSoft">{c.codigo}</span></span>
          {c.nomenclatura && <span className="font-mono">{c.nomenclatura}</span>}
          {c.ocid !== c.codigo && <span>OCID <span className="font-mono">{c.ocid}</span></span>}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {/* Quién ganó, cuánto y cuándo */}
          <section aria-label="Ficha del contrato" className="rounded-2xl border border-line bg-paper">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 text-sm sm:grid-cols-4">
              <Dato k="Valor referencial" v={c.montoPen ? monto(c.montoPen, c.moneda) : "Sin dato"} mono vacio={!c.montoPen} />
              <Dato k="Monto adjudicado" v={adjudicado ? monto(adjudicado, c.moneda) : "Sin adjudicar"} mono vacio={!adjudicado} />
              <Dato k="Convocatoria" v={c.fecha ? fecha(c.fecha) : "Sin fecha"} vacio={!c.fecha} />
              <Dato k="Buena pro" v={c.fechaBuenaPro ? fecha(c.fechaBuenaPro) : "Sin fecha"} vacio={!c.fechaBuenaPro} />
              <Dato k="Postores" v={c.postores != null ? numero(c.postores) : "Sin dato"} mono vacio={c.postores == null} />
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-[12px] text-mute">Quién ganó</dt>
                <dd className="mt-0.5 text-ink">
                  {c.proveedor ? (
                    <>
                      {/* El proveedor del OCDS viene en orden SUNAT (apellidos primero). */}
                      <span className="font-semibold">{natural ? <PersonName name={c.proveedor} orden="sunat" /> : c.proveedor}</span>
                      {c.proveedorRuc && (
                        <span className="ml-2 font-mono text-[12px] text-mute">
                          RUC <Ruc value={c.proveedorRuc} />
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
                  <dt className="text-[12px] text-mute">Descripción</dt>
                  <dd className="mt-0.5 max-w-[68ch] text-[13px] leading-relaxed text-ink">
                    <Descripcion texto={c.descripcion} />
                  </dd>
                </div>
              )}
            </dl>
            <FuenteDato fuente="registro OCDS del OECE (SEACE)" className="border-t border-line px-4 py-2" />
          </section>

          {/* Ítems — plegable: procesos con muchos ítems (hasta 73 en casos reales) no fuerzan
              todo ese scroll de entrada; con pocos (el caso típico) queda abierto. */}
          <Plegable titulo="Ítems" n={c.items.length} abierto={c.items.length <= 10}>
            {c.items.length ? (
              <Tabla minimo="min-w-[560px]" leyenda="Ítems del proceso según el registro OCDS">
                <thead className="bg-paperSoft text-[12px] text-inkSoft">
                  <tr>
                    <th scope="col" className="w-10 px-3 py-2 font-semibold">#</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Descripción</th>
                    <th scope="col" className="w-28 px-3 py-2 text-right font-semibold">Cantidad</th>
                    <th scope="col" className="w-32 px-3 py-2 text-right font-semibold">Monto referencial</th>
                    <th scope="col" className="w-28 px-3 py-2 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {c.items.map((it) => (
                    <tr key={it.id} className="transition-colors hover:bg-paperSoft">
                      <td className="px-3 py-2 font-mono text-mute">{it.posicion}</td>
                      <td className="px-3 py-2 text-ink">
                        {/* Dos líneas, como en la tabla de precios: el texto entero va en `title`. */}
                        <span className="line-clamp-2" title={it.descripcion ?? undefined}>
                          {it.descripcion ?? <span className="text-mute">Sin descripción</span>}
                        </span>
                        {it.cubso && <span className="block font-mono text-[11px] text-mute">CUBSO {it.cubso}</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                        {it.cantidad != null ? numero(it.cantidad) : <span className="text-mute">Sin dato</span>}
                        {it.unidad ? <span className="ml-1 text-[11px] text-mute">{it.unidad}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{it.montoPen ? monto(it.montoPen, c.moneda) : <span className="text-mute">Sin dato</span>}</td>
                      <td className="px-3 py-2 text-mute">{humanizarCodigo(it.estado) ?? "Sin dato"}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            ) : (
              <p className="rounded-2xl border border-dashed border-line bg-paperSoft px-4 py-6 text-center text-sm text-mute">El registro OCDS no trae ítems para este proceso.</p>
            )}
          </Plegable>

          {/* Postores y ofertas (leídos del expediente) */}
          {postores.length > 0 && (
            <Plegable titulo="Postores y ofertas" n={postores.length} abierto={postores.length <= 8}>
              <Tabla minimo="min-w-[560px]" leyenda="Postores con su oferta económica, leídos de las actas del expediente">
                <thead className="bg-paperSoft text-[12px] text-inkSoft">
                  <tr>
                    <th scope="col" className="w-8 px-3 py-2 font-semibold">#</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Postor</th>
                    <th scope="col" className="w-28 px-3 py-2 font-semibold">Estado</th>
                    {c.items.length > 1 && <th scope="col" className="w-14 px-3 py-2 font-semibold">Ítem</th>}
                    <th scope="col" className="w-32 px-3 py-2 text-right font-semibold">Oferta</th>
                    {hayReferencia && <th scope="col" className="w-24 px-3 py-2 text-right font-semibold">vs. referencia</th>}
                    <th scope="col" className="w-24 px-3 py-2 font-semibold">Fuente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...postores].sort((a, b) => Number(b.esGanador) - Number(a.esGanador) || (a.ordenPrelacion ?? 99) - (b.ordenPrelacion ?? 99)).map((p, i) => {
                    const nat = esPersonaNatural(p.ruc);
                    const ref = referenciaDe(p, c);
                    const dif = p.montoOferta != null && ref ? ((p.montoOferta - ref) / ref) * 100 : null;
                    const estado = humanizarCodigo(p.estado);
                    return (
                      <tr key={`${p.ruc ?? p.razonSocial}-${i}`} className={cn("transition-colors hover:bg-paperSoft", p.esGanador && "bg-paperSoft")}>
                        <td className="px-3 py-2 font-mono text-mute">{p.ordenPrelacion ?? i + 1}</td>
                        <td className="px-3 py-2 text-ink">
                          {p.razonSocial
                            ? nat
                              ? <PersonName name={p.razonSocial} orden={ordenNombrePostor(p.razonSocial, p.ruc, c.proveedor, c.proveedorRuc)} />
                              : p.razonSocial
                            : <span className="text-mute">Sin razón social</span>}
                          {p.ruc && <span className="ml-2 font-mono text-[11px] text-mute">RUC <Ruc value={p.ruc} /></span>}
                          {p.esGanador && <span className="ml-2 rounded-full bg-granate-soft px-2 py-0.5 text-[11px] font-semibold text-granate">Ganador</span>}
                        </td>
                        <td className="px-3 py-2 text-mute">
                          {estado ?? "Sin dato"}
                          {p.motivoEstado && <span className="block text-[11px] leading-snug">{humanizarCodigo(p.motivoEstado)}</span>}
                        </td>
                        {c.items.length > 1 && <td className="px-3 py-2 font-mono text-mute">{p.item ?? "Sin dato"}</td>}
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{p.montoOferta != null ? monto(p.montoOferta, c.moneda) : <span className="text-mute">Sin dato</span>}</td>
                        {hayReferencia && (
                          <td className={cn("px-3 py-2 text-right font-mono tabular-nums", dif == null ? "text-mute" : "text-ink")}>{dif == null ? "Sin dato" : diferencia(dif)}</td>
                        )}
                        <td className="px-3 py-2">{p.citas[0] ? <CitaPagina ocid={c.ocid} cita={p.citas[0]} corto /> : <span className="text-[11px] text-mute">Sin cita</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabla>
              <p className="mt-1.5 flex items-center gap-1 text-[12px] text-mute">
                Ofertas leídas de las actas y cuadros comparativos del expediente.
                <Ayuda titulo="¿Cómo leer esta tabla?">
                  {hayReferencia &&
                    (c.items.length > 1
                      ? "“vs. referencia” compara cada oferta con el valor referencial del ítem al que se presentó. "
                      : "“vs. referencia” compara con el valor referencial del proceso. ")}
                  Toca la fuente para abrir la página citada del PDF.
                </Ayuda>
              </p>
            </Plegable>
          )}

          {/* Precio contratado vs. referencia */}
          {!enRevision && itemsAnalizados.length > 0 && (
            <Plegable titulo="Precio contratado frente a la referencia" n={itemsAnalizados.length} abierto={itemsAnalizados.length <= 10}>
              <Tabla minimo="min-w-[620px]" leyenda="Ítems con su precio unitario ofertado o contratado frente al valor referencial">
                <thead className="bg-paperSoft text-[12px] text-inkSoft">
                  <tr>
                    <th scope="col" className="w-8 px-3 py-2 font-semibold">#</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Ítem</th>
                    <th scope="col" className="w-20 px-3 py-2 text-right font-semibold">Cantidad</th>
                    <th scope="col" className="w-28 px-3 py-2 text-right font-semibold">Referencia unitaria</th>
                    <th scope="col" className="w-28 px-3 py-2 text-right font-semibold">Contratado unitario</th>
                    <th scope="col" className="w-20 px-3 py-2 text-right font-semibold">Diferencia</th>
                    <th scope="col" className="w-24 px-3 py-2 font-semibold">Fuente</th>
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
                          <span className="line-clamp-2" title={it.descripcion ?? undefined}>{it.descripcion ?? <span className="text-mute">Sin descripción</span>}</span>
                          {it.marca && <span className="block text-[11px] text-mute">marca ofertada: {it.marca}</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                          {it.cantidad != null ? numero(it.cantidad) : <span className="text-mute">Sin dato</span>}
                          {it.unidad ? <span className="ml-1 text-[11px] text-mute">{it.unidad}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-inkSoft">{it.referenciaUnitaria != null ? monto(it.referenciaUnitaria, c.moneda) : <span className="text-mute">Sin dato</span>}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                          {unit != null ? monto(unit, c.moneda) : <span className="text-mute">Sin dato</span>}
                          {it.precioUnitarioContratado == null && it.precioUnitarioOfertado != null && <span className="block text-[11px] text-mute">ofertado</span>}
                        </td>
                        <td className={cn("px-3 py-2 text-right font-mono tabular-nums", d == null ? "text-mute" : "text-ink")}>{d == null ? "Sin dato" : diferencia(d)}</td>
                        <td className="px-3 py-2">{it.citas[0] ? <CitaPagina ocid={c.ocid} cita={it.citas[0]} corto /> : <span className="text-[11px] text-mute">Sin cita</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabla>
              <p className="mt-1.5 flex items-center gap-1 text-[12px] text-mute">
                Referencia unitaria = valor referencial del ítem ÷ cantidad.
                <Ayuda titulo="¿De dónde sale cada precio?">
                  La referencia sale del registro OCDS del OECE. El contratado, del contrato u orden de compra leída en el
                  expediente; si no la hay, se usa lo ofertado y se marca así.
                </Ayuda>
              </p>
            </Plegable>
          )}

          {/* Dónde dice cada señal: es evidencia de profundización, no la primera lectura. En
              revisión humana no se muestra: sería publicar las señales por la puerta de atrás. */}
          {!enRevision && senalesConCita.length > 0 && (
            <Plegable titulo="Dónde dice cada señal en el expediente" n={senalesConCita.length} abierto={senalesConCita.length <= 6}>
              <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
                {senalesConCita.map((b, i) => (
                  <li key={`${b.regla}-${i}`} className="px-4 py-3 text-sm">
                    <div className="text-[13px] font-semibold text-ink">{etiquetaRegla(b.regla, catalogo)}</div>
                    {b.evidencia && (
                      <p className="mt-0.5 line-clamp-2 text-[13px] text-inkSoft">
                        <TextoRedactado texto={b.evidencia} personas={personas} />
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(b.citas ?? []).slice(0, 4).map((ct, j) => <CitaPagina key={j} ocid={c.ocid} cita={ct} />)}
                    </div>
                  </li>
                ))}
              </ul>
            </Plegable>
          )}

          {/* Documentos oficiales: los expedientes reales suelen traer muchos archivos. */}
          <Plegable
            titulo="Documentos oficiales"
            n={c.documentos.length}
            abierto={c.documentos.length <= 10}
            nota={
              c.documentosEnVigia && c.documentos.length > 0
                ? c.documentosEnVigia.n > 0 && c.documentosEnVigia.expiraAt
                  ? `${numero(c.documentosEnVigia.n)} guardados en Vigía hasta el ${fecha(c.documentosEnVigia.expiraAt.slice(0, 10))}`
                  : "Sin copia en Vigía: se descargan al financiar la lectura"
                : null
            }
          >
            <DocumentosContrato ocid={c.ocid} documentos={c.documentos} />
          </Plegable>
        </div>

        {/* 2. La lectura: en el celular va antes de la evidencia; en escritorio, columna derecha. */}
        <aside className="order-first space-y-4 lg:order-none lg:sticky lg:top-6 lg:self-start" aria-label="Lectura del contrato">
          <AnalisisCard c={c} alcance={alcance} />
          {/* Con procesamiento en vivo los carriles ya muestran qué agente aplica y cuál se omitió. */}
          {!c.procesamiento && <ClasificacionCard c={c} />}
        </aside>
      </div>
    </div>
  );
}

// ─── Estado del análisis ─────────────────────────────────────────────────────

const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** "Hoy se analizan contratos de bienes en etapa adjudicada, contratada…" + la nota de la API. Null si la API no dijo nada. */
function alcanceTexto(a: AlcanceActivo | null): string | null {
  if (!a) return null;
  const tipos = (a.tipos_activos ?? []).map((t) => tipoLabel(t)?.toLowerCase() ?? t.replace(/_/g, " "));
  const etapas = (a.etapas_activas ?? []).map((e) => etapaLabel(e)?.toLowerCase() ?? e.replace(/_/g, " "));
  const partes: string[] = [];
  if (tipos.length) partes.push(`Hoy se analizan contratos de ${lista(tipos)}${etapas.length ? ` en etapa ${lista(etapas)}` : ""}.`);
  if (a.nota) partes.push(a.nota.trim().replace(/([^.])$/, "$1."));
  return partes.length ? partes.join(" ") : null;
}

/**
 * Tarjeta de estado de la lectura: un título, una línea de qué pasa y qué hacer.
 * El porqué y el cuándo van en `ayuda` (ⓘ junto al título, §10.7).
 */
function TarjetaEstado({ icono, titulo, ayuda, children }: { icono: ReactNode; titulo: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-center gap-1">
        <h2 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink">
          {icono}
          {titulo}
        </h2>
        {ayuda}
      </div>
      {children}
    </section>
  );
}

function AnalisisCard({ c, alcance }: { c: Detalle; alcance: AlcanceActivo | null }) {
  const estado = c.estadoProcesamiento;

  if (estado === "procesado" && c.alerta) {
    // Con procesamiento financiado, ContratoEnVivo (compacto) trae resultado + cómo se ejecutó (carriles + bitácora).
    if (c.procesamiento) {
      return <ContratoEnVivo ocid={c.ocid} initial={{ ...c.procesamiento, eventos: [], resultado: c.alerta }} compacto />;
    }
    return (
      <div className="space-y-2">
        <ResultadoAnalisis resultado={c.alerta} ocid={c.ocid} compacto sharePath={`/app/contratos/${encodeURIComponent(c.ocid)}`} />
        {c.alerta.analizadoEn && <p className="text-[12px] text-mute">Leído el {fecha(c.alerta.analizadoEn.slice(0, 10))}</p>}
      </div>
    );
  }

  if (estado === "esperando_documentos") {
    return (
      <TarjetaEstado
        icono={<Clock size={15} className="text-mute" aria-hidden />}
        titulo="Esperando documentos"
        ayuda={
          <Ayuda titulo="¿Cuándo se lee?">
            El lote nocturno baja los documentos desde el SEACE y la lectura arranca al día siguiente.
          </Ayuda>
        }
      >
        <p className="mt-2 text-sm text-ink">
          Ya financiado; sus documentos {c.documentosEnVigia?.n ? "expiraron en el almacén de Vigía" : "todavía no se descargaron"}.
        </p>
        {c.pedidoDescarga && (
          <p className="mt-2 text-[12px] text-mute">
            Pedido {c.pedidoDescarga.estado === "descargando" ? "en descarga" : "en cola para esta noche"}, solicitado el {fechaCorta(c.pedidoDescarga.solicitadoAt.slice(0, 10))}.
          </p>
        )}
      </TarjetaEstado>
    );
  }

  if ((estado === "procesando" || estado === "encolado" || estado === "error") && c.procesamiento) {
    return <ContratoEnVivo ocid={c.ocid} initial={{ ...c.procesamiento, eventos: [] }} compacto />;
  }

  if (estado === "pendiente_de_procesamiento" || c.procesable === false) {
    return (
      <TarjetaEstado
        icono={<Clock size={15} className="text-mute" aria-hidden />}
        titulo="Pendiente de procesamiento"
        ayuda={
          <Ayuda titulo="¿Qué pasa después?">
            Cuando el proceso avance de etapa o se pueda leer este tipo de contrato, entrará a la cola de su zona. No se
            cobra por lo que no se puede leer.
          </Ayuda>
        }
      >
        <p className="mt-2 text-sm text-ink">{motivoLabel(c.clasificacion.motivoNoProcesable)}</p>
        <Pendientes v={c.clasificacion.validacionesPendientes} />
      </TarjetaEstado>
    );
  }

  // Migración 19: tipo/etapa fuera del alcance activo → decir qué hay, sin CTA de financiar.
  if (c.estadoOperativo && c.estadoOperativo !== "en_cola") {
    const listo = c.estadoOperativo === "documentos_listos";
    const tipo = tipoLabel(c.tipo)?.toLowerCase() ?? "este tipo de contratación";
    // El alcance de hoy sale de la API (`procesamientoActivo`), no de una frase escrita a mano.
    const hoy = alcanceTexto(alcance);
    return (
      <TarjetaEstado
        icono={<Clock size={15} className={listo ? "text-mossTexto" : "text-mute"} aria-hidden />}
        titulo={listo ? "Documentos listos para leerse" : "Lectura en preparación"}
        ayuda={
          <Ayuda titulo="¿Qué se analiza hoy?">
            {listo && (
              <span className="block">
                Sus documentos ya están descargados y clasificados: cuando se active la lectura de {tipo} en esta etapa,
                entrará a la cola de su zona en orden de llegada.
              </span>
            )}
            {hoy && <span className={cn("block", listo && "mt-2")}>{hoy}</span>}
            {!listo && !hoy && <span className="block">Cuando se active, entrará a la cola de su zona en orden de llegada.</span>}
          </Ayuda>
        }
      >
        <p className="mt-2 text-sm text-ink">La lectura de {tipo} en esta etapa todavía no está activa.</p>
        <Pendientes v={c.clasificacion.validacionesPendientes} />
      </TarjetaEstado>
    );
  }

  // sin_analizar (o procesado sin alerta legible). Tinta neutra: "sin leer" es el estado
  // mayoritario (así se pinta en la píldora de la lista y en la leyenda del mapa), no una advertencia.
  return (
    <TarjetaEstado
      icono={<ShieldAlert size={15} className="text-mute" aria-hidden />}
      titulo="Todavía sin leer"
      ayuda={
        <Ayuda titulo="¿Cuándo se lee?">
          Vigía lo leerá cuando alguien financie la lectura de su zona. El orden es por llegada: nadie elige cuál.
        </Ayuda>
      }
    >
      <p className="mt-2 text-sm text-ink">Espera en la cola{c.zona ? ` de ${c.zona}` : ""}.</p>
      <Pendientes v={c.clasificacion.validacionesPendientes} />
      {c.ubigeo && (
        <Link
          href={`/app/financiar/${c.ubigeo}`}
          className="mt-4 flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-granate px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-granate-deep"
        >
          Financiar la lectura de {c.zona ?? "esta zona"}
        </Link>
      )}
    </TarjetaEstado>
  );
}

function ClasificacionCard({ c }: { c: Detalle }) {
  const agentes = c.clasificacion.agentesAplicables;
  if (!agentes?.length && !c.clasificacion.clasificadoAt) return null;
  return (
    <section className="rounded-2xl border border-line bg-paperSoft p-4">
      <div className="flex items-center gap-1">
        <h2 className="text-[13px] font-semibold text-ink">Qué partes del análisis aplican</h2>
        <Ayuda titulo="¿Por qué estas partes?">
          Dependen del tipo de contrato y de su etapa. Las que no aparecen no aplican a este contrato.
        </Ayuda>
      </div>
      {agentes?.length ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {FASES.filter((f) => agentes.includes(f.key)).map((f) => (
            <li key={f.key} className="rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-ink">{f.label}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] text-mute">Ninguna para esta combinación de tipo y etapa.</p>
      )}
    </section>
  );
}

function Pendientes({ v }: { v: string[] | null }) {
  if (!v?.length) return null;
  return (
    <div className="mt-3">
      <div className="text-[12px] font-semibold text-inkSoft">Validaciones pendientes</div>
      <ul className="mt-1 space-y-0.5 text-[13px] text-ink">
        {v.map((x) => <li key={x} className="flex items-start gap-1.5"><span aria-hidden className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-mute" />{validacionLabel(x)}</li>)}
      </ul>
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

/**
 * Bloque plegable con su título como h2 dentro del <summary> (un título por bloque, sin saltos).
 * Con pocos elementos queda abierto; con muchos, plegado.
 */
function Plegable({ titulo, n, abierto, nota, children }: { titulo: string; n: number; abierto: boolean; nota?: string | null; children: ReactNode }) {
  return (
    <details className="group" open={abierto}>
      <summary className="flex min-h-[40px] cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
        <h2 className="inline-flex items-center gap-1.5 font-display text-[18px] font-bold text-ink">
          {titulo} <span className="font-sans text-[14px] font-medium tabular-nums text-mute">({numero(n)})</span>
          <ChevronDown size={16} className="text-mute transition-transform duration-rapido group-open:rotate-180" aria-hidden />
        </h2>
        {nota && <span className="text-[12px] text-mute">{nota}</span>}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/**
 * La descripción del registro, que a veces es un párrafo entero. Hasta ~2 líneas
 * se muestra tal cual; más larga, el comienzo y "Ver completa" (§10.7): el dato
 * sigue ahí, a un clic, sin empujar las tablas hacia abajo.
 */
function Descripcion({ texto }: { texto: string }) {
  if (texto.length <= 180) return <>{texto}</>;
  return (
    // Grupo con nombre: un `group` sin nombre reaccionaría al [open] de cualquier ancestro.
    <details className="group/desc">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="group-open/desc:hidden">{recortar(texto, 150)} </span>
        <span className="text-[12px] font-medium text-granate underline-offset-2 hover:underline">
          <span className="group-open/desc:hidden">Ver completa</span>
          <span className="hidden group-open/desc:inline">Ocultar</span>
        </span>
      </summary>
      <span className="mt-1 block">{texto}</span>
    </details>
  );
}

function Tabla({ minimo, leyenda, children }: { minimo: string; leyenda: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
      <table className={cn("w-full text-left text-[13px]", minimo)}>
        <caption className="sr-only">{leyenda}</caption>
        {children}
      </table>
    </div>
  );
}

function Etiqueta({ children, fuerte }: { children: ReactNode; fuerte?: boolean }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium", fuerte ? "bg-paperDeep text-ink" : "border border-line text-inkSoft")}>
      {children}
    </span>
  );
}

function Dato({ k, v, mono, vacio }: { k: string; v: string; mono?: boolean; vacio?: boolean }) {
  return (
    <div>
      <dt className="text-[12px] text-mute">{k}</dt>
      <dd className={cn("mt-0.5", vacio ? "text-mute" : "font-semibold text-ink", mono && !vacio && "font-mono tabular-nums")}>{v}</dd>
    </div>
  );
}
