"use client";

/**
 * «Ayúdanos a seguir vigilando» (migración 206): el aporte al fondo común que sostiene la vigilancia, cada mes o una
 * vez. Reemplaza al «S/ 3 por contrato» como pedido principal (pedido del usuario del 2026-10-28): lo caro de Vigía es
 * fijo (la base de datos, los servidores, la captura de datos) y la lectura a fondo de un contrato cuesta mucho menos
 * que S/ 3; contar el aporte en contratos no explicaba ni cubría eso.
 *
 *   - cuánto y cada cuánto: S/ 10, 20, 50, 100 u otro (mínimo S/ 5); cada mes o una vez. Con tarjeta (Mercado Pago,
 *     2026-10-30), «cada mes» es una suscripción con cobro automático; con Yape, Plin o transferencia, cada mes es un
 *     aporte nuevo con el mismo trámite.
 *   - quién: persona, empresa u organización, o anónimo; con sesión, desde la cuenta.
 *   - `para`: la entidad o la región que mirabas al llegar. Sólo dice qué te motivó: no dirige ninguna lectura.
 *   - pago, en dos opciones con sus marcas (pedido del usuario del 2026-10-30): «Mercado Pago», con las tarjetas que
 *     acepta, abre su formulario (PagoTarjeta) y el aporte se valida solo; «Con QR» (Yape o Plin de /admin/pagos) da
 *     el código para el mensaje en tres pasos (PagoConQr), con la captura opcional. Transferencia si hay cuentas.
 *   - el aporte con QR que quedó guardado en este navegador se vuelve a mostrar sólo mientras siga sin pagar.
 *   - sin ningún medio de pago no hay formulario: se dice, y se dice quién sostiene hoy a Vigía.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarClock, Clock, CreditCard, HandHeart, Landmark, Loader2, Lock, QrCode, X, Zap } from "lucide-react";
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
import { BrandBadge, type PagoPublico } from "./PaymentMethods";
import { MarcaMercadoPago, MarcaPlin, MarcaYape, TarjetasAceptadas } from "./MarcasPago";
import { PagoConQr } from "./PagoConQr";
import { PagoTarjeta, type DatosTarjeta } from "./PagoTarjeta";
import { TarjetaConfirmacion } from "./TarjetaConfirmacion";
import { OpcionRadio, TARJETA } from "./PasosAporte";

type Tipo = "persona" | "empresa" | "organizacion" | "anonimo";
/** Lo que se elige en «Cómo pagas»: Mercado Pago (tarjeta), con QR (Yape o Plin) o transferencia. */
type Opcion = "tarjeta" | "qr" | "transferencia";
type Periodicidad = "mensual" | "unica";

/** Lo que responde POST /pagos/aporte: pagada al instante, en revisión de Mercado Pago o la suscripción activa. */
interface ConTarjeta {
  codigo: string;
  estado: "pagada" | "en_revision" | "suscrita";
  montoPen: number;
  periodicidad: Periodicidad;
  detail?: string;
}

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
/**
 * Tope por el formulario (como la API, routes/contribuciones.ts → TOPE_APORTE): el 25 % de la UIT 2026. Más que eso pide
 * un documento con fecha cierta ante SUNAT, y se acuerda por correo.
 */
const TOPE = 1375;
const CLAVE = "vigia:aporte-vigilancia";
const CAMPO = "mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-dato leading-5 text-ink placeholder:text-mute";
const GRUPO = "mt-6 min-w-0 border-t border-line pt-5 [&>legend+*]:clear-left";
// En frase, no en versalitas: un rótulo en mayúsculas sobre cada grupo era el tic de plantilla que la página quería dejar.
const LEYENDA = "float-left mb-2 w-full text-dato font-semibold text-ink";

const ERRORES: Record<string, string> = {
  pagos_cerrados: "Todavía no hay un medio de pago conectado. Vuelve pronto.",
  email_required: "Ingresa un correo: con él ves y asocias tu aporte más adelante.",
  ruc_required: "Empresas y organizaciones deben indicar su RUC.",
  invalid_body: "Revisa el monto (mínimo S/ 5) y los datos.",
  demasiados_pedidos: "Muchos intentos seguidos. Espera un momento y vuelve a intentarlo.",
  tarjeta_cerrada: "El pago con tarjeta no está disponible ahora. Puedes aportar con Yape o Plin.",
  captcha_requerido: "No pudimos verificar que eres una persona. Recarga la página e inténtalo de nuevo.",
  captcha_invalido: "No pudimos verificar que eres una persona. Recarga la página e inténtalo de nuevo.",
  tarjeta_pausada: "El pago con tarjeta está en pausa unos minutos. Puedes aportar con QR o volver más tarde.",
  demasiados_intentos: "Hiciste varios intentos con tarjeta. Espera unos minutos o aporta con QR.",
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
  const opciones = ([pago.tarjeta && "tarjeta", (pago.yape || pago.plin) && "qr", pago.cuentas.length > 0 && "transferencia"]
    .filter(Boolean) as Opcion[]);
  const [opcion, setOpcion] = useState<Opcion>(opciones[0] ?? "qr");
  // El medio que se registra en un aporte sin tarjeta. Con QR, Yape si está: el panel valida igual si llega por Plin.
  const metodo = opcion === "transferencia" ? "transferencia" : pago.yape ? "yape" : "plin";
  const [paso, setPaso] = useState<"datos" | "tarjeta">("datos");
  const [conTarjeta, setConTarjeta] = useState<ConTarjeta | null>(null);
  const [motivo, setMotivo] = useState<ParaAporte | null>(para);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El campo del error, para marcarlo y llevarle el foco (antes el aviso quedaba suelto bajo el botón).
  const [campoError, setCampoError] = useState<"monto" | "correo" | null>(null);
  const [autorizaMensual, setAutorizaMensual] = useState(false);
  const [creado, setCreado] = useState<Creado | null>(null);
  const [subido, setSubido] = useState(false);
  const verificacion = useTurnstile("aporte-vigilancia");
  const montoRef = useRef<HTMLInputElement | null>(null);
  const correoRef = useRef<HTMLInputElement | null>(null);
  // Al cambiar de paso, el foco va al título del paso nuevo (si no, se perdía en <body> y el lector no lo anunciaba).
  const tituloPaso = useRef<HTMLHeadingElement | null>(null);
  const enfocarPaso = useRef(false);
  useEffect(() => {
    if (!enfocarPaso.current) return;
    enfocarPaso.current = false;
    tituloPaso.current?.focus();
  }, [paso, creado]);

  // El aporte con QR guardado en este navegador, mientras siga sin pagar: uno ya validado, rechazado o que no existe
  // dejaba el «Paga S/ …» a la vista hasta 7 días.
  useEffect(() => {
    const guardado = leer();
    if (!guardado) return;
    setCreado(guardado);
    let vivo = true;
    fetch(`${PUBLIC_API_BASE}/contribuciones/${encodeURIComponent(guardado.codigo)}`)
      .then(async (r) => {
        const estado = r.ok ? ((await r.json().catch(() => null)) as { estado?: string } | null)?.estado : null;
        if (vivo && (r.status === 404 || (estado && estado !== "pendiente_pago"))) {
          guardar(null);
          setCreado(null);
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  // Con sesión: la identidad sale de la cuenta.
  useEffect(() => {
    if (!perfil) return;
    if (perfil.nombrePublico && perfil.visible) {
      setTipo((perfil.tipo as Tipo) ?? "persona");
      setNombre(perfil.nombrePublico);
    } else setTipo("anonimo");
    if (perfil.ruc) setRuc(perfil.ruc);
  }, [perfil]);

  if (!pago.configurado && !pago.tarjeta) {
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
  const montoValido = Number.isFinite(cantidad) && cantidad >= 5 && cantidad <= TOPE;
  const conCuenta = !!user;
  const necesitaRuc = tipo === "empresa" || tipo === "organizacion";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCampoError(null);
    if (!montoValido) {
      setCampoError("monto");
      montoRef.current?.focus();
      return setError(cantidad > TOPE ? "Por este formulario se aporta hasta S/ 1,375. Para aportar más, escríbenos." : "El aporte mínimo es S/ 5.");
    }
    if (necesitaRuc && !/^\d{11}$/.test(ruc)) return setError("Ingresa un RUC de 11 dígitos.");
    if (tipo !== "anonimo" && nombre.trim().length < 2) return setError("Ingresa el nombre que quieres mostrar.");
    if (!conCuenta && !/^\S+@\S+\.\S+$/.test(email)) {
      setCampoError("correo");
      correoRef.current?.focus();
      return setError(ERRORES.email_required);
    }
    // Con tarjeta, el aporte se crea cuando la tarjeta se confirma (pagarConTarjeta).
    if (opcion === "tarjeta") {
      enfocarPaso.current = true;
      return setPaso("tarjeta");
    }
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
      enfocarPaso.current = true;
      setCreado(j);
      guardar(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  }

  /** El formulario de Mercado Pago confirmó la tarjeta: se cobra (o se suscribe) en la API. Rechaza para reintentar. */
  async function pagarConTarjeta(d: DatosTarjeta) {
    setError(null);
    // Un cobro automático cada mes se autoriza aparte, con la casilla (reglas de las marcas para cobros recurrentes).
    if (periodicidad === "mensual" && !autorizaMensual) {
      const m = "Marca la casilla para autorizar el cobro de cada mes.";
      setError(m);
      throw new Error(m);
    }
    try {
      const token = conCuenta ? await idToken() : null;
      const verificado = await verificacion.obtenerToken();
      const r = await fetch(`${PUBLIC_API_BASE}/pagos/aporte`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...cabeceraTurnstile(verificado) },
        body: JSON.stringify({
          montoPen: Math.round(cantidad * 100) / 100,
          periodicidad,
          mensajePublico: mensaje.trim() || undefined,
          financiador: {
            tipo: tipo === "anonimo" ? "persona" : tipo,
            nombrePublico: tipo === "anonimo" ? undefined : nombre.trim(),
            ruc: necesitaRuc ? ruc : undefined,
            email: email.trim() || undefined,
          },
          para: motivo ? { ruc: motivo.ruc, ubigeo: motivo.ubigeo } : undefined,
          tarjeta: { ...d, email: d.email || email.trim() },
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(ERRORES[j?.error] ?? j?.detail ?? "No se pudo procesar el pago. Inténtalo de nuevo.");
      setConTarjeta(j as ConTarjeta);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }

  /** Del pago con QR a Mercado Pago con el mismo monto. El aporte con QR queda sin pagar (el panel lo descarta). */
  function cambiarATarjeta() {
    if (!creado) return;
    if (MONTOS.includes(creado.montoPen)) setMonto(creado.montoPen);
    else {
      setMonto("otro");
      setOtro(String(creado.montoPen));
    }
    setPeriodicidad(creado.periodicidad);
    setOpcion("tarjeta");
    guardar(null);
    enfocarPaso.current = true;
    setCreado(null);
    setPaso("datos");
    setError(null);
  }

  const otroAporte = (
    <button
      type="button"
      onClick={() => { guardar(null); setCreado(null); setSubido(false); setConTarjeta(null); setPaso("datos"); setError(null); }}
      className="min-h-[24px] text-rotulo underline underline-offset-2 hover:text-ink"
    >
      Hacer otro aporte
    </button>
  );

  if (conTarjeta) {
    const titulo =
      conTarjeta.estado === "suscrita" ? "¡Gracias! Tu aporte mensual quedó activo"
        : conTarjeta.estado === "en_revision" ? "Tu pago está en revisión"
        : "¡Gracias! Tu aporte quedó confirmado";
    return (
      <TarjetaConfirmacion
        titulo={titulo}
        acciones={
          <EnlaceAccion href={`/impacto/${conTarjeta.codigo}`} prefetch={false}>
            Ver mi comprobante <ArrowRight size={14} aria-hidden />
          </EnlaceAccion>
        }
        pie={<div className="mt-3">{otroAporte}</div>}
      >
        {conTarjeta.estado === "suscrita" ? (
          <>
            <p>
              Mercado Pago hace el primer cobro de {soles(conTarjeta.montoPen)} dentro de la próxima hora y después uno cada mes, el
              mismo día. Tu código es <span className="font-mono font-semibold text-ink">{conTarjeta.codigo}</span>: guárdalo.
            </p>
            <p className="mt-2 inline-flex items-start gap-1.5 text-meta">
              <CalendarClock size={15} aria-hidden className="mt-0.5 shrink-0" />
              Lo cancelas cuando quieras, sin costo, desde tu comprobante con tu código y tu correo (o en Mercado Pago, si tienes
              cuenta).
            </p>
          </>
        ) : conTarjeta.estado === "en_revision" ? (
          <p>
            {conTarjeta.detail ?? "Mercado Pago está revisando el pago."} Tu código es{" "}
            <span className="font-mono font-semibold text-ink">{conTarjeta.codigo}</span>.
          </p>
        ) : (
          <p>
            Tu aporte <span className="font-mono font-semibold text-ink">{conTarjeta.codigo}</span> de {soles(conTarjeta.montoPen)} ya suma a lo
            recaudado del mes.
          </p>
        )}
      </TarjetaConfirmacion>
    );
  }

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
      <PagoConQr
        pago={creado.pago}
        metodo={creado.pago.metodo}
        montoPen={creado.montoPen}
        mensual={creado.periodicidad === "mensual"}
        codigo={creado.codigo}
        email={email.trim() || null}
        tituloRef={tituloPaso}
        onSubido={() => { setSubido(true); guardar(null); }}
        acciones={
          <>
            <EnlaceAccion href={`/impacto/${creado.codigo}`} variante="secundario" flecha prefetch={false}>
              Ver mi comprobante
            </EnlaceAccion>
            {pago.tarjeta && (
              <button type="button" onClick={cambiarATarjeta} className="inline-flex min-h-[32px] items-center gap-1.5 text-dato font-medium text-granate hover:underline">
                <CreditCard size={15} aria-hidden /> ¿Prefieres tarjeta? Paga con Mercado Pago
              </button>
            )}
            <span className="text-mute">{otroAporte}</span>
          </>
        }
      />
    );
  }

  if (paso === "tarjeta" && pago.tarjeta) {
    return (
      <div className={TARJETA}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <MarcaMercadoPago />
          <span className="inline-flex items-center gap-1 text-rotulo font-medium text-mossTexto">
            <Lock size={13} aria-hidden /> Pago seguro
          </span>
        </div>
        <h2 ref={tituloPaso} tabIndex={-1} className="mt-3 font-display text-bloque font-bold leading-snug text-ink focus:outline-none">
          {periodicidad === "mensual" ? `${soles(cantidad)} cada mes` : `Aporta ${soles(cantidad)}`}
        </h2>
        <p className="mt-1 text-dato leading-5 text-inkSoft">
          {periodicidad === "mensual"
            ? `Con tarjeta de crédito o débito. Hoy se cobra ${soles(cantidad)} y después el mismo día de cada mes, hasta que lo canceles. Lo cancelas cuando quieras, sin costo, desde tu comprobante con tu código y tu correo.`
            : "Con tarjeta de crédito o débito. Se cobra una sola vez."}
        </p>
        <TarjetasAceptadas className="mt-3" />
        {periodicidad === "mensual" && (
          <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl bg-paperSoft px-3 py-2.5 text-dato leading-5 text-ink">
            <input
              type="checkbox"
              checked={autorizaMensual}
              onChange={(e) => setAutorizaMensual(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-granate"
            />
            <span>Autorizo que se cobre {soles(cantidad)} a mi tarjeta hoy y el mismo día de cada mes, hasta que lo cancele.</span>
          </label>
        )}
        <div className="mt-5">
          <PagoTarjeta clavePublica={pago.tarjeta.publicKey} monto={Math.round(cantidad * 100) / 100} email={email.trim() || undefined} onPagar={pagarConTarjeta} />
        </div>
        <div className="mt-3 flex flex-col gap-3">
          {verificacion.widget}
          {error && <p className="text-dato leading-5 text-crimsonTexto" role="alert">{error}</p>}
          <p className="text-rotulo text-mute">Vigía no ve ni guarda los datos de tu tarjeta.</p>
          <button
            type="button"
            onClick={() => { setPaso("datos"); setError(null); }}
            className="inline-flex min-h-[32px] items-center gap-1 self-start text-rotulo underline underline-offset-2 hover:text-ink"
          >
            <ArrowLeft size={13} aria-hidden /> Volver a mis datos
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className={TARJETA} aria-labelledby="aporte-titulo" noValidate>
      <h2 id="aporte-titulo" ref={tituloPaso} tabIndex={-1} className="inline-flex items-center gap-2 font-display text-bloque font-bold text-ink focus:outline-none">
        <HandHeart size={20} aria-hidden className="text-granate" /> Tu aporte
      </h2>

      <fieldset className="mt-4 min-w-0 [&>legend+*]:clear-left">
        <legend className={LEYENDA}>Cada cuánto</legend>
        <div className="flex flex-wrap gap-2">
          <OpcionRadio name="periodicidad" checked={periodicidad === "mensual"} onChange={() => setPeriodicidad("mensual")}>Cada mes</OpcionRadio>
          <OpcionRadio name="periodicidad" checked={periodicidad === "unica"} onChange={() => setPeriodicidad("unica")}>Una vez</OpcionRadio>
        </div>
        {periodicidad === "mensual" && <p className="mt-2 text-rotulo text-inkSoft">Lo que más ayuda: con aportes de cada mes podemos planear.</p>}
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
            Monto en soles (de 5 a 1,375)
            <input
              ref={montoRef}
              inputMode="decimal"
              value={otro}
              onChange={(e) => setOtro(e.target.value)}
              className={CAMPO}
              placeholder="30"
              aria-invalid={(otro !== "" && !montoValido) || campoError === "monto"}
              aria-describedby={campoError === "monto" ? "aporte-error" : undefined}
            />
          </label>
        )}
      </fieldset>

      {opciones.length > 0 && (
        <fieldset className={GRUPO}>
          <legend className={LEYENDA}>Cómo pagas</legend>
          <div className="grid gap-2.5">
            {opciones.includes("tarjeta") && (
              <OpcionMetodo
                checked={opcion === "tarjeta"}
                onChange={() => setOpcion("tarjeta")}
                cabeza={<MarcaMercadoPago />}
                titulo="Tarjeta de crédito o débito"
                marcas={<TarjetasAceptadas />}
                nota={<><Zap size={13} aria-hidden className="shrink-0" /> {periodicidad === "mensual" ? "Se cobra sola cada mes" : "Se confirma al instante"}</>}
              />
            )}
            {opciones.includes("qr") && (
              <OpcionMetodo
                checked={opcion === "qr"}
                onChange={() => setOpcion("qr")}
                cabeza={<span className="inline-flex items-center gap-1.5 text-dato font-semibold text-ink"><QrCode size={16} aria-hidden /> Con QR</span>}
                marcas={<>{pago.yape && <MarcaYape />}{pago.plin && <MarcaPlin />}</>}
                nota={<><Clock size={13} aria-hidden className="shrink-0" /> {periodicidad === "mensual" ? "Cada mes, un pago nuevo; lo validamos en 48 h" : "Lo validamos en menos de 48 h"}</>}
              />
            )}
            {opciones.includes("transferencia") && (
              <OpcionMetodo
                checked={opcion === "transferencia"}
                onChange={() => setOpcion("transferencia")}
                cabeza={<span className="inline-flex items-center gap-1.5 text-dato font-semibold text-ink"><Landmark size={16} aria-hidden /> Transferencia</span>}
                marcas={<>{Array.from(new Set(pago.cuentas.map((c) => c.banco))).map((b) => <BrandBadge key={b} brand={b} />)}</>}
                nota={<><Clock size={13} aria-hidden className="shrink-0" /> Lo validamos en menos de 48 h</>}
              />
            )}
          </div>
        </fieldset>
      )}

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
                  <input
                    ref={correoRef}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={CAMPO}
                    autoComplete="email"
                    aria-invalid={campoError === "correo" || undefined}
                    aria-describedby={campoError === "correo" ? "aporte-error" : undefined}
                  />
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

      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
        {verificacion.widget}
        {/* Habilitado aunque el monto no sirva: al tocarlo dice por qué (antes se apagaba sin explicar nada). */}
        <Button type="submit" disabled={cargando} className="w-full sm:w-auto">
          {cargando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          {!montoValido
            ? "Aportar"
            : `${opcion === "tarjeta" ? "Seguir con Mercado Pago" : opcion === "qr" ? "Seguir con QR" : "Seguir con la transferencia"}: ${soles(cantidad)}${periodicidad === "mensual" ? " al mes" : ""}`}
        </Button>
        {error && <p id="aporte-error" className="text-dato leading-5 text-crimsonTexto" role="alert">{error}</p>}
        <p className="text-rotulo text-mute">Recibes un comprobante público. Nadie elige qué contrato se lee, tampoco quien aporta.</p>
      </div>
    </form>
  );
}

/**
 * Una forma de pagar como tarjeta elegible: su marca, lo que acepta (las marcas) y en cuánto se confirma. Es un radio
 * nativo escondido en su etiqueta, como OpcionRadio: teclado, lector de pantalla y foco sin código extra.
 */
function OpcionMetodo({ checked, onChange, cabeza, titulo, marcas, nota }: {
  checked: boolean;
  onChange: () => void;
  cabeza: React.ReactNode;
  titulo?: string;
  marcas: React.ReactNode;
  nota: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-2xl border p-3.5 transition-colors duration-150",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-granate has-[:focus-visible]:ring-offset-2",
        checked ? "border-granate bg-granate-soft/40" : "border-line bg-paper hover:border-granate/40 hover:bg-granate-50",
      )}
    >
      <input type="radio" name="metodo" checked={checked} onChange={onChange} className="sr-only" />
      <span aria-hidden className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", checked ? "border-granate" : "border-paperEdge")}>
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-granate" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">{cabeza}</span>
        {titulo && <span className="mt-1.5 block text-dato font-semibold leading-5 text-ink">{titulo}</span>}
        <span className="mt-2 flex flex-wrap items-center gap-1.5">{marcas}</span>
        <span className="mt-2 flex items-center gap-1.5 text-rotulo text-inkSoft">{nota}</span>
      </span>
    </label>
  );
}
