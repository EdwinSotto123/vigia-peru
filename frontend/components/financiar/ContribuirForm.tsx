"use client";

/**
 * Formulario de contribución: 3 pasos, Zona (ya elegida al llegar), Cantidad y Pago.
 *   - cantidad por defecto: 10 contratos, o los que queden si son menos (precio real de `tarifas` vía props)
 *   - con sesión: la identidad sale de la cuenta (nombre público o anónimo), sin repetir nombre ni correo
 *   - sin sesión: invitado; el correo sirve para asociar el aporte a una cuenta más adelante
 *   - pago: Yape/Plin con QR grande y copiar número, transferencia; línea "¿qué pasa después?"
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
 */

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, EyeOff, Loader2, ShieldAlert, ShieldCheck, User, UserPlus, Users, Zap } from "lucide-react";
import { MIN_CONTRATOS, formatPEN } from "@/lib/financiamiento";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { borrarBorrador, guardarBorrador, idToken, leerBorrador, useCuenta } from "@/lib/cuentas";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEsAdmin } from "@/lib/useEsAdmin";
import { procesarLote, type LoteProcesado } from "@/lib/admin";
import { BrandBadge, PaymentMethods, type PagoPublico } from "./PaymentMethods";
import { PagosCerrados } from "./PagosCerrados";
import { SubirComprobante } from "./SubirComprobante";

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
  /** Cifras reales de la zona para el aviso de pagos cerrados. */
  financiados: number;
  procesados: number;
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
  if (n > restantes) return `En ${zona} quedan ${restantes.toLocaleString("es-PE")} contratos sin financiar: no se puede pedir más.`;
  return null;
}

export function ContribuirForm({ ubigeo, zonaNombre, precioPen, restantes, metodos = [], pagoConfigurado, padre = null, financiados, procesados }: Props) {
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
        <div className="rounded-2xl border border-amber/40 bg-paper p-5 sm:p-6" aria-live="polite">
          <div className="flex items-center gap-2 text-moss"><CheckCircle2 size={18} aria-hidden /><span className="text-sm font-semibold">Procesado a nombre de Vigía Perú</span></div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <h3 className="font-mono text-2xl font-bold text-ink">{procesado.codigo}</h3>
            <span className="text-sm text-mute">{procesado.asignados} de {procesado.solicitados} contratos asignados en {zonaNombre}</span>
          </div>
          <ul className="mt-4 list-inside list-disc space-y-1.5 text-[13px] text-ink">
            <li>{procesado.listosParaProcesar} ya tenían documentos {procesado.dispatcherDisparado ? "y el dispatcher se disparó ahora mismo" : "(el dispatcher los toma en su próximo ciclo, ≤ 5 min)"}.</li>
            <li>{procesado.pedidosAbiertos} quedaron con pedido de descarga: el lote nocturno los baja y luego se procesan solos.</li>
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href={`/impacto/${procesado.codigo}`} className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper">
              Ver comprobante <ArrowRight size={14} aria-hidden />
            </Link>
            <Link href={`/app/auditoria?ubigeo=${ubigeo}`} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-paperDeep">
              Ver en auditoría en vivo
            </Link>
          </div>
          <button type="button" onClick={() => setProcesado(null)} className="mt-4 text-[11px] text-mute underline hover:text-ink">
            Procesar otro lote en {zonaNombre}
          </button>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-amber/40 bg-paper p-5 sm:p-6">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-amber-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-clayTexto">
          <ShieldAlert size={11} aria-hidden /> Modo administrador: a nombre de Vigía Perú, sin pasarela
        </div>
        <h3 className="font-serif text-xl font-bold text-ink">Procesar auditoría en {zonaNombre}</h3>
        <p className="mt-1 text-sm text-mute">{formatPEN(precioPen)} por contrato (referencial). Quedan {restantes.toLocaleString("es-PE")} sin financiar.</p>
        {restantes >= MIN_CONTRATOS ? (
          <>
            {picker}
            {errorAdmin && <p className="mt-4 text-sm text-rust" role="alert">{errorAdmin}</p>}
            <button
              type="button"
              onClick={procesarAhora}
              disabled={loadingAdmin || !!errCantidad}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-clay px-4 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.01] disabled:opacity-60"
            >
              {loadingAdmin ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Zap size={14} aria-hidden />}
              {errCantidad ? "Procesar a nombre de Vigía Perú" : `Procesar ${contratos} contratos a nombre de Vigía Perú`}
            </button>
          </>
        ) : (
          <p className="mt-4 rounded-xl bg-paperDeep px-3 py-2 text-[13px] text-inkSoft">
            {restantes === 0
              ? "No quedan contratos sin financiar en esta zona."
              : `Quedan ${restantes}, menos que el mínimo de ${MIN_CONTRATOS} por lote.`}
            {padre && <> Procesa <Link href={`/app/financiar/${padre.ubigeo}`} className="font-semibold underline">{padre.nombre}</Link> en su lugar.</>}
          </p>
        )}
        <p className="mt-3 rounded-xl bg-paperDeep px-3 py-2 text-[12px] leading-snug text-inkSoft">
          Se asignan por antigüedad: nadie elige contratos, ni el admin. Con documentos ya listos, se procesan ahora; sin ellos, esta noche.
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
        restantes={restantes}
        financiados={financiados}
        procesados={procesados}
        codigoPrevio={creada?.codigo ?? null}
      />
    );
  }

  if (creada) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-5 shadow-card sm:p-6" aria-live="polite">
        <Stepper step={subido ? 4 : 3} />
        <div className="mt-5 flex items-center gap-2 text-moss"><CheckCircle2 size={18} aria-hidden /><span className="text-sm font-semibold">Aporte registrado</span></div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-mono text-2xl font-bold text-ink">{creada.codigo}</h3>
          <span className="text-sm text-mute">{creada.contratos} contratos en {zonaNombre}</span>
        </div>

        {!subido ? (
          <>
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-wide text-mute">Paso 3: paga {formatPEN(creada.montoPen)}</div>
              <div className="mt-2">
                <PaymentMethods pago={creada.pago} monto={formatPEN(creada.montoPen)} concepto={creada.codigo} metodoPreferido={creada.pago.metodo} grande />
              </div>
              <p className="mt-3 rounded-xl bg-paperDeep px-3 py-2 text-[12px] leading-snug text-inkSoft">
                <strong className="text-ink">¿Qué pasa después?</strong> Validamos el pago (≤ 48 h), se asignan {creada.contratos} contratos de {zonaNombre} por antigüedad y cada uno se analiza; su resultado aparece en tu comprobante público.
              </p>
            </div>
            <div className="mt-5">
              <SubirComprobante codigo={creada.codigo} email={email.trim() || null} onSubido={() => { setSubido(true); borrarBorrador(ubigeo); }} />
              <p className="mt-2 text-[12px] text-inkSoft">
                Si lo envías después: desde <Link href="/app/mi-impacto" className="underline">Mi impacto</Link> con una cuenta, o volviendo a esta página en este mismo navegador.
              </p>
            </div>
            <Link href={`/impacto/${creada.codigo}`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink hover:underline">
              Ver mi comprobante de impacto <ArrowRight size={14} aria-hidden />
            </Link>
          </>
        ) : (
          <div className="mt-5 rounded-xl border border-moss/30 bg-moss/5 p-4 text-sm text-ink">
            <div className="font-semibold">Comprobante recibido. ¡Gracias!</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-inkSoft">
              <li>Validamos el pago en menos de 48 h; el estado cambia en tu comprobante público{conCuenta ? " y en Mi impacto" : ""}.</li>
              <li>Al confirmarse, se asignan {creada.contratos} contratos de {zonaNombre} por antigüedad.</li>
              <li>Tu comprobante de impacto se va llenando con cada contrato procesado.</li>
            </ol>
            <Link href={`/impacto/${creada.codigo}`} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper">Ver mi comprobante de impacto <ArrowRight size={12} aria-hidden /></Link>
          </div>
        )}
        {!conCuenta && !authLoading && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-line p-3 text-[12px] text-inkSoft">
            <UserPlus size={14} className="mt-0.5 shrink-0 text-heroViolet" aria-hidden />
            <span>
              <strong className="text-ink">Crea una cuenta para seguir tu aporte</strong>: verás su progreso, las señales halladas y tus zonas en un solo lugar. Guarda tu código <span className="font-mono">{creada.codigo}</span>: con él siempre puedes ver el comprobante.{" "}
              <Link href={`/signup?next=${encodeURIComponent(`/app/mi-impacto?aporte=${creada.codigo}`)}`} className="underline transition-colors hover:text-ink">Crear cuenta</Link>
            </span>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-rust" role="alert">{error}</p>}
        <button type="button" onClick={() => { borrarBorrador(ubigeo); setCreada(null); setSubido(false); }} className="mt-4 text-[11px] text-mute underline hover:text-ink">
          Hacer otro aporte en {zonaNombre}
        </button>
      </div>
    );
  }

  // Zona cubierta, o con menos contratos que el mínimo: se dice, no se ofrece un paquete que no cabe.
  if (restantes < MIN_CONTRATOS) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-5 shadow-card sm:p-6">
        <h3 className="font-serif text-xl font-bold text-ink">
          {restantes === 0 ? `${zonaNombre} ya está financiada` : `Quedan ${restantes} contratos sin financiar en ${zonaNombre}`}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-inkSoft">
          {restantes === 0
            ? "Todos los contratos de su cola ya tienen quien pague su lectura. Puedes seguir cómo avanza."
            : `Es menos que el mínimo de ${MIN_CONTRATOS} contratos por aporte.`}
          {restantes > 0 && padre && <> Si financias {padre.nombre}, sus contratos (incluidos estos) salen de la misma cola por antigüedad.</>}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {restantes > 0 && padre && (
            <Link href={`/app/financiar/${padre.ubigeo}`} className="inline-flex items-center gap-1.5 rounded-xl bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper">
              Financiar {padre.nombre} <ArrowRight size={14} aria-hidden />
            </Link>
          )}
          <Link href={`/app/auditoria?ubigeo=${ubigeo}`} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-paperDeep">
            Ver cómo avanza la lectura
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={crear} noValidate className="rounded-2xl border border-line bg-paper p-5 shadow-card sm:p-6" aria-label="Financiar auditoría">
      <Stepper step={2} />
      <h3 className="mt-5 font-serif text-xl font-bold text-ink">Financiar auditoría en {zonaNombre}</h3>
      <p className="mt-1 text-sm text-mute">{formatPEN(precioPen)} por contrato. Quedan {restantes.toLocaleString("es-PE")} sin financiar.</p>

      {picker}

      {/* Identidad */}
      <div className="mt-5" role="group" aria-labelledby="lbl-quien">
        <div id="lbl-quien" className="text-[11px] uppercase tracking-wide text-mute">¿Quién financia?</div>
        {identidadDesdeCuenta && !masDatos ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paperSoft px-3 py-2 text-sm">
            <span className="inline-flex items-center gap-2 text-ink">
              {tipo === "anonimo" ? <EyeOff size={14} className="text-mute" aria-hidden /> : <User size={14} className="text-mute" aria-hidden />}
              {tipo === "anonimo" ? "Anónimo (tu cuenta no aparece en el muro)" : <>Como <strong>{nombre}</strong></>}
            </span>
            <button type="button" onClick={() => setMasDatos(true)} className="text-[12px] text-mute underline hover:text-ink">cambiar</button>
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
                  <span className="text-mute">{tipo === "persona" ? "Nombre a mostrar" : "Razón social o nombre público"}</span>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete={tipo === "persona" ? "name" : "organization"} className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder={tipo === "persona" ? "Ej. María Q." : "Ej. Empresa X S.A.C."} />
                </label>
              )}
              {necesitaRuc && (
                <label className="text-sm">
                  <span className="text-mute">RUC (11 dígitos; se cruza con sanciones vigentes del OECE y alertas activas)</span>
                  <input value={ruc} inputMode="numeric" onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))} className="mt-1 w-full rounded-lg border border-line px-3 py-2 font-mono" placeholder="20XXXXXXXXX" />
                </label>
              )}
              {!conCuenta && (
                <label className="text-sm">
                  <span className="text-mute">Correo (privado; solo sirve para asociar el aporte a una cuenta)</span>
                  <input type="email" required value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder="tu@correo.pe" />
                </label>
              )}
            </div>
          </>
        )}
        <label className="mt-3 block text-sm">
          <span className="text-mute">Mensaje público (opcional, 140 caracteres)</span>
          <input maxLength={140} value={mensaje} onChange={(e) => setMensaje(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder={`Por un ${zonaNombre} sin sobrecostos`} />
        </label>
      </div>

      {/* Método */}
      <div className="mt-5" role="group" aria-labelledby="lbl-pago">
        <div id="lbl-pago" className="text-[11px] uppercase tracking-wide text-mute">¿Cómo pagas?</div>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Método de pago">
          {(["yape", "plin", "transferencia"] as const).map((m) => (
            <OpcionRadio key={m} name={`metodo-${ubigeo}`} checked={metodo === m} onChange={() => setMetodo(m)} className="capitalize">
              {m}
            </OpcionRadio>
          ))}
        </div>
        {metodos.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-mute">Aceptamos {metodos.map((m) => <BrandBadge key={m} brand={m} />)}</div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-rust" role="alert">{error}</p>}

      <button type="submit" disabled={loading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-heroViolet px-4 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.01] disabled:opacity-60">
        {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
        {monto != null ? <>Continuar al pago de {contratos} contratos <span className="font-mono">{formatPEN(monto)}</span></> : "Continuar al pago"}
      </button>
      <p className="mt-3 rounded-xl bg-paperDeep px-3 py-2 text-[12px] leading-snug text-inkSoft">
        <strong className="text-ink">¿Qué pasa después?</strong> Recibes tu código y los datos de pago, validamos (≤ 48 h), se asignan los contratos de {zonaNombre} por antigüedad y los resultados son públicos.
      </p>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-mute">
        <ShieldCheck size={12} className="mt-0.5 shrink-0 text-moss" aria-hidden />
        <span>Financias capacidad de análisis, no resultados. Los agentes no saben quién aportó. Si tu empresa tiene sanción vigente o alertas activas, el aporte se acepta pero no hay reconocimiento público.</span>
      </p>
    </form>
  );
}

/**
 * Opción de un grupo de radio con apariencia de botón. Es un <input type="radio"> nativo
 * (flechas del teclado, lector de pantalla y foco gratis) escondido dentro de su etiqueta;
 * el anillo de foco se dibuja en la etiqueta con `has-[:focus-visible]`.
 */
function OpcionRadio({ name, checked, onChange, children, className = "" }: {
  name: string; checked: boolean; onChange: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-heroViolet/60 has-[:focus-visible]:ring-offset-1 ${checked ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"} ${className}`}
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
      <div id={`${nombreGrupo}-lbl`} className="text-[11px] uppercase tracking-wide text-mute">¿Cuántos contratos?</div>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Cantidad de contratos">
        {opciones.map((n) => (
          <OpcionRadio key={n} name={nombreGrupo} checked={cantidadTxt === String(n)} onChange={() => setCantidadTxt(String(n))}>
            {n === tope && esTodos && !presets.includes(n) ? `Todos (${n.toLocaleString("es-PE")})` : n.toLocaleString("es-PE")}
            <span className="ml-1 font-mono text-[13px] opacity-75">{formatPEN(n * precioPen)}</span>
          </OpcionRadio>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`${nombreGrupo}-otro`} className="text-mute">Otro:</label>
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
          className={`w-24 rounded-lg border px-2 py-1 font-mono ${error ? "border-rust" : "border-line"}`}
        />
        {monto != null && <span className="font-mono text-ink">= {formatPEN(monto)}</span>}
      </div>
      {error && <p id={idError} className="mt-1.5 text-[12px] text-rust" role="alert">{error}</p>}
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = ["Zona", "Cantidad", "Pago"];
  return (
    <ol className="flex items-center gap-2 text-[11px]" aria-label="Pasos">
      {steps.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < step, active = n === step;
        return (
          <li key={s} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full font-mono ${done ? "bg-moss text-paper" : active ? "bg-ink text-paper" : "bg-paperDeep text-mute"}`}>{done ? "✓" : n}</span>
            <span className={active ? "font-semibold text-ink" : "text-mute"}>{s}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
