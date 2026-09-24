"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Landmark, Loader2, Plus, Save, Trash2, Upload } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, type PagosConfig } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { BrandBadge } from "@/components/financiar/PaymentMethods";
import { Aviso, Badge, Card, claseBoton, EmptyState, ErrorBanner, PageSection, SkeletonPanel, fmtFechaHora } from "@/components/admin/ui";

/**
 * Medios de pago: lo que ve el financiador al registrar un aporte (fase 0: pago manual +
 * comprobante). Es un formulario: se carga una vez, se edita en la página y se guarda entero.
 * Fuente: GET/PUT /api/admin/config/pagos · POST /api/upload (QR)
 */

const BANCOS = ["BCP", "BBVA", "Interbank", "Scotiabank", "Banco de la Nación", "BanBif", "Pichincha", "Otro"];
const EMPTY: PagosConfig = {
  yape: { numero: "", titular: "", qr_url: "" },
  plin: { numero: "", titular: "", qr_url: "" },
  cuentas: [],
  instrucciones: "",
  contacto_email: "",
};
type Respuesta = { valor: Partial<PagosConfig>; updatedAt?: string; updatedBy?: string };
const desde = (v: Partial<PagosConfig>): PagosConfig => ({ ...EMPTY, ...v, yape: { ...EMPTY.yape, ...(v.yape ?? {}) }, plin: { ...EMPTY.plin, ...(v.plin ?? {}) }, cuentas: v.cuentas ?? [] });

const campo = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink";

export default function PagosPage() {
  // Sin revalidar al volver a la pestaña: pisaría lo que estás editando.
  const { data, error, isLoading, mutate } = useAdmin<Respuesta>("/config/pagos", { revalidateOnFocus: false });
  const [cfg, setCfg] = useState<PagosConfig>(EMPTY);
  const [sucio, setSucio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tono: "ok" | "danger"; texto: string; error?: unknown } | null>(null);

  // El formulario toma lo guardado mientras no haya cambios propios sin guardar.
  useEffect(() => {
    if (data && !sucio) setCfg(desde(data.valor));
  }, [data, sucio]);

  const editar = (f: (c: PagosConfig) => PagosConfig) => { setCfg(f); setSucio(true); setMsg(null); };

  async function save() {
    setSaving(true);
    try {
      await adminFetch("/config/pagos", { method: "PUT", body: JSON.stringify(cfg) });
      // Primero la caché con lo guardado: si no, al limpiar `sucio` el formulario volvería un instante a lo anterior.
      await mutate({ valor: cfg, updatedAt: new Date().toISOString() }, { revalidate: false });
      setMsg({ tono: "ok", texto: "Guardado. El formulario público ya muestra estos datos." });
      setSucio(false);
      refrescarAdmin("/config/pagos");
    } catch (e) { setMsg({ tono: "danger", texto: "No se guardaron los cambios", error: e }); }
    finally { setSaving(false); }
  }

  async function uploadQr(kind: "yape" | "plin", file: File) {
    const fd = new FormData(); fd.append("file", file); fd.append("kind", "pago");
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { setMsg({ tono: "danger", texto: "No se pudo subir el QR", error: Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status }) }); return; }
    editar((c) => ({ ...c, [kind]: { ...c[kind], qr_url: j.url } }));
  }

  const setCuenta = (i: number, patch: Partial<PagosConfig["cuentas"][number]>) =>
    editar((c) => ({ ...c, cuentas: c.cuentas.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const agregarCuenta = () => editar((c) => ({ ...c, cuentas: [...c.cuentas, { banco: "BCP", moneda: "PEN", tipo: "Ahorros", numero: "", cci: "", titular: "" }] }));

  return (
    <AdminShell
      title="Medios de pago"
      subtitle="Lo que ve el financiador al registrar un aporte (pago manual + comprobante)"
      actions={
        <>
          {sucio && <Badge tono="warn" punto>Cambios sin guardar</Badge>}
          <Link href="/app/financiar/15" target="_blank" className={claseBoton("secundario")}><Eye size={12} aria-hidden /> Ver como financiador</Link>
          <button onClick={save} disabled={saving || !data} className={claseBoton("primario")}>
            {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Save size={12} aria-hidden />} Guardar
          </button>
        </>
      }
    >
      <div className="space-y-8">
        <ErrorBanner error={error} titulo="No se pudo cargar la configuración" onReintentar={() => mutate()} />
        {msg && (msg.tono === "ok" ? <Aviso tono="ok" titulo={msg.texto} /> : <ErrorBanner error={msg.error ?? msg.texto} titulo={msg.texto} />)}

        {isLoading && !data ? (
          <div className="grid gap-4 lg:grid-cols-2"><SkeletonPanel lineas={4} /><SkeletonPanel lineas={4} /></div>
        ) : (
          <>
            <PageSection
              titulo="Billeteras"
              descripcion={data?.updatedAt ? `Última edición ${fmtFechaHora(data.updatedAt)}${data.updatedBy ? `, por ${data.updatedBy}` : ""}.` : "Todavía nadie guardó esta configuración."}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                {(["yape", "plin"] as const).map((k) => (
                  <Card key={k}>
                    <BrandBadge brand={k} size="lg" />
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm"><span className="text-[12px] font-medium text-inkSoft">Número</span><input value={cfg[k].numero} onChange={(e) => editar((c) => ({ ...c, [k]: { ...c[k], numero: e.target.value.replace(/\D/g, "").slice(0, 12) } }))} placeholder="9XXXXXXXX" inputMode="numeric" className={`${campo} font-mono`} /></label>
                      <label className="text-sm"><span className="text-[12px] font-medium text-inkSoft">Titular (como aparece en la app)</span><input value={cfg[k].titular} onChange={(e) => editar((c) => ({ ...c, [k]: { ...c[k], titular: e.target.value } }))} placeholder="Edwin S." className={campo} /></label>
                    </div>
                    <div className="mt-4 flex items-start gap-4">
                      <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-paperDeep">
                        {cfg[k].qr_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={cfg[k].qr_url} alt={`Código QR de ${k === "yape" ? "Yape" : "Plin"}`} className="h-full w-full object-contain" /> : <span className="text-[11px] text-inkSoft">Sin QR</span>}
                      </div>
                      <div className="min-w-0 text-sm">
                        <p className="text-[12px] font-medium text-inkSoft">Código QR (captura desde la app)</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <label className={claseBoton("secundario", "sm", "cursor-pointer")}><Upload size={12} aria-hidden /> Subir imagen<input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadQr(k, e.target.files[0])} /></label>
                          {cfg[k].qr_url && <button onClick={() => editar((c) => ({ ...c, [k]: { ...c[k], qr_url: "" } }))} className={claseBoton("fantasma", "sm", "text-rust")}>Quitar</button>}
                        </div>
                        <p className="mt-2 text-[11.5px] leading-snug text-mute">El QR es público. No subas capturas donde se vea tu saldo.</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </PageSection>

            <PageSection
              titulo="Cuentas bancarias"
              meta={cfg.cuentas.length ? `${cfg.cuentas.length}` : undefined}
              descripcion="Las empresas suelen pagar por transferencia."
              acciones={cfg.cuentas.length > 0 && <button onClick={agregarCuenta} className={claseBoton("secundario")}><Plus size={12} aria-hidden /> Agregar cuenta</button>}
            >
              {!cfg.cuentas.length ? (
                <Card relleno="none">
                  <EmptyState
                    compacto
                    icono={<Landmark size={18} />}
                    titulo="Sin cuentas bancarias"
                    descripcion="Agrega al menos una en soles con su CCI para que las empresas puedan transferir."
                    accion={<button onClick={agregarCuenta} className={claseBoton("primario")}><Plus size={12} aria-hidden /> Agregar cuenta</button>}
                  />
                </Card>
              ) : (
                <div className="space-y-3">
                  {cfg.cuentas.map((cu, i) => (
                    <Card key={i} relleno="sm" className="grid gap-2 sm:grid-cols-6">
                      <label className="text-xs"><span className="font-medium text-inkSoft">Banco</span><select value={cu.banco} onChange={(e) => setCuenta(i, { banco: e.target.value })} className={campo}>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
                      <label className="text-xs"><span className="font-medium text-inkSoft">Moneda</span><select value={cu.moneda} onChange={(e) => setCuenta(i, { moneda: e.target.value as "PEN" | "USD" })} className={campo}><option value="PEN">Soles</option><option value="USD">Dólares</option></select></label>
                      <label className="text-xs"><span className="font-medium text-inkSoft">Tipo</span><input value={cu.tipo} onChange={(e) => setCuenta(i, { tipo: e.target.value })} className={campo} /></label>
                      <label className="text-xs"><span className="font-medium text-inkSoft">N° de cuenta</span><input value={cu.numero} onChange={(e) => setCuenta(i, { numero: e.target.value })} className={`${campo} font-mono`} /></label>
                      <label className="text-xs"><span className="font-medium text-inkSoft">CCI (20 dígitos)</span><input value={cu.cci} onChange={(e) => setCuenta(i, { cci: e.target.value.replace(/\D/g, "").slice(0, 20) })} inputMode="numeric" className={`${campo} font-mono`} /></label>
                      <div className="flex items-end gap-1">
                        <label className="min-w-0 flex-1 text-xs"><span className="font-medium text-inkSoft">Titular</span><input value={cu.titular} onChange={(e) => setCuenta(i, { titular: e.target.value })} className={campo} /></label>
                        <button onClick={() => editar((c) => ({ ...c, cuentas: c.cuentas.filter((_, j) => j !== i) }))} aria-label={`Quitar la cuenta ${cu.banco} ${cu.numero}`} className="mb-0.5 rounded-lg border border-line p-2 text-rust hover:bg-crimson-soft"><Trash2 size={14} aria-hidden /></button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </PageSection>

            <PageSection titulo="Lo que lee el financiador">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <label className="block text-sm">
                    <span className="font-semibold text-ink">Instrucciones</span>
                    <textarea value={cfg.instrucciones} onChange={(e) => editar((c) => ({ ...c, instrucciones: e.target.value }))} rows={4} maxLength={600} className={campo} placeholder="Transfiere el monto exacto indicando el código de tu aporte como concepto…" />
                    <span className="mt-1 block text-right text-[11px] text-mute">{cfg.instrucciones.length} / 600</span>
                  </label>
                </Card>
                <Card>
                  <label className="block text-sm">
                    <span className="font-semibold text-ink">Correo de contacto para pagos</span>
                    <input type="email" value={cfg.contacto_email} onChange={(e) => editar((c) => ({ ...c, contacto_email: e.target.value }))} className={campo} placeholder="el correo que atiende los pagos" />
                    {/* TODO(contacto): reemplazar cuando exista un correo del equipo. Antes el ejemplo era pagos@vigiaperu.org, un dominio que no resuelve. */}
                    <span className="mt-2 block text-[12px] text-mute">
                      {cfg.contacto_email ? "Se muestra al financiador por si el pago falla o necesita factura o recibo." : "Vacío: el financiador no tiene a quién escribir si el pago falla."}
                    </span>
                  </label>
                </Card>
              </div>
            </PageSection>
          </>
        )}
      </div>
    </AdminShell>
  );
}
