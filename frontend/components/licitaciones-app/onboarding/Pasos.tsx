"use client";

import { useState } from "react";
import useSWR from "swr";
import { Building2, Check, HardHat, Lightbulb, Loader2, Package, Plus, Wrench, X } from "lucide-react";
import { REGIONES_UBIGEO } from "@/lib/licitaciones";
import { API_PUBLICA } from "@/lib/api-client";
import { TIPOS_PROCESO, type TipoProceso } from "@/lib/licitaciones-app/filtros";
import { MAX_PALABRAS, agregarPalabras, sugerirPalabras, type PerfilEmpresa } from "@/lib/licitaciones-app/onboarding";
import { numero, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";

type Cambiar = (c: Partial<PerfilEmpresa>) => void;

const CAMPO =
  "w-full rounded-lg border border-line bg-caja px-3.5 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";
const ETIQUETA = "mb-1.5 block text-dato font-semibold text-ink";

/** Cuántas oportunidades abiertas hay hoy con una palabra (la bandeja en vivo): para saber si la palabra sirve. */
function ConteoPalabra({ palabra }: { palabra: string }) {
  const { data, isLoading } = useSWR(["onb-conteo", palabra], async () => {
    const r = await fetch(`${API_PUBLICA}/licitaciones/bandeja?q=${encodeURIComponent(palabra)}&tam=10`);
    if (!r.ok) throw new Error("sin conteo");
    return ((await r.json()) as { total: number }).total;
  }, { revalidateOnFocus: false, shouldRetryOnError: false });
  if (isLoading) return <Loader2 size={12} aria-label="Contando" className="animate-spin text-mute" />;
  if (data == null) return null;
  return <span className={cn("tabular-nums", data === 0 ? "text-amberTexto" : "text-mute")}>{data === 0 ? "ninguna hoy" : `${numero(data)} abiertas`}</span>;
}

export function PasoEmpresa({ p, cambiar }: { p: PerfilEmpresa; cambiar: Cambiar }) {
  const [texto, setTexto] = useState("");
  const sugeridas = sugerirPalabras(`${p.nombre} ${p.descripcion}`, p.palabras);
  const sumar = (t: string) => {
    cambiar({ palabras: agregarPalabras(p.palabras, t) });
    setTexto("");
  };
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="onb-nombre" className={ETIQUETA}>Un nombre corto para lo que vendes</label>
        <input id="onb-nombre" value={p.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} maxLength={80} placeholder="Útiles de oficina" className={CAMPO} />
      </div>
      <div>
        <label htmlFor="onb-desc" className={ETIQUETA}>Qué vende tu empresa, en tus palabras</label>
        <textarea
          id="onb-desc"
          value={p.descripcion}
          onChange={(e) => cambiar({ descripcion: e.target.value })}
          rows={3}
          maxLength={1000}
          placeholder="Vendemos útiles de oficina, papel bond, tóner y cartuchos para impresoras, archivadores y material de escritorio."
          className={cn(CAMPO, "resize-y")}
        />
        <p className="mt-1.5 text-meta text-mute">Es lo que más pesa: con esto ordenamos las licitaciones y los contratos menores, de lo más parecido a lo menos.</p>
      </div>
      <div>
        <label htmlFor="onb-palabra" className={ETIQUETA}>
          Palabras clave <span className="font-normal text-mute">({p.palabras.length} de {MAX_PALABRAS})</span>
        </label>
        <div className="flex gap-2">
          <input
            id="onb-palabra"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                sumar(texto);
              }
            }}
            placeholder="tóner, papel bond"
            disabled={p.palabras.length >= MAX_PALABRAS}
            className={CAMPO}
          />
          <button
            type="button"
            onClick={() => sumar(texto)}
            disabled={!texto.trim() || p.palabras.length >= MAX_PALABRAS}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-caja px-3.5 text-dato font-semibold text-ink hover:border-ink/20 disabled:opacity-50"
          >
            <Plus size={16} aria-hidden /> Agregar
          </button>
        </div>
        {p.palabras.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tus palabras clave">
            {p.palabras.map((w) => (
              <li key={w} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-granate/40 bg-granate-50 pl-3 pr-1 text-meta">
                <span className="font-semibold text-ink">{w}</span>
                <ConteoPalabra palabra={w} />
                <button type="button" onClick={() => cambiar({ palabras: p.palabras.filter((x) => x !== w) })} aria-label={`Quitar «${w}»`} className="grid h-7 w-7 place-items-center rounded-full text-inkSoft hover:bg-caja hover:text-ink">
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {sugeridas.length > 0 && p.palabras.length < MAX_PALABRAS && (
          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-meta font-semibold text-inkSoft">
              <Lightbulb size={14} aria-hidden className="text-amberTexto" /> Sugeridas desde lo que escribiste
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {sugeridas.map((w) => (
                <li key={w}>
                  <button type="button" onClick={() => sumar(w)} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-line px-3 text-meta font-medium text-inkSoft hover:border-granate/50 hover:text-ink">
                    <Plus size={13} aria-hidden /> {w}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function PasoLugar({ p, cambiar }: { p: PerfilEmpresa; cambiar: Cambiar }) {
  const todo = p.regiones.length === 0;
  return (
    <div>
      <button
        type="button"
        onClick={() => cambiar({ regiones: [] })}
        aria-pressed={todo}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors duration-rapido",
          todo ? "border-granate bg-granate-50" : "border-line bg-caja hover:border-ink/20",
        )}
      >
        <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", todo ? "border-granate bg-granate text-paper" : "border-line")}>{todo && <Check size={12} strokeWidth={3} aria-hidden />}</span>
        <span>
          <span className="block text-dato font-semibold text-ink">Todo el Perú</span>
          <span className="block text-meta text-inkSoft">Vendes o despachas a cualquier región</span>
        </span>
      </button>
      <p className="mb-2 mt-5 text-dato font-semibold text-ink">O elige tus regiones</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {REGIONES_UBIGEO.map((r) => {
          const si = p.regiones.includes(r.ubigeo);
          return (
            <li key={r.ubigeo}>
              <button
                type="button"
                aria-pressed={si}
                onClick={() => cambiar({ regiones: si ? p.regiones.filter((x) => x !== r.ubigeo) : [...p.regiones, r.ubigeo] })}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-dato transition-colors duration-rapido",
                  si ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line bg-caja text-inkSoft hover:border-ink/20 hover:text-ink",
                )}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", si ? "border-granate bg-granate text-paper" : "border-line")}>{si && <Check size={11} strokeWidth={3} aria-hidden />}</span>
                {r.nombre}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const TIPO_INFO: Record<TipoProceso, { nombre: string; detalle: string; Icono: typeof Package }> = {
  bienes: { nombre: "Bienes", detalle: "Productos y suministros", Icono: Package },
  servicios: { nombre: "Servicios", detalle: "Limpieza, seguridad, mantenimiento…", Icono: Wrench },
  obras: { nombre: "Obras", detalle: "Construcción y mantenimiento", Icono: HardHat },
  consultoria: { nombre: "Consultoría", detalle: "Estudios, expedientes y supervisión", Icono: Building2 },
};

const RANGOS = [
  { clave: "todo", etiqueta: "Cualquier monto", min: null, max: null },
  { clave: "chico", etiqueta: "Hasta S/ 100 mil", min: null, max: 100_000 },
  { clave: "medio", etiqueta: "De S/ 100 mil a S/ 1 M", min: 100_000, max: 1_000_000 },
  { clave: "grande", etiqueta: "Más de S/ 1 M", min: 1_000_000, max: null },
] as const;

export function PasoContratos({ p, cambiar }: { p: PerfilEmpresa; cambiar: Cambiar }) {
  const rango = RANGOS.find((r) => r.min === p.min && r.max === p.max)?.clave ?? "otro";
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-dato font-semibold text-ink">Tipo de contratación <span className="font-normal text-mute">(ninguno marcado: todos)</span></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TIPOS_PROCESO.map((t) => {
            const si = p.tipos.includes(t);
            const { nombre, detalle, Icono } = TIPO_INFO[t];
            return (
              <button
                key={t}
                type="button"
                aria-pressed={si}
                onClick={() => cambiar({ tipos: si ? p.tipos.filter((x) => x !== t) : [...p.tipos, t] })}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors duration-rapido",
                  si ? "border-granate bg-granate-50" : "border-line bg-caja hover:border-ink/20",
                )}
              >
                <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", si ? "bg-granate text-paper" : "bg-ink/[0.06] text-inkSoft")}>
                  <Icono size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block text-dato font-semibold text-ink">{nombre}</span>
                  <span className="block text-meta text-inkSoft">{detalle}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-dato font-semibold text-ink">Tamaño del contrato (valor referencial)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {RANGOS.map((r) => (
            <label key={r.clave} className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-dato", rango === r.clave ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line bg-caja text-inkSoft")}>
              <input type="radio" name="onb-rango" checked={rango === r.clave} onChange={() => cambiar({ min: r.min, max: r.max })} className="h-4 w-4 accent-[rgb(var(--granate))]" />
              {r.etiqueta}
            </label>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="min-w-0">
            <span className="mb-1 block text-meta font-semibold text-inkSoft">O desde (S/)</span>
            <input inputMode="numeric" value={p.min ?? ""} onChange={(e) => cambiar({ min: e.target.value.trim() ? Math.max(0, Number(e.target.value.replace(/\D/g, ""))) : null })} placeholder="0" className={CAMPO} />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-meta font-semibold text-inkSoft">Hasta (S/)</span>
            <input inputMode="numeric" value={p.max ?? ""} onChange={(e) => cambiar({ max: e.target.value.trim() ? Math.max(0, Number(e.target.value.replace(/\D/g, ""))) : null })} placeholder="Sin tope" className={CAMPO} />
          </label>
        </div>
        <p className="mt-2 text-meta text-mute">Muchas entidades no publican el valor: con un rango, esas quedan fuera de tu bandeja.</p>
      </fieldset>
    </div>
  );
}

export function PasoAvisos({ p, cambiar, correo, conDiaria }: { p: PerfilEmpresa; cambiar: Cambiar; correo: string; conDiaria: boolean }) {
  return (
    <div className="space-y-5">
      <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4", p.alerta ? "border-granate bg-granate-50" : "border-line bg-caja")}>
        <input type="checkbox" checked={p.alerta} onChange={(e) => cambiar({ alerta: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[rgb(var(--granate))]" />
        <span>
          <span className="block text-dato font-semibold text-ink">Avisarme de lo nuevo que calce con mi perfil</span>
          <span className="block text-meta text-inkSoft">Te llega a {correo} y queda en tu cuenta. Lo cambias cuando quieras en Alertas.</span>
        </span>
      </label>
      {p.alerta && (
        <fieldset>
          <legend className="mb-2 text-dato font-semibold text-ink">¿Cada cuánto?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-dato", p.frecuencia === "semanal" ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line bg-caja text-inkSoft")}>
              <input type="radio" name="onb-frec" checked={p.frecuencia === "semanal"} onChange={() => cambiar({ frecuencia: "semanal" })} className="h-4 w-4 accent-[rgb(var(--granate))]" />
              Cada semana
            </label>
            <label className={cn("flex min-h-11 items-center gap-2.5 rounded-lg border px-3 text-dato", !conDiaria && "cursor-not-allowed opacity-60", p.frecuencia === "diaria" ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line bg-caja text-inkSoft")}>
              <input type="radio" name="onb-frec" disabled={!conDiaria} checked={p.frecuencia === "diaria"} onChange={() => cambiar({ frecuencia: "diaria" })} className="h-4 w-4 accent-[rgb(var(--granate))]" />
              Cada mañana {!conDiaria && <span className="text-meta font-normal text-mute">(con un plan)</span>}
            </label>
          </div>
        </fieldset>
      )}
      <Resumen p={p} />
    </div>
  );
}

/** Lo que se va a crear, antes de crearlo. */
function Resumen({ p }: { p: PerfilEmpresa }) {
  const regiones = p.regiones.length ? p.regiones.map((u) => REGIONES_UBIGEO.find((r) => r.ubigeo === u)?.nombre ?? u).join(", ") : "Todo el Perú";
  const tipos = p.tipos.length ? p.tipos.map((t) => TIPO_INFO[t].nombre).join(", ") : "Todos los tipos";
  const monto = p.min == null && p.max == null ? "Cualquier monto" : [p.min != null ? `desde ${solesCompacto(p.min)}` : "", p.max != null ? `hasta ${solesCompacto(p.max)}` : ""].join(" ").trim();
  return (
    <div className="rounded-xl border border-line bg-ink/[0.025] p-4">
      <p className="text-dato font-semibold text-ink">Tu perfil</p>
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-meta sm:grid-cols-2">
        <div><dt className="text-mute">Vendes</dt><dd className="font-medium text-ink">{p.nombre || "Sin nombre"}</dd></div>
        <div><dt className="text-mute">Palabras clave</dt><dd className="font-medium text-ink">{p.palabras.join(", ") || "Ninguna"}</dd></div>
        <div><dt className="text-mute">Dónde</dt><dd className="font-medium text-ink">{regiones}</dd></div>
        <div><dt className="text-mute">Qué y cuánto</dt><dd className="font-medium text-ink">{tipos}, {monto}</dd></div>
      </dl>
    </div>
  );
}
