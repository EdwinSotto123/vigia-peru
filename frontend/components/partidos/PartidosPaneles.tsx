"use client";

import { useMemo, useState } from "react";
import { Search, Swords, X } from "lucide-react";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import {
  COLOR_OTRAS,
  NIVEL_LABEL,
  PERIODOS,
  TIPO_ORG_LABEL,
  cargoRegional,
  coloresPorOrg,
  conteos,
  ganoDistrito,
  normalizar,
  orgDe,
  pct,
  type AutoridadesDatos,
  type Nivel,
} from "@/lib/partidos";
import { nombreDepartamento } from "@/components/mapa/region-match";

/**
 * Los tres paneles del explorador de partidos: el ranking de quién gobierna más (por nivel),
 * el duelo entre dos organizaciones y el buscador de distrito. Sólo cuentan lo que ganó cada
 * organización en 2022; no dicen nada de lo que hizo.
 */

const NIVELES: Nivel[] = ["regional", "provincial", "distrital"];

/* ───────────────────────── Ranking ───────────────────────── */

export function RankingPartidos({
  d,
  nivel,
  onNivel,
  resaltar,
  onResaltar,
}: {
  d: AutoridadesDatos;
  nivel: Nivel;
  onNivel: (n: Nivel) => void;
  resaltar: number | null;
  onResaltar: (o: number | null) => void;
}) {
  const cs = useMemo(() => conteos(d), [d]);
  const colores = useMemo(() => coloresPorOrg(d, nivel), [d, nivel]);
  const total = d[nivel].length;
  const filas = useMemo(
    () => cs.filter((c) => c[nivel] > 0).sort((a, b) => b[nivel] - a[nivel] || a.org - b.org),
    [cs, nivel],
  );
  const top = filas.slice(0, 10);
  const resto = filas.slice(10);
  const restoN = resto.reduce((s, c) => s + c[nivel], 0);
  const porTipo = useMemo(() => {
    const m: Record<string, number> = { partido: 0, movimiento: 0, alianza: 0, otro: 0 };
    for (const c of filas) m[orgDe(d, c.org).t] += c[nivel];
    return m;
  }, [filas, d, nivel]);
  const max = top[0]?.[nivel] ?? 1;

  return (
    <div>
      <div role="tablist" aria-label="Nivel de gobierno" className="inline-flex rounded-full border border-line bg-paperSoft p-1">
        {NIVELES.map((n) => (
          <button
            key={n}
            role="tab"
            type="button"
            aria-selected={nivel === n}
            onClick={() => {
              onNivel(n);
              onResaltar(null);
            }}
            className={cn(
              "min-h-11 rounded-full px-3.5 py-1.5 text-[13px] font-semibold capitalize transition-colors sm:min-h-[32px]",
              nivel === n ? "bg-granate text-paper" : "text-inkSoft hover:text-ink",
            )}
          >
            {NIVEL_LABEL[n].plural}
          </button>
        ))}
      </div>

      <p className="mt-3 text-[13px] leading-snug text-mute">
        {numero(total)} {NIVEL_LABEL[nivel].plural} en total. Toca una organización para verla en el mapa.
      </p>

      <ol className="mt-4 space-y-1.5">
        {top.map((c, i) => {
          const o = orgDe(d, c.org);
          const n = c[nivel];
          const activa = resaltar === c.org;
          return (
            <li key={c.org}>
              <button
                type="button"
                onClick={() => onResaltar(activa ? null : c.org)}
                aria-pressed={activa}
                className={cn(
                  "group grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg border px-3 py-2 text-left transition-colors",
                  activa ? "border-granate bg-granate-soft" : "border-transparent hover:border-line hover:bg-paperSoft",
                )}
              >
                <span className="font-mono text-[12px] tabular-nums text-mute">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink" title={o.n}>
                    {o.n}
                  </span>
                  <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-paperDeep">
                    <span
                      className="block h-full rounded-full transition-[width] duration-panel ease-salida"
                      style={{ width: `${Math.max(3, (n / max) * 100)}%`, background: colores.get(c.org) ?? COLOR_OTRAS }}
                    />
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-[15px] font-bold tabular-nums text-ink">{numero(n)}</span>
                  <span className="block font-mono text-[11px] tabular-nums text-mute">{((n / total) * 100).toFixed(0)} %</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {resto.length > 0 && (
        <p className="mt-3 text-[13px] text-mute">
          Y otras {numero(resto.length)} organizaciones con {numero(restoN)} {NIVEL_LABEL[nivel].plural} entre todas.
        </p>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4">
        {(["partido", "movimiento", "alianza"] as const).map((t) => (
          <div key={t}>
            <dd className="font-mono text-xl font-bold tabular-nums text-ink">{numero(porTipo[t])}</dd>
            <dt className="mt-0.5 text-[12px] leading-snug text-mute">{TIPO_ORG_LABEL[t]}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ───────────────────────── Duelo ───────────────────────── */

export function DueloPartidos({ d }: { d: AutoridadesDatos }) {
  const cs = useMemo(() => conteos(d), [d]);
  const opciones = cs.slice(0, 40);
  const [a, setA] = useState<number>(cs[0]?.org ?? 0);
  const [b, setB] = useState<number>(cs[1]?.org ?? 0);
  const ca = cs.find((c) => c.org === a);
  const cb = cs.find((c) => c.org === b);

  return (
    <div>
      <p className="text-[13px] leading-snug text-mute">
        Dos organizaciones frente a frente, contando cuántos gobiernos ganó cada una en este período.
      </p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <Selector valor={a} onChange={setA} opciones={opciones.map((c) => c.org)} d={d} etiqueta="Organización A" />
        <Swords size={18} aria-hidden className="text-granate" />
        <Selector valor={b} onChange={setB} opciones={opciones.map((c) => c.org)} d={d} etiqueta="Organización B" />
      </div>

      <div className="mt-6 space-y-4">
        {NIVELES.map((n) => {
          const va = ca?.[n] ?? 0;
          const vb = cb?.[n] ?? 0;
          const mx = Math.max(va, vb, 1);
          return (
            <div key={n}>
              <p className="etiqueta-mono mb-1.5 text-center">{NIVEL_LABEL[n].plural}</p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="flex items-center justify-end gap-2">
                  <span className={cn("font-mono text-lg font-bold tabular-nums", va > vb ? "text-granate" : "text-inkSoft")}>{numero(va)}</span>
                  <span className="h-3 overflow-hidden rounded-l-full bg-paperDeep" style={{ width: "100%", maxWidth: "9rem" }}>
                    <span
                      className="ml-auto block h-full rounded-l-full bg-granate transition-[width] duration-panel ease-salida"
                      style={{ width: `${(va / mx) * 100}%`, opacity: va >= vb ? 1 : 0.45 }}
                    />
                  </span>
                </div>
                <span aria-hidden className="h-5 w-px bg-paperEdge" />
                <div className="flex items-center gap-2">
                  <span className="h-3 overflow-hidden rounded-r-full bg-paperDeep" style={{ width: "100%", maxWidth: "9rem" }}>
                    <span
                      className="block h-full rounded-r-full bg-[#6C8CFF] transition-[width] duration-panel ease-salida"
                      style={{ width: `${(vb / mx) * 100}%`, opacity: vb >= va ? 1 : 0.45 }}
                    />
                  </span>
                  <span className={cn("font-mono text-lg font-bold tabular-nums", vb > va ? "text-[#8FA6FF]" : "text-inkSoft")}>{numero(vb)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-5 border-t border-line pt-3 text-[12.5px] leading-snug text-mute">
        Cuántos gobiernos ganó cada una, no cuántos hizo bien o mal. Un movimiento regional sólo compite en su región.
      </p>
    </div>
  );
}

function Selector({
  valor,
  onChange,
  opciones,
  d,
  etiqueta,
}: {
  valor: number;
  onChange: (o: number) => void;
  opciones: number[];
  d: AutoridadesDatos;
  etiqueta: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">{etiqueta}</span>
      <select
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full min-w-0 truncate rounded-lg border border-line bg-paperDeep px-2.5 py-2 text-[13px] font-semibold text-ink"
      >
        {opciones.map((o) => (
          <option key={o} value={o}>
            {orgDe(d, o).n}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ───────────────────────── Mi distrito ───────────────────────── */

export function MiDistrito({
  d,
  anio,
  datos,
}: {
  d: AutoridadesDatos;
  anio: number;
  datos: Partial<Record<number, AutoridadesDatos>>;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [copiado, setCopiado] = useState(false);

  const indice = useMemo(() => d.distrital.map((x, i) => ({ i, k: normalizar(`${x.n} ${x.pv}`) })), [d.distrital]);
  const resultados = useMemo(() => {
    const k = normalizar(q);
    if (k.length < 2) return [];
    return indice
      .filter((x) => x.k.includes(k))
      .slice(0, 8)
      .map((x) => x.i);
  }, [indice, q]);

  const dist = sel != null ? d.distrital[sel] : null;
  const prov = dist ? d.provincial.find((p) => p.u === dist.u) : null;
  const reg = dist ? d.regional.find((g) => g.u === dist.u.slice(0, 2)) : null;

  const texto = dist
    ? `En ${dist.n} (${dist.pv}) ganó ${orgDe(d, dist.o).n} en ${anio}${pct(dist.p) ? ` (${pct(dist.p)} de los votos)` : ""}. Mira quién gobierna tu distrito en Vigía Perú.`
    : "";

  return (
    <div>
      <p className="text-[13px] leading-snug text-mute">Escribe el nombre de tu distrito y mira quién ganó en {anio}.</p>
      <label className="relative mt-3 block">
        <span className="sr-only">Buscar un distrito</span>
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(null);
          }}
          placeholder="Ej. Miraflores, Yanahuara, Huanta…"
          className="w-full rounded-lg border border-line bg-paperDeep py-2.5 pl-9 pr-9 text-[15px] text-ink placeholder:text-mute"
        />
        {q && (
          <button
            type="button"
            aria-label="Borrar búsqueda"
            onClick={() => {
              setQ("");
              setSel(null);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-mute hover:text-ink"
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </label>

      {!dist && resultados.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-lg border border-line">
          {resultados.map((i) => {
            const x = d.distrital[i];
            return (
              <li key={i} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setSel(i)}
                  className="flex w-full items-baseline justify-between gap-3 bg-paperSoft px-3 py-2.5 text-left hover:bg-paperDeep"
                >
                  <span className="text-[14px] font-semibold text-ink">{x.n}</span>
                  <span className="truncate text-[12.5px] text-mute">
                    {x.pv}, {nombreDepartamento(x.u)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!dist && q.trim().length >= 2 && resultados.length === 0 && (
        <p className="mt-3 text-[13px] text-mute">No encontramos ese distrito en los resultados de {anio}.</p>
      )}

      {dist && (
        <div className="mt-4 rounded-xl border border-granate/50 bg-granate-50 p-4">
          <p className="etiqueta-mono">
            {dist.n}, {dist.pv}, {nombreDepartamento(dist.u)}
          </p>
          <p className="mt-2 font-display text-[22px] font-bold leading-tight text-ink">{orgDe(d, dist.o).n}</p>
          <p className="mt-1 text-[14px] text-inkSoft">
            {NIVEL_LABEL.distrital.cargo}: <span className="font-semibold text-ink">{dist.a}</span>
          </p>
          <p className="mt-1 text-[13px] text-mute">
            {TIPO_ORG_LABEL[orgDe(d, dist.o).t]}
            {pct(dist.p) ? `, ${pct(dist.p)} de los votos` : ""}
          </p>
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[13px] text-inkSoft">
            {prov && (
              <li>
                Provincia de {prov.n}: <span className="font-semibold text-ink">{orgDe(d, prov.o).n}</span>
              </li>
            )}
            {reg && (
              <li>
                Región {nombreDepartamento(dist.u)}: <span className="font-semibold text-ink">{orgDe(d, reg.o).n}</span>
              </li>
            )}
          </ul>
          {/* Cómo votó este distrito en cada elección cargada. */}
          <ol className="mt-3 space-y-1 border-t border-line pt-3">
            {PERIODOS.filter((p) => p.cargado).map((p) => {
              const g = ganoDistrito(datos[p.anio], dist.pv, dist.n);
              return (
                <li key={p.anio} className={cn("grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 text-[13px]", p.anio === anio ? "text-ink" : "text-inkSoft")}>
                  <span className="font-mono tabular-nums text-mute">{p.anio}</span>
                  <span className={cn("truncate", p.anio === anio && "font-semibold")} title={g?.org.n}>
                    {g ? `${g.org.n}, ${g.persona}` : datos[p.anio] ? "Sin dato" : "Cargando"}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={`/app/entidades?q=${encodeURIComponent(`Municipalidad Distrital de ${dist.n}`)}`}
              className="inline-flex min-h-11 items-center rounded-full bg-granate px-4 text-[14px] font-semibold text-paper hover:bg-granate-deep"
            >
              Ver sus contratos en Vigía
            </a>
            <button
              type="button"
              onClick={async () => {
                try {
                  if (navigator.share) await navigator.share({ text: texto, url: location.href });
                  else {
                    await navigator.clipboard.writeText(`${texto} ${location.href}`);
                    setCopiado(true);
                    setTimeout(() => setCopiado(false), 2000);
                  }
                } catch {
                  /* el usuario canceló */
                }
              }}
              className="inline-flex min-h-11 items-center rounded-full border border-paperEdge px-4 text-[14px] font-semibold text-ink hover:bg-paperSoft"
            >
              {copiado ? "Copiado" : "Compartir"}
            </button>
            <button type="button" onClick={() => setSel(null)} className="inline-flex min-h-11 items-center px-2 text-[13px] text-mute hover:text-ink">
              Otro distrito
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
