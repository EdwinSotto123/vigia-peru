"use client";

/**
 * Formulario de contribución: 3 pasos, Zona (ya elegida al llegar), Cantidad y Pago.
 *   - cantidad por defecto: 10 contratos, o los que queden si son menos (precio real de `tarifas` vía props)
 *   - con sesión: la identidad sale de la cuenta (nombre público o anónimo), sin repetir nombre ni correo
 *   - sin sesión: invitado; el correo sirve para asociar el aporte a una cuenta más adelante
 *   - pago: Yape/Plin con QR grande y copiar número, transferencia; "¿qué pasa después?" en una
 *     línea con su ⓘ (DESIGN_SYSTEM.md §10.7): la ayuda de un campo, una línea; el resto, a un clic
 *   - comprobante por foto OPCIONAL; si se envía después, desde Mi impacto o desde esta misma página
 *   - borrador en localStorage (cantidad, identidad y el aporte creado) para no perder nada al recargar
 * La confirmación la hace un admin (POST /admin/contribuciones/:codigo/validar).
 *
 * Sin medio de pago configurado (`pagoConfigurado=false`, hoy el caso real) el formulario NO se
 * dibuja: se dice que los aportes no están abiertos y se ofrecen las salidas que sí existen.
 * El código del formulario se queda para cuando haya pasarela.
 *
 * U6: sesión admin activa (cookie httpOnly de /admin/login, detectada con `useEsAdmin`, nunca
 * redirige a un visitante normal): el MISMO paso de cantidad, pero en vez de "¿quién financia? /
 * ¿cómo pagas?" hay un solo botón, "Procesar N contratos a nombre de Vigía Perú", que llama a
 * POST /admin/procesar-lote (sin pasarela, resultado inmediato) en vez de POST /contribuciones.
 *
 * Presentación (DESIGN_SYSTEM.md §14, conversión): la pregunta de la pantalla es UNA —¿cuántos
 * contratos?—, y va de título; quién financia y cómo paga son pasos del mismo trámite. Los
 * momentos finales (aporte recibido, lote procesado, zona sin cupo) usan `TarjetaConfirmacion`:
 * franja textil arriba y la llamita, una sola por pantalla.
 */

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, EyeOff, Loader2, ShieldAlert, ShieldCheck, User, UserPlus, Users, Zap } from "lucide-react";
import { MIN_CONTRATOS } from "@/lib/financiamiento";
import { numero, soles } from "@/lib/formato";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { borrarBorrador, guardarBorrador, idToken, leerBorrador, useCuenta } from "@/lib/cuentas";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEsAdmin } from "@/lib/useEsAdmin";
import { procesarLote, type LoteProcesado } from "@/lib/admin";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { BrandBadge, PaymentMethods, type PagoPublico } from "./PaymentMethods";
import { PagosCerrados } from "./PagosCerrados";
import { SubirComprobante } from "./SubirComprobante";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda } from "@/components/patrones/Ayuda";
import { TarjetaConfirmacion } from "./TarjetaConfirmacion";

type Tipo = "empresa" | "organizacion" | "persona" | "anonimo";
type Metodo = "yape" | "plin" | "transferencia";

interface Props {
  ubigeo: string;
  zonaNombre: string;
  precioPen: number;
  /** Contratos de la zona aún sin financiar (`zona.pendientes`). */
  restantes: number;
  /** Marcas configuradas (yape, plin, BCP…) para mostrar antes de pagar. */
  metodos?: string[];
  /** `GET /financiamiento/pago` → `configurado`. Sin pasarela no hay formulario ciudadano. */
  pagoConfigurado: boolean;
  /** Zona superior (provincia → departamento), para cuando aquí quedan menos del mínimo. */
  padre?: { ubigeo: string; nombre: string } | null;
  /** Contratos ya financiados en la zona: decide la salida del aviso de pagos cerrados. */
  financiados: number;
}

interface Creada {
  codigo: string;
  montoPen: number;
  contratos: number;
  pago: PagoPublico & { concepto: string; metodo: string };
}

const PRESETS = [10, 20, 50, 100];
/** Mismo tope que valida POST /admin/procesar-lote. */
const MAX_LOTE_ADMIN = 500;

/** Tarjeta del formulario en reposo: borde, sin sombra (DESIGN_SYSTEM.md §5). */
const TARJETA = "rounded-2xl border border-line bg-paper p-5 sm:p-6";
/** Campo de texto del sistema: radio de input, foco granate del CSS global. */
const CAMPO = "mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-mute";
/** Etiqueta de un grupo de campos: 1–3 palabras, así que va en versalitas (§4). */
const ETIQUETA_GRUPO = "text-[11px] font-semibold uppercase tracking-wide text-mute";
/**
 * Un grupo del formulario (¿quién financia?, ¿cómo pagas?) es su propio `<fieldset>`, con la
 * raya de arriba. La leyenda flota a lo ancho para no montarse sobre esa raya (así la dibuja
 * el navegador si no), y lo que sigue la despeja: su `mb-2` es el espacio de debajo.
 */
const GRUPO = "mt-6 min-w-0 border-t border-line pt-5 [&>legend+*]:clear-left";
const LEYENDA = `${ETIQUETA_GRUPO} float-left mb-2 w-full`;

/** Códigos de error del API → castellano. Nunca se muestra un "invalid_body" crudo. */
const ERRORES_API: Record<string, string> = {
  ruc_required: "Empresas y organizaciones deben indicar su RUC.",
  email_required: "Sin sesión necesitamos un correo para asociar el aporte.",
  zona_not_found: "No encontramos esa zona. Vuelve a elegirla desde la lista.",
  internal: "No pudimos registrar el aporte por un error del servidor. Inténtalo de nuevo en un momento.",
  unauthorized: "Tu sesión de administrador venció. Vuelve a entrar al panel.",
};
const ERRORES_CAMPO: Record<string, string> = {
  contratos: `La cantidad debe ser un número entero desde ${MIN_CONTRATOS}.`,
  email: "Ese correo no parece válido.",
  nombrePublico: "El nombre a mostrar debe tener entre 2 y 80 caracteres.",
  ruc: "El RUC debe tener 11 dígitos.",
  mensajePublico: "El mensaje público admite hasta 140 caracteres.",
  ubigeo: "La zona no es válida. Vuelve a elegirla desde la lista.",
};

function mensajeDeError(j: { error?: string; issues?: { path?: (string | number)[] }[] } | null, fallback: string): string {
  if (!j?.error) return fallback;
  if (j.error === "invalid_body") {
    const campo = j.issues?.[0]?.path?.slice(-1)[0];
    return (campo != null && ERRORES_CAMPO[String(campo)]) || "Revisa los datos: algún campo no tiene el formato esperado.";
  }
  return ERRORES_API[j.error] ?? fallback;
}

/** Valida la cantidad contra [mínimo, restantes]. null = válida. */
function errorCantidad(n: number, restantes: number, zona: string): string | null {
  if (!Number.isFinite(n)) return "Escribe cuántos contratos quieres financiar.";
  if (n < MIN_CONTRATOS) return `El mínimo son ${MIN_CONTRATOS} contratos por aporte.`;
  if (n > restantes) return `En ${zona} quedan ${numero(restantes)} contratos sin financiar: no se puede pedir más.`;
  return null;
}

export function ContribuirForm({ ubigeo, zonaNombre, precioPen, restantes, metodos = [], pagoConfigurado, padre = null, financiados }: Props) {
  const { user, loading: authLoading } = useAuth();
  const { perfil } = useCuenta();
  const [cantidadTxt, setCantidadTxt] = useState<string>(String(Math.min(10, Math.max(restantes, MIN_CONTRATOS))));
  const [cantidadTocada, setCantidadTocada] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("persona");
  const [nombre, setNombre] = useState("");
  const [ruc, setRuc] = useState("");
  const [email, setEmail] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [metodo, setMetodo] = useState<Metodo>("yape");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<Creada | null>(null);
  const [subido, setSubido] = useState(false);
  const [masDatos, setMasDatos] = useState(false);
  const restaurado = useRef(false);

  // U6: admin, mismo formulario, sin pasarela, a nombre de Vigía Perú.
  const esAdmin = useEsAdmin();
  // POST /admin/procesar-lote acepta hasta 500 por lote; un aporte ciudadano, hasta lo que quede.
  const tope = esAdmin ? Math.min(restantes, MAX_LOTE_ADMIN) : restantes;
  const contratos = /^\d+$/.test(cantidadTxt) ? Number.parseInt(cantidadTxt, 10) : Number.NaN;
  const errCantidad = esAdmin && contratos > MAX_LOTE_ADMIN && contratos <= restantes
    ? `Un lote de administrador procesa hasta ${MAX_LOTE_ADMIN} contratos.`
    : errorCantidad(contratos, restantes, zonaNombre);
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [errorAdmin, setErrorAdmin] = useState<string | null>(null);
  const [procesado, setProcesado] = useState<LoteProcesado | null>(null);

  async function procesarAhora() {
    setErrorAdmin(null);
    setCantidadTocada(true);
    if (errCantidad) return;
    setLoadingAdmin(true);
    try {
      const r = await procesarLote(ubigeo, contratos);
      setProcesado(r);
    } catch (err) {
      const msg = (err as Error).message;
      setErrorAdmin(ERRORES_API[msg] ?? ERRORES_CAMPO[msg] ?? msg);
    } finally {
      setLoadingAdmin(false);
    }
  }

  // Borrador local: cantidad/identidad y, si ya se creó, el aporte con sus datos de pago.
  useEffect(() => {
    if (restaurado.current) return;
    restaurado.current = true;
    const b = leerBorrador(ubigeo);
    if (!b) return;
    if (b.contratos >= MIN_CONTRATOS && b.contratos <= restantes) setCantidadTxt(String(b.contratos));
    if (b.tipo) setTipo(b.tipo as Tipo);
    setNombre(b.nombre ?? ""); setRuc(b.ruc ?? ""); setEmail(b.email ?? ""); setMensaje(b.mensaje ?? "");
    if (b.metodo) setMetodo(b.metodo as Metodo);
    if (b.creada && Date.now() - new Date(b.creada.creadaAt).getTime() < 7 * 86_400_000) {
      setCreada(b.creada as unknown as Creada);
    }
  }, [ubigeo, restantes]);
  useEffect(() => {
    if (!restaurado.current) return;
    guardarBorrador({ ubigeo, contratos: Number.isFinite(contratos) ? contratos : 0, tipo, nombre, ruc, email, mensaje, metodo,
      creada: creada ? { ...creada, creadaAt: leerBorrador(ubigeo)?.creada?.creadaAt ?? new Date().toISOString() } : null });
  }, [ubigeo, contratos, tipo, nombre, ruc, email, mensaje, metodo, creada]);

  // Con sesión: identidad desde la cuenta (si el usuario quiere aparecer en el muro, con su nombre; si no, anónimo).
  const conCuenta = !!user;
  useEffect(() => {
    if (!perfil) return;
    if (perfil.nombrePublico && perfil.visible) { setTipo((perfil.tipo as Tipo) ?? "persona"); setNombre(perfil.nombrePublico); }
    else setTipo("anonimo");
    if (perfil.ruc) setRuc(perfil.ruc);
  }, [perfil]);

  const monto = errCantidad ? null : contratos * precioPen;
  const necesitaRuc = tipo === "empresa" || tipo === "organizacion";
  const identidadDesdeCuenta = conCuenta && perfil && (tipo === "anonimo" || (perfil.nombrePublico && perfil.visible && nombre === perfil.nombrePublico));

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCantidadTocada(true);
    if (errCantidad) return setError(errCantidad);
    if (necesitaRuc && !/^\d{11}$/.test(ruc)) return setError("Ingresa un RUC de 11 dígitos.");
    if (tipo !== "anonimo" && nombre.trim().length < 2) return setError("Ingresa el nombre que quieres mostrar.");
    if (!conCuenta && !/^\S+@\S+\.\S+$/.test(email)) return setError("Ingresa un correo: con él asocias este aporte a una cuenta más adelante.");
    setLoading(true);
    try {
      const token = conCuenta ? await idToken() : null;
      const r = await fetch(`${PUBLIC_API_BASE}/contribuciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          ubigeo,
          contratos,
          metodo,
          mensajePublico: mensaje.trim() || undefined,
          financiador: {
            tipo: tipo === "anonimo" ? "persona" : tipo,
            nombrePublico: tipo === "anonimo" ? undefined : nombre.trim(),
            ruc: necesitaRuc ? ruc : undefined,
            email: email.trim() || undefined,
          },
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(mensajeDeError(j, "No se pudo registrar el aporte. Inténtalo de nuevo."));
      setCreada(j);
      guardarBorrador({ ubigeo, contratos, tipo, nombre, ruc, email, mensaje, metodo, creada: { ...j, creadaAt: new Date().toISOString() } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const picker = (
    <CantidadPicker
      nombreGrupo={`cantidad-${ubigeo}`}
      cantidadTxt={cantidadTxt}
      setCantidadTxt={setCantidadTxt}
      presets={PRESETS.filter((n) => n >= MIN_CONTRATOS && n <= tope)}
      tope={tope}
      esTodos={tope === restantes}
      precioPen={precioPen}
      monto={monto}
      error={cantidadTocada ? errCantidad : null}
      onBlur={() => setCantidadTocada(true)}
    />
  );

  // U6: sesión admin. Ve lo mismo que cualquiera, pero el botón final procesa en vez de cobrar.
  if (esAdmin) {
    if (procesado) {
      return (
        <TarjetaConfirmacion
          titulo="Lote procesado a nombre de Vigía Perú"
          acciones={
            // El admin sigue su lote en el panel, no en la vista pública: antes los dos
            // botones llevaban a /impacto y /app/auditoria y el lote no se veía en el admin.
            <>
              <EnlaceAccion href={`/admin/procesamientos?lote=${encodeURIComponent(procesado.codigo)}`}>
                Seguir el lote en el panel <ArrowRight size={14} aria-hidden />
              </EnlaceAccion>
              <EnlaceAccion variante="secundario" href={`/impacto/${procesado.codigo}`}>
                Ver el comprobante público
              </EnlaceAccion>
            </>
          }
          pie={
            <button type="button" onClick={() => setProcesado(null)} className="min-h-[24px] underline underline-offset-2 hover:text-ink">
              Procesar otro lote en {zonaNombre}
            </button>
          }
        >
          <p>
            <span className="font-mono font-semibold text-ink">{procesado.codigo}</span>:{" "}
            <strong className="font-mono tabular-nums text-ink">{numero(procesado.asignados)}</strong> de{" "}
            {numero(procesado.solicitados)} contratos asignados en {zonaNombre}.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
            <li>
              {numero(procesado.listosParaProcesar)} ya tenían documentos{" "}
              {procesado.dispatcherDisparado ? "y su lectura empezó ahora mismo." : "y se leen en el próximo ciclo (hasta 5 min)."}
            </li>
            <li>{numero(procesado.pedidosAbiertos)} esperan sus documentos: se leen cuando el lote nocturno los descargue.</li>
          </ul>
        </TarjetaConfirmacion>
      );
    }
    return (
      <div className={TARJETA}>
        <Badge variant="amber">
          <ShieldAlert size={12} aria-hidden /> Modo administrador: a nombre de Vigía Perú, sin pasarela
        </Badge>
        <h2 className="mt-4 font-display text-xl font-bold leading-snug text-ink text-balance">
          ¿Cuántos contratos de {zonaNombre} quieres procesar?
        </h2>
        <p className="mt-1 text-sm text-inkSoft">
          {soles(precioPen)} por contrato (referencial). Quedan {numero(restantes)} sin financiar.
        </p>
        {restantes >= MIN_CONTRATOS ? (
          <>
            {picker}
            {errorAdmin && <p className="mt-4 text-sm text-crimsonTexto" role="alert">{errorAdmin}</p>}
            <Button type="button" full onClick={procesarAhora} disabled={loadingAdmin || !!errCantidad} className="mt-5 py-3">
              {loadingAdmin ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Zap size={14} aria-hidden />}
              {errCantidad ? "Procesar a nombre de Vigía Perú" : `Procesar ${numero(contratos)} contratos a nombre de Vigía Perú`}
            </Button>
          </>
        ) : (
          <p className="mt-4 rounded-xl bg-paperDeep px-3 py-2 text-[13px] text-inkSoft">
            {restantes === 0
              ? "No quedan contratos sin financiar en esta zona."
              : `Quedan ${numero(restantes)}, menos que el mínimo de ${MIN_CONTRATOS} por lote.`}
            {padre && <> Procesa <Link href={`/app/financiar/${padre.ubigeo}`} className="font-semibold text-granate underline underline-offset-2">{padre.nombre}</Link> en su lugar.</>}
          </p>
        )}
        <p className="mt-3 inline-flex flex-wrap items-center gap-1 text-[12px] text-mute">
          Se asignan por antigüedad: nadie elige contratos, ni el admin.
          <Ayuda titulo="¿Cuándo se leen?">
            Los que ya tienen sus documentos se leen ahora; los demás, cuando el lote nocturno los descargue.
          </Ayuda>
        </p>
      </div>
    );
  }

  // Sin medio de pago no hay formulario: decirlo antes de pedir datos que no llevan a ninguna parte.
  if (!pagoConfigurado) {
    return (
      <PagosCerrados
        ubigeo={ubigeo}
        zonaNombre={zonaNombre}
        financiados={financiados}
        codigoPrevio={creada?.codigo ?? null}
      />
    );
  }

  // Crear cuenta para seguir el aporte: sólo sin sesión y sólo cuando el aporte ya existe.
  const invitarCuenta = creada && !conCuenta && !authLoading && (
    <div className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-line p-3 text-[12px] leading-relaxed text-inkSoft">
      <UserPlus size={14} className="mt-0.5 shrink-0 text-granate" aria-hidden />
      <span>
        <strong className="text-ink">Crea una cuenta para seguir tu aporte.</strong> Sin ella, tu código{" "}
        <span className="font-mono">{creada.codigo}</span> basta para ver el comprobante.{" "}
        <Link href={`/signup?next=${encodeURIComponent(`/app/mi-impacto?aporte=${creada.codigo}`)}`} prefetch={false} className="font-semibold text-granate underline underline-offset-2">Crear cuenta</Link>
      </span>
    </div>
  );
  const otroAporte = (
    <button type="button" onClick={() => { borrarBorrador(ubigeo); setCreada(null); setSubido(false); }} className="min-h-[24px] underline underline-offset-2 hover:text-ink">
      Hacer otro aporte en {zonaNombre}
    </button>
  );

  // Comprobante enviado: el trámite terminó de este lado. Es el momento de la llamita.
  if (creada && subido) {
    return (
      <TarjetaConfirmacion
        titulo="Comprobante recibido. ¡Gracias!"
        acciones={
          <EnlaceAccion href={`/impacto/${creada.codigo}`}>
            Ver mi comprobante de impacto <ArrowRight size={14} aria-hidden />
          </EnlaceAccion>
        }
        pie={<>{invitarCuenta}{error && <p className="mt-3 text-sm text-crimsonTexto" role="alert">{error}</p>}<div className="mt-3">{otroAporte}</div></>}
      >
        <p>
          Tu aporte <span className="font-mono font-semibold text-ink">{creada.codigo}</span> financia la lectura de{" "}
          {numero(creada.contratos)} contratos de {zonaNombre}. Esto sigue:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px]">
          <li>Validamos el pago en menos de 48 h; el estado cambia en tu comprobante público{conCuenta ? " y en Mi impacto" : ""}.</li>
          <li>Al confirmarse, se asignan {numero(creada.contratos)} contratos de {zonaNombre} por antigüedad.</li>
          <li>Tu comprobante se va llenando con cada contrato leído, salga con señales o sin ellas.</li>
        </ol>
      </TarjetaConfirmacion>
    );
  }

  if (creada) {
    return (
      <div className={TARJETA}>
        <Stepper step={3} />
        <p className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-mossTexto">
          <CheckCircle2 size={16} aria-hidden /> Aporte registrado
        </p>
        <h2 className="mt-1 font-display text-xl font-bold leading-snug text-ink text-balance">
          Paga {soles(creada.montoPen)} para financiar {numero(creada.contratos)} contratos de {zonaNombre}
        </h2>
        <p className="mt-1 text-sm text-inkSoft">
          Tu código es <span className="font-mono font-semibold text-ink">{creada.codigo}</span>: ponlo como concepto del pago.
        </p>

        <div className="mt-5">
          <PaymentMethods pago={creada.pago} monto={soles(creada.montoPen)} concepto={creada.codigo} metodoPreferido={creada.pago.metodo} grande />
          <p className="mt-3 inline-flex flex-wrap items-center gap-1 text-[12px] text-inkSoft">
            Validamos el pago en menos de 48 h.
            <Ayuda titulo="¿Qué pasa después?">
              Al validarse, se asignan {numero(creada.contratos)} contratos de {zonaNombre} por antigüedad y cada uno se
              lee; su resultado aparece en tu comprobante público.
            </Ayuda>
          </p>
        </div>
        <div className="mt-5">
          <SubirComprobante codigo={creada.codigo} email={email.trim() || null} onSubido={() => { setSubido(true); borrarBorrador(ubigeo); }} />
          <p className="mt-2 text-[12px] text-inkSoft">
            ¿Lo envías después? Desde <Link href="/app/mi-impacto" className="text-granate underline underline-offset-2">Mi impacto</Link> o desde esta página, en este navegador.
          </p>
        </div>
        <Link href={`/impacto/${creada.codigo}`} className="mt-4 inline-flex min-h-[24px] items-center gap-1 text-sm font-semibold text-granate hover:underline">
          Ver mi comprobante de impacto <ArrowRight size={14} aria-hidden />
        </Link>
        {invitarCuenta}
        {error && <p className="mt-3 text-sm text-crimsonTexto" role="alert">{error}</p>}
        <div className="mt-4 text-[12px] text-mute">{otroAporte}</div>
      </div>
    );
  }

  // Zona cubierta, o con menos contratos que el mínimo: se dice, no se ofrece un paquete que no cabe.
  if (restantes < MIN_CONTRATOS) {
    return (
      <TarjetaConfirmacion
        titulo={restantes === 0 ? `${zonaNombre} ya está financiada` : `Quedan ${numero(restantes)} contratos sin financiar en ${zonaNombre}`}
        acciones={
          <>
            {restantes > 0 && padre && (
              <EnlaceAccion href={`/app/financiar/${padre.ubigeo}`}>
                Financiar la lectura de {padre.nombre} <ArrowRight size={14} aria-hidden />
              </EnlaceAccion>
            )}
            <EnlaceAccion variante={restantes > 0 && padre ? "secundario" : "primario"} href={`/app/auditoria?ubigeo=${ubigeo}`}>
              Ver cómo avanza la lectura
            </EnlaceAccion>
          </>
        }
      >
        {restantes === 0
          ? "Todos los contratos de su cola ya tienen quien pague su lectura."
          : `Es menos que el mínimo de ${MIN_CONTRATOS} contratos por aporte.`}
        {restantes > 0 && padre && <> Financiando {padre.nombre}, estos salen de la misma cola por antigüedad.</>}
      </TarjetaConfirmacion>
    );
  }

  return (
    <form onSubmit={crear} noValidate className={TARJETA} aria-labelledby={`titulo-aporte-${ubigeo}`}>
      <Stepper step={2} />
      <h2 id={`titulo-aporte-${ubigeo}`} className="mt-5 font-display text-xl font-bold leading-snug text-ink text-balance">
        ¿Cuántos contratos de {zonaNombre} quieres que se lean?
      </h2>
      <p className="mt-1 text-sm text-inkSoft">
        {soles(precioPen)} por contrato. Quedan {numero(restantes)} sin financiar.
      </p>

      {picker}

      {/* Identidad */}
      <fieldset className={GRUPO}>
        <legend className={LEYENDA}>¿Quién financia?</legend>
        {identidadDesdeCuenta && !masDatos ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2 text-sm">
            <span className="inline-flex items-center gap-2 text-ink">
              {tipo === "anonimo" ? <EyeOff size={14} className="text-mute" aria-hidden /> : <User size={14} className="text-mute" aria-hidden />}
              {tipo === "anonimo" ? "Anónimo (tu cuenta no aparece en el muro)" : <>Como <strong>{nombre}</strong></>}
            </span>
            <button type="button" onClick={() => setMasDatos(true)} className="min-h-[24px] text-[12px] text-granate underline underline-offset-2">cambiar</button>
          </div>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Tipo de financiador">
              {([["persona", "Persona", User], ["empresa", "Empresa", Building2], ["organizacion", "Organización", Users], ["anonimo", "Anónimo", EyeOff]] as const).map(([k, label, Icon]) => (
                <OpcionRadio key={k} name={`tipo-${ubigeo}`} checked={tipo === k} onChange={() => setTipo(k)} className="justify-center">
                  <Icon size={14} aria-hidden /> {label}
                </OpcionRadio>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {tipo !== "anonimo" && (
                <label className="text-sm">
                  <span className="font-medium text-ink">{tipo === "persona" ? "Nombre a mostrar" : "Razón social o nombre público"}</span>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete={tipo === "persona" ? "name" : "organization"} className={CAMPO} placeholder={tipo === "persona" ? "Ej. María Q." : "Ej. Empresa X S.A.C."} />
                </label>
              )}
              {necesitaRuc && (
                <label className="text-sm">
                  <span className="font-medium text-ink">RUC</span>
                  <input value={ruc} inputMode="numeric" autoComplete="off" onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))} className={cn(CAMPO, "font-mono")} placeholder="20XXXXXXXXX" />
                  <span className="mt-1 block text-[12px] leading-snug text-mute">11 dígitos. Se cruza con sanciones vigentes del OECE y alertas activas.</span>
                </label>
              )}
              {!conCuenta && (
                <label className="text-sm">
                  <span className="font-medium text-ink">Correo</span>
                  <input type="email" required value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} className={CAMPO} placeholder="tu@correo.pe" />
                  <span className="mt-1 block text-[12px] leading-snug text-mute">Privado: sólo sirve para asociar el aporte a una cuenta.</span>
                </label>
              )}
            </div>
          </>
        )}
        <label className="mt-3 block text-sm">
          <span className="font-medium text-ink">Mensaje público</span> <span className="text-mute">(opcional, hasta 140 caracteres)</span>
          <input maxLength={140} value={mensaje} onChange={(e) => setMensaje(e.target.value)} className={CAMPO} placeholder={`Por un ${zonaNombre} sin sobrecostos`} />
        </label>
      </fieldset>

      {/* Método */}
      <fieldset className={GRUPO}>
        <legend className={LEYENDA}>¿Cómo pagas?</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Método de pago">
          {(["yape", "plin", "transferencia"] as const).map((m) => (
            <OpcionRadio key={m} name={`metodo-${ubigeo}`} checked={metodo === m} onChange={() => setMetodo(m)} className="capitalize">
              {m}
            </OpcionRadio>
          ))}
        </div>
        {metodos.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-mute">Aceptamos {metodos.map((m) => <BrandBadge key={m} brand={m} />)}</div>
        )}
      </fieldset>

      {error && <p className="mt-4 text-sm text-crimsonTexto" role="alert">{error}</p>}

      <Button type="submit" full disabled={loading} className="mt-6 py-3">
        {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
        {monto != null
          ? <>Financiar {numero(contratos)} contratos por <span className="font-mono">{soles(monto)}</span></>
          : `Financiar la lectura de ${zonaNombre}`}
      </Button>
      {/* Lo que sigue y la independencia, una línea cada uno; el detalle, a un clic (§10.7). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-inkSoft">
        <span className="inline-flex items-center gap-1">
          Recibes tu código y los datos de pago.
          <Ayuda titulo="¿Qué pasa después?">
            Validamos el pago en menos de 48 h, se asignan los contratos de {zonaNombre} por antigüedad y los resultados
            son públicos.
          </Ayuda>
        </span>
        <span className="inline-flex items-center gap-1">
          <ShieldCheck size={13} className="shrink-0 text-granate" aria-hidden />
          Financias lectura, no resultados.
          <Ayuda titulo="¿Qué garantiza la independencia?">
            Quien lee no sabe quién aportó. Si tu empresa tiene sanción vigente o alertas activas, el aporte se acepta
            pero no hay reconocimiento público.
          </Ayuda>
        </span>
      </div>
    </form>
  );
}

/**
 * Opción de un grupo de radio con apariencia de píldora. Es un <input type="radio"> nativo
 * (flechas del teclado, lector de pantalla y foco gratis) escondido dentro de su etiqueta;
 * el anillo de foco se dibuja en la etiqueta con `has-[:focus-visible]`. La elegida va en
 * granate suave: es la marca diciendo "esto elegiste", no una segunda acción primaria.
 */
function OpcionRadio({ name, checked, onChange, children, className = "" }: {
  name: string; checked: boolean; onChange: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors duration-150",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-granate has-[:focus-visible]:ring-offset-2",
        checked ? "border-granate bg-granate-soft font-semibold text-granate" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
        className,
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}

/**
 * Paso "¿cuántos contratos?": mismo selector para el formulario ciudadano y para el admin.
 * El campo "Otro" guarda el TEXTO tal cual se escribe (antes se reescribía en cada tecla y
 * escribir "20" daba 50); se valida al salir del campo y al enviar, contra [mínimo, restantes].
 */
function CantidadPicker({ nombreGrupo, cantidadTxt, setCantidadTxt, presets, tope, esTodos, precioPen, monto, error, onBlur }: {
  nombreGrupo: string;
  cantidadTxt: string;
  setCantidadTxt: (s: string) => void;
  presets: number[];
  /** Máximo que se puede pedir: lo que queda sin financiar (o el tope del lote admin). */
  tope: number;
  /** El tope es TODO lo que queda en la zona: la opción se rotula "Todos (N)". */
  esTodos: boolean;
  precioPen: number;
  monto: number | null;
  error: string | null;
  onBlur: () => void;
}) {
  const idError = useId();
  const opciones = presets.includes(tope) ? presets : [...presets, tope];
  return (
    <div className="mt-5" role="group" aria-labelledby={`${nombreGrupo}-lbl`}>
      <div id={`${nombreGrupo}-lbl`} className={ETIQUETA_GRUPO}>Contratos</div>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Cantidad de contratos">
        {opciones.map((n) => (
          <OpcionRadio key={n} name={nombreGrupo} checked={cantidadTxt === String(n)} onChange={() => setCantidadTxt(String(n))}>
            <span className="tabular-nums">{n === tope && esTodos && !presets.includes(n) ? `Todos (${numero(n)})` : numero(n)}</span>
            <span className="ml-1 font-mono text-[12px] font-normal tabular-nums opacity-80">{soles(n * precioPen)}</span>
          </OpcionRadio>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`${nombreGrupo}-otro`} className="text-inkSoft">Otra cantidad</label>
        <input
          id={`${nombreGrupo}-otro`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={cantidadTxt}
          onChange={(e) => setCantidadTxt(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onBlur={onBlur}
          aria-invalid={!!error}
          aria-describedby={error ? idError : undefined}
          className={cn("w-24 rounded-xl border bg-paper px-3 py-1.5 font-mono tabular-nums", error ? "border-crimson" : "border-line")}
        />
        {monto != null && <span className="font-mono tabular-nums text-ink">= {soles(monto)}</span>}
      </div>
      {error && <p id={idError} className="mt-1.5 text-[12px] text-crimsonTexto" role="alert">{error}</p>}
    </div>
  );
}

/** Los tres pasos del trámite. Hecho = moss (positivo); en curso = granate (la marca). */
function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = ["Zona", "Cantidad", "Pago"];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[12px]" aria-label="Pasos">
      {steps.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < step, active = n === step;
        return (
          <li key={s} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px]",
              done ? "bg-moss text-paper" : active ? "bg-granate text-paper" : "bg-paperDeep text-mute",
            )}>
              {done ? <span aria-hidden>✓</span> : n}
              {done && <span className="sr-only">hecho:</span>}
            </span>
            <span className={active ? "font-semibold text-ink" : "text-mute"}>{s}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
