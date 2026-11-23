"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight, ChevronRight, Database, FileText, HardHat, Newspaper, Package, Pen, Workflow, type LucideIcon,
} from "lucide-react";
import { BloqueDetalle, CuerpoDetalle, EnlaceFuente, Nota } from "@/components/patrones";
import { PASOS, pasoDeClave, TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { Dato } from "@/components/ui/Dato";
import { Panel } from "@/components/ui/Panel";
import { tipoDocLabel } from "@/lib/contratos";
import {
  CLARIDAD_ONPE, CONOSCE_BUSCADOR, CONSULTA_RUC_SUNAT, DATASET_SANCIONADOS, PLATAFORMA_JNE, VISITAS_EN_LINEA, fichaRnp, proveedorOece,
} from "@/lib/fuentes";
import { fechaConAnio, numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import { fechaDossier, montoDossier, type EstadoCorrida } from "../dossier";
import type { ApiResult } from "../types";
import type { TabKey } from "../sections/PanelesDossier";
import { AvisoSeccion } from "../sections/AvisoSeccion";
import { EnlaceDocumento } from "../sections/EnlaceDocumento";
import { oeceProcesoUrl } from "../utils";
import { resumenDelDictamen } from "./historia";
import { conCifras } from "./cifrasEnTexto";
import { ENLACE_RELATO } from "./PorQueLlama";

// ─── Lo que dice el análisis ──────────────────────────────────────────────────

/** Abreviaturas tras las que un punto no cierra la oración («N.° 02», «D.S. 009», «Art. 5», «S.A.»). */
const ABREVIATURA = /(?:\b(?:art|arts|inc|lit|num|núm|n|nro|no|sr|sra|dr|dra|ing|lic|av|jr|cía|ej|pág|págs|vs|aprox|etc)|\b\p{Lu}|°)\.$/iu;

/** Un texto en oraciones, sin partir en una abreviatura ni en una cifra («S/ 1,182,257.76»). */
function oracionesDe(texto: string): string[] {
  const out: string[] = [];
  let actual = "";
  for (const trozo of texto.split(/(?<=[.!?])\s+(?=[\p{Lu}¿¡«"(])/u)) {
    actual = actual ? `${actual} ${trozo}` : trozo;
    if (ABREVIATURA.test(actual)) continue;
    out.push(actual);
    actual = "";
  }
  if (actual) out.push(actual);
  return out;
}

/** Hasta dónde llega «en corto»: las primeras oraciones del resumen que entran en este largo. */
const MAX_EN_CORTO = 330;

/**
 * «Lo que dice el análisis» (pedido del usuario del 2026-11-16: «que no sea un muro de texto»). El resumen ejecutivo del
 * dictamen era un párrafo de 900 caracteres con seis cifras adentro. Ahora:
 *
 *   · el titular que le puso el análisis (el «## » pegado al título, ver `titularDelDictamen`);
 *   · «En corto»: las primeras oraciones del resumen, con sus cifras realzadas; el resto, punto por punto, a pedido;
 *   · «Leer el dictamen completo» (su pestaña).
 */
export function LoQueDice({
  dict,
  corrida,
  modelo,
  abrirTab,
}: {
  dict: string;
  corrida: EstadoCorrida;
  modelo?: string | null;
  abrirTab: (t: TabKey) => void;
}) {
  const { titulo, parrafos } = useMemo(() => resumenDelDictamen(dict), [dict]);
  const { corto, resto } = useMemo(() => {
    const oraciones = parrafos.flatMap(oracionesDe);
    const primeras: string[] = [];
    let largo = 0;
    for (const o of oraciones) {
      if (primeras.length > 0 && largo + o.length > MAX_EN_CORTO) break;
      primeras.push(o);
      largo += o.length;
    }
    return { corto: primeras, resto: oraciones.slice(primeras.length) };
  }, [parrafos]);
  const [abierto, setAbierto] = useState(false);

  if (!dict.trim() || parrafos.length === 0) {
    return (
      <AvisoSeccion titulo="Este análisis no tiene dictamen escrito" icono={<Pen size={16} aria-hidden />}>
        {corrida.corrioDictamen ? "La redacción del dictamen corrió, pero no guardó un texto." : "La redacción del dictamen no llegó a correr en este análisis."}{" "}
        Las señales, los ítems y los documentos que sí se leyeron están en las otras pestañas.
      </AvisoSeccion>
    );
  }

  // Sin las cifras del proceso (valor referencial, adjudicado, participantes, señales): la cabecera del contrato y el
  // veredicto ya las dicen arriba, y aquí eran una tercera vez (2026-11-23, «secciones que aparecen una vez más»). Las del
  // propio resumen van realzadas dentro del texto.
  return (
    <div className="space-y-4">
      {titulo && (
        <p className="max-w-[68ch] break-words font-display text-bloque font-bold leading-snug text-ink text-balance">{redactDnis(titulo)}</p>
      )}

      {/* «En corto» abre la frase, en negrita: antes era un rótulo en mayúsculas encima del párrafo. */}
      <p className="max-w-[68ch] break-words text-cuerpo leading-relaxed text-ink text-pretty">
        <strong className="font-semibold">En corto: </strong>
        {conCifras(corto.join(" "))}
      </p>

      {resto.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-paperEdge hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
          >
            <ChevronRight size={14} className={cn("shrink-0 text-mute transition-transform duration-rapido", abierto && "rotate-90")} aria-hidden />
            {abierto ? "Ocultar el resto del resumen" : `El resto del resumen, en ${plural(resto.length, "punto", "puntos")}`}
          </button>
          {abierto && (
            <ul className="mt-3 space-y-2">
              {resto.map((o, i) => (
                <li key={i} className="flex gap-2.5">
                  <ChevronRight size={14} className="mt-1 shrink-0 text-mute" aria-hidden />
                  <span className="min-w-0 max-w-[68ch] break-words text-dato leading-relaxed text-inkSoft text-pretty">{conCifras(o)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-rotulo text-mute">
        <span>Resumen del dictamen, redactado automáticamente{modelo ? ` (${modelo})` : ""} con la evidencia del análisis.</span>
        <button type="button" onClick={() => abrirTab("dictamen")} className={ENLACE_RELATO}>
          Leer el dictamen completo <ChevronRight size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ─── De dónde sale cada dato ──────────────────────────────────────────────────

/** Las fuentes que no son registros (el redactor, los jueces): no se listan como «registros que se cruzaron». */
const SIN_FUENTE_PROPIA = new Set(["report_writer", "self_eval"]);

interface FichaRegistro {
  /** Qué es ese registro, en una oración. */
  queEs: string;
  /** Quién lo publica. */
  de?: string;
  /** Su enlace oficial: el de este proceso o este proveedor si se puede armar; si no, el portal. */
  enlace?: (c: { ocid: string | null; rucGanador: string | null }) => { href: string; texto: string } | null;
}

/**
 * Qué es cada registro que nombra el catálogo de agentes (components/agentes/catalogo, `FUENTE`) y dónde consultarlo.
 * Los enlaces salen de lib/fuentes.ts: ninguna dirección se escribe aquí. Un registro sin portal único (la web abierta,
 * las reglas de Vigía) no lleva enlace.
 */
const REGISTROS: Record<string, FichaRegistro> = {
  "Registro público del proceso (OECE)": {
    queEs: "El expediente electrónico del proceso en Contrataciones Abiertas: sus etapas, fechas, participantes, documentos, la buena pro y el contrato.",
    de: "Organismo Especializado para las Contrataciones Públicas Eficientes (OECE, antes OSCE)",
    enlace: ({ ocid }) => ({ href: oeceProcesoUrl(ocid), texto: ocid ? "Ver este proceso en el OECE" : "Abrir Contrataciones Abiertas" }),
  },
  OECE: {
    queEs: "Los registros del OECE sobre el proveedor: sus procesos, sus sanciones y sus penalidades.",
    de: "OECE",
    enlace: ({ rucGanador }) => ({ href: proveedorOece(rucGanador), texto: "Ver los procesos del proveedor en el OECE" }),
  },
  SUNAT: {
    queEs: "El padrón de contribuyentes: si el RUC está activo y habido, su giro, su domicilio fiscal y desde cuándo opera.",
    de: "Superintendencia Nacional de Aduanas y de Administración Tributaria",
    enlace: () => ({ href: CONSULTA_RUC_SUNAT, texto: "Consulta RUC de la SUNAT" }),
  },
  "Sanciones del OECE": {
    queEs: "La lista de proveedores inhabilitados o multados por el Tribunal de Contrataciones, con las fechas de cada sanción.",
    de: "OECE (datos abiertos)",
    enlace: () => ({ href: DATASET_SANCIONADOS, texto: "Proveedores sancionados (datos abiertos)" }),
  },
  "Documentos publicados en el SEACE": {
    queEs: "Los archivos que la entidad subió al proceso: bases, pliego de consultas, acta de buena pro y contrato.",
    de: "SEACE (lo administra el OECE)",
    enlace: ({ ocid }) => ({ href: oeceProcesoUrl(ocid), texto: "Ver los documentos del proceso en el OECE" }),
  },
  "Opiniones jurídicas del OECE": { queEs: "Las opiniones con que el OECE interpreta la ley de contrataciones: Vigía las cita para sostener una señal.", de: "OECE" },
  "Opiniones del OECE": { queEs: "Las opiniones con que el OECE interpreta la ley de contrataciones: Vigía las cita para sostener una señal.", de: "OECE" },
  "Búsqueda de precios en vivo": {
    queEs: "Precios publicados por tiendas y catálogos al momento del análisis, para comparar cada ítem. Cada precio queda con su enlace en «Ítems y mercado».",
  },
  "Portales oficiales": { queEs: "Páginas de entidades públicas con información del proveedor o de la entidad. Cada hallazgo queda con su enlace en «Proveedor y red»." },
  "Web abierta": { queEs: "Búsquedas en la web sobre el proveedor. Lo que se encontró queda con su enlace en «Proveedor y red»." },
  "Prensa peruana": { queEs: "Notas de medios peruanos sobre el proveedor, la entidad o lo comprado. Cada nota queda con su enlace en «Prensa»." },
  "Autoridades y actos resolutivos de la entidad": {
    queEs: "Quién dirige la entidad y qué funcionarios de confianza tiene designados, según el JNE y las resoluciones que la entidad publica.",
    enlace: () => ({ href: PLATAFORMA_JNE, texto: "Plataforma electoral del JNE" }),
  },
  RNP: {
    queEs: "El Registro Nacional de Proveedores: los socios, representantes y directivos que cada proveedor declaró.",
    de: "OECE",
    enlace: ({ rucGanador }) => ({ href: fichaRnp(rucGanador), texto: "Ficha del proveedor en el RNP" }),
  },
  ONPE: {
    queEs: "Los aportes a campañas y organizaciones políticas que declaran los partidos.",
    de: "Oficina Nacional de Procesos Electorales",
    enlace: () => ({ href: CLARIDAD_ONPE, texto: "Portal Claridad de la ONPE" }),
  },
  JNE: {
    queEs: "Las candidaturas y las autoridades electas de cada elección.",
    de: "Jurado Nacional de Elecciones",
    enlace: () => ({ href: PLATAFORMA_JNE, texto: "Plataforma electoral del JNE" }),
  },
  PEPs: { queEs: "La lista de personas expuestas políticamente: quienes ocupan o han ocupado cargos públicos de alto nivel." },
  "Registro de visitas": {
    queEs: "Las visitas que cada entidad registra: quién entró, a qué oficina y cuándo.",
    enlace: () => ({ href: VISITAS_EN_LINEA, texto: "Registro de visitas en línea" }),
  },
  "Reglas fijas de cada tipo de contrato": { queEs: "Las reglas de Vigía para cada tipo de contrato (bienes, servicios, obras): están en «Reglas evaluadas», en la pestaña Señales." },
  "CONOSCE (OECE)": {
    queEs: "El buscador de contrataciones del OECE: las buenas pro y las órdenes de cada proveedor en todo el Estado.",
    de: "OECE",
    enlace: () => ({ href: CONOSCE_BUSCADOR, texto: "Buscador CONOSCE" }),
  },
};

type ClaveParte = "documentos" | "items" | "obra" | "prensa" | "trace";
type Abierto = { tipo: "parte"; clave: ClaveParte } | { tipo: "registro"; nombre: string } | null;

const CAJA_FUENTE =
  "flex h-full w-full items-start gap-3 rounded-2xl border border-line bg-paper p-3.5 text-left transition-colors duration-rapido hover:border-paperEdge hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [.tarjeta_&]:rounded-xl [.tarjeta_&]:border-transparent [.tarjeta_&]:bg-paperSoft [.tarjeta_&]:hover:border-transparent [.tarjeta_&]:hover:bg-paperDeep";
const BOTON_PIE =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full bg-granate px-4 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate";

/**
 * «De dónde sale cada dato». Antes cada caja cambiaba de pestaña y los registros eran rótulos que no se podían tocar
 * (pedido del usuario del 2026-11-16: «al hacer clic en una fuente debe abrirse una ventana flotante lateral… para no
 * arruinar la navegación»). Ahora todo abre el panel lateral del kit, sobre la página:
 *
 *   · cada parte del detalle (documentos, ítems, prensa, cómo se hizo) muestra ahí lo que trae, con sus enlaces, y un
 *     botón para ir a su pestaña si se quiere el detalle entero;
 *   · cada registro que se cruzó dice qué es, quién lo publica, qué se consultó en él (qué agentes lo usaron y para
 *     qué) y su enlace oficial, el de este proceso o este proveedor cuando se puede armar.
 */
export function DeDondeSale({
  result,
  conv,
  corrida,
  ocidContrato,
  nDocs,
  nItems,
  nEvents,
  abrirTab,
}: {
  result: ApiResult;
  conv: any;
  corrida: EstadoCorrida;
  ocidContrato: string | null;
  nDocs: number;
  nItems: number;
  nEvents: number;
  abrirTab: (t: TabKey) => void;
}) {
  const r = result as any;
  const noticias: any[] = result.news_research?.noticias || [];
  const sup = r.supervision_obra;
  const obra = r.obra_ejecucion;
  const obras: any[] = (sup?.enlazada && sup.obras) || (obra?.enlazada && obra.obras) || [];
  const analizadoEn = (result._bridge_meta?.analizado_en as string | undefined) ?? null;
  const ocid: string | null = conv.ocid || conv.codigo || ocidContrato;
  const rucGanador: string | null = r.proveedor_ruc ?? null;

  const fuentes = useMemo(() => {
    const set = new Set<string>();
    for (const k of corrida.agentes) if (!SIN_FUENTE_PROPIA.has(k)) for (const f of pasoDeClave(k)?.fuentes ?? []) set.add(f);
    // El historial del proveedor sale del CONOSCE aunque ningún agente lo nombre.
    if (r.expediente_proveedor?.historial) set.add("CONOSCE (OECE)");
    return [...set];
  }, [corrida.agentes, r.expediente_proveedor]);

  const [abierto, setAbierto] = useState<Abierto>(null);
  // Los registros, de a 10: con 18 chips el bloque ocupaba media pantalla (regla de las listas de 10).
  const [todosRegistros, setTodosRegistros] = useState(false);
  const registrosVisibles = todosRegistros ? fuentes : fuentes.slice(0, 10);
  // Lo último abierto queda en el panel mientras se cierra (su animación): sin él se vaciaría antes de irse.
  const ultimo = useRef<Abierto>(null);
  if (abierto) ultimo.current = abierto;
  const enPanel = ultimo.current;
  const irA = (t: TabKey) => {
    setAbierto(null);
    abrirTab(t);
  };

  const partes: { clave: ClaveParte; icono: LucideIcon; titulo: string; texto: string }[] = [
    {
      clave: "documentos",
      icono: FileText,
      titulo: "Los documentos del expediente",
      texto: nDocs > 0 ? `${plural(nDocs, "documento publicado", "documentos publicados")} en el SEACE, con lo que se leyó de ellos.` : "El registro OCDS no publica documentos para este proceso.",
    },
    {
      clave: "items",
      icono: Package,
      titulo: "Qué se compró y a qué precio",
      texto: nItems > 0 ? `${plural(nItems, "ítem", "ítems")}, con su precio frente a lo que pagó el Estado y al mercado.` : "Los ítems y la comparación de precios, si se hizo.",
    },
    ...(obras.length > 0
      ? [{ clave: "obra" as const, icono: HardHat, titulo: sup?.enlazada ? "La obra supervisada" : "La obra", texto: "Su avance y sus pagos en INFOBRAS." }]
      : []),
    {
      clave: "prensa",
      icono: Newspaper,
      titulo: "Lo que dice la prensa",
      texto: noticias.length > 0 ? `${plural(noticias.length, "noticia", "noticias")} de prensa peruana sobre el proveedor, la entidad o lo comprado.` : "Lo que buscó la revisión de prensa y si encontró algo.",
    },
    {
      clave: "trace",
      icono: Workflow,
      titulo: "Cómo se hizo este análisis",
      texto: corrida.hayTraza
        ? // La fecha con su año («5 nov. 2026»): la abreviatura del mes ya lleva punto y no puede cerrar la oración.
          `Corrieron ${corrida.agentes.length} de ${TOTAL_AGENTES} agentes${nEvents > 0 ? `, en ${numero(nEvents)} pasos registrados` : ""}${analizadoEn ? ` (leído el ${fechaConAnio(analizadoEn)})` : ""}.`
        : "Este análisis no guardó el registro de qué agentes corrieron.",
    },
  ];

  // ─── Lo que va en el panel, según qué se tocó ───
  let titulo = "";
  let descripcion: ReactNode = null;
  let cuerpo: ReactNode = null;
  let pie: ReactNode = null;
  if (enPanel?.tipo === "registro") {
    const ficha = REGISTROS[enPanel.nombre];
    const enlace = ficha?.enlace?.({ ocid, rucGanador }) ?? null;
    // Qué se consultó: los agentes de este análisis que cotejan contra ese registro, y para qué.
    const usaron = PASOS.filter((p) => corrida.agentes.includes(p.clave) && p.fuentes.includes(enPanel.nombre));
    titulo = enPanel.nombre;
    descripcion = "Un registro que este análisis cruzó";
    cuerpo = (
      <CuerpoDetalle>
        <BloqueDetalle titulo="Qué es este registro">
          <p>{ficha?.queEs ?? "Un registro público que el análisis consultó."}</p>
          {ficha?.de && (
            <p className="mt-1.5 text-meta text-inkSoft">
              <Dato tipo="entidad" nombre="Lo publica">
                {ficha.de}
              </Dato>
            </p>
          )}
        </BloqueDetalle>
        <BloqueDetalle titulo="Qué se consultó aquí">
          {usaron.length > 0 ? (
            <ul className="divide-y divide-line/70 rounded-xl border border-line">
              {usaron.map((p) => (
                <li key={p.clave} className="px-3.5 py-2.5">
                  <p className="text-dato font-semibold text-ink">{p.nombre}</p>
                  <p className="mt-0.5 text-meta leading-snug text-inkSoft">{p.que}</p>
                </li>
              ))}
            </ul>
          ) : enPanel.nombre === "CONOSCE (OECE)" ? (
            <p>Las buenas pro del proveedor en todo el Estado: cuántas ganó, por cuánto y a qué entidades. Están en «Proveedor y red».</p>
          ) : (
            <p className="text-mute">Este análisis no guardó qué agente lo consultó.</p>
          )}
        </BloqueDetalle>
        <BloqueDetalle titulo="Dónde comprobarlo">
          {enlace ? (
            <p>
              <EnlaceFuente href={enlace.href}>{enlace.texto}</EnlaceFuente>
            </p>
          ) : (
            <p className="text-mute">No tiene un portal único: cada dato que salió de aquí lleva su propio enlace en la pestaña donde se muestra.</p>
          )}
          <p className="mt-1.5 text-rotulo text-mute">El enlace se abre en otra pestaña: esta página queda como está.</p>
        </BloqueDetalle>
      </CuerpoDetalle>
    );
  } else if (enPanel?.tipo === "parte") {
    const parte = partes.find((p) => p.clave === enPanel.clave);
    titulo = parte?.titulo ?? "";
    descripcion = parte?.texto;
    if (enPanel.clave === "documentos") {
      const docs: any[] = result.documentos || [];
      cuerpo = (
        <CuerpoDetalle>
          <BloqueDetalle titulo={docs.length > 0 ? `Los ${docs.length} documentos del proceso` : "Los documentos del proceso"}>
            {docs.length > 0 ? (
              <ul className="divide-y divide-line/70 rounded-xl border border-line">
                {docs.map((d, i) => (
                  <li key={d.id ?? i} className="px-3.5 py-2.5">
                    <p className="text-dato font-medium text-ink">{d.titulo || "Documento sin título"}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-rotulo text-mute">
                      {d.tipo_ocds && <Dato tipo="documento" nombre="Tipo">{tipoDocLabel(d.tipo_ocds)}</Dato>}
                      {d.fecha && <Dato tipo="fecha" nombre="Publicado">{fechaDossier(d.fecha, true)}</Dato>}
                    </p>
                    {d.url && <EnlaceDocumento url={d.url} className="mt-1 text-meta" />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-mute">El registro del OECE no publica documentos para este proceso.</p>
            )}
          </BloqueDetalle>
          <BloqueDetalle titulo="De dónde salen">
            <p>
              Los publica la entidad en el SEACE. <EnlaceFuente href={oeceProcesoUrl(ocid)}>Ver el proceso en el OECE</EnlaceFuente>
            </p>
          </BloqueDetalle>
        </CuerpoDetalle>
      );
      pie = (
        <button type="button" onClick={() => irA("documentos")} className={BOTON_PIE}>
          Lo que se leyó de cada documento <ArrowRight size={14} aria-hidden />
        </button>
      );
    } else if (enPanel.clave === "items") {
      const items: any[] = (r.precios_internos?.items?.length ? r.precios_internos.items : result.items) || [];
      cuerpo = (
        <CuerpoDetalle>
          <BloqueDetalle titulo={items.length > 0 ? `Lo que se compró (${plural(items.length, "ítem", "ítems")})` : "Lo que se compró"}>
            {items.length > 0 ? (
              <ul className="divide-y divide-line/70 rounded-xl border border-line">
                {items.map((x, i) => (
                  <li key={i} className="px-3.5 py-2.5">
                    <p className="text-dato font-medium text-ink">{x.descripcion || `Ítem ${x.item ?? x.numero ?? i + 1}`}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-rotulo text-mute">
                      {x.cantidad != null && <span>{numero(Number(x.cantidad))} {x.unidad ?? ""}</span>}
                      {Number(x.precio_unitario) > 0 && <span className="font-mono tabular-nums text-inkSoft">{montoDossier(x.precio_unitario)} por unidad</span>}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-mute">El análisis no llegó a desglosar los ítems.</p>
            )}
          </BloqueDetalle>
          <BloqueDetalle titulo="Contra qué se comparó el precio">
            <ul className="space-y-1.5">
              <li className="flex gap-2">
                <Database size={15} className="mt-1 shrink-0 text-mute" aria-hidden />
                <span>Lo que pagaron otras entidades del Estado por el mismo código de bien y la misma unidad (base de Vigía, con datos del SEACE).</span>
              </li>
              <li className="flex gap-2">
                <Package size={15} className="mt-1 shrink-0 text-mute" aria-hidden />
                <span>Precios de mercado publicados al momento del análisis, cada uno con su enlace.</span>
              </li>
            </ul>
          </BloqueDetalle>
        </CuerpoDetalle>
      );
      pie = (
        <button type="button" onClick={() => irA("items")} className={BOTON_PIE}>
          Ver la comparación de precios <ArrowRight size={14} aria-hidden />
        </button>
      );
    } else if (enPanel.clave === "prensa") {
      const resumen: string | null = typeof result.news_research?.resumen_ejecutivo === "string" ? result.news_research.resumen_ejecutivo : null;
      cuerpo = (
        <CuerpoDetalle>
          <BloqueDetalle titulo={noticias.length > 0 ? `Las ${noticias.length} noticias encontradas` : "Lo que se encontró"}>
            {noticias.length > 0 ? (
              <ul className="divide-y divide-line/70 rounded-xl border border-line">
                {noticias.map((n, i) => (
                  <li key={i} className="px-3.5 py-2.5">
                    <p className="text-dato font-medium text-ink">{redactDnis(n.titulo || "Noticia sin título")}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-rotulo text-mute">
                      {n.medio && <span>{n.medio}</span>}
                      {n.fecha && <Dato tipo="fecha">{fechaDossier(n.fecha, true)}</Dato>}
                    </p>
                    {typeof n.url === "string" && /^https?:\/\//.test(n.url) && <EnlaceFuente href={n.url} className="mt-1 text-meta">Leer la nota</EnlaceFuente>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{resumen ? redactDnis(resumen) : "La revisión de prensa no encontró notas sobre el proveedor, la entidad o lo comprado."}</p>
            )}
          </BloqueDetalle>
          <Nota>Una nota de prensa es contexto: no prueba nada sobre este contrato si no lo nombra.</Nota>
        </CuerpoDetalle>
      );
      pie = (
        <button type="button" onClick={() => irA("prensa")} className={BOTON_PIE}>
          Abrir la pestaña Prensa <ArrowRight size={14} aria-hidden />
        </button>
      );
    } else if (enPanel.clave === "trace") {
      const corrieron = PASOS.filter((p) => corrida.agentes.includes(p.clave));
      cuerpo = (
        <CuerpoDetalle>
          <BloqueDetalle titulo={corrieron.length > 0 ? `Los ${corrieron.length} pasos que corrieron` : "Los pasos del análisis"}>
            {corrieron.length > 0 ? (
              <ol className="divide-y divide-line/70 rounded-xl border border-line">
                {corrieron.map((p, i) => (
                  <li key={p.clave} className="flex gap-3 px-3.5 py-2.5">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-paperDeep font-mono text-rotulo font-semibold tabular-nums text-inkSoft" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-dato font-semibold text-ink">{p.nombre}</span>
                      <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{p.que}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-mute">Este análisis no guardó el registro de qué agentes corrieron.</p>
            )}
          </BloqueDetalle>
          {analizadoEn && (
            <p className="text-meta text-inkSoft">
              <Dato tipo="fecha" nombre="Leído el">
                Leído el {fechaConAnio(analizadoEn)}
              </Dato>
            </p>
          )}
        </CuerpoDetalle>
      );
      pie = (
        <button type="button" onClick={() => irA("trace")} className={BOTON_PIE}>
          Ver el recorrido paso a paso <ArrowRight size={14} aria-hidden />
        </button>
      );
    } else {
      cuerpo = (
        <CuerpoDetalle>
          <BloqueDetalle titulo={obras.length === 1 ? "La obra enlazada" : `Las ${obras.length} obras enlazadas`}>
            <ul className="divide-y divide-line/70 rounded-xl border border-line">
              {obras.map((o, i) => (
                <li key={i} className="px-3.5 py-2.5 text-dato text-ink">
                  {o?.nombre ?? o?.descripcion ?? o?.codigo_infobras ?? "Obra registrada en INFOBRAS"}
                </li>
              ))}
            </ul>
          </BloqueDetalle>
          <Nota>El avance físico y lo pagado salen de INFOBRAS, el registro de obras de la Contraloría.</Nota>
        </CuerpoDetalle>
      );
      pie = (
        <button type="button" onClick={() => irA("obra")} className={BOTON_PIE}>
          Ver el avance y los pagos <ArrowRight size={14} aria-hidden />
        </button>
      );
    }
  }

  return (
    <div className="space-y-4">
      <ul className="grid gap-2 sm:grid-cols-2">
        {partes.map((p) => (
          <li key={p.clave}>
            <button type="button" onClick={() => setAbierto({ tipo: "parte", clave: p.clave })} aria-haspopup="dialog" className={CAJA_FUENTE}>
              <p.icono size={18} className="mt-0.5 shrink-0 text-mute" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 text-meta font-semibold text-ink">
                  {p.titulo}
                  <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />
                </span>
                <span className="mt-0.5 block text-rotulo leading-snug text-inkSoft">{p.texto}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <section aria-labelledby="relato-registros" className="rounded-2xl border border-line bg-paper px-4 py-3.5 [.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0 [.tarjeta_&]:bg-transparent [.tarjeta_&]:px-0 [.tarjeta_&]:pb-0">
        <h4 id="relato-registros" className="flex flex-wrap items-baseline gap-x-2 font-display text-bloque font-bold text-ink">
          Registros que se cruzaron
          {fuentes.length > 0 && <span className="font-sans text-rotulo font-normal text-mute">{numero(fuentes.length)}, toca uno para ver qué es y qué se consultó</span>}
        </h4>
        {fuentes.length > 0 ? (
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {registrosVisibles.map((f) => (
              <li key={f} className="min-w-0 max-w-full">
                <button
                  type="button"
                  onClick={() => setAbierto({ tipo: "registro", nombre: f })}
                  aria-haspopup="dialog"
                  className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3 text-left text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate/50 hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                >
                  <Database size={13} className="shrink-0 text-mute" aria-hidden />
                  <span className="min-w-0 break-words">{f}</span>
                  <ChevronRight size={13} className="shrink-0 text-mute" aria-hidden />
                </button>
              </li>
            ))}
            {fuentes.length > registrosVisibles.length && (
              <li>
                <button
                  type="button"
                  onClick={() => setTodosRegistros(true)}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-line px-3 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/50 hover:text-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                >
                  Ver los {numero(fuentes.length - registrosVisibles.length)} más
                </button>
              </li>
            )}
          </ul>
        ) : (
          <p className="mt-1.5 text-meta text-mute">Este análisis no guardó qué registros cruzó.</p>
        )}
      </section>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
        <EnlaceFuente href={oeceProcesoUrl(ocid)}>Ver el proceso en el OECE</EnlaceFuente>
      </p>

      {enPanel && (
        <Panel abierto={!!abierto} onCerrar={() => setAbierto(null)} titulo={titulo} descripcion={descripcion} ancho="lg" pie={pie}>
          {cuerpo}
        </Panel>
      )}
    </div>
  );
}
