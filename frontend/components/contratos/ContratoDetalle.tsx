/**
 * Ficha de un contrato (DESIGN_SYSTEM.md §14.2), en el orden de la plantilla:
 *   volver → identidad (el objeto; código, entidad y zona en una línea; chips de estado)
 *   → Indicadores (cuánto y cuándo) → pestañas (§14.3): Resumen (el estado de su lectura,
 *   con los datos del proceso al costado) | Ítems | Postores y ofertas | Precio contratado |
 *   Dónde dice cada señal | Documentos oficiales, cada una con su conteo y su fuente al pie.
 *   Antes esas cinco tablas se apilaban debajo del estado y había que bajar y bajar.
 *
 * Antes las cifras vivían en una grilla de formulario ("Valor referencial / Monto adjudicado /
 * Convocatoria / Buena pro / Postores / Quién ganó") y cada tabla tenía su propio estilo. Ahora
 * las cifras son `Indicadores`, quién ganó y los códigos van en "Datos del proceso" (columna
 * lateral) y las pestañas de evidencia (`EvidenciaContrato.tsx`) usan la `Tabla` del kit (§14.1).
 *
 * Server component; `ContratoEnVivo` y `Redact` son islas de cliente. Cifras de cabecera
 * compactas con el monto exacto como contexto; en tablas, soles completos (lib/formato, §10.3).
 */

import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Building2, Clock, MapPin, ShieldAlert } from "lucide-react";
import { ContratoEnVivo } from "@/components/auditoria/ContratoEnVivo";
import { ResultadoAnalisis } from "@/components/auditoria/ResultadoAnalisis";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { PersonName, Ruc } from "@/components/Redact";
import { NotaPrivacidad } from "@/components/privacidad/NotaPrivacidad";
import { Ayuda, EncabezadoPagina, FuenteDato, Migas, Pestanas } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { EstadoContratoPill } from "./ContratosLista";
import { OCDS, dia, monto, pestanasEvidencia } from "./EvidenciaContrato";
import { recortar, limpiarObjeto } from "./recortar";
import { OtrosContratosEntidad } from "./OtrosContratosEntidad";
import { LineaTiempoProceso } from "./LineaTiempoProceso";
import { EntidadEnVigia } from "./EntidadEnVigia";
import { CrucesProveedor } from "./CrucesProveedor";
import type { ContratoResumen } from "@/lib/contratos";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { FASES } from "@/lib/auditoria";
import type { CatalogoReglas } from "@/lib/revision";
import { fecha, fechaCorta, numero, oracion, solesCompacto } from "@/lib/formato";
import {
  adjudicacionesVigentes, cambioDeGanador, esPersonaNatural, etapaLabel, motivoLabel, tipoLabel, validacionLabel,
  type ContratoDetalle as Detalle,
} from "@/lib/contratos";
import { cn } from "@/lib/utils";
import { tituloNatural } from "@/lib/landing";

/** Qué se analiza hoy, tal como lo informa la API (`procesamientoActivo` del resumen de procesamientos). */
export interface AlcanceActivo {
  tipos_activos?: string[];
  etapas_activas?: string[];
  nota?: string;
}

/** Cifra de cabecera: compacta, como en toda tarjeta (§10.3). En otra moneda, el número entero con su código. */
function cifra(n: number, moneda: string | null): string {
  return moneda && moneda !== "PEN" ? `${moneda} ${numero(n)}` : solesCompacto(n);
}

/** El monto exacto como contexto de la cifra compacta; nada si la compacta ya es exacta. */
function exacto(n: number, moneda: string | null): string | null {
  const completo = monto(n, moneda);
  return completo === cifra(n, moneda) ? null : completo;
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

export function ContratoDetalle({
  c,
  alcance = null,
  catalogo = {},
  seccion,
  relacionados = null,
  entidadEnVigia = null,
  parecidos = null,
  vistas = null,
}: {
  c: Detalle;
  /** El selector de vistas del contrato (ficha · dictamen · en vivo): arriba de todo, como en las otras dos vistas. */
  vistas?: ReactNode;
  alcance?: AlcanceActivo | null;
  catalogo?: CatalogoReglas;
  /** Otros contratos de la misma entidad (solo en fichas cortas): hasta 5 y el total de la entidad. */
  relacionados?: Llega<{ contratos: ContratoResumen[]; total: number } | null>;
  /** Cifras de la entidad que contrata (publicados, leídos, riesgo medio o alto, esperando lectura). */
  entidadEnVigia?: Llega<{ total: number; leidos: number; conSenales: number; esperando: number; listos?: number } | null>;
  /** Contratos del mismo tipo en la misma provincia, de otras entidades (con qué comparar este). */
  parecidos?: Llega<{ contratos: ContratoResumen[]; total: number; provincia: string | null } | null>;
  /** La pestaña abierta al cargar (`?seccion=` de la URL). */
  seccion?: string;
}) {
  const regionId = c.ubigeo ? UBIGEO_REGION[c.ubigeo.slice(0, 2)] : undefined;
  const mapaHref = regionId ? `/app/mapa?region=${regionId}&tab=cola${c.ubigeo && c.ubigeo.length === 6 ? `&ubigeo=${c.ubigeo}` : ""}` : "/app/mapa";
  // En revisión humana se dice "En revisión" y nada más (DESIGN_SYSTEM.md §10.4): ni señales ni
  // comparaciones de precio del análisis, que son los montos que la lectura cuestionaría.
  const enRevision = c.alerta?.estado === "revision";
  // Lo adjudicado es la suma de las adjudicaciones VIGENTES del registro (una buena pro que pasó a otro postor no se
  // suma dos veces); el referencial, lo presupuestado.
  const adjudicado = adjudicacionesVigentes(c).reduce((s, a) => s + (a.montoPen ?? 0), 0) || null;
  const cambio = cambioDeGanador(c);
  // El cruce "otro_postor" dice lo mismo que el aviso de cambio de ganador: en la ficha va una sola vez, en el aviso.
  const cruces = (c.cruces ?? []).filter((x) => !(cambio && x.tipo === "otro_postor"));

  // Dos columnas desde lg. Izquierda: qué se contrata, las cifras y las pestañas (el Resumen abre con la lectura y
  // sus señales). Derecha, siempre visible y pegada arriba: los datos del proceso, su línea de tiempo, qué partes del
  // análisis aplican y más contratos de la misma entidad. Así la primera pantalla se llena con datos reales.
  // Lo de la entidad y la provincia llega después (streaming): no frena la ficha.
  const otros =
    relacionados && c.entidadRuc ? (
      <Esperar p={relacionados}>
        {(r) =>
          r && r.contratos.length > 0 ? (
            <OtrosContratosEntidad entidad={c.entidad} entidadRuc={c.entidadRuc!} contratos={r.contratos} total={r.total} />
          ) : null
        }
      </Esperar>
    ) : null;
  // En una ficha corta (sin lectura) la columna izquierda es una línea: los contratos de la entidad van ahí, con ancho
  // para leerse; con la lectura hecha, la izquierda ya es larga y esa lista va en la columna lateral.
  const otrosAbajo = c.estadoProcesamiento !== "procesado";
  const resumen = (
    <div className="space-y-5">
      <AnalisisCard c={c} alcance={alcance} />
      {otrosAbajo && otros}
    </div>
  );

  const pestanas = [{ clave: "resumen", etiqueta: "Resumen", contenido: resumen }, ...pestanasEvidencia({ c, enRevision, catalogo })];

  return (
    <>
      {vistas && <div className="mb-4">{vistas}</div>}
      <Migas
        items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Contratos", href: "/app/contratos" }, { etiqueta: `Contrato ${c.codigo ?? c.ocid}` }]}
        pestanas={{ primera: "resumen", activa: seccion ?? "resumen", etiquetas: Object.fromEntries(pestanas.map((p) => [p.clave, p.etiqueta])) }}
      />

      <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {/* 1. Identidad: qué se contrata, su código, quién compra y dónde; debajo, sus chips. */}
          <div className="space-y-3">
            <EncabezadoPagina titulo={<TituloContrato texto={c.titulo ? oracion(limpiarObjeto(c.titulo)) : "Contrato sin objeto registrado"} />} bajada={<LineaIdentidad c={c} mapaHref={mapaHref} />} />
            <ul className="flex flex-wrap items-center gap-1.5" aria-label="Tipo, etapa y estado de lectura">
              <li><span className="pill border-transparent bg-paperDeep text-ink">{tipoLabel(c.tipo) ?? "Tipo sin clasificar"}</span></li>
              <li><span className="pill border-line text-inkSoft">{etapaLabel(c.etapa) ?? "Etapa sin clasificar"}</span></li>
              {c.modalidad && <li><span className="pill border-line text-inkSoft">{c.modalidad}</span></li>}
              <li>{enRevision ? <EstadoPill estado="revision" /> : <EstadoContratoPill estado={c.estadoProcesamiento} operativo={c.estadoOperativo} />}</li>
            </ul>
          </div>

          {/* 2. Lo que importa del objeto: cuánto y cuándo. */}
          <Indicadores items={indicadoresDe(c, adjudicado)} apilado />

          {/* 2a. La buena pro pasó a otro postor (OCDS + CONOSCE): lo que explica cifras que no cuadran. */}
          {cambio && <CambioGanador c={c} cambio={cambio} />}

          {/* 2b. El ganador en otros registros (ONPE, JNE, visitas, penalidades, sanciones): datos, no lectura. */}
          {cruces.length > 0 && (
            <CrucesProveedor cruces={cruces} varios={new Set(cruces.map((x) => x.rucProveedor)).size > 1} />
          )}

          {/* 3. Resumen y evidencia oficial, una pestaña por sección (§14.3). */}
          <Pestanas
            etiqueta="Secciones del contrato"
            activa={seccion}
            pestanas={pestanas}
          />
          <NotaPrivacidad />
        </div>

        <aside className="space-y-5 lg:sticky lg:top-4" aria-labelledby="datos-proceso">
          <DatosProceso c={c} />
          <LineaTiempoProceso c={c} />
          {entidadEnVigia && c.entidadRuc && (
            <Esperar p={entidadEnVigia}>{(e) => (e ? <EntidadEnVigia ruc={c.entidadRuc!} {...e} /> : null)}</Esperar>
          )}
          {/* Con procesamiento en vivo los carriles ya muestran qué agente aplica y cuál se omitió. */}
          {!c.procesamiento && <ClasificacionCard c={c} />}
          {!otrosAbajo && otros}
          {parecidos && (
            <Esperar p={parecidos}>
              {(pr) =>
                pr && pr.contratos.length > 0 && pr.provincia ? (
                  <OtrosContratosEntidad
                    entidad={c.entidad}
                    entidadRuc={c.entidadRuc ?? ""}
                    contratos={pr.contratos}
                    total={pr.total}
                    titulo={`${tipoLabel(c.tipo) ?? "Contratos"} de otras entidades de la provincia`}
                    verHref={`/app/contratos?ubigeo=${pr.provincia}&tipo=${c.tipo ?? ""}`}
                    idSeccion="contratos-parecidos"
                    compacta
                  />
                ) : null
              }
            </Esperar>
          )}
        </aside>
      </div>
    </>
  );
}

/** El objeto del contrato, completo; si es largo (los hay de 300 caracteres) baja de tamaño en vez de ocupar siete líneas. */
function TituloContrato({ texto }: { texto: string }) {
  const largo = texto.length;
  return (
    <span className={largo > 150 ? "block text-[19px] leading-snug sm:text-[21px]" : largo > 80 ? "block text-[23px] leading-snug sm:text-[26px]" : undefined}>
      {texto}
    </span>
  );
}

/** Código, entidad y zona en una línea: la bajada del encabezado. */
function LineaIdentidad({ c, mapaHref }: { c: Detalle; mapaHref: string }) {
  const enlace = "inline-flex min-h-6 items-center gap-1.5 text-ink underline-offset-2 hover:text-granate hover:underline";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
      <span>
        Código SEACE{" "}
        <span className="font-mono text-ink" translate="no">
          {c.codigo}
        </span>
      </span>
      {c.entidadRuc ? (
        <Link href={`/entidad/${c.entidadRuc}`} className={enlace}>
          <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> {c.entidad ? tituloNatural(c.entidad) : c.entidadRuc}
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> {c.entidad ? tituloNatural(c.entidad) : "Entidad no identificada"}
        </span>
      )}
      {c.zona && (
        <Link href={mapaHref} className={enlace}>
          <MapPin size={14} className="shrink-0 text-mute" aria-hidden /> {c.zona}
        </Link>
      )}
    </span>
  );
}

/** "Sin dato" como cifra: en `mute` y más chico, para que no se lea como un número (§10.2). */
function SinDato({ texto = "Sin dato" }: { texto?: string }) {
  return <span className="text-[18px] font-semibold text-mute">{texto}</span>;
}

/** Las cifras del contrato: número compacto → qué es → el monto exacto o la fecha que lo acompaña. */
function indicadoresDe(c: Detalle, adjudicado: number | null): Indicador[] {
  const nItems = c.items.length;
  const nAdjudicaciones = adjudicacionesVigentes(c).length;
  const reemplazadas = (c.adjudicaciones ?? []).length - nAdjudicaciones;
  const conOferta = (c.postoresDetalle ?? []).filter((p) => p.montoOferta != null).length;
  const unir = (xs: (string | null | false)[]) => xs.filter(Boolean).join(" ") || undefined;
  return [
    {
      valor: c.montoPen ? cifra(c.montoPen, c.moneda) : <SinDato />,
      etiqueta: "valor referencial",
      contexto: c.montoPen ? unir([exacto(c.montoPen, c.moneda), nItems > 1 && `en ${numero(nItems)} ítems`]) : "el registro no lo publica",
    },
    {
      valor: adjudicado ? cifra(adjudicado, c.moneda) : <SinDato texto="Sin adjudicar" />,
      etiqueta: "monto adjudicado",
      contexto: adjudicado
        ? unir([
            exacto(adjudicado, c.moneda),
            nAdjudicaciones > 1 && `en ${numero(nAdjudicaciones)} adjudicaciones`,
            reemplazadas > 0 && `(sin la${reemplazadas > 1 ? "s" : ""} buena${reemplazadas > 1 ? "s" : ""} pro reemplazada${reemplazadas > 1 ? "s" : ""})`,
          ])
        : undefined,
    },
    {
      valor: c.fecha ? fechaCorta(c.fecha) : <SinDato texto="Sin fecha" />,
      etiqueta: "convocatoria",
      contexto: `buena pro: ${c.fechaBuenaPro ? fechaCorta(dia(c.fechaBuenaPro)) : "sin fecha"}`,
    },
    {
      valor: c.postores != null ? numero(c.postores) : <SinDato />,
      etiqueta: c.postores === 1 ? "postor" : "postores",
      contexto: conOferta > 0 ? `${numero(conOferta)} con oferta leída del expediente` : undefined,
    },
  ];
}

/** Datos del proceso (columna lateral, §14.2): quién ganó, la descripción y los códigos del registro. */
function DatosProceso({ c }: { c: Detalle }) {
  // Si la buena pro pasó a otro postor, "quién ganó" es con quien quedó (CONOSCE), no la primera adjudicación del OCDS.
  const queda = cambioDeGanador(c)?.queda[0];
  const proveedor = queda?.proveedor ?? c.proveedor;
  const proveedorRuc = queda?.proveedorRuc ?? c.proveedorRuc;
  const natural = esPersonaNatural(proveedorRuc);
  const descripcion = c.descripcion && c.descripcion !== c.titulo ? c.descripcion : null;
  return (
    <div className="rounded-2xl border border-line bg-paper">
      <h2 id="datos-proceso" className="px-4 pt-3.5 text-[15px] font-semibold text-ink">
        Datos del proceso
      </h2>
      <dl className="space-y-3 px-4 pb-3.5 pt-2.5 text-sm">
        <Dato k="Quién ganó">
          {proveedor ? (
            <>
              {/* El proveedor del OCDS viene en orden SUNAT (apellidos primero). */}
              <span className="font-semibold">{natural ? <PersonName name={proveedor} orden="sunat" /> : proveedor}</span>
              {proveedorRuc && (
                <span className="block font-mono text-[12px] text-mute">
                  RUC <Ruc value={proveedorRuc} />
                </span>
              )}
              {queda && <span className="block text-[12px] text-mute">Se le adjudicó después de otro postor (CONOSCE)</span>}
            </>
          ) : (
            <span className="text-mute">Sin adjudicar todavía</span>
          )}
        </Dato>
        {descripcion && (
          <Dato k="Descripción">
            {/* div y no span: la descripción larga se pliega en un <details>. */}
            <div className="text-[13px] leading-relaxed">
              <Descripcion texto={descripcion} />
            </div>
          </Dato>
        )}
        {c.nomenclatura && (
          <Dato k="Nomenclatura">
            <span className="break-all font-mono text-[13px]">{c.nomenclatura}</span>
          </Dato>
        )}
        {c.ocid !== c.codigo && (
          <Dato k="OCID">
            <span className="break-all font-mono text-[13px] text-inkSoft">{c.ocid}</span>
          </Dato>
        )}
      </dl>
      <FuenteDato fuente={OCDS} className="border-t border-line px-4 py-2" />
    </div>
  );
}

function Dato({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-mute">{k}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

// ─── Estado de la lectura ────────────────────────────────────────────────────

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
    // Sin caja: un estado de una línea no merece una tarjeta de 700 x 100 px. Filete a la izquierda.
    <section className="border-l-2 border-line py-1 pl-4">
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
    // La tarjeta ocupa la columna principal: la versión ancha pone el puntaje junto al resumen.
    return (
      <div className="space-y-2">
        <ResultadoAnalisis resultado={c.alerta} ocid={c.ocid} sharePath={`/app/contratos/${encodeURIComponent(c.ocid)}`} />
        {c.alerta.analizadoEn && <p className="text-[12px] text-mute">Leído el {fecha(dia(c.alerta.analizadoEn))}</p>}
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
            Pedido {c.pedidoDescarga.estado === "descargando" ? "en descarga" : "en cola para esta noche"}, solicitado el {fechaCorta(dia(c.pedidoDescarga.solicitadoAt))}.
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
        <EnlaceAccion href={`/app/financiar/${c.ubigeo}`} flecha className="mt-4 w-full sm:w-auto">
          Financiar la lectura de {c.zona ?? "esta zona"}
        </EnlaceAccion>
      )}
    </TarjetaEstado>
  );
}

function ClasificacionCard({ c }: { c: Detalle }) {
  const agentes = c.clasificacion.agentesAplicables;
  if (!agentes?.length && !c.clasificacion.clasificadoAt) return null;
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1">
        <h2 className="text-[13px] font-semibold text-ink">Qué partes del análisis aplican</h2>
        <Ayuda titulo="¿Por qué estas partes?">
          Dependen del tipo de contrato y de su etapa. Las que no aparecen no aplican a este contrato.
        </Ayuda>
      </div>
      {agentes?.length ? (
        <ul className="flex flex-wrap gap-1">
          {FASES.filter((f) => agentes.includes(f.key)).map((f) => (
            <li key={f.key} className="pill border-line bg-paper text-ink">{f.label}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-mute">Ninguna para esta combinación de tipo y etapa.</p>
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

/**
 * La descripción del registro, que a veces es un párrafo entero. Hasta ~2 líneas
 * se muestra tal cual; más larga, el comienzo y "Ver completa" (§10.7): el dato
 * sigue ahí, a un clic, sin empujar el resto hacia abajo.
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

/**
 * La buena pro pasó a otro postor sobre los mismos ítems: el OCDS guarda las dos adjudicaciones y CONOSCE registra a
 * quién se le adjudicó al final. Pasa cuando el ganador no firma o pierde la buena pro y se adjudica al siguiente en el
 * orden de prelación, con su propia oferta. Es un dato, no una conclusión.
 */
function CambioGanador({ c, cambio }: { c: Detalle; cambio: NonNullable<ReturnType<typeof cambioDeGanador>> }) {
  const { original, queda, diferencia, porcentaje } = cambio;
  const nombre = (a: { proveedor: string | null; proveedorRuc: string | null }) =>
    a.proveedor ? (esPersonaNatural(a.proveedorRuc) ? <PersonName name={a.proveedor} orden="sunat" /> : a.proveedor) : "otro postor";
  const sube = diferencia != null && diferencia > 0;
  return (
    <section aria-labelledby="cambio-ganador" className={cn("rounded-2xl border bg-paper px-4 py-3.5", sube ? "border-amber/40" : "border-line")}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="cambio-ganador" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <ShieldAlert size={16} className={sube ? "text-amberTexto" : "text-mute"} aria-hidden />
          La buena pro pasó a otro postor
        </h2>
        <Ayuda titulo="¿Por qué hay dos adjudicaciones?">
          El registro OCDS guarda la buena pro original y la que la reemplazó sobre los mismos ítems; CONOSCE registra a quién se
          le adjudicó al final. Suele pasar cuando el ganador no firma el contrato o pierde la buena pro y se adjudica al siguiente
          postor, con su propia oferta. El motivo está en el expediente.
        </Ayuda>
      </div>
      <p className="mt-2 text-sm text-ink">
        La buena pro fue primero para <span className="font-semibold">{nombre(original)}</span>
        {original.montoPen != null && <> por {monto(original.montoPen, c.moneda)}</>}; según CONOSCE quedó con{" "}
        {queda.map((q, i) => (
          <span key={q.id ?? i}>
            {i > 0 && ", "}
            <span className="font-semibold">{nombre(q)}</span>
            {q.montoPen != null && <> por {monto(q.montoPen, c.moneda)}</>}
          </span>
        ))}
        {diferencia != null && diferencia !== 0 && (
          <>
            : <span className={cn("font-semibold", sube && "text-amberTexto")}>{sube ? "+" : "−"}{monto(Math.abs(diferencia), c.moneda)}</span>
            {porcentaje != null && <> ({sube ? "+" : "−"}{numero(Math.abs(Math.round(porcentaje)))} %)</>}
          </>
        )}
        .
      </p>
      <p className="mt-1.5 text-[12px] text-mute">Fuente: registro OCDS del OECE y CONOSCE · adjudicaciones</p>
    </section>
  );
}

/** Un dato que puede llegar ya resuelto o como promesa (se pinta por streaming cuando llega). */
type Llega<T> = T | Promise<T>;

/** Pinta `children(valor)` cuando la promesa se resuelve, dentro de su propio <Suspense> (sin esqueleto: es apoyo). */
function Esperar<T>({ p, children }: { p: Llega<T>; children: (v: T) => ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Resuelto p={p}>{children}</Resuelto>
    </Suspense>
  );
}

async function Resuelto<T>({ p, children }: { p: Llega<T>; children: (v: T) => ReactNode }) {
  return <>{children(await p)}</>;
}
