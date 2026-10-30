"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, ImageOff, Landmark, Loader2, Plus, QrCode, Save, Trash2, Upload } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, type PagosConfig } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { BrandBadge } from "@/components/financiar/PaymentMethods";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Aviso, Badge, Card, claseBoton, EmptyState, ErrorBanner, PageSection, SkeletonPanel, fmtFechaHora } from "@/components/admin/ui";

/**
 * Medios de pago: lo que ve quien aporta con Yape, Plin o transferencia (la tarjeta, Mercado Pago, no se configura
 * aquí). Es un formulario: se carga una vez, se edita en la página y se guarda entero.
 *
 * Rediseño del 2026-10-30: en escritorio entra en una pantalla, con dónde se paga (billeteras y cuentas) a la izquierda
 * y lo que lee quien aporta a la derecha. Una tarjeta por bloque y, adentro, una fila por billetera o por cuenta (antes
 * una caja por cada una); lo que explica va en el ⓘ de cada título y la última edición, junto a Guardar. Un QR que no
 * carga (el bucket donde se subió puede no responder) muestra un marcador que lo dice, no la imagen rota.
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

type Billetera = "yape" | "plin";
const NOMBRE: Record<Billetera, string> = { yape: "Yape", plin: "Plin" };

// Los campos hundidos del sitio: radio xl, fondo paperDeep, foco en lima.
const campo = "mt-1 w-full rounded-xl border border-line bg-paperDeep px-3 py-2 text-dato leading-5 text-ink placeholder:text-mute focus:border-granate/60";

export default function PagosPage() {
  // Sin revalidar al volver a la pestaña: pisaría lo que estás editando.
  const { data, error, isLoading, mutate } = useAdmin<Respuesta>("/config/pagos", { revalidateOnFocus: false });
  const [cfg, setCfg] = useState<PagosConfig>(EMPTY);
  const [sucio, setSucio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tono: "ok" | "danger"; texto: string; error?: unknown } | null>(null);
  // Los QR que no cargaron, por billetera y con su URL: al subir otro (URL nueva) se vuelve a intentar.
  const [qrRoto, setQrRoto] = useState<Partial<Record<Billetera, string>>>({});

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

  async function uploadQr(kind: Billetera, file: File) {
    const fd = new FormData(); fd.append("file", file); fd.append("kind", "pago");
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { setMsg({ tono: "danger", texto: "No se pudo subir el QR", error: Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status }) }); return; }
    editar((c) => ({ ...c, [kind]: { ...c[kind], qr_url: j.url } }));
  }

  const setCuenta = (i: number, patch: Partial<PagosConfig["cuentas"][number]>) =>
    editar((c) => ({ ...c, cuentas: c.cuentas.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const agregarCuenta = () => editar((c) => ({ ...c, cuentas: [...c.cuentas, { banco: "BCP", moneda: "PEN", tipo: "Ahorros", numero: "", cci: "", titular: "" }] }));

  // Quién tocó esto por última vez, junto a Guardar: es de todo el formulario, no de una sección.
  const editado = fmtFechaHora(data?.updatedAt);
  const ultimaEdicion = editado ? `Última edición ${editado}${data?.updatedBy ? `, por ${data.updatedBy}` : ""}` : "Nadie la guardó todavía";

  return (
    <AdminShell
      title="Medios de pago"
      subtitle="Lo que ve el financiador al aportar con Yape, Plin o transferencia"
      actions={
        <>
          {sucio ? <Badge tono="warn" punto>Cambios sin guardar</Badge> : data && <span className="hidden text-rotulo text-mute sm:inline">{ultimaEdicion}</span>}
          {/* Desde el 2026-10-30 se aporta en «Ayúdanos a seguir vigilando» (antes, /app/financiar/15). */}
          <Link href="/app/apoyar" target="_blank" className={claseBoton("secundario")}>
            <Eye size={12} aria-hidden /> Ver como financiador<span className="sr-only"> (se abre en otra pestaña)</span>
          </Link>
          <button onClick={save} disabled={saving || !data} className={claseBoton("primario")}>
            {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Save size={12} aria-hidden />} Guardar
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorBanner error={error} titulo="No se pudo cargar la configuración" onReintentar={() => mutate()} />
        {msg && (msg.tono === "ok" ? <Aviso tono="ok" titulo={msg.texto} /> : <ErrorBanner error={msg.error ?? msg.texto} titulo={msg.texto} />)}

        {isLoading && !data ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"><SkeletonPanel lineas={6} /><SkeletonPanel lineas={4} /></div>
        ) : (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {/* Dónde se paga. */}
            <div className="min-w-0 space-y-6">
              <PageSection
                titulo="Billeteras"
                ayuda={
                  <Ayuda titulo="¿Qué QR subo?">
                    La captura del código QR para cobrar que te da la app de Yape o Plin. Es público: no subas capturas donde se vea tu saldo.
                  </Ayuda>
                }
              >
                {/* Una tarjeta con una fila por billetera: la marca y los botones del QR (subir, cambiar o quitar) arriba,
                    justo sobre la vista del QR; al lado de esa vista, el número y el titular. */}
                <div className="divide-y divide-line rounded-2xl border border-line bg-paperSoft">
                  {(["yape", "plin"] as const).map((k) => {
                    const url = cfg[k].qr_url;
                    const roto = !!url && qrRoto[k] === url;
                    return (
                      <div key={k} className="px-4 py-3.5 sm:px-5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <BrandBadge brand={k} size="lg" />
                          <div className="flex flex-wrap items-center gap-1.5">
                            <label className={claseBoton("secundario", "sm", "cursor-pointer")}>
                              <Upload size={12} aria-hidden /> {!url ? "Subir QR" : roto ? "Subir de nuevo" : "Cambiar QR"}
                              {/* Se vacía al elegir: «Subir de nuevo» con el mismo archivo vuelve a disparar el cambio. */}
                              <input
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                onChange={(e) => {
                                  const archivo = e.target.files?.[0];
                                  e.target.value = "";
                                  if (archivo) void uploadQr(k, archivo);
                                }}
                              />
                            </label>
                            {url && <button onClick={() => editar((c) => ({ ...c, [k]: { ...c[k], qr_url: "" } }))} className={claseBoton("fantasma", "sm", "text-rust")}>Quitar</button>}
                          </div>
                        </div>
                        <div className="mt-3 flex items-start gap-3 sm:gap-4">
                          <VistaQr url={url} roto={roto} nombre={NOMBRE[k]} onError={() => setQrRoto((r) => ({ ...r, [k]: url }))} />
                          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                            <label className="text-dato leading-5"><span className="text-rotulo font-medium text-inkSoft">Número</span><input value={cfg[k].numero} onChange={(e) => editar((c) => ({ ...c, [k]: { ...c[k], numero: e.target.value.replace(/\D/g, "").slice(0, 12) } }))} placeholder="9XXXXXXXX" inputMode="numeric" className={`${campo} font-mono`} /></label>
                            <label className="text-dato leading-5"><span className="text-rotulo font-medium text-inkSoft">Titular (como aparece en la app)</span><input value={cfg[k].titular} onChange={(e) => editar((c) => ({ ...c, [k]: { ...c[k], titular: e.target.value } }))} placeholder="Edwin S." className={campo} /></label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PageSection>

              <PageSection
                titulo="Cuentas bancarias"
                meta={cfg.cuentas.length ? `${cfg.cuentas.length}` : undefined}
                ayuda={
                  <Ayuda titulo="¿Quién las usa?">
                    Las empresas suelen pagar por transferencia. Agrega al menos una cuenta en soles, con su CCI de 20 dígitos.
                  </Ayuda>
                }
                acciones={cfg.cuentas.length > 0 && <button onClick={agregarCuenta} className={claseBoton("secundario")}><Plus size={12} aria-hidden /> Agregar cuenta</button>}
              >
                {!cfg.cuentas.length ? (
                  <Card relleno="none">
                    <EmptyState
                      compacto
                      icono={<Landmark size={18} />}
                      titulo="Sin cuentas bancarias"
                      descripcion="Agrega al menos una en soles con su CCI para que las empresas puedan transferir."
                      accion={<button onClick={agregarCuenta} className={claseBoton("secundario")}><Plus size={13} aria-hidden /> Agregar cuenta</button>}
                    />
                  </Card>
                ) : (
                  // Una fila por cuenta dentro de una sola tarjeta (antes, una caja por cuenta), con quitar a la derecha.
                  <div className="divide-y divide-line rounded-2xl border border-line bg-paperSoft">
                    {cfg.cuentas.map((cu, i) => (
                      <div key={i} className="flex items-start gap-2 px-4 py-3 sm:px-5">
                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                          <label className="text-rotulo leading-4"><span className="font-medium text-inkSoft">Banco</span><select value={cu.banco} onChange={(e) => setCuenta(i, { banco: e.target.value })} className={campo}>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
                          <label className="text-rotulo leading-4"><span className="font-medium text-inkSoft">Moneda</span><select value={cu.moneda} onChange={(e) => setCuenta(i, { moneda: e.target.value as "PEN" | "USD" })} className={campo}><option value="PEN">Soles</option><option value="USD">Dólares</option></select></label>
                          <label className="text-rotulo leading-4"><span className="font-medium text-inkSoft">Tipo</span><input value={cu.tipo} onChange={(e) => setCuenta(i, { tipo: e.target.value })} className={campo} /></label>
                          <label className="text-rotulo leading-4"><span className="font-medium text-inkSoft">N° de cuenta</span><input value={cu.numero} onChange={(e) => setCuenta(i, { numero: e.target.value })} className={`${campo} font-mono`} /></label>
                          <label className="text-rotulo leading-4"><span className="font-medium text-inkSoft">CCI (20 dígitos)</span><input value={cu.cci} onChange={(e) => setCuenta(i, { cci: e.target.value.replace(/\D/g, "").slice(0, 20) })} inputMode="numeric" className={`${campo} font-mono`} /></label>
                          <label className="text-rotulo leading-4"><span className="font-medium text-inkSoft">Titular</span><input value={cu.titular} onChange={(e) => setCuenta(i, { titular: e.target.value })} className={campo} /></label>
                        </div>
                        <button onClick={() => editar((c) => ({ ...c, cuentas: c.cuentas.filter((_, j) => j !== i) }))} aria-label={`Quitar la cuenta ${cu.banco} ${cu.numero}`} className="mt-5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-crimsonTexto transition-colors duration-rapido hover:border-rust/50 hover:bg-crimson-soft"><Trash2 size={14} aria-hidden /></button>
                      </div>
                    ))}
                  </div>
                )}
              </PageSection>
            </div>

            {/* Lo que lee quien aporta: las instrucciones (largas) y el correo (corto), uno sobre otro en su columna. Las
                instrucciones sólo las muestra el recordatorio de pago pendiente (PagoPendienteFlotante → PaymentMethods);
                el formulario de /app/apoyar (PagoConQr) muestra el correo. */}
            <PageSection
              titulo="Lo que lee el financiador"
              className="min-w-0"
              ayuda={
                <Ayuda titulo="¿Dónde lo ve?">
                  En «Ayúdanos a seguir vigilando», quien paga con Yape, Plin o transferencia ve los números, las cuentas y el código de su aporte, y
                  este correo para dudas o recibos. Las instrucciones salen en el recordatorio de pago pendiente, que lo sigue si se va sin pagar. Para
                  ver cómo queda, usa «Ver como financiador».
                </Ayuda>
              }
            >
              <Card className="space-y-4">
                <label className="block text-dato leading-5">
                  <span className="font-semibold text-ink">Instrucciones</span>
                  <textarea value={cfg.instrucciones} onChange={(e) => editar((c) => ({ ...c, instrucciones: e.target.value }))} rows={4} maxLength={600} className={campo} placeholder="Transfiere el monto exacto indicando el código de tu aporte como concepto…" />
                  <span className="mt-1 block text-right text-micro text-mute">{cfg.instrucciones.length} / 600</span>
                </label>
                <label className="block text-dato leading-5">
                  <span className="font-semibold text-ink">Correo de contacto para pagos</span>
                  <input type="email" value={cfg.contacto_email} onChange={(e) => editar((c) => ({ ...c, contacto_email: e.target.value }))} className={campo} placeholder="el correo que atiende los pagos" />
                  {/* TODO(contacto): reemplazar cuando exista un correo del equipo. Antes el ejemplo era pagos@vigiaperu.org, un dominio que no resuelve. */}
                  {!cfg.contacto_email && <span className="mt-1.5 block text-rotulo leading-snug text-amberTexto">Vacío: el financiador no tiene a quién escribir si el pago falla.</span>}
                </label>
              </Card>
            </PageSection>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

/**
 * La vista del QR guardado. Si la imagen no carga (el bucket donde se subió puede no responder), un marcador limpio que
 * lo dice en vez del ícono de imagen rota con su texto alternativo cortado; sin QR, «Sin QR». Subir otro va en el botón
 * de su fila.
 */
function VistaQr({ url, roto, nombre, onError }: { url: string; roto: boolean; nombre: string; onError: () => void }) {
  return (
    <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-paperDeep">
      {url && !roto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Código QR de ${nombre}`} onError={onError} className="h-full w-full object-contain" />
      ) : (
        <span className="flex flex-col items-center gap-1 px-1.5 text-center text-micro leading-tight text-inkSoft">
          {roto ? <ImageOff size={16} aria-hidden /> : <QrCode size={16} aria-hidden />}
          {roto ? "No se pudo cargar el QR" : "Sin QR"}
        </span>
      )}
    </div>
  );
}
