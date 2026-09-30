"use client";

/**
 * Formulario de contribución: 3 pasos, Zona o Entidad (ya elegida al llegar), Cantidad y Pago.
 *   - alcance: una ZONA (sus contratos en cola por antigüedad, mínimo 5) o una ENTIDAD (al azar
 *     entre los suyos en cola, primero los que ya tienen documentos; mínimo 1, máximo lo que
 *     tenga en cola). El cuerpo lleva `ubigeo` o `entidadRuc`, nunca los dos.
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
 * U6: sesión admin activa → `LoteAdmin` (mismo paso de cantidad, un solo botón que procesa a
 * nombre de Vigía Perú en vez de cobrar).
 *
 * Presentación (DESIGN_SYSTEM.md §14, conversión): la pregunta de la pantalla es UNA —¿cuántos
 * contratos?—, y va de título; quién financia y cómo paga son pasos del mismo trámite. Los
 * momentos finales (aporte recibido, zona sin cupo) usan `TarjetaConfirmacion`: franja textil
 * arriba y la llamita, una sola por pantalla.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, EyeOff, Loader2, ShieldCheck, User, UserCog, UserPlus, Users } from "lucide-react";
import { numero, plural, soles } from "@/lib/formato";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { borrarBorrador, guardarBorrador, idToken, leerBorrador, useCuenta } from "@/lib/cuentas";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEsAdmin } from "@/lib/useEsAdmin";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { BrandBadge, PaymentMethods, type PagoPublico } from "./PaymentMethods";
import { PagosCerrados } from "./PagosCerrados";
import { SubirComprobante } from "./SubirComprobante";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda } from "@/components/patrones/Ayuda";
import { TarjetaConfirmacion } from "./TarjetaConfirmacion";
import { LoteAdmin } from "./LoteAdmin";
import { CantidadPicker, ETIQUETA_GRUPO, OpcionRadio, Stepper, TARJETA, errorCantidad } from "./PasosAporte";
import {
  ASIGNACION,
  PRESETS,
  claveAlcance,
  cuerpoAlcance,
  mensajeDeError,
  mensajeTope,
  minimoDe,
  type AlcanceAporte,
} from "./alcanceAporte";

export type { AlcanceAporte } from "./alcanceAporte";

type Tipo = "empresa" | "organizacion" | "persona" | "anonimo";
type Metodo = "yape" | "plin" | "transferencia";

interface Props {
  /** Qué se financia: la zona (ubigeo) o la entidad (RUC), con su nombre para los textos. */
  alcance: AlcanceAporte;
  precioPen: number;
  /** Contratos aún sin financiar: zona → `zona.pendientes`; entidad → `cola.contratos`. */
  restantes: number;
  /** Marcas configuradas (yape, plin, BCP…) para mostrar antes de pagar. */
  metodos?: string[];
  /** `GET /financiamiento/pago` → `configurado`. Sin pasarela no hay formulario ciudadano. */
  pagoConfigurado: boolean;
  /** Zona superior (provincia → departamento), para cuando aquí quedan menos del mínimo. Sólo por zona. */
  padre?: { ubigeo: string; nombre: string } | null;
  /** Contratos ya financiados: decide la salida del aviso de pagos cerrados. */
  financiados: number;
}

interface Creada {
  codigo: string;
  montoPen: number;
  contratos: number;
  pago: PagoPublico & { concepto: string; metodo: string };
}

/** Campo de texto del sistema: radio de input, foco granate del CSS global. */
const CAMPO = "mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-mute";
/**
 * Un grupo del formulario (¿quién financia?, ¿cómo pagas?) es su propio `<fieldset>`, con la
 * raya de arriba. La leyenda flota a lo ancho para no montarse sobre esa raya (así la dibuja
 * el navegador si no), y lo que sigue la despeja: su `mb-2` es el espacio de debajo.
 */
const GRUPO = "mt-6 min-w-0 border-t border-line pt-5 [&>legend+*]:clear-left";
const LEYENDA = `${ETIQUETA_GRUPO} float-left mb-2 w-full`;

export function ContribuirForm({ alcance, precioPen, restantes, metodos = [], pagoConfigurado, padre = null, financiados }: Props) {
  // U6: admin, mismo paso de cantidad, sin pasarela, a nombre de Vigía Perú.
  const esAdmin = useEsAdmin();
  if (esAdmin) return <LoteAdmin alcance={alcance} precioPen={precioPen} restantes={restantes} padre={padre} />;
  return (
    <FormCiudadano
      alcance={alcance}
      precioPen={precioPen}
      restantes={restantes}
      metodos={metodos}
      pagoConfigurado={pagoConfigurado}
      padre={padre}
      financiados={financiados}
    />
  );
}

function FormCiudadano({ alcance, precioPen, restantes, metodos = [], pagoConfigurado, padre = null, financiados }: Props) {
  const { user, loading: authLoading } = useAuth();
  const { perfil } = useCuenta();
  const minimo = minimoDe(alcance);
  const clave = claveAlcance(alcance);
  const destino = alcance.nombre;
  const porZona = alcance.tipo === "zona";
  const [cantidadTxt, setCantidadTxt] = useState<string>(String(Math.min(10, Math.max(restantes, minimo))));
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

  const contratos = /^\d+$/.test(cantidadTxt) ? Number.parseInt(cantidadTxt, 10) : Number.NaN;
  const errCantidad = errorCantidad(contratos, restantes, minimo, mensajeTope(alcance, restantes));

  // Borrador local: cantidad/identidad y, si ya se creó, el aporte con sus datos de pago.
  useEffect(() => {
    if (restaurado.current) return;
    restaurado.current = true;
    const b = leerBorrador(clave);
    if (!b) return;
    if (b.contratos >= minimo && b.contratos <= restantes) setCantidadTxt(String(b.contratos));
    if (b.tipo) setTipo(b.tipo as Tipo);
    setNombre(b.nombre ?? ""); setRuc(b.ruc ?? ""); setEmail(b.email ?? ""); setMensaje(b.mensaje ?? "");
    if (b.metodo) setMetodo(b.metodo as Metodo);
    if (b.creada && Date.now() - new Date(b.creada.creadaAt).getTime() < 7 * 86_400_000) {
      setCreada(b.creada as unknown as Creada);
    }
  }, [clave, restantes, minimo]);
  useEffect(() => {
    if (!restaurado.current) return;
    guardarBorrador({ ubigeo: clave, contratos: Number.isFinite(contratos) ? contratos : 0, tipo, nombre, ruc, email, mensaje, metodo,
      creada: creada ? { ...creada, creadaAt: leerBorrador(clave)?.creada?.creadaAt ?? new Date().toISOString() } : null });
  }, [clave, contratos, tipo, nombre, ruc, email, mensaje, metodo, creada]);

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
          ...cuerpoAlcance(alcance),
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
      if (!r.ok) throw new Error(mensajeDeError(j, "No se pudo registrar el aporte. Inténtalo de nuevo.", minimo));
      setCreada(j);
      guardarBorrador({ ubigeo: clave, contratos, tipo, nombre, ruc, email, mensaje, metodo, creada: { ...j, creadaAt: new Date().toISOString() } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Sin medio de pago no hay formulario: decirlo antes de pedir datos que no llevan a ninguna parte.
  if (!pagoConfigurado) {
    return <PagosCerrados alcance={alcance} financiados={financiados} codigoPrevio={creada?.codigo ?? null} />;
  }

  // Después de aportar, una sola invitación: sin sesión, crear la cuenta; con sesión, completar
  // el perfil público (lo que se ve en el muro de aliados y en el comprobante).
  const invitarCuenta = creada && !authLoading && (
    conCuenta ? (
      <p className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-inkSoft">
        <UserCog size={14} className="shrink-0 text-granate" aria-hidden />
        <Link href="/app/configuracion" prefetch={false} className="font-semibold text-granate underline underline-offset-2">Completa tu perfil público</Link>
      </p>
    ) : (
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-line p-3 text-[12px] leading-relaxed text-inkSoft">
        <UserPlus size={14} className="mt-0.5 shrink-0 text-granate" aria-hidden />
        <span>
          <strong className="text-ink">Crea una cuenta para seguir tu aporte.</strong> Sin ella, tu código{" "}
          <span className="font-mono">{creada.codigo}</span> basta para ver el comprobante.{" "}
          <Link href={`/signup?next=${encodeURIComponent(`/app/mi-impacto?aporte=${creada.codigo}`)}`} prefetch={false} className="font-semibold text-granate underline underline-offset-2">Crear cuenta</Link>
        </span>
      </div>
    )
  );
  const otroAporte = (
    <button type="button" onClick={() => { borrarBorrador(clave); setCreada(null); setSubido(false); }} className="min-h-[24px] underline underline-offset-2 hover:text-ink">
      {porZona ? `Hacer otro aporte en ${destino}` : `Financiar más contratos de ${destino}`}
    </button>
  );
  const asignacion = ASIGNACION[alcance.tipo];

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
          {numero(creada.contratos)} {creada.contratos === 1 ? "contrato" : "contratos"} de {destino}. Esto sigue:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px]">
          <li>Validamos el pago en menos de 48 h; el estado cambia en tu comprobante público{conCuenta ? " y en Mi impacto" : ""}.</li>
          <li>Al confirmarse, se asignan {numero(creada.contratos)} {creada.contratos === 1 ? "contrato" : "contratos"} de {destino} {asignacion}.</li>
          <li>Tu comprobante se va llenando con cada contrato leído, salga con señales o sin ellas.</li>
        </ol>
      </TarjetaConfirmacion>
    );
  }

  if (creada) {
    return (
      <div className={TARJETA}>
        <Stepper step={3} primero={porZona ? "Zona" : "Entidad"} />
        <p className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-mossTexto">
          <CheckCircle2 size={16} aria-hidden /> Aporte registrado
        </p>
        <h2 className="mt-1 font-display text-xl font-bold leading-snug text-ink text-balance">
          Paga {soles(creada.montoPen)} para financiar {plural(creada.contratos, "contrato", "contratos")} de {destino}
        </h2>
        <p className="mt-1 text-sm text-inkSoft">
          Tu código es <span className="font-mono font-semibold text-ink">{creada.codigo}</span>: ponlo como concepto del pago.
        </p>

        <div className="mt-5">
          <PaymentMethods pago={creada.pago} monto={soles(creada.montoPen)} concepto={creada.codigo} metodoPreferido={creada.pago.metodo} grande />
          <p className="mt-3 inline-flex flex-wrap items-center gap-1 text-[12px] text-inkSoft">
            Validamos el pago en menos de 48 h.
            <Ayuda titulo="¿Qué pasa después?">
              Al validarse, se asignan {plural(creada.contratos, "contrato", "contratos")} de {destino} {asignacion} y cada
              uno se lee; su resultado aparece en tu comprobante público.
            </Ayuda>
          </p>
        </div>
        <div className="mt-5">
          <SubirComprobante codigo={creada.codigo} email={email.trim() || null} onSubido={() => { setSubido(true); borrarBorrador(clave); }} />
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

  // Sin cupo: se dice, no se ofrece un paquete que no cabe.
  if (restantes < minimo) {
    return porZona ? (
      <TarjetaConfirmacion
        titulo={restantes === 0 ? `${destino} ya está financiada` : `Quedan ${numero(restantes)} contratos sin financiar en ${destino}`}
        acciones={
          <>
            {restantes > 0 && padre && (
              <EnlaceAccion href={`/app/financiar/${padre.ubigeo}`}>
                Financiar la lectura de {padre.nombre} <ArrowRight size={14} aria-hidden />
              </EnlaceAccion>
            )}
            <EnlaceAccion variante={restantes > 0 && padre ? "secundario" : "primario"} href={`/app/auditoria?ubigeo=${alcance.ubigeo}`}>
              Ver cómo avanza la lectura
            </EnlaceAccion>
          </>
        }
      >
        {restantes === 0
          ? "Todos los contratos de su cola ya tienen quien pague su lectura."
          : `Es menos que el mínimo de ${minimo} contratos por aporte.`}
        {restantes > 0 && padre && <> Financiando {padre.nombre}, estos salen de la misma cola por antigüedad.</>}
      </TarjetaConfirmacion>
    ) : (
      <TarjetaConfirmacion
        titulo={`${destino} ya no tiene contratos en cola`}
        acciones={<EnlaceAccion href="/app/financiar?por=entidad">Elegir otra entidad</EnlaceAccion>}
      >
        Todos los contratos de su cola ya tienen quien pague su lectura.
      </TarjetaConfirmacion>
    );
  }

  const presets = PRESETS[alcance.tipo].filter((n) => n >= minimo && n <= restantes);

  return (
    <form onSubmit={crear} noValidate className={TARJETA} aria-labelledby={`titulo-aporte-${clave}`}>
      <Stepper step={2} primero={porZona ? "Zona" : "Entidad"} />
      <h2 id={`titulo-aporte-${clave}`} className="mt-5 font-display text-xl font-bold leading-snug text-ink text-balance">
        ¿Cuántos contratos de {destino} quieres que se lean?
      </h2>
      <p className="mt-1 text-sm text-inkSoft">
        {soles(precioPen)} por contrato.{" "}
        {porZona ? `Quedan ${numero(restantes)} sin financiar.` : `${plural(restantes, "contrato", "contratos")} en cola.`}
      </p>

      <CantidadPicker
        nombreGrupo={`cantidad-${clave}`}
        cantidadTxt={cantidadTxt}
        setCantidadTxt={setCantidadTxt}
        presets={presets}
        tope={restantes}
        esTodos
        precioPen={precioPen}
        monto={monto}
        error={cantidadTocada ? errCantidad : null}
        onBlur={() => setCantidadTocada(true)}
      />

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
                <OpcionRadio key={k} name={`tipo-${clave}`} checked={tipo === k} onChange={() => setTipo(k)} className="justify-center">
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
          <input
            maxLength={140}
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            className={CAMPO}
            placeholder={porZona ? `Por un ${destino} sin sobrecostos` : "Para saber en qué se gasta nuestro dinero"}
          />
        </label>
      </fieldset>

      {/* Método */}
      <fieldset className={GRUPO}>
        <legend className={LEYENDA}>¿Cómo pagas?</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Método de pago">
          {(["yape", "plin", "transferencia"] as const).map((m) => (
            <OpcionRadio key={m} name={`metodo-${clave}`} checked={metodo === m} onChange={() => setMetodo(m)} className="capitalize">
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
          ? <>Financiar {plural(contratos, "contrato", "contratos")} por <span className="font-mono">{soles(monto)}</span></>
          : `Financiar la lectura de ${destino}`}
      </Button>
      {/* Lo que sigue y la independencia, una línea cada uno; el detalle, a un clic (§10.7). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-inkSoft">
        <span className="inline-flex items-center gap-1">
          Recibes tu código y los datos de pago.
          <Ayuda titulo="¿Qué pasa después?">
            Validamos el pago en menos de 48 h, se asignan los contratos de {destino} {asignacion} y los resultados son
            públicos.
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
