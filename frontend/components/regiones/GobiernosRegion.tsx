"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { CeldaNumero, CeldaPrincipal, Tabla, TablaPaginada, TablaSkeleton, type Columna, type Fila } from "@/components/listado";
import { Ayuda } from "@/components/patrones/Ayuda";
import { DatosClave } from "@/components/patrones/Detalle";
import { EnlaceFuente } from "@/components/patrones/Estructura";
import { BarraPartes, type ParteBarra } from "@/components/inicio/BarraPartes";
import { CajaResumen } from "@/components/inicio/ResumenFicha";
import { Skeleton } from "@/components/ui/Skeleton";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { Dato } from "@/components/ui/Dato";
import { numero, plural } from "@/lib/formato";
import { INFOGOB_JNE } from "@/lib/fuentes";
import { cargoRegional, claveOrg, orgDe, pct, type Anio, type AutoridadesDatos } from "@/lib/partidos";
import { ANIOS, mandato, useAutoridades } from "./autoridades";

/**
 * Los gobiernos de una región en las tres elecciones cargadas (2014, 2018 y 2022: mandatos 2015-2018, 2019-2022 y
 * 2023-2026), de los archivos del JNE que ya usa /app/partidos (`public/data/autoridades-<año>.json`):
 *   · `QuienGobiernaRegion`: la caja «Quién la gobierna» del Inicio: su gobernador, su partido, su mandato, y qué
 *     partidos gobiernan sus provincias y distritos, en una barra.
 *   · `HistoriaGobiernos`: sus gobernadores período por período y qué partidos ganaron sus provincias y distritos.
 * Las provincias y los distritos, con sus alcaldes, van en el árbol de `ArbolTerritorio.tsx`.
 * Pedido del usuario (2026-10-22): «clickeamos la región y vemos su historial, cuántos distritos tiene, quiénes
 * gobernaron, casos de corrupción». Cliente: los tres archivos se bajan una vez y los comparten las tres piezas.
 */

const nombreOrg = (d: AutoridadesDatos | undefined, o: number | undefined) => (d && o != null ? orgDe(d, o).n : null);

/** Las series de los gráficos para los partidos de la barra (clases enteras: Tailwind no ve las armadas). */
const SERIE = ["bg-[rgb(var(--serie-1))]", "bg-[rgb(var(--serie-2))]", "bg-[rgb(var(--serie-3))]", "bg-[rgb(var(--serie-4))]"] as const;

/**
 * «Quién la gobierna» en el Inicio de la región: el gobernador (es una autoridad: nombre completo), su partido (a su
 * ficha), el mandato y los votos, y sus provincias y distritos repartidos por el partido que los gobierna, en una barra
 * con su leyenda (los cuatro que más gobiernan y «Otros»), cada uno con su ficha. Antes eran cuatro cifras sueltas arriba
 * de todas las pestañas («6 organizaciones que gobiernan»), sin decir cuáles.
 */
export function QuienGobiernaRegion({ ubigeo, ruta }: { ubigeo: string; ruta: string }) {
  const d = useAutoridades();
  const ayuda = (
    <Ayuda titulo="¿De dónde sale?">
      Del <EnlaceFuente href={INFOGOB_JNE}>JNE</EnlaceFuente>: quién ganó las elecciones regionales y municipales de 2022 (mandato
      2023 a 2026). Una vacancia o un reemplazo dentro del período no está registrado.
    </Ayuda>
  );
  const caja = (contenido: ReactNode) => (
    <CajaResumen titulo="Quién la gobierna" ayuda={ayuda} enlace={{ href: `${ruta}?seccion=gobiernos`, texto: "Sus gobiernos" }}>
      {contenido}
    </CajaResumen>
  );
  if (d === undefined) {
    return caja(
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-2.5 w-full rounded-full" />
      </div>,
    );
  }
  const hoy = d?.[2022];
  if (!hoy) return caja(<VacioEnLinea>No pudimos leer los resultados del JNE. Vuelve a intentarlo en un momento.</VacioEnLinea>);
  const gob = hoy.regional.find((g) => g.u === ubigeo);
  const partido = gob ? orgDe(hoy, gob.o).n : null;
  const munis = [...hoy.provincial.filter((p) => p.u.startsWith(ubigeo)), ...hoy.distrital.filter((x) => x.u.startsWith(ubigeo))];
  const nProv = hoy.provincial.filter((p) => p.u.startsWith(ubigeo)).length;
  const nDist = munis.length - nProv;
  const porOrg = new Map<string, { nombre: string; n: number }>();
  for (const m of munis) {
    const n = orgDe(hoy, m.o).n;
    const e = porOrg.get(claveOrg(n)) ?? { nombre: n, n: 0 };
    e.n += 1;
    porOrg.set(claveOrg(n), e);
  }
  const orden = [...porOrg.entries()].sort((a, b) => b[1].n - a[1].n);
  const otros = orden.slice(4).reduce((s, [, e]) => s + e.n, 0);
  const partes: ParteBarra[] = [
    // recorte: los cuatro que más gobiernan; los demás, sumados en «Otros» y todos en la pestaña Gobiernos («Sus gobiernos»)
    ...orden.slice(0, 4).map(([clave, e], i) => ({ clave, etiqueta: e.nombre, n: e.n, href: `/app/partidos/${clave}?anio=2022`, clase: SERIE[i] })),
    ...(otros ? [{ clave: "otros", etiqueta: orden.length - 4 === 1 ? "Otro partido" : `Otros ${orden.length - 4} partidos`, n: otros, clase: "bg-[rgb(var(--serie-otros))]", href: `${ruta}?seccion=gobiernos` }] : []),
  ];
  return caja(
    <DatosClave
      items={[
        { etiqueta: cargoRegional(2022), valor: gob?.g ?? null },
        {
          etiqueta: "Partido",
          valor: partido ? (
            <Link href={`/app/partidos/${claveOrg(partido)}?anio=2022`} prefetch={false} className="font-semibold text-granate underline-offset-2 hover:underline">
              {partido}
            </Link>
          ) : null,
        },
        { etiqueta: "Mandato", valor: `${mandato(2022)}${pct(gob?.p) ? `, con el ${pct(gob?.p)} de los votos` : ""}` },
        {
          etiqueta: `Sus ${plural(nProv, "provincia", "provincias")} y ${plural(nDist, "distrito", "distritos")}`,
          valor: partes.length ? <BarraPartes leyenda="en-linea" etiqueta={`Municipalidades de la región por partido que las gobierna`} partes={partes} className="pt-1" /> : null,
        },
      ]}
    />,
  );
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
  if (d === null) return <VacioEnLinea>No pudimos leer los resultados del JNE. Vuelve a intentarlo en un momento.</VacioEnLinea>;

  // La fila es UNA acción: abre la ficha del partido en ese período (antes el partido era un enlace dentro de la celda y,
  // en el celular, su columna no se veía: justo el tema de la pestaña).
  const filasGob: Fila[] = ANIOS.filter((a) => d[a]).map((a) => {
    const x = d[a]!;
    const g = x.regional.find((r) => r.u === ubigeo);
    const o = g ? orgDe(x, g.o) : null;
    return {
      id: String(a),
      href: o ? `/app/partidos/${claveOrg(o.n)}?anio=${a}` : undefined,
      celdas: {
        mandato: <span className="font-mono text-meta tabular-nums text-inkSoft">{mandato(a)}</span>,
        gobernador: <CeldaPrincipal titulo={g?.g ?? "Sin dato"} meta={[<Dato key="c" tipo="cargo">{cargoRegional(a)}</Dato>]} />,
        partido: o ? <span className="text-dato font-medium text-ink">{o.n}</span> : undefined,
        votos: pct(g?.p) ? <CeldaNumero>{pct(g?.p)}</CeldaNumero> : undefined,
      },
    };
  });

  const celda = (v: { prov: number; dist: number; region: boolean } | undefined) =>
    !v ? <span className="text-meta text-mute">Ninguno</span> : (
      <span className="block text-right text-meta leading-snug text-inkSoft">
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
        <h3 className="font-display text-bloque font-bold text-ink">Quién gobernó {nombre}</h3>
        <Tabla columnas={COLS_GOB} filas={filasGob} etiqueta={`Gobernadores de ${nombre}`} />
      </section>
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <h3 className="font-display text-bloque font-bold text-ink">Qué partidos gobernaron sus provincias y distritos</h3>
          <Ayuda titulo="¿Qué cuenta cada columna?">
            Lo que ganó cada organización en cada período: la región, cuántas provincias y cuántos distritos. La fila abre su
            ficha con los contratos de sus gobiernos.
          </Ayuda>
        </div>
        <TablaPaginada
          columnas={COLS_PARTIDOS}
          filas={filasPartidos}
          etiqueta={`Partidos que gobernaron en ${nombre}`}
          nombre="partidos"
          tam={15}
          buscar={{ placeholder: "Buscar un partido o movimiento…", etiqueta: `Buscar en los partidos de ${nombre}` }}
        />
      </section>
      <p className="text-rotulo text-mute">
        Fuente: <EnlaceFuente href={INFOGOB_JNE}>JNE</EnlaceFuente>, resultados de las elecciones regionales y municipales de 2014, 2018 y 2022. Las de
        2026 aún no tienen resultados.
      </p>
    </div>
  );
}

// En el celular el mandato, el partido y los votos van bajo el gobernador, con su rótulo: el partido es el tema de la
// pestaña (antes, en el celular, su columna no se veía).
const COLS_GOB: Columna[] = [
  { clave: "mandato", titulo: "Mandato", ancho: "104px", desde: "md", apilar: "con-rotulo" },
  { clave: "gobernador", titulo: "Gobernador o gobernadora", ancho: "minmax(0,1.1fr)" },
  { clave: "partido", titulo: "Partido u organización", corto: "Partido", ancho: "minmax(0,1.2fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "votos", titulo: "Votos", ancho: "76px", alinear: "der", desde: "lg", apilar: "con-rotulo" },
];

const COLS_PARTIDOS: Columna[] = [
  { clave: "partido", titulo: "Partido u organización", ancho: "minmax(0,1.4fr)" },
  { clave: "p2022", titulo: "2023 a 2026", ancho: "112px", alinear: "der" },
  { clave: "p2018", titulo: "2019 a 2022", ancho: "112px", alinear: "der", desde: "md" },
  { clave: "p2014", titulo: "2015 a 2018", ancho: "112px", alinear: "der", desde: "md" },
];
