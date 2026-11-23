"use client";

/**
 * La pestaña Dictamen del dossier: el texto del agente que lo redacta, con los datos personales en
 * vidrio y un botón para copiarlo ya censurado. Salió de ResultadoView (que pasaba las 800 líneas).
 *
 * La sección "Recortes y datos no verificables" que el dictamen trae siempre se muestra como un capítulo más, «Límites de
 * esta revisión», con el vocabulario interno suavizado (ver ../limitesDictamen.ts).
 *
 * Con forma y jerarquía (2026-11-23, el usuario: «no hay jerarquía, secciones, colores varios», «muros de texto»):
 *   · el TITULAR del dictamen manda (el «## » que el agente pega bajo «# Dictamen de investigación — Alerta …»; antes era
 *     un capítulo plegable vacío y el título genérico iba encima, más grande que el nombre de la pestaña);
 *   · el resumen ejecutivo, abierto y destacado, con sus cifras realzadas en el texto;
 *   · cada capítulo, una fila plegable con su ícono y una pista de lo que trae (cuántos puntos; las señales por gravedad,
 *     en su color);
 *   · adentro, las listas «**Rótulo**: texto» como filas rótulo y dato, las demás con su ícono, y cada señal evaluada
 *     («**1. tipo_proceso_vs_monto (alta)**») en un bloque del color de su gravedad, con su nombre legible.
 * El texto del agente no cambia: sólo su forma.
 */

import { Children, createContext, useContext, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen, Building2, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Coins, Copy, ExternalLink, FileText, HardHat, ListChecks, ListTodo,
  Network, Newspaper, Scale, ScanSearch, type LucideIcon,
} from "lucide-react";
import { maskDnis, redactChildren } from "../../Redact";
import { Severidad } from "@/components/ui/Severidad";
import { reglaLabel } from "@/lib/auditoria-reglas";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { dictamenLimpio, separarLimites, TITULO_LLANO_LIMITES } from "../limitesDictamen";
import { titularDelDictamen } from "../relato/historia";
import { hijosConCifras } from "../relato/cifrasEnTexto";

export type NombreConocido = string | null | undefined | { nombre: string | null | undefined; orden: "sunat" | "nombres-primero" };

const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Versión en texto plano, para el portapapeles, de lo que la pantalla muestra en
 * vidrio: DNI y RUC de persona natural enmascarados, y el apellido que
 * corresponde de cada persona privada conocida reemplazado por "•••".
 */
function redactarTextoPlano(texto: string, nombres: NombreConocido[]): string {
  let out = maskDnis(texto);
  const lista = nombres
    .map((n) => (n && typeof n === "object" ? { nombre: String(n.nombre || "").trim(), orden: n.orden } : { nombre: String(n || "").trim(), orden: "nombres-primero" as const }))
    // Los que la API ya tapó no aparecen enteros en el texto: no hay nada que reemplazar.
    .filter((n) => n.nombre.split(/\s+/).length >= 2 && !n.nombre.includes("•"))
    .sort((a, b) => b.nombre.length - a.nombre.length);
  for (const { nombre, orden } of lista) {
    const partes = nombre.split(/\s+/);
    const k = orden === "sunat" ? (partes.length >= 3 ? 1 : 0) : partes.length - 1;
    const tapado = partes.map((p, i) => (i === k ? "•••" : p)).join(" ");
    out = out.replace(new RegExp(escRx(nombre), "gi"), tapado);
  }
  return out;
}

const PROSA = cn(
  // La medida de lectura va en los párrafos (68ch); las tablas pueden usar todo el ancho.
  "max-w-none prose prose-sm lg:prose-base",
  "prose-p:max-w-[68ch] prose-ul:max-w-[76ch] prose-ol:max-w-[68ch]",
  // Los títulos del markdown bajan: «# » y «## » son el titular y los capítulos (los arma este componente); «### » es un
  // h4 dentro del capítulo y «#### », un h5.
  "[&_h4]:font-display [&_h5]:font-display [&_h4]:font-bold [&_h5]:font-bold [&_h4]:text-ink [&_h5]:text-ink",
  "[&_h4]:text-cuerpo [&_h4]:mt-6 [&_h4]:mb-2",
  "[&_h5]:text-dato [&_h5]:mt-5 [&_h5]:mb-1.5",
  "prose-p:text-cuerpo prose-p:text-ink prose-p:leading-[1.7] prose-p:my-3",
  "prose-strong:text-ink prose-strong:font-bold",
  "prose-em:text-inkSoft prose-em:italic",
  // Las listas llevan su ícono o van como filas rótulo y dato (ItemLista): sin la viñeta del navegador.
  "prose-ul:my-3 prose-ul:list-none prose-ul:pl-0 prose-ul:space-y-2",
  "prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-5 prose-ol:space-y-1.5",
  "prose-li:my-0 prose-li:pl-0 prose-li:text-ink prose-li:leading-relaxed prose-li:marker:text-mute",
  "prose-a:text-granate prose-a:font-medium prose-a:underline prose-a:decoration-granate/40 hover:prose-a:decoration-granate",
  "prose-a:break-words",
  "prose-code:bg-paperDeep prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-ink prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
  "prose-blockquote:border-l prose-blockquote:border-line prose-blockquote:bg-paperSoft prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:my-4 prose-blockquote:rounded-r-xl prose-blockquote:text-inkSoft prose-blockquote:not-italic",
  "prose-table:text-meta prose-table:w-full prose-table:border-collapse prose-table:my-0",
  "prose-th:bg-paperDeep prose-th:text-ink prose-th:font-semibold prose-th:text-rotulo prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-line",
  "prose-td:text-ink prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-line prose-td:align-top",
  "prose-hr:my-6 prose-hr:border-line",
);

// ─── Las señales evaluadas: «**1. tipo_proceso_vs_monto (alta)**» ───────────────

type Sev = "alta" | "media" | "baja";
// La negrita puede seguir después de la gravedad («**1. unico_postor_alto (alta) — Art. 5 Ley 32069**»): eso va en `resto`.
const RX_SENAL = /^\s*(?:\d+[.)]\s*)?([^()]+?)\s*\((alta|media|baja)\)\s*[:.]?\s*(.*)$/i;
const FONDO_SENAL: Record<Sev, string> = {
  alta: "bg-crimson-soft/50",
  media: "bg-amber-soft/50",
  baja: "bg-paperSoft",
};

/** El texto plano de un nodo del árbol del markdown. */
function textoDe(n: any): string {
  if (!n) return "";
  if (n.type === "text") return String(n.value ?? "");
  return Array.isArray(n.children) ? n.children.map(textoDe).join("") : "";
}

/** Si el párrafo abre con «**N. regla (gravedad)**», la señal: su nombre legible y su gravedad. */
function senalDelParrafo(node: any): { nombre: string; sev: Sev; resto: string } | null {
  const primero = (node?.children ?? []).find((c: any) => !(c.type === "text" && !String(c.value).trim()));
  if (!primero || primero.type !== "element" || primero.tagName !== "strong") return null;
  const m = RX_SENAL.exec(textoDe(primero));
  if (!m) return null;
  const crudo = m[1].trim();
  // Un nombre de regla (`lobby_visits_pre_convocatoria`) va con su etiqueta; un nombre ya escrito, tal cual.
  const nombre = /^[a-z0-9_]+$/.test(crudo) ? reglaLabel(crudo) : crudo;
  return { nombre, sev: m[2].toLowerCase() as Sev, resto: m[3].replace(/^[\s—–:-]+/, "").trim() };
}

// ─── Las listas ───────────────────────────────────────────────────────────────

/**
 * Cómo se dibujan los puntos de la lista en que se está: `numerada` (el número es la viñeta), `ficha` (la mayoría de sus
 * puntos son «**Rótulo**: texto» y van como filas rótulo y dato) o `puntos` (cada uno con su ícono).
 */
type ModoLista = "numerada" | "ficha" | "puntos";
const EnLista = createContext<ModoLista>("puntos");

/** «**Objeto**: Adquisición de…»: el punto abre con un rótulo en negrita seguido de dos puntos (o una raya). */
const esPuntoConRotulo = (li: any): boolean => {
  const [a, b] = (li?.children ?? []) as any[];
  return a?.type === "element" && a.tagName === "strong" && b?.type === "text" && /^\s*[:—–]\s/.test(String(b.value));
};

/** Una lista es «ficha» si al menos dos tercios de sus puntos traen rótulo: si no, se ven mezclados. */
function modoDe(node: any): ModoLista {
  const items = ((node?.children ?? []) as any[]).filter((c) => c.type === "element" && c.tagName === "li");
  const conRotulo = items.filter(esPuntoConRotulo).length;
  return items.length > 0 && conRotulo >= 2 && conRotulo * 3 >= items.length * 2 ? "ficha" : "puntos";
}

function ItemLista({ node, children }: { node?: any; children?: ReactNode }) {
  const modo = useContext(EnLista);
  if (modo === "numerada") return <li className="text-cuerpo">{hijosConCifras(children)}</li>;
  if (modo === "ficha") {
    const fila = "!my-0 grid gap-x-5 gap-y-0.5 border-b border-line/70 py-2.5 first:pt-0.5 last:border-0 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]";
    if (!esPuntoConRotulo(node)) {
      return <li className={cn(fila, "text-dato leading-relaxed text-inkSoft sm:[&>*]:col-span-2")}><span className="min-w-0">{hijosConCifras(children)}</span></li>;
    }
    const [rotulo, texto, ...resto] = Children.toArray(children);
    const limpio = typeof texto === "string" ? texto.replace(/^\s*[:—–]\s*/, "") : texto;
    return (
      <li className={fila}>
        <span className="text-dato font-semibold leading-snug text-ink">{rotulo}</span>
        <span className="min-w-0 text-dato leading-relaxed text-ink">{hijosConCifras([limpio, ...resto])}</span>
      </li>
    );
  }
  return (
    <li className="!my-0 flex gap-2.5 text-cuerpo">
      <ChevronRight size={14} className="mt-[0.4rem] shrink-0 text-mute" aria-hidden />
      <div className="min-w-0">{hijosConCifras(children)}</div>
    </li>
  );
}

const COMPONENTES: Components = {
  h1: ({ node, ...props }) => <h3 {...props} />,
  h2: ({ node, ...props }) => <h3 {...props} />,
  h3: ({ node, ...props }) => <h4 {...props} />,
  h4: ({ node, ...props }) => <h5 {...props} />,
  // Censura DNI, RUC de persona natural y apellidos conocidos en la prosa (vidrio revelable); las cifras, realzadas.
  p: ({ node, children, ...props }) => {
    const senal = senalDelParrafo(node);
    if (!senal) return <p {...props}>{hijosConCifras(children)}</p>;
    // La señal evaluada, en un bloque de su color: su gravedad y su nombre arriba, lo que dice debajo.
    const [, ...resto] = Children.toArray(children);
    const [primero, ...demas] = resto;
    const limpio = typeof primero === "string" ? primero.replace(/^\s*[—–:-]\s*/, "") : primero;
    return (
      <div className={cn("not-prose my-3 max-w-[76ch] rounded-xl px-3.5 py-3", FONDO_SENAL[senal.sev])}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Severidad bandera={senal.sev} />
          <span className="text-dato font-semibold text-ink">{senal.nombre}</span>
        </p>
        <p className="mt-1.5 text-dato leading-relaxed text-ink [&_a]:font-medium [&_a]:text-granate [&_em]:text-inkSoft">
          {/* Lo que la negrita traía después de la gravedad (la norma), abriendo el texto. */}
          {senal.resto && <strong className="font-semibold">{redactChildren(senal.resto)} </strong>}
          {hijosConCifras([limpio, ...demas])}
        </p>
      </div>
    );
  },
  ul: ({ node, children, className, ...props }) => {
    const modo = modoDe(node);
    return (
      <EnLista.Provider value={modo}>
        <ul {...props} className={cn(className, modo === "ficha" && "!space-y-0")}>
          {children}
        </ul>
      </EnLista.Provider>
    );
  },
  ol: ({ node, children, ...props }) => (
    <EnLista.Provider value="numerada">
      <ol {...props}>{children}</ol>
    </EnLista.Provider>
  ),
  li: ({ node, children }) => <ItemLista node={node}>{children}</ItemLista>,
  strong: ({ node, children, ...props }) => <strong {...props}>{redactChildren(children)}</strong>,
  em: ({ node, children, ...props }) => <em {...props}>{redactChildren(children)}</em>,
  td: ({ node, children, ...props }) => <td {...props}>{hijosConCifras(children)}</td>,
  // Una tabla de datos necesita ancho: scrollea en su propia caja, sin empujar la página.
  table: ({ node, children, ...props }) => (
    <div className="scrollbar-warm my-4 overflow-x-auto">
      <table {...props}>{children}</table>
    </div>
  ),
  a: ({ node, href, children, ...props }) => {
    const isLongUrl = typeof href === "string" && href.length > 80;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        {...props}
        className={cn(
          "text-granate font-medium hover:text-granate-deep transition-colors",
          isLongUrl ? "inline-flex items-center gap-1 max-w-full" : "underline decoration-granate/40 hover:decoration-granate",
        )}
        title={typeof href === "string" ? href : undefined}
      >
        {isLongUrl ? (
          <>
            <span className="truncate max-w-[36ch] underline decoration-granate/40">{String(children)}</span>
            <ExternalLink size={10} className="shrink-0" aria-hidden />
          </>
        ) : (
          children
        )}
      </a>
    );
  },
};

const Md = ({ texto }: { texto: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTES}>
    {texto}
  </ReactMarkdown>
);

// ─── Los capítulos ────────────────────────────────────────────────────────────

type Capitulo = { titulo: string | null; cuerpo: string };

/**
 * El nivel de los capítulos: el del título «Resumen ejecutivo» (el agente lo escribe como «## » o como «### », según la
 * versión del dictamen); sin él, «## ».
 */
function nivelDeCapitulos(md: string): number {
  const m = /^(#{1,4})\s*(?:\d+[.)]\s*)?Resumen ejecutivo\b/im.exec(md);
  return m ? Math.max(2, m[1].length) : 2;
}

/**
 * El dictamen en capítulos: lo que va antes del primer título y un capítulo por cada título de nivel `nivel` o más alto
 * (Resumen ejecutivo, Hechos clave, Precios…). Fuera de un bloque de código. Sin ningún título, un solo bloque.
 */
function enCapitulos(md: string, nivel: number): Capitulo[] {
  const out: Capitulo[] = [];
  let actual: { titulo: string | null; lineas: string[] } = { titulo: null, lineas: [] };
  let enCodigo = false;
  const rx = new RegExp(`^#{1,${nivel}}\\s+(.+?)\\s*#*\\s*$`);
  for (const linea of md.split("\n")) {
    if (/^\s*```/.test(linea)) enCodigo = !enCodigo;
    const m = enCodigo ? null : rx.exec(linea);
    if (m) {
      out.push({ titulo: actual.titulo, cuerpo: actual.lineas.join("\n") });
      actual = { titulo: m[1].replace(/[*_`]/g, "").trim(), lineas: [] };
    } else actual.lineas.push(linea);
  }
  out.push({ titulo: actual.titulo, cuerpo: actual.lineas.join("\n") });
  return out.filter((c) => c.titulo || c.cuerpo.trim());
}

/** El ícono de cada capítulo, por su título (los que escribe el agente del dictamen). */
const ICONOS: [RegExp, LucideIcon][] = [
  [/resumen/i, FileText],
  [/hechos/i, ListChecks],
  [/precio|mercado/i, Coins],
  [/requerimiento|direccionamiento|t[eé]cnic/i, ClipboardList],
  [/proveedor|antecedente|empresa/i, Building2],
  [/red\b|personas|v[ií]nculo/i, Network],
  [/cumplimiento|normativ|legal/i, Scale],
  [/obra|infobras/i, HardHat],
  [/prensa|noticia/i, Newspaper],
  [/pr[oó]ximos|pasos|recomendaci/i, ListTodo],
  [/fuentes|referencias|citad/i, BookOpen],
  [/l[ií]mites|recortes|no verificable/i, ScanSearch],
];
const iconoDe = (titulo: string): LucideIcon => ICONOS.find(([rx]) => rx.test(titulo))?.[1] ?? FileText;

const PALABRA_SEV: Record<Sev, [string, string, string]> = {
  alta: ["alta", "altas", "font-semibold text-crimsonTexto"],
  media: ["media", "medias", "font-semibold text-amberTexto"],
  baja: ["baja", "bajas", "text-inkSoft"],
};

/** Lo que trae un capítulo, en una línea: sus señales por gravedad (en su color), cuántos puntos o su comienzo. */
function pistaDe(cuerpo: string): ReactNode {
  const sevs: Record<Sev, number> = { alta: 0, media: 0, baja: 0 };
  for (const m of cuerpo.matchAll(/\*\*\s*(?:\d+[.)]\s*)?[^*\n]*?\((alta|media|baja)\)[^*\n]*\*\*/gi)) sevs[m[1].toLowerCase() as Sev] += 1;
  const conSev = (["alta", "media", "baja"] as const).filter((s) => sevs[s] > 0);
  if (conSev.length > 0) {
    const total = conSev.reduce((n, s) => n + sevs[s], 0);
    return (
      <>
        {total === 1 ? "1 señal evaluada: " : `${numero(total)} señales evaluadas: `}
        {conSev.map((s, i) => (
          <span key={s}>
            {i > 0 && (i === conSev.length - 1 ? " y " : ", ")}
            <span className={PALABRA_SEV[s][2]}>
              {numero(sevs[s])} {sevs[s] === 1 ? PALABRA_SEV[s][0] : PALABRA_SEV[s][1]}
            </span>
          </span>
        ))}
      </>
    );
  }
  const puntos = cuerpo.split("\n").filter((l) => /^\s*(?:[-*+]|\d+\.)\s+\S/.test(l)).length;
  if (puntos >= 2) return `${numero(puntos)} puntos`;
  const plano = cuerpo
    .replace(/\|.*\|/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // El comienzo del texto, cortado por la línea (sin partir oraciones a mano: «D.S. 009» cortaba en «D.S.»).
  return plano ? plano.slice(0, 200) : null;
}

function FilaCapitulo({ titulo, pista, abierto = false, children }: { titulo: string; pista?: ReactNode; abierto?: boolean; children: ReactNode }) {
  const Icono = iconoDe(titulo);
  return (
    <details open={abierto} className="group/cap border-t border-line first:border-t-0">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-paperSoft text-inkSoft transition-colors duration-rapido group-open/cap:bg-granate-50 group-open/cap:text-granate"
        >
          <Icono size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <h3 className="font-display text-bloque font-bold leading-snug text-ink">{redactChildren(titulo)}</h3>
          {pista && <span className="mt-0.5 block truncate text-meta text-mute group-open/cap:hidden">{pista}</span>}
        </span>
        <ChevronDown size={18} className="shrink-0 text-mute transition-transform duration-rapido group-open/cap:rotate-180" aria-hidden />
      </summary>
      <div className={cn(PROSA, "pb-5 sm:pl-12 [&>:first-child]:mt-0")}>{children}</div>
    </details>
  );
}

export function DictamenSection({
  dictamen,
  nombresPrivados,
  modelo,
}: {
  dictamen: string;
  /** Personas privadas conocidas: el texto copiado sale con su apellido tapado. */
  nombresPrivados: NombreConocido[];
  /** Modelo que redactó el dictamen, solo si el análisis lo trae. */
  modelo?: string | null;
}) {
  const partes = useMemo(() => separarLimites(dictamen), [dictamen]);
  const titular = useMemo(() => titularDelDictamen(dictamen), [dictamen]);

  // El titular sale del texto: ni el «# Dictamen de investigación — Alerta …» ni el «## » del titular son capítulos. El
  // resumen ejecutivo va abierto arriba; lo demás, en filas plegables.
  const { intro, resumen, antes, despues } = useMemo(() => {
    const nivel = nivelDeCapitulos(dictamen);
    const caps = enCapitulos(partes.antes, nivel);
    const sinTitulo = caps.filter((c) => !c.titulo).map((c) => c.cuerpo.trim()).filter(Boolean);
    // Fuera los títulos sin texto propio: el «# Dictamen de investigación — Alerta …» y el titular (va en la cabecera).
    const titulados = caps.filter((c) => c.titulo && c.cuerpo.trim());
    const iResumen = titulados.findIndex((c) => /resumen ejecutivo/i.test(c.titulo ?? ""));
    return {
      intro: sinTitulo.join("\n\n"),
      resumen: iResumen >= 0 ? titulados[iResumen] : null,
      antes: titulados.filter((_, i) => i !== iResumen),
      despues: enCapitulos(partes.despues, nivel).filter((c) => c.cuerpo.trim()),
    };
  }, [dictamen, partes]);

  // ─── Copiar el dictamen, ya censurado ───
  // Se copia lo que la página muestra: la sección de recortes suavizada y bajo su título llano,
  // no el bloque crudo (claves internas, restos de JSON) que la pantalla no enseña.
  const [copiado, setCopiado] = useState<"ok" | "error" | null>(null);
  const copiarDictamen = async () => {
    try {
      await navigator.clipboard.writeText(redactarTextoPlano(dictamenLimpio(partes), nombresPrivados));
      setCopiado("ok");
    } catch {
      setCopiado("error");
    }
    setTimeout(() => setCopiado(null), 2500);
  };

  // Sin resumen ejecutivo, el primer capítulo va abierto.
  let primeroAbierto = !resumen;
  const fila = (c: Capitulo, i: number) => {
    if (!c.titulo) return c.cuerpo.trim() ? <div key={i} className={cn(PROSA, "py-3")}><Md texto={c.cuerpo} /></div> : null;
    const abierto = primeroAbierto;
    primeroAbierto = false;
    return (
      <FilaCapitulo key={i} titulo={c.titulo} pista={pistaDe(c.cuerpo)} abierto={abierto}>
        <Md texto={c.cuerpo} />
      </FilaCapitulo>
    );
  };

  return (
    <section className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
      <header className="flex flex-col gap-3 px-4 pt-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-6 sm:pt-6">
        <div className="min-w-0 max-w-3xl sm:flex-1">
          <h2 className="font-display text-seccion font-bold leading-tight text-ink text-balance">{titular ? redactChildren(titular) : "Dictamen"}</h2>
          <p className="mt-1.5 flex items-start gap-1.5 text-meta leading-snug text-mute">
            <FileText size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {titular ? "Dictamen redactado" : "Redactado"} automáticamente{modelo ? ` (${modelo})` : ""} con la evidencia del análisis. Los datos personales van
              tapados.
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={copiarDictamen}
          aria-live="polite"
          title="Copia el texto con los datos personales ya ocultos"
          className={cn(
            "inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-full border px-3.5 text-meta font-semibold transition-colors",
            copiado === "ok"
              ? "border-moss/40 bg-moss/10 text-mossTexto"
              : copiado === "error"
                ? "border-rust/40 bg-crimson-soft text-crimsonTexto"
                : "border-line bg-paper text-ink hover:bg-paperSoft",
          )}
        >
          {copiado === "ok" ? <CheckCircle2 size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copiado === "ok" ? "Copiado, sin datos personales" : copiado === "error" ? "No se pudo copiar" : "Copiar el dictamen"}
        </button>
      </header>

      {intro && (
        <div className={cn(PROSA, "px-4 pt-3 sm:px-6")}>
          <Md texto={intro} />
        </div>
      )}

      {resumen && (
        <div className="mx-4 mt-4 rounded-xl bg-paperSoft px-4 py-4 sm:mx-6 sm:px-5">
          <h3 className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
            <FileText size={17} className="shrink-0 text-mute" aria-hidden />
            {resumen.titulo}
          </h3>
          <div className={cn(PROSA, "mt-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0 prose-p:text-cuerpo")}>
            <Md texto={resumen.cuerpo} />
          </div>
        </div>
      )}

      <div className="px-4 pb-2 pt-3 sm:px-6">
        {antes.map(fila)}
        {partes.limites && (
          <FilaCapitulo titulo={TITULO_LLANO_LIMITES} pista="Lo que no se pudo comprobar y lo que quedó fuera de la lectura de los documentos.">
            <Md texto={partes.limites} />
          </FilaCapitulo>
        )}
        {despues.map(fila)}
      </div>
    </section>
  );
}
