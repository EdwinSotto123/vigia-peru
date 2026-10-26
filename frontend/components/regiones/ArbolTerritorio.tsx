"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, SearchX } from "lucide-react";
import { Buscador } from "@/components/listado/BarraFiltros";
import { BotonFila, ProveedorDetalle, type DetalleFila } from "@/components/listado/DetalleFilas";
import { TablaSkeleton, type Columna } from "@/components/listado";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, PieDetalle, type DatoClave } from "@/components/patrones/Detalle";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { coincide, numero, paraBuscar, plural } from "@/lib/formato";
import { claveOrg, normalizar, orgDe, pct, type Anio, type AutoridadesDatos } from "@/lib/partidos";
import { cn } from "@/lib/utils";
import { ANIOS, mandato, useAutoridades, type DatosAutoridades } from "./autoridades";
import type { MunicipalidadRegion, ZonaRegion } from "./datos";

/**
 * Las provincias y los distritos de una región como un ÁRBOL: cada provincia con su alcalde y su partido (y los de los
 * dos períodos anteriores) se abre en sus distritos, que van debajo con la sangría de su provincia. Cada fila abre el
 * panel lateral compartido (anclado en escritorio, con anterior/siguiente): quién la gobernó en cada período, con el
 * partido enlazado a su ficha; la provincia del distrito con su alcalde (el contexto del padre); cuántos contratos tienen
 * las entidades con sede ahí, que abren la pestaña Contratos de la región ya filtrada; y la ficha de la municipalidad.
 *
 * Antes eran dos tablas sueltas (provincias, distritos): la fila de una provincia llevaba al mapa, la de un distrito no
 * hacía nada y ninguna abría la ficha de su municipalidad (evaluación 2026-10-26).
 *
 * El archivo del JNE no trae el RUC de cada municipalidad ni el ubigeo de sus distritos: el RUC sale del árbol del mapa
 * de poder y el conteo de contratos del de /contratos/geo, los dos empatados por nombre sin tildes (los pide el servidor,
 * `datos.ts`). Lo que no empata se queda sin ese enlace; nunca se adivina el más parecido.
 */

interface Gobierno {
  anio: Anio;
  alcalde: string;
  partido: string;
  p: number | null;
}

interface Lugar {
  id: string;
  nivel: "provincial" | "distrital";
  nombre: string;
  /** Ubigeo de la provincia (4 dígitos): el del distrito es de su provincia, el archivo del JNE no trae el suyo. */
  ubigeoProvincia: string;
  gobiernos: Gobierno[];
  ruc: string | null;
  zona: ZonaRegion | null;
  /** Sin `zona`: `true` si se sabe que no tiene contratos (una provincia, que empata por ubigeo); si no, «Sin dato». */
  sinContratos: boolean;
  buscable: string;
}

interface Provincia extends Lugar {
  distritos: Lugar[];
}

const NIVEL = { provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" } as const;

/** Las columnas, con sus nombres (la cabecera es la misma rejilla que cada fila). */
const COLUMNAS: Columna[] = [
  { clave: "lugar", titulo: "Provincia o distrito", ancho: "minmax(0,1fr)" },
  { clave: "actual", titulo: "Alcalde 2023 a 2026", ancho: "minmax(0,1.25fr)", desde: "md" },
  { clave: "p2018", titulo: "2019 a 2022", ancho: "minmax(0,0.9fr)", desde: "xl" },
  { clave: "p2014", titulo: "2015 a 2018", ancho: "minmax(0,0.9fr)", desde: "xl" },
  { clave: "contratos", titulo: "Contratos", ancho: "96px", alinear: "der", desde: "md" },
];
// Clases literales (Tailwind sólo genera lo que ve escrito entero).
const REJILLA =
  "grid items-center gap-x-4 grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_96px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_96px]";
const FILA =
  "min-h-[56px] w-full flex-1 px-3 py-2.5 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate";

export function TerritorioRegion({
  ubigeo,
  nombre,
  buscar,
  municipalidades,
  zonas,
  rutaContratos,
}: {
  ubigeo: string;
  nombre: string;
  /** Lo que trae `?tq=` (un enlace desde el directorio de gobiernos): el árbol abre ya filtrado. */
  buscar?: string;
  municipalidades: MunicipalidadRegion[] | null;
  zonas: ZonaRegion[] | null;
  /** La pestaña Contratos de la ficha de la región: `${rutaContratos}&ubigeo=…` filtra por el lugar. */
  rutaContratos: string;
}) {
  const d = useAutoridades();
  const provincias = useMemo(() => (d ? armar(d, ubigeo, municipalidades, zonas) : []), [d, ubigeo, municipalidades, zonas]);

  if (d === undefined) return <TablaSkeleton columnas={COLUMNAS} filas={6} />;
  if (d === null) return <EstadoVacio>No pudimos leer los resultados del JNE. Vuelve a intentarlo en un momento.</EstadoVacio>;
  if (!provincias.length) return <EstadoVacio>El JNE no trae provincias ni distritos para {nombre}.</EstadoVacio>;
  return <Arbol provincias={provincias} nombre={nombre} buscar={buscar} rutaContratos={rutaContratos} conMunicipalidades={!!municipalidades} />;
}

/** Empata cada lugar del JNE con su municipalidad y su conteo de contratos, y arma provincia → distritos. */
function armar(d: DatosAutoridades, ubigeo: string, municipalidades: MunicipalidadRegion[] | null, zonas: ZonaRegion[] | null): Provincia[] {
  const base = (d[2022] ?? d[2018] ?? d[2014]) as AutoridadesDatos;
  const ruc = new Map<string, string>();
  for (const m of municipalidades ?? []) {
    const k = m.nivel === "provincial" ? `p|${normalizar(m.provincia)}` : `d|${normalizar(m.provincia)}|${normalizar(m.distrito ?? "")}`;
    // Si un gobierno trae varias entidades (la municipalidad y un instituto vial, por ejemplo), la municipalidad.
    if (!ruc.has(k) || /^MUNICIPALIDAD/i.test(m.nombre)) ruc.set(k, m.ruc);
  }
  const zonaProv = new Map((zonas ?? []).filter((z) => z.nivel === "provincia").map((z) => [z.ubigeo, z] as const));
  const zonaDist = new Map((zonas ?? []).filter((z) => z.nivel === "distrito").map((z) => [`${z.ubigeo.slice(0, 4)}|${normalizar(z.nombre)}`, z] as const));

  const gobiernos = (nivel: "provincial" | "distrital", u: string, distrito?: string): Gobierno[] =>
    ANIOS.flatMap((a) => {
      const x = d[a];
      if (!x) return [];
      const g = nivel === "provincial" ? x.provincial.find((p) => p.u === u) : x.distrital.find((t) => t.u === u && t.n === distrito);
      return g ? [{ anio: a, alcalde: g.a, partido: orgDe(x, g.o).n, p: g.p }] : [];
    });
  const texto = (nombreLugar: string, gs: Gobierno[]) => paraBuscar([nombreLugar, ...gs.flatMap((g) => [g.alcalde, g.partido])].join(" "));

  const distritosDe = new Map<string, { n: string; pv: string }[]>();
  for (const t of base.distrital.filter((x) => x.u.startsWith(ubigeo))) distritosDe.set(t.u, [...(distritosDe.get(t.u) ?? []), { n: t.n, pv: t.pv }]);
  const provinciales = base.provincial.filter((p) => p.u.startsWith(ubigeo));
  const lista: { u: string; n: string; conAlcalde: boolean }[] = [
    ...provinciales.map((p) => ({ u: p.u, n: p.n, conAlcalde: true })),
    // Una provincia sin su alcalde en el archivo, pero con distritos: igual va, con el nombre que traen ellos.
    ...[...distritosDe.entries()].filter(([u]) => !provinciales.some((p) => p.u === u)).map(([u, ts]) => ({ u, n: ts[0].pv, conAlcalde: false })),
  ].sort((a, b) => a.n.localeCompare(b.n, "es"));

  return lista.map((p) => {
    const gs = p.conAlcalde ? gobiernos("provincial", p.u) : [];
    const distritos: Lugar[] = (distritosDe.get(p.u) ?? [])
      .sort((a, b) => a.n.localeCompare(b.n, "es"))
      .map((t) => {
        const gd = gobiernos("distrital", p.u, t.n);
        return {
          id: `d-${p.u}-${normalizar(t.n)}`,
          nivel: "distrital",
          nombre: t.n,
          ubigeoProvincia: p.u,
          gobiernos: gd,
          ruc: ruc.get(`d|${normalizar(p.n)}|${normalizar(t.n)}`) ?? null,
          zona: zonaDist.get(`${p.u}|${normalizar(t.n)}`) ?? null,
          // El geo sólo trae los lugares con contratos y el distrito empata por nombre: si no aparece, no se sabe si
          // es cero o un nombre escrito distinto. «Sin dato», nunca un cero inventado.
          sinContratos: false,
          // Sin el nombre de su provincia: buscar «Huaral» abre la provincia y su distrito capital, no los doce.
          buscable: texto(t.n, gd),
        };
      });
    return {
      id: `p-${p.u}`,
      nivel: "provincial",
      nombre: p.n,
      ubigeoProvincia: p.u,
      gobiernos: gs,
      ruc: ruc.get(`p|${normalizar(p.n)}`) ?? null,
      zona: zonaProv.get(p.u) ?? null,
      sinContratos: zonas !== null && !zonaProv.has(p.u),
      buscable: texto(p.n, gs),
      distritos,
    };
  });
}

function Arbol({
  provincias,
  nombre,
  buscar,
  rutaContratos,
  conMunicipalidades,
}: {
  provincias: Provincia[];
  nombre: string;
  buscar?: string;
  rutaContratos: string;
  conMunicipalidades: boolean;
}) {
  const [consulta, setConsulta] = useState(buscar ?? "");
  const q = paraBuscar(consulta);
  // Buscando, se abren solas las provincias con un distrito que coincide (antes había que buscar en dos tablas).
  const conCoincidencias = (texto: string) => new Set(provincias.filter((p) => p.distritos.some((t) => coincide(t.buscable, texto))).map((p) => p.id));
  const [abiertas, setAbiertas] = useState<Set<string>>(() => (q ? conCoincidencias(q) : new Set()));

  const visibles = provincias
    .map((p) => {
      const coinciden = q ? p.distritos.filter((t) => coincide(t.buscable, q)) : [];
      return { p, coinciden, ve: !q || coincide(p.buscable, q) || coinciden.length > 0 };
    })
    .filter((x) => x.ve);
  const total = provincias.reduce((s, p) => s + 1 + p.distritos.length, 0);
  const encontrados = visibles.reduce((s, x) => s + (q && !coincide(x.p.buscable, q) ? 0 : 1) + (q ? x.coinciden.length : x.p.distritos.length), 0);

  // Las filas a la vista, en orden: el panel compartido recorre éstas con anterior/siguiente.
  const filas: { lugar: Lugar; padre: Provincia | null }[] = [];
  for (const { p, coinciden } of visibles) {
    filas.push({ lugar: p, padre: null });
    if (abiertas.has(p.id)) for (const t of q && coinciden.length ? coinciden : p.distritos) filas.push({ lugar: t, padre: p });
  }
  const contratosDe = (z: ZonaRegion) => `${rutaContratos}&ubigeo=${z.ubigeo}`;
  const detalles: DetalleFila[] = filas.map(({ lugar, padre }) => detalleDe(lugar, padre, nombre, contratosDe));

  const alternar = (id: string) =>
    setAbiertas((a) => {
      const b = new Set(a);
      if (b.has(id)) b.delete(id);
      else b.add(id);
      return b;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Buscador
          placeholder="Buscar una provincia, un distrito, un alcalde o un partido…"
          etiqueta={`Buscar en las provincias y distritos de ${nombre}`}
          valor={consulta}
          onBuscar={(v) => {
            setConsulta(v);
            setAbiertas(conCoincidencias(paraBuscar(v)));
          }}
        />
        {q && (
          <span className="text-meta tabular-nums text-mute" aria-live="polite">
            {numero(encontrados)} de {numero(total)} lugares
          </span>
        )}
      </div>

      {visibles.length === 0 ? (
        <EstadoVacio icono={<SearchX size={16} />}>Ningún lugar, alcalde o partido coincide con “{consulta}”.</EstadoVacio>
      ) : (
        <ProveedorDetalle detalles={detalles} nombre={`Provincias y distritos de ${nombre}`}>
          <div className="overflow-clip rounded-2xl border border-line bg-paper">
            {/* La cabecera: la misma rejilla que las filas, corrida lo que ocupa el botón de abrir. */}
            <div className="flex border-b border-line bg-paperSoft text-rotulo font-medium text-mute">
              <span className="w-11 shrink-0" aria-hidden />
              <div className={cn(REJILLA, "flex-1 px-3 py-2.5")}>
                <span className="truncate">Provincia o distrito</span>
                <span className="hidden truncate md:block">Alcalde 2023 a 2026</span>
                <span className="hidden truncate xl:block">{mandato(2018)}</span>
                <span className="hidden truncate xl:block">{mandato(2014)}</span>
                <span className="hidden items-center justify-end gap-1 md:flex">
                  Contratos
                  <Ayuda titulo="¿Qué contratos cuenta?">
                    Los de las entidades con sede en ese lugar desde 2015: la municipalidad y también las demás (colegios,
                    hospitales, oficinas del Estado), como los cuenta el mapa. El detalle de cada fila lleva a esa lista.
                  </Ayuda>
                </span>
              </div>
            </div>
            <ul aria-label={`Provincias de ${nombre}`}>
              {visibles.map(({ p, coinciden }) => {
                const abierta = abiertas.has(p.id);
                const hijos = q && coinciden.length ? coinciden : p.distritos;
                return (
                  <li key={p.id} className="border-b border-line/70 last:border-b-0">
                    <div className="flex items-stretch">
                      {p.distritos.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => alternar(p.id)}
                          aria-expanded={abierta}
                          aria-controls={`distritos-${p.id}`}
                          aria-label={`${abierta ? "Ocultar" : "Ver"} los distritos de ${p.nombre}`}
                          className="flex w-11 shrink-0 items-center justify-center text-mute transition-colors duration-rapido hover:bg-paperSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
                        >
                          <ChevronRight size={16} aria-hidden className={cn("transition-transform duration-rapido", abierta && "rotate-90")} />
                        </button>
                      ) : (
                        <span className="w-11 shrink-0" aria-hidden />
                      )}
                      <BotonFila id={p.id} etiqueta={`Ver la provincia de ${p.nombre}`} className={cn(REJILLA, FILA)}>
                        <CeldasLugar lugar={p} meta={<Dato tipo="lugar" nombre="Distritos">{plural(p.distritos.length, "distrito", "distritos")}</Dato>} />
                      </BotonFila>
                    </div>
                    {abierta && (
                      <ul id={`distritos-${p.id}`} aria-label={`Distritos de ${p.nombre}`} className="border-t border-line/70 bg-paperSoft/40">
                        {hijos.map((t) => (
                          <li key={t.id} className="flex items-stretch border-b border-line/50 last:border-b-0">
                            {/* La sangría de su provincia, con su guía: se lee de quién es cada distrito. */}
                            <span className="relative w-11 shrink-0" aria-hidden>
                              <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
                            </span>
                            <BotonFila id={t.id} etiqueta={`Ver el distrito de ${t.nombre}, provincia de ${p.nombre}`} className={cn(REJILLA, FILA)}>
                              <CeldasLugar lugar={t} sangria meta={<Dato tipo="lugar" nombre="Provincia">Provincia de {p.nombre}</Dato>} />
                            </BotonFila>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </ProveedorDetalle>
      )}
      <p className="text-rotulo text-mute">
        Fuente: JNE, elecciones municipales de 2014, 2018 y 2022 (mandatos 2015 a 2026). Contratos: SEACE y CONOSCE (OECE).
        {!conMunicipalidades && " No pudimos traer las fichas de las municipalidades: vuelve a intentarlo en un momento."}
      </p>
    </div>
  );
}

/** Lo que se dice del número de contratos de un lugar: el número, «Ninguno» si se sabe que es cero, o «Sin dato». */
const contratosTexto = (l: Lugar) => (l.zona ? numero(l.zona.total) : l.sinContratos ? "Ninguno" : "Sin dato");

/** Las celdas de una fila: el lugar (con su contexto), su alcalde y partido de hoy, los partidos de antes y sus contratos. */
function CeldasLugar({ lugar, meta, sangria = false }: { lugar: Lugar; meta: ReactNode; sangria?: boolean }) {
  const [actual, g2018, g2014] = [2022, 2018, 2014].map((a) => lugar.gobiernos.find((g) => g.anio === a) ?? null);
  return (
    <>
      <span className={cn("block min-w-0", sangria && "pl-3")}>
        <span className="block truncate text-dato font-semibold text-ink" title={lugar.nombre}>{lugar.nombre}</span>
        <span className="block truncate text-meta text-mute">{meta}</span>
        {/* En el celular, el alcalde y el partido de hoy y los contratos, debajo del nombre (son el tema de la fila). */}
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta md:hidden">
          {actual ? (
            <span className="min-w-0">
              <span className="text-inkSoft">{actual.alcalde}</span> <Dato tipo="partido">{actual.partido}</Dato>
            </span>
          ) : (
            <span className="text-mute">Sin dato del alcalde 2023 a 2026</span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="text-rotulo text-mute">Contratos</span>
            <span className={cn("tabular-nums", lugar.zona ? "font-mono text-ink" : "text-mute")}>{contratosTexto(lugar)}</span>
          </span>
        </span>
      </span>
      <span className="hidden min-w-0 md:block">
        {actual ? (
          <>
            <span className="block truncate text-dato text-ink" title={actual.alcalde}>{actual.alcalde}</span>
            <span className="block truncate text-meta text-inkSoft" title={actual.partido}>
              <Dato tipo="partido">{actual.partido}</Dato>
            </span>
          </>
        ) : (
          <span className="text-meta text-mute">Sin dato</span>
        )}
      </span>
      <span className="hidden min-w-0 truncate text-meta text-inkSoft xl:block" title={g2018?.partido}>{g2018 ? g2018.partido : <span className="text-mute">Sin dato</span>}</span>
      <span className="hidden min-w-0 truncate text-meta text-inkSoft xl:block" title={g2014?.partido}>{g2014 ? g2014.partido : <span className="text-mute">Sin dato</span>}</span>
      <span className="hidden text-right font-mono text-meta tabular-nums md:block">
        {lugar.zona ? <span className="text-ink">{numero(lugar.zona.total)}</span> : <span className="font-sans text-mute">{contratosTexto(lugar)}</span>}
      </span>
    </>
  );
}

/** El panel de una fila (§14.4): quién la gobernó, su provincia si es un distrito, sus contratos y su ficha. */
function detalleDe(lugar: Lugar, padre: Provincia | null, region: string, contratosDe: (z: ZonaRegion) => string): DetalleFila {
  const actual = lugar.gobiernos.find((g) => g.anio === 2022) ?? null;
  const padreActual = padre?.gobiernos.find((g) => g.anio === 2022) ?? null;
  const enlace = "font-medium text-granate underline-offset-2 hover:underline";
  const datos: DatoClave[] = [
    ...(padre
      ? [
          {
            etiqueta: "Provincia",
            valor: (
              <span className="block">
                {padre.nombre}
                {padreActual && (
                  <span className="block text-meta text-inkSoft">
                    Alcalde provincial: {padreActual.alcalde}, <Link href={`/app/partidos/${claveOrg(padreActual.partido)}?anio=2022`} className={enlace}>{padreActual.partido}</Link>
                  </span>
                )}
              </span>
            ),
          },
        ]
      : []),
    ...(lugar.nivel === "provincial" ? [{ etiqueta: "Distritos", valor: plural((lugar as Provincia).distritos.length, "distrito", "distritos") }] : []),
    {
      etiqueta: "Contratos",
      valor: lugar.zona ? (
        <Link href={contratosDe(lugar.zona)} className={enlace}>
          {plural(lugar.zona.total, "contrato", "contratos")} de entidades con sede aquí
        </Link>
      ) : lugar.sinContratos ? (
        "Ninguno en la base de Vigía"
      ) : (
        <span className="text-mute">Sin dato</span>
      ),
    },
  ];
  const pie =
    lugar.ruc || lugar.zona ? (
      <PieDetalle
        principal={lugar.ruc ? <EnlaceAccion href={`/entidad/${lugar.ruc}`} flecha>Abrir la ficha de la municipalidad</EnlaceAccion> : undefined}
        secundarias={lugar.zona ? <EnlaceAccion href={contratosDe(lugar.zona)} variante="secundario">Ver sus contratos</EnlaceAccion> : undefined}
      />
    ) : undefined;
  return {
    id: lugar.id,
    titulo: lugar.nombre,
    etiqueta: lugar.nivel === "provincial" ? `Ver la provincia de ${lugar.nombre}` : `Ver el distrito de ${lugar.nombre}`,
    descripcion: lugar.nivel === "provincial" ? `Provincia de ${region}` : `Distrito de la provincia de ${padre?.nombre ?? lugar.nombre}, ${region}`,
    contenido: (
      <CuerpoDetalle>
        <ChipsDetalle>
          <span className="pill border-line bg-paperSoft text-inkSoft">{NIVEL[lugar.nivel]}</span>
        </ChipsDetalle>
        <DatosClave items={datos} />
        <BloqueDetalle titulo="Quién la gobernó">
          {lugar.gobiernos.length ? (
            <ol className="divide-y divide-line/70 rounded-xl border border-line">
              {lugar.gobiernos.map((g) => (
                <li key={g.anio} className="grid gap-x-4 gap-y-0.5 px-3.5 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <span className="text-meta tabular-nums text-mute">{mandato(g.anio)}</span>
                  <span className="min-w-0">
                    <span className="block text-dato text-ink">{g.alcalde}</span>
                    <span className="flex flex-wrap items-center gap-x-3 text-meta">
                      <Link href={`/app/partidos/${claveOrg(g.partido)}?anio=${g.anio}`} className={enlace}>
                        {g.partido}
                      </Link>
                      {pct(g.p) && <span className="tabular-nums text-mute">{pct(g.p)} de los votos</span>}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-meta text-mute">El JNE no trae a sus alcaldes en estos períodos.</p>
          )}
        </BloqueDetalle>
        {!lugar.ruc && <p className="text-rotulo text-mute">Vigía no tiene la ficha de su municipalidad.</p>}
      </CuerpoDetalle>
    ),
    pie,
  };
}
