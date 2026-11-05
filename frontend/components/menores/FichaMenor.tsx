import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, Check, FileSignature, FileText, ScanSearch, TriangleAlert } from "lucide-react";
import { DatosClave, FuenteDato, Nota, type BanderaFicha, type DatoClave } from "@/components/patrones";
import { Tabla, type Columna, type Fila } from "@/components/listado";
import { BanderasAntecedentes, BloqueInhabilitacion, fichasCompra } from "@/components/ordenes/ListaOrdenes";
import { BarraTope } from "@/components/charts/BarraTope";
import { LineaHitos, type Hito } from "@/components/charts/LineaHitos";
import { TextoPaso } from "@/components/historia/TextoPaso";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { Popover } from "@/components/ui/Flotante";
import { Severidad } from "@/components/ui/Severidad";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fecha as fechaLarga, fechaConAnio, numero, oracion, plural, porcentaje, soles } from "@/lib/formato";
import { SEACE_CONTRATOS, SEACE_MENORES } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import {
  rutaMenor, urlContratoMenor, urlRequerimiento, type ContratoDelGrupo, type FichaMenor, type ItemMenor, type SenalMenor,
} from "@/lib/menores";
import { P_ORD } from "@/lib/ordenes";
import { esRucPersonaNatural } from "@/lib/privacidad";
import { pctTxt, textoSenal } from "@/lib/senalesMenor";
import { cn } from "@/lib/utils";
import { antecedentesSunat, duracion, fechaHoraLima } from "./ListaMenores";

/**
 * La ficha de un contrato menor (≤8 UIT). Antes sólo había un panel con dos botones a los PDF; después, nueve secciones
 * apiladas una debajo de otra (5,4 pantallas en escritorio y 9,2 en el celular), con tarjetas de cuatro renglones
 * estiradas al alto de su vecina y media pantalla vacía al lado de la cronología y de «La entidad y el proveedor».
 * Pedido del usuario del 2026-11-05 («solo lo colocamos DEBAJO DE TODO Y YA, cuando podemos crear un layout
 * adecuado»): la plantilla de dos columnas de la ficha de un contrato (ContratoDetalle). En la columna principal, las
 * cifras, las señales con su evidencia (la compra partida como barra contra el tope), lo que se pidió (en dos columnas),
 * los ítems si el SEACE los publica, el contrato con sus líneas y los demás contratos de la entidad con ese proveedor; en
 * la lateral, quién es quién (la entidad y el proveedor, en verde, con su ficha) y la cronología con su orden de pago,
 * enlazada. Server-safe.
 */

const objetoTxt = (o: string | null) => (o && /bien/i.test(o) ? "Bien" : o && /servicio/i.test(o) ? "Servicio" : o ? tituloNatural(o) : null);

/** Un identificador en medio de una frase (la bajada): verde y subrayado, para que se vea que lleva a su ficha. */
const CLASE_EN_LINEA = "font-medium text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";
/** El mismo enlace como valor de un dato (columna lateral): verde, sin subrayado hasta pasar el puntero. */
const CLASE_DATO = "font-semibold text-granate underline-offset-2 hover:underline";

const enlace = (nombre: string, href: string | null, clase: string): ReactNode =>
  href ? (
    <Link href={href} prefetch={false} className={clase}>
      {nombre}
    </Link>
  ) : (
    nombre
  );

/** Las banderas de la cabecera: inhabilitado al firmar, las señales del contrato y lo de la SUNAT. */
export function banderasMenor(f: FichaMenor): BanderaFicha[] {
  const m = f.menor;
  const out: BanderaFicha[] = [];
  if (m.inhabilitacion) out.push({ tipo: "inhabilitado", severidad: "alta", nombre: "Inhabilitado por el Tribunal al firmar", href: "#antecedentes" });
  for (const s of f.senales) {
    const t = textoSenal(s);
    out.push({ tipo: s.tipo, severidad: s.severidad, nombre: t.nombre, explica: t.explica, href: `#senal-${s.tipo}`, n: s.grupo?.length ?? null });
  }
  for (const a of antecedentesSunat(m)) out.push({ tipo: a.tipo, severidad: a.severidad, nombre: a.titulo, explica: a.explica, href: "#antecedentes" });
  return out;
}

/**
 * La bajada del encabezado: el código, la entidad y el proveedor (cada uno con su ficha, en verde) y el monto. Antes el
 * proveedor no estaba arriba: aparecía recién en la cuarta pantalla, en «La entidad y el proveedor». Una persona natural
 * (RUC 10) va con su nombre tal como llega de la API (tapado) y sin enlace ni RUC: su RUC lleva el DNI.
 */
export function BajadaMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const fichas = fichasCompra(rutaMenor(m.id), m.entidadRuc, m.proveedorRuc);
  const entidad = m.entidad ? tituloNatural(m.entidad) : null;
  const proveedor = m.proveedor ? tituloNatural(m.proveedor) : null;
  return (
    <>
      Contrato menor
      {m.codigo && (
        <>
          {" "}
          <span className="font-mono" translate="no">{m.codigo}</span>
        </>
      )}
      {entidad && <> de {enlace(entidad, fichas.entidad, CLASE_EN_LINEA)}</>}
      {proveedor && <> con {enlace(proveedor, fichas.proveedor, CLASE_EN_LINEA)}</>}, por {soles(m.monto)}.
    </>
  );
}

export function CifrasMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const anual = f.historial.filter((h) => h.anio === m.anio && h.moneda === "PEN");
  const sumaAnual = anual.reduce((a, h) => a + (h.monto || 0), 0);
  const items: Cifra[] = [
    {
      valor: m.monto != null ? soles(m.monto) : null,
      etiqueta: "monto del contrato",
      contexto: m.tope ? `${pctTxt((100 * (m.monto ?? 0)) / m.tope)} del tope de 8 UIT (${soles(m.tope)})` : "hasta 8 UIT",
      tono: m.sobreTope ? "alta" : undefined,
    },
    {
      valor: m.cotizaHoras != null ? duracion(m.cotizaHoras) : null,
      etiqueta: "para cotizar",
      contexto: m.cotizaInicio && m.cotizaCierre ? `del ${fechaHoraLima(m.cotizaInicio)} al ${fechaHoraLima(m.cotizaCierre)}` : "ventana de cotización",
      tono: f.senales.some((s) => s.tipo === "menor_ventana_corta") ? "media" : undefined,
    },
    {
      valor: numero(anual.length),
      etiqueta: `con este proveedor en ${m.anio ?? "el año"}`,
      contexto: `contratos menores de la entidad, por ${soles(sumaAnual)}`,
      tono: m.tope && sumaAnual > m.tope && anual.length > 1 ? "alta" : undefined,
      // Lleva a la lista de esos contratos, más abajo en la misma ficha.
      href: f.historial.length ? "#historial" : undefined,
    },
    {
      valor: f.items.length ? numero(f.items.length) : null,
      etiqueta: f.items.length === 1 ? "ítem" : "ítems",
      contexto: !f.items.length ? "el SEACE todavía no publica sus ítems"
        : f.items.some((i) => i.refMediana != null) ? "con precio de otras entidades para comparar" : "del catálogo del Estado",
    },
  ];
  return <CifrasEnFila items={items} />;
}

// ─── Fechas que no cuadran ────────────────────────────────────────────────────

const DIA_MS = 86_400_000;
const ymd = (s: unknown): string | null => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA_MS);
const lapsoTxt = (d: number) => (d < 60 ? plural(d, "día", "días") : plural(Math.round(d / 30.44), "mes", "meses"));

/** Una fecha (de la orden de pago o del documento firmado) a más de 30 días de la firma que la entidad registró. */
interface FechaDispar {
  de: "orden" | "documento";
  fecha: string;
  firma: string;
  /** `fecha` menos `firma`: negativo, la orden o el documento es anterior a la firma registrada. */
  dias: number;
}

/**
 * La firma registrada en el SEACE (fecha_suscripcion) contra la fecha de su orden de pago (CONOSCE) y la del documento
 * que la entidad subió (leída por la IA). Pedido del usuario del 2026-11-05: una ficha decía «Se firmó el contrato 4 ago.
 * 2026» y, más abajo, «Fecha del documento 6 feb. 2026» y la orden «emitida el 6 feb. 2026», sin decir que no cuadraban.
 * En un contrato menor la orden ES el contrato (migración 240), así que seis meses entre las dos fechas casi siempre son
 * una entidad que registró tarde en el SEACE.
 */
function fechasDispares(f: FichaMenor): { orden: FechaDispar | null; documento: FechaDispar | null } {
  const firma = ymd(f.menor.fecha);
  if (!firma) return { orden: null, documento: null };
  const dispar = (de: FechaDispar["de"], x: string | null): FechaDispar | null => {
    if (!x) return null;
    const dias = diasEntre(firma, x);
    return Math.abs(dias) > 30 ? { de, fecha: x, firma, dias } : null;
  };
  const c = (f.lecturas.contrato?.salida ?? {}) as Record<string, unknown>;
  return {
    orden: f.ordenes.map((o) => dispar("orden", ymd(o.fecha))).find((x) => x) ?? null,
    documento: c.es_contrato ? dispar("documento", ymd(c.fecha)) : null,
  };
}

/** Qué no cuadra y lo más probable, en una frase (el flotante de la bandera y el aviso de la cronología dicen lo mismo). */
function textoDispar(x: FechaDispar, f: FichaMenor): string {
  const que = x.de === "orden" ? "su orden de pago" : "el contrato u orden que subió";
  const base = `La entidad registró en el SEACE que firmó el ${fechaConAnio(x.firma)}, pero ${que} es del ${fechaConAnio(x.fecha)}: ${lapsoTxt(Math.abs(x.dias))}`;
  if (x.dias > 0) return `${base} después. Puede ser un error de la entidad al registrar una de las dos fechas; Vigía las muestra tal como se publicaron.`;
  // Una orden anterior a la cotización también es una señal propia: no se la contradice, se la nombra.
  const senal = f.senales.some((s) => s.tipo === "menor_orden_antes_de_cotizar")
    ? " O que la compra ya estuviera decidida: mira la señal «La orden se emitió antes de pedir cotizaciones»."
    : "";
  return `${base} antes. Lo más probable es que la entidad haya registrado el contrato tarde en el SEACE.${senal} Vigía muestra las dos fechas tal como se publicaron.`;
}

/**
 * La bandera de una fecha dudosa, junto a la fecha: la forma de `BanderaDato` (ámbar, con su triángulo) y, al tocarla, la
 * explicación en un flotante (un `title` no existe en el celular ni con teclado; como `BanderaAparte`). `BanderaDato` no
 * sirve tal cual: sus motivos son los de la migración 102 y ninguno es una fecha registrada tarde.
 */
function BanderaFecha({ texto }: { texto: string }) {
  return (
    <Popover
      titulo="Las fechas no cuadran"
      anchoClase="w-72"
      className="pill w-fit max-w-full gap-1 border-amber/30 bg-amber-soft text-left text-amberTexto transition-colors duration-rapido hover:border-amber/60"
      trigger={
        <>
          <TriangleAlert size={12} strokeWidth={2.25} className="shrink-0" aria-hidden />
          <span className="min-w-0">Fecha que no cuadra</span>
        </>
      }
    >
      {texto}
    </Popover>
  );
}

// ─── La orden de pago ─────────────────────────────────────────────────────────

/**
 * La orden de CONOSCE en corto: «O/S-149-2026-UNIDAD DE LOGÍSTICA» → servicio, N.° 149 (el primer número, sin ceros a la
 * izquierda ni el año delante: la regla de norm_nro_orden de la migración 240).
 */
function ordenCorta(orden: string, fecha: string): { tipo: string | null; numero: string | null } {
  const tipo = /^\s*(?:O\.?\s*\/?\s*C\b|ORDEN\s+DE\s+COMPRA)/i.test(orden) ? "compra"
    : /^\s*(?:O\.?\s*\/?\s*S\b|ORDEN\s+DE\s+SERVICIO)/i.test(orden) ? "servicio" : null;
  const d = orden.match(/[1-9]\d*/)?.[0] ?? null;
  const n = d && d.length >= 8 && d.startsWith(fecha.slice(0, 4)) ? d.slice(4).replace(/^0+/, "") || null : d;
  return { tipo, numero: n };
}

/**
 * Su orden en la lista de órdenes: la de la entidad, ese año y con ese número (la búsqueda de la lista mira el número de
 * la orden). No hay ficha propia de una orden; filtrada así quedan una o dos. Nunca con el RUC del proveedor: si es una
 * persona, lleva su DNI.
 */
function hrefOrden(f: FichaMenor, o: FichaMenor["ordenes"][number]): string {
  const p = new URLSearchParams({ vista: "ordenes" });
  if (f.menor.entidadRuc) p.set(P_ORD.entidad, f.menor.entidadRuc);
  if (ymd(o.fecha)) p.set(P_ORD.anio, o.fecha.slice(0, 4));
  // La API pide al menos 2 caracteres para buscar.
  const n = ordenCorta(o.orden, o.fecha).numero;
  if (n && n.length >= 2) p.set(P_ORD.q, n);
  return `/app/contratos?${p}`;
}

// ─── Señales con su evidencia ─────────────────────────────────────────────────

const COLS_GRUPO: Columna[] = [
  { clave: "contrato", titulo: "Contrato menor", ancho: "minmax(0,1.6fr)" },
  { clave: "fecha", titulo: "Firmado", ancho: "120px", desde: "md", apilar: "con-rotulo" },
  { clave: "monto", titulo: "Monto", ancho: "120px", alinear: "der" },
];

/** Los contratos de la señal en su tabla: sólo si alguno no está en el historial de abajo (pasa de los 80 que trae). */
function TablaGrupo({ grupo, actual, etiqueta }: { grupo: ContratoDelGrupo[]; actual: number; etiqueta: string }) {
  const filas: Fila[] = grupo.map((g) => ({
    id: String(g.id),
    href: g.id === actual ? undefined : rutaMenor(g.id),
    resaltada: g.id === actual,
    celdas: {
      contrato: (
        <span className="block min-w-0">
          {/* Dos renglones y no uno recortado: en el celular quedaba «Servicio de co…». */}
          <span className="line-clamp-2 font-medium text-ink">{g.descripcion ? oracion(g.descripcion) : "Sin descripción"}</span>
          <span className="block break-words font-mono text-rotulo text-mute">{g.codigo}{g.id === actual ? " (este contrato)" : ""}</span>
        </span>
      ),
      fecha: <span className="font-mono text-meta">{g.fecha ? fechaConAnio(g.fecha) : "Sin fecha"}</span>,
      monto: <span className="font-mono text-meta tabular-nums">{soles(g.monto)}</span>,
    },
  }));
  return <Tabla columnas={COLS_GRUPO} filas={filas} etiqueta={etiqueta} densidad="compacta" />;
}

const SERIE = "rgb(var(--serie-1))";
const SERIE_CLARA = "rgb(var(--serie-1) / 0.4)";

/**
 * Los contratos de una compra partida contra el tope de 8 UIT. Pedido del usuario del 2026-11-05: «suman S/ 87,999, más
 * que el tope (S/ 44,000)» era sólo texto. Una barra con un tramo por contrato, en orden de firma (este, lleno; los demás,
 * más claros), 2 px de aire entre tramos, y una raya en el tope: la suma pasa el 100 %, así que la escala es la mayor de
 * las dos y la raya queda donde cae el tope. El detalle de cada tramo va en su `title`; la lista, una sola vez, en el
 * historial de abajo (antes los 10 contratos de la señal se repetían entre los 15 del historial). Server-safe.
 */
function BarraGrupoTope({ grupo, actual, tope }: { grupo: ContratoDelGrupo[]; actual: number; tope: number | null }) {
  const tramos = [...grupo].filter((g) => g.monto > 0).sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "") || a.id - b.id);
  const suma = tramos.reduce((a, g) => a + g.monto, 0);
  if (!(suma > 0)) return null;
  const escala = Math.max(suma, tope ?? 0);
  const enTope = tope ? (100 * tope) / escala : null;
  const veces = tope ? suma / tope : null;
  const relacion = veces == null ? null : veces >= 1.5 ? `${String(Math.round(veces * 10) / 10).replace(".", ",")} veces el tope` : `el ${porcentaje(veces * 100)} del tope`;
  const este = tramos.find((g) => g.id === actual);
  return (
    <figure className="space-y-1.5">
      <div className="relative pt-5">
        {enTope != null && (
          // El rótulo del tope, sobre la raya: hacia la izquierda si la raya cae en la mitad derecha, para no salirse.
          <span
            aria-hidden
            className="absolute top-0 whitespace-nowrap text-micro font-semibold text-ink"
            style={enTope > 55 ? { right: `${100 - enTope}%` } : { left: `${enTope}%` }}
          >
            Tope de 8 UIT
          </span>
        )}
        <div
          role="img"
          aria-label={`Los ${tramos.length} contratos suman ${soles(suma)}${tope ? `, ${relacion} de 8 UIT (${soles(tope)})` : ""}${este ? `; este contrato es ${soles(este.monto)}` : ""}.`}
          className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-paperDeep"
        >
          {tramos.map((g) => (
            <span
              key={g.id}
              title={`${g.descripcion ? oracion(g.descripcion) : "Sin descripción"}: ${soles(g.monto)}${g.fecha ? `, ${fechaConAnio(g.fecha)}` : ""}${g.id === actual ? " (este contrato)" : ""}`}
              className="h-full min-w-[3px]"
              style={{ width: `${(100 * g.monto) / escala}%`, background: g.id === actual ? SERIE : SERIE_CLARA }}
            />
          ))}
        </div>
        {enTope != null && <span aria-hidden className="absolute -bottom-0.5 top-4 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${enTope}%` }} />}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-rotulo text-mute">
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIE }} aria-hidden />
            Este contrato
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIE_CLARA }} aria-hidden />
            Los demás
          </span>
        </span>
        <span>
          <span className="font-mono font-semibold tabular-nums text-ink">{soles(suma)}</span>
          {relacion && tope && (
            <>
              , {relacion} (<span className="font-mono tabular-nums">{soles(tope)}</span>)
            </>
          )}
        </span>
      </figcaption>
    </figure>
  );
}

function EvidenciaSenal({ s, f }: { s: SenalMenor; f: FichaMenor }) {
  const d = s.detalle as Record<string, any>;
  if (s.grupo?.length) {
    const tope = typeof d.tope === "number" && d.tope > 0 ? d.tope : f.menor.tope ?? null;
    // Cada contrato se lista una vez: si todos están en el historial de abajo, ahí van marcados y aquí sólo la barra.
    const enHistorial = new Set(f.historial.map((h) => h.id));
    const todos = s.grupo.every((g) => enHistorial.has(g.id));
    return (
      <div className="space-y-3">
        <BarraGrupoTope grupo={s.grupo} actual={f.menor.id} tope={tope} />
        {todos ? (
          <a href="#historial" className={cn("inline-flex min-h-6 items-center text-meta", CLASE_EN_LINEA)}>
            Ver los {numero(s.grupo.length)} contratos, marcados en el historial
          </a>
        ) : (
          <TablaGrupo grupo={s.grupo} actual={f.menor.id} etiqueta={`Los contratos de la señal «${textoSenal(s).nombre}»`} />
        )}
      </div>
    );
  }
  if (s.tipo === "menor_borde_tope" && f.menor.monto != null && f.menor.tope) {
    return <BarraTope monto={f.menor.monto} tope={f.menor.tope} />;
  }
  if (s.tipo === "menor_precio_alto" && d.peor) {
    const p = d.peor;
    return (
      <DatosClave
        items={[
          { etiqueta: "Ítem", valor: oracion(String(p.descripcion ?? "")) },
          { etiqueta: "Cantidad", valor: `${numero(p.cantidad)} ${String(p.unidad ?? "").toLowerCase()}`, mono: true },
          { etiqueta: "Pagado por unidad", valor: soles(p.unitario), mono: true },
          { etiqueta: "Mediana de otras entidades", valor: `${soles(p.mediana)} (${numero(p.entidades)} entidades, ${p.anio})`, mono: true },
          { etiqueta: "Por encima de lo habitual", valor: soles(d.exceso), mono: true },
        ]}
      />
    );
  }
  if (s.tipo === "menor_ventana_corta" && d.desde) {
    return <p className="text-dato text-inkSoft">Del {fechaHoraLima(String(d.desde).replace(" ", "T"))} al {fechaHoraLima(String(d.hasta).replace(" ", "T"))}.</p>;
  }
  const cita: string | null = typeof d.cita === "string" && d.cita ? d.cita : null;
  const marcas: { marca: string; cita: string; por_que?: string }[] = Array.isArray(d.marcas) ? d.marcas : [];
  if (cita || marcas.length) {
    return (
      <div className="space-y-2">
        {cita && <blockquote className="border-l-2 border-line pl-3 text-dato italic text-inkSoft">«{cita}»</blockquote>}
        {marcas.map((m, i) => (
          <blockquote key={i} className="border-l-2 border-line pl-3 text-dato text-inkSoft">
            <span className="font-semibold not-italic text-ink">{m.marca}:</span> <span className="italic">«{m.cita}»</span>
            {m.por_que && <span className="mt-0.5 block text-meta text-mute">{m.por_que}</span>}
          </blockquote>
        ))}
        <p className="text-rotulo text-mute">Citado de {d.documento === "requerimiento" ? "el requerimiento" : "el contrato u orden"}, leído por {d.lector ?? "la IA"}.</p>
      </div>
    );
  }
  return null;
}

export function SenalesMenor({ f }: { f: FichaMenor }) {
  if (!f.senales.length) {
    return (
      <Nota icono={<ScanSearch size={16} aria-hidden />}>
        No encontramos señales en este contrato menor: ni compra partida con este proveedor, ni monto sobre el tope o al borde,
        ni una ventana de cotización corta, ni un precio fuera de lo que pagan otras entidades
        {f.lecturas.tdr || f.lecturas.contrato ? ", ni nada raro en lo que la IA leyó en sus documentos" : ""}.
      </Nota>
    );
  }
  return (
    <div className="space-y-3">
      {f.senales.map((s) => {
        const t = textoSenal(s);
        return (
          <article key={s.tipo} id={`senal-${s.tipo}`} className="tarjeta scroll-mt-24 space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Severidad bandera={s.severidad} />
              <h3 className="font-display text-cuerpo font-bold text-ink">{t.nombre}</h3>
            </div>
            <p className="text-dato leading-relaxed text-inkSoft">{t.explica}</p>
            <EvidenciaSenal s={s} f={f} />
          </article>
        );
      })}
      <p className="text-rotulo text-mute">Son indicios para revisar, no prueban una irregularidad. Cada uno dice qué se midió.</p>
    </div>
  );
}

// ─── Lo que se pidió y lo que se compró ───────────────────────────────────────

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Un dato en dos columnas: `ancho` lo pone a lo ancho de las dos (si no se dice, un texto largo va a lo ancho). */
type Par = DatoClave & { ancho?: boolean };

/**
 * Pares etiqueta → valor en dos columnas desde `sm` (la etiqueta arriba y chica): un valor largo ocupa las dos y los
 * cortos llenan los huecos (`grid-flow-row-dense`). Antes eran filas de etiqueta y valor en una tarjeta de media
 * pantalla, con la otra mitad estirada al alto de su vecina y casi vacía.
 */
function DatosEnDos({ items, className }: { items: Par[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-flow-row-dense sm:grid-cols-2", className)}>
      {items.map((d) => {
        const ancho = d.ancho ?? (typeof d.valor === "string" && d.valor.length > 56);
        return (
          <div key={d.etiqueta} className={cn("min-w-0", ancho && "sm:col-span-2")}>
            <dt className="flex items-center gap-1 text-rotulo text-mute">
              {d.etiqueta}
              {d.ayuda}
            </dt>
            <dd className={cn("mt-0.5 break-words text-dato leading-snug text-ink", d.mono && "font-mono text-meta tabular-nums")}>
              {d.valor == null || d.valor === "" ? <span className="text-mute">Sin dato</span> : d.valor}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * El pie de la tarjeta de un documento: el PDF, quién lo leyó y, para el requerimiento, «Verlo aquí» (el PDF dentro de
 * la página, desde `sm`). Antes «Ver el requerimiento aquí» era una barra a todo el ancho para un solo enlace; ahora es un
 * enlace en esta fila y, al abrirse, el visor baja a su propio renglón (`open:basis-full`).
 */
function PieDocumento({ pdf, leido, visor }: { pdf: ReactNode; leido: string; visor?: { src: string; titulo: string } | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
      {pdf}
      <span className="text-rotulo text-mute">{leido}</span>
      {visor && (
        <details className="group/visor hidden open:basis-full sm:block">
          <summary className={cn("inline-flex min-h-8 cursor-pointer list-none items-center text-meta [&::-webkit-details-marker]:hidden", CLASE_EN_LINEA)}>
            <span className="group-open/visor:hidden">Verlo aquí</span>
            <span className="hidden group-open/visor:inline">Ocultar el PDF</span>
          </summary>
          <iframe src={visor.src} title={visor.titulo} className="mt-2 h-[70vh] w-full rounded-xl border border-line" loading="lazy" />
        </details>
      )}
    </div>
  );
}

/** Lo que la IA leyó en el requerimiento (TDR o especificaciones técnicas). */
export function LoQueSePidio({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const l = f.lecturas.tdr;
  const r = (l?.salida ?? {}) as Record<string, any>;
  const pdf = m.tieneRequerimiento ? (
    <a href={urlRequerimiento(m.id)} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
      <FileText className="size-4" aria-hidden /> Abrir el requerimiento (PDF)
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  ) : null;
  if (!l || !r.es_requerimiento) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Nota icono={<FileText size={16} aria-hidden />} className="min-w-0 flex-1 basis-72">
          {m.tieneRequerimiento
            ? "La IA todavía no leyó este requerimiento: lo que pide va a aparecer aquí cuando lo lea."
            : "El SEACE no publicó el requerimiento de este contrato menor."}
        </Nota>
        {pdf}
      </div>
    );
  }
  const perfil = (r.perfil_proveedor ?? {}) as Record<string, any>;
  const datos: (Par | null)[] = [
    txt(r.objeto) ? { etiqueta: "Qué se pide", valor: txt(r.objeto), ancho: true } : null,
    txt(r.finalidad) ? { etiqueta: "Para qué", valor: txt(r.finalidad) } : null,
    txt(r.area_usuaria) || m.areaUsuaria ? { etiqueta: "Quién lo pidió", valor: txt(r.area_usuaria) ?? oracion(m.areaUsuaria!) } : null,
    r.plazo_dias != null ? { etiqueta: "Plazo", valor: `${numero(r.plazo_dias)} días`, mono: true } : null,
    txt(r.lugar) ? { etiqueta: "Dónde", valor: txt(r.lugar) } : null,
    r.monto_estimado != null ? { etiqueta: "Monto que estima", valor: soles(r.monto_estimado), mono: true } : null,
    txt(perfil.formacion) ? { etiqueta: "Perfil del proveedor", valor: txt(perfil.formacion) } : null,
    perfil.experiencia_anios != null ? { etiqueta: "Experiencia exigida", valor: `${numero(perfil.experiencia_anios)} años`, mono: true } : null,
    perfil.experiencia_monto != null ? { etiqueta: "Facturación exigida", valor: soles(perfil.experiencia_monto), mono: true } : null,
    txt(r.forma_pago) ? { etiqueta: "Forma de pago", valor: txt(r.forma_pago) } : null,
    txt(r.penalidad) ? { etiqueta: "Penalidad", valor: txt(r.penalidad) } : null,
  ];
  const requisitos: { tipo: string; requisito: string }[] = Array.isArray(r.requisitos) ? r.requisitos : [];
  const marcas: { marca: string; con_equivalente: boolean }[] = Array.isArray(r.marcas) ? r.marcas : [];
  return (
    <div className="tarjeta space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <DatosEnDos items={datos.filter(Boolean) as Par[]} />
      {/* Los requisitos en una lista corta de dos columnas, dentro de la misma tarjeta: antes eran 4 renglones en una
          tarjeta de ~600 px estirada al alto de la de al lado. */}
      <div className="border-t border-line pt-3">
        <h3 className="font-display text-cuerpo font-bold text-ink">
          Lo que se exige al proveedor{requisitos.length ? ` (${numero(requisitos.length)})` : ""}
        </h3>
        {requisitos.length ? (
          <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {requisitos.map((q, i) => (
              <li key={i} className="flex gap-2 text-meta leading-snug text-inkSoft">
                <Check size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
                <span className="min-w-0 break-words">{q.requisito}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-meta text-mute">El requerimiento no exige requisitos al proveedor.</p>
        )}
        {marcas.length > 0 && (
          <p className="mt-2.5 text-meta text-inkSoft">
            <span className="font-semibold text-ink">Marcas que nombra:</span>{" "}
            {marcas.map((x) => `${x.marca}${x.con_equivalente ? " (o equivalente)" : " (sin «o equivalente»)"}`).join(", ")}.
          </p>
        )}
      </div>
      <PieDocumento
        pdf={pdf}
        leido={`Leído por la IA (${l.modelo.replace(/-\d{8}$/, "")}) el ${fechaConAnio(l.leido)}${l.paginas ? `, ${plural(l.paginas, "página", "páginas")}` : ""}.`}
        visor={m.tieneRequerimiento ? { src: urlRequerimiento(m.id), titulo: "Requerimiento del contrato menor (PDF)" } : null}
      />
    </div>
  );
}

const COLS_ITEMS: Columna[] = [
  { clave: "item", titulo: "Ítem", ancho: "minmax(0,1.6fr)" },
  { clave: "cantidad", titulo: "Cantidad", ancho: "120px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "unitario", titulo: "Por unidad", ancho: "120px", alinear: "der", apilar: "con-rotulo" },
  { clave: "referencia", titulo: "Otras entidades", corto: "Mediana de otras", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
];

function celdaReferencia(i: ItemMenor): ReactNode {
  if (i.refMediana == null) return <span className="text-meta text-mute">Sin precio para comparar</span>;
  const razon = i.precioUnitario != null && i.refMediana > 0 ? i.precioUnitario / i.refMediana : null;
  return (
    <span className="block text-meta">
      <span className="font-mono tabular-nums text-ink">{soles(i.refMediana)}</span>{" "}
      <span className="text-mute">mediana de {numero(i.refEntidades)} entidades ({i.refAnio})</span>
      {razon != null && razon >= 1.5 && (
        <span className={`block font-semibold ${razon >= 2 ? "text-rust" : "text-amberTexto"}`}>{String(Math.round(razon * 10) / 10).replace(".", ",")} veces la mediana</span>
      )}
    </span>
  );
}

/** Los ítems con su precio. La página no dibuja la sección sin ítems: la cuarta cifra ya dice que el SEACE no los publica. */
export function LoQueSeCompro({ f }: { f: FichaMenor }) {
  if (!f.items.length) {
    return <Nota icono={<ScanSearch size={16} aria-hidden />}>El SEACE todavía no publica los ítems de este contrato menor.</Nota>;
  }
  const sinPrecio = f.items.length > 1 && f.items.every((i) => i.precioUnitario == null);
  const filas: Fila[] = f.items.map((i) => ({
    id: String(i.n),
    celdas: {
      item: (
        <span className="block min-w-0">
          <span className="block font-medium text-ink">{oracion(i.cubsoNombre ?? i.descripcion ?? "Ítem")}</span>
          {i.descripcion && i.cubsoNombre && <span className="block line-clamp-2 text-meta text-mute">{oracion(i.descripcion)}</span>}
          {i.cubso && <span className="block font-mono text-rotulo text-mute">CUBSO {i.cubso}</span>}
        </span>
      ),
      cantidad: <span className="font-mono text-meta tabular-nums">{i.cantidad != null ? `${numero(i.cantidad)} ${(i.unidad ?? "").toLowerCase()}` : "Sin dato"}</span>,
      unitario: <span className="font-mono text-meta tabular-nums">{i.precioUnitario != null ? soles(i.precioUnitario) : "Sin dato"}</span>,
      referencia: celdaReferencia(i),
    },
  }));
  return (
    <div className="space-y-2">
      <Tabla columnas={COLS_ITEMS} filas={filas} etiqueta="Los ítems del contrato menor" densidad="compacta" />
      {sinPrecio && (
        <p className="text-rotulo text-mute">
          El SEACE publica sólo el total de la cotización ganadora, no el precio de cada ítem: por eso no se compara por unidad.
        </p>
      )}
      <p className="text-rotulo text-mute">
        «Otras entidades»: la mediana de lo que pagaron por el mismo ítem del catálogo (CUBSO) y unidad en los procesos con
        buena pro del SEACE de ese año o del anterior.
      </p>
    </div>
  );
}

/**
 * Lo que la IA leyó en el contrato u orden registrado: sus datos en dos columnas y sus líneas en la misma tarjeta (antes,
 * dos tarjetas lado a lado estiradas a la misma altura, «Sus líneas (1)» casi vacía). El número del documento, en verde,
 * lleva a su orden de pago (pedido del usuario del 2026-11-05: «debería pintarse de verde el número para que podamos
 * clickear»), y su fecha lleva la bandera si no cuadra con la firma registrada.
 */
export function LoQueDiceElContrato({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const l = f.lecturas.contrato;
  const c = (l?.salida ?? {}) as Record<string, any>;
  const pdf = m.tieneContrato ? (
    <a href={urlContratoMenor(m.id)} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
      <FileSignature className="size-4" aria-hidden /> Abrir el contrato u orden (PDF)
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  ) : null;
  if (!l || !c.es_contrato) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Nota icono={<FileSignature size={16} aria-hidden />} className="min-w-0 flex-1 basis-72">
          {m.tieneContrato ? "La IA todavía no leyó este contrato u orden." : "El SEACE no publicó el contrato u orden."}
        </Nota>
        {pdf}
      </div>
    );
  }
  const tipo = { orden_de_compra: "Orden de compra", orden_de_servicio: "Orden de servicio", contrato: "Contrato" }[c.tipo_documento as string] ?? "Documento";
  const items: { descripcion: string; cantidad: number | null; unidad: string; precio_unitario: number | null; subtotal: number | null }[] =
    Array.isArray(c.items) ? c.items : [];
  // Con una sola orden de pago juntada a este contrato menor (migración 240), el número del documento es esa orden.
  const orden = f.ordenes.length === 1 ? f.ordenes[0] : null;
  const nro = txt(c.numero);
  const dispar = fechasDispares(f).documento;
  const datos: (Par | null)[] = [
    {
      etiqueta: "Documento",
      valor: nro ? (
        <>
          {tipo}{" "}
          {orden ? (
            <Link href={hrefOrden(f, orden)} prefetch={false} title="Ver su orden de pago en la lista de órdenes" className={cn("font-mono", CLASE_EN_LINEA)}>
              {nro}
            </Link>
          ) : (
            <span className="font-mono">{nro}</span>
          )}
        </>
      ) : (
        tipo
      ),
    },
    txt(c.fecha)
      ? {
          etiqueta: "Fecha del documento",
          valor: (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-meta tabular-nums">{fechaConAnio(c.fecha)}</span>
              {dispar && <BanderaFecha texto={textoDispar(dispar, f)} />}
            </span>
          ),
        }
      : null,
    c.monto_total != null ? { etiqueta: "Monto en el documento", valor: soles(c.monto_total), mono: true } : null,
    c.plazo_dias != null ? { etiqueta: "Plazo", valor: `${numero(c.plazo_dias)} días`, mono: true } : null,
    txt(c.garantia) ? { etiqueta: "Garantía", valor: txt(c.garantia) } : null,
    txt(c.penalidad) ? { etiqueta: "Penalidad", valor: txt(c.penalidad) } : null,
    Array.isArray(c.firmantes) && c.firmantes.length ? { etiqueta: "Firman", valor: c.firmantes.map((x: string) => oracion(x)).join(", ") } : null,
  ];
  return (
    <div className="tarjeta space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <DatosEnDos items={datos.filter(Boolean) as Par[]} />
      {items.length > 0 && (
        <div className="border-t border-line pt-3">
          <h3 className="font-display text-cuerpo font-bold text-ink">Sus líneas ({numero(items.length)})</h3>
          <ul className="mt-1 divide-y divide-line/70">
            {/* recorte: las demás líneas están en el PDF; debajo se dice cuántas más hay. */}
            {items.slice(0, 15).map((x, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5 text-meta">
                <span className="min-w-0 text-inkSoft">
                  {oracion(x.descripcion || "Línea")}
                  {x.cantidad != null ? `, ${numero(x.cantidad)} ${(x.unidad || "").toLowerCase()}` : ""}
                </span>
                {x.precio_unitario != null && <span className="font-mono tabular-nums text-ink">{soles(x.precio_unitario)} c/u</span>}
              </li>
            ))}
          </ul>
          {items.length > 15 && <p className="mt-1 text-rotulo text-mute">Y {numero(items.length - 15)} líneas más en el PDF.</p>}
        </div>
      )}
      <PieDocumento pdf={pdf} leido={`Leído por la IA el ${fechaConAnio(l.leido)}.`} />
    </div>
  );
}

// ─── La columna lateral: datos y cronología ───────────────────────────────────

/** Un dato de la columna lateral: el rótulo arriba y el valor debajo (como «Datos del proceso» de un contrato). */
function DatoLado({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-rotulo text-mute">{k}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

/**
 * Quién es quién y qué se contrató, en la columna lateral: la entidad y el proveedor (verdes, con su ficha; el proveedor
 * sólo si es una empresa, RUC 20), lo que dice la SUNAT de él, si el Tribunal lo tenía inhabilitado al firmar (el
 * destino de esas banderas de la cabecera, `#antecedentes`) y de dónde sale todo. Antes era «La entidad y el proveedor» a
 * todo el ancho, con la mitad derecha vacía, abajo de todo.
 */
export function DatosMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const fichas = fichasCompra(rutaMenor(m.id), m.entidadRuc, m.proveedorRuc);
  const empresa = /^20\d{9}$/.test(m.proveedorRuc ?? "");
  const natural = esRucPersonaNatural(m.proveedorRuc);
  const sunat = antecedentesSunat(m);
  const objeto = objetoTxt(m.objeto);
  const quien = [m.provTipo ? oracion(m.provTipo) : natural ? "Persona natural" : null, m.provDesde ? `desde ${fechaConAnio(m.provDesde)}` : null].filter(Boolean).join(", ");
  return (
    <section id="antecedentes" aria-labelledby="datos-menor" className="scroll-mt-24 rounded-2xl border border-line bg-paper">
      <h2 id="datos-menor" className="px-4 pt-3.5 font-display text-bloque font-bold text-ink">
        Datos del contrato
      </h2>
      <dl className="space-y-3 px-4 pb-3.5 pt-2.5 text-dato leading-5">
        <DatoLado k="Entidad">
          {m.entidad ? enlace(tituloNatural(m.entidad), fichas.entidad, CLASE_DATO) : <span className="text-mute">Sin dato</span>}
        </DatoLado>
        <DatoLado k="Proveedor">
          {m.proveedor ? (
            <span className={fichas.proveedor ? undefined : "font-semibold"}>{enlace(tituloNatural(m.proveedor), fichas.proveedor, CLASE_DATO)}</span>
          ) : (
            <span className="text-mute">Sin dato</span>
          )}
          {/* El RUC sólo de una empresa: el de una persona natural lleva su DNI. */}
          {empresa && <span className="block font-mono text-rotulo text-mute">RUC {m.proveedorRuc}</span>}
          {quien && <span className="block text-rotulo text-mute">{quien}</span>}
          {m.provActividad && <span className="block text-rotulo text-mute">{oracion(m.provActividad)}</span>}
        </DatoLado>
        {(objeto || m.ccmnNombre) && (
          <DatoLado k="Qué se contrató">
            {objeto ?? "Sin dato"}
            {m.ccmnNombre && <span className="block text-rotulo text-mute">En el catálogo: {oracion(m.ccmnNombre)}</span>}
          </DatoLado>
        )}
        {m.tipoInvitacion && (
          <DatoLado k="Invitación">
            {oracion(m.tipoInvitacion.replace(/^INVITACI[OÓ]N\s+/i, ""))}
            {m.justifInvitacion && <span className="block text-rotulo text-mute">Por qué no fue abierta: {m.justifInvitacion}</span>}
          </DatoLado>
        )}
        {(m.codigo || m.estadoProceso) && (
          <DatoLado k="Código SEACE">
            {m.codigo ? <span className="break-all font-mono text-meta" translate="no">{m.codigo}</span> : "Sin dato"}
            {m.estadoProceso && <span className="block text-rotulo text-mute">Estado del proceso: {m.estadoProceso}</span>}
          </DatoLado>
        )}
      </dl>
      {sunat.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <h3 className="font-display text-cuerpo font-bold text-ink">Lo que dice la SUNAT del proveedor</h3>
          <ul className="mt-1.5 space-y-1.5 text-meta leading-snug">
            {sunat.map((a) => (
              <li key={a.tipo}>
                <span className="font-semibold text-ink">{a.titulo}.</span> <span className="text-inkSoft">{a.explica}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.inhabilitacion && (
        <div className="border-t border-line px-4 py-3 text-meta">
          <BloqueInhabilitacion
            i={m.inhabilitacion}
            ruc={empresa ? m.proveedorRuc : null}
            cuando={m.fecha ? `Firmó este contrato el ${fechaLarga(m.fecha)}` : "Firmó este contrato"}
          />
        </div>
      )}
      <FuenteMenor f={f} className="border-t border-line px-4 py-2" />
    </section>
  );
}

/**
 * La cronología del contrato menor como línea de tiempo (`LineaHitos`): publicación, consultas, cotización, firma, su
 * orden de pago (el número en verde lleva a la orden) y la ejecución, con cuánto pasó entre un paso y el siguiente.
 * Antes eran cinco pasos en vertical a todo el ancho, con la mitad derecha vacía, y «Su orden de pago» una sección
 * aparte para una línea que repetía la «Orden de servicio 000149» del contrato. Si la orden o el documento no cuadran
 * con la firma registrada (más de 30 días), lo dice aquí, debajo de las fechas.
 */
export function CronologiaMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const hitos: Hito[] = [];
  const poner = (fecha: string | null | undefined, texto: string, extra?: Partial<Hito>) => {
    const d = ymd(fecha);
    if (d) hitos.push({ fecha: d, texto, ...extra });
  };
  poner(m.publicado, "Publicado en el SEACE");
  poner(m.consultasDesde, "Consultas");
  poner(m.cotizaInicio, m.cotizaHoras != null ? `Cotización de ${duracion(m.cotizaHoras)}` : "Cotización");
  if (ymd(m.cotizaCierre) !== ymd(m.cotizaInicio)) poner(m.cotizaCierre, "Cierra la cotización");
  poner(m.fecha, "Firma del contrato", { destacado: true });
  for (const o of f.ordenes) {
    const { tipo, numero: n } = ordenCorta(o.orden, o.fecha);
    poner(o.fecha, n ? `Orden de ${tipo ?? "pago"} N.° ${n}` : "Su orden de pago", { href: hrefOrden(f, o) });
  }
  poner(m.ejecucionDesde, "Empieza la ejecución");
  poner(m.ejecucionHasta, "Termina la ejecución");

  const dias = [...new Set(hitos.map((h) => h.fecha))];
  const disp = fechasDispares(f);
  const dispar = disp.orden ?? disp.documento;
  return (
    <section aria-labelledby="cronologia-menor" className="rounded-2xl border border-line bg-paper px-4 py-3.5">
      <h2 id="cronologia-menor" className="font-display text-bloque font-bold text-ink">
        Cronología
      </h2>
      {dias.length >= 2 ? (
        <LineaHitos hitos={hitos} etiqueta="Cronología del contrato menor" className="mt-3 border-0 bg-transparent p-0" />
      ) : dias.length === 1 ? (
        // Todo el mismo día: LineaHitos no dibuja una línea de un solo punto.
        <p className="mt-2 text-meta text-inkSoft">
          <time dateTime={dias[0]} className="font-mono tabular-nums text-ink">{fechaConAnio(dias[0])}</time>:{" "}
          {hitos.map((h, i) => (
            <span key={`${h.texto}-${i}`}>
              {i > 0 && "; "}
              <TextoPaso texto={h.texto} href={h.href} />
            </span>
          ))}
          .
        </p>
      ) : (
        <Nota icono={<CalendarClock size={16} aria-hidden />} className="mt-2">El SEACE no publicó las fechas de este contrato menor.</Nota>
      )}
      {/* La bandera de la fecha (con la explicación al tocarla) y, a su lado, qué no cuadra en una línea: una bandera,
          no un cartel aparte, como el aviso de las fechas de CONOSCE en LineaTiempoProceso. */}
      {dispar && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <BanderaFecha texto={textoDispar(dispar, f)} />
          <span className="text-rotulo leading-snug text-amberTexto">
            {dispar.de === "orden" ? "La orden de pago" : "El documento firmado"} es {lapsoTxt(Math.abs(dispar.dias))}{" "}
            {dispar.dias < 0 ? "anterior" : "posterior"} a la firma registrada.
          </span>
        </p>
      )}
      {!f.ordenes.length && (
        <p className="mt-2.5 text-rotulo text-mute">
          Su orden de pago todavía no aparece en CONOSCE: se busca por el número de la orden y no siempre coincide.
        </p>
      )}
    </section>
  );
}

// ─── Este proveedor en esta entidad ───────────────────────────────────────────

const COLS_HIST: Columna[] = [
  { clave: "contrato", titulo: "Contrato menor", ancho: "minmax(0,1.6fr)" },
  { clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "lg", apilar: true },
  { clave: "fecha", titulo: "Firmado", ancho: "112px", desde: "md", apilar: "con-rotulo" },
  { clave: "monto", titulo: "Monto", ancho: "112px", alinear: "der" },
];

/**
 * Todos los contratos menores de la entidad con ese proveedor. Los de la compra partida de este contrato van marcados
 * aquí («En la compra partida») y no repetidos en su señal; lo de cada año, en una franja de cifras (antes una frase:
 * «2026: 15 contratos por S/ 125,689.»), sólo si hay más de un año (el de este ya está en las cifras de arriba).
 */
export function HistorialProveedor({ f }: { f: FichaMenor }) {
  const enGrupo = new Set(f.senales.flatMap((s) => s.grupo?.map((g) => g.id) ?? []));
  const filas: Fila[] = f.historial.map((h) => ({
    id: String(h.id),
    href: h.id === f.menor.id ? undefined : rutaMenor(h.id),
    resaltada: h.id === f.menor.id,
    celdas: {
      contrato: (
        <span className="block min-w-0">
          {/* Dos renglones y no uno recortado: en el celular quedaba «Servicio de co…». */}
          <span className="line-clamp-2 font-medium text-ink">{h.descripcion ? oracion(h.descripcion) : "Sin descripción"}</span>
          <span className="block break-words font-mono text-rotulo text-mute">
            {h.codigo}
            {h.id === f.menor.id ? " (este contrato)" : ""}
            {objetoTxt(h.objeto) ? `, ${objetoTxt(h.objeto)!.toLowerCase()}` : ""}
          </span>
          {enGrupo.has(h.id) && (
            <span className="mt-0.5 inline-flex items-center gap-1.5 text-micro font-semibold text-inkSoft">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: h.id === f.menor.id ? SERIE : SERIE_CLARA }} aria-hidden />
              En la compra partida
            </span>
          )}
        </span>
      ),
      senales: h.senales?.length ? (
        <BanderasAntecedentes
          etiqueta="Señales"
          antecedentes={h.senales.map((t) => {
            const x = textoSenal({ tipo: t, severidad: "media", monto: null });
            return { tipo: t, severidad: t === "menor_partido_mismo_dia" || t === "menor_sobre_tope" ? "alta" : t === "menor_borde_tope" || t === "menor_fin_de_semana" ? "baja" : "media", chip: x.chip, explica: x.explica };
          })}
        />
      ) : <span className="text-meta text-mute">Ninguna</span>,
      fecha: <span className="font-mono text-meta">{h.fecha ? fechaConAnio(h.fecha) : "Sin fecha"}</span>,
      monto: <span className="font-mono text-meta tabular-nums">{soles(h.monto)}</span>,
    },
  }));
  const porAnio = new Map<number, { n: number; monto: number }>();
  for (const h of f.historial) {
    if (h.anio == null) continue;
    const a = porAnio.get(h.anio) ?? { n: 0, monto: 0 };
    a.n += 1; a.monto += h.monto || 0;
    porAnio.set(h.anio, a);
  }
  const anios = [...porAnio.entries()].sort((a, b) => b[0] - a[0]);
  const cifraAnio = ([anio, a]: [number, { n: number; monto: number }]): Cifra => ({
    valor: numero(a.n),
    etiqueta: `${a.n === 1 ? "contrato" : "contratos"} en ${anio}`,
    contexto: `por ${soles(a.monto)}`,
    tono: anio === f.menor.anio && f.menor.tope && a.monto > f.menor.tope && a.n > 1 ? "alta" : undefined,
  });
  // La franja lleva hasta cuatro cifras: con más años, los tres últimos y el resto junto en la cuarta.
  const resto = anios.slice(3).reduce((t, [, a]) => ({ n: t.n + a.n, monto: t.monto + a.monto }), { n: 0, monto: 0 });
  const cifras: Cifra[] = anios.length <= 4
    ? anios.map(cifraAnio)
    : [
        // recorte: los años más viejos van juntos en la cuarta cifra (resto).
        ...anios.slice(0, 3).map(cifraAnio),
        { valor: numero(resto.n), etiqueta: `${resto.n === 1 ? "contrato" : "contratos"} de ${anios[anios.length - 1][0]} a ${anios[3][0]}`, contexto: `por ${soles(resto.monto)}` },
      ];
  return (
    <div className="space-y-3">
      {anios.length > 1 && <CifrasEnFila items={cifras} />}
      <Tabla columnas={COLS_HIST} filas={filas} etiqueta="Los contratos menores de la entidad con este proveedor" densidad="compacta" />
      {f.historial.length >= 80 && <p className="text-rotulo text-mute">Se muestran los 80 más recientes.</p>}
    </div>
  );
}

export function FuenteMenor({ f, className }: { f: FichaMenor; className?: string }) {
  return (
    <FuenteDato
      fuente={`SEACE, contrato menor ${f.menor.codigo ?? f.menor.id}`}
      enlaces={[
        { texto: "Buscador de Contratos del Estado (SEACE): el contrato", href: SEACE_CONTRATOS },
        { texto: "Buscador de contratos menores (SEACE): el requerimiento y los ítems", href: SEACE_MENORES },
      ]}
      className={className}
    />
  );
}
