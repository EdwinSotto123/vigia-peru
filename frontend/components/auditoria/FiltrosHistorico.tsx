"use client";

/**
 * Filtros de /app/auditoria: fecha y patrocinador (la región es FiltroRegion.tsx), más la
 * fila de filtros activos. Todos navegan por query params y caen al valor de la URL sin JS.
 * Cambiar cualquier filtro vuelve a la página 1 del histórico.
 *
 * Las fechas ya no son dos <input type="date"> crudos en la fila principal. Eran lo más
 * pesado visualmente de la pantalla —dos "dd/mm/aaaa" con icono de calendario nativo, sin
 * relación con el resto del sistema— y en 390 px se salían del contenedor. Ahora el control
 * es un botón que dice el rango vigente y abre un popover con los cuatro rangos que la gente
 * pide de verdad; el rango a medida sigue estando, un clic más adentro.
 *
 * El filtro puesto se ve y se quita DE A UNO en <FiltrosActivos>: antes el único botón era
 * "Limpiar", que borraba fecha y patrocinador juntos aunque quisieras soltar solo uno.
 */

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Loader2, Search, X } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import type { FinanciadorProcesamientos } from "@/lib/auditoria";

export function useNavegarFiltro() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendiente, start] = useTransition();

  const navegar = (cambios: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams?.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete("pagina"); // cualquier cambio de filtro vuelve a la página 1
    const qs = params.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return { navegar, pendiente };
}

/** YYYY-MM-DD de hace `dias` días, en hora local. */
function haceDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "17/09/26" a partir de YYYY-MM-DD, sin construir un Date (no hay zona horaria que desfasar). */
export function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y.slice(2)}` : iso;
}

export function etiquetaRango(desde?: string, hasta?: string): string {
  if (desde && hasta) return `${fechaCorta(desde)} – ${fechaCorta(hasta)}`;
  if (desde) return `desde ${fechaCorta(desde)}`;
  if (hasta) return `hasta ${fechaCorta(hasta)}`;
  return "Cualquier fecha";
}

const RANGOS: { dias: number; label: string }[] = [
  { dias: 7, label: "Últimos 7 días" },
  { dias: 30, label: "Últimos 30 días" },
  { dias: 90, label: "Últimos 3 meses" },
  { dias: 365, label: "Último año" },
];

export function FiltroFechas({ desde, hasta }: { desde?: string; hasta?: string }) {
  const { navegar, pendiente } = useNavegarFiltro();
  const hayRango = !!(desde || hasta);

  return (
    <Popover
      titulo="Fecha de entrada a la cola"
      anchoClase="w-[19rem]"
      className="w-full"
      trigger={
        <span
          className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
            hayRango ? "border-heroViolet/40 bg-heroViolet-soft text-ink" : "border-line bg-paper text-ink"
          }`}
        >
          <CalendarRange size={14} className="shrink-0 text-mute" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{etiquetaRango(desde, hasta)}</span>
          {pendiente && <Loader2 size={14} className="shrink-0 animate-spin text-mute" aria-label="Cargando" />}
        </span>
      }
    >
      <div className="grid gap-1">
        <button
          type="button"
          onClick={() => navegar({ desde: undefined, hasta: undefined })}
          className={`rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-paperSoft ${!hayRango ? "font-semibold text-ink" : "text-inkSoft"}`}
        >
          Cualquier fecha
        </button>
        {RANGOS.map((r) => (
          <button
            key={r.dias}
            type="button"
            onClick={() => navegar({ desde: haceDias(r.dias), hasta: undefined })}
            className="rounded-lg px-2 py-1.5 text-left text-[13px] text-inkSoft hover:bg-paperSoft"
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="mt-2 border-t border-line pt-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-mute">Rango a medida</div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] text-mute">Desde</span>
            <input
              type="date"
              value={desde ?? ""}
              max={hasta || undefined}
              onChange={(e) => navegar({ desde: e.target.value || undefined })}
              className="w-full min-w-0 rounded-lg border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-heroViolet/50 [color-scheme:light] dark:[color-scheme:dark]"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] text-mute">Hasta</span>
            <input
              type="date"
              value={hasta ?? ""}
              min={desde || undefined}
              onChange={(e) => navegar({ hasta: e.target.value || undefined })}
              className="w-full min-w-0 rounded-lg border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-heroViolet/50 [color-scheme:light] dark:[color-scheme:dark]"
            />
          </label>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-mute">
          Se filtra por la fecha en que el contrato entró a la cola, que es el único momento que siempre existe.
        </p>
      </div>
    </Popover>
  );
}

export function FiltroPatrocinador({ financiador, financiadores }: {
  financiador?: string;
  financiadores: FinanciadorProcesamientos[];
}) {
  const { navegar, pendiente } = useNavegarFiltro();
  const total = financiadores.reduce((s, f) => s + f.n, 0);
  return (
    <label
      className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm text-ink ${
        financiador ? "border-heroViolet/40 bg-heroViolet-soft" : "border-line bg-paper"
      }`}
    >
      <Search size={14} className="shrink-0 text-mute" aria-hidden />
      <span className="sr-only">Filtrar por quién lo pagó</span>
      <select
        value={financiador ?? ""}
        onChange={(e) => navegar({ financiador: e.target.value || undefined })}
        className="w-full min-w-0 bg-transparent pr-1 text-sm outline-none"
      >
        <option value="">
          {total > 0 ? `Lo pagó cualquiera (${total.toLocaleString("es-PE")} contratos)` : "Lo pagó cualquiera"}
        </option>
        {financiadores.map((f) => (
          <option key={f.nombre} value={f.nombre}>{f.nombre} ({f.n.toLocaleString("es-PE")})</option>
        ))}
      </select>
      {pendiente && <Loader2 size={14} className="shrink-0 animate-spin text-mute" aria-label="Cargando" />}
    </label>
  );
}

/**
 * Los filtros puestos, cada uno con su propia X. Sólo aparece cuando hay alguno: una fila
 * permanente que la mayor parte del tiempo dice "sin filtros" es ruido, no información.
 */
export function FiltrosActivos({ zona, ubigeo, desde, hasta, financiador }: {
  /** Nombre legible de la región (el ubigeo solo no le dice nada a nadie). */
  zona?: string;
  ubigeo?: string;
  desde?: string;
  hasta?: string;
  financiador?: string;
}) {
  const { navegar, pendiente } = useNavegarFiltro();
  const chips: { clave: string; texto: string; quitar: Record<string, undefined> }[] = [];
  if (ubigeo) chips.push({ clave: "ubigeo", texto: zona ?? `Ubigeo ${ubigeo}`, quitar: { ubigeo: undefined } });
  if (desde || hasta) chips.push({ clave: "fechas", texto: etiquetaRango(desde, hasta), quitar: { desde: undefined, hasta: undefined } });
  if (financiador) chips.push({ clave: "financiador", texto: `lo pagó ${financiador}`, quitar: { financiador: undefined } });
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="text-mute">Filtrando por</span>
      {chips.map((c) => (
        <button
          key={c.clave}
          type="button"
          onClick={() => navegar(c.quitar)}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-heroViolet/40 bg-heroViolet-soft py-0.5 pl-2.5 pr-1.5 font-medium text-ink transition-colors hover:border-heroViolet"
          aria-label={`Quitar el filtro ${c.texto}`}
        >
          <span className="min-w-0 truncate">{c.texto}</span>
          <X size={12} className="shrink-0 text-mute" aria-hidden />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={() => navegar({ ubigeo: undefined, desde: undefined, hasta: undefined, financiador: undefined })}
          className="rounded-full px-2 py-0.5 text-mute underline-offset-2 hover:text-ink hover:underline"
        >
          quitar los {chips.length}
        </button>
      )}
      {pendiente && <Loader2 size={12} className="animate-spin text-mute" aria-label="Cargando" />}
    </div>
  );
}
