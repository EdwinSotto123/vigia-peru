"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Save } from "lucide-react";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Aviso, Badge, ErrorBanner, PageSection, SkeletonPanel, claseBoton, fmtFechaHora, mensajeError } from "@/components/admin/ui";
import { cn } from "@/lib/utils";
import { PRODUCTO, PRODUCTOS_G, type ConfigGobserva, type Fundador, type PlanBase, type ProductoG, type RespuestaConfig } from "./tipos";

/** Un plan en el formulario: los números como texto mientras se escriben. */
interface PlanForm {
  precio: string;
  fundador: "ninguno" | "cupo" | "meses";
  precioFundador: string;
  n: string;
  activo: boolean;
}
interface Form {
  vendedor: ConfigGobserva["vendedor"];
  medios: ConfigGobserva["medios"];
  aviso: string;
  planes: Record<ProductoG, Record<string, PlanForm>>;
}

const campo = "mt-1 w-full rounded-xl border border-line bg-paperDeep px-3 py-2 text-dato leading-5 text-ink placeholder:text-mute focus:border-granate/60";
const etiqueta = "block text-rotulo font-medium text-inkSoft";
const num = (s: string) => Number(String(s).replace(",", "."));

/** Lo vigente de un plan: el cambio del panel sobre el catálogo del código. */
function vigente(base: PlanBase, cambio: { precio?: number; fundador?: Fundador | null; activo?: boolean } | undefined) {
  return {
    precio: cambio?.precio ?? base.precio,
    fundador: cambio?.fundador === null ? null : (cambio?.fundador ?? base.fundador),
    activo: cambio?.activo ?? base.activo,
  };
}

function aForm(d: RespuestaConfig): Form {
  const planes = Object.fromEntries(
    PRODUCTOS_G.map((p) => [
      p,
      Object.fromEntries(
        Object.entries(d.base[p] ?? {}).map(([id, b]) => {
          const v = vigente(b, d.config.planes[p]?.[id]);
          const f = v.fundador;
          return [
            id,
            {
              precio: String(v.precio),
              fundador: !f ? "ninguno" : f.meses ? "meses" : "cupo",
              precioFundador: f ? String(f.precio) : "",
              n: f ? String(f.meses ?? f.cupo ?? "") : "",
              activo: v.activo,
            } satisfies PlanForm,
          ];
        }),
      ),
    ]),
  ) as Form["planes"];
  return { vendedor: { ...d.config.vendedor }, medios: { ...d.config.medios }, aviso: d.config.aviso ?? "", planes };
}

/** El cuerpo del PUT: sólo lo que difiere del catálogo del código (si mañana cambia un precio por defecto, se nota). */
function aCuerpo(form: Form, base: RespuestaConfig["base"]): { cuerpo: ConfigGobserva; error: string | null } {
  const planes: ConfigGobserva["planes"] = {};
  for (const p of PRODUCTOS_G) {
    for (const [id, f] of Object.entries(form.planes[p] ?? {})) {
      const b = base[p]?.[id];
      if (!b) continue;
      const nombre = `${PRODUCTO[p]}, ${b.nombre}`;
      const precio = num(f.precio);
      if (!Number.isFinite(precio) || precio < 0.5) return { cuerpo: null as never, error: `${nombre}: el precio tiene que ser de S/ 0.50 o más.` };
      let fundador: Fundador | null = null;
      if (f.fundador !== "ninguno") {
        const pf = num(f.precioFundador);
        const n = Math.round(num(f.n));
        if (!Number.isFinite(pf) || pf < 0.5 || pf >= precio) return { cuerpo: null as never, error: `${nombre}: el precio de fundador tiene que ser menor que el regular.` };
        if (!Number.isFinite(n) || n < 1) return { cuerpo: null as never, error: `${nombre}: di para cuántos ${f.fundador === "cupo" ? "clientes" : "meses"} es el precio de fundador.` };
        fundador = f.fundador === "cupo" ? { precio: pf, cupo: n } : { precio: pf, meses: n };
      }
      const cambio: { precio?: number; fundador?: Fundador | null; activo?: boolean } = {};
      if (precio !== b.precio) cambio.precio = precio;
      const igualFundador =
        (!fundador && !b.fundador) ||
        (!!fundador && !!b.fundador && fundador.precio === b.fundador.precio && (fundador.cupo ?? null) === (b.fundador.cupo ?? null) && (fundador.meses ?? null) === (b.fundador.meses ?? null));
      if (!igualFundador) cambio.fundador = fundador;
      if (f.activo !== b.activo) cambio.activo = f.activo;
      if (Object.keys(cambio).length) (planes[p] ??= {})[id] = cambio;
    }
  }
  const ruc = form.vendedor.ruc.trim();
  if (ruc && !/^(10|15|17|20)\d{9}$/.test(ruc)) return { cuerpo: null as never, error: "El RUC tiene 11 dígitos y empieza con 10, 15, 17 o 20 (o déjalo vacío)." };
  return {
    cuerpo: {
      vendedor: {
        nombreComercial: form.vendedor.nombreComercial.trim(),
        ruc,
        razonSocial: form.vendedor.razonSocial.trim(),
        direccion: form.vendedor.direccion.trim(),
        correo: form.vendedor.correo.trim(),
      },
      medios: form.medios,
      planes,
      aviso: form.aviso.trim(),
    },
    error: null,
  };
}

/**
 * Configuración de Gobserva: quién vende (el RUC es una variable: sin él, cada pago lleva «Constancia de pago»; con él,
 * «Recibo»), qué medios de pago se ofrecen, el aviso de arriba de los planes y el precio de cada plan (regular, de
 * fundador por cupo o por meses, y si se vende). Se guarda entero y aplica en un minuto, sin desplegar.
 */
export function ConfiguracionGobserva() {
  // Sin revalidar al volver a la pestaña: pisaría lo que estás editando.
  const { data, error, isLoading, mutate } = useAdmin<RespuestaConfig>("/gobserva/config", { revalidateOnFocus: false });
  const [form, setForm] = useState<Form | null>(null);
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tono: "ok" | "danger"; texto: string } | null>(null);

  useEffect(() => {
    if (data && !sucio) setForm(aForm(data));
  }, [data, sucio]);

  if (error && !data) return <ErrorBanner error={error} titulo="No se pudo cargar la configuración" onReintentar={() => mutate()} />;
  if (isLoading || !data || !form) return <SkeletonPanel lineas={8} />;

  const editar = (f: (x: Form) => Form) => {
    setForm((x) => (x ? f(x) : x));
    setSucio(true);
    setMsg(null);
  };
  const vendedor = (k: keyof Form["vendedor"], v: string) => editar((x) => ({ ...x, vendedor: { ...x.vendedor, [k]: v } }));
  const plan = (p: ProductoG, id: string, cambio: Partial<PlanForm>) =>
    editar((x) => ({ ...x, planes: { ...x.planes, [p]: { ...x.planes[p], [id]: { ...x.planes[p][id], ...cambio } } } }));

  async function guardar() {
    if (!form || !data) return;
    const { cuerpo, error: e } = aCuerpo(form, data.base);
    if (e) {
      setMsg({ tono: "danger", texto: e });
      return;
    }
    setGuardando(true);
    try {
      await adminFetch("/gobserva/config", { method: "PUT", body: JSON.stringify(cuerpo) });
      setSucio(false);
      setMsg({ tono: "ok", texto: "Guardado. Las páginas de planes y el pago lo toman en un minuto." });
      void refrescarAdmin("/gobserva/config");
    } catch (err) {
      setMsg({ tono: "danger", texto: mensajeError(err) });
    } finally {
      setGuardando(false);
    }
  }

  const editado = fmtFechaHora(data.guardado?.updatedAt);
  const conRuc = /^(10|15|17|20)\d{9}$/.test(form.vendedor.ruc.trim());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {sucio ? (
          <Badge tono="warn" punto>Cambios sin guardar</Badge>
        ) : (
          <span className="text-rotulo text-mute">{editado ? `Última edición ${editado}${data.guardado?.updatedBy ? `, por ${data.guardado.updatedBy}` : ""}` : "Con los valores del código"}</span>
        )}
        <button type="button" onClick={() => void guardar()} disabled={guardando || !sucio} className={claseBoton("primario")}>
          {guardando ? <Loader2 size={13} aria-hidden className="animate-spin" /> : <Save size={13} aria-hidden />} Guardar
        </button>
      </div>
      {msg && <Aviso tono={msg.tono} titulo={msg.texto} />}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div className="min-w-0 space-y-5">
          <PageSection
            titulo="Quién vende"
            ayuda={
              <Ayuda titulo="¿Para qué es el RUC?">
                Sale en cada comprobante de pago. Mientras esté vacío, el pago lleva el título «Constancia de pago»; con RUC, «Recibo». Ninguno de los dos es una
                boleta o factura electrónica de SUNAT.
              </Ayuda>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className={etiqueta}>Nombre comercial</span>
                <input value={form.vendedor.nombreComercial} onChange={(e) => vendedor("nombreComercial", e.target.value)} maxLength={80} className={campo} />
              </label>
              <label>
                <span className={etiqueta}>RUC</span>
                <input
                  value={form.vendedor.ruc}
                  onChange={(e) => vendedor("ruc", e.target.value.replace(/\D/g, "").slice(0, 11))}
                  inputMode="numeric"
                  placeholder="Vacío por ahora"
                  className={cn(campo, "font-mono")}
                />
                <span className="mt-1 block text-micro text-mute">{conRuc ? "Los pagos salen como «Recibo»." : "Sin RUC: los pagos salen como «Constancia de pago»."}</span>
              </label>
              <label>
                <span className={etiqueta}>Razón social</span>
                <input value={form.vendedor.razonSocial} onChange={(e) => vendedor("razonSocial", e.target.value)} maxLength={200} placeholder="La del RUC" className={campo} />
              </label>
              <label className="sm:col-span-2">
                <span className={etiqueta}>Dirección fiscal</span>
                <input value={form.vendedor.direccion} onChange={(e) => vendedor("direccion", e.target.value)} maxLength={240} className={campo} />
              </label>
              <label className="sm:col-span-2">
                <span className={etiqueta}>Correo de contacto</span>
                <input value={form.vendedor.correo} onChange={(e) => vendedor("correo", e.target.value)} type="email" maxLength={254} className={campo} />
              </label>
            </div>
          </PageSection>

          <PageSection
            titulo="Medios de pago"
            ayuda={
              <Ayuda titulo="¿De dónde salen los números?">
                Yape, Plin y las cuentas son los mismos de Medios de pago (los aportes de Vigía). La tarjeta es Mercado Pago y necesita sus llaves en la API.
              </Ayuda>
            }
          >
            <ul className="divide-y divide-line rounded-2xl border border-line bg-paperSoft">
              {(
                [
                  ["tarjeta", "Tarjeta (Mercado Pago)", "Suscripción mensual que se renueva sola"],
                  ["yape", "Yape", "Pago por meses; lo confirmas en Cobros"],
                  ["plin", "Plin", "Pago por meses; lo confirmas en Cobros"],
                  ["transferencia", "Transferencia", "A las cuentas de Medios de pago"],
                ] as const
              ).map(([k, nombre, detalle]) => {
                const listo = data.disponibles[k];
                return (
                  <li key={k} className="flex items-center justify-between gap-3 px-4 py-3">
                    <label className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={form.medios[k]}
                        onChange={(e) => editar((x) => ({ ...x, medios: { ...x.medios, [k]: e.target.checked } }))}
                        className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--granate))]"
                      />
                      <span className="min-w-0">
                        <span className="block text-dato font-medium text-ink">{nombre}</span>
                        <span className="block text-micro text-mute">{detalle}</span>
                      </span>
                    </label>
                    {listo ? (
                      <Badge tono="ok">Listo</Badge>
                    ) : k === "tarjeta" ? (
                      <Badge tono="warn">Sin llaves</Badge>
                    ) : (
                      <Link href="/admin/pagos" className={claseBoton("fantasma", "xs")}>Configurar</Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </PageSection>

          <PageSection titulo="Aviso arriba de los planes">
            <label className="block">
              <span className="sr-only">Aviso</span>
              <input
                value={form.aviso}
                onChange={(e) => editar((x) => ({ ...x, aviso: e.target.value }))}
                maxLength={200}
                placeholder="Ej. Precio de fundador hasta el 30 de noviembre"
                className={campo}
              />
              <span className="mt-1 block text-micro text-mute">Sale en las páginas de planes de los tres productos. Vacío, no sale nada.</span>
            </label>
          </PageSection>
        </div>

        <PageSection
          titulo="Precios de los planes"
          ayuda={
            <Ayuda titulo="¿Cómo funciona el precio de fundador?">
              Por cupo: los primeros N clientes que pagan ese plan se quedan con el precio mientras lo mantengan. Por meses: cada cliente paga el precio de fundador sus
              primeros N meses y después pasa solo al regular (en la tarjeta, Mercado Pago cambia el monto de la suscripción).
            </Ayuda>
          }
        >
          <div className="space-y-5">
            {PRODUCTOS_G.map((p) => (
              <div key={p}>
                <h3 className="text-dato font-semibold text-ink">{PRODUCTO[p]}</h3>
                <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-paperSoft">
                  {Object.entries(data.base[p] ?? {}).map(([id, b]) => {
                    const f = form.planes[p][id];
                    return (
                      <li key={id} className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_7rem] 2xl:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1.9fr)]">
                        <div className="min-w-0">
                          <span className="block text-dato font-medium text-ink">{b.nombre}</span>
                          <label className="mt-1 inline-flex items-center gap-2 text-micro text-inkSoft">
                            <input type="checkbox" checked={f.activo} onChange={(e) => plan(p, id, { activo: e.target.checked })} className="h-3.5 w-3.5 accent-[rgb(var(--granate))]" />
                            Se vende
                          </label>
                        </div>
                        <label>
                          <span className={etiqueta}>Regular (S/)</span>
                          <input value={f.precio} onChange={(e) => plan(p, id, { precio: e.target.value })} inputMode="decimal" className={cn(campo, "tabular-nums")} />
                        </label>
                        <div className="grid min-w-0 grid-cols-[minmax(8.5rem,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:col-span-2 2xl:col-span-1">
                          <label className="min-w-0">
                            <span className={etiqueta}>Fundador</span>
                            <select value={f.fundador} onChange={(e) => plan(p, id, { fundador: e.target.value as PlanForm["fundador"] })} className={campo}>
                              <option value="ninguno">No tiene</option>
                              <option value="cupo">Por clientes</option>
                              <option value="meses">Por meses</option>
                            </select>
                          </label>
                          <label className={cn("min-w-0", f.fundador === "ninguno" && "opacity-50")}>
                            <span className={etiqueta}>Precio (S/)</span>
                            <input
                              value={f.precioFundador}
                              onChange={(e) => plan(p, id, { precioFundador: e.target.value })}
                              disabled={f.fundador === "ninguno"}
                              inputMode="decimal"
                              className={cn(campo, "tabular-nums")}
                            />
                          </label>
                          <label className={cn("min-w-0", f.fundador === "ninguno" && "opacity-50")}>
                            <span className={etiqueta}>{f.fundador === "meses" ? "Meses" : "Clientes"}</span>
                            <input value={f.n} onChange={(e) => plan(p, id, { n: e.target.value.replace(/\D/g, "") })} disabled={f.fundador === "ninguno"} inputMode="numeric" className={cn(campo, "tabular-nums")} />
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </PageSection>
      </div>
    </div>
  );
}
