"use client";

import { useCallback, useMemo, useState } from "react";
import { CabeceraPestana } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, type Columna } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { ArbolTabla, type NodoArbol } from "@/components/grafo/ArbolTabla";
import { BarraArbol } from "@/components/grafo/BarraArbol";
import { detalleEntidad, type EntidadPoderLigera } from "@/components/grafo/DetalleEntidad";
import { AyudaIndicios, CeldaTasa, ChipsIndicio } from "@/components/grafo/indicios";
import { BotonCerrar, ChipLeyenda, GrafoMarco, MigaSep, Nodo, NodoCentro, Arista, type Tono } from "@/components/grafo/primitivos";
import { EstadoCarga, SelectorVista, TablaORed, letraEnUnidades, useAncho, usePoder } from "@/components/grafo/vista";
import { coincide, numero, paraBuscar, plural, solesCompacto } from "@/lib/formato";
import { VB, C, rad, corto, anguloEnAnillo, anchorDeCos, nivelTxt, nombreSinTipo, sumarConteos, type ConteosCaptura } from "@/lib/grafo";
import { tituloNatural } from "@/lib/landing";
import type { TerritorioNodo } from "@/lib/poder";

/**
 * El Estado por territorio (/app/poder, pestaña «Territorio»; migración 125): región → provincia → distrito, como
 * tabla plegable. Cada región y cada provincia es una fila con sus totales (cuántas de sus entidades tienen contratos
 * con indicio, cuántos contratos, el monto y los indicios con su conteo) que se abre en el lugar; cada gobierno regional
 * o municipalidad abre su panel. Antes era un radial con letra de 4 a 6 px; la red sigue a un clic («Ver como red»),
 * sólo desde lg y con letra de 12 px. Los municipios son autónomos, pero están anidados en su territorio.
 */

type NodoT = TerritorioNodo & ConteosCaptura;

const COLUMNAS: Columna[] = [
  { clave: "lugar", titulo: "Lugar o entidad", ancho: "minmax(0,1.6fr)" },
  {
    clave: "tasa",
    titulo: "Entidades con indicio",
    ancho: "minmax(8.5rem,0.7fr)",
    desde: "md",
    apilar: true,
  },
  { clave: "contratos", titulo: "Contratos con indicio", ancho: "8.5rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Contratos" },
  { clave: "monto", titulo: "Monto", ancho: "7rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
  { clave: "indicios", titulo: "Indicios, en contratos", ancho: "minmax(0,1fr)", desde: "xl", ayuda: <AyudaIndicios /> },
];

const ORDENES = [
  { valor: "contratos", etiqueta: "Más contratos con indicio" },
  { valor: "nombre", etiqueta: "Nombre, de la A a la Z" },
];

interface Provincia { nombre: string; mp: NodoT | null; distritos: NodoT[] }
interface Region { dep: string; gr: NodoT | null; provincias: Provincia[] }

/** La lista plana de la API → departamentos con su gobierno regional y sus provincias (con su municipalidad y distritos). */
function armar(nodos: NodoT[]): Region[] {
  const deps = new Map<string, { gr: NodoT | null; provs: Map<string, Provincia> }>();
  const dep = (d: string) => {
    let x = deps.get(d);
    if (!x) deps.set(d, (x = { gr: null, provs: new Map() }));
    return x;
  };
  const prov = (d: string, p: string) => {
    const m = dep(d).provs;
    let x = m.get(p);
    if (!x) m.set(p, (x = { nombre: p, mp: null, distritos: [] }));
    return x;
  };
  for (const n of nodos) {
    if (!n.departamento) continue;
    if (n.nivel === "regional") dep(n.departamento).gr = n;
    else if (n.nivel === "provincial") prov(n.departamento, n.provincia ?? n.nombre).mp = n;
    else prov(n.departamento, n.provincia ?? "Sin provincia").distritos.push(n);
  }
  return [...deps.entries()].map(([d, x]) => ({ dep: d, gr: x.gr, provincias: [...x.provs.values()] }));
}

const entidadesDe = (r: Region) => [...(r.gr ? [r.gr] : []), ...r.provincias.flatMap((p) => [...(p.mp ? [p.mp] : []), ...p.distritos])];
const entidadesDeProv = (p: Provincia) => [...(p.mp ? [p.mp] : []), ...p.distritos];

const ligera = (n: NodoT): EntidadPoderLigera => ({
  ruc: n.ruc,
  nombre: n.nombre,
  nivel: n.nivel,
  departamento: n.departamento,
  provincia: n.provincia,
  distrito: n.distrito,
  partido: n.partido,
  autoridad: n.autoridad,
  n_captura: n.n_captura ?? 0,
  monto_captura: n.monto_captura ?? 0,
  n_financiaron: n.n_financiaron,
  n_vendieron: n.n_vendieron,
  n_socio: n.n_socio,
});

const textoDe = (n: NodoT) => paraBuscar([n.nombre, n.autoridad, n.partido, n.distrito, n.provincia, n.departamento].filter(Boolean).join(" "));
const conIndicio = (n: NodoT) => (n.n_captura ?? 0) > 0;

export function ExploradorTerritorio() {
  const carga = usePoder<{ nodos: NodoT[] }>("/poder/territorio");
  const [red, setRed] = useState(false);
  return (
    <div className="space-y-4">
      <CabeceraPestana acciones={<SelectorVista red={red} onCambio={setRed} />}>
        Cada región, con sus provincias y distritos: cuántas de sus entidades tienen contratos con indicio y quién gobierna cada una.
      </CabeceraPestana>
      <EstadoCarga carga={carga} columnas={COLUMNAS}>
        {(d) => <Territorio nodos={d.nodos ?? []} red={red} />}
      </EstadoCarga>
    </div>
  );
}

/** Una región o provincia ya armada, con sus totales (de TODAS sus entidades: un filtro esconde filas, no cambia cifras). */
interface ProvinciaT { p: Provincia; tot: ReturnType<typeof sumarConteos> }

function Territorio({ nodos, red }: { nodos: NodoT[]; red: boolean }) {
  // Lo caro una sola vez: el árbol, sus totales y el texto en que busca cada entidad.
  const base = useMemo(() => {
    const texto = new Map(nodos.map((n) => [n.ruc, textoDe(n)]));
    return armar(nodos).map((r) => ({
      r,
      tot: sumarConteos(entidadesDe(r)),
      provincias: r.provincias.map((p): ProvinciaT => ({ p, tot: sumarConteos(entidadesDeProv(p)) })),
      texto,
    }));
  }, [nodos]);
  const [consulta, setConsulta] = useState("");
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [orden, setOrden] = useState("contratos");
  const onConsulta = useCallback((v: string) => setConsulta(v), []);
  const q = paraBuscar(consulta);
  const indicio = elegidos.indicio;

  const { arbol, coinciden } = useMemo(() => {
    const porIndicio = (n: NodoT) => !indicio || (indicio === "con" ? conIndicio(n) : !conIndicio(n));
    const porNombre = (a: string, b: string) => a.localeCompare(b, "es");
    const porOrden = (a: NodoT, b: NodoT) => (orden === "nombre" ? 0 : (b.n_captura ?? 0) - (a.n_captura ?? 0)) || porNombre(a.nombre, b.nombre);
    let n = 0;
    const out: NodoArbol[] = [];
    const regiones = [...base].sort((a, b) => (orden === "nombre" ? 0 : b.tot.n_captura - a.tot.n_captura) || porNombre(a.r.dep, b.r.dep));
    for (const { r, tot, provincias, texto } of regiones) {
      // Si el nombre de la región (o de la provincia) coincide, va entera; si no, sólo las entidades que coinciden.
      const todaR = !!q && coincide(paraBuscar(r.dep), q);
      const pasa = (x: NodoT, toda: boolean) => porIndicio(x) && (!q || toda || coincide(texto.get(x.ruc) ?? "", q));
      const hojas: NodoArbol[] = [];
      if (r.gr && pasa(r.gr, todaR)) hojas.push(hoja(r.gr));
      const provs = [...provincias].sort((a, b) => (orden === "nombre" ? 0 : b.tot.n_captura - a.tot.n_captura) || porNombre(a.p.nombre, b.p.nombre));
      for (const { p, tot: tp } of provs) {
        const todaP = todaR || (!!q && coincide(paraBuscar(p.nombre), q));
        const hijos = [...(p.mp && pasa(p.mp, todaP) ? [p.mp] : []), ...p.distritos.filter((x) => pasa(x, todaP)).sort(porOrden)].map(hoja);
        if (!hijos.length) continue;
        n += hijos.length;
        hojas.push({ id: `p:${r.dep}|${p.nombre}`, celdas: celdasRama(tituloNatural(p.nombre), tp, plural(tp.total, "entidad", "entidades")), hijos });
      }
      if (r.gr && hojas[0]?.id === r.gr.ruc) n += 1;
      if (!hojas.length) continue;
      out.push({
        id: `r:${r.dep}`,
        celdas: celdasRama(tituloNatural(r.dep), tot, `${plural(r.provincias.length, "provincia", "provincias")}, ${plural(tot.total, "entidad", "entidades")}`),
        hijos: hojas,
      });
    }
    return { arbol: out, coinciden: n };
  }, [base, q, indicio, orden]);

  const filtrando = !!q || !!indicio;
  const tabla = (
    <div className="space-y-3">
      <BarraArbol
        buscar={{ placeholder: "Buscar un lugar, entidad, autoridad o partido…", etiqueta: "Buscar en el territorio" }}
        consulta={consulta}
        onConsulta={onConsulta}
        filtros={[
          {
            clave: "indicio",
            etiqueta: "Con o sin contratos con indicio",
            todas: "Todas las entidades",
            opciones: [
              { valor: "con", etiqueta: "Con contratos con indicio", n: nodos.filter(conIndicio).length },
              { valor: "sin", etiqueta: "Sin contratos con indicio", n: nodos.filter((x) => !conIndicio(x)).length },
            ],
          },
        ]}
        elegidos={elegidos}
        onElegir={(k, v) => setElegidos((e) => ({ ...e, [k]: v }))}
        orden={{ valor: orden, opciones: ORDENES, onCambio: setOrden }}
        resultado={`${numero(coinciden)} de ${numero(nodos.length)} entidades`}
        onQuitar={() => {
          setConsulta("");
          setElegidos({});
        }}
      />
      {arbol.length === 0 ? (
        <p className="py-1.5 text-dato text-mute" role="status">
          Ninguna entidad coincide con la búsqueda o los filtros.
        </p>
      ) : (
        <ArbolTabla key={filtrando ? "filtrado" : "todo"} columnas={COLUMNAS} nodos={arbol} etiqueta="El Estado por territorio" todoAbierto={filtrando && coinciden <= 400} />
      )}
    </div>
  );
  return <TablaORed red={red} tabla={tabla} grafo={<RedTerritorio nodos={nodos} />} />;
}

function celdasRama(titulo: string, t: ReturnType<typeof sumarConteos>, meta: string) {
  return {
    lugar: <CeldaPrincipal titulo={titulo} meta={[<Dato key="e" tipo="entidad">{meta}</Dato>]} />,
    tasa: <CeldaTasa con={t.conIndicio} de={t.total} />,
    contratos: <CeldaNumero>{numero(t.n_captura)}</CeldaNumero>,
    monto: <CeldaNumero>{t.n_captura > 0 ? solesCompacto(t.monto_captura) : <span className="font-sans text-mute">Ninguno</span>}</CeldaNumero>,
    indicios: t.desglose ? <ChipsIndicio x={t} /> : undefined,
  };
}

function hoja(n: NodoT): NodoArbol {
  const nombre = tituloNatural(n.nombre);
  return {
    id: n.ruc,
    celdas: {
      lugar: (
        <CeldaPrincipal
          titulo={nombre}
          meta={[
            n.partido && <Dato key="p" tipo="partido">{tituloNatural(n.partido)}</Dato>,
            // Autoridad electa: se muestra completa (docs/PRIVACIDAD.md).
            n.autoridad && <Dato key="a" tipo="cargo" nombre="Autoridad">{tituloNatural(n.autoridad)}</Dato>,
          ]}
        />
      ),
      contratos: <CeldaNumero>{(n.n_captura ?? 0) > 0 ? numero(n.n_captura) : <span className="font-sans text-mute">0</span>}</CeldaNumero>,
      monto: (n.n_captura ?? 0) > 0 ? <CeldaNumero>{solesCompacto(n.monto_captura)}</CeldaNumero> : undefined,
      indicios: <ChipsIndicio x={n} />,
    },
    detalle: detalleEntidad(ligera(n)),
  };
}

// ─── La red (sólo desde lg) ──────────────────────────────────────────────────

const fuerte = (n: TerritorioNodo) => (n.n_captura ?? 0) > 0;
const tonoDe = (n: TerritorioNodo): Tono => (fuerte(n) ? "crimson" : "granate");

const R1 = 215; // regiones desde el centro
const PR = 155; // provincias desde su región
const DR = 108; // distritos desde su provincia
/** Letra de la red en pantalla (px): el piso de la auditoría es 12. */
const LETRA = 12.5;

type Nivel = "regional" | "provincial" | "distrital";
type P = { n: NodoT; x: number; y: number; r: number; ang: number; label: string; nivel: Nivel };

/**
 * El radial de antes, como ayuda para ver la forma: el Estado al centro y las 25 regiones; al abrir una región, sus
 * provincias alrededor (y el zoom va hasta ahí); al abrir una provincia, sus distritos. Rojo con halo = con indicio
 * (color, halo y la palabra en la leyenda). La entidad elegida se ve debajo, con el mismo detalle que el panel.
 */
function RedTerritorio({ nodos }: { nodos: NodoT[] }) {
  const [regAbierta, setRegAbierta] = useState<string | null>(null);
  const [provAbierta, setProvAbierta] = useState<string | null>(null);
  const [sel, setSel] = useState<NodoT | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [marco, ancho] = useAncho<HTMLDivElement>();
  const letra = letraEnUnidades(LETRA, ancho, VB);

  const regiones = useMemo(() => nodos.filter((n) => n.nivel === "regional").sort((a, b) => a.departamento.localeCompare(b.departamento, "es")), [nodos]);

  const { nodosPos, edges, foco } = useMemo(() => {
    const provsDe = (d: string) => nodos.filter((n) => n.nivel === "provincial" && n.departamento === d).sort((a, b) => (b.n_captura ?? 0) - (a.n_captura ?? 0));
    const distsDe = (d: string, p: string) => nodos.filter((n) => n.nivel === "distrital" && n.departamento === d && n.provincia === p).sort((a, b) => (b.n_captura ?? 0) - (a.n_captura ?? 0));
    const N = regiones.length || 1;
    const pos: P[] = [];
    const edges: { abierta: boolean; x1: number; y1: number; bx: number; by: number; fuerte: boolean }[] = [];
    const F: { reg: P | null; prov: P | null } = { reg: null, prov: null };

    regiones.forEach((rn, i) => {
      const ang = anguloEnAnillo(i, N);
      const rp: P = { n: rn, x: C + R1 * Math.cos(rad(ang)), y: C + R1 * Math.sin(rad(ang)), r: 9, ang, label: tituloNatural(rn.departamento), nivel: "regional" };
      pos.push(rp);
      edges.push({ abierta: false, x1: C, y1: C, bx: rp.x, by: rp.y, fuerte: fuerte(rn) });
      if (rn.departamento !== regAbierta) return;
      F.reg = rp;
      const provs = provsDe(rn.departamento);
      const K = provs.length;
      const spread = Math.min(14, 130 / Math.max(K - 1, 1));
      provs.forEach((pn, k) => {
        const pa = ang + (k - (K - 1) / 2) * spread;
        const pp: P = { n: pn, x: rp.x + PR * Math.cos(rad(pa)), y: rp.y + PR * Math.sin(rad(pa)), r: 6, ang: pa, label: tituloNatural(pn.provincia ?? ""), nivel: "provincial" };
        pos.push(pp);
        edges.push({ abierta: true, x1: rp.x, y1: rp.y, bx: pp.x, by: pp.y, fuerte: fuerte(pn) });
        if (pn.provincia !== provAbierta) return;
        F.prov = pp;
        const dists = distsDe(rn.departamento, pn.provincia ?? "");
        const M = dists.length;
        const phi = Math.atan2(pp.y - rp.y, pp.x - rp.x) * (180 / Math.PI);
        // Con muchos distritos el abanico se abre casi en círculo: con letra legible, 150° no alcanzaban.
        const spreadD = Math.min(12, (M > 20 ? 290 : 150) / Math.max(M - 1, 1));
        dists.forEach((dn, m) => {
          const da = phi + (m - (M - 1) / 2) * spreadD;
          const dp: P = { n: dn, x: pp.x + DR * Math.cos(rad(da)), y: pp.y + DR * Math.sin(rad(da)), r: 4.5, ang: da, label: nombreSinTipo(dn.nombre), nivel: "distrital" };
          pos.push(dp);
          edges.push({ abierta: true, x1: pp.x, y1: pp.y, bx: dp.x, by: dp.y, fuerte: fuerte(dn) });
        });
      });
    });

    let k = 1, tx = 0, ty = 0;
    const target = F.prov ?? F.reg;
    if (target) {
      const out = rad(target.ang);
      const push = F.prov ? 60 : 82;
      k = F.prov ? 2.6 : 2.0;
      tx = C - (target.x + push * Math.cos(out)) * k;
      ty = C - (target.y + push * Math.sin(out)) * k;
    }
    return { nodosPos: pos, edges, foco: { k, tx, ty } };
  }, [nodos, regiones, regAbierta, provAbierta]);

  function abrir(p: P) {
    setSel(p.n);
    if (p.nivel === "regional") { setRegAbierta(p.n.departamento); setProvAbierta(null); }
    else if (p.nivel === "provincial") setProvAbierta(p.n.provincia ?? null);
  }
  const todo = () => { setRegAbierta(null); setProvAbierta(null); setSel(null); };
  const focoRuc = provAbierta
    ? nodosPos.find((p) => p.nivel === "provincial" && p.n.provincia === provAbierta)?.n.ruc
    : regAbierta
      ? nodosPos.find((p) => p.nivel === "regional" && p.n.departamento === regAbierta)?.n.ruc
      : null;
  const d = sel ? detalleEntidad(ligera(sel)) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Dónde estás en la red" className="flex flex-wrap items-center gap-1.5 text-meta">
          <button type="button" onClick={todo} className={`font-semibold ${regAbierta ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>El Estado</button>
          {regAbierta && <MigaSep />}
          {regAbierta && <button type="button" onClick={() => { setProvAbierta(null); setSel(null); }} className={`font-semibold ${provAbierta ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>{tituloNatural(regAbierta)}</button>}
          {provAbierta && <MigaSep />}
          {provAbierta && <span className="font-semibold text-ink">{tituloNatural(provAbierta)}</span>}
        </nav>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ChipLeyenda tono="crimson" forma="halo">con contratos con indicio</ChipLeyenda>
          <ChipLeyenda tono="granate" forma="punto">sin indicio</ChipLeyenda>
        </span>
      </div>
      <p className="text-meta text-inkSoft">
        {!regAbierta ? "Elige una región para ver sus provincias." : !provAbierta ? "Elige una provincia para ver sus distritos, o una entidad para su detalle." : "Elige un distrito para ver su detalle."}
      </p>
      <div ref={marco}>
        <GrafoMarco>
          <svg viewBox={`0 0 ${VB} ${VB}`} className="h-auto w-full touch-manipulation select-none" role="group" aria-label="Red del Estado por territorio: la misma información que la tabla">
            <g style={{ transform: `translate(${foco.tx}px, ${foco.ty}px) scale(${foco.k})`, transition: "transform 300ms cubic-bezier(0.22,1,0.36,1)" }}>
              {edges.map((ed, i) => (
                <Arista key={i} x1={ed.x1} y1={ed.y1} x2={ed.bx} y2={ed.by} tono={ed.fuerte ? "crimson" : "granate"} k={foco.k} flujo={ed.abierta} opacity={regAbierta && !ed.abierta ? 0.12 : 0.4} />
              ))}
              {nodosPos.map((p) => {
                const dim = regAbierta != null && p.nivel === "regional" && p.n.departamento !== regAbierta;
                const conLabel = p.nivel === "regional" || regAbierta != null;
                return (
                  <Nodo
                    key={p.n.ruc}
                    x={p.x} y={p.y} r={p.r} k={foco.k}
                    tono={tonoDe(p.n)}
                    label={conLabel && !dim ? corto(p.label, 18) : undefined}
                    anchor={anchorDeCos(Math.cos(rad(p.ang)))}
                    anguloEtiqueta={p.ang}
                    fontSize={letra}
                    hovered={hover === p.n.ruc}
                    selected={sel?.ruc === p.n.ruc}
                    foco={p.n.ruc === focoRuc}
                    resalta={fuerte(p.n)}
                    atenuado={dim}
                    onEnter={() => setHover(p.n.ruc)}
                    onLeave={() => setHover(null)}
                    onClick={() => abrir(p)}
                    aria={`${p.label}, ${nivelTxt(p.nivel)}: ${(p.n.n_captura ?? 0) > 0 ? plural(p.n.n_captura, "contrato con indicio", "contratos con indicio") : "sin contratos con indicio"}`}
                  />
                );
              })}
              <NodoCentro x={C} y={C} k={foco.k} lineas={["El Estado"]} fontSize={letra} onClick={todo} aria="El Estado (ver todo)" />
            </g>
          </svg>
        </GrafoMarco>
      </div>
      {sel && d && (
        <section aria-label={`Detalle de ${d.titulo}`} className="space-y-3 border-t border-line pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-bloque font-bold leading-tight text-ink">{d.titulo}</h3>
              <div className="mt-0.5 text-meta text-mute">{d.descripcion}</div>
            </div>
            <BotonCerrar onClick={() => setSel(null)} />
          </div>
          {d.contenido}
          {d.pie}
        </section>
      )}
    </div>
  );
}
