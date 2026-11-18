"use client";

import { useMemo, useState } from "react";
import { Building2, HeartHandshake, Landmark, UserRound } from "lucide-react";
import { ChipLeyenda, GrafoAside, GrafoColumnas, GrafoMarco, Nodo, aristaTono, type Tono } from "@/components/grafo/primitivos";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { ID_PERSONA, type AristaRed, type NodoRed, type RedDePersona, type TipoAristaRed, type TipoNodoRed } from "@/lib/redPersona";
import { cn } from "@/lib/utils";

/**
 * La red de una persona con cargo público (pestaña «Red» de su ficha): a la izquierda la persona y su familia declarada
 * (sólo el parentesco), al centro las empresas (las suyas, las de su familia y las que la visitaron y ganaron después) y a
 * la derecha las entidades. Las líneas dicen qué los une: trabaja o trabajó (gris), visitó (ámbar, punteada), socio o
 * representante (añil), le vendió o cobró (granate) y familiar declarado (rojo). Tocar un nodo apaga lo que no está unido a
 * él y abre su panel. Debajo, la misma red en una lista (la versión accesible). Los datos salen de la ficha (lib/redPersona).
 */
const ANCHO = 1000;
const PASO = 50;
// La persona a 270: su nombre (hasta 32 caracteres, a la izquierda del nodo) no se corta; la familia, un poco más atrás.
const X = { izq: 270, centro: 520, der: 790 } as const;
const TONO_ARISTA: Record<TipoAristaRed, Tono> = { trabajo: "neutro", visita: "amber", socio: "anil", vende: "granate", cobra: "granate", pariente: "crimson" };
const ICONO: Record<TipoNodoRed, typeof Landmark> = { entidad: Landmark, empresa: Building2, persona: UserRound, pariente: HeartHandshake };
const NOMBRE_TIPO: Record<TipoNodoRed, string> = { entidad: "Entidad", empresa: "Empresa", persona: "La persona", pariente: "Familiar declarado" };
const GRUPO: Record<TipoNodoRed, string> = { persona: "La persona", pariente: "Su familia declarada", empresa: "Empresas", entidad: "Entidades" };
const corto = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const columna = (n: NodoRed): keyof typeof X => (n.tipo === "entidad" ? "der" : n.tipo === "empresa" ? "centro" : "izq");

function tonoDe(n: NodoRed, foco: string): Tono {
  if (n.id === foco) return "granate";
  if (n.severidad === "alta") return "crimson";
  if (n.severidad === "media") return "amber";
  return n.tipo === "pariente" || n.tipo === "persona" ? "anil" : n.tipo === "empresa" ? "granate" : "neutro";
}

/** Lo que cambia entre la red de una persona y la de una empresa: quién va al centro y cómo se llama cada grupo. */
interface ConfigRed {
  /** El nodo de la ficha: la persona (a la izquierda) o la empresa (al centro). */
  foco?: string;
  grupos?: Partial<Record<TipoNodoRed, string>>;
  nombres?: Partial<Record<TipoNodoRed, string>>;
  /** Cómo se llama la red para el lector de pantalla. */
  de?: string;
}

/** La red de una persona (su ficha de cargo público). */
export function RedPersona({ red }: { red: RedDePersona }) {
  return <RedFicha red={red} />;
}

/** El grafo de tres columnas de una ficha: personas, empresas y entidades, con su panel y su lista. */
export function RedFicha({ red, foco = ID_PERSONA, grupos = {}, nombres = {}, de = "la persona" }: { red: RedDePersona } & ConfigRed) {
  const { nodos, aristas, fuera } = red;
  const grupo = { ...GRUPO, ...grupos };
  const nombreTipo = { ...NOMBRE_TIPO, ...nombres };
  const colFoco = columna(nodos.find((n) => n.id === foco) ?? { tipo: "persona" } as NodoRed);
  const pos = useMemo(() => {
    const cols = { izq: nodos.filter((n) => columna(n) === "izq"), centro: nodos.filter((n) => columna(n) === "centro"), der: nodos.filter((n) => columna(n) === "der") };
    const filas = Math.max(cols.izq.length, cols.centro.length, cols.der.length, 3);
    const alto = 48 + filas * PASO;
    const m = new Map<string, { x: number; y: number; r: number }>();
    const maxMonto = Math.max(1, ...cols.centro.map((n) => n.monto ?? 0));
    // El foco al medio de su columna y los demás de esa columna repartidos arriba y abajo (en la red de una persona, su
    // familia, un poco más atrás); las otras columnas, parejas de arriba abajo.
    m.set(foco, { x: X[colFoco], y: alto / 2, r: 15 });
    const compañeros = cols[colFoco].filter((n) => n.id !== foco);
    compañeros.forEach((n, i) => {
      const k = Math.floor(i / 2) + 1;
      const y = alto / 2 + (i % 2 === 0 ? 1 : -1) * k * Math.min(PASO * 1.4, (alto / 2 - 24) / Math.max(1, Math.ceil(compañeros.length / 2)));
      m.set(n.id, { x: colFoco === "izq" ? X.izq - 40 : X[colFoco], y, r: colFoco === "centro" ? 6 + 9 * Math.sqrt((n.monto ?? 0) / maxMonto) : 8 });
    });
    for (const c of (["izq", "centro", "der"] as const).filter((x) => x !== colFoco)) {
      const xs = cols[c];
      const hueco = alto / (xs.length + 1);
      xs.forEach((n, i) => m.set(n.id, { x: X[c], y: hueco * (i + 1), r: c === "centro" ? 6 + 9 * Math.sqrt((n.monto ?? 0) / maxMonto) : 8 }));
    }
    return { m, alto };
  }, [nodos, foco, colFoco]);

  const [sel, setSel] = useState<string>(foco);
  const [encima, setEncima] = useState<string | null>(null);
  const activo = encima ?? sel;
  const vecinos = useMemo(() => {
    const v = new Set<string>([activo]);
    for (const a of aristas) if (a.de === activo || a.a === activo) v.add(a.de).add(a.a);
    return v;
  }, [activo, aristas]);
  const porId = useMemo(() => new Map(nodos.map((n) => [n.id, n])), [nodos]);
  const elegido = porId.get(sel) ?? nodos[0];
  const hay = (t: TipoAristaRed) => aristas.some((a) => a.tipo === t);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {hay("trabajo") && <ChipLeyenda tono="neutro">Trabaja o trabajó ahí</ChipLeyenda>}
        {hay("visita") && <ChipLeyenda tono="amber" forma="punteado">Visitas</ChipLeyenda>}
        {hay("socio") && <ChipLeyenda tono="anil">Socio, representante o directivo</ChipLeyenda>}
        {(hay("vende") || hay("cobra")) && <ChipLeyenda tono="granate">Le vendió o cobró (el tamaño, cuánto)</ChipLeyenda>}
        {hay("pariente") && <ChipLeyenda tono="crimson">Familiar que declaró</ChipLeyenda>}
      </div>
      <GrafoColumnas>
        <GrafoMarco>
          <svg viewBox={`0 0 ${ANCHO} ${pos.alto}`} className="block h-auto w-full min-w-[640px]" role="group" aria-label={`Red de ${de}: ${plural(nodos.length - 1, "vínculo", "vínculos")}. La lista de abajo dice lo mismo.`}>
            {aristas.map((a, i) => {
              const p = pos.m.get(a.de);
              const q = pos.m.get(a.a);
              if (!p || !q) return null;
              const on = a.de === activo || a.a === activo;
              const dx = Math.max(40, Math.abs(q.x - p.x) / 2.2);
              const s = p.x <= q.x ? 1 : -1;
              return (
                <path
                  key={i}
                  d={`M ${p.x} ${p.y} C ${p.x + s * dx} ${p.y}, ${q.x - s * dx} ${q.y}, ${q.x} ${q.y}`}
                  className={a.tipo === "trabajo" ? "fill-none stroke-inkSoft" : cn("fill-none", aristaTono(TONO_ARISTA[a.tipo]))}
                  strokeWidth={on ? 1.8 : 1}
                  strokeOpacity={on ? 0.9 : vecinos.has(a.de) && vecinos.has(a.a) ? 0.45 : 0.18}
                  strokeDasharray={a.tipo === "visita" ? "4 4" : undefined}
                  strokeLinecap="round"
                />
              );
            })}
            {nodos.map((n) => {
              const p = pos.m.get(n.id);
              if (!p) return null;
              const col = columna(n);
              return (
                <Nodo
                  key={n.id}
                  x={p.x}
                  y={p.y}
                  r={p.r}
                  tono={tonoDe(n, foco)}
                  label={corto(n.nombre, col === "der" ? 30 : 32)}
                  anchor={col === "der" ? "start" : "end"}
                  fontSize={n.id === foco ? 13 : 12}
                  selected={sel === n.id}
                  hovered={encima === n.id}
                  resalta={n.severidad === "alta" || n.id === foco}
                  atenuado={!vecinos.has(n.id)}
                  onEnter={() => setEncima(n.id)}
                  onLeave={() => setEncima(null)}
                  onClick={() => setSel(n.id)}
                  aria={`${nombreTipo[n.tipo]}: ${n.nombre}. ${n.rol}`}
                />
              );
            })}
          </svg>
        </GrafoMarco>
        <GrafoAside>
          <PanelNodo n={elegido} aristas={aristas} porId={porId} elegir={setSel} nombreTipo={nombreTipo} />
        </GrafoAside>
      </GrafoColumnas>

      {fuera.entidades + fuera.empresas + fuera.parientes + (fuera.personas ?? 0) > 0 && (
        <p className="text-rotulo text-mute">
          Para que se lea, la red dibuja lo más unido:{" "}
          {[
            fuera.entidades ? plural(fuera.entidades, "entidad más", "entidades más") : null,
            fuera.empresas ? plural(fuera.empresas, "empresa más", "empresas más") : null,
            fuera.parientes ? plural(fuera.parientes, "familiar más", "familiares más") : null,
            fuera.personas ? plural(fuera.personas, "persona más", "personas más") : null,
          ].filter(Boolean).join(", ")}{" "}
          están en sus pestañas.
        </p>
      )}

      {/* La misma red en una lista: por clase; tocar uno lo elige arriba. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["persona", "pariente", "empresa", "entidad"] as const).map((t) => {
          const xs = nodos.filter((n) => n.tipo === t);
          if (!xs.length) return null;
          const Icono = ICONO[t];
          return (
            <section key={t} className="min-w-0 space-y-1.5">
              <h4 className="flex items-center gap-1.5 text-meta font-semibold text-inkSoft">
                <Icono size={14} aria-hidden />
                {grupo[t]} {(t !== "persona" || foco !== ID_PERSONA) && <span className="tabular-nums text-mute">{numero(xs.length)}</span>}
              </h4>
              <ul className="space-y-0.5">
                {xs.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setSel(n.id)}
                      aria-pressed={sel === n.id}
                      className={cn(
                        "w-full rounded-lg px-2 py-1.5 text-left text-meta transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                        sel === n.id ? "bg-granate-50 font-semibold text-granate" : "text-ink hover:bg-paperSoft",
                      )}
                    >
                      <span className="block truncate">{n.nombre}</span>
                      <span className="block truncate text-rotulo text-mute">
                        {n.monto != null ? <span className="font-mono tabular-nums">{solesCompacto(n.monto)}</span> : n.rol}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PanelNodo({ n, aristas, porId, elegir, nombreTipo }: { n: NodoRed; aristas: AristaRed[]; porId: Map<string, NodoRed>; elegir: (id: string) => void; nombreTipo: Record<TipoNodoRed, string> }) {
  const Icono = ICONO[n.tipo];
  const suyas = aristas.filter((a) => a.de === n.id || a.a === n.id);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-rotulo font-semibold text-mute">
          <Icono size={13} aria-hidden />
          {nombreTipo[n.tipo]}
        </p>
        <p className="font-display text-destacado font-bold leading-snug text-ink text-pretty">{n.nombre}</p>
        <p className="text-meta text-inkSoft">{n.rol}</p>
      </div>
      {n.monto != null && (
        <div className="rounded-lg border border-line bg-paper px-2.5 py-1.5">
          <p className="text-rotulo text-mute">Le vendió a las entidades de esta red</p>
          <p className="font-mono text-dato font-semibold tabular-nums text-ink">{solesCompacto(n.monto)}</p>
        </div>
      )}
      {n.datos.length > 0 && (
        <dl className="space-y-1.5">
          {n.datos.map((d, i) => (
            <div key={i}>
              <dt className="text-rotulo text-mute">{d.etiqueta}</dt>
              <dd className="text-meta leading-snug text-ink">{d.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {suyas.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-rotulo font-semibold text-mute">{suyas.length === 1 ? "Su vínculo" : `Sus ${numero(suyas.length)} vínculos`}</h4>
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {suyas.map((a, i) => {
              const otro = porId.get(a.de === n.id ? a.a : a.de);
              if (!otro) return null;
              return (
                <li key={i} className="text-meta leading-snug text-inkSoft">
                  <button type="button" onClick={() => elegir(otro.id)} className="font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
                    {otro.nombre}
                  </button>
                  : {a.texto}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {n.href ? (
        <EnlaceAccion href={n.href} prefetch={false} variante="secundario" flecha>
          {n.tipo === "entidad" ? "Abrir la ficha de la entidad" : "Abrir la ficha de la empresa"}
        </EnlaceAccion>
      ) : n.tipo === "pariente" ? (
        <p className="text-rotulo text-mute">Sólo su parentesco: el nombre de un familiar no se publica. El detalle está en la pestaña Familia.</p>
      ) : null}
    </div>
  );
}
