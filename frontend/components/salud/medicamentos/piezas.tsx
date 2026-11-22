import Link from "next/link";
import { ArrowUpRight, ChevronRight, FileText, Pill, Search, TriangleAlert } from "lucide-react";
import { Insignia, type Tono } from "@/components/gobserva/ui/Insignia";
import { rutaEn } from "@/lib/gobserva";
import { fechaCorta, numero, rutaMedicamento, soles, TIPOS_ALERTA, type AlertaDigemid, type Medicamento, type ObservadoAlerta, type TipoAlerta } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/**
 * Las piezas de «Medicamentos» en Gobserva Salud (2026-11-21, el usuario: «verificación de medicamentos»): el buscador, la
 * fila de un medicamento y la de una alerta DIGEMID. Server-safe.
 */

/** Mayúsculas de DIGEMID → «Panadol Antigripal»; las siglas cortas (MG, ML, NF) quedan como vienen. */
export function nombreMed(t: string | null | undefined): string {
  if (!t) return "";
  return t
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-záéíóúñ])/g, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(Mg|Ml|Mcg|Ui|Nf|Ifa|Sa|Sac|S\.a\.|Eirl|Srl|Ltd|Gmbh|Ag)\b/g, (m) => m.toUpperCase());
}

const TONO_ALERTA: Record<TipoAlerta, Tono> = {
  falsificado: "urgente",
  calidad: "aviso",
  seguridad: "aviso",
  modificacion: "neutro",
  internacional: "neutro",
  otra: "neutro",
};

export function InsigniaAlerta({ tipo, className }: { tipo: TipoAlerta; className?: string }) {
  return (
    <Insignia tono={TONO_ALERTA[tipo]} Icono={tipo === "falsificado" || tipo === "calidad" ? TriangleAlert : undefined} className={className}>
      {TIPOS_ALERTA[tipo].corto}
    </Insignia>
  );
}

/** El buscador (formulario GET, sin JavaScript): nombre, principio activo, registro sanitario o lote. */
export function FormMedicamento({ accion, q, grande = false, className }: { accion: string; q?: string; grande?: boolean; className?: string }) {
  return (
    <form role="search" action={accion} className={cn("flex flex-col gap-2 sm:flex-row", className)}>
      <label htmlFor="buscar-medicamento" className="sr-only">
        Nombre, principio activo, registro sanitario o lote
      </label>
      <div className="relative min-w-0 flex-1">
        <Pill size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
        <input
          id="buscar-medicamento"
          name="q"
          type="search"
          defaultValue={q}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Nombre, registro sanitario o lote"
          className={cn(
            "w-full rounded-xl border border-line bg-paper pl-11 pr-3 text-cuerpo text-ink placeholder:text-mute transition-colors duration-rapido focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30",
            grande ? "h-14" : "h-12",
          )}
        />
      </div>
      <button
        type="submit"
        className={cn(
          "gs-hunde inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-granate px-5 text-dato font-semibold text-paper hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2",
          grande ? "h-14" : "h-12",
        )}
      >
        <Search size={17} aria-hidden /> Verificar
      </button>
    </form>
  );
}

/** Una presentación en una lista: nombre, concentración y forma, registro y titular; a la derecha, el precio típico. */
export function FilaMedicamento({ m, base, destacar }: { m: Medicamento; base: string; destacar?: boolean }) {
  const generico = /^GEN/.test(m.clasificacion ?? "");
  const varias = (m.presentacionesN ?? 1) > 1;
  const rango = varias && m.precioMin != null && m.precioMax != null && m.precioMin !== m.precioMax;
  return (
    <Link
      href={rutaEn(base, rutaMedicamento(m.codigo))}
      prefetch={false}
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors duration-rapido hover:bg-ink/[0.03] sm:px-5",
        destacar && "bg-moss/[0.07]",
      )}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-cuerpo font-semibold text-ink group-hover:underline group-hover:decoration-granate/50 group-hover:underline-offset-4">{nombreMed(m.nombre)}</span>
          {m.concentracion && <span className="text-dato text-inkSoft">{m.concentracion.toLowerCase()}</span>}
          {generico && <Insignia tono="exito">Genérico</Insignia>}
        </p>
        <p className="mt-0.5 truncate text-meta text-mute">
          {/* La presentación distingue dos filas del mismo producto (frasco de 60 o de 120 mL). */}
          {[nombreMed(m.forma), varias ? `${m.presentacionesN} presentaciones` : nombreMed(m.presentacion), m.registro ? `R.S. ${m.registro}` : null, nombreMed(m.titular)].filter(Boolean).join(", ")}
        </p>
      </div>
      <div className="flex items-center gap-2 text-right">
        <div>
          <p className="font-display text-bloque font-bold tabular-nums text-ink">{rango ? `${soles(m.precioMin)} a ${m.precioMax!.toFixed(2)}` : soles(m.precioMediana)}</p>
          <p className="text-rotulo text-mute">{m.precioMediana != null || rango ? (rango ? "por unidad, según presentación" : "por unidad") : "sin reporte"}</p>
        </div>
        <ChevronRight size={16} aria-hidden className="shrink-0 text-mute group-hover:text-granate" />
      </div>
    </Link>
  );
}

/** Una alerta DIGEMID: tipo, número y fecha; el motivo; los productos; y el PDF oficial. */
export function FilaAlerta({ a, base, compacta = false, resaltar }: { a: AlertaDigemid; base?: string; compacta?: boolean; resaltar?: string | null }) {
  const observados = a.observados ?? [];
  // Las internacionales no traen productos ni motivo: su resumen repite el título y el botón «Descargar».
  const limpiar = (t: string | null) => (t ?? "").replace(/\s*Descargar\s*$/i, "").trim();
  const productos = limpiar(a.productos);
  const motivo = limpiar(a.motivo);
  const igualTitulo = (t: string) => t.toLowerCase().replace(/\W+/g, "") === a.titulo.toLowerCase().replace(/\W+/g, "");
  return (
    <article className={cn("min-w-0", compacta ? "py-3" : "px-4 py-4 sm:px-5")}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <InsigniaAlerta tipo={a.tipo} />
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-meta font-semibold text-ink underline-offset-4 hover:underline">
          {a.numero ? `Alerta N.° ${a.numero}` : a.titulo}
          <ArrowUpRight size={12} aria-hidden className="text-mute" />
          <span className="sr-only"> (en la web de DIGEMID, se abre en otra pestaña)</span>
        </a>
        <span className="text-meta text-mute">{fechaCorta(a.fecha)}</span>
      </p>
      {motivo && !igualTitulo(motivo) && <p className="mt-1.5 max-w-[80ch] text-dato font-semibold leading-snug text-ink">{motivo.charAt(0) + motivo.slice(1).toLowerCase()}</p>}
      {observados.length > 0 ? (
        <Observados items={observados} base={base} resaltar={resaltar} />
      ) : (
        productos && !igualTitulo(productos) && <p className="mt-1 text-dato leading-snug text-inkSoft">{productos}</p>
      )}
      {a.pdfUrl && (
        <a href={a.pdfUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-meta font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
          <FileText size={14} aria-hidden /> {observados.length ? "La alerta oficial en PDF" : "Ver el lote y el registro en el PDF"}
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      )}
    </article>
  );
}

/** «20250502QX» → lo mismo, sin signos, para comparar el lote escrito con el de la tabla. */
const juntoLote = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Los productos observados de una alerta (migración 443), en una tabla corta: el producto con su presentación, sus
 * lotes, el registro sanitario (a su ficha si está en el catálogo), el titular y el resultado. En el celular, cada
 * producto es un bloque. Hasta 4; el resto, en el PDF. `resaltar`: el lote o registro que se buscó, marcado.
 */
export function Observados({ items, base, resaltar }: { items: ObservadoAlerta[]; base?: string; resaltar?: string | null }) {
  const marca = resaltar ? juntoLote(resaltar) : null;
  const vistos = items.slice(0, 4);
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-paper">
      <p className="border-b border-line bg-paperSoft px-3 py-1.5 text-rotulo font-semibold text-mute">
        {items.length === 1 ? "Producto observado" : `${items.length} productos observados`}, según la tabla de la alerta
      </p>
      <ul className="divide-y divide-line">
        {vistos.map((o, i) => (
          <li key={`${o.producto}-${i}`} className="grid gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="text-dato font-semibold leading-snug text-ink">{o.producto}</p>
              {o.presentacion && <p className="text-meta text-inkSoft">{o.presentacion}</p>}
              {o.detalle && <p className="mt-0.5 text-meta leading-snug text-inkSoft">{o.detalle}</p>}
            </div>
            <dl className="min-w-0 text-meta">
              <dt className="text-rotulo text-mute">{o.lotes.length > 1 ? "Lotes" : "Lote"}</dt>
              <dd className="flex flex-wrap gap-1">
                {o.lotes.length ? (
                  o.lotes.map((l) => (
                    <span
                      key={l}
                      className={cn(
                        "rounded-md px-1.5 py-0.5 font-mono tabular-nums",
                        marca && juntoLote(l) === marca ? "bg-crimson-soft font-semibold text-crimsonTexto ring-1 ring-crimson/40" : "bg-ink/[0.05] text-ink",
                      )}
                    >
                      {l}
                    </span>
                  ))
                ) : (
                  <span className="text-mute">No lo dice</span>
                )}
              </dd>
              {o.vencimientos.length > 0 && <dd className="mt-0.5 text-mute">Vence {o.vencimientos.join(", ")}</dd>}
            </dl>
            <dl className="min-w-0 text-meta">
              <dt className="text-rotulo text-mute">Registro sanitario</dt>
              <dd className={cn("font-mono", marca && o.registro && juntoLote(o.registro) === marca ? "font-semibold text-crimsonTexto" : "text-ink")}>
                {o.registro ? (
                  o.medicamento && base ? (
                    <Link href={rutaEn(base, rutaMedicamento(o.medicamento))} className="underline decoration-line underline-offset-2 hover:decoration-granate">
                      {o.registro}
                    </Link>
                  ) : (
                    o.registro
                  )
                ) : (
                  <span className="font-sans text-mute">No lo dice</span>
                )}
              </dd>
              {o.titular && <dd className="mt-0.5 truncate text-inkSoft" title={o.titular}>{nombreMed(o.titular)}</dd>}
            </dl>
          </li>
        ))}
      </ul>
      {items.length > vistos.length && <p className="border-t border-line px-3 py-1.5 text-rotulo text-mute">Y {items.length - vistos.length} más en el PDF de la alerta.</p>}
    </div>
  );
}

/** Cuántas alertas hay en total, con la fecha de la última: lo que respalda un «ninguna alerta». */
export function textoRevisadas(alertas: number, ultima: string | null): string {
  return `Revisamos las ${numero(alertas)} alertas DIGEMID publicadas${ultima ? `, la última del ${fechaCorta(ultima)}` : ""}.`;
}
