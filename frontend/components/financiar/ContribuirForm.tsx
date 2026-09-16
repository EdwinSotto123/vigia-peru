"use client";

/**
 * Formulario de contribución — 3 pasos: Zona (ya elegida al llegar) → Cantidad → Pago.
 *   · cantidad por defecto: 10 contratos (precio real de `tarifas` vía props)
 *   · con sesión: la identidad sale de la cuenta (nombre público / anónimo), sin repetir nombre ni correo
 *   · sin sesión: invitado (correo para el comprobante); después de pagar, "crea una cuenta para seguir tu aporte"
 *   · pago: Yape/Plin con QR grande + copiar número, transferencia; línea "¿qué pasa después?"
 *   · comprobante por foto OPCIONAL (cámara directa en móvil); se puede enviar más tarde desde /impacto/[codigo]
 *   · borrador en localStorage (cantidad, identidad y el aporte creado) para no perder nada al recargar
 * La confirmación la hace un admin (POST /admin/contribuciones/:codigo/validar).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building2, User, Users, EyeOff, Upload, CheckCircle2, Loader2, Camera, ArrowRight, UserPlus, ShieldCheck } from "lucide-react";
import { formatPEN } from "@/lib/financiamiento";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { borrarBorrador, guardarBorrador, idToken, leerBorrador, useCuenta } from "@/lib/cuentas";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandBadge, PaymentMethods, type PagoPublico } from "./PaymentMethods";

type Tipo = "empresa" | "organizacion" | "persona" | "anonimo";

interface Props {
  ubigeo: string;
  zonaNombre: string;
  precioPen: number;
  restantes: number;   // contratos aún sin financiar
  metodos?: string[];  // marcas configuradas (yape, plin, BCP…) para mostrar antes de pagar
}

interface Creada {
  codigo: string;
  montoPen: number;
  contratos: number;
  pago: PagoPublico & { concepto: string; metodo: string };
}

const PRESETS = [10, 20, 50, 100];

export function ContribuirForm({ ubigeo, zonaNombre, precioPen, restantes, metodos = [] }: Props) {
  const { user, loading: authLoading } = useAuth();
  const { perfil } = useCuenta();
  const presets = PRESETS.filter((n) => n <= Math.max(restantes, 10));
  const [contratos, setContratos] = useState<number>(10);
  const [tipo, setTipo] = useState<Tipo>("persona");
  const [nombre, setNombre] = useState("");
  const [ruc, setRuc] = useState("");
  const [email, setEmail] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [metodo, setMetodo] = useState<"yape" | "plin" | "transferencia">("yape");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<Creada | null>(null);
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [subido, setSubido] = useState(false);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [masDatos, setMasDatos] = useState(false);
  const restaurado = useRef(false);

  // Borrador local: cantidad/identidad y, si ya se creó, el aporte con sus datos de pago.
  useEffect(() => {
    if (restaurado.current) return;
    restaurado.current = true;
    const b = leerBorrador(ubigeo);
    if (!b) return;
    if (b.contratos >= 5) setContratos(b.contratos);
    if (b.tipo) setTipo(b.tipo as Tipo);
    setNombre(b.nombre ?? ""); setRuc(b.ruc ?? ""); setEmail(b.email ?? ""); setMensaje(b.mensaje ?? "");
    if (b.metodo) setMetodo(b.metodo as typeof metodo);
    if (b.creada && Date.now() - new Date(b.creada.creadaAt).getTime() < 7 * 86_400_000) {
      setCreada(b.creada as unknown as Creada);
    }
  }, [ubigeo]);
  useEffect(() => {
    if (!restaurado.current) return;
    guardarBorrador({ ubigeo, contratos, tipo, nombre, ruc, email, mensaje, metodo,
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

  const monto = contratos * precioPen;
  const necesitaRuc = tipo === "empresa" || tipo === "organizacion";
  const identidadDesdeCuenta = conCuenta && perfil && (tipo === "anonimo" || (perfil.nombrePublico && perfil.visible && nombre === perfil.nombrePublico));

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (contratos < 5) return setError("El mínimo son 5 contratos.");
    if (necesitaRuc && !/^\d{11}$/.test(ruc)) return setError("Ingresa un RUC de 11 dígitos.");
    if (tipo !== "anonimo" && nombre.trim().length < 2) return setError("Ingresa el nombre que quieres mostrar.");
    if (!conCuenta && !/^\S+@\S+\.\S+$/.test(email)) return setError("Ingresa un correo para enviarte el comprobante.");
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
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail ?? j.error ?? "No se pudo registrar el aporte");
      setCreada(j);
      guardarBorrador({ ubigeo, contratos, tipo, nombre, ruc, email, mensaje, metodo, creada: { ...j, creadaAt: new Date().toISOString() } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function subirComprobante() {
    if (!creada || !comprobante) return;
    setLoading(true);
    setError(null);
    setProgreso(0);
    try {
      const url = await subirConProgreso(comprobante, setProgreso);
      const r = await fetch(`${PUBLIC_API_BASE}/contribuciones/${creada.codigo}/comprobante`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error("No se pudo adjuntar el comprobante");
      setSubido(true);
      borrarBorrador(ubigeo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setProgreso(null);
    }
  }

  const queSigue = (
    <p className="mt-3 rounded-xl bg-paperDeep px-3 py-2 text-[12px] leading-snug text-mute">
      <strong className="text-ink">¿Qué pasa después?</strong> Validamos el pago (≤ 48 h) → se asignan {creada?.contratos ?? contratos} contratos de {zonaNombre} por antigüedad → cada uno se analiza y su resultado aparece en tu comprobante público.
    </p>
  );

  if (creada) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-5 sm:p-6" aria-live="polite">
        <Stepper step={subido ? 4 : 3} />
        <div className="mt-5 flex items-center gap-2 text-moss"><CheckCircle2 size={18} aria-hidden /><span className="text-sm font-semibold">Aporte registrado</span></div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-mono text-2xl font-bold text-ink">{creada.codigo}</h3>
          <span className="text-sm text-mute">{creada.contratos} contratos en {zonaNombre}</span>
        </div>

        {!subido ? (
          <>
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-wide text-mute">Paso 3 · Paga {formatPEN(creada.montoPen)}</div>
              <div className="mt-2">
                <PaymentMethods pago={creada.pago} monto={formatPEN(creada.montoPen)} concepto={creada.codigo} metodoPreferido={creada.pago.metodo} grande />
              </div>
              {queSigue}
            </div>
            <div className="mt-5 rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-wide text-mute">Comprobante (opcional, acelera la validación)</div>
                <span className="text-[11px] text-mute">también puedes enviarlo después</span>
              </div>
              <p className="mt-1 text-sm text-mute">Captura de Yape/Plin o constancia de transferencia. Se guarda en privado; solo lo ve quien valida.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink hover:bg-paperDeep sm:hidden">
                  <Camera size={14} aria-hidden /> Tomar foto
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setComprobante(e.target.files?.[0] ?? null)} />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink hover:bg-paperDeep">
                  <Upload size={14} aria-hidden /> Elegir archivo
                  <input type="file" accept="image/*,.pdf" className="sr-only" onChange={(e) => setComprobante(e.target.files?.[0] ?? null)} />
                </label>
                {comprobante && <span className="truncate text-[12px] text-mute" title={comprobante.name}>{comprobante.name}</span>}
              </div>
              {progreso != null && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuenow={progreso} aria-valuemin={0} aria-valuemax={100} aria-label="Subiendo comprobante">
                  <div className="h-full rounded-full bg-moss transition-all" style={{ width: `${progreso}%` }} />
                </div>
              )}
              <button type="button" onClick={subirComprobante} disabled={!comprobante || loading} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper disabled:opacity-50">
                {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />} Enviar comprobante
              </button>
            </div>
            <Link href={`/impacto/${creada.codigo}`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink hover:underline">
              Ver mi comprobante de impacto <ArrowRight size={14} aria-hidden />
            </Link>
          </>
        ) : (
          <div className="mt-5 rounded-xl border border-moss/30 bg-moss/5 p-4 text-sm text-ink">
            <div className="font-semibold">Comprobante recibido. ¡Gracias!</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-mute">
              <li>Validamos el pago en menos de 48 h{conCuenta ? " (lo verás en Mi impacto)" : " y te avisamos por correo"}.</li>
              <li>Al confirmarse, se asignan {creada.contratos} contratos de {zonaNombre} por antigüedad.</li>
              <li>Tu comprobante de impacto se va llenando con cada contrato procesado.</li>
            </ol>
            <Link href={`/impacto/${creada.codigo}`} className="mt-3 inline-block rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper">Ver mi comprobante de impacto →</Link>
          </div>
        )}
        {!conCuenta && !authLoading && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-line p-3 text-[12px] text-mute">
            <UserPlus size={14} className="mt-0.5 shrink-0 text-clay" aria-hidden />
            <span>
              <strong className="text-ink">Crea una cuenta para seguir tu aporte</strong>: verás su progreso, las señales halladas y tus zonas en un solo lugar. Guarda tu código <span className="font-mono">{creada.codigo}</span> — con él siempre puedes ver el comprobante.{" "}
              <Link href={`/signup?next=${encodeURIComponent(`/app/mi-impacto?aporte=${creada.codigo}`)}`} className="underline">Crear cuenta</Link>
            </span>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-rust" role="alert">{error}</p>}
        <button type="button" onClick={() => { borrarBorrador(ubigeo); setCreada(null); setSubido(false); setComprobante(null); }} className="mt-4 text-[11px] text-mute underline hover:text-ink">
          Hacer otro aporte en {zonaNombre}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={crear} className="rounded-2xl border border-line bg-paper p-5 sm:p-6" aria-label="Financiar auditoría">
      <Stepper step={2} />
      <h3 className="mt-5 font-serif text-xl font-bold text-ink">Financiar auditoría en {zonaNombre}</h3>
      <p className="mt-1 text-sm text-mute">{formatPEN(precioPen)} por contrato · quedan {restantes.toLocaleString("es-PE")} sin financiar</p>

      {/* Cantidad */}
      <div className="mt-5" role="group" aria-labelledby="lbl-cantidad">
        <div id="lbl-cantidad" className="text-[11px] uppercase tracking-wide text-mute">¿Cuántos contratos?</div>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Cantidad de contratos">
          {presets.map((n) => (
            <button type="button" key={n} role="radio" aria-checked={contratos === n} onClick={() => setContratos(n)} className={`rounded-lg border px-3 py-2 text-sm ${contratos === n ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>
              {n} · {formatPEN(n * precioPen)}
            </button>
          ))}
          {restantes > 100 && (
            <button type="button" role="radio" aria-checked={contratos === restantes} onClick={() => setContratos(restantes)} className={`rounded-lg border px-3 py-2 text-sm ${contratos === restantes ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>
              Todos ({restantes.toLocaleString("es-PE")}) · {formatPEN(restantes * precioPen)}
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <label htmlFor="otra-cantidad" className="text-mute">Otro:</label>
          <input id="otra-cantidad" type="number" min={5} inputMode="numeric" value={contratos} onChange={(e) => setContratos(Math.max(5, Number(e.target.value) || 5))} className="w-24 rounded-lg border border-line px-2 py-1 font-mono" />
          <span className="font-mono text-ink">= {formatPEN(monto)}</span>
        </div>
      </div>

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
                <button type="button" key={k} role="radio" aria-checked={tipo === k} onClick={() => setTipo(k)} className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm ${tipo === k ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>
                  <Icon size={14} aria-hidden /> {label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {tipo !== "anonimo" && (
                <label className="text-sm">
                  <span className="text-mute">{tipo === "persona" ? "Nombre a mostrar" : "Razón social / nombre público"}</span>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="organization" className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder={tipo === "persona" ? "Ej. María Q." : "Ej. Empresa X S.A.C."} />
                </label>
              )}
              {necesitaRuc && (
                <label className="text-sm">
                  <span className="text-mute">RUC (se valida contra SUNAT y sanciones OSCE)</span>
                  <input value={ruc} inputMode="numeric" onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))} className="mt-1 w-full rounded-lg border border-line px-3 py-2 font-mono" placeholder="20XXXXXXXXX" />
                </label>
              )}
              {!conCuenta && (
                <label className="text-sm">
                  <span className="text-mute">Correo (privado, para el comprobante)</span>
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
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Método de pago">
          {(["yape", "plin", "transferencia"] as const).map((m) => (
            <button type="button" key={m} role="radio" aria-checked={metodo === m} onClick={() => setMetodo(m)} className={`rounded-lg border px-3 py-2 text-sm capitalize ${metodo === m ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>{m}</button>
          ))}
        </div>
        {metodos.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-mute">Aceptamos {metodos.map((m) => <BrandBadge key={m} brand={m} />)}</div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-rust" role="alert">{error}</p>}

      <button type="submit" disabled={loading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.01] disabled:opacity-60">
        {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
        Continuar al pago · {contratos} contratos · {formatPEN(monto)}
      </button>
      <p className="mt-3 rounded-xl bg-paperDeep px-3 py-2 text-[12px] leading-snug text-mute">
        <strong className="text-ink">¿Qué pasa después?</strong> Recibes tu código y los datos de pago → validamos (≤ 48 h) → se asignan {contratos} contratos de {zonaNombre} por antigüedad → los resultados son públicos.
      </p>
      <p className="mt-2 flex items-start gap-1.5 text-center text-[11px] leading-relaxed text-mute">
        <ShieldCheck size={12} className="mt-0.5 shrink-0 text-moss" aria-hidden />
        <span>Financias capacidad de análisis, no resultados. El pipeline no sabe quién aportó. Si tu empresa tiene sanción vigente o alertas activas, el aporte se acepta pero no hay reconocimiento público.</span>
      </p>
    </form>
  );
}

/** Sube a /api/upload con progreso real (XHR). Devuelve la URL pública/firmada del archivo. */
function subirConProgreso(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "comprobante");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && j.url) resolve(j.url);
        else reject(new Error(j.error ?? "No se pudo subir el comprobante"));
      } catch { reject(new Error("No se pudo subir el comprobante")); }
    };
    xhr.onerror = () => reject(new Error("Sin conexión al subir el comprobante"));
    xhr.send(fd);
  });
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

