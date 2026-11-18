"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Landmark, UserRound, UserSquare2 } from "lucide-react";
import { Arista, ChipLeyenda, GrafoAside, GrafoColumnas, GrafoMarco, Nodo, type Tono } from "@/components/grafo/primitivos";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { numero, plural, solesCompacto } from "@/lib/formato";
import type { AristaCaso, CasoPatron, NodoCaso } from "@/lib/casoPatron";
import { cn } from "@/lib/utils";

/**
 * Quiénes son, en red (la ficha de un caso de patrón): a la izquierda las personas que los unen (con un apellido tapado), al
 * centro las empresas o personas que le venden a la entidad, a la derecha la entidad y, debajo de ella, los funcionarios que
 * declararon a alguno como pariente. Las líneas dicen qué los une: vende (granate), socio o representante (añil), los mismos
 * apellidos (ámbar, punteada) y pariente declarado (rojo). Tocar un nodo apaga lo que no está unido a él y abre su panel:
 * qué papel tiene, sus cifras, cada vínculo y su ficha. Debajo, la misma red en una lista (la versión accesible).
 */
const ANCHO = 860;
const PASO = 58;
const X: Record<NodoCaso["tipo"], number> = { persona: 170, empresa: 450, entidad: 720, funcionario: 720 };
const TONO_ARISTA: Record<AristaCaso["tipo"], Tono> = { vende: "granate", socio: "anil", pariente: "crimson", apellidos: "amber", otro: "neutro" };
const ICONO = { entidad: Landmark, empresa: Building2, persona: UserRound, funcionario: UserSquare2 } as const;
const NOMBRE_TIPO: Record<NodoCaso["tipo"], string> = { entidad: "Entidad", empresa: "Empresa", persona: "Persona", funcionario: "Funcionario" };
const corto = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function tonoDe(n: NodoCaso): Tono {
  if (n.tipo === "entidad") return "neutro";
  if (n.tipo === "funcionario") return "crimson";
  if (n.tipo === "persona" && n.monto == null) return "anil";
  return n.severidad === "alta" ? "crimson" : n.severidad === "media" ? "amber" : "granate";
}

export function RedCaso({ caso }: { caso: CasoPatron }) {
  const { nodos, aristas } = caso;
  // Las personas que venden con su RUC van con las empresas (le venden a la entidad); las que sólo unen, a la izquierda.
  const columna = (n: NodoCaso): "izq" | "centro" | "der" => (n.tipo === "entidad" || n.tipo === "funcionario" ? "der" : n.tipo === "empresa" || n.monto != null ? "centro" : "izq");
  const pos = useMemo(() => {
    const cols = { izq: nodos.filter((n) => columna(n) === "izq"), centro: nodos.filter((n) => columna(n) === "centro"), der: nodos.filter((n) => columna(n) === "der") };
    const filas = Math.max(cols.izq.length, cols.centro.length, cols.der.length, 1);
    const alto = 56 + filas * PASO;
    const m = new Map<string, { x: number; y: number; r: number }>();
    const maxMonto = Math.max(1, ...cols.centro.map((n) => n.monto ?? 0));
    for (const [c, xs] of Object.entries(cols) as ["izq" | "centro" | "der", NodoCaso[]][]) {
      const x = c === "izq" ? X.persona : c === "centro" ? X.empresa : X.entidad;
      // La entidad, al medio de la altura; sus funcionarios, debajo.
      if (c === "der") {
        const ent = xs.filter((n) => n.tipo === "entidad");
        const fun = xs.filter((n) => n.tipo === "funcionario");
        const y0 = alto / 2 - (fun.length * PASO) / 2;
        ent.forEach((n) => m.set(n.id, { x, y: y0, r: 16 }));
        fun.forEach((n, i) => m.set(n.id, { x, y: y0 + (i + 1) * PASO, r: 8 }));
        continue;
      }
      const hueco = alto / (xs.length + 1);
      xs.forEach((n, i) => m.set(n.id, { x, y: hueco * (i + 1), r: c === "centro" ? 6 + 10 * Math.sqrt((n.monto ?? 0) / maxMonto) : 8 }));
    }
    return { m, alto };
  }, [nodos]);

  // Al abrir, la persona que más une (la del centro de la historia); si no hay, la entidad.
  const centro = useMemo(() => {
    const grado = (id: string) => aristas.filter((a) => a.de === id || a.a === id).length;
    return [...nodos].filter((n) => n.tipo === "persona" && n.monto == null).sort((a, b) => grado(b.id) - grado(a.id))[0]?.id ?? "e";
  }, [nodos, aristas]);
  const [sel, setSel] = useState<string>(centro);
  const [encima, setEncima] = useState<string | null>(null);
  const foco = encima ?? sel;
  const vecinos = useMemo(() => {
    const v = new Set<string>([foco]);
    for (const a of aristas) if (a.de === foco || a.a === foco) v.add(a.de).add(a.a);
    return v;
  }, [foco, aristas]);
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const elegido = porId.get(sel) ?? nodos[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <ChipLeyenda tono="granate">Le vende a la entidad (el tamaño, cuánto)</ChipLeyenda>
        <ChipLeyenda tono="anil">Socio, representante o directivo</ChipLeyenda>
        <ChipLeyenda tono="amber" forma="punteado">Los mismos apellidos (probable, no comprobado)</ChipLeyenda>
        {aristas.some((a) => a.tipo === "pariente") && <ChipLeyenda tono="crimson">Pariente declarado de un funcionario</ChipLeyenda>}
      </div>
      <GrafoColumnas>
        <GrafoMarco>
          <svg viewBox={`0 0 ${ANCHO} ${pos.alto}`} className="block h-auto w-full min-w-[640px]" role="group" aria-label={`Red del caso: ${plural(nodos.length, "involucrado", "involucrados")}. La lista de abajo dice lo mismo.`}>
            {aristas.map((a, i) => {
              const p = pos.m.get(a.de);
              const q = pos.m.get(a.a);
              if (!p || !q) return null;
              const on = vecinos.has(a.de) && vecinos.has(a.a) && (a.de === foco || a.a === foco);
              if (a.tipo === "apellidos") {
                const cx = Math.min(p.x, q.x) - 70;
                return (
                  <path
                    key={i}
                    d={`M ${p.x} ${p.y} Q ${cx} ${(p.y + q.y) / 2} ${q.x} ${q.y}`}
                    className="fill-none stroke-amber"
                    strokeWidth={on ? 1.8 : 1.1}
                    strokeOpacity={on ? 0.95 : 0.45}
                    strokeDasharray="4 4"
                  />
                );
              }
              return <Arista key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} tono={TONO_ARISTA[a.tipo]} opacity={on ? 0.9 : 0.28} flujo={on} />;
            })}
            {nodos.map((n) => {
              const p = pos.m.get(n.id);
              if (!p) return null;
              const col = columna(n);
              return (
                <g key={n.id}>
                  <Nodo
                    x={p.x}
                    y={p.y}
                    r={p.r}
                    tono={tonoDe(n)}
                    label={corto(n.nombre, col === "centro" ? 34 : 30)}
                    anchor={col === "izq" ? "end" : "start"}
                    fontSize={12}
                    selected={sel === n.id}
                    hovered={encima === n.id}
                    resalta={n.severidad === "alta"}
                    atenuado={!vecinos.has(n.id)}
                    onEnter={() => setEncima(n.id)}
                    onLeave={() => setEncima(null)}
                    onClick={() => setSel(n.id)}
                    aria={`${NOMBRE_TIPO[n.tipo]}: ${n.nombre}. ${n.rol}`}
                  />
                </g>
              );
            })}
          </svg>
        </GrafoMarco>
        <GrafoAside>
          <PanelNodo n={elegido} aristas={aristas} porId={porId} elegir={setSel} />
        </GrafoAside>
      </GrafoColumnas>

      {/* La misma red en una lista: por clase, cada uno con su papel; tocarlo lo elige arriba. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["persona", "empresa", "entidad", "funcionario"] as const).map((t) => {
          const xs = nodos.filter((n) => (t === "persona" ? n.tipo === "persona" && n.monto == null : t === "empresa" ? n.tipo === "empresa" || (n.tipo === "persona" && n.monto != null) : n.tipo === t));
          if (!xs.length) return null;
          const Icono = ICONO[t];
          return (
            <section key={t} className="space-y-1.5">
              <h4 className="flex items-center gap-1.5 text-meta font-semibold text-inkSoft">
                <Icono size={14} aria-hidden />
                {t === "persona" ? "Quienes los unen" : t === "empresa" ? "Quienes le venden" : t === "entidad" ? "Quien compra" : "Funcionarios"}{" "}
                <span className="tabular-nums text-mute">{numero(xs.length)}</span>
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
                      {n.monto != null && <span className="block font-mono text-rotulo tabular-nums text-mute">{solesCompacto(n.monto)}</span>}
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

function PanelNodo({ n, aristas, porId, elegir }: { n: NodoCaso; aristas: AristaCaso[]; porId: Map<string, NodoCaso>; elegir: (id: string) => void }) {
  const Icono = ICONO[n.tipo];
  const suyas = aristas.filter((a) => a.de === n.id || a.a === n.id);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-rotulo font-semibold text-mute">
          <Icono size={13} aria-hidden />
          {NOMBRE_TIPO[n.tipo]}
        </p>
        <p className="font-display text-destacado font-bold leading-snug text-ink text-pretty">{n.nombre}</p>
        <p className="text-meta text-inkSoft">{n.rol}</p>
      </div>
      {(n.monto != null || n.ordenes != null) && (
        <dl className="grid grid-cols-2 gap-2">
          {n.monto != null && (
            <div className="rounded-lg border border-line bg-paper px-2.5 py-1.5">
              <dt className="text-rotulo text-mute">{n.tipo === "entidad" ? "Le compró al grupo" : "Le vendió"}</dt>
              <dd className="font-mono text-dato font-semibold tabular-nums text-ink">{solesCompacto(n.monto)}</dd>
            </div>
          )}
          {n.ordenes != null && (
            <div className="rounded-lg border border-line bg-paper px-2.5 py-1.5">
              <dt className="text-rotulo text-mute">Órdenes</dt>
              <dd className="font-mono text-dato font-semibold tabular-nums text-ink">{numero(n.ordenes)}</dd>
            </div>
          )}
        </dl>
      )}
      {(n.datos ?? []).length > 0 && (
        <dl className="space-y-1.5">
          {n.datos!.map((d, i) => (
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
          <ul className="space-y-1">
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
          {n.tipo === "entidad" ? "Abrir la ficha de la entidad" : n.tipo === "persona" ? "Abrir su ficha" : "Abrir la ficha de la empresa"}
        </EnlaceAccion>
      ) : n.tipo === "persona" && n.monto == null ? (
        <p className="text-rotulo text-mute">Una persona que figura en el registro de proveedores no tiene ficha propia si no le vende al Estado con su RUC.</p>
      ) : null}
      {n.tipo === "funcionario" && (
        <p className="text-rotulo text-mute">
          Sólo su cargo: el nombre de un funcionario que declaró a un pariente no se publica aquí.{" "}
          <Link href="/metodo" prefetch={false} className="underline">Cómo se cruza</Link>
        </p>
      )}
    </div>
  );
}
