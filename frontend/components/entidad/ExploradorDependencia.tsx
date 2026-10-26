"use client";

import { useCallback, useMemo, useState } from "react";
import { Landmark, Scale } from "lucide-react";
import { AyudaTermino, CabeceraPestana, DatosClave, FuenteDato } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, type Columna } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { ArbolTabla, type NodoArbol } from "@/components/grafo/ArbolTabla";
import { BarraArbol } from "@/components/grafo/BarraArbol";
import { BotonCerrar, ChipLeyenda, GrafoMarco, MigaSep, Nodo, NodoCentro, Arista, type Tono } from "@/components/grafo/primitivos";
import { EstadoCarga, SelectorVista, TablaORed, letraEnUnidades, useAncho, usePoder } from "@/components/grafo/vista";
import { coincide, numero, paraBuscar, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { VB, C, rad, corto, radioPorRaiz, anguloEnAnillo, anchorDeCos } from "@/lib/grafo";
import { tituloNatural } from "@/lib/landing";
import type { DependenciaNodo } from "@/lib/poder";

/**
 * De quién depende quién en el Gobierno Nacional (/app/poder, pestaña «Gobierno Nacional»; presupuesto MEF): sector →
 * pliego → unidad ejecutora, como tabla plegable con el presupuesto (PIM) de cada fila en barra y cuánto se ejecutó.
 * Marca los sectores AUTÓNOMOS (Contraloría, JNE, ONPE, RENIEC, TC, Ministerio Público, Poder Judicial, Congreso…),
 * que no dependen del Ejecutivo, con su ícono y la palabra. Antes era un radial con letra de 4 a 6 px; la red sigue a un
 * clic, sólo desde lg. Estructura oficial: aquí no hay indicios.
 */
const AUTONOMOS = new Set(["04", "19", "20", "21", "22", "24", "27", "28", "31", "32", "33"]);
const esAutonomo = (sector: string) => AUTONOMOS.has(sector);

type Kind = "sector" | "pliego" | "ejec";
type Nd = { kind: Kind; key: string; nombre: string; sector: string; pim: number; dev: number; hijos: number };

const COLUMNAS: Columna[] = [
  { clave: "nombre", titulo: "Sector, pliego o unidad ejecutora", ancho: "minmax(0,1.7fr)" },
  { clave: "pim", titulo: "Presupuesto (PIM)", ancho: "minmax(8rem,0.8fr)", alinear: "der", ayuda: <AyudaTermino clave="pim" /> },
  { clave: "ejecutado", titulo: "Ejecutado", ancho: "8.5rem", alinear: "der", desde: "md", apilar: "con-rotulo", ayuda: <AyudaTermino clave="devengado" /> },
];

const ORDENES = [
  { valor: "pim", etiqueta: "Más presupuesto" },
  { valor: "nombre", etiqueta: "Nombre, de la A a la Z" },
];

const kindTxt = (k: Kind) => (k === "sector" ? "Sector" : k === "pliego" ? "Pliego" : "Unidad ejecutora");

/** La lista plana del MEF → sectores con sus pliegos y, en cada pliego, sus unidades ejecutoras. */
function armar(nodos: DependenciaNodo[]) {
  const secMap = new Map<string, Nd>();
  const pliMap = new Map<string, Map<string, Nd>>();
  const ejeMap = new Map<string, Nd[]>();
  for (const n of nodos) {
    const s = secMap.get(n.sector) ?? { kind: "sector" as Kind, key: n.sector, nombre: n.sector_nombre, sector: n.sector, pim: 0, dev: 0, hijos: 0 };
    s.pim += n.pim;
    s.dev += n.devengado;
    secMap.set(n.sector, s);
    if (!pliMap.has(n.sector)) pliMap.set(n.sector, new Map());
    const pm = pliMap.get(n.sector)!;
    const p = pm.get(n.pliego) ?? { kind: "pliego" as Kind, key: `${n.sector}|${n.pliego}`, nombre: n.pliego_nombre, sector: n.sector, pim: 0, dev: 0, hijos: 0 };
    p.pim += n.pim;
    p.dev += n.devengado;
    pm.set(n.pliego, p);
    const ek = `${n.sector}|${n.pliego}`;
    const arr = ejeMap.get(ek) ?? [];
    arr.push({ kind: "ejec", key: `${ek}|${n.ejec}`, nombre: n.ejecutora_nombre, sector: n.sector, pim: n.pim, dev: n.devengado, hijos: 0 });
    ejeMap.set(ek, arr);
  }
  for (const [sec, pm] of pliMap) {
    secMap.get(sec)!.hijos = pm.size;
    for (const [pl, p] of pm) p.hijos = (ejeMap.get(`${sec}|${pl}`) ?? []).length;
  }
  return {
    sectores: [...secMap.values()],
    pliegosDe: (sec: string) => [...(pliMap.get(sec)?.values() ?? [])],
    ejecsDe: (sec: string, pl: string) => ejeMap.get(`${sec}|${pl}`) ?? [],
  };
}

export function ExploradorDependencia() {
  const carga = usePoder<{ anio: number; nodos: DependenciaNodo[] }>("/poder/dependencia");
  const [red, setRed] = useState(false);
  const anio = carga.datos?.anio;
  return (
    <div className="space-y-4">
      <CabeceraPestana acciones={<SelectorVista red={red} onCambio={setRed} />} ayuda={<AyudaTermino clave="autonomo" />}>
        {`De quién depende cada organismo del Gobierno Nacional y su presupuesto${anio ? ` de ${anio}` : ""}; los autónomos no responden al Ejecutivo.`}
      </CabeceraPestana>
      <EstadoCarga carga={carga} columnas={COLUMNAS}>
        {(d) => <Dependencia nodos={d.nodos ?? []} anio={d.anio} red={red} />}
      </EstadoCarga>
    </div>
  );
}

function Dependencia({ nodos, anio, red }: { nodos: DependenciaNodo[]; anio: number; red: boolean }) {
  const datos = useMemo(() => armar(nodos), [nodos]);
  const [consulta, setConsulta] = useState("");
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [orden, setOrden] = useState("pim");
  const onConsulta = useCallback((v: string) => setConsulta(v), []);
  const q = paraBuscar(consulta);
  const poder = elegidos.poder;

  const { arbol, coinciden } = useMemo(() => {
    const ordenar = (xs: Nd[]) => [...xs].sort((a, b) => (orden === "nombre" ? 0 : b.pim - a.pim) || a.nombre.localeCompare(b.nombre, "es"));
    const busca = (nd: Nd) => !!q && coincide(paraBuscar(nd.nombre), q);
    const maximo = (xs: Nd[]) => Math.max(1, ...xs.map((x) => x.pim));
    let n = 0;
    const sectores = ordenar(datos.sectores).filter((s) => !poder || (poder === "autonomo") === esAutonomo(s.sector));
    const maxS = maximo(sectores);
    const out: NodoArbol[] = [];
    for (const s of sectores) {
      const todoS = !q || busca(s);
      const plis = ordenar(datos.pliegosDe(s.sector));
      const maxP = maximo(plis);
      const hijos: NodoArbol[] = [];
      for (const p of plis) {
        const todoP = todoS || busca(p);
        const ejes = ordenar(datos.ejecsDe(s.sector, p.key.split("|")[1]));
        const maxE = maximo(ejes);
        const hojas = ejes.filter((e) => todoP || busca(e)).map((e) => nodo(e, maxE));
        if (!todoP && !hojas.length) continue;
        n += hojas.length;
        hijos.push({ ...nodo(p, maxP), hijos: hojas });
      }
      if (!todoS && !hijos.length) continue;
      out.push({ ...nodo(s, maxS), hijos });
    }
    return { arbol: out, coinciden: n };
  }, [datos, q, poder, orden]);

  const filtrando = !!q || !!poder;
  const autonomos = datos.sectores.filter((s) => esAutonomo(s.sector)).length;
  const tabla = (
    <div className="space-y-3">
      <BarraArbol
        buscar={{ placeholder: "Buscar un sector, pliego o unidad ejecutora…", etiqueta: "Buscar en el Gobierno Nacional" }}
        consulta={consulta}
        onConsulta={onConsulta}
        filtros={[
          {
            clave: "poder",
            etiqueta: "Del Ejecutivo o autónomos",
            todas: "Todos los sectores",
            opciones: [
              { valor: "ejecutivo", etiqueta: "Poder Ejecutivo", n: datos.sectores.length - autonomos },
              { valor: "autonomo", etiqueta: "Autónomos", n: autonomos },
            ],
          },
        ]}
        elegidos={elegidos}
        onElegir={(k, v) => setElegidos((e) => ({ ...e, [k]: v }))}
        orden={{ valor: orden, opciones: ORDENES, onCambio: setOrden }}
        resultado={`${numero(coinciden)} de ${numero(nodos.length)} unidades ejecutoras`}
        onQuitar={() => {
          setConsulta("");
          setElegidos({});
        }}
      />
      {arbol.length === 0 ? (
        <p className="py-1.5 text-dato text-mute" role="status">
          Ningún sector, pliego ni unidad ejecutora coincide.
        </p>
      ) : (
        <ArbolTabla key={q ? "buscando" : "todo"} columnas={COLUMNAS} nodos={arbol} etiqueta={`El Gobierno Nacional y su presupuesto ${anio}`} todoAbierto={!!q && coinciden <= 300} />
      )}
      <FuenteDato fuente={`MEF, presupuesto ${anio} (PIM y ejecutado) por sector, pliego y unidad ejecutora`} />
    </div>
  );
  return <TablaORed red={red} tabla={tabla} grafo={<RedDependencia datos={datos} anio={anio} />} />;
}

function nodo(nd: Nd, maxHermano: number): NodoArbol {
  const nombre = tituloNatural(nd.nombre);
  const meta =
    nd.kind === "sector"
      ? [
          esAutonomo(nd.sector) ? (
            <Dato key="d" icono={Scale} nombre="Dependencia">Autónomo</Dato>
          ) : (
            <Dato key="d" icono={Landmark} nombre="Dependencia">Poder Ejecutivo</Dato>
          ),
          <Dato key="h" tipo="dependencia">{plural(nd.hijos, "pliego", "pliegos")}</Dato>,
        ]
      : nd.kind === "pliego"
        ? [<Dato key="h" tipo="dependencia">{plural(nd.hijos, "unidad ejecutora", "unidades ejecutoras")}</Dato>]
        : undefined;
  const avance = nd.pim > 0 ? (nd.dev / nd.pim) * 100 : null;
  return {
    id: `${nd.kind}:${nd.key}`,
    celdas: {
      nombre: <CeldaPrincipal titulo={nombre} meta={meta} />,
      pim: (
        <span className="block w-full">
          <span className="block font-mono text-meta tabular-nums text-ink">{solesCompacto(nd.pim)}</span>
          <CeldaBarra parte={nd.pim / maxHermano} resumen={`${solesCompacto(nd.pim)} de presupuesto`} className="mt-1" />
        </span>
      ),
      ejecutado: <CeldaNumero sub={solesCompacto(nd.dev)}>{avance == null ? "Sin dato" : porcentaje(avance)}</CeldaNumero>,
    },
  };
}

// ─── La red (sólo desde lg) ──────────────────────────────────────────────────

const tonoDe = (sector: string): Tono => (esAutonomo(sector) ? "anil" : "granate");
const R1 = 220;
const PR = 150;
const DR = 110;
const LETRA = 12.5;
type P = { nd: Nd; x: number; y: number; r: number; ang: number; label: string };

/**
 * El radial de antes, como ayuda para ver la forma: el Gobierno Nacional al centro y sus sectores (el tamaño es el
 * presupuesto); al abrir un sector, sus pliegos; al abrir un pliego, sus unidades ejecutoras. Los autónomos en añil
 * con anillo punteado (y la palabra en la leyenda). Lo elegido se ve debajo.
 */
function RedDependencia({ datos, anio }: { datos: ReturnType<typeof armar>; anio: number }) {
  const [sectorAb, setSectorAb] = useState<string | null>(null);
  const [pliegoAb, setPliegoAb] = useState<string | null>(null);
  const [sel, setSel] = useState<Nd | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [marco, ancho] = useAncho<HTMLDivElement>();
  const letra = letraEnUnidades(LETRA, ancho, VB);
  const sectores = useMemo(() => [...datos.sectores].sort((a, b) => b.pim - a.pim), [datos]);

  const { pos, edges, foco } = useMemo(() => {
    const N = sectores.length || 1;
    const maxS = Math.max(...sectores.map((s) => s.pim), 1);
    const pos: P[] = [];
    const edges: { x1: number; y1: number; x2: number; y2: number; sector: string; abierta: boolean }[] = [];
    const F: { sec: P | null; pli: P | null } = { sec: null, pli: null };
    sectores.forEach((s, i) => {
      const ang = anguloEnAnillo(i, N);
      const sp: P = { nd: s, x: C + R1 * Math.cos(rad(ang)), y: C + R1 * Math.sin(rad(ang)), r: radioPorRaiz(s.pim, maxS, 8, 11), ang, label: tituloNatural(s.nombre) };
      pos.push(sp);
      edges.push({ x1: C, y1: C, x2: sp.x, y2: sp.y, sector: s.sector, abierta: false });
      if (s.key !== sectorAb) return;
      F.sec = sp;
      const plis = [...datos.pliegosDe(s.sector)].sort((a, b) => b.pim - a.pim);
      const maxP = Math.max(...plis.map((p) => p.pim), 1);
      const K = plis.length;
      const spread = Math.min(16, (K > 20 ? 290 : 150) / Math.max(K - 1, 1));
      plis.forEach((p, k) => {
        const pa = ang + (k - (K - 1) / 2) * spread;
        const pp: P = { nd: p, x: sp.x + PR * Math.cos(rad(pa)), y: sp.y + PR * Math.sin(rad(pa)), r: radioPorRaiz(p.pim, maxP, 5, 7), ang: pa, label: tituloNatural(p.nombre) };
        pos.push(pp);
        edges.push({ x1: sp.x, y1: sp.y, x2: pp.x, y2: pp.y, sector: s.sector, abierta: true });
        if (p.key !== pliegoAb) return;
        F.pli = pp;
        const ejes = [...datos.ejecsDe(s.sector, p.key.split("|")[1])].sort((a, b) => b.pim - a.pim);
        const M = ejes.length;
        const phi = Math.atan2(pp.y - sp.y, pp.x - sp.x) * (180 / Math.PI);
        const spreadD = Math.min(13, (M > 20 ? 290 : 150) / Math.max(M - 1, 1));
        ejes.forEach((e, m) => {
          const da = phi + (m - (M - 1) / 2) * spreadD;
          pos.push({ nd: e, x: pp.x + DR * Math.cos(rad(da)), y: pp.y + DR * Math.sin(rad(da)), r: 4.5, ang: da, label: tituloNatural(e.nombre) });
          edges.push({ x1: pp.x, y1: pp.y, x2: pp.x + DR * Math.cos(rad(da)), y2: pp.y + DR * Math.sin(rad(da)), sector: s.sector, abierta: true });
        });
      });
    });
    let k = 1, tx = 0, ty = 0;
    const target = F.pli ?? F.sec;
    if (target) {
      const out = rad(target.ang);
      const push = F.pli ? 60 : 82;
      k = F.pli ? 2.5 : 1.95;
      tx = C - (target.x + push * Math.cos(out)) * k;
      ty = C - (target.y + push * Math.sin(out)) * k;
    }
    return { pos, edges, foco: { k, tx, ty } };
  }, [sectores, datos, sectorAb, pliegoAb]);

  function abrir(nd: Nd) {
    setSel(nd);
    if (nd.kind === "sector") { setSectorAb(nd.key); setPliegoAb(null); }
    else if (nd.kind === "pliego") setPliegoAb(nd.key);
  }
  const todo = () => { setSectorAb(null); setPliegoAb(null); setSel(null); };
  const focoKey = pliegoAb ?? sectorAb;
  const secAb = sectorAb ? sectores.find((s) => s.key === sectorAb) : null;
  const pliAb = pliegoAb && secAb ? datos.pliegosDe(secAb.sector).find((p) => p.key === pliegoAb) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Dónde estás en la red" className="flex flex-wrap items-center gap-1.5 text-meta">
          <button type="button" onClick={todo} className={`font-semibold ${sectorAb ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>Gobierno Nacional</button>
          {secAb && <MigaSep />}
          {secAb && <button type="button" onClick={() => { setPliegoAb(null); setSel(null); }} className={`font-semibold ${pliegoAb ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>{tituloNatural(secAb.nombre)}</button>}
          {pliAb && <MigaSep />}
          {pliAb && <span className="font-semibold text-ink">{tituloNatural(pliAb.nombre)}</span>}
        </nav>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ChipLeyenda tono="granate" forma="punto">Poder Ejecutivo</ChipLeyenda>
          <ChipLeyenda tono="anil" forma="punteado">autónomo</ChipLeyenda>
          <span className="text-rotulo text-mute">el tamaño es el presupuesto</span>
        </span>
      </div>
      <p className="text-meta text-inkSoft">
        {!sectorAb ? "Elige un sector para ver sus pliegos." : !pliegoAb ? "Elige un pliego para ver sus unidades ejecutoras." : "Elige una unidad ejecutora para ver su presupuesto."}
      </p>
      <div ref={marco}>
        <GrafoMarco>
          <svg viewBox={`0 0 ${VB} ${VB}`} className="h-auto w-full touch-manipulation select-none" role="group" aria-label="Red del Gobierno Nacional: la misma información que la tabla">
            <g style={{ transform: `translate(${foco.tx}px, ${foco.ty}px) scale(${foco.k})`, transition: "transform 300ms cubic-bezier(0.22,1,0.36,1)" }}>
              {edges.map((ed, i) => (
                <Arista key={i} x1={ed.x1} y1={ed.y1} x2={ed.x2} y2={ed.y2} tono={tonoDe(ed.sector)} k={foco.k} flujo={ed.abierta}
                  opacity={sectorAb && !ed.abierta && ed.sector !== secAb?.sector ? 0.1 : ed.abierta ? 0.5 : 0.35} />
              ))}
              {pos.map((p) => {
                const dim = sectorAb != null && p.nd.kind === "sector" && p.nd.key !== sectorAb;
                const conLabel = p.nd.kind === "sector" || sectorAb != null;
                return (
                  <Nodo
                    key={p.nd.key}
                    x={p.x} y={p.y} r={p.r} k={foco.k}
                    tono={tonoDe(p.nd.sector)}
                    label={conLabel && !dim ? corto(p.label, p.nd.kind === "sector" ? 22 : 20) : undefined}
                    anchor={anchorDeCos(Math.cos(rad(p.ang)))}
                    anguloEtiqueta={p.ang}
                    fontSize={letra}
                    hovered={hover === p.nd.key}
                    selected={sel?.key === p.nd.key}
                    foco={p.nd.key === focoKey}
                    punteado={p.nd.kind === "sector" && esAutonomo(p.nd.sector)}
                    atenuado={dim}
                    onEnter={() => setHover(p.nd.key)}
                    onLeave={() => setHover(null)}
                    onClick={() => abrir(p.nd)}
                    aria={`${p.label}, ${kindTxt(p.nd.kind)}: ${solesCompacto(p.nd.pim)} de presupuesto`}
                  />
                );
              })}
              <NodoCentro x={C} y={C} k={foco.k} lineas={["Gobierno", "Nacional"]} fontSize={letra} onClick={todo} aria="Gobierno Nacional (ver todo)" />
            </g>
          </svg>
        </GrafoMarco>
      </div>
      {sel && (
        <section aria-label={`Detalle de ${tituloNatural(sel.nombre)}`} className="space-y-3 border-t border-line pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-bloque font-bold leading-tight text-ink">{tituloNatural(sel.nombre)}</h3>
              <div className="mt-0.5 text-meta text-mute">
                {kindTxt(sel.kind)}
                {sel.kind === "sector" ? (esAutonomo(sel.sector) ? ", autónomo: no depende del Poder Ejecutivo" : ", del Poder Ejecutivo") : ""}
              </div>
            </div>
            <BotonCerrar onClick={() => setSel(null)} />
          </div>
          <DatosClave
            items={[
              { etiqueta: `Presupuesto ${anio} (PIM)`, valor: solesCompacto(sel.pim), mono: true, ayuda: <AyudaTermino clave="pim" /> },
              { etiqueta: "Ejecutado", valor: `${solesCompacto(sel.dev)}${sel.pim > 0 ? `, ${porcentaje((sel.dev / sel.pim) * 100)}` : ""}`, mono: true, ayuda: <AyudaTermino clave="devengado" /> },
              ...(sel.kind !== "ejec" ? [{ etiqueta: "Contiene", valor: sel.kind === "sector" ? plural(sel.hijos, "pliego", "pliegos") : plural(sel.hijos, "unidad ejecutora", "unidades ejecutoras") }] : []),
            ]}
          />
        </section>
      )}
    </div>
  );
}
