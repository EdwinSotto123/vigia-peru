"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CeldaNumero, CeldaPrincipal, Indicadores, IndicadoresSkeleton, Tabla, TablaPaginada, TablaSkeleton, type Columna, type Fila, type Indicador } from "@/components/listado";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { Dato } from "@/components/ui/Dato";
import { numero } from "@/lib/formato";
import { PERIODOS, cargarAutoridades, cargoRegional, claveOrg, orgDe, pct, type Anio, type AutoridadesDatos } from "@/lib/partidos";

/**
 * Los gobiernos de una región en las tres elecciones cargadas (2014, 2018 y 2022: mandatos 2015-2018, 2019-2022 y
 * 2023-2026), de los archivos del JNE que ya usa /app/partidos (`public/data/autoridades-<año>.json`):
 *   · `ResumenRegion`: quién la gobierna hoy, cuántas provincias y distritos tiene, cuántas organizaciones los gobiernan.
 *   · `HistoriaGobiernos`: sus gobernadores período por período y qué partidos ganaron sus provincias y distritos.
 *   · `TerritorioRegion`: cada provincia y cada distrito con su alcalde y su partido en cada período, con buscador.
 * Pedido del usuario (2026-10-22): «clickeamos la región y vemos su historial, cuántos distritos tiene, quiénes
 * gobernaron, casos de corrupción». Cliente: los tres archivos se bajan una vez y los comparten las tres piezas.
 */

const ANIOS: Anio[] = [2022, 2018, 2014];
type Datos = Partial<Record<Anio, AutoridadesDatos>>;
const mandato = (a: Anio) => PERIODOS.find((p) => p.anio === a)?.mandato ?? String(a);

function useAutoridades(): Datos | null | undefined {
  const [d, setD] = useState<Datos | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    Promise.all(ANIOS.map((a) => cargarAutoridades(a))).then((xs) => {
      if (!vivo) return;
      const out: Datos = {};
      ANIOS.forEach((a, i) => { if (xs[i]) out[a] = xs[i]!; });
      setD(Object.keys(out).length ? out : null);
    });
    return () => { vivo = false; };
  }, []);
  return d;
}

const nombreOrg = (d: AutoridadesDatos | undefined, o: number | undefined) => (d && o != null ? orgDe(d, o).n : null);

export function ResumenRegion({ ubigeo }: { ubigeo: string }) {
  const d = useAutoridades();
  if (d === undefined) return <IndicadoresSkeleton n={4} />;
  if (d === null) return null;
  const hoy = d[2022];
  const gob = hoy?.regional.find((g) => g.u === ubigeo);
  const prov = hoy?.provincial.filter((p) => p.u.startsWith(ubigeo)) ?? [];
  const dist = hoy?.distrital.filter((x) => x.u.startsWith(ubigeo)) ?? [];
  const orgs = new Set([gob?.o, ...prov.map((p) => p.o), ...dist.map((x) => x.o)].filter((x): x is number => x != null));
  const partido = nombreOrg(hoy, gob?.o);
  const items: Indicador[] = [
    { valor: partido, etiqueta: "gobierna la región", contexto: gob ? `${gob.g}, ${mandato(2022)}` : undefined, href: partido ? `/app/partidos/${claveOrg(partido)}?anio=2022` : undefined },
    { valor: numero(prov.length), etiqueta: "provincias", contexto: "con su alcalde provincial", href: "?seccion=territorio" },
    { valor: numero(dist.length), etiqueta: "distritos", contexto: "con su alcalde distrital", href: "?seccion=territorio" },
    { valor: numero(orgs.size), etiqueta: "organizaciones que gobiernan", contexto: "la región, sus provincias o distritos", href: "?seccion=gobiernos" },
  ];
  return <Indicadores items={items} />;
}

export function HistoriaGobiernos({ ubigeo, nombre }: { ubigeo: string; nombre: string }) {
  const d = useAutoridades();
  const porPartido = useMemo(() => {
    if (!d) return [];
    const m = new Map<string, { nombre: string; por: Partial<Record<Anio, { prov: number; dist: number; region: boolean }>> }>();
    for (const a of ANIOS) {
      const x = d[a];
      if (!x) continue;
      const sumar = (o: number, k: "prov" | "dist" | "region") => {
        const n = orgDe(x, o).n;
        const c = claveOrg(n);
        const e = m.get(c) ?? { nombre: n, por: {} };
        const v = e.por[a] ?? { prov: 0, dist: 0, region: false };
        if (k === "region") v.region = true;
        else v[k]++;
        e.por[a] = v;
        m.set(c, e);
      };
      for (const g of x.regional) if (g.u === ubigeo) sumar(g.o, "region");
      for (const p of x.provincial) if (p.u.startsWith(ubigeo)) sumar(p.o, "prov");
      for (const t of x.distrital) if (t.u.startsWith(ubigeo)) sumar(t.o, "dist");
    }
    const peso = (e: { por: Partial<Record<Anio, { prov: number; dist: number; region: boolean }>> }) =>
      ANIOS.reduce((s, a, i) => s + ((e.por[a]?.prov ?? 0) + (e.por[a]?.dist ?? 0) + (e.por[a]?.region ? 50 : 0)) * (3 - i) * 1000, 0);
    return [...m.entries()].map(([clave, e]) => ({ clave, ...e })).sort((a, b) => peso(b) - peso(a));
  }, [d, ubigeo]);

  if (d === undefined) return <TablaSkeleton columnas={COLS_GOB} filas={3} />;
  if (d === null) return <EstadoVacio>No pudimos leer los resultados del JNE. Vuelve a intentarlo en un momento.</EstadoVacio>;

  const filasGob: Fila[] = ANIOS.filter((a) => d[a]).map((a) => {
    const x = d[a]!;
    const g = x.regional.find((r) => r.u === ubigeo);
    const o = g ? orgDe(x, g.o) : null;
    return {
      id: String(a),
      celdas: {
        mandato: <span className="font-mono text-[13px] tabular-nums text-inkSoft">{mandato(a)}</span>,
        gobernador: <CeldaPrincipal titulo={g?.g ?? "Sin dato"} meta={[<Dato key="c" tipo="cargo">{cargoRegional(a)}</Dato>]} />,
        partido: o ? (
          <Link href={`/app/partidos/${claveOrg(o.n)}?anio=${a}`} className="text-[13.5px] font-medium text-ink underline-offset-2 hover:text-granate hover:underline">{o.n}</Link>
        ) : <span className="text-[13px] text-mute">Sin dato</span>,
        votos: <CeldaNumero>{pct(g?.p) ?? "Sin dato"}</CeldaNumero>,
      },
    };
  });

  const celda = (v: { prov: number; dist: number; region: boolean } | undefined) =>
    !v ? <span className="text-[12.5px] text-mute">Ninguno</span> : (
      <span className="block text-right text-[12.5px] leading-snug text-inkSoft">
        {v.region && <span className="block font-semibold text-ink">La región</span>}
        {v.prov > 0 && <span className="block">{numero(v.prov)} {v.prov === 1 ? "provincia" : "provincias"}</span>}
        {v.dist > 0 && <span className="block">{numero(v.dist)} {v.dist === 1 ? "distrito" : "distritos"}</span>}
      </span>
    );
  const filasPartidos: Fila[] = porPartido.map((e) => ({
    id: e.clave,
    href: `/app/partidos/${e.clave}?anio=2022`,
    buscable: e.nombre,
    celdas: {
      partido: <CeldaPrincipal titulo={e.nombre} />,
      p2022: celda(e.por[2022]),
      p2018: celda(e.por[2018]),
      p2014: celda(e.por[2014]),
    },
  }));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-display text-[16px] font-bold text-ink">Quién gobernó {nombre}</h3>
        <Tabla columnas={COLS_GOB} filas={filasGob} etiqueta={`Gobernadores de ${nombre}`} />
        <p className="text-[12px] text-mute">Fuente: JNE, resultados de las elecciones regionales y municipales. Las de 2026 aún no tienen resultados.</p>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-[16px] font-bold text-ink">Qué partidos gobernaron sus provincias y distritos</h3>
        <p className="text-[13px] text-inkSoft">Cada organización con lo que ganó en cada período: la región, cuántas provincias y cuántos distritos.</p>
        <TablaPaginada
          columnas={COLS_PARTIDOS}
          filas={filasPartidos}
          etiqueta={`Partidos que gobernaron en ${nombre}`}
          nombre="partidos"
          tam={15}
          buscar={{ placeholder: "Buscar un partido o movimiento…", etiqueta: `Buscar en los partidos de ${nombre}` }}
        />
      </section>
    </div>
  );
}

const COLS_GOB: Columna[] = [
  { clave: "mandato", titulo: "Mandato", ancho: "104px" },
  { clave: "gobernador", titulo: "Gobernador o gobernadora", ancho: "minmax(0,1.1fr)" },
  { clave: "partido", titulo: "Partido u organización", ancho: "minmax(0,1.2fr)", desde: "md" },
  { clave: "votos", titulo: "Votos", ancho: "76px", alinear: "der", desde: "lg" },
];

const COLS_PARTIDOS: Columna[] = [
  { clave: "partido", titulo: "Partido u organización", ancho: "minmax(0,1.4fr)" },
  { clave: "p2022", titulo: "2023 a 2026", ancho: "112px", alinear: "der" },
  { clave: "p2018", titulo: "2019 a 2022", ancho: "112px", alinear: "der", desde: "md" },
  { clave: "p2014", titulo: "2015 a 2018", ancho: "112px", alinear: "der", desde: "md" },
];

/** Provincias y distritos de la región con su alcalde y su partido en cada período. */
export function TerritorioRegion({ ubigeo, nombre, buscar }: { ubigeo: string; nombre: string; buscar?: string }) {
  const d = useAutoridades();
  if (d === undefined) return <TablaSkeleton columnas={COLS_LUGAR} filas={6} />;
  if (d === null) return <EstadoVacio>No pudimos leer los resultados del JNE. Vuelve a intentarlo en un momento.</EstadoVacio>;

  const ganador = (a: Anio, nivel: "provincial" | "distrital", clave: string) => {
    const x = d[a];
    if (!x) return null;
    const lista = nivel === "provincial" ? x.provincial.filter((p) => p.u === clave) : x.distrital.filter((t) => `${t.u}|${t.n}` === clave);
    const g = lista[0];
    return g ? { alcalde: g.a, partido: orgDe(x, g.o).n } : null;
  };
  const celda = (g: { alcalde: string; partido: string } | null, conNombre: boolean) =>
    !g ? <span className="text-[12.5px] text-mute">Sin dato</span> : (
      <span className="block min-w-0">
        {conNombre && <span className="block truncate text-[13.5px] font-medium text-ink" title={g.alcalde}>{g.alcalde}</span>}
        <span className="block truncate text-[12.5px] text-inkSoft" title={g.partido}>
          <Dato tipo="partido">{g.partido}</Dato>
        </span>
      </span>
    );

  const base = d[2022] ?? d[2018] ?? d[2014]!;
  const provincias = base.provincial.filter((p) => p.u.startsWith(ubigeo)).sort((a, b) => a.n.localeCompare(b.n, "es"));
  const distritos = base.distrital.filter((t) => t.u.startsWith(ubigeo)).sort((a, b) => a.pv.localeCompare(b.pv, "es") || a.n.localeCompare(b.n, "es"));

  const filasProv: Fila[] = provincias.map((p) => {
    const g = [ganador(2022, "provincial", p.u), ganador(2018, "provincial", p.u), ganador(2014, "provincial", p.u)];
    return {
      id: p.u,
      href: `/app/mapa?ubigeo=${p.u}`,
      buscable: [p.n, ...g.flatMap((x) => (x ? [x.alcalde, x.partido] : []))].join(" "),
      celdas: {
        lugar: <CeldaPrincipal titulo={p.n} meta={[<Dato key="d" tipo="personas" nombre="Distritos">{numero(distritos.filter((t) => t.u === p.u).length)} distritos</Dato>]} />,
        p2022: celda(g[0], true),
        p2018: celda(g[1], false),
        p2014: celda(g[2], false),
      },
    };
  });
  const filasDist: Fila[] = distritos.map((t, i) => {
    const k = `${t.u}|${t.n}`;
    const g = [ganador(2022, "distrital", k), ganador(2018, "distrital", k), ganador(2014, "distrital", k)];
    return {
      id: `${k}-${i}`,
      buscable: [t.n, t.pv, ...g.flatMap((x) => (x ? [x.alcalde, x.partido] : []))].join(" "),
      celdas: {
        lugar: <CeldaPrincipal titulo={t.n} meta={[<Dato key="p" tipo="lugar" nombre="Provincia">{t.pv}</Dato>]} />,
        p2022: celda(g[0], true),
        p2018: celda(g[1], false),
        p2014: celda(g[2], false),
      },
    };
  });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-display text-[16px] font-bold text-ink">Sus {numero(provincias.length)} provincias</h3>
        <TablaPaginada
          columnas={COLS_LUGAR}
          filas={filasProv}
          etiqueta={`Provincias de ${nombre}`}
          nombre="provincias"
          tam={15}
          buscar={{ placeholder: "Buscar una provincia, un alcalde o un partido…", etiqueta: `Buscar en las provincias de ${nombre}`, inicial: buscar }}
        />
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-[16px] font-bold text-ink">Sus {numero(distritos.length)} distritos</h3>
        <TablaPaginada
          columnas={COLS_LUGAR}
          filas={filasDist}
          etiqueta={`Distritos de ${nombre}`}
          nombre="distritos"
          tam={20}
          buscar={{ placeholder: "Buscar un distrito, una provincia, un alcalde o un partido…", etiqueta: `Buscar en los distritos de ${nombre}`, inicial: buscar }}
        />
      </section>
      <p className="text-[12px] text-mute">Fuente: JNE, resultados de las elecciones municipales de 2014, 2018 y 2022 (mandatos 2015 a 2026).</p>
    </div>
  );
}

const COLS_LUGAR: Columna[] = [
  { clave: "lugar", titulo: "Lugar", ancho: "minmax(0,1fr)" },
  { clave: "p2022", titulo: "2023 a 2026", ancho: "minmax(0,1.2fr)" },
  { clave: "p2018", titulo: "2019 a 2022", ancho: "minmax(0,1fr)", desde: "lg" },
  { clave: "p2014", titulo: "2015 a 2018", ancho: "minmax(0,1fr)", desde: "xl" },
];
