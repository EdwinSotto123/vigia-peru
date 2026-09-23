"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, X, FileImage, Search, Loader2, ExternalLink, EyeOff } from "lucide-react";
import { AdminShell, Badge } from "@/components/admin/AdminShell";
import { adminFetch, fmtPEN, fmtDate, ESTADO_UI, type ContribucionAdmin } from "@/lib/admin";
import { useDialog } from "@/components/admin/Dialog";

const TABS = [
  { k: "pendiente_pago", l: "Pendientes" }, { k: "pagada", l: "Pagadas" }, { k: "en_proceso", l: "En proceso" },
  { k: "procesada", l: "Procesadas" }, { k: "rechazada", l: "Rechazadas" }, { k: "todas", l: "Todas" },
];

function Page() {
  const params = useSearchParams();
  const [estado, setEstado] = useState(params.get("estado") ?? "pendiente_pago");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ContribucionAdmin[]>([]);
  const [sel, setSel] = useState<ContribucionAdmin | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { open, toast } = useDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await adminFetch<{ data: ContribucionAdmin[] }>(`/contribuciones?estado=${estado}&q=${encodeURIComponent(q)}`)).data); }
    catch (e) { setMsg((e as Error).message); }
    finally { setLoading(false); }
  }, [estado, q]);
  useEffect(() => { load(); }, [load]);

  function validar(c: ContribucionAdmin) {
    open({
      title: `Confirmar pago de ${c.codigo}`,
      tone: "success",
      confirmLabel: "Confirmar y asignar contratos",
      body: <>Se marcará <strong>{fmtPEN(c.montoPen)}</strong> como recibido y se asignarán <strong>{c.contratos}</strong> contratos de <strong>{c.zona}</strong> por antigüedad (FIFO). El financiador recibe su comprobante de impacto.</>,
      fields: [
        { name: "referencia", label: "Referencia del pago", placeholder: "N° de operación Yape/Plin o transferencia", hint: "Opcional, queda en la bitácora." },
        { name: "nota", label: "Nota interna", type: "textarea", placeholder: "Ej. verificado en el extracto del 14/09" },
      ],
      onConfirm: async (v) => {
        const r = await adminFetch<{ asignados: number; estado: string }>(`/contribuciones/${c.codigo}/validar`, { method: "POST", body: JSON.stringify({ referencia: v.referencia || undefined, nota: v.nota || undefined }) });
        toast(`${c.codigo} validada: ${r.asignados} contratos asignados${r.asignados < c.contratos ? ` (${c.contratos - r.asignados} esperan contratos nuevos en la zona)` : ""}`);
        setSel(null); load();
      },
    });
  }

  function rechazar(c: ContribucionAdmin) {
    open({
      title: `Rechazar ${c.codigo}`,
      tone: "danger",
      confirmLabel: "Rechazar aporte",
      body: <>El aporte queda como rechazado y no asigna contratos. El motivo se guarda en la bitácora.</>,
      fields: [{ name: "motivo", label: "Motivo", type: "textarea", required: true, placeholder: "Ej. el comprobante no corresponde al monto" }],
      onConfirm: async (v) => {
        await adminFetch(`/contribuciones/${c.codigo}/rechazar`, { method: "POST", body: JSON.stringify({ motivo: v.motivo }) });
        toast(`${c.codigo} rechazada`); setSel(null); load();
      },
    });
  }

  return (
    <AdminShell title="Contribuciones" subtitle="Validar pagos, ver comprobantes y seguimiento de asignaciones">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setEstado(t.k)} className={`rounded-full px-3 py-1 text-xs ${estado === t.k ? "bg-ink text-paper" : "border border-line bg-paper text-mute hover:text-ink"}`}>{t.l}</button>
        ))}
        <div className="relative ml-auto">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="código, nombre, RUC, email, zona" className="w-72 rounded-lg border border-line bg-paper py-1.5 pl-8 pr-3 text-sm" />
        </div>
      </div>

      {msg && <div className="mt-4 rounded-xl border border-line bg-paper px-4 py-2 text-sm text-ink">{msg} <button onClick={() => setMsg(null)} className="ml-2 text-mute">✕</button></div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <table className="w-full text-sm">
            <thead className="bg-paperDeep text-left text-[11px] uppercase tracking-wide text-mute">
              <tr><th className="px-3 py-2">Código</th><th>Financiador</th><th>Zona</th><th className="text-right">Contratos</th><th className="text-right">Monto</th><th>Comprob.</th><th>Estado</th><th>Fecha</th></tr>
            </thead>
            <tbody>
              {loading && !rows.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-mute"><Loader2 size={16} className="mx-auto animate-spin" /></td></tr>}
              {!loading && !rows.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-mute">Nada en esta bandeja.</td></tr>}
              {rows.map((c) => (
                <tr key={c.codigo} onClick={() => setSel(c)} className={`cursor-pointer border-t border-line hover:bg-paperDeep ${sel?.codigo === c.codigo ? "bg-paperDeep" : ""}`}>
                  <td className="px-3 py-2 font-mono text-xs">{c.codigo}</td>
                  <td>
                    <div className="flex items-center gap-1.5">{c.nombrePublico ?? <span className="text-mute">Anónimo</span>}{!c.visible && <EyeOff size={12} className="text-rust" />}</div>
                    <div className="text-[11px] text-mute">{c.tipo}{c.ruc ? `, RUC ${c.ruc}` : ""}</div>
                  </td>
                  <td>{c.zona} <span className="text-[11px] text-mute">{c.nivel}</span></td>
                  <td className="text-right font-mono">{c.contratos}<span className="text-[11px] text-mute" title="asignados / procesados"> ({c.asignados}a/{c.procesados}p)</span></td>
                  <td className="text-right font-mono">{fmtPEN(c.montoPen)}</td>
                  <td>{c.tieneComprobante ? <FileImage size={14} className="text-moss" /> : <span className="text-[11px] text-mute">—</span>}</td>
                  <td><Badge cls={ESTADO_UI[c.estado]?.cls ?? ""}>{ESTADO_UI[c.estado]?.label ?? c.estado}</Badge></td>
                  <td className="pr-3 text-[11px] text-mute">{fmtDate(c.pagadaAt ?? c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          {sel ? <Detalle c={sel} onValidar={() => validar(sel)} onRechazar={() => rechazar(sel)} onClose={() => setSel(null)} /> : (
            <div className="rounded-2xl border border-dashed border-line p-6 text-sm text-mute">Selecciona una contribución para ver el detalle, el comprobante y validarla.</div>
          )}
        </aside>
      </div>
    </AdminShell>
  );
}

function Detalle({ c, onValidar, onRechazar, onClose }: { c: ContribucionAdmin; onValidar: () => void; onRechazar: () => void; onClose: () => void }) {
  const [nota, setNota] = useState(c.notaAdmin ?? "");
  useEffect(() => setNota(c.notaAdmin ?? ""), [c.codigo, c.notaAdmin]);
  async function guardarNota() { await adminFetch(`/contribuciones/${c.codigo}`, { method: "PATCH", body: JSON.stringify({ notaAdmin: nota || null }) }); }
  return (
    <div className="rounded-2xl border border-line bg-paper p-5">
      <div className="flex items-start justify-between">
        <div><div className="font-mono text-lg font-bold text-ink">{c.codigo}</div><Badge cls={ESTADO_UI[c.estado]?.cls ?? ""}>{ESTADO_UI[c.estado]?.label ?? c.estado}</Badge></div>
        <button onClick={onClose} className="text-mute hover:text-ink"><X size={16} /></button>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <D k="Monto" v={fmtPEN(c.montoPen)} /><D k="Contratos" v={`${c.contratos} (${c.asignados} asignados, ${c.procesados} procesados)`} />
        <D k="Zona" v={`${c.zona} (${c.nivel})`} /><D k="Método" v={c.pasarela ?? "—"} />
        <D k="Financiador" v={`${c.nombrePublico ?? "Anónimo"} (${c.tipo})`} /><D k="RUC" v={c.ruc ?? "—"} />
        <D k="Email" v={c.email} /><D k="Referencia" v={c.pasarelaRef ?? "—"} />
        <D k="Creada" v={fmtDate(c.createdAt)} /><D k="Pagada" v={c.pagadaAt ? `${fmtDate(c.pagadaAt)}${c.validadaPor ? `, validó ${c.validadaPor}` : ""}` : "—"} />
      </dl>
      {!c.visible && <div className="mt-3 rounded-lg bg-crimson-soft p-2 text-[12px] text-crimsonTexto">Sin reconocimiento público: {c.motivoNoVisible?.replace(/_/g, " ")}. El aporte procesa contratos igual.</div>}
      {c.mensajePublico && <p className="mt-3 border-l-2 border-amber pl-2 text-[13px] italic text-mute">“{c.mensajePublico}”</p>}

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wide text-mute">Comprobante</div>
        {c.tieneComprobante ? (
          <a href={`/api/admin/contribuciones/${c.codigo}/comprobante`} target="_blank" className="mt-1 block overflow-hidden rounded-xl border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/admin/contribuciones/${c.codigo}/comprobante`} alt="comprobante" className="max-h-64 w-full object-contain bg-paperDeep" />
            <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-mute"><ExternalLink size={11} /> abrir en pestaña nueva</div>
          </a>
        ) : <p className="mt-1 text-sm text-mute">El financiador aún no subió comprobante.</p>}
      </div>

      <label className="mt-4 block text-sm"><span className="text-[11px] uppercase tracking-wide text-mute">Nota interna</span>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} onBlur={guardarNota} rows={2} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" placeholder="Ej. verificado en el extracto del 14/09" />
      </label>

      {c.estado === "pendiente_pago" && (
        <div className="mt-4 flex gap-2">
          <button onClick={onValidar} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-moss px-3 py-2.5 text-sm font-semibold text-paper"><Check size={14} /> Confirmar pago</button>
          <button onClick={onRechazar} className="flex items-center justify-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-sm text-rust"><X size={14} /> Rechazar</button>
        </div>
      )}
      <Link href={`/impacto/${c.codigo}`} target="_blank" className="mt-3 inline-flex items-center gap-1 text-[12px] text-mute hover:text-ink"><ExternalLink size={11} /> comprobante de impacto público</Link>
    </div>
  );
}

function D({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-[11px] uppercase tracking-wide text-mute">{k}</dt><dd className="break-words text-ink">{v}</dd></div>;
}

export default function ContribucionesPage() {
  return <Suspense><Page /></Suspense>;
}
