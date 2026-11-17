/**
 * «Perfil del contratista»: lo que las bases le pedían a quien quisiera ganar (pedido del usuario del 2026-11-17: «crea un
 * PERFIL DEL CONTRATISTA en el sentido de lo que PIDEN las BASES»; y después: «ahora hay texto plano y ya»). Sale de la
 * ficha de las bases leída por pieza (backend/lector/ficha_bases.py, las integradas si las hay).
 *
 * Se lee de arriba abajo como un perfil, no como una lista:
 *   1. la frase y las cifras que deciden quién podía competir (experiencia, plazo de entrega, cuantía, exigencias);
 *   2. cómo se puntuaba (barra de los factores, con el peso del precio destacado) junto a la experiencia, general y MYPE;
 *   3. las exigencias particulares (y marcas, personal y equipos si los hay);
 *   4. los plazos en línea (entrega, conformidad, pago) y los demás plegados;
 *   5. garantías y penalidades con el tope a la vista;
 *   6. los documentos, plegados con su conteo (una lista de control que casi nadie lee entera);
 *   7. pago y controversias.
 * Cada dato lleva la página que lo dice como un chip (`CitaPagina corto`), nunca como texto suelto.
 *
 * Server component: los plegables son `<details>` nativos (teclado y lector de pantalla sin JavaScript); `CitaPagina` es
 * la isla de cliente que abre la página del documento.
 */
import type { ReactNode } from "react";
import {
  ArrowRight, BadgeCheck, CalendarClock, ChevronDown, ClipboardCheck, FileSignature, Gavel, Lock, Scale, ShieldCheck, Tag, Timer,
  Trophy, Users, Wallet, Wrench,
} from "lucide-react";
import { Ayuda, BloqueDetalle, CabeceraPestana, EnUnaFrase, FuenteDato } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import { BarraSegmentada, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { enlacesProceso } from "@/lib/fuentes";
import { fechaConAnio, numero, oracion, plural, soles } from "@/lib/formato";
import type { CitaDocumento, ContratoDetalle as Detalle, PerfilContratista as Perfil } from "@/lib/contratos";
import { CitaPagina } from "./CitaPagina";

/** Cuántos requisitos trae el perfil (el conteo de la pestaña). */
export const cuentaPerfil = (p: Perfil) =>
  p.experiencia.length + p.personalClave.length + p.equipamiento.length + p.exigencias.length + p.factores.length + p.marcas.length;

const TIPO_GARANTIA: Record<string, string> = {
  fiel_cumplimiento: "De fiel cumplimiento", adelanto: "Por adelanto", comercial: "Comercial", prestaciones_accesorias: "Por prestaciones accesorias",
  otra: "Otra garantía",
};

const cantidadDe = (x: { cantidad: number | null; unidad: string | null }) =>
  x.cantidad == null ? null : x.unidad && /sol/i.test(x.unidad) ? soles(x.cantidad) : `${numero(x.cantidad)}${x.unidad ? ` ${x.unidad}` : ""}`;

/** La página citada como un chip pequeño a la derecha del dato. */
function Cita({ ocid, cita }: { ocid: string; cita: CitaDocumento | null }) {
  return cita && (cita.pagina != null || cita.documentoUrl) ? <CitaPagina ocid={ocid} cita={cita} corto className="shrink-0" /> : null;
}

/** Una placa del perfil: borde fino, fondo de la página, sin sombra (un solo nivel: nunca una placa dentro de otra). */
function Placa({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-paper px-4 py-3.5 ${className}`}>{children}</div>;
}

/** El rótulo de una placa: ícono y nombre a la izquierda, la página citada a la derecha. */
function Rotulo({ icono: Icono, children, ocid, cita }: { icono: typeof Scale; children: ReactNode; ocid: string; cita?: CitaDocumento | null }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-rotulo font-semibold text-inkSoft">
        <Icono size={14} aria-hidden /> {children}
      </span>
      {cita !== undefined && <Cita ocid={ocid} cita={cita} />}
    </div>
  );
}

// ─── Cómo se puntuaba ────────────────────────────────────────────────────────────────────────────

function Puntuacion({ c, p }: { c: Detalle; p: Perfil }) {
  const factores = p.factores.filter((f) => f.puntajeMaximo != null && f.puntajeMaximo > 0);
  const total = factores.reduce((s, f) => s + (f.puntajeMaximo ?? 0), 0);
  if (!factores.length || !total) return null;
  const precio = factores.find((f) => /precio|econ/i.test(f.factor ?? ""));
  const nombre = (f: (typeof factores)[number]) => (f.factor ?? "Factor sin nombre").replace(/\s*\((obligatorio|facultativo)\)\s*$/i, "");
  return (
    <BloqueDetalle
      className="border-t-0 pt-0"
      titulo="Cómo se puntuaba"
      ayuda={<Ayuda titulo="¿Qué son los factores de evaluación?">Lo que daba puntos entre las ofertas que cumplían los requisitos. Si el precio pesa poco, otras cosas pueden decidir quién gana.</Ayuda>}
    >
      {precio?.puntajeMaximo != null && (
        <p className="mb-3 text-dato leading-relaxed text-inkSoft">
          El precio daba <b className="text-ink">{numero(precio.puntajeMaximo)} de {numero(total)} puntos</b>
          {total - precio.puntajeMaximo > 0 ? `; los otros ${numero(total - precio.puntajeMaximo)} se ganaban con lo demás.` : "."}
        </p>
      )}
      <BarraSegmentada
        etiqueta="Puntaje máximo de cada factor de evaluación"
        partes={factores.map((f, i) => ({ clave: `f-${i}`, nombre: nombre(f), valor: f.puntajeMaximo!, texto: plural(f.puntajeMaximo!, "punto", "puntos") }))}
        className="h-3"
      />
      <ul className="mt-3 space-y-2">
        {factores.map((f, i) => (
          <li key={`f-${i}`} className="flex items-start gap-2.5">
            <MuestraSerie i={i} className="mt-1" />
            <span className="min-w-0 flex-1 text-dato leading-snug text-ink">
              {nombre(f)}
              {/facultativo/i.test(f.factor ?? "") && <span className="ml-1.5 text-rotulo text-mute">facultativo</span>}
            </span>
            <span className="shrink-0 text-right tabular-nums">
              <b className="text-dato text-ink">{numero(f.puntajeMaximo!)}</b>
              <span className="ml-1 text-rotulo text-mute">{Math.round((100 * f.puntajeMaximo!) / total)} %</span>
            </span>
            <Cita ocid={c.ocid} cita={f.cita} />
          </li>
        ))}
      </ul>
    </BloqueDetalle>
  );
}

// ─── Experiencia ─────────────────────────────────────────────────────────────────────────────────

function Experiencia({ c, p }: { c: Detalle; p: Perfil }) {
  if (!p.experiencia.length) return null;
  return (
    <BloqueDetalle
      className="border-t-0 pt-0"
      titulo="Experiencia que se pedía"
      ayuda={<Ayuda titulo="¿Qué es la experiencia del postor?">Lo que el postor debía acreditar haber vendido o hecho antes, casi siempre un monto facturado en un plazo. A las micro y pequeñas empresas se les puede pedir menos.</Ayuda>}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {p.experiencia.map((x, i) => {
          const mype = x.para === "mype";
          return (
            <Placa key={`exp-${i}`} className={mype ? "bg-paperSoft" : ""}>
              <Rotulo icono={mype ? Users : Trophy} ocid={c.ocid} cita={x.cita}>
                {mype ? "Micro y pequeña empresa" : x.para === "consorcio" ? "Consorcios" : "Para todos"}
              </Rotulo>
              <p className="mt-1.5 font-display text-cifra font-bold leading-none tabular-nums text-ink">{cantidadDe(x) ?? "Sin monto"}</p>
              <p className="mt-1.5 text-rotulo text-mute">
                {x.anios != null ? `facturado en los últimos ${plural(x.anios, "año", "años")}` : "monto que había que acreditar"}
              </p>
              {x.requisito && <p className="mt-2.5 line-clamp-3 text-dato leading-relaxed text-inkSoft">{x.requisito}</p>}
              {x.acreditacion && (
                <details className="group mt-2">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-rotulo font-semibold text-granate-700 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                    Cómo se acreditaba
                    <ChevronDown size={13} className="transition-transform duration-rapido group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="mt-1.5 text-rotulo leading-relaxed text-inkSoft">{oracion(x.acreditacion)}</p>
                </details>
              )}
            </Placa>
          );
        })}
      </div>
    </BloqueDetalle>
  );
}

// ─── Exigencias, personal, equipos y marcas ──────────────────────────────────────────────────────

function Marcadas({ c, titulo, icono: Icono, items }: {
  c: Detalle; titulo: string; icono: typeof BadgeCheck; items: { texto: string; sub?: string | null; cita: CitaDocumento | null }[];
}) {
  if (!items.length) return null;
  return (
    <BloqueDetalle titulo={titulo}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((x, i) => (
          <li key={i} className="flex items-start gap-2.5 rounded-xl border border-line bg-paper px-3 py-2.5">
            <Icono size={16} className="mt-0.5 shrink-0 text-mossTexto" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-dato leading-snug text-ink">{x.texto}</span>
              {x.sub && <span className="mt-0.5 block text-rotulo text-mute">{x.sub}</span>}
            </span>
            <Cita ocid={c.ocid} cita={x.cita} />
          </li>
        ))}
      </ul>
    </BloqueDetalle>
  );
}

// ─── Plazos ──────────────────────────────────────────────────────────────────────────────────────

/** De la lista de plazos, la cadena que vive el contratista: entregar, que le den la conformidad y que le paguen. */
function cadenaDePlazos(p: Perfil) {
  const usados = new Set<number>();
  const tomar = (re: RegExp, evitar?: RegExp) => {
    const i = p.plazos.findIndex((x, k) => !usados.has(k) && x.dias != null && re.test(x.que ?? "") && !(evitar && evitar.test(x.que ?? "")));
    if (i < 0) return null;
    usados.add(i);
    return p.plazos[i];
  };
  const pasos = [
    { clave: "entrega", titulo: "Entrega", icono: Timer, x: tomar(/entrega|ejecuci|prestaci[oó]n del servicio/i, /conformidad|pago/i) },
    { clave: "conformidad", titulo: "Conformidad", icono: BadgeCheck, x: tomar(/conformidad/i, /prueba|subsan|pago/i) },
    { clave: "pago", titulo: "Pago", icono: Wallet, x: tomar(/pago/i) },
  ].filter((s) => s.x);
  return { pasos, resto: p.plazos.filter((_, k) => !usados.has(k)) };
}

function Plazos({ c, p }: { c: Detalle; p: Perfil }) {
  if (!p.plazos.length) return null;
  const { pasos, resto } = cadenaDePlazos(p);
  const habiles = (t: string | null) => /h[aá]bil/i.test(t ?? "");
  return (
    <BloqueDetalle titulo="Plazos">
      {pasos.length > 0 && (
        <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
          {pasos.map((s, i) => (
            <li key={s.clave} className="flex flex-1 items-stretch sm:items-center">
              <Placa className="flex-1">
                <Rotulo icono={s.icono} ocid={c.ocid} cita={s.x!.cita}>{s.titulo}</Rotulo>
                <p className="mt-1 font-display text-cifra font-bold leading-none tabular-nums text-ink">
                  {numero(s.x!.dias!)}
                  <span className="ml-1.5 text-dato font-semibold text-inkSoft">{s.x!.dias === 1 ? "día" : "días"}{habiles(s.x!.que) ? " hábiles" : ""}</span>
                </p>
                {s.x!.que && <p className="mt-1.5 line-clamp-2 text-rotulo leading-snug text-mute">{s.x!.que}</p>}
              </Placa>
              {i < pasos.length - 1 && <ArrowRight size={18} className="mx-1.5 hidden shrink-0 text-mute sm:block" aria-hidden />}
            </li>
          ))}
        </ol>
      )}
      {resto.length > 0 && (
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-dato font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <CalendarClock size={15} className="text-mute" aria-hidden />
            {pasos.length ? `Otros ${plural(resto.length, "plazo", "plazos")}` : plural(resto.length, "plazo", "plazos")}
            <ChevronDown size={15} className="text-mute transition-transform duration-rapido group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-paper">
            {resto.map((x, i) => (
              <li key={i} className="flex items-start gap-3 px-3 py-2">
                <span className="w-16 shrink-0 text-right text-dato font-semibold tabular-nums text-ink">{x.dias != null ? plural(x.dias, "día", "días") : "Sin días"}</span>
                <span className="min-w-0 flex-1 text-dato leading-snug text-inkSoft">{x.que ?? "Plazo sin detalle"}</span>
                <Cita ocid={c.ocid} cita={x.cita} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </BloqueDetalle>
  );
}

// ─── Garantías y penalidades ─────────────────────────────────────────────────────────────────────

function GarantiasPenalidades({ c, p }: { c: Detalle; p: Perfil }) {
  if (!p.garantias.length && !p.penalidades.length) return null;
  return (
    <BloqueDetalle titulo="Garantías y penalidades">
      <div className="grid gap-3 sm:grid-cols-2">
        {p.penalidades.map((x, i) => (
          <Placa key={`pe-${i}`}>
            <Rotulo icono={Scale} ocid={c.ocid} cita={x.cita}>{x.tipo === "mora" ? "Penalidad por mora" : "Penalidad"}</Rotulo>
            {x.topePct != null && (
              <p className="mt-1 font-display text-cifra font-bold leading-none tabular-nums text-ink">
                {numero(x.topePct)} %<span className="ml-1.5 text-dato font-semibold text-inkSoft">del monto, como tope</span>
              </p>
            )}
            {x.descripcion && <p className="mt-1.5 line-clamp-4 text-rotulo leading-relaxed text-inkSoft">{x.descripcion}</p>}
          </Placa>
        ))}
        {p.garantias.length > 0 && (
          <Placa>
            <Rotulo icono={ShieldCheck} ocid={c.ocid}>{plural(p.garantias.length, "garantía", "garantías")}</Rotulo>
            <ul className="mt-2 space-y-1.5">
              {p.garantias.map((x, i) => (
                <li key={`g-${i}`} className="flex items-center justify-between gap-2 text-dato text-ink">
                  <span>{TIPO_GARANTIA[x.tipo ?? ""] ?? "Garantía"}{x.porcentaje != null && <b className="ml-1 tabular-nums">{numero(x.porcentaje)} %</b>}</span>
                  <Cita ocid={c.ocid} cita={x.cita} />
                </li>
              ))}
            </ul>
          </Placa>
        )}
      </div>
    </BloqueDetalle>
  );
}

// ─── Documentos (plegados) ───────────────────────────────────────────────────────────────────────

function ListaDocumentos({ c, titulo, icono: Icono, docs }: {
  c: Detalle; titulo: string; icono: typeof ClipboardCheck; docs: { documento: string | null; cita: CitaDocumento | null }[];
}) {
  if (!docs.length) return null;
  return (
    <details className="group rounded-2xl border border-line bg-paper">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <Icono size={17} className="shrink-0 text-inkSoft" aria-hidden />
        <span className="min-w-0 flex-1 text-cuerpo font-semibold text-ink">{titulo}</span>
        <span className="shrink-0 rounded-full bg-paperSoft px-2 py-0.5 text-rotulo font-semibold tabular-nums text-inkSoft">{plural(docs.length, "documento", "documentos")}</span>
        <ChevronDown size={16} className="shrink-0 text-mute transition-transform duration-rapido group-open:rotate-180" aria-hidden />
      </summary>
      <ol className="divide-y divide-line border-t border-line">
        {docs.map((x, i) => (
          <li key={i} className="flex items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 w-5 shrink-0 text-right text-rotulo font-semibold tabular-nums text-mute">{i + 1}</span>
            <span className="min-w-0 flex-1 text-dato leading-snug text-ink">{x.documento ?? "Documento sin nombre"}</span>
            <Cita ocid={c.ocid} cita={x.cita} />
          </li>
        ))}
      </ol>
    </details>
  );
}

// ─── La pestaña ──────────────────────────────────────────────────────────────────────────────────

export function SeccionPerfil({ c }: { c: Detalle }) {
  const p = c.perfilContratista!;
  const totalFactores = p.factores.reduce((s, f) => s + (f.puntajeMaximo ?? 0), 0);
  // La frase de arriba sale de los datos, no del resumen del lector (que junta lo de cada tramo leído y habla de la lectura).
  const exp = p.experiencia.find((x) => x.para !== "mype" && cantidadDe(x)) ?? p.experiencia.find((x) => cantidadDe(x));
  const expMype = p.experiencia.find((x) => x.para === "mype" && cantidadDe(x) && x !== exp);
  const precio = p.factores.find((f) => /precio|econ/i.test(f.factor ?? ""));
  const { pasos } = cadenaDePlazos(p);
  const entrega = pasos.find((s) => s.clave === "entrega")?.x ?? null;
  const nExigencias = p.exigencias.length + p.marcas.length + p.personalClave.length + p.equipamiento.length;
  const frase = [
    exp && `Pedían una experiencia de ${cantidadDe(exp)}${expMype ? ` (${cantidadDe(expMype)} a las micro y pequeñas empresas)` : ""}`,
    p.exigencias.length > 0 && `con ${plural(p.exigencias.length, "exigencia particular", "exigencias particulares")}`,
    p.marcas.length > 0 && `con ${plural(p.marcas.length, "marca nombrada", "marcas nombradas")}`,
    precio?.puntajeMaximo != null && totalFactores > 0 && `el precio daba ${numero(precio.puntajeMaximo)} de ${numero(totalFactores)} puntos`,
    entrega?.dias != null && `la entrega era en ${plural(entrega.dias, "día", "días")}`,
  ].filter(Boolean).join(", ");

  const cifras = [
    exp && {
      etiqueta: "Experiencia exigida",
      valor: cantidadDe(exp),
      contexto: expMype ? `${cantidadDe(expMype)} a micro y pequeñas empresas` : exp.anios != null ? `en los últimos ${plural(exp.anios, "año", "años")}` : undefined,
      icono: <Trophy size={15} strokeWidth={1.9} aria-hidden />,
      parte: null,
    },
    entrega?.dias != null && {
      etiqueta: "Plazo de entrega",
      valor: plural(entrega.dias, "día", "días"),
      contexto: pasos.length > 1
        ? `luego ${pasos.filter((s) => s.clave !== "entrega").map((s) => `${plural(s.x!.dias!, "día", "días")} de ${s.titulo.toLowerCase()}`).join(" y ")}`
        : undefined,
      icono: <Timer size={15} strokeWidth={1.9} aria-hidden />,
      parte: null,
    },
    p.cuantia && {
      etiqueta: "Cuantía",
      valor: p.cuantia.estado === "reservada" ? "Reservada" : p.cuantia.valor != null ? soles(p.cuantia.valor) : "No figura",
      contexto: p.cuantia.estado === "reservada" ? "las bases no la dieron a conocer" : p.sistema ? oracion(p.sistema.toLowerCase()) : undefined,
      icono: p.cuantia.estado === "reservada" ? <Lock size={15} strokeWidth={1.9} aria-hidden /> : <Wallet size={15} strokeWidth={1.9} aria-hidden />,
      parte: null,
    },
    (nExigencias > 0 || p.documentosAdmision.length > 0) && {
      etiqueta: "Exigencias particulares",
      valor: numero(nExigencias),
      contexto: p.documentosAdmision.length ? `y ${plural(p.documentosAdmision.length, "documento", "documentos")} para que se admita la oferta` : undefined,
      icono: <ClipboardCheck size={15} strokeWidth={1.9} aria-hidden />,
      parte: null,
    },
  ].filter(Boolean) as Indicador[];

  return (
    <>
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿De dónde sale este perfil?">
            <span className="block">
              De {p.integradas ? "las bases integradas" : "las bases"} del proceso, leídas por un modelo abierto con un extractor a medida: cada
              requisito trae la página donde está y la frase que lo dice. Ábrela para comprobarlo.
            </span>
            <span className="mt-2 block">
              Sirve para mirar si lo que se pidió calza con lo que se compró y si dejaba competir: una experiencia muy alta, una marca sin
              equivalente o un requisito que sólo cumple uno son cosas que revisar, no pruebas de nada.
            </span>
          </Ayuda>
        }
      >
        Lo que las bases le pedían a quien quisiera ganar: experiencia, cómo se puntuaba, plazos, garantías y los documentos para ofertar y firmar.
      </CabeceraPestana>

      <div className="space-y-6">
        {frase && <EnUnaFrase>{frase}.</EnUnaFrase>}
        {cifras.length > 0 && <Indicadores items={cifras} tarjetas />}

        <div className="grid gap-6 lg:grid-cols-2">
          <Puntuacion c={c} p={p} />
          <Experiencia c={c} p={p} />
        </div>

        <Marcadas c={c} titulo="Exigencias particulares" icono={BadgeCheck}
          items={p.exigencias.map((x) => ({ texto: x.exigencia ?? "Exigencia sin detalle", cita: x.cita }))} />
        <Marcadas c={c} titulo="Marcas que nombran las bases" icono={Tag}
          items={p.marcas.map((x) => ({
            texto: x.marca ?? "Marca sin nombre",
            sub: x.admiteEquivalente === false ? "Sin admitir equivalente" : x.admiteEquivalente ? "Admite equivalente" : null,
            cita: x.cita,
          }))} />
        <Marcadas c={c} titulo="Personal clave" icono={Users}
          items={p.personalClave.map((x) => ({
            texto: `${x.cantidad != null && x.cantidad > 1 ? `${numero(x.cantidad)} ` : ""}${x.cargo ?? "Cargo sin nombre"}`,
            sub: [x.profesion, x.experiencia].filter(Boolean).join(". ") || null,
            cita: x.cita,
          }))} />
        <Marcadas c={c} titulo="Equipamiento" icono={Wrench}
          items={p.equipamiento.map((x) => ({ texto: `${x.cantidad != null ? `${numero(x.cantidad)} ` : ""}${x.equipo ?? "Equipo sin nombre"}`, cita: x.cita }))} />

        <Plazos c={c} p={p} />
        <GarantiasPenalidades c={c} p={p} />

        {(p.documentosAdmision.length > 0 || p.documentosContrato.length > 0) && (
          <BloqueDetalle titulo="Documentos">
            <div className="space-y-2.5">
              <ListaDocumentos c={c} titulo="Para que se admita la oferta" icono={ClipboardCheck} docs={p.documentosAdmision} />
              <ListaDocumentos c={c} titulo="Lo que el ganador debía presentar para firmar" icono={FileSignature} docs={p.documentosContrato} />
            </div>
          </BloqueDetalle>
        )}

        {(p.formaDePago || p.controversias) && (
          <BloqueDetalle titulo="Pago y controversias">
            <div className="grid gap-3 sm:grid-cols-2">
              {p.formaDePago && (
                <Placa>
                  <Rotulo icono={Wallet} ocid={c.ocid}>Pago</Rotulo>
                  <p className="mt-1.5 text-dato leading-relaxed text-ink">{p.formaDePago}</p>
                </Placa>
              )}
              {p.controversias && (
                <Placa>
                  <Rotulo icono={Gavel} ocid={c.ocid}>Controversias</Rotulo>
                  <p className="mt-1.5 text-dato leading-relaxed text-ink">{p.controversias}</p>
                </Placa>
              )}
            </div>
          </BloqueDetalle>
        )}
      </div>

      <FuenteDato
        fuente={`${p.documento ?? (p.integradas ? "Bases integradas" : "Bases")} del SEACE, leídas el ${p.leido ? fechaConAnio(p.leido) : "día de la lectura"}`}
        enlaces={enlacesProceso(c.ocid, { codigo: c.codigo })}
        className="mt-4"
      />
    </>
  );
}
