"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { DatosClave, EnUnaFrase, FuenteDato, type DatoClave } from "@/components/patrones";
import { usePoder } from "@/components/grafo/vista";
import type { Fila } from "@/components/listado";
import { Button } from "@/components/ui/Button";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { decimal, fechaConAnio, numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { aniosDeLasOrdenes, fechasEnElPuesto, loQueRecibio, ordenesEnElPuesto, ordenesFueraDelPuesto, papelEnLaEmpresa, periodoDelPuesto, reglaCompraFamilia } from "@/lib/comprasFamilia";
import { loQueVendio, ventasFrenteALaSalida } from "@/lib/autoridadExsocio";
import { CONOSCE_BUSCADOR, DATASET_AUTORIDADES_JNE, DATASET_DJI, DATASET_SOCIOS_RNP, djiEntidad, fichaRnp } from "@/lib/fuentes";
import { VentasCompraFamilia } from "./VentasCompraFamilia";
import {
  codigoDeOcid,
  type AlcancePatron,
  type PatronAcompanante,
  type PatronConsorcio,
  type PatronAutoridadExsocio,
  type PatronCompraFamilia,
  type PatronDoble,
  type PatronControl,
  type PatronDueno,
  type PatronGrupo,
  type PatronInhabilitada,
  type PatronObservacion,
  type PatronObservado,
  type PatronRecien,
  type PatronRenovacion,
  type PatronRepetida,
  type PatronSenal,
} from "@/lib/patrones";
import { rutaContrato } from "@/lib/rutas";
import { rutaCaso } from "@/lib/casoPatron";

/**
 * El panel lateral de una fila de /app/patrones (pedido del dueño del 2026-11-16: «quiero clickear y ver la información
 * en la barra lateral o leer todo el análisis, pero sólo me deja ver la tabla»). Cada patrón se cuenta igual: en una
 * frase lo que se encontró, sus cifras, los contratos que lo sostienen (cada uno abre su ficha), qué conviene revisar
 * (pasos numerados) y, al pie, las fichas de las empresas o de la entidad. En «Postores de relleno» la lista de procesos
 * en que coincidieron las dos empresas se pide al abrir el panel (GET /patrones/acompanantes/procesos).
 *
 * Privacidad: el título y la etiqueta del panel nunca llevan el nombre de una persona (van a `title` y `aria-label`); un
 * socio sale como llega de la API, con un apellido tapado, sólo dentro del contenido.
 */
type Detalle = NonNullable<Fila["detalle"]>;

const ENLACE = "font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate";
const empresa = (n: string | null | undefined) => (n ? tituloNatural(n) : "Empresa sin nombre");
const entidad = (n: string | null | undefined) => (n ? tituloNatural(n) : "Entidad sin nombre");
const esRuc20 = (r: string | null | undefined): r is string => !!r && /^20\d{9}$/.test(r);
/** «ADQUISICION DE PORCELANATO 60X60» → «Adquisición de porcelanato 60X60». */
const oracionCorta = (t: string) => {
  const x = t.trim();
  if (x !== x.toUpperCase()) return x;
  const b = x.toLowerCase().replace(/\b([a-z]*\d[a-z\d-]*)\b/g, (m) => m.toUpperCase());
  return b.charAt(0).toUpperCase() + b.slice(1);
};
/** El nombre para el TÍTULO del panel (va a `title` y `aria-label`): sólo el de una empresa; una persona natural, un rótulo. */
const paraTitulo = (ruc: string | null | undefined, nombre: string | null | undefined, rotulo: string) => (esRuc20(ruc) && nombre ? tituloNatural(nombre) : rotulo);
const anios = (a: string | null, b: string | null) => {
  const x = a?.slice(0, 4);
  const y = b?.slice(0, 4);
  return x && y && x !== y ? `de ${x} a ${y}` : x || y ? `en ${x ?? y}` : null;
};
const RESPONSABILIDAD: Record<string, string> = {
  penal: "penal", civil: "civil", administrativa_entidad: "administrativa", administrativa_pas: "administrativa", administrativa: "administrativa",
};
const responsabilidad = (xs: string[] | null | undefined) => {
  const u = [...new Set((xs ?? []).map((r) => RESPONSABILIDAD[r] ?? r))];
  return u.length ? u.join(" y ") : null;
};

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2" data-bloque>
      <h3 className="text-cuerpo font-semibold text-ink">{titulo}</h3>
      {children}
    </section>
  );
}

/** Qué conviene revisar: pasos numerados (nunca un párrafo). */
function QueRevisar({ pasos: todos }: { pasos: ReactNode[] }) {
  // Un paso que no aplica llega vacío: sin esto quedaba un número suelto al final de la lista.
  const pasos = todos.filter((x) => x != null && x !== false && x !== "");
  return (
    <Bloque titulo="Qué conviene revisar">
      <ol className="space-y-1.5">
        {pasos.map((p, i) => (
          <li key={i} className="flex gap-2.5 text-dato leading-snug text-inkSoft">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-paperDeep font-mono text-rotulo font-semibold tabular-nums text-ink" aria-hidden>
              {i + 1}
            </span>
            <span className="min-w-0">{p}</span>
          </li>
        ))}
      </ol>
      <p className="text-rotulo leading-relaxed text-mute">Un patrón es un motivo para mirar, no una acusación.</p>
    </Bloque>
  );
}

/** Los contratos que sostienen el patrón: cada uno abre su ficha en sus antecedentes. */
function Contratos({ ocids, total, que }: { ocids: string[]; total?: number | null; que: string }) {
  if (!ocids.length) return null;
  const resto = Math.max(total ?? 0, ocids.length) - ocids.length;
  return (
    <Bloque titulo={ocids.length === 1 ? "El contrato" : "Los contratos"}>
      <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line" data-lista="avance">
        {ocids.map((o) => (
          <li key={o}>
            <Link
              href={rutaContrato(o, "ficha", { seccion: "antecedentes" })}
              prefetch={false}
              className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2 text-dato transition-colors hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
            >
              <span className="font-mono tabular-nums text-granate underline decoration-granate/35 underline-offset-2">{codigoDeOcid(o)}</span>
              <span className="text-meta text-mute">Abrir su ficha</span>
            </Link>
          </li>
        ))}
      </ul>
      {resto > 0 && (
        <p className="text-rotulo text-mute">
          Son {numero(ocids.length)} de ejemplo; hay {plural(resto, "contrato más", "contratos más")} {que}.
        </p>
      )}
    </Bloque>
  );
}

/** Sin las filas vacías: un «Sin dato» por algo que no aplica al caso (los procesos de una persona natural) confunde. */
const conValor = (items: (DatoClave | null | false | undefined)[]) => items.filter((d): d is DatoClave => !!d && d.valor != null && d.valor !== "");

function Pie({ enlaces }: { enlaces: ({ texto: string; href: string } | null | false | undefined)[] }) {
  const xs = enlaces.filter((e): e is { texto: string; href: string } => !!e);
  if (!xs.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {xs.map((e, i) => (
        <EnlaceAccion key={e.href} href={e.href} prefetch={false} variante={i === 0 ? "primario" : "secundario"} flecha>
          {e.texto}
        </EnlaceAccion>
      ))}
    </div>
  );
}

// ─── Señales que se repiten (por entidad, por proveedor) ─────────────────────────

export function detalleSenal(p: PatronSenal, alcance: AlcancePatron, senal: string): Detalle {
  const quien = alcance === "entidad" ? entidad(p.nombre) : empresa(p.nombre);
  const tasa = p.tasa ?? (p.leidos > 0 ? p.casos / p.leidos : 0);
  const datos: DatoClave[] = [
    { etiqueta: "Contratos con la señal", valor: numero(p.casos), mono: true },
    { etiqueta: "Contratos leídos por Vigía", valor: numero(p.leidos), mono: true },
    { etiqueta: "Parte con la señal", valor: porcentaje(tasa * 100, { decimales: 1 }), mono: true },
    ...(p.tasaPais != null ? [{ etiqueta: "La misma parte en el país", valor: porcentaje(p.tasaPais * 100, { decimales: 1 }), mono: true }] : []),
    ...(p.veces != null ? [{ etiqueta: "Frente al país", valor: `${decimal(p.veces)} veces`, mono: true }] : []),
    ...(p.entidades != null ? [{ etiqueta: "Entidades en que se repite", valor: numero(p.entidades), mono: true }] : []),
    ...(p.monto != null ? [{ etiqueta: "Monto de esos contratos", valor: solesCompacto(p.monto), mono: true }] : []),
    ...(p.calculadoEl ? [{ etiqueta: "Calculado el", valor: fechaConAnio(p.calculadoEl) }] : []),
  ];
  return {
    titulo: senal,
    etiqueta: `Ver el detalle del patrón «${senal}»`,
    descripcion: <span className="line-clamp-2">{quien}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase>
          {alcance === "entidad" ? (
            <>
              En <b>{quien}</b>, la señal «{senal}» aparece en <b>{numero(p.casos)}</b> de sus {numero(p.leidos)} contratos leídos
              {p.veces != null ? <>: <b>{decimal(p.veces)} veces</b> lo que se ve en el país</> : ""}.
            </>
          ) : (
            <>
              <b>{quien}</b> tiene la señal «{senal}» en <b>{numero(p.casos)}</b> de sus {numero(p.leidos)} contratos leídos
              {p.entidades != null ? <>, en {plural(p.entidades, "entidad", "entidades")}</> : ""}.
            </>
          )}
        </EnUnaFrase>
        <DatosClave items={datos} />
        <Contratos ocids={p.ejemplos ?? []} total={p.casos} que="con la señal" />
        <QueRevisar
          pasos={[
            "Abre cada contrato y lee la evidencia de esa señal en su dictamen: una señal repetida pesa más si los hechos se parecen.",
            alcance === "entidad" ? "Mira si los ganadores de esos contratos se repiten o comparten socios." : "Mira si se repite en entidades de un mismo gobierno o de una misma zona.",
            "Compara con los contratos sin la señal: qué cambia (el área usuaria, el comité, el monto).",
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("senales", p.clave) },
          alcance === "entidad" && esRuc20(p.ruc) && { texto: "Ficha de la entidad", href: `/entidad/${p.ruc}` },
          alcance === "proveedor" && esRuc20(p.ruc) && { texto: "Ficha de la empresa", href: `/empresa/${p.ruc}` },
        ]}
      />
    ),
  };
}

// ─── Postores de relleno ─────────────────────────────────────────────────────────

interface ProcesosPareja {
  total: number;
  ganoElGanador: number;
  ganoElAcompanante: number;
  delPatron: number;
  data: { codigo: string; ocid: string | null; entidadRuc: string | null; entidad: string | null; objeto: string | null; fecha: string | null; monto: number | null;
          ganoElGanador: boolean; ganoElAcompanante: boolean; postores: number }[];
}

/** Los procesos en que postularon las dos empresas: se piden al abrir el panel. */
function ProcesosDeLaPareja({ p }: { p: PatronAcompanante }) {
  const carga = usePoder<ProcesosPareja>(`/patrones/acompanantes/procesos?acompanante=${p.rucAcompanante}&ganador=${p.rucGanador}`);
  if (carga.cargando && !carga.datos) {
    return (
      <p className="flex items-center gap-2 text-dato text-mute">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Buscando los procesos en que coincidieron…
      </p>
    );
  }
  if (carga.error || !carga.datos) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-dato text-inkSoft">
        No pudimos traer los procesos ahora.
        <Button variant="secondary" onClick={carga.reintentar}>Reintentar</Button>
      </div>
    );
  }
  const d = carga.datos;
  if (!d.data.length) return <p className="text-dato text-inkSoft">CONOSCE no trae los procesos de esta pareja.</p>;
  return (
    <>
      <p className="text-meta text-inkSoft">
        Postularon las dos en {plural(d.total, "proceso", "procesos")}: {empresa(p.ganador)} ganó {numero(d.ganoElGanador)} y {empresa(p.acompanante)},{" "}
        {d.ganoElAcompanante > 0 ? numero(d.ganoElAcompanante) : "ninguno"}. El patrón cuenta los de 2 a 4 postores que ganó la primera ({numero(d.delPatron)}).
      </p>
      <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line" data-lista="avance">
        {d.data.map((x) => {
          const gano = x.ganoElGanador ? empresa(p.ganador) : x.ganoElAcompanante ? empresa(p.acompanante) : "otro postor";
          return (
            <li key={x.codigo}>
              <Link
                href={rutaContrato(x.ocid ?? x.codigo, "ficha", { seccion: "antecedentes" })}
                prefetch={false}
                className="block px-3.5 py-2.5 transition-colors hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="min-w-0 text-dato font-medium text-ink">{x.objeto ? tituloNatural(x.objeto) : `Proceso ${x.codigo}`}</span>
                  <span className="shrink-0 font-mono text-meta tabular-nums text-inkSoft">{x.monto != null ? solesCompacto(x.monto) : "Sin monto"}</span>
                </span>
                <span className="mt-0.5 block text-rotulo text-mute">
                  {x.fecha ? `${fechaConAnio(x.fecha)}, ` : ""}
                  {entidad(x.entidad)}; {plural(x.postores, "postor", "postores")}; ganó {gano}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {d.total >= 80 && <p className="text-rotulo text-mute">Se muestran los 80 más recientes.</p>}
    </>
  );
}

export function detalleRelleno(p: PatronAcompanante): Detalle {
  const a = empresa(p.acompanante);
  const g = empresa(p.ganador);
  const cuando = anios(p.desde, p.hasta);
  return {
    titulo: esRuc20(p.rucAcompanante) && esRuc20(p.rucGanador) ? `${a} junto a ${g}` : "Un postor junto al mismo ganador",
    etiqueta: "Ver el detalle de esta pareja de ganador y acompañante",
    descripcion: <span className="line-clamp-2">Postula casi siempre al lado del mismo ganador y casi nunca gana.</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.vinculo === "socio_comun" ? "alta" : "media"}>
          <b>{a}</b> postuló {numero(p.postulacionesDelAcompanante)} veces y ganó {p.ganadasDelAcompanante > 0 ? numero(p.ganadasDelAcompanante) : "ninguna"}. En{" "}
          <b>{numero(p.juntos)}</b> de esas postulaciones ({porcentaje(p.parte * 100)}) estaba también <b>{g}</b>, que ganó, en procesos de 2 a 4 postores de{" "}
          {plural(p.entidades, "entidad", "entidades")}
          {cuando ? `, ${cuando}` : ""}.{p.vinculo === "socio_comun" ? " Además, las dos comparten un socio o representante." : ""}
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "Postulaciones de la que acompaña", valor: numero(p.postulacionesDelAcompanante), mono: true },
            { etiqueta: "Junto a ese ganador", valor: `${numero(p.juntos)} (${porcentaje(p.parte * 100)})`, mono: true },
            { etiqueta: "Veces que ganó", valor: p.ganadasDelAcompanante > 0 ? numero(p.ganadasDelAcompanante) : "Ninguna", mono: true },
            { etiqueta: "Entidades", valor: numero(p.entidades), mono: true },
            { etiqueta: "Vínculo entre las dos", valor: p.vinculo === "socio_comun" ? "Comparten un socio o representante (RNP)" : "Ninguno en el RNP" },
            { etiqueta: "Patrón completo", valor: p.fuerte ? "Sí: 60 % o más junto a ese ganador y gana 1 de cada 10 o menos" : "Casi: está cerca de los umbrales" },
          ]}
        />
        <Bloque titulo="Los procesos en que coincidieron">
          <ProcesosDeLaPareja p={p} />
        </Bloque>
        <QueRevisar
          pasos={[
            "En cada proceso, compara las dos ofertas: si la que acompaña ofertó siempre un poco por encima, o quedó descalificada por algo evitable.",
            "Abre la ficha de las dos empresas y mira su red: domicilio, socios, representantes y teléfonos en común.",
            "Mira si la que acompaña tiene capacidad real: su rubro en la SUNAT y si vende algo fuera de estos procesos.",
            "Revisa quién más postuló y por qué quedó fuera: una oferta de cobertura sirve cuando los demás no llegan.",
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("relleno", p.clave) },
          esRuc20(p.rucGanador) && { texto: "Ficha de quien gana", href: `/empresa/${p.rucGanador}` },
        ]}
      />
    ),
  };
}

// ─── Socias de consorcio que después compiten ────────────────────────────────────

export function detalleConsorcio(p: PatronConsorcio): Detalle {
  const a = empresa(p.nombreA);
  const b = empresa(p.nombreB);
  const cuando = anios(p.desde, p.hasta);
  return {
    titulo: esRuc20(p.rucA) && esRuc20(p.rucB) ? `${a} y ${b}` : "Dos socias de consorcio que compiten",
    etiqueta: "Ver el detalle de estas socias que compiten",
    descripcion: <span className="line-clamp-2">Fueron socias en un consorcio y después compiten por separado.</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.mercadoNacional ? "neutro" : "media"}>
          <b>{a}</b> y <b>{b}</b> postularon juntas en {plural(p.consorcios, "consorcio", "consorcios")} y, por separado, se enfrentaron en{" "}
          <b>{plural(p.rivales, "proceso", "procesos")}</b> de pocos postores{p.solas > 0 ? ` (en ${numero(p.solas)} eran las únicas dos)` : ""}
          {cuando ? `, ${cuando}` : ""}: la primera ganó {numero(p.ganoA)} y la segunda {numero(p.ganoB)}.
          {p.mercadoNacional ? " Coinciden en más de 20 entidades: puede ser la forma de su mercado, no un acuerdo." : ""}
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "Consorcios en que fueron socias", valor: numero(p.consorcios), mono: true },
            { etiqueta: "Procesos en que se enfrentaron", valor: numero(p.rivales), mono: true },
            { etiqueta: "Eran las únicas dos", valor: p.solas > 0 ? numero(p.solas) : "Ninguno", mono: true },
            { etiqueta: "Ganó la primera", valor: `${numero(p.ganoA)}, ${a}` },
            { etiqueta: "Ganó la segunda", valor: `${numero(p.ganoB)}, ${b}` },
            { etiqueta: "Entidades", valor: numero(p.entidades), mono: true },
          ]}
        />
        <QueRevisar
          pasos={[
            "Mira si se turnan: una gana en unas entidades y la otra en otras, o se alternan en el tiempo.",
            "Compara sus ofertas en los procesos en que eran las únicas dos: precios muy parecidos o una que siempre pierde por poco.",
            "Revisa si el consorcio sigue vigente o si comparten socios, domicilio o representante.",
          ]}
        />
      </div>
    ),
    pie: <Pie enlaces={[!!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("consorcios", p.clave) }, esRuc20(p.rucA) && { texto: "Ficha de la primera", href: `/empresa/${p.rucA}` }]} />,
  };
}

// ─── El mismo dueño gana con varias empresas ─────────────────────────────────────

export function detalleDueno(p: PatronDueno): Detalle {
  const ent = entidad(p.entidad);
  const socio = p.socios?.[0]?.nombre ?? "Un mismo socio";
  const cuando = anios(p.desde, p.hasta);
  return {
    titulo: `Un mismo dueño, ${plural(p.empresas.length, "empresa", "empresas")}`,
    etiqueta: "Ver el detalle de este grupo de empresas del mismo dueño",
    descripcion: <span className="line-clamp-2">{ent}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.seguidos > 0 ? "alta" : "media"}>
          En <b>{ent}</b>, {socio} es socio de {plural(p.empresas.length, "empresa", "empresas")} que ganaron <b>{plural(p.contratos, "contrato", "contratos")}</b> de objeto
          parecido{p.seguidos > 0 ? <>, <b>{numero(p.seguidos)}</b> de ellos a 90 días o menos de otro</> : ""}
          {p.monto != null ? ` por ${solesCompacto(p.monto)}` : ""}
          {cuando ? `, ${cuando}` : ""}.
        </EnUnaFrase>
        <Bloque titulo="Las empresas">
          <ul className="space-y-1 text-dato">
            {p.empresas.map((e) => (
              <li key={e.ruc}>
                {esRuc20(e.ruc) ? (
                  <Link href={`/empresa/${e.ruc}`} prefetch={false} className={ENLACE}>{empresa(e.nombre)}</Link>
                ) : (
                  empresa(e.nombre)
                )}
              </li>
            ))}
          </ul>
        </Bloque>
        <DatosClave
          items={[
            { etiqueta: "Contratos de objeto parecido", valor: numero(p.contratos), mono: true },
            { etiqueta: "A 90 días o menos de otro", valor: p.seguidos > 0 ? numero(p.seguidos) : "Ninguno", mono: true },
            { etiqueta: "Monto", valor: p.monto != null ? solesCompacto(p.monto) : null, mono: true },
          ]}
        />
        <Contratos ocids={p.ejemplos ?? []} total={p.contratos} que="en este grupo" />
        <QueRevisar
          pasos={[
            "Mira si las compras debieron ser un solo proceso: el mismo objeto, la misma entidad y pocos días entre una y otra.",
            "Confirma en el RNP qué parte del capital tiene el socio en cada empresa y desde cuándo.",
            "Revisa si las empresas compitieron entre sí en algún proceso de la entidad.",
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("duenos", p.clave) },
          esRuc20(p.entidadRuc) && { texto: "Sus otros patrones en la entidad", href: `/entidad/${p.entidadRuc}?seccion=patrones&patron=duenos` },
        ]}
      />
    ),
  };
}

// ─── Grupo por dueño y familia, en las órdenes de una entidad ────────────────────

/** El nombre de un integrante: la empresa con su enlace; la persona (un apellido tapado) con su ficha si la tiene. */
function Integrante({ m }: { m: { ruc: string; nombre: string | null; persona?: boolean; codigo?: string | null } }) {
  if (!m.persona && esRuc20(m.ruc)) return <Link href={`/empresa/${m.ruc}`} prefetch={false} className={ENLACE}>{empresa(m.nombre)}</Link>;
  const n = m.nombre ? tituloNatural(m.nombre) : "Persona natural";
  return m.codigo ? <Link href={`/app/personas/${m.codigo}`} prefetch={false} className={ENLACE}>{n}</Link> : <span>{n}</span>;
}

export function detalleGrupo(p: PatronGrupo): Detalle {
  const ent = entidad(p.entidad);
  const cuando = anios(p.desde, p.hasta);
  const porMiembro = new Map(p.miembros.map((m) => [m.ruc, m]));
  const quien = (ruc: string, nombre: string | null) => <Integrante m={porMiembro.get(ruc) ?? { ruc, nombre }} />;
  return {
    titulo: `Grupo de ${plural(p.miembros.length, "proveedor", "proveedores")} en una entidad`,
    etiqueta: "Ver el detalle de este grupo de proveedores",
    descripcion: <span className="line-clamp-2">{ent}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.severidad === "alta" ? "alta" : "media"}>
          En <b>{ent}</b>, {plural(p.empresas, "empresa", "empresas")}
          {p.personas ? <> y {plural(p.personas, "persona", "personas")} que venden con su RUC</> : ""} unidas por sus socios recibieron{" "}
          <b>{plural(p.ordenes, "orden", "órdenes")}</b> por <b>{solesCompacto(p.monto)}</b>{cuando ? `, ${cuando}` : ""}.
          {p.puestoGrupo && p.puestoMayor && p.puestoGrupo < p.puestoMayor
            ? <> Juntos serían el proveedor n.° <b>{numero(p.puestoGrupo)}</b> de la entidad; el mayor de ellos, solo, es el n.° {numero(p.puestoMayor)}.</>
            : ""}
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "De sus ventas por órdenes, de esta entidad", valor: p.parteEntidad != null ? porcentaje(p.parteEntidad * 100) : null, mono: true },
            { etiqueta: "Al borde del tope de 8 UIT", valor: p.hasta8Uit ? `${numero(p.borde)} de ${numero(p.hasta8Uit)} órdenes` : "Sin órdenes de hasta 8 UIT", mono: true },
            { etiqueta: "Por encima del tope", valor: p.sobreTope ? numero(p.sobreTope) : "Ninguna", mono: true },
            { etiqueta: "Días con órdenes a varios integrantes", valor: p.diasJuntos ? `${numero(p.diasJuntos)} (${solesCompacto(p.montoJuntos)})` : "Ninguno", mono: true },
            { etiqueta: "Pares de órdenes correlativas", valor: p.correlativas ? numero(p.correlativas) : "Ninguno", mono: true },
            { etiqueta: "El mismo objeto repartido", valor: p.repartidos ? `${numero(p.repartidos)} (${solesCompacto(p.montoRepartido)})` : "Ninguno", mono: true },
          ]}
        />
        <Bloque titulo="Quiénes son">
          <ul className="space-y-1.5 text-dato">
            {p.miembros.map((m) => (
              <li key={m.ruc} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <Integrante m={m} />
                  {m.persona ? <span className="ml-1.5 text-rotulo text-mute">persona natural</span> : null}
                  {m.parteDeSusVentas != null && m.parteDeSusVentas >= 0.5 ? (
                    <span className="ml-1.5 text-rotulo text-amberTexto">{porcentaje(m.parteDeSusVentas * 100)} de sus ventas por órdenes</span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-meta tabular-nums text-inkSoft">{solesCompacto(m.monto)}</span>
              </li>
            ))}
          </ul>
        </Bloque>
        {(p.parientesDeFuncionarios ?? []).length > 0 && (
          <Bloque titulo="Parientes declarados de funcionarios de la entidad">
            <ul className="space-y-1.5 text-meta leading-relaxed text-inkSoft">
              {p.parientesDeFuncionarios.map((d, i) => (
                <li key={i}>
                  {d.via === "socio" ? (
                    <>
                      {quien(d.ruc, d.nombre)}: uno de sus socios o representantes es {(d.parentesco ?? "pariente").toLowerCase()} de{" "}
                      {d.cargo ? <>un funcionario de la entidad ({tituloNatural(d.cargo)})</> : "un funcionario de la entidad"}, según su declaración jurada de intereses.
                    </>
                  ) : (
                    <>
                      {quien(d.ruc, d.nombre)}: {d.cargo ? <>un funcionario de la entidad ({tituloNatural(d.cargo)})</> : "un funcionario de la entidad"} lo declaró
                      como {(d.parentesco ?? "pariente").toLowerCase()} en su declaración jurada de intereses.
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Bloque>
        )}
        <Bloque titulo="Por qué están juntos">
          <ul className="space-y-1.5 text-meta leading-relaxed text-inkSoft">
            {/* recorte: los vínculos de un grupo grande se repiten; los primeros doce bastan para ver qué los une */}
            {p.vinculos.slice(0, 12).map((v, i) => (
              <li key={i}>
                {quien(v.a, v.nombreA)} y {quien(v.b, v.nombreB)}: {v.que}
                {v.persona ? <> ({tituloNatural(v.persona)}{v.personaB ? <> y {tituloNatural(v.personaB)}</> : null})</> : null}.
              </li>
            ))}
            {p.vinculos.length > 12 ? <li>Y {plural(p.vinculos.length - 12, "vínculo más", "vínculos más")}.</li> : null}
          </ul>
        </Bloque>
        {p.dias.length > 0 && (
          <Bloque titulo="Días con órdenes a varios integrantes">
            <ul className="space-y-2.5 text-meta">
              {/* recorte: los seis días con más órdenes correlativas o más monto; la API trae hasta quince */}
              {p.dias.slice(0, 6).map((d) => (
                <li key={d.fecha} className="rounded-xl border border-line px-3 py-2">
                  <p className="font-semibold text-ink">
                    {fechaConAnio(d.fecha)}: {plural(d.ordenes, "orden", "órdenes")} a {plural(d.miembros, "integrante", "integrantes")}, {solesCompacto(d.monto)}
                    {d.correlativas ? <span className="ml-1.5 text-amberTexto">{plural(d.correlativas, "par correlativo", "pares correlativos")}</span> : null}
                  </p>
                  <p className="mt-0.5 text-rotulo text-mute">{d.detalle.map((o) => `${o.orden} (${solesCompacto(o.monto)})`).join(", ")}</p>
                </li>
              ))}
            </ul>
          </Bloque>
        )}
        {p.objetosRepartidos.length > 0 && (
          <Bloque titulo="El mismo objeto, repartido entre integrantes">
            <ul className="space-y-2.5 text-meta">
              {/* recorte: los seis objetos de mayor monto; la API trae hasta quince */}
              {p.objetosRepartidos.slice(0, 6).map((x, i) => (
                <li key={i} className="rounded-xl border border-line px-3 py-2">
                  <p className="font-semibold text-ink">{oracionCorta(x.objeto)} ({x.anio})</p>
                  <p className="mt-0.5 text-rotulo text-mute">
                    {plural(x.ordenes, "orden", "órdenes")} a {plural(x.miembros, "integrante", "integrantes")} por {solesCompacto(x.monto)}; el tope de una orden era {solesCompacto(x.tope)}.
                  </p>
                </li>
              ))}
            </ul>
          </Bloque>
        )}
        <QueRevisar
          pasos={[
            "Pide a la entidad los expedientes de las órdenes de los días destacados: si salieron de un mismo requerimiento, es un fraccionamiento.",
            "Confirma el parentesco con documentos (RENIEC, partidas): aquí sale de los apellidos y del Registro Nacional de Proveedores.",
            "Revisa quién pidió, cotizó, aprobó y dio conformidad a cada orden, y si los integrantes cotizaron unos contra otros.",
          ]}
        />
      </div>
    ),
    // La ficha del caso cuenta su historia entera (red, cronología, cada orden): el panel es su vista previa (pedido del
    // usuario del 2026-11-18: «esto no debería llevar a la ficha de la entidad»).
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("grupos", p.clave) },
          esRuc20(p.entidadRuc) && { texto: "Sus otros patrones en la entidad", href: `/entidad/${p.entidadRuc}?seccion=patrones&patron=grupos` },
        ]}
      />
    ),
  };
}

// ─── La misma compra repetida en semanas ─────────────────────────────────────────

/** Una orden no tiene ficha propia: la lista de compras de la entidad, buscando su número en el año de la orden. */
const rutaOrden = (entidadRuc: string, orden: string, fecha: string) => {
  const n = /(\d{3,8})/.exec(orden)?.[1];
  const q = new URLSearchParams({ seccion: "contratos", ...(n ? { cq: n } : {}), canio: fecha.slice(0, 4) });
  return `/entidad/${entidadRuc}?${q}`;
};
const ESTADO_ORDEN: Record<string, string> = { Devengada: "devengada", Emitida: "emitida", Comprometida: "comprometida" };

export function detalleRepetida(p: PatronRepetida): Detalle {
  const ent = entidad(p.entidad);
  const prov = p.nombre ? tituloNatural(p.nombre) : "Persona natural";
  const pasa = p.total > p.tope;
  const todasDevengadas = p.devengadas === p.ordenes;
  return {
    titulo: paraTitulo(p.ruc, p.nombre, "La misma compra repetida"),
    etiqueta: "Ver el detalle de esta compra repetida",
    descripcion: <span className="line-clamp-2">{ent}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.severidad === "alta" ? "alta" : "media"}>
          <b>{ent}</b> le emitió a <b>{prov}</b> {plural(p.ordenes, "orden", "órdenes")} de compra directas por <b>{solesCompacto(p.monto)}</b> cada una, con la
          misma descripción, en <b>{plural(p.dias, "día", "días")}</b>.
          {pasa ? <> Juntas suman {solesCompacto(p.total)}: pasan el tope de una orden ({solesCompacto(p.tope)}).</> : <> Juntas suman {solesCompacto(p.total)}.</>}
          {todasDevengadas ? " Todas llegaron a devengarse." : ""}
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "Monto de cada orden", valor: solesCompacto(p.monto), mono: true },
            { etiqueta: "Juntas", valor: solesCompacto(p.total), mono: true },
            { etiqueta: "Tope de una orden directa ese año", valor: solesCompacto(p.tope), mono: true },
            { etiqueta: "Cada una, frente al tope", valor: porcentaje((p.monto / p.tope) * 100), mono: true },
            { etiqueta: "Devengadas", valor: todasDevengadas ? "Todas" : `${numero(p.devengadas)} de ${numero(p.ordenes)}`, mono: true },
          ]}
        />
        {p.objeto ? (
          <Bloque titulo="Qué se compró">
            <p className="text-dato leading-relaxed text-inkSoft">{oracionCorta(p.objeto)}</p>
          </Bloque>
        ) : null}
        <Bloque titulo="Las órdenes">
          <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line">
            {p.detalle.map((o, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2 text-dato">
                <Link href={rutaOrden(p.entidadRuc, o.orden, o.fecha)} prefetch={false} className={`${ENLACE} min-w-0 truncate font-mono`}>
                  {o.orden}
                </Link>
                <span className="shrink-0 text-meta text-inkSoft">
                  {fechaConAnio(o.fecha)}
                  {o.estado ? `, ${ESTADO_ORDEN[o.estado] ?? o.estado.toLowerCase()}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Bloque>
        <QueRevisar
          pasos={[
            "Pide los requerimientos de cada orden: si salieron de una misma necesidad, es un fraccionamiento y debió convocarse un proceso.",
            todasDevengadas
              ? "Pide los comprobantes de pago y las conformidades de cada orden: si la entrega es una sola, se pagó dos veces."
              : "Mira si la orden que falta se anuló o sigue abierta, y si la entrega es una sola.",
            "Si es un suministro que se repite cada mes, confirma que el plan anual lo previó así y que no se evitó un proceso por el total del año.",
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("repetidas", p.clave) },
          esRuc20(p.ruc) && { texto: "Ficha del proveedor", href: `/empresa/${p.ruc}` },
        ]}
      />
    ),
  };
}

// ─── Dos ingresos del Estado: planilla y órdenes de servicio de otra entidad ─────

const MESES_CORTOS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
const mesCorto = (m: string | null) => (m && /^\d{4}-\d{2}/.test(m) ? `${MESES_CORTOS[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}` : null);

export function detalleAutoridadExsocio(p: PatronAutoridadExsocio): Detalle {
  const ent = entidad(p.entidad);
  const cargo = tituloNatural(p.cargo).toLowerCase();
  const empresa = p.empresa ? tituloNatural(p.empresa) : `la empresa con RUC ${p.empresaRuc}`;
  const quien = p.autoridad ? tituloNatural(p.autoridad) : "Una autoridad electa";
  const periodo = `del ${fechaConAnio(p.periodoInicio)}${p.periodoFin ? ` al ${fechaConAnio(p.periodoFin)}` : " a hoy"}`;
  return {
    // El nombre de la autoridad nunca va al título del panel.
    titulo: "Autoridad que dejó su empresa",
    etiqueta: "Ver el detalle de este caso de una autoridad que dejó su empresa",
    descripcion: <span className="line-clamp-2">{ent}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.severidad === "alta" ? "alta" : "media"}>
          <b>{quien}</b>, {cargo}
          {p.lugar ? ` de ${tituloNatural(p.lugar)}` : ""}, figuraba como <b>{p.roles.join(", ")}</b> de{" "}
          {esRuc20(p.empresaRuc) ? (
            <Link href={`/empresa/${p.empresaRuc}?seccion=gente`} prefetch={false} className={ENLACE}>{empresa}</Link>
          ) : (
            <b>{empresa}</b>
          )}{" "}
          y dejó de figurar en el corte del {fechaConAnio(p.bajaCorte)}. Durante su periodo,{" "}
          {esRuc20(p.entidadRuc) ? (
            <Link href={`/entidad/${p.entidadRuc}`} prefetch={false} className={ENLACE}>{ent}</Link>
          ) : (
            <b>{ent}</b>
          )}{" "}
          le compró a esa empresa <b>{loQueVendio(p)}</b>. {ventasFrenteALaSalida(p)}
        </EnUnaFrase>
        <DatosClave
          items={conValor([
            { etiqueta: "Cargo electo", valor: `${tituloNatural(p.cargo)}${p.lugar ? `, ${tituloNatural(p.lugar)}` : ""}` },
            { etiqueta: "Su periodo", valor: periodo.charAt(0).toUpperCase() + periodo.slice(1) },
            { etiqueta: "Papel en la empresa", valor: p.roles.join(", ").replace(/^./, (x) => x.toUpperCase()) },
            { etiqueta: "Figuraba desde", valor: p.desde ? fechaConAnio(p.desde) : null },
            { etiqueta: "Dejó de figurar (corte del RNP)", valor: fechaConAnio(p.bajaCorte) },
            { etiqueta: "Órdenes en su periodo", valor: p.ordenes ? `${numero(p.ordenes)} por ${solesCompacto(p.montoOrdenes)}` : "Ninguna", mono: !!p.ordenes },
            { etiqueta: "Procesos adjudicados en su periodo", valor: p.procesos ? `${numero(p.procesos)} por ${solesCompacto(p.montoProcesos)}` : "Ninguno", mono: !!p.procesos },
            { etiqueta: "Cuando todavía figuraba", valor: p.ventasMientras ? plural(p.ventasMientras, "venta", "ventas") : "Ninguna" },
            { etiqueta: "Hasta 12 meses después de salir", valor: p.ventasEnPlazo ? `${plural(p.ventasEnPlazo, "venta", "ventas")} por ${solesCompacto(p.montoEnPlazo)}` : "Ninguna" },
            { etiqueta: "Más de 12 meses después", valor: p.ventasDespues ? plural(p.ventasDespues, "venta", "ventas") : null },
            { etiqueta: "Primera y última venta", valor: p.primera && p.ultima ? `${fechaConAnio(p.primera)} a ${fechaConAnio(p.ultima)}` : null },
          ])}
        />
        <QueRevisar
          pasos={[
            "Es una señal en observación: dice que una autoridad figuró en la empresa y que la empresa le vendió a su entidad. No dice que hubo una contratación indebida.",
            "El impedimento alcanza a la empresa en la que la autoridad tenga o haya tenido más del 30 % del capital dentro de los 12 meses anteriores a la convocatoria, y a la que integra o representa (literal i del numeral 11.1 del artículo 11 de la Ley 30225; tipo 3.A del párrafo 30.1 del artículo 30 de la Ley 32069).",
            "El RNP no publica el porcentaje: pide la partida registral de la empresa en la SUNARP para ver cuánto tenía y a quién transfirió su parte.",
            "El corte en que dejó de figurar es mensual: la salida real puede ser unas semanas antes. Compara la fecha de la transferencia con la de cada convocatoria u orden.",
            p.ventasDespues > 0 && p.ventasEnPlazo === 0
              ? "Las ventas son de más de 12 meses después de su salida: mira quién quedó como socio (un familiar mantiene el impedimento)."
              : "Mira quién quedó como socio tras su salida: si es su cónyuge, conviviente o un pariente hasta el segundo grado, el impedimento sigue.",
          ]}
        />
        <FuenteDato
          fuente="Jurado Nacional de Elecciones (autoridades), Registro Nacional de Proveedores y órdenes y procesos de CONOSCE (OECE)"
          href={DATASET_AUTORIDADES_JNE}
          enlaces={[
            { texto: "Ficha de la empresa en el RNP (OECE)", href: fichaRnp(p.empresaRuc) },
            { texto: "Conformación jurídica de proveedores (datos abiertos)", href: DATASET_SOCIOS_RNP },
            { texto: "Órdenes y procesos en CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("autoridad", p.clave) },
          esRuc20(p.empresaRuc) && esRuc20(p.entidadRuc) && { texto: "Lo que la entidad le compró a esta empresa", href: `/entidad/${p.entidadRuc}?seccion=contratos&ccon=${p.empresaRuc}` },
        ]}
      />
    ),
  };
}

export function detalleCompraFamilia(p: PatronCompraFamilia): Detalle {
  const ent = entidad(p.entidad);
  const quien = p.persona ?? "Una persona con cargo público";
  const anios = aniosDeLasOrdenes(p);
  const enElPuesto = periodoDelPuesto(p);
  const fechas = fechasEnElPuesto(p);
  const fuera = ordenesFueraDelPuesto(p);
  const conConteo = p.ordenesEnPuesto != null;
  const conEmpresa = p.via === "empresa";
  const laEmpresa = p.empresa ? tituloNatural(p.empresa) : "una empresa";
  const ficha = p.codigo ? `/app/personas/cargo/${p.codigo}?seccion=revision` : null;
  return {
    // El nombre de la persona nunca va al título del panel.
    titulo: conEmpresa ? "Trabaja en compras y la empresa de un familiar le vende" : "Trabaja en compras y un familiar recibe órdenes",
    etiqueta: "Ver el detalle de este caso de compras y familia",
    descripcion: <span className="line-clamp-2">{ent}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.severidad === "alta" ? "alta" : p.severidad === "media" ? "media" : "neutro"}>
          {ficha ? (
            <Link href={ficha} prefetch={false} className={ENLACE}>{quien}</Link>
          ) : (
            <b>{quien}</b>
          )}{" "}
          declara el puesto de <b>{tituloNatural(p.cargo).toLowerCase()}</b> en{" "}
          {esRuc20(p.entidadRuc) ? (
            <Link href={`/entidad/${p.entidadRuc}`} prefetch={false} className={ENLACE}>{ent}</Link>
          ) : (
            <b>{ent}</b>
          )}
          {enElPuesto ? `, ${enElPuesto}` : ""}. Un familiar que declaró ({p.parentesco.toLowerCase()}){" "}
          {conEmpresa ? (
            <>
              figura como {papelEnLaEmpresa(p)} de{" "}
              {esRuc20(p.empresaRuc) ? (
                <Link href={`/empresa/${p.empresaRuc}`} prefetch={false} className={ENLACE}>{laEmpresa}</Link>
              ) : (
                <b>{laEmpresa}</b>
              )}
              , que {loQueRecibio(p)}.
            </>
          ) : (
            `${loQueRecibio(p)}.`
          )}{" "}
          <b>{ordenesEnElPuesto(p)}</b>
          {fuera ? ` ${fuera}` : ""}
        </EnUnaFrase>
        <DatosClave
          items={conValor([
            { etiqueta: "Puesto declarado", valor: tituloNatural(p.cargo) },
            { etiqueta: "En el puesto", valor: enElPuesto ? enElPuesto.charAt(0).toUpperCase() + enElPuesto.slice(1) : "No declaró desde cuándo" },
            { etiqueta: "Parentesco del familiar", valor: p.parentesco },
            { etiqueta: "Cómo cobra el familiar", valor: conEmpresa ? `Con ${laEmpresa}, de la que es ${papelEnLaEmpresa(p)}` : "A su nombre, con órdenes de servicio" },
            conEmpresa && p.parienteDesde ? { etiqueta: "El familiar figura en la empresa desde", valor: fechaConAnio(p.parienteDesde) } : null,
            conConteo
              ? {
                  etiqueta: "Órdenes con la persona en el puesto",
                  valor: p.ordenesEnPuesto ? `${numero(p.ordenesEnPuesto)} por ${solesCompacto(p.montoEnPuesto ?? 0)}` : "Ninguna",
                  mono: !!p.ordenesEnPuesto,
                }
              : null,
            conEmpresa && p.procesosEnPuesto
              ? { etiqueta: "Procesos ganados con la persona en el puesto", valor: `${numero(p.procesosEnPuesto)} por ${solesCompacto(p.montoProcesosEnPuesto ?? 0)}`, mono: true }
              : null,
            fechas ? { etiqueta: "Fechas de esas ventas", valor: fechas.charAt(0).toUpperCase() + fechas.slice(1) } : null,
            conConteo ? { etiqueta: "Antes de que asumiera", valor: p.ordenesAntes ? plural(p.ordenesAntes, "orden", "órdenes") : "Ninguna orden de esa entidad" } : null,
            conConteo && p.ordenesLuego
              ? { etiqueta: p.cargoHasta ? "Después de su cese" : "Después de su última declaración", valor: plural(p.ordenesLuego, "orden", "órdenes") }
              : null,
            {
              etiqueta: conEmpresa ? "Órdenes a la empresa en total" : "Órdenes al familiar en total",
              valor: p.ordenes ? `${numero(p.ordenes)} por ${solesCompacto(p.monto)}${anios ? `, ${anios}` : ""}` : "Ninguna: sólo procesos de selección",
            },
          ])}
        />
        {/* La evidencia: cada orden y cada proceso frente al puesto, con su enlace, y la empresa del familiar. */}
        {p.clave ? <VentasCompraFamilia clave={p.clave} entidadRuc={p.entidadRuc} /> : null}
        <QueRevisar
          pasos={[
            "Es una señal en observación: el puesto y el familiar salen de la declaración jurada de la propia persona, y las órdenes, del registro de la entidad. No dice que intervino en esas compras.",
            "Pide el expediente de cada orden: quién firmó el requerimiento, quién cotizó y quién la aprobó. Si su oficina aparece, hay un impedimento que mirar.",
            reglaCompraFamilia(p),
            conEmpresa ? "Pide la partida registral de la empresa: el RNP dice que el familiar figura en ella, no cuánto tiene ni desde cuándo exactamente." : null,
            p.empezoDespues
              ? `${conEmpresa ? "La empresa no le había vendido a" : "El familiar no tenía órdenes de"} esta entidad antes de que la persona asumiera: mira si le vendía a otras entidades o sólo empezó aquí.`
              : p.ordenesEnPuesto
                ? `${conEmpresa ? "La empresa ya le vendía a" : "El familiar ya recibía órdenes de"} la entidad antes: compara cuánto recibía antes y cuánto con la persona en el puesto.`
                : "Ninguna orden cae dentro del puesto declarado: confirma las fechas del puesto con la entidad antes de sacar una conclusión.",
            !p.cargoHasta && p.ordenesLuego
              ? "No declaró su cese: las órdenes posteriores a su última declaración no se cuentan dentro del puesto. Pregunta a la entidad hasta cuándo estuvo."
              : null,
          ]}
        />
        <FuenteDato
          fuente="Contraloría (declaraciones juradas de intereses), Registro Nacional de Proveedores y órdenes de CONOSCE (OECE)"
          href={DATASET_DJI}
          enlaces={[
            { texto: "Declaraciones juradas de esta entidad (Contraloría)", href: djiEntidad(p.entidadRuc) },
            ...(conEmpresa ? [{ texto: "Ficha de la empresa en el RNP (OECE)", href: fichaRnp(p.empresaRuc) }] : []),
            { texto: "Órdenes y procesos en CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          // Dos, no cinco: en el celular el pie le quitaba casi la mitad de la hoja al contenido, y la entidad, la empresa y
          // la persona ya van enlazadas en el texto. Primero la ficha del caso (su historia entera, 2026-11-18).
          p.clave ? { texto: "Abrir la ficha del caso", href: rutaCaso("compras", p.clave) } : false,
          ficha ? { texto: "Ficha de la persona", href: ficha } : false,
        ]}
      />
    ),
  };
}

export function detalleDoble(p: PatronDoble): Detalle {
  const ent = entidad(p.entidad);
  const otra = entidad(p.otra);
  const quien = p.persona ?? "Una persona de la planilla";
  const entre = mesCorto(p.desde) && mesCorto(p.hasta) ? `entre ${mesCorto(p.desde)} y ${mesCorto(p.hasta)}` : null;
  return {
    // El nombre de la persona nunca va al título del panel (va a `title` y `aria-label`).
    titulo: "Dos ingresos del Estado",
    etiqueta: "Ver el detalle de este caso de dos ingresos del Estado",
    descripcion: <span className="line-clamp-2">{ent}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.severidad === "media" ? "media" : "neutro"}>
          <b>{quien}</b> figura en la planilla de <b>{ent}</b>
          {p.cargo ? <> como {tituloNatural(p.cargo).toLowerCase()}</> : ""} y, en <b>{plural(p.meses, "mes", "meses")}</b> de esos{entre ? ` (${entre})` : ""},{" "}
          <b>{otra}</b> le emitió {plural(p.ordenes, "orden de servicio", "órdenes de servicio")} por <b>{solesCompacto(p.monto)}</b>.
          {p.docente ? " Hay docencia de por medio: es la excepción que la ley permite." : ""}
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "Sueldo al mes en su planilla", valor: p.sueldo ? solesCompacto(p.sueldo) : null, mono: true },
            { etiqueta: "Órdenes de servicio de la otra entidad", valor: `${numero(p.ordenes)} por ${solesCompacto(p.monto)}`, mono: true },
            { etiqueta: "Meses que coinciden", valor: numero(p.meses), mono: true },
            { etiqueta: "Entre", valor: entre ? entre.replace(/^entre /, "") : null },
            { etiqueta: "Docencia", valor: p.docente ? "Sí: la excepción legal" : "No" },
          ]}
        />
        <QueRevisar
          pasos={[
            "Confirma que es la misma persona: el empate es por nombre completo (la planilla no trae documento). Su ficha reúne sus dos registros.",
            "Mira si las órdenes son por un servicio personal (una retribución) y no por la venta de un bien o un alquiler.",
            p.docente
              ? "Con docencia la ley permite el segundo ingreso: comprueba que una de las dos labores sea de enseñanza y que los horarios no se crucen."
              : "Pide a las dos entidades la declaración jurada de no percibir otro ingreso del Estado y los horarios de las dos labores.",
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          p.codigo ? { texto: "Ficha de la persona", href: `/app/personas/cargo/${p.codigo}?seccion=revision` } : false,
          esRuc20(p.entidadRuc) && { texto: "Entidad de su planilla", href: `/entidad/${p.entidadRuc}?seccion=planilla` },
          esRuc20(p.otraRuc) && { texto: "Entidad de las órdenes", href: `/entidad/${p.otraRuc}` },
        ]}
      />
    ),
  };
}

// ─── Empresa recién creada con órdenes directas ──────────────────────────────────

export function detalleRecien(p: PatronRecien): Detalle {
  const e = empresa(p.nombre);
  const ent = entidad(p.entidad);
  const vive = p.parteEntidad != null && p.parteEntidad >= 0.8;
  return {
    titulo: e,
    etiqueta: "Ver el detalle de esta empresa recién creada",
    descripcion: <span className="line-clamp-2">{ent}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.severidad === "alta" ? "alta" : "media"}>
          <b>{e}</b> se inscribió en la SUNAT el {fechaConAnio(p.fechaAlta)} y <b>{plural(p.dias, "día", "días")}</b> después <b>{ent}</b> le emitió su primera
          orden directa. En su primer año recibió <b>{plural(p.ordenesPrimerAnio, "orden", "órdenes")}</b> por <b>{solesCompacto(p.montoPrimerAnio)}</b>, sin
          proceso de selección.{vive ? " Casi todo lo que le vendió al Estado por órdenes es a esta entidad." : ""}
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "Alta en la SUNAT", valor: fechaConAnio(p.fechaAlta) },
            { etiqueta: "Primera orden directa", valor: `${fechaConAnio(p.primeraOrden)} (${plural(p.dias, "día", "días")} después)` },
            { etiqueta: "En su primer año", valor: `${numero(p.ordenesPrimerAnio)} por ${solesCompacto(p.montoPrimerAnio)}`, mono: true },
            { etiqueta: "Órdenes directas de la entidad, todas", valor: `${numero(p.ordenes)} por ${solesCompacto(p.monto)}`, mono: true },
            { etiqueta: "De sus ventas por órdenes, de esta entidad", valor: p.parteEntidad != null ? porcentaje(p.parteEntidad * 100) : null, mono: true },
          ]}
        />
        <QueRevisar
          pasos={[
            "Mira quién la creó: sus socios y representantes (en su ficha) y si son parientes o exfuncionarios de la entidad, o socios de otro proveedor suyo.",
            "Pide el requerimiento y las cotizaciones de sus primeras órdenes: quién la invitó a cotizar si tenía días de existir y ninguna experiencia.",
            "Comprueba si es un negocio que ya existía con otro RUC (una persona natural que pasó a ser empresa): eso lo explicaría.",
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("recien", p.clave) },
          esRuc20(p.ruc) && { texto: "Ficha de la empresa", href: `/empresa/${p.ruc}` },
        ]}
      />
    ),
  };
}

// ─── Gana mientras otra empresa del mismo socio está inhabilitada ────────────────

export function detalleInhabilitada(p: PatronInhabilitada): Detalle {
  const e = empresa(p.empresa);
  const s = empresa(p.sancionada);
  const sancion = p.sancion === "definitivo" ? "definitiva" : "temporal";
  return {
    titulo: paraTitulo(p.ruc, p.empresa, "Gana durante la inhabilitación de otra empresa"),
    etiqueta: "Ver el detalle de esta empresa que gana mientras otra del mismo socio está inhabilitada",
    descripcion: <span className="line-clamp-2">Gana mientras {s} está inhabilitada.</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.graves > 0 ? "alta" : "media"}>
          <b>{e}</b> ganó <b>{plural(p.contratos, "contrato", "contratos")}</b>
          {p.monto != null ? ` por ${solesCompacto(p.monto)}` : ""} en {plural(p.entidades, "entidad", "entidades")} mientras <b>{s}</b>, de su mismo socio, tenía una
          inhabilitación {sancion}
          {p.sancionDesde ? ` desde el ${fechaConAnio(p.sancionDesde)}` : ""}
          {p.sancionHasta ? ` hasta el ${fechaConAnio(p.sancionHasta)}` : ""}.
          {p.hechaParaSeguir && p.fundada ? ` La ganadora se fundó el ${fechaConAnio(p.fundada)}, cerca del inicio de la sanción.` : ""}
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "El socio en común", valor: p.socios?.[0]?.nombre ?? null },
            { etiqueta: "Contratos dentro de la sanción", valor: numero(p.contratos), mono: true },
            { etiqueta: "De ellos, graves", valor: p.graves > 0 ? numero(p.graves) : "Ninguno", mono: true },
            { etiqueta: "Sanción", valor: `Inhabilitación ${sancion}` },
            { etiqueta: "Entidades", valor: numero(p.entidades), mono: true },
          ]}
        />
        <Contratos ocids={p.ejemplos ?? []} total={p.contratos} que="dentro de la sanción" />
        <QueRevisar
          pasos={[
            "Confirma en el RNP el porcentaje del socio en las dos empresas: el impedimento rige con más de 30 % del capital.",
            "Mira si las dos empresas son del mismo rubro y si la ganadora empezó a vender lo que vendía la inhabilitada.",
            "Revisa la declaración jurada de no tener impedimentos que presentó en cada proceso.",
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("inhabilitadas", p.clave) },
          esRuc20(p.ruc) && { texto: "Ficha de la que gana", href: `/empresa/${p.ruc}` },
        ]}
      />
    ),
  };
}

// ─── Gana con un socio comprendido en un informe de control ──────────────────────

export function detalleControl(p: PatronControl): Detalle {
  const e = empresa(p.empresa);
  const resp = responsabilidad(p.responsabilidades);
  const informe = p.informeNumero ?? p.informeCodigo ?? "sin número";
  return {
    titulo: paraTitulo(p.ruc, p.empresa, "Gana con un socio en un informe de control"),
    etiqueta: "Ver el detalle de esta empresa con un socio en un informe de control",
    descripcion: <span className="line-clamp-2">Gana con un socio o representante comprendido en un informe de control anterior.</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.graves > 0 ? "alta" : "media"}>
          {p.socios?.[0]?.nombre ?? "Una persona"}, {(p.socios?.[0]?.rol ?? "socio").toLowerCase()} de <b>{e}</b>, figura en el informe de control <b>{informe}</b>
          {p.emision ? ` (${fechaConAnio(p.emision)})` : ""}
          {p.informeEntidad ? ` sobre ${entidad(p.informeEntidad)}` : ""}
          {resp ? `, con presunta responsabilidad ${resp}` : ""}. Después la empresa ganó <b>{plural(p.contratos, "proceso", "procesos")}</b>
          {p.monto != null ? ` por ${solesCompacto(p.monto)}` : ""} en {plural(p.entidades, "entidad", "entidades")}.
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "Informe de control", valor: p.ficha ? <a href={p.ficha} target="_blank" rel="noopener noreferrer" className={ENLACE}>{informe}</a> : informe, mono: true },
            { etiqueta: "Entidad del informe", valor: p.informeEntidad ? entidad(p.informeEntidad) : null },
            { etiqueta: "Presunta responsabilidad", valor: resp },
            { etiqueta: "Otros informes de la persona", valor: (p.informes ?? 1) > 1 ? numero((p.informes ?? 1) - 1) : "Ninguno", mono: true },
            { etiqueta: "Procesos ganados después", valor: numero(p.contratos), mono: true },
            { etiqueta: "De ellos, graves", valor: p.graves > 0 ? numero(p.graves) : "Ninguno", mono: true },
            { etiqueta: "El informe es de una entidad que le contrató", valor: p.mismaEntidad ? "Sí" : "No" },
          ]}
        />
        <Contratos ocids={p.ejemplos ?? []} total={p.contratos} que="ganados después del informe" />
        <QueRevisar
          pasos={[
            "Lee qué observó el informe y si se parece a lo que la empresa vende ahora.",
            "Si el informe es de la misma entidad que contrató, mira si esa persona intervino en la compra cuando era funcionaria.",
            "Revisa desde cuándo figura en la empresa: antes o después de salir de la entidad.",
          ]}
        />
        <p className="text-rotulo leading-relaxed text-mute">La responsabilidad es presunta: la Contraloría la señala y la deriva; no es una condena ni un impedimento para contratar.</p>
      </div>
    ),
    pie: <Pie enlaces={[!!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("control", p.clave) }, esRuc20(p.ruc) && { texto: "Ficha de la empresa", href: `/empresa/${p.ruc}` }]} />,
  };
}

// ─── Procesos que la Contraloría observó ─────────────────────────────────────────

export function detalleObservado(p: PatronObservado): Detalle {
  const e = empresa(p.empresa);
  const ent = entidad(p.entidad);
  const resp = responsabilidad(p.responsabilidades);
  const informe = p.informeNumero ?? p.informeCodigo ?? "sin número";
  return {
    titulo: paraTitulo(p.ruc, p.empresa, "Proveedor con procesos observados"),
    etiqueta: "Ver el detalle de este proveedor con procesos observados por la Contraloría",
    descripcion: <span className="line-clamp-2">En {ent}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.despues > 0 && p.graves > 0 ? "alta" : "media"}>
          La Contraloría observó <b>{plural(p.observados, "proceso", "procesos")}</b> que <b>{e}</b> ganó en <b>{ent}</b>; el primer informe es el {informe}
          {p.emision ? `, del ${fechaConAnio(p.emision)}` : ""}.{" "}
          {p.despues > 0 ? (
            <>
              Después de ese informe la entidad le adjudicó <b>{plural(p.despues, "proceso más", "procesos más")}</b>
              {p.montoDespues != null ? ` por ${solesCompacto(p.montoDespues)}` : ""}.
            </>
          ) : (
            "Después de ese informe la entidad no le adjudicó ningún otro proceso con su RUC."
          )}
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "Procesos observados", valor: numero(p.observados), mono: true },
            { etiqueta: "De ellos, graves", valor: p.graves > 0 ? numero(p.graves) : "Ninguno", mono: true },
            { etiqueta: "Observaciones que los nombran", valor: p.observaciones != null ? numero(p.observaciones) : null, mono: true },
            { etiqueta: "Perjuicio que cuantifican", valor: p.perjuicio != null && p.perjuicio > 0 ? solesCompacto(p.perjuicio) : "No lo cuantifican", mono: true },
            { etiqueta: "Primer informe", valor: p.ficha ? <a href={p.ficha} target="_blank" rel="noopener noreferrer" className={ENLACE}>{informe}</a> : informe, mono: true },
            { etiqueta: "Presunta responsabilidad", valor: resp ? `${resp}, de funcionarios y servidores` : null },
            { etiqueta: "Adjudicado después por la misma entidad", valor: p.despues > 0 ? `${plural(p.despues, "proceso", "procesos")}${p.montoDespues != null ? `, ${solesCompacto(p.montoDespues)}` : ""}` : "Nada", mono: true },
            ...(p.ultimaDespues ? [{ etiqueta: "Última buena pro posterior", valor: fechaConAnio(p.ultimaDespues) }] : []),
          ]}
        />
        <Contratos ocids={p.ejemplos ?? []} total={p.observados} que="observados" />
        <QueRevisar
          pasos={[
            "Abre un contrato observado y, desde su bandera, el informe: lee la observación completa.",
            "Mira los contratos posteriores: si las bases, la evaluación o la conformidad repiten lo que el informe encontró.",
            "Revisa en qué quedó el informe: si la entidad implementó sus recomendaciones.",
          ]}
        />
        <p className="text-rotulo leading-relaxed text-mute">El informe señala a funcionarios, con responsabilidad presunta: no sanciona al proveedor ni le impide contratar.</p>
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("observados", p.clave) },
          esRuc20(p.ruc) && { texto: "Ficha de la empresa", href: `/empresa/${p.ruc}` },
        ]}
      />
    ),
  };
}

// ─── El mismo servicio, más caro al renovarlo ────────────────────────────────────

export function detalleRenovacion(p: PatronRenovacion): Detalle {
  const ent = entidad(p.entidad);
  const objeto = p.objeto ? tituloNatural(p.objeto) : "Servicio sin descripción";
  return {
    titulo: objeto,
    etiqueta: "Ver el detalle de esta renovación más cara",
    descripcion: <span className="line-clamp-2">{ent}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase tono={p.diffPct >= 100 ? "alta" : "media"}>
          <b>{ent}</b> volvió a contratar este servicio pagando <b>{p.costoMensual != null ? solesCompacto(p.costoMensual) : "más"} al mes</b>; en el contrato anterior
          pagaba {p.costoMensualAnterior != null ? solesCompacto(p.costoMensualAnterior) : "menos"}: <b>{numero(Math.round(p.diffPct))} % más</b>
          {p.mismoProveedor === true ? ", con el mismo proveedor" : p.mismoProveedor === false ? ", con otro proveedor" : ""}.
        </EnUnaFrase>
        <DatosClave
          items={[
            { etiqueta: "Contrato de ahora", valor: <Link href={rutaContrato(p.ocid)} prefetch={false} className={ENLACE}>{codigoDeOcid(p.ocid)}</Link>, mono: true },
            { etiqueta: "Fecha y monto", valor: `${p.fecha ? fechaConAnio(p.fecha) : "Sin fecha"}, ${p.monto != null ? solesCompacto(p.monto) : "sin monto"}${p.plazoDias ? `, ${numero(p.plazoDias)} días` : ""}` },
            { etiqueta: "Contrato anterior", valor: <Link href={rutaContrato(p.ocidAnterior)} prefetch={false} className={ENLACE}>{codigoDeOcid(p.ocidAnterior)}</Link>, mono: true },
            { etiqueta: "Fecha y monto de antes", valor: `${p.fechaAnterior ? fechaConAnio(p.fechaAnterior) : "Sin fecha"}, ${p.montoAnterior != null ? solesCompacto(p.montoAnterior) : "sin monto"}${p.plazoAnterior ? `, ${numero(p.plazoAnterior)} días` : ""}` },
            { etiqueta: "De más en todo el plazo", valor: p.exceso != null ? solesCompacto(p.exceso) : null, mono: true },
            { etiqueta: "Parecido de los dos objetos", valor: porcentaje(p.similitud * 100), mono: true },
            { etiqueta: "Proveedor de ahora", valor: p.proveedor ? empresa(p.proveedor) : null },
          ]}
        />
        <QueRevisar
          pasos={[
            "Compara los términos de referencia de los dos contratos: si cambió el alcance (más personal, más sedes, más horas).",
            "Mira cuántos postores hubo en cada uno y si el valor referencial se armó con una sola cotización.",
            "Compara con lo que pagan otras entidades por el mismo servicio (precios de referencia).",
          ]}
        />
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          !!p.clave && { texto: "Abrir la ficha del caso", href: rutaCaso("renovaciones", p.clave) },
          { texto: "Abrir el contrato de ahora", href: rutaContrato(p.ocid) },
        ]}
      />
    ),
  };
}

// ─── Indicadores en observación (migración 329) ──────────────────────────────────

const minutosEntre = (m: number | null) => (m == null ? "pocos minutos" : m < 1 ? "menos de un minuto" : plural(Math.round(m), "minuto", "minutos"));
const recibio = (p: PatronObservacion) =>
  p.cargo || p.area ? `quien tiene el cargo de ${(p.cargo ?? "funcionario").toLowerCase()}${p.area ? ` en ${p.area.toLowerCase()}` : ""}` : "un funcionario que decide las compras";

/** Papel en la empresa según el RNP (comite_socio_proveedor, migración 407): el de más peso, o todos. */
function papelEmpresa(roles: string[] | null | undefined, todos = false): string {
  const nombres: Record<string, string> = {
    REPRESENTANTE_LEGAL: "representante legal", ORGANO_ADMINISTRACION: "gerente o directivo", SOCIO_ACCIONISTA_TITULAR: "socio",
  };
  const r = (roles ?? []).filter((x) => x in nombres);
  if (todos) return r.length ? r.map((x) => nombres[x]).join(", ").replace(/^./, (c) => c.toUpperCase()) : "Socio";
  return nombres[r.find((x) => x === "REPRESENTANTE_LEGAL") ?? r.find((x) => x === "ORGANO_ADMINISTRACION") ?? "SOCIO_ACCIONISTA_TITULAR"];
}

/** Las marcas de competencia de un proceso (comite_competencia_restringida, migración 415), en palabras. */
const MARCAS_COMPETENCIA: Record<string, string> = { unico_postor: "un solo postor", acta_solo_queda_el_ganador: "el acta deja sólo al ganador", acta_descalificados_por_formalidad: "descalificaciones por formalidad", acta_oferta_mas_baja_descartada: "la oferta más baja descartada", solo_admitido_el_ganador: "sólo se admitió al ganador" };

/** Cuán firme es que sea la misma persona (el emparejamiento es por nombre, sin DNI del acta). */
const IDENTIDAD_COMITE: Record<string, string> = {
  documento: "El DNI que figura en el registro aparece entre las personas con órdenes de la entidad: es la misma persona.",
  nombre_completo: "Coincide su nombre completo, de cuatro palabras o más.",
  nombre: "Coincide un nombre de tres palabras: puede ser un homónimo.",
};

export function detalleObservacion(p: PatronObservacion): Detalle {
  const emp = empresa(p.empresa);
  const ent = entidad(p.entidad);
  const contrato = { etiqueta: "Contrato", valor: <Link href={rutaContrato(p.ocid)} prefetch={false} className={ENLACE}>{p.codigo ?? codigoDeOcid(p.ocid)}</Link>, mono: true } satisfies DatoClave;
  const comunes: DatoClave[] = [
    contrato,
    { etiqueta: "Objeto", valor: p.objeto ? tituloNatural(p.objeto) : null },
    { etiqueta: "Entidad", valor: ent },
    { etiqueta: "Buena pro", valor: p.buenaPro ? fechaConAnio(p.buenaPro) : null },
  ];
  const frase =
    p.tipo === "reunion_en_evaluacion" ? (
      <>
        Gente de <b>{emp}</b> visitó a {recibio(p)} de <b>{ent}</b> <b>después de presentar su oferta</b> y antes de la buena pro.{" "}
        {p.yaProveedor ? "La empresa ya le vendía a la entidad: la visita puede ser por lo que ya tenía contratado." : "La empresa no le había vendido a la entidad ese año ni el anterior."}
      </>
    ) : p.tipo === "firma_en_plazo_de_apelacion" ? (
      <>
        <b>{ent}</b> firmó el contrato con <b>{emp}</b>{" "}
        <b>{p.diasHabiles === 0 ? "el mismo día de la buena pro" : `${plural(p.diasHabiles ?? 1, "día hábil", "días hábiles")} después de la buena pro`}</b>, cuando los
        otros postores del ítem todavía podían apelarla.
      </>
    ) : p.tipo === "comite_mismo_ganador" ? (
      <>
        Una misma persona del comité de selección de <b>{ent}</b>
        {p.rolComite ? ` (${p.rolComite.toLowerCase()})` : ""} estuvo en <b>{plural(p.veces ?? 3, "proceso", "procesos")}</b> que ganó{" "}
        <b>{emp}</b>
        {p.parteSin != null ? <>; sin esa persona, la empresa gana el <b>{Math.round(p.parteSin * 100)} %</b> de los procesos de la entidad</> : ""}.
      </>
    ) : p.tipo === "comite_competencia_restringida" ? (
      <>
        Una misma persona del comité de selección de <b>{ent}</b>
        {p.rolComite ? ` (${p.rolComite.toLowerCase()})` : ""} estuvo en {plural(p.procesosPersona ?? 4, "proceso", "procesos")} y en{" "}
        <b>{p.restringidos ?? "muchos"}</b> la competencia quedó restringida
        {p.tasaEntidad != null ? <>; en los demás procesos de la entidad pasa en el <b>{Math.round(p.tasaEntidad * 100)} %</b></> : ""}. Este, que ganó{" "}
        <b>{emp}</b>, es uno de ellos.
      </>
    ) : p.tipo === "comite_socio_proveedor" ? (
      <>
        Una persona que integró el comité de selección de <b>{ent}</b>
        {p.rolComite ? ` (${p.rolComite.toLowerCase()})` : ""}
        {p.enSuComite ? <b> en este mismo proceso</b> : null} figura en el Registro Nacional de Proveedores como{" "}
        <b>{papelEmpresa(p.rolEmpresa)}</b> de <b>{emp}</b>, {p.enSuComite ? "que lo ganó" : "que le gana contratos a esa entidad"}.{" "}
        {IDENTIDAD_COMITE[p.identidad ?? ""] ?? ""}
      </>
    ) : p.tipo === "solo_admitido_el_ganador" ? (
      <>
        En este ítem de <b>{ent}</b> se presentaron <b>{plural(p.ofertas ?? 4, "oferta", "ofertas")}</b> y el comité{" "}
        <b>sólo admitió la de {emp}</b>, que ganó: las demás quedaron fuera antes de comparar precios.
      </>
    ) : p.tipo === "trabajo_en_el_ganador" ? (
      <>
        Un funcionario de <b>{ent}</b>, con el cargo de {(p.cargo ?? "funcionario").toLowerCase()}, declaró en su Declaración Jurada de Intereses
        haber trabajado en <b>{emp}</b>, y la entidad le dio la buena pro mientras él ocupaba ese cargo.
      </>
    ) : p.tipo === "visita_personal_decisor" ? (
      <>
        Una misma persona de <b>{emp}</b> visitó en <b>{plural(p.dias ?? 3, "día distinto", "días distintos")}</b>, declarando «visita personal», a{" "}
        {recibio(p)} de <b>{ent}</b>, en el año anterior a la buena pro.
      </>
    ) : (
      <>
        <b>{emp}</b> y <b>{empresa(p.otro)}</b> compitieron en este proceso, comparten un socio o representante y registraron sus ofertas con{" "}
        <b>{minutosEntre(p.minutos)} de diferencia</b>.
      </>
    );
  const propios: DatoClave[] =
    p.tipo === "reunion_en_evaluacion"
      ? [
          { etiqueta: "Visitas en la evaluación", valor: p.visitas != null ? numero(p.visitas) : null, mono: true },
          { etiqueta: "Presentó su oferta", valor: p.oferta ? fechaConAnio(p.oferta) : null },
          { etiqueta: "Duró la evaluación", valor: p.diasEvaluacion != null ? plural(p.diasEvaluacion, "día", "días") : null },
          { etiqueta: "¿Ya le vendía a la entidad?", valor: p.yaProveedor ? "Sí" : "No, ni ese año ni el anterior" },
        ]
      : p.tipo === "firma_en_plazo_de_apelacion"
        ? [
            { etiqueta: "Firma del contrato", valor: p.firma ? fechaConAnio(p.firma) : null },
            { etiqueta: "Días hábiles tras la buena pro", valor: p.diasHabiles != null ? numero(p.diasHabiles) : null, mono: true },
            { etiqueta: "Ofertas en el ítem", valor: p.ofertas != null ? numero(p.ofertas) : null, mono: true },
            { etiqueta: "Consentimiento en CONOSCE", valor: p.consentimiento ? fechaConAnio(p.consentimiento) : null },
            { etiqueta: "Norma", valor: p.norma ?? null },
          ]
      : p.tipo === "comite_mismo_ganador"
        ? [
            { etiqueta: "Procesos juntos", valor: p.veces != null ? numero(p.veces) : null, mono: true },
            { etiqueta: "Procesos de esa persona en la entidad", valor: p.procesosPersona != null ? numero(p.procesosPersona) : null, mono: true },
            { etiqueta: "Gana con esa persona", valor: p.parteCon != null ? `${Math.round(p.parteCon * 100)} %` : null, mono: true },
            { etiqueta: "Gana sin esa persona", valor: p.parteSin != null ? `${Math.round(p.parteSin * 100)} %` : "Sin procesos para comparar" },
            { etiqueta: "Papel en el comité", valor: p.rolComite ? tituloNatural(p.rolComite) : null },
            { etiqueta: "De dónde sale", valor: "Actas leídas por los agentes de Vigía, con cada nombre comprobado en el documento" },
          ]
      : p.tipo === "comite_competencia_restringida"
        ? [
            { etiqueta: "Papel en el comité", valor: p.rolComite ? tituloNatural(p.rolComite) : null },
            { etiqueta: "Sus procesos en la entidad", valor: p.procesosPersona != null ? numero(p.procesosPersona) : null, mono: true },
            { etiqueta: "Con la competencia restringida", valor: p.restringidos != null ? numero(p.restringidos) : null, mono: true },
            { etiqueta: "En el resto de la entidad", valor: p.tasaEntidad != null ? `${Math.round(p.tasaEntidad * 100)} %` : null, mono: true },
            { etiqueta: "Probabilidad de que sea azar", valor: p.pValor != null ? (p.pValor < 0.001 ? "Menos de 1 en 1 000" : `1 en ${numero(Math.round(1 / p.pValor))}`) : null },
            { etiqueta: "En este proceso", valor: p.marcas?.length ? p.marcas.map((x) => MARCAS_COMPETENCIA[x] ?? x).join(", ") : null },
            { etiqueta: "De dónde sale", valor: "Actas leídas por Vigía y sus agentes (nombres comprobados) y las banderas de competencia de cada proceso" },
          ]
      : p.tipo === "comite_socio_proveedor"
        ? [
            { etiqueta: "Papel en el comité", valor: p.rolComite ? tituloNatural(p.rolComite) : null },
            { etiqueta: "Papel en la empresa", valor: papelEmpresa(p.rolEmpresa, true) },
            { etiqueta: "En la empresa desde", valor: p.socioDesde ? fechaConAnio(p.socioDesde) : null },
            { etiqueta: "¿Regía al ganar?", valor: p.socioAlGanar == null ? null : p.socioAlGanar ? "Sí" : "No: el vínculo no regía ese día" },
            { etiqueta: "¿Estuvo en el comité de este proceso?", valor: p.enSuComite ? "Sí" : "No: integró comités de otros procesos" },
            {
              etiqueta: "Sus procesos en el comité",
              valor: p.comiteDesde
                ? `${p.procesosPersona != null ? `${plural(p.procesosPersona, "proceso", "procesos")}, ` : ""}${p.comiteHasta && p.comiteHasta !== p.comiteDesde ? `de ${fechaConAnio(p.comiteDesde)} a ${fechaConAnio(p.comiteHasta)}` : fechaConAnio(p.comiteDesde)}`
                : null,
            },
            {
              etiqueta: "La buena pro, frente a eso",
              valor: ({ a_la_vez: "Mientras integraba comités", cerca: "A un año o menos", lejos: "A más de un año: pesa poco", sin_fechas: "Sin fechas" } as Record<string, string>)[p.cuando ?? ""] ?? null,
            },
            { etiqueta: "De dónde sale", valor: "Actas leídas por los agentes de Vigía (nombre comprobado en el documento) y Registro Nacional de Proveedores" },
          ]
      : p.tipo === "solo_admitido_el_ganador"
        ? [
            { etiqueta: "Ofertas en el ítem", valor: p.ofertas != null ? numero(p.ofertas) : null, mono: true },
            { etiqueta: "No admitidas", valor: p.noAdmitidas != null ? numero(p.noAdmitidas) : null, mono: true },
            {
              etiqueta: "Empresas que quedaron fuera",
              valor: p.fueraEmpresas?.length ? (
                <>
                  {p.fueraEmpresas.map((o, i) => (
                    <span key={o.ruc}>
                      {i > 0 && ", "}
                      <Link href={`/empresa/${o.ruc}`} prefetch={false} className={ENLACE}>
                        {empresa(o.nombre)}
                      </Link>
                    </span>
                  ))}
                </>
              ) : null,
            },
            { etiqueta: "De dónde sale", valor: "Reporte de evaluación que genera el SEACE" },
          ]
      : p.tipo === "trabajo_en_el_ganador"
        ? [
            { etiqueta: "Cargo del funcionario", valor: p.cargo ? tituloNatural(p.cargo) : null },
            { etiqueta: "El empleo en la empresa", valor: p.empleoDesde ? `${fechaConAnio(p.empleoDesde)}${p.empleoHasta ? ` a ${fechaConAnio(p.empleoHasta)}` : ", sin fecha de salida"}` : null },
            {
              etiqueta: "Frente a la buena pro",
              valor: ({ a_la_vez: "Seguía vigente", despues: "Empezó después", hasta_2_anios: "Lo dejó menos de dos años antes", antes: "Lo dejó más de dos años antes", sin_fechas: "Sin fechas" } as Record<string, string>)[p.cuando ?? ""] ?? null,
            },
          ]
      : p.tipo === "visita_personal_decisor"
        ? [
            { etiqueta: "Días distintos", valor: p.dias != null ? numero(p.dias) : null, mono: true },
            { etiqueta: "Meses distintos", valor: p.meses != null ? numero(p.meses) : null, mono: true },
            { etiqueta: "Visitas en total", valor: p.visitas != null ? numero(p.visitas) : null, mono: true },
            { etiqueta: "Motivo declarado", valor: "Visita personal" },
            { etiqueta: "Última visita", valor: p.fecha ? fechaConAnio(p.fecha) : null },
          ]
        : [
            { etiqueta: "Entre las dos ofertas", valor: minutosEntre(p.minutos), mono: true },
            { etiqueta: "Se registraron", valor: p.horaGanador && p.horaOtro ? `A las ${p.horaGanador} y a las ${p.horaOtro}` : null },
            { etiqueta: "El otro postor", valor: p.otro ? empresa(p.otro) : null },
            { etiqueta: "Día de las ofertas", valor: p.fecha ? fechaConAnio(p.fecha) : null },
          ];
  const pasos =
    p.tipo === "reunion_en_evaluacion"
      ? [
          "Abre el contrato y mira en «Antecedentes» cada visita: su día, su hora y el cargo de quien la recibió.",
          "Revisa en el acta quiénes integraron el comité de selección y si quien recibió la visita intervino.",
          "Mira cómo se calificó a los demás postores: si alguno quedó fuera por una formalidad.",
          "Descarta la explicación sencilla: una subsanación, la firma de otro contrato o un trámite pendiente.",
        ]
      : p.tipo === "firma_en_plazo_de_apelacion"
        ? [
            "Abre el contrato y compara la fecha de firma con la de la buena pro en el cronograma y en el documento del contrato.",
            "Revisa en el SEACE si algún postor apeló la buena pro y qué resolvió la entidad o el Tribunal.",
            "Mira cuántas ofertas hubo y si las demás quedaron descalificadas: con una sola válida el riesgo de apelación es menor.",
            "Descarta la explicación sencilla: una fecha mal registrada en CONOSCE o un contrato de otro ítem.",
          ]
      : p.tipo === "comite_mismo_ganador"
        ? [
            "Abre los contratos de la misma empresa en la entidad y mira quién integró cada comité (en el acta).",
            "Compara cómo se calificó a los demás postores en los procesos con esa persona y en los procesos sin ella.",
            "Busca si esa persona declaró algún vínculo con la empresa en su Declaración Jurada de Intereses.",
            "Descarta la explicación sencilla: el único proveedor del rubro o un área que compra siempre lo mismo.",
          ]
      : p.tipo === "comite_competencia_restringida"
        ? [
            "Abre los procesos de esa persona del comité y lee en cada acta por qué quedaron fuera los demás postores.",
            "Compara los requisitos de las bases entre sus procesos y los de otros comités de la misma entidad.",
            "Mira si los postores descalificados apelaron y qué resolvió el Tribunal.",
            "Descarta la explicación sencilla: un área que compra algo muy específico, donde casi nadie cumple.",
          ]
      : p.tipo === "comite_socio_proveedor"
        ? [
            "Confirma que sea la misma persona: su cargo en la entidad, su Declaración Jurada de Intereses y la ficha de la empresa en el RNP.",
            "Abre el proceso en el que integró el comité y mira si se apartó o declaró el vínculo.",
            "Revisa los contratos que la empresa le ganó a la entidad: fechas, montos y quién los evaluó.",
            "Descarta la explicación sencilla: un homónimo, o un vínculo que terminó antes de que entrara a la entidad.",
          ]
      : p.tipo === "solo_admitido_el_ganador"
        ? [
            "Abre el contrato y lee en el reporte de evaluación el motivo de cada oferta no admitida.",
            "Busca ese requisito en las bases: si es razonable para lo que se compra o parece hecho a la medida del ganador.",
            "Mira en el pliego de consultas si algún participante lo observó y qué respondió la entidad.",
            "Descarta la explicación sencilla: postores que no traían documentos que cualquiera podía conseguir.",
          ]
      : p.tipo === "trabajo_en_el_ganador"
        ? [
            "Abre el contrato y busca en el expediente si el funcionario firmó el requerimiento, integró el comité o dio la conformidad.",
            "Revisa su Declaración Jurada de Intereses en la Contraloría: el empleo, sus fechas y si declaró el vínculo.",
            "Mira cuánto le adjudicó la entidad a la empresa antes y después de que él llegara al cargo.",
            "Descarta la explicación sencilla: un empleo de hace años, en otra área, sin relación con lo que se compró.",
          ]
      : p.tipo === "visita_personal_decisor"
        ? [
            "Abre el contrato y mira las fechas de las visitas frente a la convocatoria y la buena pro.",
            "Revisa si el funcionario intervino en la contratación: área usuaria, logística o comité.",
            "Busca si declaró el vínculo en su declaración jurada de intereses o si se apartó.",
            "Descarta la explicación sencilla: un familiar, un excompañero o un motivo mal llenado en el registro.",
          ]
        : [
            "Abre el contrato y compara las dos ofertas: precios, formato y documentos.",
            "Mira si las dos empresas compiten juntas en otros procesos y quién gana.",
            "Revisa en el Registro Nacional de Proveedores qué papel tiene la persona común en cada una.",
            "Descarta la explicación sencilla: el mismo estudio contable o legal que tramita para varios clientes.",
          ];
  return {
    titulo: paraTitulo(p.ruc, p.empresa, "Proveedor"),
    etiqueta: "Ver el detalle de este indicador en observación",
    descripcion: <span className="line-clamp-2">{p.etiqueta}</span>,
    contenido: (
      <div className="space-y-5">
        {/* Sin tono de severidad: un indicador en observación todavía no cuenta para el riesgo. */}
        <EnUnaFrase>{frase}</EnUnaFrase>
        <DatosClave items={[...propios, ...comunes]} />
        <QueRevisar pasos={pasos} />
        <p className="text-meta leading-relaxed text-inkSoft">
          Indicador en observación: Vigía todavía está midiendo cuántas veces acierta, así que no cuenta para el riesgo del
          contrato. Es un motivo para mirar, no una acusación.
        </p>
      </div>
    ),
    pie: (
      <Pie
        enlaces={[
          { texto: "Abrir el contrato", href: rutaContrato(p.ocid) },
          esRuc20(p.ruc) && { texto: "Ficha de la empresa", href: `/empresa/${p.ruc}` },
          esRuc20(p.entidadRuc) && { texto: "Ficha de la entidad", href: `/entidad/${p.entidadRuc}` },
          // La misma persona del comité en sus otros contratos marcados (por su clave, nunca por su nombre).
          (p.tipo === "comite_mismo_ganador" || p.tipo === "comite_socio_proveedor" || p.tipo === "comite_competencia_restringida") && !!p.integrante && {
            texto: "Otros contratos de esa persona del comité",
            href: `/app/patrones?seccion=observacion&integrante=${p.integrante}`,
          },
          p.tipo === "comite_socio_proveedor" && !!p.ocidComite && p.ocidComite !== p.ocid && {
            texto: "El proceso en el que integró el comité",
            href: rutaContrato(p.ocidComite),
          },
        ]}
      />
    ),
  };
}
