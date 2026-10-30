"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Partes } from "@/components/ui/Partes";
import { Ayuda } from "@/components/patrones/Ayuda";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";
import { puedeVerSeccion, type Rol } from "@/lib/permisos";
import {
  CATEGORIA_BITACORA,
  claseBoton,
  EmptyState,
  ErrorBanner,
  FilterChips,
  Punto,
  SkeletonTabla,
  actorCorto,
  fmtFechaHora,
  leerAccion,
  type AccionLegible,
  type CategoriaBitacora,
  type EntradaBitacora,
} from "@/components/admin/ui";

/**
 * Bitácora: toda acción administrativa, con autor y fecha, en frases. Una sola columna en orden (la más nueva
 * arriba) con el día como encabezado de grupo: antes los días se repartían en dos columnas tipo mosaico y no se
 * sabía en qué orden leerlos. Filtros en una fila: el tipo de acción en chips con su conteo y «Quién» en un
 * desplegable (eran 12 chips en dos renglones). De a 25 entradas por página. Cada entrada mide 1–2 renglones: el
 * objeto que tocó es el enlace para abrirlo y la flecha de la derecha despliega sus datos técnicos (el JSON crudo);
 * antes eran dos botones por entrada.
 * Fuente: GET /api/admin/log (últimas 100)
 */

const POR_PAGINA = 25;
/** El API devuelve como mucho 100 (LIMIT 100): con eso la lista está cortada y las anteriores siguen en la base. */
const TOPE_API = 100;
/** Chips en UNA fila que se desliza de costado, sin barra; el margen negativo con su relleno deja ver el anillo de foco. */
const FILA_CHIPS = "-m-1 min-w-0 flex-nowrap overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

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
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false });

export default function BitacoraPage() {
  const { data, error, isLoading, isValidating, mutate } = useAdmin<{ data: EntradaBitacora[] }>("/log");
  const [cat, setCat] = useState<CategoriaBitacora | "todas">("todas");
  const [actor, setActor] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const caja = useRef<HTMLDivElement>(null);
  const { rol } = useSesionEquipo();

  // La más nueva arriba. El API ya las manda así, pero en esta página el orden ES lo que se lee: no se deja al azar.
  const entradas = useMemo(
    () =>
      (data?.data ?? [])
        .map((e) => ({ e, a: leerAccion(e) }))
        .sort((x, y) => new Date(y.e.createdAt).getTime() - new Date(x.e.createdAt).getTime()),
    [data],
  );
  const cuentas = useMemo(() => {
    const c: Record<string, number> = {};
    for (const { a } of entradas) c[a.categoria] = (c[a.categoria] ?? 0) + 1;
    return c;
  }, [entradas]);
  // «Quién»: cada autor con cuántas acciones suyas hay. Lo de antes de la @ alcanza para reconocerlo; si dos correos
  // lo comparten, va el correo entero (en un desplegable no hay `title` que lo aclare, como en los chips de antes).
  const actores = useMemo(() => {
    const n = new Map<string, number>();
    for (const { e } of entradas) n.set(e.actor, (n.get(e.actor) ?? 0) + 1);
    const lista = Array.from(n, ([quien, cuenta]) => ({ quien, cuenta })).sort((x, y) => (x.quien ?? "").localeCompare(y.quien ?? "", "es"));
    const cortos = new Map<string, number>();
    for (const { quien } of lista) cortos.set(actorCorto(quien), (cortos.get(actorCorto(quien)) ?? 0) + 1);
    return lista.map((x) => ({ ...x, etiqueta: (cortos.get(actorCorto(x.quien)) ?? 0) > 1 ? x.quien : actorCorto(x.quien) }));
  }, [entradas]);
  // Si tras actualizar ya no hay acciones de quien estaba elegido, el filtro vuelve a «Todos» (no una lista vacía muda).
  const actorSel = actor && actores.some((x) => x.quien === actor) ? actor : null;
  const visibles = useMemo(
    () => entradas.filter(({ e, a }) => (cat === "todas" || a.categoria === cat) && (!actorSel || e.actor === actorSel)),
    [entradas, cat, actorSel],
  );

  // Páginas de a 25. Otro filtro vuelve a la primera (lo hacen los filtros); si la lista se achicó, queda en la última.
  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const actual = Math.min(pagina, paginas);
  const desde = (actual - 1) * POR_PAGINA;
  const enPagina = visibles.slice(desde, desde + POR_PAGINA);
  const cortada = entradas.length >= TOPE_API;

  // El encabezado de cada día dice cuántas acciones tiene con estos filtros, aunque una parte caiga en la página de al lado.
  const porDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const { e } of visibles) m.set(clave(e.createdAt), (m.get(clave(e.createdAt)) ?? 0) + 1);
    return m;
  }, [visibles]);

  // Agrupadas por día, en el orden de la lista: el día es el encabezado de su grupo, no una columna aparte.
  const dias: { clave: string; titulo: string; items: typeof enPagina }[] = [];
  for (const it of enPagina) {
    const k = clave(it.e.createdAt);
    const ult = dias[dias.length - 1];
    if (ult && ult.clave === k) ult.items.push(it);
    else dias.push({ clave: k, titulo: tituloDia(it.e.createdAt), items: [it] });
  }

  const opciones = [
    { valor: "todas" as const, etiqueta: "Todas", cuenta: entradas.length },
    ...(Object.keys(CATEGORIA_BITACORA) as CategoriaBitacora[])
      .filter((k) => cuentas[k])
      .map((k) => ({ valor: k, etiqueta: CATEGORIA_BITACORA[k].label, cuenta: cuentas[k], tono: CATEGORIA_BITACORA[k].tono })),
  ];

  function filtrarTipo(v: CategoriaBitacora | "todas") {
    setCat(v);
    setPagina(1);
  }
  function filtrarActor(v: string) {
    setActor(v || null);
    setPagina(1);
  }
  function irA(n: number) {
    setPagina(n);
    // Como el paginador de DataTable: si el comienzo de la lista quedó arriba de la pantalla, se lo trae a la vista.
    const el = caja.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }

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
      <div className="space-y-4">
        <ErrorBanner error={error} onReintentar={() => mutate()} />

        {data && entradas.length > 0 && (
          // Una fila: en el teléfono los chips se deslizan de costado y «Quién» baja a su propio renglón.
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <FilterChips<CategoriaBitacora | "todas"> etiqueta="Tipo de acción" valor={cat} onCambiar={filtrarTipo} opciones={opciones} className={FILA_CHIPS} />
            {actores.length > 1 && (
              <label className="flex shrink-0 items-center gap-2 text-rotulo font-medium text-inkSoft">
                Quién
                {/* 16 px en el teléfono: con menos, el celular hace zoom al tocar el desplegable. */}
                <select
                  value={actorSel ?? ""}
                  onChange={(ev) => filtrarActor(ev.target.value)}
                  className="min-h-[34px] min-w-0 flex-1 rounded-full border border-line bg-paperDeep px-3 text-destacado text-ink focus:border-granate/60 sm:flex-none sm:text-meta"
                >
                  <option value="">Todos ({entradas.length})</option>
                  {actores.map((x) => (
                    <option key={x.quien} value={x.quien}>
                      {`${x.etiqueta} (${x.cuenta})`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {!data ? (
          isLoading && <SkeletonTabla filas={6} columnas={3} />
        ) : !visibles.length ? (
          <div className="rounded-2xl border border-line bg-paperSoft">
            <EmptyState
              icono={<ScrollText size={18} />}
              titulo={entradas.length ? "Ninguna acción con estos filtros" : "Sin acciones registradas"}
              descripcion={entradas.length ? "Quita un filtro para ver el resto." : "Validar un aporte, publicar una alerta o editar un ajuste deja aquí una línea con tu correo."}
            />
          </div>
        ) : (
          // Una tarjeta: cada día es un encabezado con sus acciones debajo, separadas por líneas (nada de una caja por día).
          <div ref={caja} className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-paperSoft">
            {dias.map((d) => {
              const n = porDia.get(d.clave) ?? d.items.length;
              return (
                <section key={d.clave} className="border-t border-line first:border-t-0">
                  <h2 className="flex flex-wrap items-baseline gap-x-2 border-b border-line bg-paperDeep/50 px-4 py-1.5 text-meta font-semibold text-ink">
                    {d.titulo}
                    <span className="text-rotulo font-normal text-mute">
                      {n} {n === 1 ? "acción" : "acciones"}
                    </span>
                  </h2>
                  <ol className="divide-y divide-line">
                    {d.items.map(({ e, a }, i) => (
                      <FilaBitacora key={`${e.createdAt}|${e.accion}|${e.objeto}|${i}`} e={e} a={a} rol={rol} />
                    ))}
                  </ol>
                </section>
              );
            })}
            {(paginas > 1 || cortada) && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-meta text-inkSoft">
                <span className="flex items-center gap-1">
                  <span className="font-mono tabular-nums">
                    {(desde + 1).toLocaleString("es-PE")}–{(desde + enPagina.length).toLocaleString("es-PE")} de {visibles.length.toLocaleString("es-PE")}
                  </span>
                  {cortada && (
                    <Ayuda titulo="¿Y las acciones anteriores?">
                      Se muestran las últimas {TOPE_API} acciones; las anteriores siguen guardadas en la base.
                    </Ayuda>
                  )}
                </span>
                {paginas > 1 && (
                  <nav aria-label="Páginas de la bitácora" className="flex items-center gap-1.5">
                    <button type="button" onClick={() => irA(actual - 1)} disabled={actual <= 1} className={claseBoton("secundario", "xs")} aria-label="Página anterior">
                      <ChevronLeft size={14} aria-hidden />
                    </button>
                    <span className="min-w-[4.5rem] text-center font-mono tabular-nums" aria-live="polite">
                      {actual} / {paginas}
                    </span>
                    <button type="button" onClick={() => irA(actual + 1)} disabled={actual >= paginas} className={claseBoton("secundario", "xs")} aria-label="Página siguiente">
                      <ChevronRight size={14} aria-hidden />
                    </button>
                  </nav>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

/**
 * Enlace dentro de la frase, en vez del botón «Abrir»: el texto sigue en tinta y lo marca un subrayado lima tenue que
 * se enciende al pasar (con el gris de borde, `decoration-line`, de noche no se distinguía del texto).
 */
const ENLACE = "underline decoration-granate/40 underline-offset-2 transition-colors duration-rapido hover:decoration-granate";

/**
 * Una acción de la bitácora, en 1–2 renglones: hora, punto de su color, quién y qué hizo, y debajo el motivo o el
 * resultado si lo hay. Para abrir lo que tocó, el objeto («aporte VIG-…», «contrato 1226395») es el enlace; si la
 * acción no nombra uno («editó los medios de pago»), lo es la frase. Sólo se enlaza si quien mira puede entrar a esa
 * sección (a un revisor no se le ofrece Contribuciones ni Equipo; sin perfil todavía, tampoco).
 * La flecha de la derecha despliega los datos técnicos (correo completo, fecha exacta, código de la acción y el JSON
 * crudo): en el teléfono no hay `title` que muestre el correo ni la fecha. Es un botón aparte, no un <summary>, porque
 * un enlace dentro de un <summary> no se puede usar bien con teclado ni con lector de pantalla.
 */
function FilaBitacora({ e, a, rol }: { e: EntradaBitacora; a: AccionLegible; rol: Rol | null }) {
  const [abierto, setAbierto] = useState(false);
  const idDatos = useId();
  const href = a.href && (a.externo || (rol && puedeVerSeccion(rol, a.href.split("?")[0]))) ? a.href : null;
  const abrible = (texto: string, clase: string) =>
    href ? (
      <Link href={href} target={a.externo ? "_blank" : undefined} rel={a.externo ? "noopener noreferrer" : undefined} className={cn(clase, ENLACE)}>
        {texto}
        {a.externo && (
          <>
            <ExternalLink size={11} className="ml-1 inline-block" aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </>
        )}
      </Link>
    ) : (
      <span className={clase}>{texto}</span>
    );

  return (
    <li className="px-4 py-2 transition-colors duration-rapido hover:bg-paperDeep/40">
      <div
        // Con el mouse, toda la fila abre o cierra los datos (menos el enlace); el teclado usa la flecha.
        onClick={(ev) => {
          if (!(ev.target as HTMLElement).closest("a,button") && !window.getSelection()?.toString()) setAbierto((v) => !v);
        }}
        className="flex cursor-pointer items-start gap-3"
      >
        <time dateTime={e.createdAt} title={fmtFechaHora(e.createdAt) ?? undefined} className="w-11 shrink-0 pt-px font-mono text-rotulo text-mute">
          {hora(e.createdAt)}
        </time>
        <Punto tono={a.tono} className="mt-1.5" />
        <p className="relative min-w-0 flex-1 text-meta leading-snug">
          {/* Hueco para la flecha, flotando a la derecha y de un renglón de alto: acorta sólo el primero y el segundo usa
              todo el ancho (en el teléfono, un renglón menos). La flecha va al final, para que el lector de pantalla y el
              Tab lleguen primero a la frase y a su enlace. */}
          <span aria-hidden className="float-right ml-2 h-4 w-5" />
          <span className="font-medium text-ink" title={e.actor}>
            {actorCorto(e.actor)}
          </span>{" "}
          {a.objeto ? (
            <>
              <span className="text-inkSoft">{a.frase}:</span> {abrible(a.objeto, "text-ink")}
            </>
          ) : (
            abrible(a.frase, "text-inkSoft")
          )}
          {a.resumen && <span className="mt-0.5 block text-rotulo text-mute">{a.resumen}</span>}
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            aria-controls={idDatos}
            aria-label="Datos técnicos de la acción"
            title="Datos técnicos"
            className="absolute -right-2 -top-1.5 grid h-7 w-7 place-items-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
          >
            <ChevronDown size={14} className={cn("transition-transform duration-rapido", abierto && "rotate-180")} aria-hidden />
          </button>
        </p>
      </div>
      <div id={idDatos} hidden={!abierto} className="mt-1.5 sm:pl-[4.75rem]">
        <p className="text-micro font-medium text-mute">Datos técnicos de la acción</p>
        <p className="mt-0.5 break-words font-mono text-micro text-inkSoft">
          <Partes partes={[e.actor, fmtFechaHora(e.createdAt), e.accion, e.objeto]} />
        </p>
        {e.detalle != null ? (
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paperDeep/60 px-3 py-2 font-mono text-micro text-ink">
            {JSON.stringify(e.detalle, null, 2)}
          </pre>
        ) : (
          <p className="mt-0.5 text-micro text-mute">Sin más datos.</p>
        )}
      </div>
    </li>
  );
}
