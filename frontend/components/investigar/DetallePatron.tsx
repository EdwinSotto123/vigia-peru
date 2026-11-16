"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { DatosClave, EnUnaFrase, type DatoClave } from "@/components/patrones";
import { usePoder } from "@/components/grafo/vista";
import type { Fila } from "@/components/listado";
import { Button } from "@/components/ui/Button";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { decimal, fechaConAnio, numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  codigoDeOcid,
  type AlcancePatron,
  type PatronAcompanante,
  type PatronConsorcio,
  type PatronControl,
  type PatronDueno,
  type PatronInhabilitada,
  type PatronObservado,
  type PatronRenovacion,
  type PatronSenal,
} from "@/lib/patrones";
import { rutaContrato } from "@/lib/rutas";

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
function QueRevisar({ pasos }: { pasos: ReactNode[] }) {
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
          alcance === "entidad" && esRuc20(p.ruc) && { texto: "Ficha de la entidad", href: `/entidad/${p.ruc}` },
          alcance === "entidad" && esRuc20(p.ruc) && { texto: "Sus contratos", href: `/entidad/${p.ruc}?seccion=contratos` },
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
          esRuc20(p.rucGanador) && { texto: "Ficha de quien gana", href: `/empresa/${p.rucGanador}` },
          esRuc20(p.rucAcompanante) && { texto: "Ficha de la que acompaña", href: `/empresa/${p.rucAcompanante}` },
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
    pie: <Pie enlaces={[esRuc20(p.rucA) && { texto: "Ficha de la primera", href: `/empresa/${p.rucA}` }, esRuc20(p.rucB) && { texto: "Ficha de la segunda", href: `/empresa/${p.rucB}` }]} />,
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
    pie: <Pie enlaces={[esRuc20(p.entidadRuc) && { texto: "Ficha de la entidad", href: `/entidad/${p.entidadRuc}` }]} />,
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
          esRuc20(p.ruc) && { texto: "Ficha de la que gana", href: `/empresa/${p.ruc}` },
          esRuc20(p.sancionadaRuc) && { texto: "Ficha de la inhabilitada", href: `/empresa/${p.sancionadaRuc}` },
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
    pie: <Pie enlaces={[esRuc20(p.ruc) && { texto: "Ficha de la empresa", href: `/empresa/${p.ruc}` }, esRuc20(p.informeEntidadRuc) && { texto: "Informes de esa entidad", href: `/entidad/${p.informeEntidadRuc}?seccion=control` }]} />,
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
          esRuc20(p.entidadRuc) && { texto: "Contratos observados de la entidad", href: `/app/contratos?entidad=${p.entidadRuc}&cruce=observado_por_contraloria` },
          esRuc20(p.entidadRuc) && p.despues > 0 && { texto: "Los adjudicados después", href: `/app/contratos?entidad=${p.entidadRuc}&cruce=gano_tras_observacion` },
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
          { texto: "Abrir el contrato de ahora", href: rutaContrato(p.ocid) },
          { texto: "Abrir el anterior", href: rutaContrato(p.ocidAnterior) },
          esRuc20(p.entidadRuc) && { texto: "Ficha de la entidad", href: `/entidad/${p.entidadRuc}` },
        ]}
      />
    ),
  };
}
