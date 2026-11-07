"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { REGIONES_UBIGEO, nombreTipo } from "@/lib/licitaciones";
import { CONSULTAS, PUBLICADAS, TIPOS_PROCESO, filtrosActivos, normalizar, type TipoProceso } from "@/lib/licitaciones-app/filtros";
import type { Conteo } from "@/lib/licitaciones-app/tipos";
import { useLista } from "@/lib/licitaciones-app/useListaUrl";
import { numero, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Desplegable } from "../ui/Desplegable";

/**
 * Los filtros de la bandeja, cada uno en su desplegable y con cuántas oportunidades hay en cada opción (las facetas del
 * adaptador, contadas con los demás filtros puestos). Cada cambio se aplica al toque y queda en la URL; el de valor, al
 * pulsar «Aplicar», porque escribir un monto no es elegirlo.
 */
export function Filtros({ facetas, conSenal = true }: { facetas: { tipo: Conteo[]; region: Conteo[]; proc: Conteo[] }; conSenal?: boolean }) {
  const { filtros, ir, limpiar } = useLista();
  const n = (xs: Conteo[], k: string) => xs.find((x) => x.clave === k)?.n ?? 0;
  const alternar = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const valorPuesto = filtros.min != null || filtros.max != null;

  return (
    <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
      <Desplegable etiqueta="Tipo" cuenta={filtros.tipo.length}>
        {() => (
          <fieldset>
            <legend className="sr-only">Tipo de contratación</legend>
            {TIPOS_PROCESO.map((t) => (
              <Opcion key={t} tipo="checkbox" marcada={filtros.tipo.includes(t)} onChange={() => ir({ tipo: alternar<TipoProceso>(filtros.tipo, t) })} n={n(facetas.tipo, t)}>
                {nombreTipo(t)}
              </Opcion>
            ))}
          </fieldset>
        )}
      </Desplegable>

      <Desplegable etiqueta="Región" cuenta={filtros.region.length} ancho="sm:w-80">
        {() => <Regiones facetas={facetas.region} />}
      </Desplegable>

      <Desplegable etiqueta="Procedimiento" activo={!!filtros.proc} ancho="sm:w-96">
        {(cerrar) => (
          <fieldset>
            <legend className="sr-only">Procedimiento de selección</legend>
            <Opcion tipo="radio" nombre="proc" marcada={!filtros.proc} onChange={() => { ir({ proc: "" }); cerrar(); }}>
              Todos los procedimientos
            </Opcion>
            {facetas.proc.map((p) => (
              <Opcion key={p.clave} tipo="radio" nombre="proc" marcada={filtros.proc === p.clave} onChange={() => { ir({ proc: p.clave }); cerrar(); }} n={p.n}>
                {p.clave}
              </Opcion>
            ))}
            {filtros.proc && !facetas.proc.some((p) => p.clave === filtros.proc) && (
              <Opcion tipo="radio" nombre="proc" marcada onChange={() => undefined} n={0}>
                {filtros.proc}
              </Opcion>
            )}
          </fieldset>
        )}
      </Desplegable>

      <Desplegable etiqueta="Valor" activo={valorPuesto} ancho="sm:w-80">
        {(cerrar) => <Valor cerrar={cerrar} />}
      </Desplegable>

      <Desplegable etiqueta="Consultas" activo={!!filtros.cons}>
        {(cerrar) => (
          <fieldset>
            <legend className="sr-only">Plazo de consultas y observaciones</legend>
            <Opcion tipo="radio" nombre="cons" marcada={!filtros.cons} onChange={() => { ir({ cons: null }); cerrar(); }}>
              Cualquier plazo
            </Opcion>
            {CONSULTAS.map((c) => (
              <Opcion key={c.clave} tipo="radio" nombre="cons" marcada={filtros.cons === c.clave} onChange={() => { ir({ cons: c.clave }); cerrar(); }}>
                {c.etiqueta}
              </Opcion>
            ))}
          </fieldset>
        )}
      </Desplegable>

      <Desplegable etiqueta="Publicado" activo={filtros.pub !== 30}>
        {(cerrar) => (
          <fieldset>
            <legend className="sr-only">Publicado en</legend>
            {PUBLICADAS.map((d) => (
              <Opcion key={d} tipo="radio" nombre="pub" marcada={filtros.pub === d} onChange={() => { ir({ pub: d }); cerrar(); }}>
                En los últimos {d} días
              </Opcion>
            ))}
          </fieldset>
        )}
      </Desplegable>

      {conSenal && (
      <button
        type="button"
        aria-pressed={filtros.senal}
        onClick={() => ir({ senal: !filtros.senal })}
        className={cn(
          "inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-dato font-medium transition-colors duration-rapido",
          filtros.senal ? "border-granate/50 bg-granate-50 text-ink" : "border-line bg-caja text-inkSoft hover:border-ink/20 hover:text-ink",
        )}
      >
        <AlertTriangle size={15} aria-hidden className={filtros.senal ? "text-crimsonTexto" : ""} />
        Con señales de riesgo
      </button>
      )}

      {filtrosActivos(filtros) > 0 && (
        <button type="button" onClick={limpiar} className="inline-flex min-h-10 items-center rounded-lg px-2 text-dato font-semibold text-granate underline-offset-4 hover:underline">
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

/** Una opción de un desplegable: casilla o radio, su nombre y cuántas hay. */
function Opcion({
  tipo, nombre, marcada, onChange, n, children,
}: {
  tipo: "checkbox" | "radio";
  nombre?: string;
  marcada: boolean;
  onChange: () => void;
  n?: number;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-dato hover:bg-ink/[0.045]", marcada ? "font-semibold text-ink" : "text-inkSoft")}>
      <input type={tipo} name={nombre} checked={marcada} onChange={onChange} className="h-4 w-4 shrink-0 accent-[rgb(var(--granate))]" />
      <span className="min-w-0 flex-1">{children}</span>
      {n != null && <span className={cn("shrink-0 text-meta tabular-nums", n === 0 ? "text-mute/70" : "text-mute")}>{numero(n)}</span>}
    </label>
  );
}

/** Las 25 regiones, con buscador: primero las que tienen oportunidades, de más a menos. */
function Regiones({ facetas }: { facetas: Conteo[] }) {
  const { filtros, ir } = useLista();
  const [q, setQ] = useState("");
  const lista = useMemo(() => {
    const n = (u: string) => facetas.find((f) => f.clave === u)?.n ?? 0;
    return REGIONES_UBIGEO.map((r) => ({ ...r, n: n(r.ubigeo) }))
      .filter((r) => !q || normalizar(r.nombre).includes(normalizar(q)))
      .sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, "es"));
  }, [facetas, q]);
  return (
    <fieldset>
      <legend className="sr-only">Región</legend>
      <label className="relative mb-2 block">
        <span className="sr-only">Buscar una región</span>
        <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar región"
          className="h-10 w-full rounded-lg border border-line bg-caja pl-9 pr-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
        />
      </label>
      {lista.length === 0 && <p className="px-2 py-3 text-meta text-mute">Ninguna región se llama así.</p>}
      {lista.map((r) => (
        <Opcion
          key={r.ubigeo}
          tipo="checkbox"
          marcada={filtros.region.includes(r.ubigeo)}
          onChange={() => ir({ region: filtros.region.includes(r.ubigeo) ? filtros.region.filter((x) => x !== r.ubigeo) : [...filtros.region, r.ubigeo] })}
          n={r.n}
        >
          {r.nombre}
        </Opcion>
      ))}
    </fieldset>
  );
}

const RANGOS = [
  { etiqueta: "Hasta S/ 100 mil", min: null, max: 100_000 },
  { etiqueta: "De S/ 100 mil a S/ 1 M", min: 100_000, max: 1_000_000 },
  { etiqueta: "Más de S/ 1 M", min: 1_000_000, max: null },
] as const;

/** El rango de valor referencial: atajos y dos campos que se validan antes de aplicar. */
function Valor({ cerrar }: { cerrar: () => void }) {
  const { filtros, ir } = useLista();
  const [min, setMin] = useState(filtros.min?.toString() ?? "");
  const [max, setMax] = useState(filtros.max?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const leer = (t: string) => (t.trim() ? Number(t.replace(/[\s,]/g, "")) : null);

  const aplicar = () => {
    const a = leer(min);
    const b = leer(max);
    if ((a != null && (!Number.isFinite(a) || a < 0)) || (b != null && (!Number.isFinite(b) || b < 0))) return setError("Escribe montos en soles, sólo con números.");
    if (a != null && b != null && a > b) return setError("El «desde» no puede ser mayor que el «hasta».");
    setError(null);
    ir({ min: a, max: b });
    cerrar();
  };

  return (
    <div>
      <p className="px-1 text-meta text-inkSoft">Valor referencial. Las que no publicaron su valor quedan fuera del rango.</p>
      <div className="mt-2 flex flex-col gap-1">
        {RANGOS.map((r) => (
          <button
            key={r.etiqueta}
            type="button"
            onClick={() => {
              ir({ min: r.min, max: r.max });
              cerrar();
            }}
            className={cn(
              "min-h-10 rounded-lg px-2 text-left text-dato hover:bg-ink/[0.045]",
              filtros.min === r.min && filtros.max === r.max ? "font-semibold text-ink" : "text-inkSoft",
            )}
          >
            {r.etiqueta}
          </button>
        ))}
      </div>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          aplicar();
        }}
        className="mt-2 border-t border-line pt-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0">
            <span className="mb-1 block text-meta font-semibold text-ink">Desde (S/)</span>
            <input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} placeholder="0" aria-invalid={!!error} className={CAMPO} />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-meta font-semibold text-ink">Hasta (S/)</span>
            <input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} placeholder="Sin tope" aria-invalid={!!error} className={CAMPO} />
          </label>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-meta font-medium text-crimsonTexto">
            {error}
          </p>
        )}
        {(filtros.min != null || filtros.max != null) && (
          <p className="mt-2 text-meta text-mute">
            Ahora: {filtros.min != null ? `desde ${solesCompacto(filtros.min)}` : ""} {filtros.max != null ? `hasta ${solesCompacto(filtros.max)}` : ""}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          {(filtros.min != null || filtros.max != null) && (
            <button
              type="button"
              onClick={() => {
                ir({ min: null, max: null });
                cerrar();
              }}
              className="min-h-10 rounded-lg px-3 text-dato font-semibold text-inkSoft hover:bg-ink/[0.06]"
            >
              Quitar
            </button>
          )}
          <button type="submit" className="min-h-10 rounded-lg bg-granate px-4 text-dato font-semibold text-paper hover:bg-granate-deep">
            Aplicar
          </button>
        </div>
      </form>
    </div>
  );
}

const CAMPO =
  "h-10 w-full rounded-lg border border-line bg-caja px-3 text-destacado tabular-nums text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 aria-[invalid=true]:border-crimson sm:text-dato";
