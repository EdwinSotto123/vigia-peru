"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ayuda, AyudaTermino, CabeceraPestana, DatosClave, FuenteDato } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable, type FiltroLocal, type OrdenLocal } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { AyudaIndicios, ChipsIndicio } from "@/components/grafo/indicios";
import { BotonCerrar, BotonFicha, ChipLeyenda, GrafoMarco } from "@/components/grafo/primitivos";
import { EstadoCarga, SelectorVista, TablaORed, letraEnUnidades, useAncho, usePoder } from "@/components/grafo/vista";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { CONTRATACIONES_ABIERTAS } from "@/lib/fuentes";
import { nombreSinTipo, rad, type ConteosCaptura } from "@/lib/grafo";
import { recortar } from "@/components/contratos/recortar";
import { tituloNatural } from "@/lib/landing";
import type { Institucion, MapaInstituciones as Datos } from "@/lib/poder";
import { cn } from "@/lib/utils";

/**
 * Las instituciones del Estado que más contratan, por rama (/app/poder, pestaña «Instituciones»): ministerios,
 * organismos del Estado, gobiernos regionales y municipalidades. Lista con buscador, filtro por rama y orden; cada fila
 * va a la ficha de la institución. Dice cuántas trae cada rama (las 24 que más contratan, o el gobierno regional de
 * cada departamento): antes el radial se cortaba en 7 o en 24 sin decirlo. Las electas traen su captura (los
 * ministerios no se eligen por partido). La red, por rama, sólo desde lg.
 */

type Inst = Institucion & ConteosCaptura;
type RamaKey = keyof Datos["ramas"];

const RAMAS: { key: RamaKey; titulo: string }[] = [
  { key: "ministerios", titulo: "Ministerios" },
  { key: "organismos", titulo: "Organismos del Estado" },
  { key: "regional", titulo: "Gobiernos regionales" },
  { key: "local", titulo: "Municipalidades" },
];

const COLUMNAS: Columna[] = [
  { clave: "institucion", titulo: "Institución", ancho: "minmax(0,1.6fr)" },
  {
    clave: "contratos",
    titulo: "Contratos",
    ancho: "minmax(7.5rem,0.7fr)",
    alinear: "der",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta «contratos»?">
        <span className="block">Sus convocatorias en la base de Vigía (OECE).</span>
        <span className="mt-1.5 block">La barra la compara con la que más contrata de su misma rama.</span>
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Valor referencial", ancho: "8rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Valor", ayuda: <AyudaTermino clave="valor-referencial" /> },
  { clave: "indicio", titulo: "Contratos con indicio", ancho: "8.5rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "Con indicio" },
  { clave: "indicios", titulo: "Indicios, en contratos", ancho: "minmax(0,1fr)", desde: "xl", ayuda: <AyudaIndicios /> },
];

const ORDENES: OrdenLocal[] = [
  { valor: "contratos", etiqueta: "Más contratos", clave: "contratos", dir: "desc" },
  { valor: "monto", etiqueta: "Más valor referencial", clave: "monto", dir: "desc" },
  { valor: "indicio", etiqueta: "Más contratos con indicio", clave: "indicio", dir: "desc" },
  { valor: "nombre", etiqueta: "Nombre, de la A a la Z", clave: "nombre", dir: "asc" },
];

const tituloRama = (k: RamaKey) => RAMAS.find((r) => r.key === k)?.titulo ?? k;

export function MapaInstituciones() {
  const carga = usePoder<Datos>("/poder/instituciones");
  const [red, setRed] = useState(false);
  return (
    <div className="space-y-4">
      <CabeceraPestana acciones={<SelectorVista red={red} onCambio={setRed} />}>
        Las 24 que más contratan de cada rama (ministerios, organismos y municipalidades) y el gobierno regional de cada
        departamento, con la captura de las que se eligen por partido.
      </CabeceraPestana>
      <EstadoCarga carga={carga} columnas={COLUMNAS}>
        {(d) => <Instituciones datos={d} red={red} />}
      </EstadoCarga>
    </div>
  );
}

function Instituciones({ datos, red }: { datos: Datos; red: boolean }) {
  const { filas, filtros } = useMemo(() => {
    const filas: FilaFiltrable[] = [];
    for (const r of RAMAS) {
      const lista = (datos.ramas[r.key] ?? []) as Inst[];
      const max = Math.max(1, ...lista.map((e) => e.n_contratos));
      for (const e of lista) filas.push(fila(e, r.key, max));
    }
    const filtros: FiltroLocal[] = [
      { clave: "rama", etiqueta: "Rama del Estado", corta: "Rama del Estado", opciones: RAMAS.map((r) => ({ valor: r.key, etiqueta: r.titulo })) },
      {
        clave: "eleccion",
        etiqueta: "Se elige por partido o no",
        corta: "Electa o no",
        opciones: [
          { valor: "electa", etiqueta: "La gobierna un partido" },
          { valor: "no", etiqueta: "No se elige por partido" },
        ],
      },
    ];
    return { filas, filtros };
  }, [datos]);

  const tabla = (
    <div className="space-y-3">
      <TablaFiltrable
        columnas={COLUMNAS}
        filas={filas}
        etiqueta="Instituciones que más contratan, por rama"
        nombre="instituciones"
        tam={25}
        densidad="compacta"
        buscar={{ placeholder: "Buscar una institución, región o partido…", etiqueta: "Buscar una institución" }}
        filtros={filtros}
        ordenes={ORDENES}
      />
      <FuenteDato fuente="SEACE y OECE (convocatorias de cada institución en la base de Vigía)" href={CONTRATACIONES_ABIERTAS} />
    </div>
  );
  return <TablaORed red={red} tabla={tabla} grafo={<RedInstituciones datos={datos} />} />;
}

function fila(e: Inst, rama: RamaKey, maxRama: number): FilaFiltrable {
  const nombre = tituloNatural(e.nombre);
  const electa = !!e.partido;
  const captura = e.captura ?? 0;
  return {
    id: e.ruc,
    href: `/entidad/${e.ruc}`,
    buscable: [e.nombre, e.region, e.partido, tituloRama(rama)].filter(Boolean).join(" "),
    valores: { rama, eleccion: electa ? "electa" : "no" },
    claves: { contratos: e.n_contratos, monto: e.monto, indicio: electa ? captura : null, nombre },
    celdas: {
      institucion: (
        <CeldaPrincipal
          titulo={nombre}
          meta={[
            <Dato key="r" tipo="tipo">{tituloRama(rama)}</Dato>,
            e.region && <Dato key="l" tipo="lugar">{tituloNatural(e.region)}</Dato>,
            e.partido && <Dato key="p" tipo="partido">{tituloNatural(e.partido)}</Dato>,
          ]}
        />
      ),
      contratos: (
        <span className="block w-full">
          <span className="block text-right font-mono text-meta tabular-nums text-ink">{numero(e.n_contratos)}</span>
          {/* Contra la que más contrata de su misma rama: una barra contra EsSalud dejaba a los ministerios en nada. */}
          <CeldaBarra parte={e.n_contratos / maxRama} resumen={`${numero(e.n_contratos)} contratos, frente a ${numero(maxRama)} de la que más contrata en su rama`} className="mt-1" />
        </span>
      ),
      monto: <CeldaNumero>{solesCompacto(e.monto)}</CeldaNumero>,
      indicio: electa ? (
        <CeldaNumero>{numero(captura)}</CeldaNumero>
      ) : (
        <span className="text-meta text-mute">No se elige</span>
      ),
      indicios: electa ? <ChipsIndicio x={{ ...e, n_captura: captura }} /> : <span className="text-meta text-mute">No se elige</span>,
    },
  };
}

// ─── La red (sólo desde lg) ──────────────────────────────────────────────────

const LETRA = 12.5;
const W = 1000;

/**
 * Una rama a la vez, en anillo: la rama al centro y sus instituciones alrededor (el tamaño es cuánto contrata). Rojo con
 * halo = con contratos con indicio. Antes las cuatro ramas iban juntas, con 7 nombres apretados en cada arco.
 */
function RedInstituciones({ datos }: { datos: Datos }) {
  const router = useRouter();
  const [rama, setRama] = useState<RamaKey>("regional");
  const [sel, setSel] = useState<Inst | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [marco, ancho] = useAncho<HTMLDivElement>();
  const letra = letraEnUnidades(LETRA, ancho, W);
  const lista = (datos.ramas[rama] ?? []) as Inst[];
  const H = W;
  const cx = W / 2;
  const cy = H / 2;
  // Con letra de 12 px, el nombre más largo del anillo (20 letras) entra en el lienzo desde el ancho de lg.
  const Re = 250;
  const max = Math.max(1, ...lista.map((e) => e.n_contratos));
  const nodos = lista.map((e, k) => {
    const deg = -90 + ((k + 0.5) * 360) / Math.max(lista.length, 1);
    const a = rad(deg);
    return { e, deg, a, x: cx + Re * Math.cos(a), y: cy + Re * Math.sin(a), r: 6 + 14 * Math.sqrt(e.n_contratos / max) };
  });
  const titulo = tituloRama(rama);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="group" aria-label="Qué rama ver" className="flex flex-wrap gap-1.5">
          {RAMAS.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={rama === r.key}
              onClick={() => { setRama(r.key); setSel(null); }}
              className={cn(
                "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-meta font-medium transition-colors duration-rapido",
                rama === r.key ? "border-granate bg-granate-50 font-semibold text-granate" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
              )}
            >
              {r.titulo}
              <span className="rounded-full bg-paperDeep px-1.5 text-rotulo tabular-nums text-inkSoft">{numero((datos.ramas[r.key] ?? []).length)}</span>
            </button>
          ))}
        </div>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ChipLeyenda tono="crimson" forma="halo">con contratos con indicio</ChipLeyenda>
          <ChipLeyenda tono="granate" forma="punto">sin indicio o no electa</ChipLeyenda>
          <span className="text-rotulo text-mute">el tamaño es cuánto contrata</span>
        </span>
      </div>
      <div ref={marco}>
        <GrafoMarco>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-manipulation select-none" role="group" aria-label={`Red de ${titulo}: la misma información que la tabla`}>
            {nodos.map((nd) => (
              <line
                key={`l${nd.e.ruc}`}
                x1={cx} y1={cy} x2={nd.x} y2={nd.y}
                className={(nd.e.captura ?? 0) > 0 ? "stroke-crimson" : "stroke-granate"}
                strokeWidth={sel?.ruc === nd.e.ruc ? 2 : 1.2}
                strokeOpacity={hover && hover !== nd.e.ruc ? 0.12 : 0.4}
                strokeLinecap="round"
              />
            ))}
            {nodos.map((nd) => {
              const activo = hover === nd.e.ruc || sel?.ruc === nd.e.ruc;
              const captura = (nd.e.captura ?? 0) > 0;
              const r = nd.r * (activo ? 1.3 : 1);
              const flip = Math.cos(nd.a) < 0;
              const etiqueta = rama === "regional" && nd.e.region ? tituloNatural(nd.e.region) : recortar(nombreSinTipo(nd.e.nombre), 20);
              return (
                <g
                  key={nd.e.ruc}
                  className="cursor-pointer focus:outline-none"
                  role="button"
                  tabIndex={0}
                  aria-label={`${tituloNatural(nd.e.nombre)}: ${plural(nd.e.n_contratos, "contrato", "contratos")}${captura ? `, ${plural(nd.e.captura ?? 0, "con indicio", "con indicio")}` : ""}`}
                  onPointerEnter={() => setHover(nd.e.ruc)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(nd.e.ruc)}
                  onBlur={() => setHover(null)}
                  onClick={() => setSel(nd.e)}
                  onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setSel(nd.e); } }}
                  opacity={hover && !activo ? 0.45 : 1}
                >
                  {(captura || activo) && <circle cx={nd.x} cy={nd.y} r={r + 5} className={`pointer-events-none ${captura ? "fill-crimson/20" : "fill-granate/15"}`} />}
                  {sel?.ruc === nd.e.ruc && <circle cx={nd.x} cy={nd.y} r={r + 3.5} className="pointer-events-none fill-none stroke-ink" strokeWidth={1.4} />}
                  <circle cx={nd.x} cy={nd.y} r={r} className={captura ? "fill-crimson/35 stroke-crimson" : "fill-granate/30 stroke-granate"} strokeWidth={activo ? 2.4 : 1.4} />
                  <g transform={`translate(${nd.x} ${nd.y}) rotate(${nd.deg})`} className="pointer-events-none">
                    <text
                      transform={`translate(${r + 6} 0)${flip ? " rotate(180)" : ""}`}
                      y={letra * 0.32}
                      textAnchor={flip ? "end" : "start"}
                      className={activo ? "fill-ink font-semibold" : "fill-inkSoft"}
                      style={{ fontSize: `${letra}px` }}
                    >
                      {etiqueta}
                    </text>
                  </g>
                </g>
              );
            })}
            <circle cx={cx} cy={cy} r={Math.max(letra * 3, (titulo.length * letra * 0.56) / 2 + letra)} className="fill-paperSoft stroke-ink" strokeWidth={2} />
            <text x={cx} y={cy + letra * 0.35} textAnchor="middle" className="fill-ink font-semibold" style={{ fontSize: `${letra}px` }}>
              {titulo}
            </text>
          </svg>
        </GrafoMarco>
      </div>
      {sel && (
        <section aria-label={`Detalle de ${tituloNatural(sel.nombre)}`} className="space-y-3 border-t border-line pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-bloque font-bold leading-tight text-ink">{tituloNatural(sel.nombre)}</h3>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-meta text-mute">
                <Dato tipo="tipo">{titulo}</Dato>
                {sel.region && <Dato tipo="lugar">{tituloNatural(sel.region)}</Dato>}
              </div>
            </div>
            <BotonCerrar onClick={() => setSel(null)} />
          </div>
          <DatosClave
            items={[
              { etiqueta: "Contratos", valor: numero(sel.n_contratos), mono: true },
              { etiqueta: "Valor referencial", valor: solesCompacto(sel.monto), mono: true, ayuda: <AyudaTermino clave="valor-referencial" /> },
              { etiqueta: "La gobierna", valor: sel.partido ? tituloNatural(sel.partido) : "No se elige por partido" },
              ...(sel.partido ? [{ etiqueta: "Contratos con indicio", valor: numero(sel.captura ?? 0), mono: true }] : []),
            ]}
          />
          {sel.partido && (sel.captura ?? 0) > 0 && <ChipsIndicio x={{ ...sel, n_captura: sel.captura }} max={3} />}
          <div className="max-w-xs">
            <BotonFicha onClick={() => router.push(`/entidad/${sel.ruc}`)}>Ver la ficha de la institución</BotonFicha>
          </div>
        </section>
      )}
    </div>
  );
}
