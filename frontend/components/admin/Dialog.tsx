"use client";

/**
 * Diálogo modal + toasts del panel admin. Reemplaza `prompt()`/`confirm()` del navegador
 * por un formulario con campos, tono (peligro/normal) y estado de carga.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DialogField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
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

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [spec, setSpec] = useState<DialogSpec | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const open = useCallback((s: DialogSpec) => {
    setSpec(s);
    setValues(Object.fromEntries((s.fields ?? []).map((f) => [f.name, f.defaultValue ?? ""])));
    setError(null);
  }, []);

  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    if (!spec) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && setSpec(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spec, busy]);

  async function confirm() {
    if (!spec) return;
    for (const f of spec.fields ?? []) {
      if (f.required && !values[f.name]?.trim()) { setError(`Completa "${f.label}".`); return; }
    }
    setBusy(true); setError(null);
    try { await spec.onConfirm(values); setSpec(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const toneBtn = spec?.tone === "danger" ? "bg-rust text-paper" : spec?.tone === "success" ? "bg-moss text-paper" : "bg-ink text-paper";

  return (
    <DialogCtx.Provider value={{ open, toast }}>
      {children}
      {spec && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 backdrop-blur-sm sm:items-center" onClick={() => !busy && setSpec(null)}>
          <div role="dialog" aria-modal className="w-full max-w-md rounded-2xl border border-line bg-paper p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-serif text-lg font-bold text-ink">{spec.title}</h3>
              <button onClick={() => !busy && setSpec(null)} className="text-mute hover:text-ink" aria-label="Cerrar"><X size={16} /></button>
            </div>
            {spec.body && <div className="mt-2 text-sm text-mute">{spec.body}</div>}
            {(spec.fields ?? []).map((f) => (
              <label key={f.name} className="mt-3 block text-sm">
                <span className="text-mute">{f.label}{f.required && " *"}</span>
                {f.type === "textarea" ? (
                  <textarea rows={3} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} placeholder={f.placeholder} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" autoFocus />
                ) : f.type === "select" ? (
                  <select value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm">
                    {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} placeholder={f.placeholder} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" autoFocus />
                )}
                {f.hint && <span className="mt-1 block text-[11px] text-mute">{f.hint}</span>}
              </label>
            ))}
            {error && <p className="mt-3 flex items-center gap-1.5 text-sm text-rust"><AlertTriangle size={14} />{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setSpec(null)} disabled={busy} className="rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-paperDeep">Cancelar</button>
              <button onClick={confirm} disabled={busy} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60", toneBtn)}>
                {busy && <Loader2 size={14} className="animate-spin" />}{spec.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm shadow-lg", t.tone === "ok" ? "bg-ink text-paper" : "bg-rust text-paper")}>
            {t.tone === "ok" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{t.text}
          </div>
        ))}
      </div>
    </DialogCtx.Provider>
  );
}
