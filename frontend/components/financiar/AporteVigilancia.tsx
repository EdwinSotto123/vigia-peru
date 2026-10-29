"use client";

/**
 * «Ayúdanos a seguir vigilando» (migración 206): el aporte al fondo común que sostiene la vigilancia, cada mes o una
 * vez. Reemplaza al «S/ 3 por contrato» como pedido principal (pedido del usuario del 2026-10-28): lo caro de Vigía es
 * fijo (la base de datos, los servidores, la captura de datos) y la lectura a fondo de un contrato cuesta mucho menos
 * que S/ 3; contar el aporte en contratos no explicaba ni cubría eso.
 *
 *   - cuánto y cada cuánto: S/ 10, 20, 50, 100 u otro (mínimo S/ 5); cada mes o una vez. «Cada mes» es lo que eliges
 *     hacer: sin pasarela, cada mes es un aporte nuevo con el mismo trámite (Yape, Plin o transferencia).
 *   - quién: persona, empresa u organización, o anónimo; con sesión, desde la cuenta.
 *   - `para`: la entidad o la región que mirabas al llegar. Sólo dice qué te motivó: no dirige ninguna lectura.
 *   - pago: los medios de /admin/pagos, con el código como concepto; el comprobante por foto es opcional.
 *   - sin medio de pago configurado no hay formulario: se dice, y se dice quién sostiene hoy a Vigía.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, HandHeart, Loader2, Lock, X } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { soles } from "@/lib/formato";
import { idToken, useCuenta } from "@/lib/cuentas";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda } from "@/components/patrones/Ayuda";
import { useTurnstile } from "@/components/seguridad/Turnstile";
import { cabeceraTurnstile } from "@/components/seguridad/mensajes";
import { cn } from "@/lib/utils";
import { PaymentMethods, type PagoPublico } from "./PaymentMethods";
import { SubirComprobante } from "./SubirComprobante";
import { TarjetaConfirmacion } from "./TarjetaConfirmacion";
import { ETIQUETA_GRUPO, OpcionRadio, TARJETA } from "./PasosAporte";

type Tipo = "persona" | "empresa" | "organizacion" | "anonimo";
type Metodo = "yape" | "plin" | "transferencia";
type Periodicidad = "mensual" | "unica";

export interface ParaAporte {
  ruc?: string;
  ubigeo?: string;
  nombre: string;
}

interface Creado {
  codigo: string;
  montoPen: number;
  periodicidad: Periodicidad;
  pago: PagoPublico & { concepto: string; metodo: string };
}

const MONTOS = [10, 20, 50, 100];
const CLAVE = "vigia:aporte-vigilancia";
const CAMPO = "mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-dato leading-5 text-ink placeholder:text-mute";
const GRUPO = "mt-6 min-w-0 border-t border-line pt-5 [&>legend+*]:clear-left";
const LEYENDA = `${ETIQUETA_GRUPO} float-left mb-2 w-full`;

const ERRORES: Record<string, string> = {
  pagos_cerrados: "Todavía no hay un medio de pago conectado. Vuelve pronto.",
  email_required: "Ingresa un correo: con él ves y asocias tu aporte más adelante.",
  ruc_required: "Empresas y organizaciones deben indicar su RUC.",
  invalid_body: "Revisa el monto (mínimo S/ 5) y los datos.",
  demasiados_pedidos: "Muchos intentos seguidos. Espera un momento y vuelve a intentarlo.",
};

function leer(): Creado | null {
  try {
    const t = window.localStorage.getItem(CLAVE);
    const x = t ? (JSON.parse(t) as Creado & { at: number }) : null;
    return x && Date.now() - x.at < 7 * 86_400_000 ? x : null;
  } catch {
    return null;
  }
}
function guardar(x: Creado | null) {
  try {
    if (x) window.localStorage.setItem(CLAVE, JSON.stringify({ ...x, at: Date.now() }));
    else window.localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: el código igual se muestra */
  }
}

export function AporteVigilancia({ pago, para = null }: { pago: PagoPublico; para?: ParaAporte | null }) {
  const { user, loading: authLoading } = useAuth();
  const { perfil } = useCuenta();
  const [periodicidad, setPeriodicidad] = useState<Periodicidad>("mensual");
  const [monto, setMonto] = useState<number | "otro">(20);
  const [otro, setOtro] = useState("");
  const [tipo, setTipo] = useState<Tipo>("persona");
  const [nombre, setNombre] = useState("");
  const [ruc, setRuc] = useState("");
  const [email, setEmail] = useState("");
  const [mensaje, setMensaje] = useState("");
  const metodos = ([pago.yape && "yape", pago.plin && "plin", pago.cuentas.length > 0 && "transferencia"].filter(Boolean) as Metodo[]);
  const [metodo, setMetodo] = useState<Metodo>(metodos[0] ?? "yape");
  const [motivo, setMotivo] = useState<ParaAporte | null>(para);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<Creado | null>(null);
  const [subido, setSubido] = useState(false);
  const verificacion = useTurnstile("aporte-vigilancia");

  useEffect(() => setCreado(leer()), []);
  // Con sesión: la identidad sale de la cuenta.
  useEffect(() => {
    if (!perfil) return;
    if (perfil.nombrePublico && perfil.visible) {
      setTipo((perfil.tipo as Tipo) ?? "persona");
      setNombre(perfil.nombrePublico);
    } else setTipo("anonimo");
    if (perfil.ruc) setRuc(perfil.ruc);
  }, [perfil]);

  if (!pago.configurado) {
    return (
      <div className={TARJETA}>
        <p className="inline-flex items-center gap-1.5 text-meta font-semibold text-inkSoft">
          <Lock size={15} aria-hidden /> Los aportes todavía no están abiertos
        </p>
        <h2 className="mt-1 font-display text-bloque font-bold leading-snug text-ink">Pronto podrás aportar con Yape, Plin o transferencia</h2>
        <p className="mt-2 max-w-prose text-dato leading-relaxed text-inkSoft">
          Mientras conectamos el medio de pago, Vigía se sostiene con su capital semilla. Abajo ves cuánto cuesta cada mes y en qué
          se usa, rubro por rubro.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <EnlaceAccion href="/app/cuanto-cuesta" variante="secundario" flecha prefetch={false}>
            Cuánto cuesta Vigía
          </EnlaceAccion>
          {pago.contactoEmail && (
            <a href={`mailto:${pago.contactoEmail}?subject=${encodeURIComponent("Quiero apoyar a Vigía")}`} className="inline-flex min-h-[40px] items-center text-dato font-semibold text-granate underline underline-offset-2">
              Escríbenos para apoyar como organización
            </a>
          )}
        </div>
      </div>
    );
  }

  const cantidad = monto === "otro" ? Number.parseFloat(otro.replace(",", ".")) : monto;
  const montoValido = Number.isFinite(cantidad) && cantidad >= 5 && cantidad <= 50_000;
  const conCuenta = !!user;
  const necesitaRuc = tipo === "empresa" || tipo === "organizacion";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!montoValido) return setError("El aporte mínimo es S/ 5.");
    if (necesitaRuc && !/^\d{11}$/.test(ruc)) return setError("Ingresa un RUC de 11 dígitos.");
    if (tipo !== "anonimo" && nombre.trim().length < 2) return setError("Ingresa el nombre que quieres mostrar.");
    if (!conCuenta && !/^\S+@\S+\.\S+$/.test(email)) return setError(ERRORES.email_required);
    setCargando(true);
    try {
      const token = conCuenta ? await idToken() : null;
      const verificado = await verificacion.obtenerToken();
      const r = await fetch(`${PUBLIC_API_BASE}/contribuciones/apoyo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...cabeceraTurnstile(verificado) },
        body: JSON.stringify({
          montoPen: Math.round(cantidad * 100) / 100,
          periodicidad,
          metodo,
          mensajePublico: mensaje.trim() || undefined,
          financiador: {
            tipo: tipo === "anonimo" ? "persona" : tipo,
            nombrePublico: tipo === "anonimo" ? undefined : nombre.trim(),
            ruc: necesitaRuc ? ruc : undefined,
            email: email.trim() || undefined,
          },
          para: motivo ? { ruc: motivo.ruc, ubigeo: motivo.ubigeo } : undefined,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(ERRORES[j?.error] ?? j?.detail ?? "No se pudo registrar el aporte. Inténtalo de nuevo.");
      setCreado(j);
      guardar(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  }

  const otroAporte = (
    <button type="button" onClick={() => { guardar(null); setCreado(null); setSubido(false); }} className="min-h-[24px] text-rotulo underline underline-offset-2 hover:text-ink">
      Hacer otro aporte
    </button>
  );

  if (creado && subido) {
    return (
      <TarjetaConfirmacion
        titulo="Comprobante recibido. ¡Gracias por sostener la vigilancia!"
        acciones={
          <EnlaceAccion href={`/impacto/${creado.codigo}`} prefetch={false}>
            Ver mi comprobante <ArrowRight size={14} aria-hidden />
          </EnlaceAccion>
        }
        pie={<div className="mt-3">{otroAporte}</div>}
      >
        <p>
          Tu aporte <span className="font-mono font-semibold text-ink">{creado.codigo}</span> de {soles(creado.montoPen)} queda en
          validación (menos de 48 h). Lo verás en lo recaudado del mes y en la página de costos.
        </p>
        {creado.periodicidad === "mensual" && (
          <p className="mt-2 inline-flex items-start gap-1.5 text-meta">
            <CalendarClock size={15} aria-hidden className="mt-0.5 shrink-0" />
            Cada mes, vuelve a aportar con el mismo trámite: todavía no hay cobro automático.
          </p>
        )}
      </TarjetaConfirmacion>
    );
  }

  if (creado) {
    return (
      <div className={TARJETA}>
        <p className="inline-flex items-center gap-1.5 text-dato font-semibold text-mossTexto">
          <CheckCircle2 size={16} aria-hidden /> Aporte registrado
        </p>
        <h2 className="mt-1 font-display text-bloque font-bold leading-snug text-ink">
          Paga {soles(creado.montoPen)}{creado.periodicidad === "mensual" ? " (tu aporte de este mes)" : ""}
        </h2>
        <p className="mt-1 text-dato leading-5 text-inkSoft">
          Tu código es <span className="font-mono font-semibold text-ink">{creado.codigo}</span>: ponlo como concepto del pago.
        </p>
        <div className="mt-5">
          <PaymentMethods pago={creado.pago} monto={soles(creado.montoPen)} concepto={creado.codigo} metodoPreferido={creado.pago.metodo} grande />
          <p className="mt-3 inline-flex flex-wrap items-center gap-1 text-rotulo text-inkSoft">
            Validamos el pago en menos de 48 h.
            <Ayuda titulo="¿Qué pasa después?">
              Al validarse, tu aporte suma a lo recaudado del mes y aparece en tu comprobante público. Con lo que entra pagamos la base de
              datos, los servidores, la captura de datos y la lectura a fondo de los contratos más graves, en ese orden. Nadie, tampoco tú,
              elige qué contrato se lee.
            </Ayuda>
          </p>
        </div>
        <div className="mt-5">
          <SubirComprobante codigo={creado.codigo} email={email.trim() || null} onSubido={() => { setSubido(true); guardar(null); }} />
          <p className="mt-2 text-rotulo text-inkSoft">El comprobante es opcional: con el código en el concepto validamos igual.</p>
        </div>
        <Link href={`/impacto/${creado.codigo}`} prefetch={false} className="mt-4 inline-flex min-h-[24px] items-center gap-1 text-dato font-semibold text-granate hover:underline">
          Ver mi comprobante <ArrowRight size={14} aria-hidden />
        </Link>
        <div className="mt-4 text-mute">{otroAporte}</div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className={TARJETA} aria-labelledby="aporte-titulo" noValidate>
      <h2 id="aporte-titulo" className="inline-flex items-center gap-2 font-display text-bloque font-bold text-ink">
        <HandHeart size={20} aria-hidden className="text-granate" /> Tu aporte
      </h2>

      <fieldset className="mt-4 min-w-0 [&>legend+*]:clear-left">
        <legend className={LEYENDA}>Cada cuánto</legend>
        <div className="flex flex-wrap gap-2">
          <OpcionRadio name="periodicidad" checked={periodicidad === "mensual"} onChange={() => setPeriodicidad("mensual")}>Cada mes</OpcionRadio>
          <OpcionRadio name="periodicidad" checked={periodicidad === "unica"} onChange={() => setPeriodicidad("unica")}>Una vez</OpcionRadio>
        </div>
        {periodicidad === "mensual" && (
          <p className="mt-2 text-rotulo text-inkSoft">Lo que más ayuda: con aportes de cada mes podemos planear. Por ahora cada mes es un pago nuevo (no hay cobro automático).</p>
        )}
      </fieldset>

      <fieldset className={GRUPO}>
        <legend className={LEYENDA}>Cuánto</legend>
        <div className="flex flex-wrap gap-2">
          {MONTOS.map((m) => (
            <OpcionRadio key={m} name="monto" checked={monto === m} onChange={() => setMonto(m)}>
              {`S/ ${m}`}
            </OpcionRadio>
          ))}
          <OpcionRadio name="monto" checked={monto === "otro"} onChange={() => setMonto("otro")}>Otro</OpcionRadio>
        </div>
        {monto === "otro" && (
          <label className="mt-3 block max-w-[14rem] text-meta text-inkSoft">
            Monto en soles (mínimo 5)
            <input inputMode="decimal" value={otro} onChange={(e) => setOtro(e.target.value)} className={CAMPO} placeholder="30" aria-invalid={otro !== "" && !montoValido} />
          </label>
        )}
      </fieldset>

      {motivo && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2 text-meta text-inkSoft">
          <span>
            Lo motiva: <strong className="text-ink">{motivo.nombre}</strong>
          </span>
          <Ayuda titulo="¿Qué significa?">
            Sólo dice qué te trajo hasta aquí. Tu aporte va al fondo común: no elige qué contrato se lee.
          </Ayuda>
          <button type="button" onClick={() => setMotivo(null)} className="ml-auto inline-flex min-h-[32px] items-center gap-1 text-rotulo underline underline-offset-2 hover:text-ink">
            <X size={13} aria-hidden /> Quitar
          </button>
        </div>
      )}

      <fieldset className={GRUPO}>
        <legend className={LEYENDA}>Quién aporta</legend>
        {conCuenta && perfil ? (
          <p className="text-meta text-inkSoft">
            Desde tu cuenta: {tipo === "anonimo" ? "aparecerás como anónimo" : <>aparecerás como <strong className="text-ink">{nombre}</strong></>}.{" "}
            <Link href="/app/configuracion" prefetch={false} className="text-granate underline underline-offset-2">Cambiarlo</Link>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {(["persona", "empresa", "organizacion", "anonimo"] as Tipo[]).map((t) => (
                <OpcionRadio key={t} name="tipo" checked={tipo === t} onChange={() => setTipo(t)}>
                  {t === "persona" ? "Persona" : t === "empresa" ? "Empresa" : t === "organizacion" ? "Organización" : "Anónimo"}
                </OpcionRadio>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {tipo !== "anonimo" && (
                <label className="text-meta text-inkSoft">
                  Nombre que se muestra
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={CAMPO} maxLength={80} autoComplete="name" />
                </label>
              )}
              {necesitaRuc && (
                <label className="text-meta text-inkSoft">
                  RUC
                  <input inputMode="numeric" value={ruc} onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))} className={cn(CAMPO, "font-mono")} />
                </label>
              )}
              {!authLoading && !conCuenta && (
                <label className="text-meta text-inkSoft">
                  Correo (no se publica)
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={CAMPO} autoComplete="email" />
                </label>
              )}
            </div>
          </>
        )}
        <label className="mt-3 block text-meta text-inkSoft">
          Mensaje público (opcional)
          <input value={mensaje} onChange={(e) => setMensaje(e.target.value)} className={CAMPO} maxLength={140} placeholder="Por un Estado que rinda cuentas" />
        </label>
      </fieldset>

      {metodos.length > 1 && (
        <fieldset className={GRUPO}>
          <legend className={LEYENDA}>Cómo pagas</legend>
          <div className="flex flex-wrap gap-2">
            {metodos.map((m) => (
              <OpcionRadio key={m} name="metodo" checked={metodo === m} onChange={() => setMetodo(m)}>
                {m === "yape" ? "Yape" : m === "plin" ? "Plin" : "Transferencia"}
              </OpcionRadio>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
        {verificacion.widget}
        <Button type="submit" disabled={cargando || !montoValido} className="w-full sm:w-auto">
          {cargando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          {montoValido ? `Aportar ${soles(cantidad)}${periodicidad === "mensual" ? " cada mes" : ""}` : "Aportar"}
        </Button>
        {error && <p className="text-dato leading-5 text-crimsonTexto" role="alert">{error}</p>}
        <p className="text-rotulo text-mute">
          Te damos un código para el concepto del pago y un comprobante público. Nadie elige qué contrato se lee, tampoco quien aporta.
        </p>
      </div>
    </form>
  );
}
