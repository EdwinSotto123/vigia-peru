"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, type Columna, type Fila } from "@/components/listado";
import { Ayuda, BloqueDetalle, CuerpoDetalle, DatosClave, PieDetalle, Seccion } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { Separador } from "@/components/ui/Partes";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { ChipIndicio } from "@/components/grafo/indicios";
import { BotonCerrar, ChipLeyenda } from "@/components/grafo/primitivos";
import { SelectorVista, TablaORed } from "@/components/grafo/vista";
import { TIPO_CRUCE } from "@/lib/cruces";
import { listaY, numero, plural, solesCompacto } from "@/lib/formato";
import { esLazoFuerte, TIPOS_CAPTURA, type SeveridadIndicio, type TipoCaptura } from "@/lib/grafo";
import { tituloNatural } from "@/lib/landing";
import type { GrafoPartido } from "@/lib/poder";
import { cn } from "@/lib/utils";

/**
 * El patrón que más señala en un partido (mapa de poder, migración 125): una misma empresa ligada a él que gana en
 * varias de las entidades que gobierna. Es una pregunta de forma —quién conecta con quién—, así que en escritorio se
 * dibuja como red bipartita: a la izquierda las entidades, a la derecha las empresas que ganaron con indicio en dos o
 * más de ellas, y una línea por cada vez. Los nombres son texto de la página (completos, con su letra), no texto
 * dentro de un SVG escalado; el SVG sólo dibuja las líneas, medidas sobre esos nombres. Debajo de lg, la misma
 * información en tabla (antes el SVG de 560 px dejaba las empresas fuera de la pantalla del celular).
 *
 * Pasar el cursor o el foco por un nombre resalta sus líneas; elegirlo muestra su detalle debajo (el detalle no cambia
 * con el cursor). Rojo: financió al partido o un socio trabaja en la entidad; ámbar: le vendió a la campaña.
 */

type Ref = { tipo: "ent" | "emp"; ruc: string } | null;
type Ent = GrafoPartido["entidades"][number];
type Emp = GrafoPartido["empresas"][number] & { ents: string[] };

const SEVERIDAD: Record<string, SeveridadIndicio> = Object.fromEntries(TIPOS_CAPTURA.map((t) => [t.tipo, t.severidad]));
const crucesDe = (lazos: string[]) => lazos.filter((l) => SEVERIDAD[l]).map((l) => ({ tipo: l, severidad: SEVERIDAD[l] }));
/** Tope de empresas que trae la API (backend/api/src/routes/poder.ts, LIMIT 14). */
const TOPE_API = 14;
/** `useLayoutEffect` sin el aviso del render en el servidor (la red también se dibuja ahí, oculta en el celular). */
const useMedida = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function GrafoPartidoViz({ data }: { data: GrafoPartido }) {
  const [red, setRed] = useState(true);
  const { ents, comps } = useMemo(() => {
    const conEmpresa = new Set(data.empresas.flatMap((e) => e.entidades));
    const ents = data.entidades.filter((e) => conEmpresa.has(e.ruc));
    const idx = new Map(ents.map((e, i) => [e.ruc, i]));
    const comps: Emp[] = data.empresas.map((c) => ({ ...c, ents: c.entidades.filter((r) => idx.has(r)) })).filter((c) => c.ents.length > 0);
    // Cada empresa a la altura media de sus entidades: menos cruces de líneas.
    const centro = (c: Emp) => c.ents.reduce((s, r) => s + (idx.get(r) ?? 0), 0) / c.ents.length;
    comps.sort((a, b) => centro(a) - centro(b) || b.n_entidades - a.n_entidades);
    return { ents, comps };
  }, [data]);
  const nombreEnt = useMemo(() => new Map(data.entidades.map((e) => [e.ruc, tituloNatural(e.nombre)])), [data]);

  const tope = data.empresas.length >= TOPE_API;
  return (
    <Seccion
      titulo="Empresas que ganan en varias de sus entidades"
      descripcion={
        tope
          ? `Entre las ${numero(data.entidades.length)} entidades del partido con más contratos con indicio, las ${numero(comps.length)} empresas ligadas a él que más se repiten.`
          : `Entre las ${numero(data.entidades.length)} entidades del partido con más contratos con indicio, ${plural(comps.length, "empresa ligada a él ganó", "empresas ligadas a él ganaron")} en dos o más.`
      }
      ayuda={
        <Ayuda titulo="¿Qué muestra?">
          <span className="block">
            Las empresas ligadas al partido (le financiaron o le vendieron a la campaña, o un socio trabaja en la entidad) que
            ganaron contratos con indicio en dos o más de las entidades que gobierna.
          </span>
          <span className="mt-1.5 block">Que una empresa gane en varias puede ser competencia legítima: es para revisar.</span>
        </Ayuda>
      }
      acciones={<SelectorVista red={red} onCambio={setRed} />}
    >
      <div className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">
        <TablaORed red={red} tabla={<TablaEmpresas comps={comps} nombreEnt={nombreEnt} />} grafo={<Bipartito ents={ents} comps={comps} nombreEnt={nombreEnt} />} />
      </div>
    </Seccion>
  );
}

// ─── La tabla (siempre en el celular) ────────────────────────────────────────

const COLUMNAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1.4fr)" },
  { clave: "entidades", titulo: "Ganó en", ancho: "minmax(0,1.2fr)", desde: "md" },
  { clave: "contratos", titulo: "Contratos", ancho: "6.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "monto", titulo: "Monto", ancho: "7rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
  { clave: "vinculo", titulo: "Vínculo con el partido", ancho: "minmax(0,1.1fr)", desde: "md", apilar: true },
];

function TablaEmpresas({ comps, nombreEnt }: { comps: Emp[]; nombreEnt: Map<string, string> }) {
  const filas: Fila[] = comps.map((c) => {
    const nombre = tituloNatural(c.nombre ?? c.ruc);
    const donde = c.ents.map((r) => nombreEnt.get(r) ?? r);
    return {
      id: c.ruc,
      celdas: {
        empresa: (
          <CeldaPrincipal
            titulo={nombre}
            meta={
              <>
                <Dato tipo="ruc" mono>{c.ruc}</Dato>
                {/* En el celular la columna «Ganó en» no está: cuántas, aquí (el aire se va con el dato). */}
                <span className="md:hidden">
                  <Separador />
                  {plural(c.n_entidades, "entidad", "entidades")}
                </span>
              </>
            }
          />
        ),
        entidades: <CeldaTexto sub={listaY(donde)}>{plural(c.n_entidades, "entidad", "entidades")}</CeldaTexto>,
        contratos: <CeldaNumero>{numero(c.contratos)}</CeldaNumero>,
        monto: <CeldaNumero>{solesCompacto(c.monto)}</CeldaNumero>,
        vinculo: <CrucesCelda cruces={crucesDe(c.lazos)} />,
      },
      detalle: {
        titulo: nombre,
        etiqueta: `Ver el detalle de ${nombre}: ganó en ${plural(c.n_entidades, "entidad", "entidades")} del partido`,
        descripcion: <Dato tipo="ruc" mono>{c.ruc}</Dato>,
        contenido: <DetalleEmpresa c={c} nombreEnt={nombreEnt} />,
        pie: (
          <PieDetalle
            principal={
              <EnlaceAccion href={`/empresa/${c.ruc}`} flecha prefetch={false}>
                Ver la empresa
              </EnlaceAccion>
            }
          />
        ),
      },
    };
  });
  return <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Empresas que ganan en varias entidades del partido" />;
}

function DetalleEmpresa({ c, nombreEnt }: { c: Emp; nombreEnt: Map<string, string> }) {
  const lazos = TIPOS_CAPTURA.filter((t) => c.lazos.includes(t.tipo));
  return (
    <CuerpoDetalle>
      <DatosClave
        items={[
          { etiqueta: "Contratos con indicio", valor: numero(c.contratos), mono: true },
          { etiqueta: "Monto de esos contratos", valor: solesCompacto(c.monto), mono: true },
        ]}
      />
      <BloqueDetalle titulo={`Dónde ganó (${numero(c.ents.length)})`}>
        <ul className="divide-y divide-line/70 rounded-xl border border-line">
          {c.ents.map((r) => (
            <li key={r}>
              <Link href={`/entidad/${r}`} prefetch={false} className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2 text-dato text-ink transition-colors duration-rapido hover:bg-paperSoft">
                <span className="min-w-0">{nombreEnt.get(r) ?? r}</span>
              </Link>
            </li>
          ))}
        </ul>
      </BloqueDetalle>
      {lazos.length > 0 && (
        <BloqueDetalle titulo="Vínculo con el partido">
          <ul className="space-y-1.5">
            {lazos.map((t) => (
              <li key={t.tipo} className="flex items-center gap-1">
                <ChipIndicio i={{ tipo: t.tipo as TipoCaptura, n: 0, severidad: t.severidad, corto: TIPO_CRUCE[t.tipo]?.corto ?? t.tipo, explica: "" }} conteo="ninguno" />
                <Ayuda titulo={`¿Qué es «${TIPO_CRUCE[t.tipo]?.corto ?? t.tipo}»?`}>{TIPO_CRUCE[t.tipo]?.explica}</Ayuda>
              </li>
            ))}
          </ul>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}

// ─── La red (desde lg) ───────────────────────────────────────────────────────

type Punto = { x: number; y: number };

function Bipartito({ ents, comps, nombreEnt }: { ents: Ent[]; comps: Emp[]; nombreEnt: Map<string, string> }) {
  const [hover, setHover] = useState<Ref>(null);
  const [sel, setSel] = useState<Ref>(null);
  const caja = useRef<HTMLDivElement>(null);
  const nodos = useRef(new Map<string, HTMLElement>());
  const [pos, setPos] = useState<{ ent: Record<string, Punto>; emp: Record<string, Punto>; w: number; h: number }>({ ent: {}, emp: {}, w: 0, h: 0 });

  const registrar = useCallback((clave: string) => (el: HTMLElement | null) => {
    if (el) nodos.current.set(clave, el);
    else nodos.current.delete(clave);
  }, []);

  // Dónde quedó cada nombre en la página: la línea sale del borde derecho de la entidad y llega al izquierdo de la empresa.
  useMedida(() => {
    const medir = () => {
      const c = caja.current;
      if (!c) return;
      const base = c.getBoundingClientRect();
      const ent: Record<string, Punto> = {};
      const emp: Record<string, Punto> = {};
      for (const [clave, el] of nodos.current) {
        const r = el.getBoundingClientRect();
        const [tipo, ruc] = clave.split(":");
        if (tipo === "ent") ent[ruc] = { x: r.right - base.left, y: r.top + r.height / 2 - base.top };
        else emp[ruc] = { x: r.left - base.left, y: r.top + r.height / 2 - base.top };
      }
      setPos({ ent, emp, w: base.width, h: base.height });
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (caja.current) ro.observe(caja.current);
    return () => ro.disconnect();
  }, [ents, comps]);

  const foco = hover ?? sel;
  const { entOn, empOn } = useMemo(() => {
    if (!foco) return { entOn: null as Set<string> | null, empOn: null as Set<string> | null };
    if (foco.tipo === "emp") return { entOn: new Set(comps.find((c) => c.ruc === foco.ruc)?.ents ?? []), empOn: new Set([foco.ruc]) };
    return { entOn: new Set([foco.ruc]), empOn: new Set(comps.filter((c) => c.ents.includes(foco.ruc)).map((c) => c.ruc)) };
  }, [foco, comps]);
  const maxCap = Math.max(1, ...ents.map((e) => e.n_captura));

  const detEmp = sel?.tipo === "emp" ? comps.find((c) => c.ruc === sel.ruc) : null;
  const detEnt = sel?.tipo === "ent" ? ents.find((e) => e.ruc === sel.ruc) : null;
  const elegir = (r: Ref) => setSel((s) => (s && r && s.tipo === r.tipo && s.ruc === r.ruc ? null : r));

  const boton = (activo: boolean, apagado: boolean, elegido: boolean) =>
    cn(
      "block w-full rounded-xl px-3 py-2 transition-[background-color,opacity] duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
      apagado ? "opacity-45" : "opacity-100",
      elegido ? "bg-granate-50 ring-1 ring-granate/40" : activo ? "bg-paper" : "hover:bg-paper",
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <ChipLeyenda tono="crimson" forma="punto">
          {TIPO_CRUCE.partido_gobernante?.corto} o {TIPO_CRUCE.socio_en_entidad?.corto.toLowerCase()}
        </ChipLeyenda>
        <ChipLeyenda tono="amber" forma="punto">{TIPO_CRUCE.vendio_gobernante?.corto}</ChipLeyenda>
        <span className="text-rotulo text-mute">el punto de la empresa crece con las entidades donde ganó</span>
      </div>
      <div ref={caja} className="relative rounded-xl bg-paperSoft p-3" role="group" aria-label="Red: las entidades del partido a la izquierda y las empresas que se repiten a la derecha; la misma información que la tabla">
        {/* Las líneas, detrás de los nombres. */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" width={pos.w} height={pos.h} aria-hidden>
          {comps.map((c) =>
            c.ents.map((r) => {
              const a = pos.ent[r];
              const b = pos.emp[c.ruc];
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2;
              const on = !foco || (!!empOn?.has(c.ruc) && !!entOn?.has(r));
              return (
                <path
                  key={`${c.ruc}-${r}`}
                  d={`M ${a.x + 6} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - 6} ${b.y}`}
                  fill="none"
                  className={esLazoFuerte(c.lazos) ? "stroke-crimson" : "stroke-amber"}
                  strokeWidth={on && foco ? 2.2 : 1.3}
                  strokeOpacity={on ? (foco ? 0.85 : 0.45) : 0.08}
                  strokeLinecap="round"
                />
              );
            }),
          )}
          {ents.map((e) => {
            const a = pos.ent[e.ruc];
            if (!a) return null;
            return <circle key={e.ruc} cx={a.x + 6} cy={a.y} r={3 + 4 * Math.sqrt(e.n_captura / maxCap)} className="fill-granate stroke-paper" strokeWidth={1.5} />;
          })}
          {comps.map((c) => {
            const b = pos.emp[c.ruc];
            if (!b) return null;
            return <circle key={c.ruc} cx={b.x - 6} cy={b.y} r={Math.min(9, 3 + 2 * Math.sqrt(c.n_entidades))} className={cn(esLazoFuerte(c.lazos) ? "fill-crimson" : "fill-amber", "stroke-paper")} strokeWidth={1.5} />;
          })}
        </svg>

        <div className="relative grid grid-cols-[minmax(0,1fr)_minmax(5rem,0.5fr)_minmax(0,1fr)] gap-x-2">
          <div className="min-w-0">
            <h3 className="mb-2 px-3 text-right font-display text-bloque font-bold text-ink">Entidades que gobierna</h3>
            <ul className="space-y-1">
              {ents.map((e) => {
                const k = { tipo: "ent" as const, ruc: e.ruc };
                const activo = foco?.tipo === "ent" && foco.ruc === e.ruc;
                return (
                  <li key={e.ruc} ref={registrar(`ent:${e.ruc}`)}>
                    <button
                      type="button"
                      aria-pressed={sel?.tipo === "ent" && sel.ruc === e.ruc}
                      onPointerEnter={() => setHover(k)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(k)}
                      onBlur={() => setHover(null)}
                      onClick={() => elegir(k)}
                      className={cn(boton(activo, !!entOn && !entOn.has(e.ruc), sel?.tipo === "ent" && sel.ruc === e.ruc), "text-right")}
                    >
                      <span className="block text-dato font-semibold leading-snug text-ink">{nombreEnt.get(e.ruc)}</span>
                      <span className="block text-meta tabular-nums text-mute">{plural(e.n_captura, "contrato con indicio", "contratos con indicio")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div aria-hidden />
          <div className="min-w-0">
            <h3 className="mb-2 px-3 font-display text-bloque font-bold text-ink">Empresas que se repiten</h3>
            <ul className="space-y-1">
              {comps.map((c) => {
                const k = { tipo: "emp" as const, ruc: c.ruc };
                const activo = foco?.tipo === "emp" && foco.ruc === c.ruc;
                return (
                  <li key={c.ruc} ref={registrar(`emp:${c.ruc}`)}>
                    <button
                      type="button"
                      aria-pressed={sel?.tipo === "emp" && sel.ruc === c.ruc}
                      onPointerEnter={() => setHover(k)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(k)}
                      onBlur={() => setHover(null)}
                      onClick={() => elegir(k)}
                      className={cn(boton(activo, !!empOn && !empOn.has(c.ruc), sel?.tipo === "emp" && sel.ruc === c.ruc), "text-left")}
                    >
                      <span className="block text-dato font-semibold leading-snug text-ink">{tituloNatural(c.nombre ?? c.ruc)}</span>
                      <span className="block text-meta tabular-nums text-mute">
                        {plural(c.n_entidades, "entidad", "entidades")}, {plural(c.contratos, "contrato", "contratos")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {(detEmp || detEnt) && (
        <section aria-label="Detalle de lo elegido" className="space-y-3 border-t border-line pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-bloque font-bold leading-tight text-ink">
                {detEmp ? tituloNatural(detEmp.nombre ?? detEmp.ruc) : nombreEnt.get(detEnt!.ruc)}
              </h3>
              {detEmp && (
                <div className="mt-0.5 text-meta text-mute">
                  <Dato tipo="ruc" mono>{detEmp.ruc}</Dato>
                </div>
              )}
            </div>
            <BotonCerrar onClick={() => setSel(null)} />
          </div>
          {detEmp ? (
            <>
              <DetalleEmpresa c={detEmp} nombreEnt={nombreEnt} />
              <EnlaceAccion href={`/empresa/${detEmp.ruc}`} flecha prefetch={false}>
                Ver la empresa
              </EnlaceAccion>
            </>
          ) : detEnt ? (
            <>
              <DatosClave
                items={[
                  { etiqueta: "Contratos con indicio", valor: numero(detEnt.n_captura), mono: true },
                  { etiqueta: "Monto de esos contratos", valor: solesCompacto(detEnt.monto_captura), mono: true },
                  {
                    etiqueta: "Empresas que se repiten aquí",
                    valor: listaY(comps.filter((c) => c.ents.includes(detEnt.ruc)).map((c) => tituloNatural(c.nombre ?? c.ruc))),
                  },
                ]}
              />
              <EnlaceAccion href={`/entidad/${detEnt.ruc}`} flecha prefetch={false}>
                Ver la ficha de la entidad
              </EnlaceAccion>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
