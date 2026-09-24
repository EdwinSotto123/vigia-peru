"use client";

/**
 * Diálogo modal + toasts del panel admin. Reemplaza `prompt()`/`confirm()` del navegador
 * por un formulario con campos, tono (peligro/normal) y estado de carga.
 *
 * Es un <dialog> nativo abierto con showModal(): el navegador deja inerte el resto de la página
 * (el foco no se escapa con Tab), Esc lo cierra y el lector de pantalla lo anuncia con su título.
 * Al abrir, el foco va al primer campo (o al botón de confirmar si no hay campos); al cerrar,
 * vuelve al botón que lo abrió.
 */

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DialogField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Mínimo de caracteres sin contar espacios (un motivo de "." no dice nada). */
  minimo?: number;
  defaultValue?: string;
  hint?: string;
}

export interface DialogSpec {
  title: string;
  body?: React.ReactNode;
  fields?: DialogField[];
  confirmLabel?: string;
  tone?: "normal" | "danger" | "success";
  onConfirm: (values: Record<string, string>) => Promise<void> | void;
}

interface Toast { id: number; text: string; tone: "ok" | "error" }

interface Ctx {
  open: (spec: DialogSpec) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
}

const DialogCtx = createContext<Ctx | null>(null);

export function useDialog(): Ctx {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error("useDialog fuera de <DialogProvider>");
  return ctx;
}

const CAMPO = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm";

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [spec, setSpec] = useState<DialogSpec | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dlg = useRef<HTMLDialogElement>(null);
  // Quién abrió el diálogo, para devolverle el foco al cerrar.
  const abridor = useRef<HTMLElement | null>(null);
  // Mientras el modal está abierto el resto de la página es inerte y un aviso ahí no se anuncia:
  // los toasts de esa ventana esperan a que se cierre.
  const enEspera = useRef<Toast[]>([]);
  // Un clic que empieza dentro del diálogo y termina afuera (seleccionando texto) no lo cierra.
  const pulsoEnFondo = useRef(false);
  const idTitulo = useId();
  const idCuerpo = useId();

  const mostrar = useCallback((t: Toast) => {
    setToasts((ts) => [...ts, t]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 4500);
  }, []);

  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const t = { id: Date.now() + Math.random(), text, tone };
    if (dlg.current?.open) enEspera.current.push(t);
    else mostrar(t);
  }, [mostrar]);

  const open = useCallback((s: DialogSpec) => {
    if (!dlg.current?.open) abridor.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSpec(s);
    setValues(Object.fromEntries((s.fields ?? []).map((f) => [f.name, f.defaultValue ?? ""])));
    setError(null);
  }, []);

  const cerrar = useCallback(() => setSpec(null), []);

  // Abrir y cerrar el <dialog> nativo según haya o no un pedido.
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (spec) {
      if (!d.open) d.showModal();
      // Sólo el primer campo recibe el foco (antes todos tenían autoFocus y ganaba el último).
      d.querySelector<HTMLElement>("[data-foco-inicial]")?.focus();
      return;
    }
    if (d.open) d.close();
    const a = abridor.current;
    abridor.current = null;
    if (a?.isConnected) a.focus();
    for (const t of enEspera.current.splice(0)) mostrar(t);
  }, [spec, mostrar]);

  async function confirm() {
    if (!spec) return;
    for (const f of spec.fields ?? []) {
      const v = values[f.name] ?? "";
      if (f.required && !v.trim()) { setError(`Completa "${f.label}".`); return; }
      if (f.minimo && v.trim() && v.replace(/\s/g, "").length < f.minimo) { setError(`Escribe al menos ${f.minimo} letras en "${f.label}".`); return; }
    }
    setBusy(true); setError(null);
    try { await spec.onConfirm(values); setSpec(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const toneBtn = spec?.tone === "danger" ? "bg-rust text-paper" : spec?.tone === "success" ? "bg-moss text-paper" : "bg-ink text-paper";
  const campos = spec?.fields ?? [];

  return (
    <DialogCtx.Provider value={{ open, toast }}>
      {children}
      <dialog
        ref={dlg}
        aria-labelledby={spec ? idTitulo : undefined}
        aria-describedby={spec?.body ? idCuerpo : undefined}
        // Esc: el navegador lo cierra solo; mientras se guarda, no.
        onCancel={(e) => { e.preventDefault(); if (!busy) cerrar(); }}
        // Si el navegador lo cerró por su cuenta (Esc repetido), el estado lo sigue.
        onClose={() => { if (spec && !dlg.current?.open) cerrar(); }}
        onMouseDown={(e) => { pulsoEnFondo.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (e.target === e.currentTarget && pulsoEnFondo.current && !busy) cerrar(); }}
        className="mx-auto mb-4 mt-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-paper p-0 text-ink shadow-xl backdrop:bg-ink/40 backdrop:backdrop-blur-sm sm:my-auto"
      >
        {spec && (
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 id={idTitulo} className="font-serif text-lg font-bold text-ink">{spec.title}</h3>
              <button type="button" onClick={() => !busy && cerrar()} className="text-mute hover:text-ink" aria-label="Cerrar"><X size={16} aria-hidden /></button>
            </div>
            {spec.body && <div id={idCuerpo} className="mt-2 text-sm text-mute">{spec.body}</div>}
            {campos.map((f, i) => {
              const valor = values[f.name] ?? "";
              // Sólo el primero se enfoca al abrir (ver el efecto de arriba).
              const inicial = i === 0 ? "" : undefined;
              const cambiar = (v: string) => setValues((vs) => ({ ...vs, [f.name]: v }));
              return (
                <label key={f.name} className="mt-3 block text-sm">
                  <span className="text-mute">{f.label}{f.required && " *"}</span>
                  {f.type === "textarea" ? (
                    <textarea rows={3} value={valor} data-foco-inicial={inicial} onChange={(e) => cambiar(e.target.value)} placeholder={f.placeholder} required={f.required} className={CAMPO} />
                  ) : f.type === "select" ? (
                    <select value={valor} data-foco-inicial={inicial} onChange={(e) => cambiar(e.target.value)} className={CAMPO}>
                      {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input value={valor} data-foco-inicial={inicial} onChange={(e) => cambiar(e.target.value)} placeholder={f.placeholder} required={f.required} className={CAMPO} />
                  )}
                  {f.hint && <span className="mt-1 block text-[11px] text-mute">{f.hint}</span>}
                </label>
              );
            })}
            {error && <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm text-rust"><AlertTriangle size={14} className="shrink-0" aria-hidden />{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={cerrar} disabled={busy} className="rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-paperDeep">Cancelar</button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                data-foco-inicial={campos.length ? undefined : ""}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60", toneBtn)}
              >
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}{spec.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        )}
      </dialog>
      {/* Siempre montada: una región viva tiene que existir antes de que llegue el aviso. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm shadow-lg", t.tone === "ok" ? "bg-ink text-paper" : "bg-rust text-paper")}>
            {t.tone === "ok" ? <CheckCircle2 size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}{t.text}
          </div>
        ))}
      </div>
    </DialogCtx.Provider>
  );
}
