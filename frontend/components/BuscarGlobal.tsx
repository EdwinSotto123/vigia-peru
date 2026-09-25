"use client";

/**
 * Búsqueda global (⌘K / Ctrl+K o el campo de la barra lateral del dashboard).
 * Busca OCID, código de alerta (OECE-…), código de aporte (VIG-…), RUC, entidad y zona;
 * muestra resultados agrupados (GET /buscar?q=). Teclado: ↑/↓ mueve, Enter abre, Esc cierra.
 *
 * El diálogo es un <dialog> nativo abierto con showModal() y montado con
 * createPortal(..., document.body). Las dos cosas hacen falta:
 *  - Antes se pintaba en el lugar donde vivía el disparador. Dentro de la barra
 *    lateral (que usa `transform` para deslizarse en móvil) y dentro del header
 *    (que usa `backdrop-filter`), un ancestro así se vuelve el "containing block"
 *    de cualquier `position: fixed`: el overlay medía 255×900 en la barra lateral
 *    (con el diálogo de 231 px, medio fuera de pantalla) y 1430×102 en el header,
 *    sin oscurecer ni cerrarse al hacer clic afuera.
 *  - El top layer de showModal() trae foco atrapado, fondo inerte y Escape.
 *    El portal lo saca además de cualquier ancestro `inert` (la barra lateral
 *    cerrada en móvil lo es), que dejaría el diálogo inerte también.
 * Es seguro en SSR: `open` arranca en false y el portal sólo se crea tras abrirlo.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, FileSearch, Building2, MapPin, Heart, Flag, Loader2, CornerDownLeft, X } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { numero, plural, soles } from "@/lib/formato";
import { cn } from "@/lib/utils";

interface Resultados {
  q: string;
  contratos: { ocid: string; codigo: string; titulo: string | null; entidad: string | null; montoPen: number | null; zona: string | null }[];
  entidades: { ruc: string; nombre: string; tipo: string | null; region: string | null; contratos: number }[];
  zonas: { ubigeo: string; nombre: string; nivel: string; totalCola: number; financiados: number }[];
  aportes: { codigo: string; estado: string; contratos: number; zona: string; financiador: string }[];
  alertas: { codigo: string; ocid: string | null; score: number | null; objeto: string | null; region: string | null; banderas: number }[];
}

interface Item { key: string; href: string; titulo: string; detalle: string; grupo: string; icon: React.ReactNode }

const vacio: Resultados = { q: "", contratos: [], entidades: [], zonas: [], aportes: [], alertas: [] };
/** Separador del detalle de cada resultado. No una coma: "S/ 45,000" ya lleva una. */
const SEP = " · ";

/**
 * Tres búsquedas de ejemplo, una por tipo de objeto. Son reales: verificadas contra
 * GET /buscar el 23-09-2026 (la región Cusco, la entidad con RUC 20177217043 y el
 * contrato 1225884 del Gobierno Regional de Puno). Si alguna deja de existir, se
 * cambia acá; nunca se rellena con un ejemplo inventado.
 */
const SUGERENCIAS: { q: string; tipo: string }[] = [
  { q: "Cusco", tipo: "región" },
  { q: "Municipalidad Provincial del Cusco", tipo: "entidad" },
  { q: "1225884", tipo: "contrato" },
];

export function BuscarGlobal({
  variant = "campo",
  className,
  atajo = true,
}: {
  variant?: "campo" | "boton";
  className?: string;
  /**
   * Si esta instancia escucha Ctrl+K. Cuando hay dos disparadores en la misma
   * pantalla (la barra lateral y la barra superior móvil del dashboard) sólo uno
   * debe hacerlo; si no, el atajo abriría dos diálogos a la vez.
   */
  atajo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Resultados>(vacio);
  const [cargando, setCargando] = useState(false);
  /** La búsqueda falló (red o servidor). Sin esto se leía "Sin resultados", que es otra cosa. */
  const [fallo, setFallo] = useState(false);
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const timer = useRef<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  /** Dónde estaba el foco antes de abrir: al cerrar sin navegar, vuelve ahí. */
  const volverA = useRef<HTMLElement | null>(null);
  const navegando = useRef(false);
  const idBase = useId();
  const listaId = `${idBase}-resultados`;
  const tituloId = `${idBase}-titulo`;

  const abrir = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) volverA.current = document.activeElement;
    navegando.current = false;
    setOpen(true);
  }, []);
  const cerrar = useCallback(() => setOpen(false), []);

  // ⌘K / Ctrl+K abre (Escape lo maneja el propio <dialog>).
  useEffect(() => {
    if (!atajo) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); abrir(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atajo, abrir]);

  // Abrir: al top layer, foco en el campo y el documento sin scroll detrás.
  // Cerrar: limpiar y devolver el foco a quien abrió (salvo que se haya navegado).
  useEffect(() => {
    if (!open) {
      // Una búsqueda pendiente o en vuelo no debe escribir resultados en un diálogo cerrado.
      if (timer.current) window.clearTimeout(timer.current);
      ctrl.current?.abort();
      setQ(""); setRes(vacio); setSel(0); setCargando(false); setFallo(false);
      return;
    }
    const d = dialogRef.current;
    if (d && !d.open) {
      try { d.showModal(); } catch { /* ya estaba abierto */ }
    }
    inputRef.current?.focus();
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
      if (!navegando.current) volverA.current?.focus?.();
    };
  }, [open]);

  // Debounce 220 ms + cancelación. Sólo la búsqueda vigente apaga el "buscando":
  // la que se canceló por una más nueva no toca el estado.
  useEffect(() => {
    if (!open) return;
    if (timer.current) window.clearTimeout(timer.current);
    const t = q.trim();
    setFallo(false);
    if (t.length < 2) { ctrl.current?.abort(); setRes(vacio); setCargando(false); return; }
    setCargando(true);
    timer.current = window.setTimeout(async () => {
      ctrl.current?.abort();
      const esta = new AbortController();
      ctrl.current = esta;
      try {
        const r = await fetch(`${PUBLIC_API_BASE}/buscar?q=${encodeURIComponent(t)}`, { signal: esta.signal });
        if (r.ok) { setRes((await r.json()) as Resultados); setSel(0); }
        else { setRes(vacio); setFallo(true); }
      } catch {
        // Abortada por una búsqueda más nueva: no es un fallo. Sin red, sí.
        if (!esta.signal.aborted) { setRes(vacio); setFallo(true); }
      } finally {
        if (ctrl.current === esta) setCargando(false);
      }
    }, 220);
  }, [q, open]);

  // El detalle de cada resultado usa los formatos de lib/formato (DESIGN_SYSTEM.md
  // §10.3). Los íconos van en tinta, no en granate: el granate es la marca y una
  // señal nunca se pinta con él. Sin puntaje: el puntaje no se muestra sin las
  // señales que lo explican (§10.4).
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const c of res.contratos) out.push({ key: `c-${c.ocid}`, grupo: "Contratos", href: `/app/contratos/${encodeURIComponent(c.ocid)}`, titulo: c.titulo ?? c.codigo, detalle: [c.codigo, c.entidad, c.zona, c.montoPen ? soles(c.montoPen) : null].filter(Boolean).join(SEP), icon: <FileSearch size={14} aria-hidden /> });
    for (const a of res.alertas) out.push({ key: `a-${a.codigo}`, grupo: "Dictámenes publicados", href: `/app/convocatoria/${encodeURIComponent(a.codigo.replace(/^OECE-/, ""))}`, titulo: a.objeto ?? a.codigo, detalle: [a.codigo, a.region, plural(a.banderas, "señal", "señales")].filter(Boolean).join(SEP), icon: <Flag size={14} aria-hidden /> });
    for (const e of res.entidades) out.push({ key: `e-${e.ruc}`, grupo: "Entidades", href: `/entidad/${e.ruc}`, titulo: e.nombre, detalle: [`RUC ${e.ruc}`, e.region, plural(e.contratos, "contrato", "contratos")].filter(Boolean).join(SEP), icon: <Building2 size={14} aria-hidden /> });
    for (const z of res.zonas) {
      const regionId = UBIGEO_REGION[z.ubigeo.slice(0, 2)];
      const href = z.nivel === "departamento" && regionId ? `/app/mapa?region=${regionId}` : `/app/financiar/${z.ubigeo}`;
      out.push({ key: `z-${z.ubigeo}`, grupo: "Zonas", href, titulo: z.nombre, detalle: [z.nivel, z.totalCola > 0 ? `${numero(z.totalCola)} en cola` : null, z.financiados > 0 ? plural(z.financiados, "financiado", "financiados") : null].filter(Boolean).join(SEP), icon: <MapPin size={14} aria-hidden /> });
    }
    for (const p of res.aportes) out.push({ key: `p-${p.codigo}`, grupo: "Aportes", href: `/impacto/${p.codigo}`, titulo: p.codigo, detalle: [p.financiador, p.zona, plural(p.contratos, "contrato", "contratos")].filter(Boolean).join(SEP), icon: <Heart size={14} aria-hidden /> });
    return out;
  }, [res]);

  const ir = useCallback((it: Item) => { navegando.current = true; setOpen(false); router.push(it.href); }, [router]);

  const probar = (texto: string) => { setQ(texto); inputRef.current?.focus(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && items[sel]) { e.preventDefault(); ir(items[sel]); }
  };

  const corto = q.trim().length < 2;
  const sinResultados = !corto && !cargando && !fallo && items.length === 0;

  // El botón redondo vive en la cabecera: sobre una sección oscura se vuelve
  // vidrio claro (group-data de la cabecera). El campo vive en la barra lateral y en el 404.
  const trigger = variant === "boton" ? (
    <button type="button" onClick={abrir} aria-haspopup="dialog" aria-label="Buscar (Ctrl+K)" title="Buscar (Ctrl+K)" className={cn("inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paperSoft text-inkSoft transition-colors duration-rapido hover:bg-paperDeep hover:text-granate group-data-[tema-header=oscuro]/header:border-paper/20 group-data-[tema-header=oscuro]/header:bg-paper/10 group-data-[tema-header=oscuro]/header:text-paper group-data-[tema-header=oscuro]/header:hover:bg-paper/20", className)}>
      <Search size={15} aria-hidden />
    </button>
  ) : (
    <button type="button" onClick={abrir} aria-haspopup="dialog" className={cn("flex min-h-9 w-full items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-left text-[13px] text-mute transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50", className)} aria-label="Buscar (Ctrl+K)">
      <Search size={14} aria-hidden />
      <span className="flex-1 truncate">Buscar contrato, entidad, RUC, zona…</span>
      <kbd className="hidden rounded border border-line bg-paperSoft px-1 font-mono text-[10px] text-mute sm:inline">Ctrl K</kbd>
    </button>
  );

  const dialogo = open
    ? createPortal(
        <dialog
          ref={dialogRef}
          aria-labelledby={tituloId}
          // Escape: el navegador dispara `cancel`. Se cierra por estado, no con close(),
          // para que React sea quien desmonte el diálogo.
          onCancel={(e) => { e.preventDefault(); cerrar(); }}
          // Si el navegador lo cierra por su cuenta (p.ej. un segundo Escape), el estado se entera.
          onClose={cerrar}
          // Clic en el fondo: el target es el propio <dialog> sólo cuando cae fuera del panel.
          onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar(); }}
          className={cn(
            "mx-auto mb-auto mt-[10vh] w-[calc(100vw-1.5rem)] max-w-xl overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-dialog",
            // Entrada: crece un 4 % y aparece en 180 ms, con la curva de salida del sistema.
            // Con movimiento reducido no anima (y globals.css lo deja en 0.01 ms igual).
            "motion-safe:animate-[tooltipIn_180ms_cubic-bezier(0.22,1,0.36,1)_both]",
          )}
        >
          <h2 id={tituloId} className="sr-only">Búsqueda global</h2>
          <div className="flex items-center gap-2 border-b border-line px-3">
            {cargando ? <Loader2 size={16} className="shrink-0 animate-spin text-mute" aria-hidden /> : <Search size={16} className="shrink-0 text-mute" aria-hidden />}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Contrato, código VIG-…, entidad, RUC o zona"
              className="h-12 w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-mute"
              aria-label="Texto a buscar"
              aria-controls={listaId}
              aria-activedescendant={items[sel] ? `${idBase}-${items[sel].key}` : undefined}
              aria-autocomplete="list"
              role="combobox"
              aria-expanded={items.length > 0}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
            />
            <button type="button" onClick={cerrar} className="shrink-0 rounded-lg p-1.5 text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink" aria-label="Cerrar búsqueda"><X size={16} aria-hidden /></button>
          </div>

          {corto && (
            <div className="px-4 pb-5 pt-4">
              <p className="text-[13px] leading-relaxed text-mute">Busca por código de contrato, código de aporte VIG-…, nombre de entidad, RUC o zona.</p>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-mute">Prueba con</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {SUGERENCIAS.map((s) => (
                  <li key={s.q}>
                    <button
                      type="button"
                      onClick={() => probar(s.q)}
                      className="group inline-flex min-h-8 items-center gap-2 rounded-full border border-line bg-paperSoft py-1.5 pl-3 pr-3.5 text-[13px] text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-mute group-hover:text-granate">{s.tipo}</span>
                      <span className={s.tipo === "contrato" ? "font-mono" : undefined}>{s.q}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div id={listaId} role="listbox" aria-label="Resultados" className={cn("max-h-[60vh] overflow-y-auto overscroll-contain p-1.5", corto && "hidden")}>
            {fallo && (
              <p role="alert" className="px-3 py-6 text-center text-[13px] leading-relaxed text-crimsonTexto">
                No pudimos buscar en este momento. Revisa tu conexión y vuelve a escribir para intentarlo otra vez.
              </p>
            )}
            {sinResultados && (
              <p className="px-3 py-6 text-center text-[13px] leading-relaxed text-mute">
                Sin resultados para “{q}”. Prueba con otro nombre, un RUC de 11 dígitos o el código del contrato.
              </p>
            )}
            {agrupar(items).map(([grupo, xs]) => (
              <div key={grupo} role="group" aria-label={grupo} className="mb-1">
                <div aria-hidden className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-mute">{grupo}</div>
                {xs.map((it) => {
                  const i = items.indexOf(it);
                  return (
                    <button
                      key={it.key}
                      id={`${idBase}-${it.key}`}
                      role="option"
                      aria-selected={i === sel}
                      type="button"
                      onMouseEnter={() => setSel(i)}
                      onClick={() => ir(it)}
                      className={cn("flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors duration-rapido", i === sel ? "bg-granate-50" : "hover:bg-paperSoft")}
                    >
                      <span className={cn("mt-0.5 shrink-0", i === sel ? "text-ink" : "text-mute")}>{it.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{it.titulo}</span>
                        <span className="block truncate text-xs text-mute">{it.detalle}</span>
                      </span>
                      {i === sel && <CornerDownLeft size={12} className="mt-1 shrink-0 text-mute" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            {corto || fallo ? "" : cargando ? "Buscando…" : `${items.length} ${items.length === 1 ? "resultado" : "resultados"}`}
          </p>
        </dialog>,
        document.body,
      )
    : null;

  return (
    <>
      {trigger}
      {dialogo}
    </>
  );
}

function agrupar(items: Item[]): [string, Item[]][] {
  const m = new Map<string, Item[]>();
  for (const it of items) m.set(it.grupo, [...(m.get(it.grupo) ?? []), it]);
  return [...m.entries()];
}
