"use client";

/**
 * Búsqueda global (⌘K / Ctrl+K o el campo de la cabecera del dashboard).
 * Busca OCID, código de alerta (OECE-…), código de aporte (VIG-…), RUC, entidad y zona;
 * muestra resultados agrupados (GET /buscar?q=). Teclado: ↑/↓ mueve, Enter abre, Esc cierra.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, FileSearch, Building2, MapPin, Heart, AlertTriangle, Loader2, CornerDownLeft, X } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
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
const soles = (n: number | null) => (n ? `S/ ${Math.round(n).toLocaleString("es-PE")}` : "");

export function BuscarGlobal({ variant = "campo", className }: { variant?: "campo" | "boton"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Resultados>(vacio);
  const [cargando, setCargando] = useState(false);
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  // ⌘K / Ctrl+K abre; Esc cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
    else { setQ(""); setRes(vacio); setSel(0); }
  }, [open]);

  // Debounce 220 ms + cancelación.
  useEffect(() => {
    if (!open) return;
    if (timer.current) window.clearTimeout(timer.current);
    const t = q.trim();
    if (t.length < 2) { setRes(vacio); setCargando(false); return; }
    setCargando(true);
    timer.current = window.setTimeout(async () => {
      ctrl.current?.abort();
      ctrl.current = new AbortController();
      try {
        const r = await fetch(`${PUBLIC_API_BASE}/buscar?q=${encodeURIComponent(t)}`, { signal: ctrl.current.signal });
        if (r.ok) { setRes((await r.json()) as Resultados); setSel(0); }
      } catch { /* abortado o sin red */ } finally { setCargando(false); }
    }, 220);
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const c of res.contratos) out.push({ key: `c-${c.ocid}`, grupo: "Contratos", href: `/app/contratos/${encodeURIComponent(c.ocid)}`, titulo: c.titulo ?? c.codigo, detalle: [c.codigo, c.entidad, c.zona, soles(c.montoPen)].filter(Boolean).join(", "), icon: <FileSearch size={14} aria-hidden /> });
    for (const a of res.alertas) out.push({ key: `a-${a.codigo}`, grupo: "Señales publicadas", href: `/app/convocatoria/${encodeURIComponent(a.codigo.replace(/^OECE-/, ""))}`, titulo: a.objeto ?? a.codigo, detalle: [a.codigo, a.region, a.score != null ? `score ${a.score}` : null, `${a.banderas} señal${a.banderas === 1 ? "" : "es"}`].filter(Boolean).join(", "), icon: <AlertTriangle size={14} aria-hidden /> });
    for (const e of res.entidades) out.push({ key: `e-${e.ruc}`, grupo: "Entidades", href: `/entidad/${e.ruc}`, titulo: e.nombre, detalle: [`RUC ${e.ruc}`, e.region, `${e.contratos.toLocaleString("es-PE")} contratos`].filter(Boolean).join(", "), icon: <Building2 size={14} aria-hidden /> });
    for (const z of res.zonas) {
      const regionId = UBIGEO_REGION[z.ubigeo.slice(0, 2)];
      const href = z.nivel === "departamento" && regionId ? `/app/mapa?region=${regionId}` : `/app/financiar/${z.ubigeo}`;
      out.push({ key: `z-${z.ubigeo}`, grupo: "Zonas", href, titulo: z.nombre, detalle: [z.nivel, z.totalCola > 0 ? `${z.totalCola.toLocaleString("es-PE")} en cola` : null, z.financiados > 0 ? `${z.financiados} financiados` : null].filter(Boolean).join(", "), icon: <MapPin size={14} aria-hidden /> });
    }
    for (const p of res.aportes) out.push({ key: `p-${p.codigo}`, grupo: "Aportes", href: `/impacto/${p.codigo}`, titulo: p.codigo, detalle: [p.financiador, p.zona, `${p.contratos} contratos`].filter(Boolean).join(", "), icon: <Heart size={14} aria-hidden /> });
    return out;
  }, [res]);

  const ir = useCallback((it: Item) => { setOpen(false); router.push(it.href); }, [router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && items[sel]) { e.preventDefault(); ir(items[sel]); }
  };

  const trigger = variant === "boton" ? (
    <button type="button" onClick={() => setOpen(true)} aria-label="Buscar (Ctrl+K)" title="Buscar (Ctrl+K)" className={cn("inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paperSoft text-mute transition-colors duration-300 hover:bg-paperDeep hover:text-ink group-data-[tema-header=oscuro]/header:border-paper/20 group-data-[tema-header=oscuro]/header:bg-paper/10 group-data-[tema-header=oscuro]/header:text-paper group-data-[tema-header=oscuro]/header:hover:bg-paper/20", className)}>
      <Search size={15} aria-hidden />
    </button>
  ) : (
    <button type="button" onClick={() => setOpen(true)} className={cn("flex w-full items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-left text-xs text-mute hover:bg-paperDeep", className)} aria-label="Buscar (Ctrl+K)">
      <Search size={13} aria-hidden />
      <span className="flex-1 truncate">Buscar OCID, entidad, RUC, zona…</span>
      <kbd className="hidden rounded border border-line bg-paperSoft px-1 font-mono text-[9px] text-mute sm:inline">Ctrl K</kbd>
    </button>
  );

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/40 p-3 pt-[10vh] backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Búsqueda global" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-paper shadow-paper">
            <div className="flex items-center gap-2 border-b border-line px-3">
              {cargando ? <Loader2 size={16} className="animate-spin text-mute" aria-hidden /> : <Search size={16} className="text-mute" aria-hidden />}
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="OCID, código VIG-…, entidad, RUC o zona"
                className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-mute"
                aria-label="Texto a buscar"
                aria-controls="buscar-resultados"
                aria-activedescendant={items[sel] ? `buscar-${items[sel].key}` : undefined}
                role="combobox"
                aria-expanded={items.length > 0}
                autoComplete="off"
              />
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-mute hover:text-ink" aria-label="Cerrar búsqueda"><X size={16} aria-hidden /></button>
            </div>
            <div id="buscar-resultados" role="listbox" className="max-h-[60vh] overflow-y-auto p-1.5">
              {q.trim().length < 2 && (
                <p className="px-3 py-6 text-center text-[12px] text-mute">Escribe al menos 2 letras. Ejemplos: <span className="font-mono">1225884</span>, <span className="font-mono">VIG-2026-00004</span>, Puno, Gobierno Regional</p>
              )}
              {q.trim().length >= 2 && !cargando && items.length === 0 && (
                <p className="px-3 py-6 text-center text-[12px] text-mute">Sin resultados para “{q}”.</p>
              )}
              {agrupar(items).map(([grupo, xs]) => (
                <div key={grupo} className="mb-1">
                  <div className="px-3 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-widest text-mute">{grupo}</div>
                  {xs.map((it) => {
                    const i = items.indexOf(it);
                    return (
                      <button
                        key={it.key}
                        id={`buscar-${it.key}`}
                        role="option"
                        aria-selected={i === sel}
                        type="button"
                        onMouseEnter={() => setSel(i)}
                        onClick={() => ir(it)}
                        className={cn("flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left", i === sel ? "bg-paperDeep" : "hover:bg-paperSoft")}
                      >
                        <span className="mt-0.5 shrink-0 text-heroViolet">{it.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{it.titulo}</span>
                          <span className="block truncate text-[11px] text-mute">{it.detalle}</span>
                        </span>
                        {i === sel && <CornerDownLeft size={12} className="mt-1 shrink-0 text-mute" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function agrupar(items: Item[]): [string, Item[]][] {
  const m = new Map<string, Item[]>();
  for (const it of items) m.set(it.grupo, [...(m.get(it.grupo) ?? []), it]);
  return [...m.entries()];
}
