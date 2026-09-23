"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Upload, Save, Loader2, Eye } from "lucide-react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, type PagosConfig } from "@/lib/admin";
import { BrandBadge } from "@/components/financiar/PaymentMethods";

const BANCOS = ["BCP", "BBVA", "Interbank", "Scotiabank", "Banco de la Nación", "BanBif", "Pichincha", "Otro"];
const EMPTY: PagosConfig = {
  yape: { numero: "", titular: "", qr_url: "" },
  plin: { numero: "", titular: "", qr_url: "" },
  cuentas: [],
  instrucciones: "",
  contacto_email: "",
};

export default function PagosPage() {
  const [cfg, setCfg] = useState<PagosConfig>(EMPTY);
  const [meta, setMeta] = useState<{ updatedAt?: string; updatedBy?: string }>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<{ valor: Partial<PagosConfig>; updatedAt?: string; updatedBy?: string }>("/config/pagos")
      .then((r) => { setCfg({ ...EMPTY, ...r.valor, yape: { ...EMPTY.yape, ...(r.valor.yape ?? {}) }, plin: { ...EMPTY.plin, ...(r.valor.plin ?? {}) }, cuentas: r.valor.cuentas ?? [] }); setMeta({ updatedAt: r.updatedAt, updatedBy: r.updatedBy }); })
      .catch((e) => setMsg((e as Error).message));
  }, []);

  async function save() {
    setSaving(true);
    try { await adminFetch("/config/pagos", { method: "PUT", body: JSON.stringify(cfg) }); setMsg("Guardado. El formulario público ya muestra estos datos."); }
    catch (e) { setMsg((e as Error).message); }
    finally { setSaving(false); }
  }

  async function uploadQr(kind: "yape" | "plin", file: File) {
    const fd = new FormData(); fd.append("file", file); fd.append("kind", "pago");
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok || !j.url) { setMsg(j.error ?? "No se pudo subir el QR"); return; }
    setCfg((c) => ({ ...c, [kind]: { ...c[kind], qr_url: j.url } }));
  }

  const setCuenta = (i: number, patch: Partial<PagosConfig["cuentas"][number]>) =>
    setCfg((c) => ({ ...c, cuentas: c.cuentas.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  return (
    <AdminShell title="Medios de pago" subtitle="Lo que ve el financiador al registrar un aporte (fase 0: pago manual + comprobante)" actions={
      <>
        <Link href="/app/financiar/15" target="_blank" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep"><Eye size={12} /> Ver como financiador</Link>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-50">{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Guardar</button>
      </>
    }>
      {msg && <div className="mb-4 rounded-xl border border-line bg-paper px-4 py-2 text-sm text-ink">{msg} <button onClick={() => setMsg(null)} className="ml-2 text-mute">✕</button></div>}
      {meta.updatedAt && <p className="mb-4 text-[12px] text-mute">Última edición: {new Date(meta.updatedAt).toLocaleString("es-PE")}{meta.updatedBy ? `, por ${meta.updatedBy}` : ""}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        {(["yape", "plin"] as const).map((k) => (
          <section key={k} className="rounded-2xl border border-line bg-paper p-5">
            <div className="flex items-center justify-between"><BrandBadge brand={k} size="lg" /><span className="text-[11px] text-mute">billetera</span></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm"><span className="text-mute">Número</span><input value={cfg[k].numero} onChange={(e) => setCfg({ ...cfg, [k]: { ...cfg[k], numero: e.target.value.replace(/\D/g, "").slice(0, 12) } })} placeholder="9XXXXXXXX" className="mt-1 w-full rounded-lg border border-line px-3 py-2 font-mono" /></label>
              <label className="text-sm"><span className="text-mute">Titular (como aparece en la app)</span><input value={cfg[k].titular} onChange={(e) => setCfg({ ...cfg, [k]: { ...cfg[k], titular: e.target.value } })} placeholder="Edwin S." className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label>
            </div>
            <div className="mt-3 flex items-start gap-4">
              <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-line bg-paperDeep">
                {cfg[k].qr_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={cfg[k].qr_url} alt={`QR ${k}`} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-[11px] text-mute">sin QR</div>}
              </div>
              <div className="text-sm">
                <div className="text-mute">Código QR (captura desde la app)</div>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-paperDeep"><Upload size={12} /> Subir imagen<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadQr(k, e.target.files[0])} /></label>
                {cfg[k].qr_url && <button onClick={() => setCfg({ ...cfg, [k]: { ...cfg[k], qr_url: "" } })} className="ml-2 text-xs text-rust">quitar</button>}
                <p className="mt-2 text-[11px] text-mute">El QR es público (va en el bucket de reportes). No subas capturas con tu saldo.</p>
              </div>
            </div>
          </section>
        ))}
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-paper p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Cuentas bancarias (transferencia)</h2>
          <button onClick={() => setCfg({ ...cfg, cuentas: [...cfg.cuentas, { banco: "BCP", moneda: "PEN", tipo: "Ahorros", numero: "", cci: "", titular: "" }] })} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-paperDeep"><Plus size={12} /> Agregar cuenta</button>
        </div>
        {!cfg.cuentas.length && <p className="mt-3 text-sm text-mute">Sin cuentas. Las empresas suelen pagar por transferencia: agrega al menos una en soles con CCI.</p>}
        <div className="mt-3 space-y-3">
          {cfg.cuentas.map((cu, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-6">
              <label className="text-xs"><span className="text-mute">Banco</span><select value={cu.banco} onChange={(e) => setCuenta(i, { banco: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm">{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
              <label className="text-xs"><span className="text-mute">Moneda</span><select value={cu.moneda} onChange={(e) => setCuenta(i, { moneda: e.target.value as "PEN" | "USD" })} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm"><option>PEN</option><option>USD</option></select></label>
              <label className="text-xs"><span className="text-mute">Tipo</span><input value={cu.tipo} onChange={(e) => setCuenta(i, { tipo: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" /></label>
              <label className="text-xs"><span className="text-mute">N° de cuenta</span><input value={cu.numero} onChange={(e) => setCuenta(i, { numero: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 font-mono text-sm" /></label>
              <label className="text-xs"><span className="text-mute">CCI (20 dígitos)</span><input value={cu.cci} onChange={(e) => setCuenta(i, { cci: e.target.value.replace(/\D/g, "").slice(0, 20) })} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 font-mono text-sm" /></label>
              <div className="flex items-end gap-1">
                <label className="flex-1 text-xs"><span className="text-mute">Titular</span><input value={cu.titular} onChange={(e) => setCuenta(i, { titular: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" /></label>
                <button onClick={() => setCfg({ ...cfg, cuentas: cfg.cuentas.filter((_, j) => j !== i) })} className="mb-0.5 rounded-lg border border-line p-1.5 text-rust hover:bg-paperDeep"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <label className="block rounded-2xl border border-line bg-paper p-5 text-sm">
          <span className="font-semibold text-ink">Instrucciones para el financiador</span>
          <textarea value={cfg.instrucciones} onChange={(e) => setCfg({ ...cfg, instrucciones: e.target.value })} rows={4} maxLength={600} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="Transfiere el monto exacto indicando el código de tu aporte como concepto…" />
        </label>
        <label className="block rounded-2xl border border-line bg-paper p-5 text-sm">
          <span className="font-semibold text-ink">Correo de contacto para pagos</span>
          <input type="email" value={cfg.contacto_email} onChange={(e) => setCfg({ ...cfg, contacto_email: e.target.value })} className="mt-2 w-full rounded-lg border border-line px-3 py-2" placeholder="el correo que atiende los pagos" />
          {/* TODO(contacto): reemplazar cuando exista un correo del equipo. Antes el ejemplo era pagos@vigiaperu.org, un dominio que no resuelve. */}
          <p className="mt-2 text-[12px] text-mute">Se muestra al financiador por si el pago falla o necesita factura/recibo.</p>
        </label>
      </section>
    </AdminShell>
  );
}
