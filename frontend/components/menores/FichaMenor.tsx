import type { ReactNode } from "react";
import Link from "next/link";
import { Banknote, CalendarClock, Check, ChevronDown, Clock, FileSignature, FileText, MailOpen, ScanSearch, TriangleAlert } from "lucide-react";
import {
  Cronologia, DatosClave, EnUnaFrase, FuenteDato, Nota, type BanderaFicha, type DatoClave, type PasoRelato, type SenalPaso,
} from "@/components/patrones";
import { Tabla, type Columna, type Fila } from "@/components/listado";
import { BanderasAntecedentes, BloqueInhabilitacion, fichasCompra } from "@/components/ordenes/ListaOrdenes";
import { BarraTope } from "@/components/charts/BarraTope";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { Dato } from "@/components/ui/Dato";
import { Popover } from "@/components/ui/Flotante";
import { ICONO_NIVEL, Severidad } from "@/components/ui/Severidad";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { enlaceProveedor } from "@/lib/empresas";
import { fecha as fechaLarga, fechaConAnio, numero, oracion, plural, porcentaje, soles } from "@/lib/formato";
import { SEACE_CONTRATOS, SEACE_MENORES } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import {
  rutaMenor, urlContratoMenor, urlRequerimiento, type ContratoDelGrupo, type FichaMenor, type ItemMenor, type LecturaMenor,
  type SenalMenor, type Severidad as Nivel,
} from "@/lib/menores";
import { P_ORD } from "@/lib/ordenes";
import { esRucPersonaNatural } from "@/lib/privacidad";
import { ordenarSenalesMenor, pctTxt, textoSenal } from "@/lib/senalesMenor";
import { cn } from "@/lib/utils";
import { recortar as recortarEnPalabra } from "@/components/contratos/recortar";
import { antecedentesSunat, duracion, fechaHoraLima } from "./ListaMenores";

/**
 * La ficha de un contrato menor (≤8 UIT), contada como una historia. Pedido del usuario del 2026-11-05: «veo que solo
 * apilamos y demás sin dar orden o contar una historia». Antes eran bloques sueltos (cifras, señales, lo que se pidió, el
 * contrato, el historial y, al costado, los datos y una línea de hitos); ahora se lee en el orden de un relato:
 *
 *   En una frase   quién contrató a quién, para qué y por cuánto, y lo más grave que encontramos (`FraseMenor`).
 *   1. Qué pasó    los pasos en orden, del pedido de cotizaciones a la orden de pago, con cada señal PEGADA AL PASO
 *                  donde se ve: la ventana corta al cerrar la cotización, el requerimiento que nombra a quién contratar
 *                  al pedir, el otro monto o el otro RUC en el documento, la compra partida en la firma (`CronologiaMenor`).
 *   2. Lo que se pidió y lo que se firmó   el requerimiento frente al contrato, renglón por renglón, con los que no
 *                  coinciden resaltados; el detalle entero de cada documento, plegado (`PedidoYContrato`).
 *   3. Por qué llama la atención   cada señal con su evidencia, de la más grave a la más leve (`SenalesMenor`).
 *   4. Quién es el proveedor y qué más le compraron   la SUNAT, la inhabilitación y su historial con la entidad.
 *   5. De dónde sale cada dato   el registro del SEACE, los PDF, lo que leyó la IA y las fuentes (`FuentesMenor`).
 *
 * Server-safe.
 */

const objetoTxt = (o: string | null) => (o && /bien/i.test(o) ? "Bien" : o && /servicio/i.test(o) ? "Servicio" : o ? tituloNatural(o) : null);

/** Un identificador en medio de una frase: verde y subrayado, para que se vea que lleva a su ficha. */
const CLASE_EN_LINEA = "font-medium text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";
/** El mismo, dentro de «En una frase», que ya va en negrita: sin el peso propio (el enlace quedaba más fino que la frase). */
const CLASE_FRASE = "text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";
/** El mismo enlace como valor de un dato: verde, sin subrayado hasta pasar el puntero. */
const CLASE_DATO = "font-semibold text-granate underline-offset-2 hover:underline";

const enlace = (nombre: string, href: string | null, clase: string): ReactNode =>
  href ? (
    <Link href={href} prefetch={false} className={clase}>
      {nombre}
    </Link>
  ) : (
    nombre
  );

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const mayuscula = (s: string) => s.charAt(0).toLocaleUpperCase("es") + s.slice(1);
/** Sólo la primera letra: «Leído por la IA» → «leído por la IA» (un toLowerCase entero dejaba «la ia» y «el seace»). */
const minuscula = (s: string) => s.charAt(0).toLocaleLowerCase("es") + s.slice(1);
const veces = (r: number) => String(Math.round(r * 10) / 10).replace(".", ",");
/** «23:03» de «2026-08-20T23:03» (la hora de Lima que guarda la API); nada si sólo hay fecha. */
const hora = (s: string | null | undefined) => (s && /T\d{2}:\d{2}/.test(s) ? s.slice(11, 16) : null);

const TIPO_DOC: Record<string, string> = { orden_de_compra: "Orden de compra", orden_de_servicio: "Orden de servicio", contrato: "Contrato" };
const TIPO_DOC_ARTICULO: Record<string, string> = { orden_de_compra: "la orden de compra", orden_de_servicio: "la orden de servicio", contrato: "el contrato" };
const TIPO_REQ: Record<string, string> = { terminos_de_referencia: "Términos de referencia", especificaciones_tecnicas: "Especificaciones técnicas" };

/** Lo que la IA leyó en el requerimiento, sólo si de verdad es un requerimiento. */
const requerimientoLeido = (f: FichaMenor): Record<string, any> | null => {
  const r = f.lecturas.tdr?.salida as Record<string, any> | undefined;
  return r?.es_requerimiento ? r : null;
};
/** Lo que la IA leyó en el contrato u orden, sólo si de verdad es un contrato o una orden. */
const contratoLeido = (f: FichaMenor): Record<string, any> | null => {
  const c = f.lecturas.contrato?.salida as Record<string, any> | undefined;
  return c?.es_contrato ? c : null;
};
const leidoTxt = (l: LecturaMenor) =>
  `Leído por la IA (${l.modelo.replace(/-\d{8}$/, "")}) el ${fechaConAnio(l.leido)}${l.paginas ? `, ${plural(l.paginas, "página", "páginas")}` : ""}.`;
/** Cuánto llevaba el proveedor en la SUNAT al firmar: «4 meses», «28 años». */
const antiguedadTxt = (dias: number) =>
  dias < 60 ? plural(dias, "día", "días") : dias < 730 ? plural(Math.floor(dias / 30.44), "mes", "meses") : plural(Math.floor(dias / 365.25), "año", "años");

/** Las banderas de la cabecera: inhabilitado al firmar, las señales del contrato y lo de la SUNAT. */
export function banderasMenor(f: FichaMenor): BanderaFicha[] {
  const m = f.menor;
  const out: BanderaFicha[] = [];
  if (m.inhabilitacion) out.push({ tipo: "inhabilitado", severidad: "alta", nombre: "Inhabilitado por el Tribunal al firmar", href: "#antecedentes" });
  for (const s of ordenarSenalesMenor(f.senales)) {
    const t = textoSenal(s);
    out.push({ tipo: s.tipo, severidad: s.severidad, nombre: t.nombre, explica: t.explica, href: `#senal-${s.tipo}`, n: s.grupo?.length ?? null });
  }
  for (const a of antecedentesSunat(m)) out.push({ tipo: a.tipo, severidad: a.severidad, nombre: a.titulo, explica: a.explica, href: "#antecedentes" });
  return out;
}

/**
 * La bajada del encabezado: qué es y su código. Antes llevaba la entidad, el proveedor y el monto; ahora los cuenta, en
 * verde y con su ficha, «En una frase», justo debajo (dos veces lo mismo, una sobre otra, era apilar).
 */
export function BajadaMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const objeto = objetoTxt(m.objeto);
  return (
    <>
      Contrato menor
      {m.codigo && (
        <>
          {" "}
          <span className="font-mono" translate="no">{m.codigo}</span>
        </>
      )}
      {objeto ? ` (${objeto.toLocaleLowerCase("es")})` : ""}, registrado en el SEACE.
    </>
  );
}

// ─── El título y el objeto entero ──────────────────────────────────────────────

/** Hasta cuántos caracteres va la descripción en el título: los hay de 500 (13 líneas en escritorio, 22 en el celular). */
const TOPE_TITULO = 110;

/**
 * El título de la ficha: la descripción que registró la entidad, recortada en una palabra. Entera va en el cuerpo
 * (`ObjetoMenor` en «Pedido y contrato» debajo de xl; «Datos del contrato», en la columna lateral, desde xl).
 */
export function tituloMenor(f: FichaMenor): string {
  const m = f.menor;
  return m.descripcion ? recortarEnPalabra(oracion(m.descripcion), TOPE_TITULO) : `Contrato menor ${m.codigo ?? m.id}`;
}

/** La descripción entera, si el título la recortó. */
const objetoLargo = (f: FichaMenor): string | null => {
  const d = f.menor.descripcion ? oracion(f.menor.descripcion).replace(/\s+/g, " ").trim() : null;
  return d && d.length > TOPE_TITULO ? d : null;
};

/** El objeto entero, en su caja: lo que el título recortó. */
export function ObjetoMenor({ f, className }: { f: FichaMenor; className?: string }) {
  const objeto = objetoLargo(f);
  if (!objeto) return null;
  return (
    <section aria-label="El objeto del contrato, completo" className={cn("rounded-xl border border-line bg-paper px-4 py-3", className)}>
      <h3 className="font-display text-cuerpo font-bold text-ink">El objeto, como lo registró la entidad</h3>
      <p className="mt-1 text-dato leading-relaxed text-ink">{objeto}</p>
    </section>
  );
}

// ─── En una frase ─────────────────────────────────────────────────────────────

/**
 * La señal más grave como segunda oración del veredicto: lo que pasó, con su cifra, sin la explicación entera (está en su
 * tarjeta). Empieza en minúscula: va después de «Pero » (alta y media) o se le pone la mayúscula (baja).
 */
function fraseSenal(s: SenalMenor, f: FichaMenor): ReactNode {
  const d = s.detalle as Record<string, any>;
  const tope = num(d.tope) ?? f.menor.tope ?? null;
  const topeTxt = tope ? ` (${soles(tope)})` : "";
  const doc = TIPO_DOC_ARTICULO[d.tipo_documento as string] ?? "el contrato u orden";
  const contratos = num(s.contratos) ?? num(d.contratos);
  switch (s.tipo) {
    case "tdr_proveedor_nombrado":
      return "su requerimiento ya decía a quién contratar antes de pedir cotizaciones.";
    case "menor_orden_antes_de_cotizar": {
      const dias = num(d.dias);
      return `la orden de pago se emitió${dias ? ` ${plural(dias, "día", "días")}` : ""} antes de pedir cotizaciones: la compra ya estaba decidida.`;
    }
    case "contrato_monto_distinto": {
      const enDoc = num(d.en_documento);
      return `${doc} que subió dice ${soles(enDoc)}${enDoc != null && tope && enDoc > tope ? `, más que el tope de 8 UIT${topeTxt}` : ""}.`;
    }
    case "contrato_ruc_distinto": {
      const r20 = typeof d.ruc_en_documento === "string" && /^20\d{9}$/.test(d.ruc_en_documento) ? d.ruc_en_documento : null;
      return (
        <>
          {doc} que subió es con otro proveedor
          {r20 && <> (RUC {enlace(r20, enlaceProveedor(r20), cn("font-mono", CLASE_FRASE))})</>}.
        </>
      );
    }
    case "contrato_documento_ajeno":
      return `${doc} que subió al SEACE es de otra compra: el documento de ésta no está publicado.`;
    case "menor_partido_mismo_dia":
      return `la entidad cotizó el mismo día ${contratos ? numero(contratos) : "varios"} contratos menores con este proveedor que juntos suman ${soles(s.monto)}, más que el tope de 8 UIT${topeTxt}.`;
    case "menor_partido_en_el_anio":
      return `en ${num(d.anio) ?? f.menor.anio ?? "el año"} la entidad le dio ${contratos ? numero(contratos) : "varios"} contratos menores del mismo tipo que suman ${soles(s.monto)}, más que el tope de 8 UIT${topeTxt}.`;
    case "menor_sobre_tope":
      return `el monto pasa el tope de 8 UIT${topeTxt}: un contrato menor no debería.`;
    case "menor_borde_tope":
      return `el monto queda en el ${pctTxt(num(s.pct) ?? num(d.pct))} del tope de 8 UIT.`;
    case "menor_ventana_corta": {
      const h = num(s.horas) ?? num(d.horas) ?? f.menor.cotizaHoras ?? null;
      return `la cotización estuvo abierta sólo ${h != null ? duracion(h) : "unas horas"}.`;
    }
    case "menor_precio_alto": {
      const p = (d.peor ?? {}) as Record<string, unknown>;
      const r = num(p.razon);
      return txt(p.descripcion) && r
        ? `pagó «${oracion(String(p.descripcion))}» a ${veces(r)} veces lo que pagan otras entidades por lo mismo.`
        : "pagó un ítem a más del doble de lo que pagan otras entidades por lo mismo.";
    }
    case "tdr_marca_sin_equivalente":
      return "su requerimiento exige una marca sin admitir «o equivalente».";
    case "tdr_monto_distinto":
      return `el monto registrado no cuadra con el que estimaba su requerimiento${num(d.estimado) ? ` (${soles(num(d.estimado))})` : ""}.`;
    case "tdr_experiencia_alta":
      return `su requerimiento exige al proveedor una experiencia de ${soles(s.monto)} o más: 3 veces el monto del contrato o más.`;
    case "menor_invitacion_cerrada":
      return "no abrió la cotización a todos: invitó sólo a quienes eligió.";
    case "menor_fin_de_semana":
      return `se firmó un ${txt(d.dia) ?? "fin de semana"}.`;
    default:
      return `${minuscula(textoSenal(s).nombre)}.`;
  }
}

/**
 * El veredicto, arriba de todo (`EnUnaFrase`): «<Entidad> contrató a <Proveedor> para «<objeto>» por S/ X, sin
 * procedimiento de selección (hasta 8 UIT).» y, como segunda oración, lo más grave que encontramos, con el tono de esa
 * señal. Debajo, los datos que lo sostienen: el monto contra el tope, la firma, las horas para cotizar y la invitación.
 */
export function FraseMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const fichas = fichasCompra(rutaMenor(m.id), m.entidadRuc, m.proveedorRuc);
  const entidad = m.entidad ? enlace(tituloNatural(m.entidad), fichas.entidad, CLASE_FRASE) : "La entidad";
  const proveedor = m.proveedor ? enlace(tituloNatural(m.proveedor), fichas.proveedor, CLASE_FRASE) : null;
  // Sin el objeto entre comillas: es el título, justo encima, y la frase lo repetía recortado casi igual (auditoría del
  // 2026-11-13). Entero va en el cuerpo (ObjetoMenor y «Datos del contrato»).
  const verbo = proveedor ? (
    /bien/i.test(m.objeto ?? "") ? <> le compró a {proveedor}</> : <> contrató a {proveedor}</>
  ) : (
    <> firmó un contrato menor</>
  );

  const senales = ordenarSenalesMenor(f.senales);
  const tono: Nivel | "neutro" = m.inhabilitacion ? "alta" : senales[0]?.severidad ?? "neutro";
  const disp = fechasDispares(f);
  const dispar = disp.orden ?? disp.documento;
  let segunda: ReactNode;
  let resto = senales.length;
  if (m.inhabilitacion) {
    segunda = "Pero el Tribunal de Contrataciones tenía inhabilitado al proveedor el día de la firma.";
  } else if (senales.length) {
    const s = senales[0];
    const cuerpo = fraseSenal(s, f);
    segunda = s.severidad === "baja" && typeof cuerpo === "string" ? mayuscula(cuerpo) : <>Pero {cuerpo}</>;
    resto -= 1;
  } else if (dispar) {
    segunda = `No encontramos señales, pero ${dispar.de === "orden" ? "su orden de pago" : "el documento que subió"} es ${lapsoTxt(Math.abs(dispar.dias))} ${dispar.dias < 0 ? "anterior" : "posterior"} a la firma que registró: lo cuenta «Qué pasó».`;
  } else {
    segunda = `No encontramos señales en este contrato${f.lecturas.tdr || f.lecturas.contrato ? " ni en lo que la IA leyó en sus documentos" : ""}.`;
  }

  const invitacion = m.tipoInvitacion ? oracion(m.tipoInvitacion) : null;
  return (
    <EnUnaFrase
      tono={tono}
      datos={
        <>
          {m.monto != null && (
            <Dato icono={Banknote} nombre="Monto">
              <span className="font-mono tabular-nums text-ink">{soles(m.monto)}</span>
              {m.tope ? (m.sobreTope ? `, más que el tope de 8 UIT (${soles(m.tope)})` : `, el ${pctTxt((100 * m.monto) / m.tope)} del tope de 8 UIT`) : ""}
            </Dato>
          )}
          {m.fecha && <Dato tipo="fecha" nombre="Firmado">Firmado el {fechaConAnio(m.fecha)}</Dato>}
          {m.cotizaHoras != null && <Dato icono={Clock} nombre="Para cotizar">{duracion(m.cotizaHoras)} para cotizar</Dato>}
          {invitacion && <Dato icono={MailOpen} nombre="Invitación">{invitacion}</Dato>}
        </>
      }
      pie={senales.length || m.inhabilitacion ? "Son indicios para revisar, no prueban una irregularidad: la evidencia de cada uno está más abajo." : undefined}
    >
      {entidad}
      {verbo}
      {m.monto != null ? ` por ${soles(m.monto)}` : ""}, sin procedimiento de selección (hasta 8 UIT). {segunda}
      {resto > 0 && (
        <>
          {" "}
          <a href="#senales" className={CLASE_FRASE}>
            Y {plural(resto, "señal más", "señales más")}
          </a>
          .
        </>
      )}
    </EnUnaFrase>
  );
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
  const c = contratoLeido(f);
  return {
    orden: f.ordenes.map((o) => dispar("orden", ymd(o.fecha))).find((x) => x) ?? null,
    documento: c ? dispar("documento", ymd(c.fecha)) : null,
  };
}

/** Qué no cuadra y lo más probable, en una frase (el flotante de la bandera y el paso de la firma dicen lo mismo). */
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

/**
 * El documento que subió la entidad, por su tipo y número. El número, en verde, lleva a su orden de pago si hay una sola
 * juntada a este contrato menor (migración 240: el número del documento es esa orden; pedido del usuario del 2026-11-05:
 * «debería pintarse de verde el número para que podamos clickear»).
 */
function NombreDocumento({ f, c }: { f: FichaMenor; c: Record<string, any> }) {
  const tipo = TIPO_DOC[c.tipo_documento as string] ?? "Documento";
  const nro = txt(c.numero);
  const orden = f.ordenes.length === 1 ? f.ordenes[0] : null;
  if (!nro) return <>{tipo}</>;
  return (
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
  );
}

// ─── 1. Qué pasó ──────────────────────────────────────────────────────────────

type ClavePaso = "pedido" | "abre" | "cierre" | "documento" | "firma" | "orden" | "inicio" | "fin";
/** El orden de los pasos de un mismo día (y el de los que no tienen fecha). */
const RANGO_PASO: Record<ClavePaso, number> = { pedido: 0, abre: 1, cierre: 2, documento: 3, firma: 4, orden: 5, inicio: 6, fin: 7 };
type PasoMenor = PasoRelato & { clave: ClavePaso; senales: SenalPaso[] };

/**
 * En qué paso se ve cada señal. Las del requerimiento, al pedir cotizaciones (ahí se publicó lo que pide); la ventana
 * corta, al cerrar la cotización; la orden anterior a la cotización, en su orden (que la cronología pone antes del
 * pedido, por su fecha); el otro monto o el otro RUC, en el documento que lo dice. Las demás (la compra partida con su
 * grupo, el tope, el precio, el fin de semana), en la firma.
 */
const PASO_DE_SENAL: Record<string, ClavePaso> = {
  tdr_proveedor_nombrado: "pedido",
  tdr_marca_sin_equivalente: "pedido",
  tdr_experiencia_alta: "pedido",
  menor_invitacion_cerrada: "pedido",
  menor_ventana_corta: "cierre",
  menor_orden_antes_de_cotizar: "orden",
  contrato_monto_distinto: "documento",
  contrato_ruc_distinto: "documento",
  contrato_documento_ajeno: "documento",
};

/**
 * El pedido de cotizaciones en palabras: a qué hora, quién lo pidió, a quiénes se invitó (y por qué no a todos). Nada si
 * no hay qué decir (la cronología dibujaría un renglón vacío).
 */
function detallePedido(f: FichaMenor, abreAparte: boolean): ReactNode {
  const m = f.menor;
  const r = requerimientoLeido(f);
  const hp = hora(m.publicado);
  const hi = hora(m.cotizaInicio);
  const partes: string[] = [];
  if (hp) partes.push(!abreAparte && hi && hi !== hp ? `Lo publicó a las ${hp} y abrió la cotización a las ${hi}` : `Lo publicó a las ${hp}`);
  else if (hi && !abreAparte) partes.push(`Abrió la cotización a las ${hi}`);
  const area = txt(r?.area_usuaria) ?? (m.areaUsuaria ? tituloNatural(m.areaUsuaria) : null);
  if (area) partes.push(`Área que lo pidió: ${area}`);
  if (m.tipoInvitacion) {
    partes.push(/ABIERTA/i.test(m.tipoInvitacion)
      ? "Cualquier proveedor podía cotizar (invitación abierta)"
      : `Invitó sólo a los proveedores que eligió (${oracion(m.tipoInvitacion).toLocaleLowerCase("es")})`);
  }
  if (m.consultasHasta && ymd(m.consultasHasta)) partes.push(`Recibió consultas hasta el ${fechaHoraLima(m.consultasHasta)}`);
  if (!partes.length && !m.justifInvitacion) return undefined;
  return (
    <>
      {partes.length > 0 && `${partes.join(". ")}.`}
      {m.justifInvitacion && (
        <span className="mt-1 block border-l-2 border-line pl-3 italic">Por qué no fue abierta: «{oracion(m.justifInvitacion)}»</span>
      )}
    </>
  );
}

/** Los pasos del contrato menor, en orden, con sus señales pegadas (ver `PASO_DE_SENAL`). */
function pasosMenor(f: FichaMenor): PasoMenor[] {
  const m = f.menor;
  const c = contratoLeido(f);
  const fichas = fichasCompra(rutaMenor(m.id), m.entidadRuc, m.proveedorRuc);
  const pasos: PasoMenor[] = [];
  const nuevo = (p: Omit<PasoMenor, "senales">): PasoMenor => {
    const x: PasoMenor = { ...p, senales: [] };
    pasos.push(x);
    return x;
  };

  // Pidió cotizaciones. Si abrió la cotización otro día, ese es un paso aparte; si fue el mismo, va en el detalle.
  const fechaPedido = m.publicado ?? m.cotizaInicio ?? null;
  const abreAparte = !!(m.publicado && m.cotizaInicio && ymd(m.cotizaInicio) !== ymd(m.publicado));
  if (fechaPedido || f.senales.some((s) => PASO_DE_SENAL[s.tipo] === "pedido")) {
    nuevo({
      clave: "pedido",
      fecha: fechaPedido,
      cuando: "Sin fecha publicada",
      // Sin el PDF del requerimiento en el SEACE no se afirma que lo publicó: sólo el pedido de cotizaciones.
      titulo: m.tieneRequerimiento ? "Publicó el requerimiento y pidió cotizaciones" : "Pidió cotizaciones en el SEACE",
      detalle: detallePedido(f, abreAparte),
    });
  }
  if (abreAparte) nuevo({ clave: "abre", fecha: m.cotizaInicio, titulo: "Abrió la cotización", detalle: hora(m.cotizaInicio) ? `A las ${hora(m.cotizaInicio)}.` : undefined });
  if (m.cotizaCierre) {
    nuevo({
      clave: "cierre",
      fecha: m.cotizaCierre,
      titulo: m.cotizaHoras != null && m.cotizaHoras >= 0 ? `Cerró la cotización: estuvo abierta ${duracion(m.cotizaHoras)}` : "Cerró la cotización",
      detalle: m.cotizaInicio
        ? `Se podía cotizar del ${fechaHoraLima(m.cotizaInicio)} al ${fechaHoraLima(m.cotizaCierre)}.`
        : hora(m.cotizaCierre) ? `A las ${hora(m.cotizaCierre)}.` : undefined,
    });
  }

  // El documento que subió la entidad, si su fecha no es la de la firma registrada ni la de una de sus órdenes: así se ve
  // en su lugar (un contrato por S/ 229 mil fechado tres días antes de la firma de S/ 40 mil que registró).
  const fDoc = c ? ymd(c.fecha) : null;
  const docAparte = !!(c && fDoc && fDoc !== ymd(m.fecha) && !f.ordenes.some((o) => ymd(o.fecha) === fDoc));
  if (c && fDoc && docAparte) {
    const nro = txt(c.numero);
    const tipo = c.tipo_documento as string;
    const montoDoc = num(c.monto_total);
    const fPedido = ymd(fechaPedido);
    nuevo({
      clave: "documento",
      fecha: fDoc,
      titulo: /^orden_/.test(tipo)
        ? `Se emitió ${TIPO_DOC_ARTICULO[tipo]}${nro ? ` ${nro}` : ""}`
        : tipo === "contrato" ? `Se firmó el contrato${nro ? ` ${nro}` : ""}` : `Fecha del documento${nro ? ` ${nro}` : ""}`,
      detalle: `Es la fecha que lleva el documento que la entidad subió al SEACE${montoDoc != null ? `, por ${soles(montoDoc)}` : ""}.${fPedido && fDoc < fPedido ? " Es anterior al pedido de cotizaciones." : ""}`,
    });
  }

  // La firma que registró la entidad: el paso al que lleva la historia.
  const disp = fechasDispares(f);
  const dispar = disp.orden ?? disp.documento;
  const proveedor = m.proveedor ? enlace(tituloNatural(m.proveedor), fichas.proveedor, CLASE_EN_LINEA) : null;
  const monto = m.monto != null ? `, por ${soles(m.monto)}` : "";
  const mismaFecha = !!(c && fDoc && fDoc === ymd(m.fecha));
  const firma = nuevo({
    clave: "firma",
    fecha: ymd(m.fecha),
    cuando: "Sin fecha de firma",
    destacado: true,
    titulo: docAparte ? `Registró la firma en el SEACE${monto}` : `Se firmó el contrato${monto}`,
    detalle: proveedor || mismaFecha || dispar ? (
      <>
        {proveedor && <>Con {proveedor}{docAparte ? "" : ", según lo que la entidad registró en el SEACE"}.</>}
        {c && mismaFecha && (
          <> {mayuscula(TIPO_DOC_ARTICULO[c.tipo_documento as string] ?? "el documento")}{txt(c.numero) ? ` ${txt(c.numero)}` : ""} lleva la misma fecha.</>
        )}
        {dispar && <span className="mt-1 block text-amberTexto">{textoDispar(dispar, f)}</span>}
      </>
    ) : undefined,
  });

  for (const o of f.ordenes) {
    const { tipo, numero: n } = ordenCorta(o.orden, o.fecha);
    nuevo({
      clave: "orden",
      fecha: ymd(o.fecha),
      titulo: (
        <>
          Se emitió la orden de {tipo ?? "pago"}{" "}
          <Link href={hrefOrden(f, o)} prefetch={false} className={CLASE_EN_LINEA}>
            {n ? `N.° ${n}` : "en CONOSCE"}
          </Link>
        </>
      ),
      detalle: (
        <>
          En CONOSCE: <span className="break-words font-mono text-rotulo">{o.orden}</span>.
        </>
      ),
    });
  }
  // La orden de la señal «orden antes de cotizar» sale de la misma unión (migración 240); si no llegó, se arma con su evidencia.
  const antes = f.senales.find((s) => s.tipo === "menor_orden_antes_de_cotizar");
  const dAntes = (antes?.detalle ?? {}) as Record<string, any>;
  if (antes && !f.ordenes.length && ymd(dAntes.emitida)) {
    nuevo({ clave: "orden", fecha: ymd(dAntes.emitida), titulo: `Se emitió la orden de pago${txt(dAntes.orden) ? ` ${txt(dAntes.orden)}` : ""}` });
  }

  const desde = ymd(m.ejecucionDesde);
  const hasta = ymd(m.ejecucionHasta);
  if (desde) nuevo({ clave: "inicio", fecha: desde, titulo: "Empieza el plazo de ejecución" });
  if (hasta) {
    nuevo({
      clave: "fin",
      fecha: hasta,
      titulo: "Vence el plazo de ejecución",
      detalle: desde ? `${plural(Math.max(0, diasEntre(desde, hasta)), "día", "días")} de ejecución, según el SEACE.` : undefined,
    });
  }

  // Cada señal, a su paso; si ese paso no está (sin fechas de cotización, sin documento leído), a la firma.
  const de = (k: ClavePaso) => pasos.find((p) => p.clave === k);
  for (const s of ordenarSenalesMenor(f.senales)) {
    const d = s.detalle as Record<string, any>;
    const k = PASO_DE_SENAL[s.tipo] ?? "firma";
    const paso = k === "orden"
      ? pasos.find((p) => p.clave === "orden" && p.fecha === ymd(d.emitida)) ?? de("orden")
      : k === "cierre" ? de("cierre") ?? de("pedido") : de(k);
    const t = textoSenal(s);
    (paso ?? firma).senales.push({
      severidad: s.severidad,
      texto: s.grupo?.length ? `${t.chip}: ${plural(s.grupo.length, "contrato", "contratos")}` : t.chip,
      href: `#senal-${s.tipo}`,
    });
  }
  if (m.inhabilitacion) firma.senales.unshift({ severidad: "alta", texto: "Inhabilitado al firmar", href: "#antecedentes" });
  // No es una señal sino un dato dudoso: su chip ámbar va en la firma registrada, que es la fecha en duda.
  if (dispar) firma.senales.push({ severidad: "media", texto: "Fecha que no cuadra" });

  // En orden de fecha (y, el mismo día, en el orden del trámite); los que no tienen fecha, en su lugar del trámite.
  const fechados = pasos
    .filter((p) => ymd(p.fecha))
    .sort((a, b) => ymd(a.fecha)!.localeCompare(ymd(b.fecha)!) || RANGO_PASO[a.clave] - RANGO_PASO[b.clave] || (a.fecha ?? "").localeCompare(b.fecha ?? ""));
  for (const p of pasos.filter((x) => !ymd(x.fecha)).sort((a, b) => RANGO_PASO[a.clave] - RANGO_PASO[b.clave])) {
    const i = fechados.findIndex((q) => RANGO_PASO[q.clave] > RANGO_PASO[p.clave]);
    fechados.splice(i < 0 ? fechados.length : i, 0, p);
  }
  if (!pasos.some((p) => p.clave === "orden")) {
    fechados.push({
      clave: "orden",
      titulo: "Su orden de pago todavía no aparece en CONOSCE",
      detalle: "Se busca por el número de la orden y no siempre coincide.",
      falta: true,
      senales: [],
    });
  }
  return fechados;
}

/**
 * «Qué pasó»: la cronología del relato (`Cronologia`), la columna vertebral de la ficha. Reemplaza a la línea de hitos de
 * la columna lateral, que daba las fechas sin lo que pasó en cada una ni dónde se torcía la historia.
 */
export function CronologiaMenor({ f }: { f: FichaMenor }) {
  const pasos = pasosMenor(f);
  if (!pasos.some((p) => ymd(p.fecha))) {
    return <Nota icono={<CalendarClock size={16} aria-hidden />}>El SEACE no publicó las fechas de este contrato menor.</Nota>;
  }
  return <Cronologia pasos={pasos} etiqueta="Qué pasó en este contrato menor, paso a paso" />;
}

// ─── 2. Lo que se pidió y lo que se firmó ─────────────────────────────────────

/** Un dato en dos columnas: `ancho` lo pone a lo ancho de las dos (si no se dice, un texto largo va a lo ancho). */
type Par = DatoClave & { ancho?: boolean };

/**
 * Pares etiqueta → valor en dos columnas desde `sm` (la etiqueta arriba y chica): un valor largo ocupa las dos y los
 * cortos llenan los huecos (`grid-flow-row-dense`).
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

type EstadoDoc = "leido" | "no_es" | "sin_leer" | "sin_publicar";
const estadoDoc = (l: LecturaMenor | null, valido: boolean, publicado: boolean): EstadoDoc =>
  l && valido ? "leido" : l ? "no_es" : publicado ? "sin_leer" : "sin_publicar";
/** Lo que dice una celda vacía, según si el documento se leyó (no lo dice) o no (no se sabe). */
const VACIO: Record<EstadoDoc, string> = { leido: "No lo dice", no_es: "Sin dato", sin_leer: "Sin leer todavía", sin_publicar: "No se publicó" };
const ESTADO_REQ: Record<EstadoDoc, string> = {
  leido: "Leído por la IA",
  no_es: "El PDF que publicó no es un requerimiento",
  sin_leer: "La IA todavía no lo leyó",
  sin_publicar: "El SEACE no lo publicó",
};
const ESTADO_CON: Record<EstadoDoc, string> = {
  leido: "Leído por la IA, con lo que registró el SEACE",
  no_es: "El PDF no es un contrato ni una orden: va lo que registró el SEACE",
  sin_leer: "La IA todavía no lo leyó: va lo que registró el SEACE",
  sin_publicar: "El SEACE no lo publicó: va lo que registró",
};

type Marca = { tipo: Nivel | "dudoso"; texto: string; href?: string };
/** Un renglón de una celda: «En el documento: S/ 229,366». */
type Linea = { rotulo?: string; valor: ReactNode };
interface FilaComparada {
  etiqueta: string;
  pedido: Linea[];
  firmado: Linea[];
  tono?: Nivel | "dudoso";
  marcas?: Marca[];
}

const RANGO_TONO: Record<Nivel | "dudoso", number> = { alta: 0, media: 1, dudoso: 2, baja: 3 };
const peorTono = (xs: (Nivel | "dudoso" | null | undefined)[]) =>
  xs.filter((x): x is Nivel | "dudoso" => !!x).sort((a, b) => RANGO_TONO[a] - RANGO_TONO[b])[0];
const TONO_FILA: Record<Nivel | "dudoso", string> = {
  alta: "bg-crimson-soft/40",
  media: "bg-amber-soft/40",
  dudoso: "bg-amber-soft/25",
  baja: "bg-paperSoft",
};
const CLASE_MARCA: Record<Nivel | "dudoso", string> = {
  alta: "border-crimson/30 bg-crimson-soft text-crimsonTexto",
  media: "border-amber/30 bg-amber-soft text-amberTexto",
  dudoso: "border-amber/30 bg-amber-soft text-amberTexto",
  baja: "border-line bg-paperSoft text-inkSoft",
};

/** Por qué se resalta un renglón: la señal (con su evidencia, en su tarjeta) o «No coincide». Parte en dos renglones si no entra. */
function ChipMarca({ m }: { m: Marca }) {
  const Icono = m.tipo === "dudoso" ? TriangleAlert : ICONO_NIVEL[m.tipo];
  const cuerpo = (
    <>
      <Icono size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span className="sr-only">{m.tipo === "dudoso" ? "Dato que no cuadra" : `Señal ${m.tipo}`}: </span>
      <span className="min-w-0">{m.texto}</span>
    </>
  );
  const clase = cn("inline-flex max-w-full items-start gap-1 rounded-xl border px-2 py-0.5 text-rotulo font-semibold leading-snug", CLASE_MARCA[m.tipo]);
  return m.href ? (
    <a href={m.href} className={cn(clase, "hover:underline")}>
      {cuerpo}
    </a>
  ) : (
    <span className={clase}>{cuerpo}</span>
  );
}

function Lineas({ lineas, vacio }: { lineas: Linea[]; vacio: string }) {
  if (!lineas.length) return <span className="text-mute">{vacio}</span>;
  return (
    <>
      {lineas.map((l, i) => (
        <span key={i} className={cn("block", i > 0 && "mt-1")}>
          {l.rotulo && <span className="text-mute">{l.rotulo}: </span>}
          <span className="text-ink">{l.valor}</span>
        </span>
      ))}
    </>
  );
}

const cifra = (s: string) => <span className="font-mono tabular-nums">{s}</span>;
const PERFIL_TIPO: Record<string, string> = { persona_natural: "Una persona natural", empresa: "Una empresa" };

/** Los renglones de la comparación: los que tienen algo de un lado o del otro, con los que no coinciden resaltados. */
function filasComparadas(f: FichaMenor): FilaComparada[] {
  const m = f.menor;
  // Tipado a mano: `x ?? {}` podía quedar como `{}` y entonces `r.objeto` no existía para TypeScript.
  const r: Record<string, any> = requerimientoLeido(f) ?? {};
  const c = contratoLeido(f);
  const fichas = fichasCompra(rutaMenor(m.id), m.entidadRuc, m.proveedorRuc);
  const senal = (tipo: string) => f.senales.find((s) => s.tipo === tipo) ?? null;
  const marca = (s: SenalMenor | null): Marca | null => (s ? { tipo: s.severidad, texto: textoSenal(s).chip, href: `#senal-${s.tipo}` } : null);
  const filas: FilaComparada[] = [];
  const poner = (x: FilaComparada) => {
    if (x.pedido.length || x.firmado.length) filas.push({ ...x, marcas: x.marcas?.filter(Boolean) as Marca[] | undefined });
  };

  // Qué documento es, con su fecha frente a la firma registrada.
  const dispDoc = fechasDispares(f).documento;
  const fDoc = c ? ymd(c.fecha) : null;
  // El PDF es de otra compra (otro RUC y otro monto a la vez): lo dice el primer renglón y los demás lo llevan de fondo.
  const ajeno = senal("contrato_documento_ajeno");
  poner({
    etiqueta: "Qué documento es",
    pedido: r.es_requerimiento ? [{ valor: TIPO_REQ[r.tipo as string] ?? "Requerimiento" }] : [],
    firmado: [
      ...(c ? [{ valor: <NombreDocumento f={f} c={c} /> }] : []),
      ...(fDoc
        ? [{
            rotulo: "Fecha",
            valor: (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                {cifra(fechaConAnio(fDoc))}
                {dispDoc && <BanderaFecha texto={textoDispar(dispDoc, f)} />}
              </span>
            ),
          }]
        : []),
      ...(m.fecha ? [{ rotulo: "Firma en el SEACE", valor: cifra(fechaConAnio(m.fecha)) }] : []),
    ],
    tono: peorTono([ajeno?.severidad, dispDoc ? "dudoso" : null]),
    marcas: [marca(ajeno)].filter(Boolean) as Marca[],
  });

  // Qué se pide frente a lo que dice el documento y a lo que registró el SEACE (2370416: el contrato es por un puente y
  // el registro, por un canal de riego).
  const lineasDoc: { descripcion: string }[] = c && Array.isArray(c.items) ? c.items : [];
  poner({
    etiqueta: "Qué se pide",
    pedido: txt(r.objeto) ? [{ valor: txt(r.objeto) }] : [],
    firmado: [
      ...(lineasDoc.length && txt(lineasDoc[0].descripcion)
        ? [{
            rotulo: "En el documento",
            valor: `${oracion(lineasDoc[0].descripcion)}${lineasDoc.length > 1 ? `, y ${plural(lineasDoc.length - 1, "línea más", "líneas más")}` : ""}`,
          }]
        : []),
      ...(m.descripcion ? [{ rotulo: "En el SEACE", valor: oracion(m.descripcion) }] : []),
    ],
    tono: ajeno?.severidad,
  });

  // El monto: el que estima el requerimiento, el del documento y el registrado.
  const estimado = num(r.monto_estimado);
  const enDoc = c ? num(c.monto_total) : null;
  const registrado =
    m.monto != null ? (
      <>
        {cifra(soles(m.monto))}
        {m.tope ? (m.sobreTope ? `, más que el tope de 8 UIT (${soles(m.tope)})` : `, el ${pctTxt((100 * m.monto) / m.tope)} del tope de 8 UIT`) : ""}
      </>
    ) : null;
  const montoDistinto = senal("contrato_monto_distinto");
  const montoTdr = senal("tdr_monto_distinto");
  poner({
    etiqueta: "Monto",
    pedido: estimado != null ? [{ rotulo: "Estima", valor: cifra(soles(estimado)) }] : [],
    firmado:
      enDoc != null && m.monto != null && Math.abs(enDoc - m.monto) < 1
        ? [{ rotulo: "En el documento y en el SEACE", valor: registrado }]
        : [
            ...(enDoc != null
              ? [{ rotulo: "En el documento", valor: <>{cifra(soles(enDoc))}{m.tope && enDoc > m.tope ? ", más que el tope de 8 UIT" : ""}</> }]
              : []),
            ...(registrado ? [{ rotulo: "En el SEACE", valor: registrado }] : []),
          ],
    tono: peorTono([montoDistinto?.severidad, montoTdr?.severidad, ajeno?.severidad]),
    marcas: [marca(montoDistinto), marca(montoTdr)].filter(Boolean) as Marca[],
  });

  // El proveedor: si el requerimiento ya lo nombraba, quién ganó y con qué RUC está el documento. El RUC del documento
  // sólo si es de una empresa (RUC 20): el de una persona lleva su DNI.
  const nombrado = senal("tdr_proveedor_nombrado");
  const rucDistinto = senal("contrato_ruc_distinto") ?? ajeno;
  const marcaRuc = rucDistinto && rucDistinto !== ajeno ? marca(rucDistinto) : null;
  const pn = (r.proveedor_nombrado ?? {}) as Record<string, any>;
  const perfilTipo = PERFIL_TIPO[((r.perfil_proveedor ?? {}) as Record<string, any>).tipo as string];
  const citaNombrado = nombrado ? txt((nombrado.detalle as Record<string, unknown>).cita) : null;
  const rucDoc = c ? String(c.proveedor_ruc ?? "").trim() : "";
  const r20 = (() => {
    const x = rucDistinto ? (rucDistinto.detalle as Record<string, unknown>).ruc_en_documento : null;
    return typeof x === "string" && /^20\d{9}$/.test(x) ? x : null;
  })();
  poner({
    etiqueta: "Proveedor",
    pedido: [
      ...(nombrado
        ? [{ valor: <>Nombra a quién contratar{citaNombrado && <>: <span className="italic">«{citaNombrado}»</span></>}</> }]
        : r.es_requerimiento && pn.nombrado === false ? [{ valor: "No nombra a quién contratar" }]
        : r.es_requerimiento && pn.nombrado === true ? [{ valor: "Dos lecturas de la IA no coinciden en si nombra a quién contratar" }]
        : []),
      ...(perfilTipo ? [{ rotulo: "Pide", valor: perfilTipo }] : []),
    ],
    firmado: [
      ...(m.proveedor ? [{ rotulo: "Ganó", valor: enlace(tituloNatural(m.proveedor), fichas.proveedor, CLASE_EN_LINEA) }] : []),
      ...(rucDistinto
        ? [{
            rotulo: "En el documento",
            valor: r20 ? (
              <>otro RUC: {enlace(r20, enlaceProveedor(r20), cn("font-mono", CLASE_EN_LINEA))}</>
            ) : esRucPersonaNatural(rucDoc) ? (
              "otro RUC, de una persona natural (no lo mostramos: lleva su DNI)"
            ) : (
              "otro RUC"
            ),
          }]
        : rucDoc && m.proveedorRuc && rucDoc === m.proveedorRuc ? [{ rotulo: "En el documento", valor: "el mismo RUC" }]
        : []),
    ],
    tono: peorTono([nombrado?.severidad, rucDistinto?.severidad]),
    marcas: [marca(nombrado), marcaRuc].filter(Boolean) as Marca[],
  });

  // Lo que se exige al proveedor, frente a quién es el que ganó (cuánto llevaba en la SUNAT al firmar).
  const perfil = (r.perfil_proveedor ?? {}) as Record<string, any>;
  const requisitos: unknown[] = Array.isArray(r.requisitos) ? r.requisitos : [];
  const marcasReq: { marca: string; con_equivalente: boolean }[] = Array.isArray(r.marcas) ? r.marcas : [];
  const experiencia = senal("tdr_experiencia_alta");
  const marcaSinEq = senal("tdr_marca_sin_equivalente");
  const quien = [m.provTipo ? oracion(m.provTipo) : null, m.provDesde ? `en la SUNAT desde ${fechaConAnio(m.provDesde)}` : null].filter(Boolean).join(", ");
  const exige: Linea[] = [
      ...(txt(perfil.formacion) ? [{ rotulo: "Formación", valor: txt(perfil.formacion) }] : []),
      ...(num(perfil.experiencia_anios) != null ? [{ rotulo: "Experiencia", valor: plural(num(perfil.experiencia_anios)!, "año", "años") }] : []),
      ...(num(perfil.experiencia_monto) != null ? [{ rotulo: "Facturación", valor: cifra(soles(num(perfil.experiencia_monto))) }] : []),
      ...(requisitos.length ? [{ rotulo: "Requisitos", valor: `${plural(requisitos.length, "requisito", "requisitos")}, en el detalle de abajo` }] : []),
      ...(marcasReq.length
        ? [{ rotulo: "Marcas", valor: marcasReq.map((x) => `${x.marca}${x.con_equivalente ? " (o equivalente)" : " (sin «o equivalente»)"}`).join(", ") }]
        : []),
  ];
  poner({
    etiqueta: exige.length ? "Lo que exige al proveedor" : "Quién es el proveedor",
    pedido: exige,
    firmado: [
      ...(quien ? [{ rotulo: exige.length ? "Quién ganó" : "En la SUNAT", valor: quien }] : []),
      ...(m.provDiasAlGanar != null && m.provDiasAlGanar >= 0 ? [{ rotulo: "Al firmar", valor: `llevaba ${antiguedadTxt(m.provDiasAlGanar)} en la SUNAT` }] : []),
    ],
    tono: peorTono([marcaSinEq?.severidad, experiencia?.severidad]),
    marcas: [marca(marcaSinEq), marca(experiencia)].filter(Boolean) as Marca[],
  });

  // El plazo: el que pide el requerimiento, el del documento y la ejecución que registró el SEACE.
  const plazoReq = num(r.plazo_dias);
  const plazoDoc = c ? num(c.plazo_dias) : null;
  const ejecucion = ymd(m.ejecucionDesde) && ymd(m.ejecucionHasta) ? `del ${fechaConAnio(m.ejecucionDesde)} al ${fechaConAnio(m.ejecucionHasta)}` : null;
  const plazoDistinto = plazoReq != null && plazoDoc != null && plazoReq !== plazoDoc;
  poner({
    etiqueta: "Plazo",
    pedido: plazoReq != null ? [{ valor: plural(plazoReq, "día", "días") }] : [],
    firmado: [
      ...(plazoDoc != null ? [{ rotulo: "En el documento", valor: plural(plazoDoc, "día", "días") }] : []),
      ...(ejecucion ? [{ rotulo: "En el SEACE", valor: ejecucion }] : []),
    ],
    tono: plazoDistinto ? "dudoso" : undefined,
    marcas: plazoDistinto ? [{ tipo: "dudoso", texto: "No coincide" }] : undefined,
  });

  poner({
    etiqueta: "Penalidad",
    pedido: txt(r.penalidad) ? [{ valor: txt(r.penalidad) }] : [],
    firmado: c && txt(c.penalidad) ? [{ valor: oracion(txt(c.penalidad)!) }] : [],
  });
  return filas;
}

/**
 * El requerimiento y el contrato, lado a lado (desde md): un renglón por cosa comparable (qué documento, qué se pide, el
 * monto, el proveedor, lo que se exige, el plazo, la penalidad), con los que no coinciden resaltados y su señal al lado.
 * Aquí es donde rinde lo que leyó la IA: «el requerimiento ya nombraba a quién contratar» frente a «ganó X»; «estima
 * S/ 30 mil» frente a «el documento dice S/ 229 mil y el SEACE, S/ 40 mil». En el celular cada renglón se apila, con el
 * nombre de cada columna encima de su valor.
 */
function Comparacion({ f, filas, er, ec }: { f: FichaMenor; filas: FilaComparada[]; er: EstadoDoc; ec: EstadoDoc }) {
  const conPedido = er === "leido" || filas.some((x) => x.pedido.length > 0);
  const COLS = conPedido ? "md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]" : "md:grid-cols-[10rem_minmax(0,1fr)]";
  return (
    <div className="space-y-2">
      {/* En el celular no hay cabecera de columnas: el estado de cada documento, en una línea. */}
      <p className="text-rotulo text-mute md:hidden">
        El requerimiento: {minuscula(ESTADO_REQ[er])}. El contrato u orden: {minuscula(ESTADO_CON[ec])}.
      </p>
      <div className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
        <div aria-hidden className={cn("hidden gap-x-4 border-b border-line bg-paperSoft px-4 py-2.5 md:grid", COLS)}>
          <span />
          {conPedido && (
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-meta font-semibold text-ink">
                <FileText size={14} className="shrink-0 text-mute" aria-hidden />
                El requerimiento dice
              </span>
              <span className="block text-rotulo text-mute">{ESTADO_REQ[er]}</span>
            </span>
          )}
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-meta font-semibold text-ink">
              <FileSignature size={14} className="shrink-0 text-mute" aria-hidden />
              El contrato dice
            </span>
            <span className="block text-rotulo text-mute">{ESTADO_CON[ec]}</span>
          </span>
        </div>
        <dl className="divide-y divide-line">
          {filas.map((x) => (
            <div key={x.etiqueta} className={cn("grid gap-x-4 gap-y-2 px-4 py-3", COLS, x.tono && TONO_FILA[x.tono])}>
              <dt className="min-w-0">
                <span className="block text-rotulo font-semibold text-ink">{x.etiqueta}</span>
                {x.marcas && x.marcas.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {x.marcas.map((mk) => (
                      <ChipMarca key={mk.texto} m={mk} />
                    ))}
                  </span>
                )}
              </dt>
              {conPedido && (
                <dd className="min-w-0 break-words text-meta leading-snug">
                  <span className="mb-0.5 block text-micro font-semibold text-mute md:sr-only">El requerimiento</span>
                  <Lineas lineas={x.pedido} vacio={VACIO[er]} />
                </dd>
              )}
              <dd className="min-w-0 break-words text-meta leading-snug">
                {conPedido && <span className="mb-0.5 block text-micro font-semibold text-mute md:sr-only">El contrato</span>}
                <Lineas lineas={x.firmado} vacio={VACIO[ec]} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {!conPedido && (
        <p className="hidden items-start gap-1.5 text-rotulo text-mute md:flex">
          <FileText size={14} className="mt-0.5 shrink-0" aria-hidden />
          Del requerimiento no hay con qué comparar: {minuscula(ESTADO_REQ[er])}.
        </p>
      )}
      {f.senales.length > 0 && filas.some((x) => x.marcas?.length) && (
        <p className="text-rotulo text-mute">Cada marca lleva a su señal, con la evidencia, en «Por qué llama la atención».</p>
      )}
    </div>
  );
}

/** Un documento entero, plegado debajo de la comparación: abierto, mostraba todo y la comparación quedaba enterrada. */
function Plegable({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="group/pleg tarjeta rounded-2xl border border-line bg-paper">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <h3 className="font-display text-cuerpo font-bold text-ink">{titulo}</h3>
        <ChevronDown size={18} className="shrink-0 text-mute transition-transform duration-rapido group-open/pleg:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-line p-4 sm:p-5">{children}</div>
    </details>
  );
}

/** El pie de un documento leído: quién lo leyó y dónde está su PDF (en «De dónde sale cada dato»). */
function PieLeido({ l }: { l: LecturaMenor }) {
  return (
    <p className="border-t border-line pt-3 text-rotulo text-mute">
      {leidoTxt(l)}{" "}
      <a href="#fuentes" className={CLASE_EN_LINEA}>
        El PDF, en «De dónde sale cada dato»
      </a>
      .
    </p>
  );
}

/** Todo lo que la IA leyó en el requerimiento (TDR o especificaciones técnicas). */
function DetalleRequerimiento({ f, r, l }: { f: FichaMenor; r: Record<string, any>; l: LecturaMenor }) {
  const m = f.menor;
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
    <>
      <DatosEnDos items={datos.filter(Boolean) as Par[]} />
      <div className="border-t border-line pt-3">
        <h4 className="font-display text-dato font-bold text-ink">
          Lo que se exige al proveedor{requisitos.length ? ` (${numero(requisitos.length)})` : ""}
        </h4>
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
      <PieLeido l={l} />
    </>
  );
}

/** Todo lo que la IA leyó en el contrato u orden: sus datos y sus líneas, con la bandera si su fecha no cuadra. */
function DetalleContrato({ f, c, l }: { f: FichaMenor; c: Record<string, any>; l: LecturaMenor }) {
  const items: { descripcion: string; cantidad: number | null; unidad: string; precio_unitario: number | null; subtotal: number | null }[] =
    Array.isArray(c.items) ? c.items : [];
  const dispar = fechasDispares(f).documento;
  const datos: (Par | null)[] = [
    { etiqueta: "Documento", valor: <NombreDocumento f={f} c={c} /> },
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
    <>
      <DatosEnDos items={datos.filter(Boolean) as Par[]} />
      {items.length > 0 && (
        <div className="border-t border-line pt-3">
          <h4 className="font-display text-dato font-bold text-ink">Sus líneas ({numero(items.length)})</h4>
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
      <PieLeido l={l} />
    </>
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
        <span className={`block font-semibold ${razon >= 2 ? "text-rust" : "text-amberTexto"}`}>{veces(razon)} veces la mediana</span>
      )}
    </span>
  );
}

/** Los ítems con su precio, frente a lo que pagan otras entidades por el mismo ítem del catálogo. */
function LoQueSeCompro({ f }: { f: FichaMenor }) {
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
 * «Lo que se pidió y lo que se firmó»: la comparación lado a lado; los ítems con su precio si el SEACE los publica; y,
 * plegado, todo lo que dice cada documento. Sin ninguno de los dos leídos no hay qué comparar: lo dice y sigue.
 */
export function PedidoYContrato({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const r = requerimientoLeido(f);
  const c = contratoLeido(f);
  const er = estadoDoc(f.lecturas.tdr, !!r, m.tieneRequerimiento);
  const ec = estadoDoc(f.lecturas.contrato, !!c, m.tieneContrato);
  const filas = filasComparadas(f);
  return (
    <div className="space-y-4">
      {/* El objeto entero (el título lo recorta): desde xl va en «Datos del contrato», en la columna lateral. */}
      <ObjetoMenor f={f} className="xl:hidden" />
      {r || c ? (
        <Comparacion f={f} filas={filas} er={er} ec={ec} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <Nota icono={<FileText size={16} aria-hidden />}>
            {er === "sin_publicar"
              ? "El SEACE no publicó el requerimiento de este contrato menor."
              : er === "no_es" ? "El PDF que publicó como requerimiento no lo es, según la IA."
              : "La IA todavía no leyó este requerimiento: lo que pide va a aparecer aquí cuando lo lea."}
          </Nota>
          <Nota icono={<FileSignature size={16} aria-hidden />}>
            {ec === "sin_publicar"
              ? "El SEACE no publicó el contrato u orden."
              : ec === "no_es" ? "El PDF que subió como contrato no es un contrato ni una orden, según la IA."
              : "La IA todavía no leyó este contrato u orden."}
          </Nota>
        </div>
      )}
      {f.items.length > 0 ? (
        <div className="space-y-2">
          <div>
            <h3 className="font-display text-cuerpo font-bold text-ink">Qué se compró y a qué precio</h3>
            <p className="text-meta text-inkSoft">Los ítems adjudicados, frente a lo que pagan otras entidades por lo mismo.</p>
          </div>
          <LoQueSeCompro f={f} />
        </div>
      ) : (
        <p className="text-rotulo text-mute">El SEACE todavía no publica los ítems de este contrato menor.</p>
      )}
      {(r || c) && (
        <div className="space-y-2">
          {r && f.lecturas.tdr && (
            <Plegable titulo="Todo lo que dice el requerimiento">
              <DetalleRequerimiento f={f} r={r} l={f.lecturas.tdr} />
            </Plegable>
          )}
          {c && f.lecturas.contrato && (
            <Plegable titulo="Todo lo que dice el contrato u orden">
              <DetalleContrato f={f} c={c} l={f.lecturas.contrato} />
            </Plegable>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 3. Por qué llama la atención ─────────────────────────────────────────────

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
 * historial del proveedor. Server-safe.
 */
function BarraGrupoTope({ grupo, actual, tope }: { grupo: ContratoDelGrupo[]; actual: number; tope: number | null }) {
  const tramos = [...grupo].filter((g) => g.monto > 0).sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "") || a.id - b.id);
  const suma = tramos.reduce((a, g) => a + g.monto, 0);
  if (!(suma > 0)) return null;
  const escala = Math.max(suma, tope ?? 0);
  const enTope = tope ? (100 * tope) / escala : null;
  const vecesTope = tope ? suma / tope : null;
  const relacion = vecesTope == null ? null : vecesTope >= 1.5 ? `${veces(vecesTope)} veces el tope` : `el ${porcentaje(vecesTope * 100)} del tope`;
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
    // Cada contrato se lista una vez: si todos están en el historial del proveedor, ahí van marcados y aquí sólo la barra.
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

/** Cada señal en su tarjeta, con su evidencia, de la más grave a la más leve (el mismo orden que «En una frase»). */
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
      {ordenarSenalesMenor(f.senales).map((s) => {
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

// ─── 4. Quién es el proveedor y qué más le compraron ──────────────────────────

const COLS_HIST: Columna[] = [
  { clave: "contrato", titulo: "Contrato menor", ancho: "minmax(0,1.6fr)" },
  { clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "lg", apilar: true },
  { clave: "fecha", titulo: "Firmado", ancho: "112px", desde: "md", apilar: "con-rotulo" },
  { clave: "monto", titulo: "Monto", ancho: "112px", alinear: "der" },
];

/**
 * Todos los contratos menores de la entidad con ese proveedor. Los de la compra partida de este contrato van marcados
 * aquí («En la compra partida») y no repetidos en su señal; lo de cada año, en una franja de cifras (siempre: antes la
 * del año de este contrato iba en las cifras de arriba de la ficha, que ya no están). Con uno solo, lo dice.
 */
function HistorialProveedor({ f }: { f: FichaMenor }) {
  if (f.historial.length <= 1) {
    return (
      <Nota icono={<ScanSearch size={16} aria-hidden />}>
        {f.historial.length === 1
          ? "Es el único contrato menor de la entidad con este proveedor."
          : "No pudimos buscar sus otros contratos menores: falta el RUC de la entidad o el del proveedor."}
      </Nota>
    );
  }
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
      {anios.length > 0 && <CifrasEnFila items={cifras} />}
      <Tabla columnas={COLS_HIST} filas={filas} etiqueta="Los contratos menores de la entidad con este proveedor" densidad="compacta" />
      {f.historial.length >= 80 && <p className="text-rotulo text-mute">Se muestran los 80 más recientes.</p>}
    </div>
  );
}

/**
 * Quién es el proveedor (su nombre en verde si es una empresa, RUC 20; el de una persona va tapado, sin RUC ni enlace:
 * su RUC lleva el DNI), lo que dice de él la SUNAT, si el Tribunal lo tenía inhabilitado al firmar (el destino de esas
 * banderas de la cabecera, `#antecedentes`) y todos sus contratos menores con la entidad (`#historial`).
 */
export function ProveedorMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  const fichas = fichasCompra(rutaMenor(m.id), m.entidadRuc, m.proveedorRuc);
  const empresa = /^20\d{9}$/.test(m.proveedorRuc ?? "");
  const natural = esRucPersonaNatural(m.proveedorRuc);
  const sunat = antecedentesSunat(m);
  const tipo = m.provTipo ? oracion(m.provTipo) : natural ? "Persona natural" : null;
  const enRegla = !sunat.length && /^ACTIVO/i.test(m.provEstado ?? "") && /^HABIDO/i.test(m.provCondicion ?? "");
  return (
    <div className="space-y-6">
      <article id="antecedentes" className="tarjeta scroll-mt-24 space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
        <div className="min-w-0">
          <h3 className="break-words font-display text-cuerpo font-bold text-ink">
            {m.proveedor ? enlace(tituloNatural(m.proveedor), fichas.proveedor, CLASE_DATO) : "Proveedor sin nombre en el SEACE"}
          </h3>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
            {/* El RUC sólo de una empresa: el de una persona natural lleva su DNI. */}
            {empresa && <Dato tipo="ruc" mono>{m.proveedorRuc}</Dato>}
            {tipo && <Dato tipo="tipo">{tipo}</Dato>}
            {m.provDesde && <Dato tipo="fecha" nombre="En la SUNAT desde">En la SUNAT desde {fechaConAnio(m.provDesde)}</Dato>}
            {m.provActividad && <Dato tipo="servicio" nombre="Actividad">{oracion(m.provActividad)}</Dato>}
          </p>
          {m.provDiasAlGanar != null && m.provDiasAlGanar >= 0 && (
            <p className="mt-1 text-meta text-inkSoft">Al firmar este contrato llevaba {antiguedadTxt(m.provDiasAlGanar)} en la SUNAT.</p>
          )}
        </div>
        {sunat.length > 0 && (
          <div className="border-t border-line pt-3">
            <h4 className="font-display text-dato font-bold text-ink">Lo que dice la SUNAT</h4>
            <ul className="mt-1.5 space-y-1.5 text-meta leading-snug">
              {sunat.map((a) => (
                <li key={a.tipo}>
                  <span className="font-semibold text-ink">{a.titulo}.</span> <span className="text-inkSoft">{a.explica}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {enRegla && <p className="border-t border-line pt-3 text-meta text-inkSoft">Hoy la SUNAT lo tiene activo y habido.</p>}
        {m.inhabilitacion && (
          <div className="border-t border-line pt-3 text-meta">
            <BloqueInhabilitacion
              i={m.inhabilitacion}
              ruc={empresa ? m.proveedorRuc : null}
              cuando={m.fecha ? `Firmó este contrato el ${fechaLarga(m.fecha)}` : "Firmó este contrato"}
              fecha={m.fecha}
              marca="Este contrato"
            />
          </div>
        )}
      </article>
      <div id="historial" className="scroll-mt-24 space-y-3">
        <div>
          <h3 className="font-display text-cuerpo font-bold text-ink">Sus contratos menores con esta entidad</h3>
          <p className="text-meta text-inkSoft">Una compra partida se ve aquí: varios contratos chicos que juntos pasan el tope.</p>
        </div>
        <HistorialProveedor f={f} />
      </div>
    </div>
  );
}

// ─── 5. De dónde sale cada dato ───────────────────────────────────────────────

/** Un dato de la tarjeta «Datos del contrato»: el rótulo arriba y el valor debajo. */
function DatoLado({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-rotulo text-mute">{k}</dt>
      <dd className="mt-0.5 break-words text-ink">{children}</dd>
    </div>
  );
}

/**
 * Lo que registró la entidad en el SEACE, a mano: la entidad y el proveedor (en verde, con su ficha), qué, cuánto,
 * cuándo, la invitación y el código. Desde xl va fija en la columna lateral mientras se lee la historia; debajo de xl,
 * en «De dónde sale cada dato» (la página la dibuja en los dos lugares y esconde uno: no lleva ids). Lo demás que antes
 * estaba aquí tiene su capítulo: lo de la SUNAT y la inhabilitación, en el del proveedor; la justificación de la
 * invitación, en el paso del pedido; las fuentes, al final.
 */
export function DatosMenor({ f, titulo = "Datos del contrato", nivel = "h2", conObjeto = false, className }: {
  f: FichaMenor;
  titulo?: string;
  nivel?: "h2" | "h3";
  /** Con la descripción entera bajo «Qué se contrató» (la de la columna lateral: el título la recorta). */
  conObjeto?: boolean;
  className?: string;
}) {
  const m = f.menor;
  const fichas = fichasCompra(rutaMenor(m.id), m.entidadRuc, m.proveedorRuc);
  const empresa = /^20\d{9}$/.test(m.proveedorRuc ?? "");
  const objeto = objetoTxt(m.objeto);
  return (
    <section aria-label={titulo} className={cn("rounded-2xl border border-line bg-paper", className)}>
      {nivel === "h2" ? (
        <h2 className="px-4 pt-3.5 font-display text-bloque font-bold text-ink">{titulo}</h2>
      ) : (
        <h3 className="px-4 pt-3.5 font-display text-cuerpo font-bold text-ink">{titulo}</h3>
      )}
      {/* Dos columnas en «De dónde sale cada dato» (debajo de xl) y una en la columna lateral (xl). */}
      <dl className="grid gap-x-6 gap-y-3 px-4 pb-3.5 pt-2.5 text-dato leading-5 sm:grid-cols-2 xl:grid-cols-1">
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
        </DatoLado>
        {(objeto || m.ccmnNombre || (conObjeto && objetoLargo(f))) && (
          <DatoLado k="Qué se contrató">
            {objeto ?? "Sin dato"}
            {conObjeto && objetoLargo(f) && <span className="mt-1 block text-meta leading-relaxed text-inkSoft">{objetoLargo(f)}</span>}
            {m.ccmnNombre && <span className="block text-rotulo text-mute">En el catálogo: {oracion(m.ccmnNombre)}</span>}
          </DatoLado>
        )}
        <DatoLado k="Monto">
          <span className="font-mono tabular-nums">{soles(m.monto)}</span>
          {m.tope != null && m.tope > 0 && m.monto != null && (
            <span className="block text-rotulo text-mute">
              {m.sobreTope ? `Más que el tope de 8 UIT (${soles(m.tope)})` : `El ${pctTxt((100 * m.monto) / m.tope)} del tope de 8 UIT (${soles(m.tope)})`}
            </span>
          )}
        </DatoLado>
        <DatoLado k="Firmado">{m.fecha ? <span className="font-mono tabular-nums">{fechaConAnio(m.fecha)}</span> : <span className="text-mute">Sin fecha</span>}</DatoLado>
        {m.tipoInvitacion && <DatoLado k="Invitación">{oracion(m.tipoInvitacion.replace(/^INVITACI[OÓ]N\s+/i, ""))}</DatoLado>}
        {(m.codigo || m.estadoProceso) && (
          <DatoLado k="Código SEACE">
            {m.codigo ? <span className="break-all font-mono text-meta" translate="no">{m.codigo}</span> : "Sin dato"}
            {m.estadoProceso && <span className="block text-rotulo text-mute">Estado del proceso: {m.estadoProceso}</span>}
          </DatoLado>
        )}
      </dl>
    </section>
  );
}

/** Un documento de la entidad: si la IA lo leyó y cuándo, y su PDF. */
function TarjetaDocumento({ icono, titulo, estado, pdf }: { icono: ReactNode; titulo: string; estado: string; pdf: { href: string; texto: string; icono: ReactNode } | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-paper p-4">
      <h3 className="flex items-center gap-2 font-display text-cuerpo font-bold text-ink">
        {icono}
        {titulo}
      </h3>
      <p className="text-meta text-inkSoft">{estado}</p>
      {pdf && (
        <a href={pdf.href} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario", "mt-auto w-fit")}>
          {pdf.icono} {pdf.texto}
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      )}
    </div>
  );
}

const estadoLectura = (l: LecturaMenor | null, valido: boolean, publicado: boolean, noEs: string) =>
  l && valido ? leidoTxt(l) : l ? `La IA lo leyó el ${fechaConAnio(l.leido)}: ${noEs}.` : publicado ? "La IA todavía no lo leyó." : "El SEACE no lo publicó.";

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

/**
 * «De dónde sale cada dato»: lo que registró el SEACE (debajo de xl; desde xl está en la columna lateral), los dos PDF
 * que subió la entidad con lo que leyó la IA en cada uno (el requerimiento, también dentro de la página desde `sm`), cómo
 * se publican las señales que salen de un documento y las fuentes para comprobarlo.
 */
export function FuentesMenor({ f }: { f: FichaMenor }) {
  const m = f.menor;
  return (
    <div className="space-y-4">
      <DatosMenor f={f} titulo="Lo que registró en el SEACE" nivel="h3" className="xl:hidden" />
      <div className="grid gap-3 md:grid-cols-2">
        <TarjetaDocumento
          icono={<FileText size={16} className="shrink-0 text-mute" aria-hidden />}
          titulo="El requerimiento"
          estado={estadoLectura(f.lecturas.tdr, !!requerimientoLeido(f), m.tieneRequerimiento, "el PDF que publicó la entidad no es un requerimiento")}
          pdf={m.tieneRequerimiento ? { href: urlRequerimiento(m.id), texto: "Abrir el requerimiento (PDF)", icono: <FileText className="size-4" aria-hidden /> } : null}
        />
        <TarjetaDocumento
          icono={<FileSignature size={16} className="shrink-0 text-mute" aria-hidden />}
          titulo="El contrato u orden"
          estado={estadoLectura(f.lecturas.contrato, !!contratoLeido(f), m.tieneContrato, "el PDF que subió la entidad no es un contrato ni una orden")}
          pdf={m.tieneContrato ? { href: urlContratoMenor(m.id), texto: "Abrir el contrato u orden (PDF)", icono: <FileSignature className="size-4" aria-hidden /> } : null}
        />
      </div>
      {m.tieneRequerimiento && (
        // El PDF dentro de la página, desde `sm` (en el celular, mejor en su propia pestaña).
        <details className="group/visor hidden sm:block">
          <summary className={cn("inline-flex min-h-8 cursor-pointer list-none items-center text-meta [&::-webkit-details-marker]:hidden", CLASE_EN_LINEA)}>
            <span className="group-open/visor:hidden">Ver el requerimiento aquí</span>
            <span className="hidden group-open/visor:inline">Ocultar el PDF</span>
          </summary>
          <iframe src={urlRequerimiento(m.id)} title="Requerimiento del contrato menor (PDF)" className="mt-2 h-[70vh] w-full rounded-xl border border-line" loading="lazy" />
        </details>
      )}
      <p className="text-rotulo text-mute">
        Lo que se pidió y lo que dice el contrato lo leyó la IA en esos PDF. Una señal que sale de un documento se publica
        sólo si dos lecturas independientes de la IA coinciden.
      </p>
      <FuenteMenor f={f} />
    </div>
  );
}
