"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, RefreshCw, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Partes } from "@/components/ui/Partes";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";
import { puedeVerSeccion, type Rol } from "@/lib/permisos";
import {
  CATEGORIA_BITACORA,
  Chip,
  claseBoton,
  EmptyState,
  ErrorBanner,
  FilterChips,
  PageSection,
  Punto,
  SkeletonTabla,
  actorCorto,
  flechasRadio,
  fmtFechaHora,
  leerAccion,
  type AccionLegible,
  type CategoriaBitacora,
  type EntradaBitacora,
} from "@/components/admin/ui";

/**
 * Bitácora: toda acción administrativa, con autor y fecha, agrupada por día y en frases.
 * Cada entrada se abre para ver sus datos; el JSON crudo queda plegado para depurar.
 * Fuente: GET /api/admin/log (últimas 100)
 */

const clave = (iso: string) => new Date(iso).toLocaleDateString("en-CA"); // AAAA-MM-DD local
function tituloDia(iso: string): string {
  const hoy = clave(new Date().toISOString());
  const ayer = clave(new Date(Date.now() - 864e5).toISOString());
  const k = clave(iso);
  if (k === hoy) return "Hoy";
  if (k === ayer) return "Ayer";
  const d = new Date(iso);
  const txt = d.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
// En el teléfono los botones van debajo del texto, alineados con él (hora + punto = 4.75rem, menos el relleno del botón).
const ACCIONES = "flex shrink-0 items-center gap-1 pl-[4.25rem] sm:pl-0";
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false });

export default function BitacoraPage() {
  const { data, error, isLoading, isValidating, mutate } = useAdmin<{ data: EntradaBitacora[] }>("/log");
  const [cat, setCat] = useState<CategoriaBitacora | "todas">("todas");
  const [actor, setActor] = useState<string | null>(null);
  const { rol } = useSesionEquipo();

  const entradas = useMemo(() => (data?.data ?? []).map((e) => ({ e, a: leerAccion(e) })), [data]);
  const cuentas = useMemo(() => {
    const c: Record<string, number> = {};
    for (const { a } of entradas) c[a.categoria] = (c[a.categoria] ?? 0) + 1;
    return c;
  }, [entradas]);
  const actores = useMemo(() => Array.from(new Set(entradas.map(({ e }) => e.actor))).sort(), [entradas]);
  const visibles = entradas.filter(({ e, a }) => (cat === "todas" || a.categoria === cat) && (!actor || e.actor === actor));

  // Agrupadas por día, en el orden en que llegan (más reciente primero).
  const dias: { titulo: string; items: typeof visibles }[] = [];
  for (const it of visibles) {
    const t = tituloDia(it.e.createdAt);
    const ult = dias[dias.length - 1];
    if (ult && ult.titulo === t) ult.items.push(it);
    else dias.push({ titulo: t, items: [it] });
  }

  const opciones = [
    { valor: "todas" as const, etiqueta: "Todas", cuenta: entradas.length },
    ...(Object.keys(CATEGORIA_BITACORA) as CategoriaBitacora[])
      .filter((k) => cuentas[k])
      .map((k) => ({ valor: k, etiqueta: CATEGORIA_BITACORA[k].label, cuenta: cuentas[k], tono: CATEGORIA_BITACORA[k].tono })),
  ];

  return (
    <AdminShell
      title="Bitácora"
      subtitle="Toda acción administrativa queda registrada con autor y fecha"
      actions={
        <button onClick={() => mutate()} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-6">
        <ErrorBanner error={error} onReintentar={() => mutate()} />

        {data && entradas.length > 0 && (
        <div className="space-y-2">
          <FilterChips<CategoriaBitacora | "todas"> etiqueta="Tipo de acción" valor={cat} onCambiar={setCat} opciones={opciones} />
          {actores.length > 1 && (
            <div role="radiogroup" aria-labelledby="bitacora-quien" onKeyDown={flechasRadio} className="flex flex-wrap items-center gap-1.5">
              <span id="bitacora-quien" className="mr-1 text-[12px] font-medium text-inkSoft">Quién</span>
              <Chip rol="radio" activo={!actor} onClick={() => setActor(null)}>Todos</Chip>
              {actores.map((a) => <Chip key={a} rol="radio" activo={actor === a} onClick={() => setActor((x) => (x === a ? null : a))} title={a}>{actorCorto(a)}</Chip>)}
            </div>
          )}
        </div>
        )}

        {!data ? (
          isLoading && <SkeletonTabla filas={6} columnas={3} />
        ) : !visibles.length ? (
          <div className="rounded-2xl border border-line bg-paper">
            <EmptyState
              icono={<ScrollText size={18} />}
              titulo={entradas.length ? "Ninguna acción con estos filtros" : "Sin acciones registradas"}
              descripcion={entradas.length ? "Quita un filtro para ver el resto." : "Validar un aporte, publicar una alerta o editar un ajuste deja aquí una línea con tu correo."}
            />
          </div>
        ) : (
          dias.map((d) => (
            <PageSection key={d.titulo} titulo={d.titulo} meta={`${d.items.length} ${d.items.length === 1 ? "acción" : "acciones"}`}>
              <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
                {d.items.map(({ e, a }, i) => <FilaBitacora key={`${e.createdAt}-${i}`} e={e} a={a} rol={rol} />)}
              </ol>
            </PageSection>
          ))
        )}

        {entradas.length >= 100 && <p className="text-[12px] text-inkSoft">Se muestran las últimas 100 acciones; las anteriores siguen guardadas en la base.</p>}
      </div>
    </AdminShell>
  );
}

/**
 * Una acción de la bitácora. "Abrir" sólo aparece si quien mira puede entrar a esa sección (a un
 * revisor no se le ofrece Contribuciones ni Equipo; sin perfil todavía, tampoco). "Datos" despliega
 * el detalle crudo: es un botón aparte, no un <summary>, porque un enlace dentro de un <summary> no
 * se puede usar bien con teclado ni con lector de pantalla.
 */
function FilaBitacora({ e, a, rol }: { e: EntradaBitacora; a: AccionLegible; rol: Rol | null }) {
  const [abierto, setAbierto] = useState(false);
  const idDatos = useId();
  const href = a.href && (a.externo || (rol && puedeVerSeccion(rol, a.href.split("?")[0]))) ? a.href : null;
  const conDatos = !!e.detalle;
  return (
    <li className="px-4 py-2.5">
      <div
        // Con el mouse, toda la fila abre o cierra los datos (como antes); el teclado usa el botón.
        onClick={conDatos ? (ev) => { if (!(ev.target as HTMLElement).closest("a,button") && !window.getSelection()?.toString()) setAbierto((v) => !v); } : undefined}
        className={cn("flex flex-col gap-1 rounded-lg sm:flex-row sm:items-start sm:justify-between sm:gap-2", conDatos && "cursor-pointer")}
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="w-11 shrink-0 pt-px font-mono text-[12px] text-mute" title={fmtFechaHora(e.createdAt) ?? undefined}>{hora(e.createdAt)}</span>
          <Punto tono={a.tono} className="mt-1.5" />
          <span className="min-w-0 text-[13px] leading-snug">
            <span className="font-medium text-ink" title={e.actor}>{actorCorto(e.actor)}</span>{" "}
            <span className="text-inkSoft">{a.frase}</span>
            {a.objeto && <span className="text-ink">: {a.objeto}</span>}
            {a.resumen && <span className="mt-0.5 block text-[12px] text-mute">{a.resumen}</span>}
          </span>
        </span>
        {(href || conDatos) && (
          <span className={ACCIONES}>
            {href && (
              <Link href={href} target={a.externo ? "_blank" : undefined} className={claseBoton("fantasma", "xs", "shrink-0")}>
                {a.externo ? <><ExternalLink size={11} aria-hidden /> Ver</> : "Abrir"}
              </Link>
            )}
            {conDatos && (
              <button
                type="button"
                onClick={() => setAbierto((v) => !v)}
                aria-expanded={abierto}
                aria-controls={idDatos}
                className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-[11px] text-inkSoft hover:bg-paperDeep"
              >
                Datos <ChevronDown size={12} className={cn("transition-transform duration-rapido", abierto && "rotate-180")} aria-hidden />
              </button>
            )}
          </span>
        )}
      </div>
      {conDatos && (
        <div id={idDatos} hidden={!abierto} className="mt-2 sm:ml-[4.75rem]">
          <p className="mb-1 text-[11px] font-medium text-mute">Datos técnicos de la acción</p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paperSoft px-3 py-2 font-mono text-[11px] text-ink">{JSON.stringify(e.detalle, null, 2)}</pre>
          <p className="mt-1 font-mono text-[11px] text-mute"><Partes partes={[e.accion, e.objeto]} /></p>
        </div>
      )}
    </li>
  );
}
