"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Briefcase, Coins, ExternalLink, FileStack, FileText, HardHat, Loader2, RotateCw, Scale, ScanSearch, ShieldAlert, UserRound, UsersRound } from "lucide-react";
import { ConTapados, PersonName } from "@/components/Redact";
import { limpiarObjeto } from "@/components/contratos/recortar";
import { ListaPaginada, type Fila } from "@/components/listado";
import { Ayuda, AyudaTermino, CapitulosRelato, CitaDetalle, DatosClave, EnUnaFrase, FuenteDato, type CapituloRelato, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import {
  AVISO_PRESUNTA, QUE_ES_RESPONSABILIDAD, TIPO_RESPONSABILIDAD, pedirDetalleInforme, tipoServicioCorto,
  type DetalleInformeControl, type FichaInformeCorta, type ImplicadoInforme, type MontosInforme, type ObservacionInforme,
} from "@/lib/corrupcion";
import { BUSCADOR_CONTRALORIA } from "@/lib/fuentes";
import { fecha, listaY, numero, oracion, paraBuscar, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { cn } from "@/lib/utils";
import { ChipResponsabilidad, ChipTema, ChipsResponsabilidad } from "./piezas";

/**
 * Lo que encontró la Contraloría en UN informe de control, en el panel lateral de su fila (la pestaña Control de una
 * entidad, una región o un partido, y el buscador de /app/contraloria). Pedido del dueño del 2026-11-16: «implicados,
 * motivos» de cada informe, sin salir de la página.
 *
 * El panel monta sólo la fila abierta (DetalleFilas): al abrirse pide el informe entero a GET /informes-control/:codigo
 * (una vez por informe y por pestaña del navegador: `traer` guarda lo que llegó y junta los pedidos en curso). Mientras
 * llega, o si no llega, se ve lo que ya trae la fila (la ficha corta de la lista, con sus textos recortados).
 *
 * Se lee como un relato corto: una frase con lo esencial (cuántas observaciones, a cuántos funcionarios comprende y con
 * qué responsabilidad) y tres capítulos que se ven de a uno: «Lo que encontró» (las observaciones numeradas con su tema y
 * su perjuicio), «Quiénes» (los funcionarios comprendidos y su responsabilidad PRESUNTA) y «Qué revisó» (el objetivo, los
 * montos, quién lo emitió y la fuente). La Ficha Resumen y el informe completo van en el pie del panel.
 *
 * Privacidad: los nombres llegan con un apellido tapado (publicar() de la API) y así se pintan (`PersonName`). Ningún
 * `title`, `aria-label` ni id lleva el nombre de una persona, no se buscan ni se enlazan a otra ficha, y una empresa se
 * enlaza sólo con su RUC 20.
 */

// ─── El pedido del detalle, compartido por el cuerpo y el pie del panel ─────────────────────────

const listos = new Map<string, DetalleInformeControl | null>();
const enCurso = new Map<string, Promise<DetalleInformeControl | null>>();
const TOPE_GUARDADOS = 80;

function traer(codigo: string): Promise<DetalleInformeControl | null> {
  if (listos.has(codigo)) return Promise.resolve(listos.get(codigo) ?? null);
  let p = enCurso.get(codigo);
  if (!p) {
    p = pedirDetalleInforme(codigo)
      .then((d) => {
        listos.set(codigo, d);
        if (listos.size > TOPE_GUARDADOS) {
          const primero = listos.keys().next();
          if (!primero.done) listos.delete(primero.value);
        }
        return d;
      })
      .finally(() => enCurso.delete(codigo));
    enCurso.set(codigo, p);
  }
  return p;
}

interface EstadoDetalle {
  datos: DetalleInformeControl | null;
  /** Ya respondió (con el informe, con «no existe» o con un error). */
  listo: boolean;
  error: boolean;
}

function useDetalleInforme(codigo: string): EstadoDetalle & { reintentar: () => void } {
  const [estado, setEstado] = useState<EstadoDetalle>(() =>
    listos.has(codigo) ? { datos: listos.get(codigo) ?? null, listo: true, error: false } : { datos: null, listo: false, error: false },
  );
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vivo = true;
    if (listos.has(codigo)) {
      setEstado({ datos: listos.get(codigo) ?? null, listo: true, error: false });
      return;
    }
    setEstado({ datos: null, listo: false, error: false });
    traer(codigo)
      .then((datos) => vivo && setEstado({ datos, listo: true, error: false }))
      .catch(() => vivo && setEstado({ datos: null, listo: true, error: true }));
    return () => {
      vivo = false;
    };
  }, [codigo, intento]);
  return { ...estado, reintentar: () => setIntento((n) => n + 1) };
}

// ─── Lo que llega de la fila y lo que se arma con eso ──────────────────────────────────────────

/** Lo que la fila ya sabe del informe: lo de la lista de /corrupcion/* o lo de un resultado del buscador. */
export interface ResumenInforme {
  codigo: string;
  numero: string | null;
  titulo: string | null;
  fecha: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  responsabilidades: string[];
  funcionarios?: number | null;
  urlPdf?: string | null;
  urlResumen?: string | null;
  ficha?: FichaInformeCorta | null;
}

/** La observación (o el objetivo) que encontró el buscador: el panel la marca y abre su capítulo. */
export interface CoincidenciaBusqueda {
  texto: string;
  objetivo: boolean;
}

type ObservacionVista = ObservacionInforme;

/** El informe tal como se pinta: del detalle si ya llegó, si no de la fila. */
interface Vista {
  completo: boolean;
  numero: string;
  titulo: string | null;
  fecha: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  responsabilidades: string[];
  funcionarios: number | null;
  tipoServicio: string | null;
  unidadEmisora: string | null;
  objetivo: string | null;
  montos: MontosInforme | null;
  rotulo: string | null;
  observaciones: ObservacionVista[];
  recomendaciones: number | null;
  implicados: ImplicadoInforme[] | null;
  leidoIa: string | null;
  ficha: boolean;
}

function vistaDe(r: ResumenInforme, d: DetalleInformeControl | null): Vista {
  const numeroInforme = d?.numero ?? r.numero ?? r.codigo;
  if (d) {
    return {
      completo: true,
      numero: numeroInforme,
      titulo: d.titulo ?? r.titulo,
      fecha: d.fecha ?? r.fecha,
      entidad: d.entidad ?? r.entidad,
      entidadRuc: d.entidadRuc ?? r.entidadRuc,
      responsabilidades: d.responsabilidades?.length ? d.responsabilidades : r.responsabilidades,
      funcionarios: d.funcionarios ?? r.funcionarios ?? null,
      tipoServicio: d.tipoServicioTexto ?? d.tipoServicio,
      unidadEmisora: d.unidadEmisora,
      objetivo: d.objetivo,
      montos: d.montos ?? null,
      rotulo: d.observacionesRotulo,
      observaciones: d.observaciones ?? [],
      recomendaciones: d.ficha ? d.recomendaciones : null,
      implicados: d.implicados,
      leidoIa: d.leidoIa,
      ficha: d.ficha,
    };
  }
  const f = r.ficha ?? null;
  return {
    completo: false,
    numero: numeroInforme,
    titulo: r.titulo,
    fecha: r.fecha,
    entidad: r.entidad,
    entidadRuc: r.entidadRuc,
    responsabilidades: r.responsabilidades,
    funcionarios: r.funcionarios ?? null,
    tipoServicio: f?.tipoServicio ?? null,
    unidadEmisora: null,
    objetivo: f?.objetivo ?? null,
    montos: f?.montos ?? null,
    rotulo: null,
    // La lista trae el tema en palabras y no trae la moneda del perjuicio: sin moneda, el perjuicio espera al detalle.
    observaciones: (f?.observaciones ?? []).map((o) => ({
      n: o.n, texto: o.texto, tema: null, temaTexto: o.tema, perjuicio: null, moneda: null,
      normas: [], obras: [], contratos: [], procesos: [], empresas: [],
    })),
    recomendaciones: f && (f.objetivo != null || f.observaciones.length > 0) ? f.recomendaciones : null,
    implicados: f?.implicados ?? null,
    leidoIa: null,
    ficha: !!f && (f.objetivo != null || f.observaciones.length > 0),
  };
}

/** El asunto del informe como se lee en las listas («Contratación, ejecución…»). */
export const asuntoDe = (titulo: string | null | undefined) => (titulo ? tituloNatural(limpiarObjeto(titulo)) : "Sin asunto registrado");

/**
 * Una palabra de nombre propio, como Título o EN MAYÚSCULAS («Machare», «MACHARE»), y el trato que la precede. Sin la
 * bandera `i`: con ella `\p{Lu}` también acepta minúsculas.
 */
const PALABRA_NOMBRE = "\\p{Lu}(?:[\\p{Ll}\\p{M}]+|[\\p{Lu}\\p{M}]+)";
const TRATO = "(?:[Ss]e[ñn]or(?:a|ita)?|SE[ÑN]OR(?:A|ITA)?|[Ss]r[at]?a?\\.|SR[AT]?A?\\.)";
const NOMBRE_SUELTO = new RegExp(`(?<![\\p{L}])(${TRATO})(\\s+)((?:${PALABRA_NOMBRE}\\s+){2,3})(${PALABRA_NOMBRE})(?![\\p{L}])`, "gu");

/**
 * Defensa al mostrar: un nombre completo que quedó en la prosa de una Ficha Resumen sin su apellido tapado («el señor
 * Juan Pérez Ríos») se muestra con el último tapado («el señor Juan Pérez •••»), como los demás. Lo que manda es la API
 * (publicar() de lib/privacidad.ts tapa al publicar): esto sólo evita que se lea en pantalla si algo se le escapó.
 */
export const prosaSegura = (t: string) => t.replace(NOMBRE_SUELTO, (_m, trato: string, espacio: string, nombres: string) => `${trato}${espacio}${nombres}•••`);

/** Una palabra en mayúsculas de una sumilla (también «2016,», «S/», «A)»): letras mayúsculas, cifras y signos. */
const TOKEN_MAYUS = "[\\p{Lu}\\d\"“(¿¡][\\p{Lu}\\p{M}\\d°º.,;:()\\-/\"“”'´?!]*";
const CABEZA_MAYUS = new RegExp(`^(?:${TOKEN_MAYUS}\\s+){4,}`, "u");

/** ¿El texto está casi todo en mayúsculas? (el mismo criterio que `oracion`: el 80 % de sus letras). */
function casiMayusculas(t: string): boolean {
  const letras = t.match(/\p{L}/gu) ?? [];
  return letras.length > 0 && letras.filter((c) => c !== c.toLocaleLowerCase("es")).length / letras.length >= 0.8;
}

/**
 * El texto de una observación o de un objetivo: tal como lo escribió la Contraloría, salvo lo que llegó EN MAYÚSCULAS, que
 * se lee como oración con sus tildes (`oracion`, como los objetos del SEACE): el texto entero si casi todo lo está, o la
 * sumilla del comienzo («DURANTE EL AÑO 2016, SE EFECTUARON… DE LA ENTIDAD. De la revisión…»). Las mayúsculas de en
 * medio (el nombre de una entidad) se quedan como vienen.
 */
export function textoObservacion(t: string): string {
  const s = prosaSegura(t).trim();
  if (casiMayusculas(s)) return comoOracion(s);
  const cabeza = s.match(CABEZA_MAYUS)?.[0];
  // Al menos cuatro palabras con letras en la sumilla (no una fila de cifras).
  if (!cabeza || (cabeza.match(/\p{Lu}{2,}/gu) ?? []).length < 4) return s;
  const sinEspacio = cabeza.trimEnd();
  return comoOracion(sinEspacio) + cabeza.slice(sinEspacio.length) + s.slice(cabeza.length);
}

/** Las siglas y monedas que `oracion` deja en minúsculas en los textos de la Contraloría. */
const SIGLAS = /\b(uit|pia|pim|siaf|seace|osce|oece|rnp|cui|mef|oci|cas|igv|ruc|pac|tdr|snip|opmi|ugel|sunat|sunarp|essalud|pnp|mtc|minsa|minedu)\b/g;
const comoOracion = (t: string) =>
  oracion(t)
    .replace(SIGLAS, (x) => x.toUpperCase())
    .replace(/(^|[\s(])s\/(?=\s?\d)/g, "$1S/")
    .replace(/(^|[\s(])us\$/g, "$1US$");

/** Un texto recortado a `n` caracteres en el último espacio, con «…». */
export function recortarTexto(t: string, n: number): string {
  if (t.length <= n) return t;
  const corte = t.lastIndexOf(" ", n);
  return `${t.slice(0, corte > n * 0.6 ? corte : n).trimEnd()}…`;
}

/** Desde cuántos caracteres una observación se abre a pedido (hay fichas mal leídas con 60 mil en una sola). */
const LARGA = 1400;

/** El texto de una observación con sus tapados como en todo Vigía y, si es muy largo, su comienzo y «Leer entera». */
function TextoObservacion({ texto, className }: { texto: string; className?: string }) {
  const [entera, setEntera] = useState(false);
  const t = textoObservacion(texto);
  const larga = t.length > LARGA;
  return (
    <div className={className}>
      <p className="text-dato leading-relaxed text-ink text-pretty">
        <ConTapados texto={larga && !entera ? recortarTexto(t, 1000) : t} />
      </p>
      {larga && (
        <button
          type="button"
          onClick={() => setEntera((x) => !x)}
          aria-expanded={entera}
          className="mt-1.5 inline-flex min-h-8 items-center gap-1 text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          {entera ? "Mostrar menos" : `Leer entera (${numero(t.split(/\s+/).length)} palabras)`}
        </button>
      )}
    </div>
  );
}

/** El RUC de una entidad pública enlazable: 11 dígitos y nunca uno que empiece con 10 (una persona). */
export const rucEntidad = (ruc: string | null | undefined) => (ruc && /^\d{11}$/.test(ruc.trim()) && !ruc.trim().startsWith("10") ? ruc.trim() : null);

/**
 * Quién emitió el informe, legible: «OCI - MUNICIPALIDAD DISTRITAL DE UCHUMAYO» → «El Órgano de Control Institucional
 * (OCI) de la entidad» si es el de la misma entidad, o «Órgano de Control Institucional (OCI), …» si es de otra. Lo demás
 * (una gerencia regional de control, la sede central), como título.
 */
function emisor(unidad: string, entidad: string | null): string {
  const m = unidad.trim().match(/^OCI\b\s*[-–:,]?\s*(.*)$/i);
  if (!m) return tituloNatural(unidad);
  const resto = m[1].trim();
  const igual = !!resto && !!entidad && resto.toLocaleLowerCase("es") === entidad.trim().toLocaleLowerCase("es");
  if (!resto || igual) return "El Órgano de Control Institucional (OCI) de la entidad";
  return `Órgano de Control Institucional (OCI), ${tituloNatural(resto)}`;
}

/** Una empresa se enlaza a su ficha sólo con RUC 20 (un 15 o un 17 es de otra clase de contribuyente). */
const rucEmpresa = (ruc: string | null | undefined) => (ruc && /^20\d{9}$/.test(ruc) ? ruc : null);

const monto = (o: Pick<ObservacionInforme, "perjuicio" | "moneda">) =>
  o.perjuicio == null ? null : o.moneda === "USD" ? `US$\u00a0${numero(o.perjuicio)}` : soles(o.perjuicio);

/** ¿Es esta la observación que encontró el buscador? Por el comienzo del texto (el del buscador puede venir recortado). */
function esLaBuscada(texto: string, c: CoincidenciaBusqueda | null | undefined): boolean {
  if (!c || c.objetivo) return false;
  const a = paraBuscar(texto.slice(0, 200)).slice(0, 90);
  const b = paraBuscar(c.texto.slice(0, 200)).slice(0, 90);
  if (!a || !b) return false;
  const n = Math.min(50, a.length, b.length);
  return a.slice(0, n) === b.slice(0, n);
}

/** Cuántos funcionarios tienen cada responsabilidad (una persona puede tener varias). */
function porTipo(implicados: ImplicadoInforme[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const p of implicados) for (const t of new Set(p.responsabilidades)) c[t] = (c[t] ?? 0) + 1;
  return c;
}

const ORDEN_TIPOS = ["penal", "civil", "administrativa_pas", "administrativa_entidad", "administrativa"];

/**
 * Lo esencial en una oración, armada con los datos: «La Contraloría encontró 3 observaciones, con S/ 1.5 M de perjuicio
 * señalado, y les atribuye responsabilidad presunta a 4 funcionarios: penal a 3 y administrativa a los 4».
 */
function frase(v: Vista): string {
  const obs = v.observaciones.length;
  const perjuicio = v.completo
    ? v.observaciones.reduce((s, o) => s + (o.moneda === "PEN" && typeof o.perjuicio === "number" && o.perjuicio > 0 ? o.perjuicio : 0), 0)
    : 0;
  const k = v.implicados?.length ?? 0;
  const c = v.implicados ? porTipo(v.implicados) : {};
  const administrativa = (v.implicados ?? []).filter((p) => p.responsabilidades.some((t) => t.startsWith("administrativa"))).length;
  // Cuántos tienen cada una: «penal a 3 y civil a los 4» (los 4: todos).
  const cuantas = ([
    ["penal", c.penal ?? 0],
    ["civil", c.civil ?? 0],
    ["administrativa", administrativa],
  ] as const).filter(([, n]) => n > 0);
  const todosIgual = cuantas.length > 0 && cuantas.every(([, n]) => n === k);
  const reparto = listaY(cuantas.map(([t, n]) => `${t} ${n === k && k > 1 ? `a los ${numero(n)}` : `a ${numero(n)}`}`));
  const tipos = listaY(
    Array.from(new Set(v.responsabilidades.map((t) => (t.startsWith("administrativa") ? "administrativa" : t))))
      .sort((a, b) => ORDEN_TIPOS.indexOf(a) - ORDEN_TIPOS.indexOf(b))
      .map((t) => (TIPO_RESPONSABILIDAD[t] ?? t).toLocaleLowerCase("es")),
  );
  const encontro = obs ? `encontró ${plural(obs, "observación", "observaciones")}${perjuicio > 0 ? `, con ${solesCompacto(perjuicio)} de perjuicio señalado,` : ""}` : null;
  // Si todos tienen las mismas («penal y civil a los 3», o uno solo), sin el reparto: «les atribuye responsabilidad presunta
  // penal y civil a 3 funcionarios».
  const atribuye = !k
    ? null
    : todosIgual
      ? `${k === 1 ? "le" : "les"} atribuye responsabilidad presunta ${listaY(cuantas.map(([t]) => t))} a ${k === 1 ? "un funcionario" : plural(k, "funcionario", "funcionarios")}`
      : `les atribuye responsabilidad presunta a ${plural(k, "funcionario", "funcionarios")}${reparto ? `: ${reparto}` : ""}`;
  if (encontro && atribuye) return `La Contraloría ${encontro} y ${atribuye}.`;
  if (encontro) return `La Contraloría ${encontro}.${v.implicados && k === 0 ? " Su Ficha Resumen no nombra a funcionarios comprendidos." : ""}`;
  if (atribuye) return `La Contraloría ${atribuye}.${v.ficha ? "" : " Vigía todavía no leyó lo que encontró: está en su Ficha Resumen."}`;
  const cuantos = v.funcionarios ? ` para ${plural(v.funcionarios, "funcionario", "funcionarios")}` : "";
  return `Informe de control con responsabilidad presunta${tipos ? ` ${tipos}` : ""}${cuantos}. Vigía todavía no leyó su Ficha Resumen: ábrela abajo.`;
}

// ─── El panel ─────────────────────────────────────────────────────────────────────────────────

export function DetalleInformeControl({
  resumen,
  conEntidad = false,
  coincide,
}: {
  resumen: ResumenInforme;
  /** Con la entidad enlazada (región, partido, el buscador de todo el país): en la ficha de la entidad sobra. */
  conEntidad?: boolean;
  coincide?: CoincidenciaBusqueda | null;
}) {
  const { datos, listo, error, reintentar } = useDetalleInforme(resumen.codigo);
  const v = vistaDe(resumen, datos);
  const ruc = rucEntidad(v.entidadRuc);
  const base = `ic-${resumen.codigo.replace(/[^0-9A-Za-z]/g, "")}`;
  const tono = v.responsabilidades.includes("penal") || v.implicados?.some((p) => p.responsabilidades.includes("penal"))
    ? ("alta" as const)
    : v.responsabilidades.includes("civil")
      ? ("media" as const)
      : undefined;

  const capitulos: CapituloRelato[] = [];
  if (v.observaciones.length) {
    capitulos.push({
      id: `${base}-hallazgos`,
      titulo: "Lo que encontró",
      conteo: v.observaciones.length,
      contenido: <Hallazgos v={v} coincide={coincide} />,
    });
  }
  if ((v.implicados?.length ?? 0) > 0 || (v.funcionarios ?? 0) > 0) {
    capitulos.push({
      id: `${base}-quienes`,
      titulo: "Quiénes",
      conteo: v.implicados?.length || v.funcionarios || null,
      tono,
      contenido: <Comprendidos v={v} cargando={!listo} />,
    });
  }
  capitulos.push({
    id: `${base}-revision`,
    titulo: "Qué revisó",
    contenido: <QueReviso v={v} ruc={conEntidad ? ruc : null} coincide={coincide} />,
  });
  // El capítulo de lo que encontró el buscador; si no, el primero (lo que encontró).
  const activa = coincide?.objetivo ? `${base}-revision` : capitulos[0]?.id;
  const datosFrase = [
    // En el celular la cabecera del panel recorta el número: aquí va entero (desde sm, la cabecera ya lo dice).
    <Dato key="n" tipo="codigo" nombre="Informe N.°" mono className="sm:hidden">
      {v.numero}
    </Dato>,
    v.fecha ? <Dato key="f" tipo="fecha" nombre="Emitido">{fecha(v.fecha)}</Dato> : null,
    v.tipoServicio ? <Dato key="s" tipo="servicio">{tipoServicioCorto(v.tipoServicio)}</Dato> : null,
    conEntidad && v.entidad ? (
      <Dato key="e" tipo="entidad">
        {ruc ? (
          <Link href={`/entidad/${ruc}?seccion=control`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
            {tituloNatural(v.entidad)}
          </Link>
        ) : (
          tituloNatural(v.entidad)
        )}
      </Dato>
    ) : null,
  ].filter(Boolean);

  return (
    // La barra de capítulos se pega arriba del panel, no debajo de la de la ficha (que vive en la página de atrás).
    <div className="space-y-4 [--alto-barra-fija:0px]">
      <EnUnaFrase
        datos={datosFrase.length ? <>{datosFrase}</> : undefined}
        pie={
          <span className="inline-flex items-start gap-1.5">
            <ShieldAlert size={13} className="mt-px shrink-0" aria-hidden />
            {AVISO_PRESUNTA}
          </span>
        }
      >
        {frase(v)}
      </EnUnaFrase>

      {!listo && (
        <p className="flex items-center gap-2 text-meta text-mute" role="status">
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
          Trayendo el informe completo…
        </p>
      )}
      {error && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft" role="status">
          No pudimos traer el informe completo ahora: va lo que dice la lista.
          <button
            type="button"
            onClick={reintentar}
            className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
          >
            <RotateCw size={14} aria-hidden /> Reintentar
          </button>
        </div>
      )}

      {/* Si al llegar el detalle cambian los capítulos (la fila no traía observaciones y el informe sí), se vuelve a abrir
          el que corresponde; si son los mismos, se queda en el que se esté leyendo. */}
      <CapitulosRelato key={capitulos.map((c) => c.id).join("|")} en="panel" etiqueta="Lo que dice el informe" capitulos={capitulos} activa={activa} />
    </div>
  );
}

const TARJETA = "rounded-xl border border-line bg-paper px-3.5 py-3";

/** Las observaciones, numeradas como en la Ficha Resumen, con su tema, su perjuicio y lo que nombran. */
function Hallazgos({ v, coincide }: { v: Vista; coincide?: CoincidenciaBusqueda | null }) {
  const otroRotulo = v.rotulo && !/^observaciones$/i.test(v.rotulo.trim()) ? v.rotulo.trim() : null;
  const conTema = v.observaciones.some((o) => o.temaTexto || o.tema);
  const recortadas = !v.completo && v.observaciones.some((o) => o.texto.endsWith("…"));
  return (
    <div className="space-y-3">
      {otroRotulo && <p className="text-meta text-inkSoft">El informe las llama «{otroRotulo}».</p>}
      <ol className="space-y-2.5" aria-label="Observaciones del informe">
        {v.observaciones.map((o) => {
          const buscada = esLaBuscada(o.texto, coincide);
          const m = monto(o);
          return (
            <li key={o.n} className={cn(TARJETA, buscada && "border-granate/50 bg-granate-50/40")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-paperDeep font-mono text-rotulo font-bold tabular-nums text-ink" aria-hidden>
                  {o.n}
                </span>
                <span className="sr-only">Observación {o.n}</span>
                <ChipTema tema={o.tema} texto={o.temaTexto} />
                {buscada && (
                  <span className="pill border-granate/30 bg-granate-50 text-granate">
                    <ScanSearch size={12} className="shrink-0" aria-hidden />
                    La que encontró tu búsqueda
                  </span>
                )}
                {m && (
                  <span className="ml-auto text-right text-meta text-inkSoft">
                    <Dato icono={Coins} nombre="Perjuicio señalado">
                      <span className="font-mono font-semibold tabular-nums text-ink">{m}</span> de perjuicio
                    </Dato>
                  </span>
                )}
              </div>
              <TextoObservacion texto={o.texto} className="mt-2" />
              <Referencias o={o} />
            </li>
          );
        })}
      </ol>
      {recortadas && <p className="text-rotulo text-mute">Los textos van recortados hasta que llegue el informe completo.</p>}
      {conTema && (
        <p className="text-rotulo leading-relaxed text-mute">
          El tema de cada observación lo puso una lectura automática (IA) y puede equivocarse; el texto es el de la Ficha Resumen.
        </p>
      )}
    </div>
  );
}

/** Lo que nombra una observación: empresas (con su ficha si tienen RUC 20), obras, procesos, contratos y normas. */
function Referencias({ o }: { o: ObservacionVista }) {
  const enVigia = o.enVigia ?? [];
  const grupos: { clave: string; titulo: string; items: ReactNode[] }[] = [
    {
      // Lo primero: el contrato de Vigía que la observación nombra (por su nomenclatura o por el CUI de la obra).
      clave: "vigia",
      titulo: enVigia.length === 1 ? "El contrato en Vigía" : "Los contratos en Vigía",
      items: enVigia.map((k) => (
        <Dato key={`v${k.ocid}`} icono={ScanSearch}>
          <Link href={rutaContrato(k.ocid, "ficha", { seccion: "antecedentes" })} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
            {k.nomenclatura ?? (k.cui ? `Obra de la inversión ${k.cui}` : "Ver el contrato")}
          </Link>
          {k.objeto && <span className="ml-1 text-mute">{recortarTexto(tituloNatural(limpiarObjeto(k.objeto)), 110)}</span>}
        </Dato>
      )),
    },
    {
      clave: "empresas",
      titulo: o.empresas.length === 1 ? "Empresa" : "Empresas",
      items: o.empresas.map((e, i) => {
        const r = rucEmpresa(e.ruc);
        return (
          <Dato key={`e${i}`} icono={Briefcase}>
            {r ? (
              <Link href={`/empresa/${r}`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                {tituloNatural(e.razon_social)}
              </Link>
            ) : (
              tituloNatural(e.razon_social)
            )}
          </Dato>
        );
      }),
    },
    {
      clave: "obras",
      titulo: o.obras.length === 1 ? "Obra" : "Obras",
      items: o.obras.map((b, i) => (
        <Dato key={`o${i}`} icono={HardHat}>
          {tituloNatural(b.nombre)}
          {b.cui && <span className="ml-1 font-mono text-[0.95em] tabular-nums text-mute">CUI {b.cui}</span>}
        </Dato>
      )),
    },
    {
      clave: "procesos",
      titulo: o.procesos.length + o.contratos.length === 1 ? "Proceso o contrato" : "Procesos y contratos",
      items: [...o.procesos, ...o.contratos].map((c, i) => (
        <Dato key={`p${i}`} tipo="codigo" mono>
          {c}
        </Dato>
      )),
    },
    {
      clave: "normas",
      titulo: o.normas.length === 1 ? "Norma que cita" : "Normas que cita",
      items: o.normas.map((n, i) => (
        <Dato key={`n${i}`} icono={Scale}>
          {n}
        </Dato>
      )),
    },
  ].filter((g) => g.items.length > 0);
  if (!grupos.length) return null;
  return (
    <dl className="mt-2.5 space-y-1.5 border-t border-line/70 pt-2.5">
      {grupos.map((g) => (
        <div key={g.clave} className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <dt className="text-rotulo font-semibold text-mute">{g.titulo}</dt>
          <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-meta text-inkSoft">{g.items}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Los funcionarios comprendidos, cada uno con su responsabilidad PRESUNTA a la vista. */
function Comprendidos({ v, cargando }: { v: Vista; cargando: boolean }) {
  const imp = v.implicados;
  const cuenta = imp ? porTipo(imp) : {};
  const tipos = ORDEN_TIPOS.filter((t) => cuenta[t]);
  return (
    <div className="space-y-3">
      {imp && imp.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-rotulo font-semibold text-mute">Cuántos con cada una</span>
            <ul className="flex flex-wrap gap-1" aria-label="Funcionarios con cada responsabilidad presunta">
              {tipos.map((t) => (
                <li key={t}>
                  <ChipResponsabilidad tipo={t} n={cuenta[t]} />
                </li>
              ))}
            </ul>
            <Ayuda titulo="¿Qué significa cada una?">
              {QUE_ES_RESPONSABILIDAD.map((x, i) => (
                <span key={x.tipo} className={cn("block", i > 0 && "mt-1.5")}>
                  <strong>{TIPO_RESPONSABILIDAD[x.tipo]}</strong>: {x.texto}
                </span>
              ))}
              <span className="mt-1.5 block">
                Todas son presuntas: la Contraloría las señala y las deriva a quien decide. No es una acusación ni una condena.
              </span>
            </Ayuda>
          </div>
          <ListaPaginada
            nombre="funcionarios comprendidos"
            tam={10}
            controles="abajo"
            className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line"
            items={imp.map((p, i) => ({
              // Por su lugar en el informe: nunca el nombre (va al DOM).
              id: `f${i}`,
              contenido: (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3.5 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-dato font-medium text-ink">
                    <UserRound size={15} className="shrink-0 text-mute" aria-hidden />
                    <span className="min-w-0">
                      {/* Tal como llega de la API (con su apellido tapado), sin retocarlo: como en el resto de Vigía. */}
                      <PersonName name={p.nombre} orden="sunat" />
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-rotulo font-medium text-mute">Presunta</span>
                    <ChipsResponsabilidad tipos={p.responsabilidades} />
                  </span>
                </div>
              ),
            }))}
          />
        </>
      ) : imp && imp.length === 0 ? (
        <VacioEnLinea icono={<UsersRound size={16} />}>Su Ficha Resumen no nombra a funcionarios comprendidos.</VacioEnLinea>
      ) : cargando ? (
        <p className="flex items-center gap-2 text-meta text-mute" role="status">
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
          Trayendo a los funcionarios comprendidos…
        </p>
      ) : (
        <VacioEnLinea icono={<UsersRound size={16} />}>
          {v.funcionarios
            ? `El buscador de la Contraloría cuenta ${plural(v.funcionarios, "funcionario comprendido", "funcionarios comprendidos")}; sus nombres no están disponibles ahora.`
            : "Los funcionarios comprendidos no están disponibles ahora."}
        </VacioEnLinea>
      )}
      <p className="text-rotulo leading-relaxed text-mute">Como en todo Vigía, cada nombre va con un apellido tapado y sin documento.</p>
    </div>
  );
}

/** El objetivo, los montos y los datos del informe, con su fuente. */
function QueReviso({ v, ruc, coincide }: { v: Vista; ruc: string | null; coincide?: CoincidenciaBusqueda | null }) {
  const items: (DatoClave | null)[] = [
    { etiqueta: "Asunto", valor: asuntoDe(v.titulo) },
    v.tipoServicio ? { etiqueta: "Tipo de servicio", valor: v.tipoServicio } : null,
    v.entidad
      ? {
          etiqueta: "Entidad",
          valor: ruc ? (
            <Link href={`/entidad/${ruc}?seccion=control`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
              {tituloNatural(v.entidad)}
            </Link>
          ) : (
            tituloNatural(v.entidad)
          ),
        }
      : null,
    v.unidadEmisora ? { etiqueta: "Lo emitió", valor: emisor(v.unidadEmisora, v.entidad) } : null,
    { etiqueta: "Emitido el", valor: v.fecha ? fecha(v.fecha) : null },
    { etiqueta: "Informe N.°", valor: v.numero, mono: true },
    v.recomendaciones != null
      ? {
          etiqueta: "Recomendaciones",
          valor: v.recomendaciones ? plural(v.recomendaciones, "recomendación a la entidad", "recomendaciones a la entidad") : "Ninguna en su Ficha Resumen",
        }
      : null,
  ];
  const objetivoBuscado = !!coincide?.objetivo;
  return (
    <div className="space-y-4">
      {v.objetivo && (
        <section className="space-y-1.5">
          <h4 className="flex flex-wrap items-center gap-2 text-dato font-semibold text-ink">
            Su objetivo
            {objetivoBuscado && (
              <span className="pill border-granate/30 bg-granate-50 font-normal text-granate">
                <ScanSearch size={12} className="shrink-0" aria-hidden />
                Lo que encontró tu búsqueda
              </span>
            )}
          </h4>
          <CitaDetalle>
            <ConTapados texto={textoObservacion(v.objetivo)} />
          </CitaDetalle>
        </section>
      )}
      <Montos m={v.montos} />
      <DatosClave items={items.filter((x): x is DatoClave => !!x)} />
      <FuenteDato fuente="buscador de informes de la Contraloría" href={BUSCADOR_CONTRALORIA} />
      <p className="text-rotulo leading-relaxed text-mute">
        {v.ficha
          ? `Vigía leyó el objetivo, los montos y las observaciones de su Ficha Resumen${v.leidoIa ? `; el tema y el perjuicio de cada una, una lectura automática (IA) del ${fecha(v.leidoIa)}` : ""}.`
          : "Vigía todavía no leyó su Ficha Resumen: lo de arriba es lo que publica el buscador de la Contraloría."}
        <AyudaTermino clave="ficha-resumen" className="ml-1" />
      </p>
    </div>
  );
}

/** Los montos de la Ficha Resumen, cada uno con su nombre e ícono. */
function Montos({ m }: { m: MontosInforme | null }) {
  if (!m) return null;
  const celdas: { que: string; valor: number }[] = [];
  if (m.auditado != null && m.examinado != null && m.auditado === m.examinado) celdas.push({ que: "Monto auditado y examinado", valor: m.auditado });
  else {
    if (m.auditado != null) celdas.push({ que: "Monto auditado", valor: m.auditado });
    if (m.examinado != null) celdas.push({ que: "Monto examinado", valor: m.examinado });
  }
  if (m.objeto != null) celdas.push({ que: "Monto del hecho revisado", valor: m.objeto });
  if (!celdas.length) return null;
  return (
    <section className="space-y-1.5">
      <h4 className="flex items-center gap-1 text-dato font-semibold text-ink">
        Cuánto dinero revisó
        <Ayuda titulo="¿Qué es cada monto?">
          <span className="block">Lo dice su Ficha Resumen.</span>
          <span className="mt-1.5 block">
            En una auditoría, el monto auditado es el de toda la materia que se revisó, y el examinado, la parte que la comisión
            revisó de cerca.
          </span>
          <span className="mt-1.5 block">En un control específico, el monto del hecho revisado es el dinero que involucra ese hecho.</span>
        </Ayuda>
      </h4>
      <ul className="grid gap-2 sm:grid-cols-2">
        {celdas.map((c) => (
          <li key={c.que} className="rounded-xl border border-line bg-paperSoft px-3.5 py-2.5">
            <Dato icono={Coins} className="text-rotulo font-semibold text-mute">
              {c.que}
            </Dato>
            <p className="mt-0.5 font-mono text-destacado font-semibold tabular-nums text-ink">{soles(c.valor)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── El pie: la Ficha Resumen y el informe completo ─────────────────────────────────────────

/**
 * Los dos documentos de la Contraloría, siempre a la vista al pie del panel: la Ficha Resumen (unas pocas páginas) y el
 * informe completo, que es un escaneo pesado. La lista no trae el enlace a la ficha: llega con el detalle (el mismo pedido
 * que el cuerpo del panel, no otro).
 */
export function PieInforme({ codigo, urlPdf, urlResumen }: { codigo: string; urlPdf?: string | null; urlResumen?: string | null }) {
  const { datos, listo } = useDetalleInforme(codigo);
  const ficha = urlResumen ?? datos?.urlResumen ?? null;
  const completo = urlPdf ?? datos?.urlPdf ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {ficha ? (
        <a href={ficha} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "px-4")}>
          <FileText size={15} aria-hidden />
          Ficha Resumen
          <ExternalLink size={13} aria-hidden />
          <span className="sr-only"> (PDF de la Contraloría, se abre en otra pestaña)</span>
        </a>
      ) : (
        !listo && (
          <span className="inline-flex min-h-[40px] items-center gap-2 text-meta text-mute">
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> Ficha Resumen
          </span>
        )
      )}
      {completo && (
        <a
          href={completo}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex min-h-[40px] items-center gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          <FileStack size={16} className="shrink-0 text-mute" aria-hidden />
          <span className="min-w-0 leading-tight">
            <span className="flex items-center gap-1 text-dato font-semibold text-granate underline decoration-granate/35 underline-offset-2 group-hover:decoration-granate">
              Informe completo
              <ExternalLink size={12} className="shrink-0" aria-hidden />
            </span>
            <span className="block text-rotulo text-mute">Un escaneo pesado: puede tardar en abrir</span>
          </span>
          <span className="sr-only"> (PDF de la Contraloría, se abre en otra pestaña)</span>
        </a>
      )}
    </div>
  );
}

// ─── La fila ──────────────────────────────────────────────────────────────────────────────────

/** El panel de una fila de informe (`Fila.detalle` de la Tabla): título, asunto, el cuerpo que pide el detalle y el pie. */
export function detalleDeInforme(
  r: ResumenInforme,
  { conEntidad = false, coincide = null }: { conEntidad?: boolean; coincide?: CoincidenciaBusqueda | null } = {},
): NonNullable<Fila["detalle"]> {
  const n = r.numero ?? r.codigo;
  return {
    titulo: `Informe N.° ${n}`,
    etiqueta: `Ver lo que encontró la Contraloría en el informe N.° ${n}`,
    descripcion: <span className="line-clamp-2">{asuntoDe(r.titulo)}</span>,
    contenido: <DetalleInformeControl resumen={r} conEntidad={conEntidad} coincide={coincide} />,
    pie: <PieInforme codigo={r.codigo} urlPdf={r.urlPdf} urlResumen={r.urlResumen} />,
  };
}
