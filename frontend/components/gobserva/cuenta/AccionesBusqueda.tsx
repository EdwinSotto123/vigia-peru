"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BellPlus, CheckCircle2, Download, Loader2, Lock } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, type Producto } from "@/lib/gobserva";
import { ErrorCuenta, crearAlerta, descargarCsv, type Frecuencia } from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { Aviso, CAMPO, ETIQUETA, chipsFiltros, filtrosDeBusqueda, nombreSugerido, useMe, useSesion } from "./comun";

/**
 * Lo que se hace con una búsqueda de la lista de un producto: guardarla como alerta (lo nuevo llega cada mañana o cada
 * semana) y bajarla en Excel (CSV, planes de pago). Sin cuenta, los dos llevan a crearla y vuelven aquí.
 */
export function AccionesBusqueda({ producto, base, className }: { producto: Producto; base: string; className?: string }) {
  const { loading, conCuenta } = useSesion();
  const { me } = useMe(producto);
  const ruta = usePathname();
  const sp = useSearchParams();
  const params = Object.fromEntries(sp.entries());
  const filtros = filtrosDeBusqueda(producto, params);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(() => nombreSugerido(producto, filtros));
  const [frecuencia, setFrecuencia] = useState<Frecuencia | null>(null);
  const [estado, setEstado] = useState<"" | "guardando" | "listo" | "bajando">("");
  const [mensaje, setMensaje] = useState<{ tono: "ok" | "error" | "nota"; texto: string } | null>(null);

  const aqui = `${base && ruta.startsWith(base) ? ruta.slice(base.length) || "/" : ruta}${sp.size ? `?${sp}` : ""}`;
  const entrar = rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent(aqui)}`);
  const lim = me?.producto?.limites;
  const diaria = !!lim?.frecuencias.includes("diaria");
  const frec: Frecuencia = frecuencia ?? (diaria ? "diaria" : "semanal");
  const chips = chipsFiltros(producto, filtros);

  if (loading) return <div aria-hidden className={cn("h-11 w-72 animate-pulse rounded-full bg-paperDeep", className)} />;

  async function guardarAlerta() {
    setMensaje(null);
    setEstado("guardando");
    try {
      await crearAlerta({ producto, nombre: nombre.trim() || nombreSugerido(producto, filtros), filtros, frecuencia: frec });
      setEstado("listo");
      setAbierto(false);
    } catch (e) {
      setEstado("");
      setMensaje({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos crear la alerta." });
    }
  }

  async function bajar() {
    setMensaje(null);
    setEstado("bajando");
    try {
      await descargarCsv(producto, filtros);
      setMensaje({ tono: "ok", texto: "Listo: el archivo se descargó. Ábrelo con Excel o Google Sheets." });
    } catch (e) {
      setMensaje({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos preparar el archivo." });
    } finally {
      setEstado("");
    }
  }

  return (
    <div className={cn("rounded-2xl border border-line bg-paper p-3 sm:p-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {estado === "listo" ? (
          <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-granate-50 px-4 text-dato font-semibold text-granate">
            <CheckCircle2 size={16} aria-hidden /> Alerta creada.
            <Link href={rutaEn(base, "/cuenta?tab=alertas")} className="underline">Verla</Link>
          </span>
        ) : conCuenta ? (
          <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className={claseAccion("primario")}>
            <BellPlus size={16} aria-hidden /> Crear alerta con esta búsqueda
          </button>
        ) : (
          <Link href={entrar} className={claseAccion("primario")}>
            <BellPlus size={16} aria-hidden /> Crear alerta con esta búsqueda
          </Link>
        )}
        {conCuenta && lim?.csv ? (
          <button type="button" onClick={() => void bajar()} disabled={estado === "bajando"} className={claseAccion("secundario")}>
            {estado === "bajando" ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <Download size={16} aria-hidden />} Descargar en Excel (CSV)
          </button>
        ) : (
          <Link href={conCuenta ? rutaEn(base, "/planes") : entrar} className={claseAccion("fantasma")} title="La descarga es de los planes de pago">
            <Lock size={15} aria-hidden /> Descargar en Excel
          </Link>
        )}
        {chips.length > 0 && <span className="text-meta text-mute">Con: {chips.join(", ")}</span>}
      </div>

      {abierto && conCuenta && (
        <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor="ab-nombre" className={ETIQUETA}>Nombre de la alerta</label>
            <input id="ab-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} className={CAMPO} />
          </div>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Cada cuánto</legend>
            {(["diaria", "semanal"] as const).map((f) => (
              <label key={f} className={cn("flex items-center gap-2 rounded-full border px-3.5 py-2 text-dato", frec === f ? "border-granate font-semibold text-ink" : "border-line text-inkSoft", f === "diaria" && !diaria && "cursor-not-allowed opacity-60")}>
                <input type="radio" name="ab-frec" checked={frec === f} disabled={f === "diaria" && !diaria} onChange={() => setFrecuencia(f)} className="accent-[rgb(var(--granate))]" />
                {f === "diaria" ? "Cada mañana" : "Cada semana"}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="button" onClick={() => void guardarAlerta()} disabled={estado === "guardando"} className={claseAccion("primario")}>
              {estado === "guardando" && <Loader2 size={15} aria-hidden className="animate-spin" />} Guardar la alerta
            </button>
            <button type="button" onClick={() => setAbierto(false)} className={claseAccion("fantasma")}>Cancelar</button>
            {!diaria && <span className="text-meta text-mute">Cada mañana es de los planes de pago.</span>}
          </div>
        </div>
      )}
      {mensaje && (
        <Aviso tono={mensaje.tono} className="mt-3">
          {mensaje.texto}{" "}
          {mensaje.tono === "error" && /plan|alertas/i.test(mensaje.texto) && (
            <Link href={rutaEn(base, "/planes")} className="font-semibold underline">Ver los planes</Link>
          )}
        </Aviso>
      )}
    </div>
  );
}
