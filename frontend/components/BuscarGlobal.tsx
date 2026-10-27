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

import { rutaContrato } from "@/lib/rutas";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, FileSearch, Building2, Briefcase, MapPin, Heart, Flag, Loader2, CornerDownLeft, X } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { limpiarObjeto } from "@/components/contratos/recortar";
import { etiquetaTipoVisible } from "@/lib/entidad-tipo";
import { numero, plural, soles } from "@/lib/formato";
import { rutaRegion } from "@/lib/regiones";
import { cn } from "@/lib/utils";
import { tituloNatural } from "@/lib/landing";
import { Partes } from "@/components/ui/Partes";

interface Resultados {
  q: string;
  contratos: { ocid: string; codigo: string; titulo: string | null; entidad: string | null; montoPen: number | null; zona: string | null }[];
  entidades: { ruc: string; nombre: string; tipo: string | null; region: string | null; contratos: number }[];
  /** Empresas (RUC 20) que le venden al Estado. Una API anterior no lo trae. */
  empresas?: { ruc: string; nombre: string; departamento: string | null; contratos: number; ordenes: number }[];
  /** `provincia` (de un distrito) y `departamento` (de una provincia o un distrito): una API anterior no los trae. */
  zonas: { ubigeo: string; nombre: string; nivel: string; totalCola: number; financiados: number; provincia?: string | null; departamento?: string | null }[];
  aportes: { codigo: string; estado: string; contratos: number; zona: string; financiador: string }[];
  alertas: { codigo: string; ocid: string | null; score: number | null; objeto: string | null; region: string | null; banderas: number }[];
}

/** Sin tildes y en minúsculas: «Cayma» y «CAYMA» son el mismo lugar. */
const normal = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * ¿La búsqueda es un lugar? Una zona que se llama así (o empieza así, con 4 letras o más). Entonces los lugares y las
 * entidades van antes que los contratos: quien escribe «Cayma» busca el distrito y su municipalidad, no los cinco
 * contratos que dicen «Cayma» en el objeto (antes iban primero).
 */
function esLugar(q: string, zonas: Resultados["zonas"]): boolean {
  const n = normal(q);
  if (n.length < 3 || /\d/.test(n)) return false;
  return zonas.some((z) => {
    const nombre = normal(z.nombre);
    return nombre === n || (n.length >= 4 && nombre.startsWith(`${n} `));
  });
}

/** Dónde queda una zona, en palabras, como su panel en la ficha de la región: «Distrito de la provincia de Castilla, Arequipa». */
function dondeQueda(z: Resultados["zonas"][number]): string {
  if (z.nivel === "departamento") return "Región";
  if (z.nivel === "provincia") return z.departamento ? `Provincia de la región ${z.departamento}` : "Provincia";
  if (z.provincia) return `Distrito de la provincia de ${z.provincia}${z.departamento && z.departamento !== z.provincia ? `, ${z.departamento}` : ""}`;
  return "Distrito";
}

/** `detalle`: datos sueltos (código, entidad, zona, monto); se muestran separados por aire, sin comas: "S/ 45,000" ya lleva una. */
interface Item { key: string; href: string; titulo: string; detalle: (string | null)[]; grupo: string; icon: React.ReactNode }

const vacio: Resultados = { q: "", contratos: [], entidades: [], empresas: [], zonas: [], aportes: [], alertas: [] };

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
  /** `grande`: el campo de la pantalla de inicio (/app), alto y con la pregunta a la vista. */
  variant?: "campo" | "boton" | "grande";
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
    // Cada grupo por su lado; el orden de los grupos, después (un lugar antes que los contratos que lo nombran).
    const contratos: Item[] = res.contratos.map((c) => ({ key: `c-${c.ocid}`, grupo: "Contratos", href: `/app/contratos/${encodeURIComponent(c.ocid)}`, titulo: c.titulo ? limpiarObjeto(c.titulo) : c.codigo, detalle: [c.codigo, c.entidad, c.zona, c.montoPen ? soles(c.montoPen) : null], icon: <FileSearch size={14} aria-hidden /> }));
    const alertas: Item[] = res.alertas.map((a) => ({ key: `a-${a.codigo}`, grupo: "Dictámenes publicados", href: rutaContrato(a.codigo.replace(/^OECE-/, ""), "dictamen"), titulo: a.objeto ? limpiarObjeto(a.objeto) : a.codigo, detalle: [a.codigo, a.region, plural(a.banderas, "señal", "señales")], icon: <Flag size={14} aria-hidden /> }));
    const entidades: Item[] = res.entidades.map((e) => ({ key: `e-${e.ruc}`, grupo: "Entidades", href: `/entidad/${e.ruc}`, titulo: e.nombre, detalle: [etiquetaTipoVisible(e.tipo, e.nombre, "corto"), `RUC ${e.ruc}`, e.region, plural(e.contratos, "contrato", "contratos")], icon: <Building2 size={14} aria-hidden /> }));
    // Las entidades del Estado que también venden (una municipalidad con órdenes de otra) ya van en «Entidades»: la API
    // nueva no las manda aquí y, con una vieja, no se repiten.
    const deEntidades = new Set(res.entidades.map((e) => e.ruc));
    const empresas: Item[] = (res.empresas ?? []).filter((e) => !deEntidades.has(e.ruc)).map((e) => ({ key: `m-${e.ruc}`, grupo: "Empresas", href: `/empresa/${e.ruc}`, titulo: e.nombre, detalle: [`RUC ${e.ruc}`, e.departamento ? tituloNatural(e.departamento) : null, e.contratos ? plural(e.contratos, "contrato", "contratos") : e.ordenes ? plural(e.ordenes, "orden", "órdenes") : null], icon: <Briefcase size={14} aria-hidden /> }));
    // Un lugar abre la ficha de su región: la región misma, o su lista de provincias y distritos ya buscada (cada fila
    // abre su panel con quién la gobierna y sus contratos). Antes un distrito llevaba al formulario de pago de la zona.
    const zonas: Item[] = res.zonas.map((z) => ({
      key: `z-${z.ubigeo}`, grupo: "Zonas",
      href: z.nivel === "departamento" ? rutaRegion(z.ubigeo) : rutaRegion(z.ubigeo, "territorio", z.nombre),
      titulo: z.nombre,
      detalle: [dondeQueda(z), z.totalCola > 0 ? `${numero(z.totalCola)} en cola` : null, z.financiados > 0 ? plural(z.financiados, "financiado", "financiados") : null],
      icon: <MapPin size={14} aria-hidden />,
    }));
    const aportes: Item[] = res.aportes.map((p) => ({ key: `p-${p.codigo}`, grupo: "Aportes", href: `/impacto/${p.codigo}`, titulo: p.codigo, detalle: [p.financiador, p.zona, plural(p.contratos, "contrato", "contratos")], icon: <Heart size={14} aria-hidden /> }));
    return esLugar(res.q, res.zonas)
      ? [...zonas, ...entidades, ...contratos, ...alertas, ...empresas, ...aportes]
      : [...contratos, ...alertas, ...entidades, ...empresas, ...zonas, ...aportes];
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
  const trigger = variant === "grande" ? (
    <button
      type="button"
      onClick={abrir}
      aria-haspopup="dialog"
      aria-label="Buscar un contrato, una entidad, un RUC o una región"
      className={cn(
        "group flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 border-ink/80 bg-paper px-5 py-3 text-left transition-colors duration-rapido hover:border-granate hover:bg-granate-50 sm:min-h-[4.5rem] sm:px-6",
        className,
      )}
    >
      <Search size={22} className="shrink-0 text-granate" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-destacado text-mute sm:text-bloque"><span className="sm:hidden">Contrato, entidad, RUC o región</span><span className="hidden sm:inline">Busca un contrato, una entidad, un RUC o tu región</span></span>
      <kbd className="hidden rounded border border-line bg-paperSoft px-1.5 py-0.5 font-mono text-micro text-mute sm:inline">Ctrl K</kbd>
    </button>
  ) : variant === "boton" ? (
    <button type="button" onClick={abrir} aria-haspopup="dialog" aria-label="Buscar (Ctrl+K)" title="Buscar (Ctrl+K)" className={cn("inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full border border-line bg-paperSoft text-inkSoft transition-colors duration-rapido hover:bg-paperDeep hover:text-granate group-data-[tema-header=oscuro]/header:border-paper/20 group-data-[tema-header=oscuro]/header:bg-paper/10 group-data-[tema-header=oscuro]/header:text-paper group-data-[tema-header=oscuro]/header:hover:bg-paper/20", className)}>
      <Search size={15} aria-hidden />
    </button>
  ) : (
    <button type="button" onClick={abrir} aria-haspopup="dialog" className={cn("flex min-h-9 w-full items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-left text-meta text-mute transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50", className)} aria-label="Buscar (Ctrl+K)">
      <Search size={14} aria-hidden />
      <span className="flex-1 truncate">Buscar contrato, entidad, RUC, zona…</span>
      <kbd className="hidden rounded border border-line bg-paperSoft px-1 font-mono text-micro text-mute sm:inline">Ctrl K</kbd>
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
              className="h-12 w-full min-w-0 bg-transparent text-dato leading-5 text-ink outline-none placeholder:text-mute"
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
              <p className="text-meta leading-relaxed text-mute">Busca por código de contrato, código de aporte VIG-…, nombre de entidad, RUC o zona.</p>
              <p className="mt-4 text-micro font-semibold uppercase tracking-[0.12em] text-mute">Prueba con</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {SUGERENCIAS.map((s) => (
                  <li key={s.q}>
                    <button
                      type="button"
                      onClick={() => probar(s.q)}
                      className="group inline-flex min-h-8 items-center gap-2 rounded-full border border-line bg-paperSoft py-1.5 pl-3 pr-3.5 text-meta text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
                    >
                      <span className="text-micro font-semibold uppercase tracking-wider text-mute group-hover:text-granate">{s.tipo}</span>
                      <span className={s.tipo === "contrato" ? "font-mono" : undefined}>{s.q}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div id={listaId} role="listbox" aria-label="Resultados" className={cn("max-h-[60vh] overflow-y-auto overscroll-contain p-1.5", corto && "hidden")}>
            {fallo && (
              <p role="alert" className="px-3 py-6 text-center text-meta leading-relaxed text-crimsonTexto">
                No pudimos buscar en este momento. Revisa tu conexión y vuelve a escribir para intentarlo otra vez.
              </p>
            )}
            {sinResultados && (
              <p className="px-3 py-6 text-center text-meta leading-relaxed text-mute">
                Sin resultados para “{q}”. Prueba con otro nombre, un RUC de 11 dígitos o el código del contrato.
              </p>
            )}
            {agrupar(items).map(([grupo, xs]) => (
              <div key={grupo} role="group" aria-label={grupo} className="mb-1">
                <div aria-hidden className="px-3 pb-0.5 pt-2 text-micro font-semibold uppercase tracking-[0.12em] text-mute">{grupo}</div>
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
                        <span className="block truncate text-dato leading-5 text-ink">{it.titulo}</span>
                        <span className="block truncate text-rotulo leading-4 text-mute"><Partes partes={it.detalle} /></span>
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
