"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { useTurnstile, ErrorTurnstile } from "@/components/seguridad/Turnstile";
import { cabeceraTurnstile } from "@/components/seguridad/mensajes";
import { API_PUBLICA } from "@/lib/api-client";
import type { Producto } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

export interface OpcionPlan {
  id: "gratis" | "alertas" | "pro" | "empresa" | "institucional" | "mcp";
  nombre: string;
  /** «S/ 39 al mes, precio de fundador». */
  detalle: string;
}

/** Un campo de intereses (lo que quiere que le avisemos): se guarda tal cual en `intereses`. */
export interface CampoInteres {
  clave: string;
  etiqueta: string;
  placeholder?: string;
  /** `lista`: varias opciones marcables (regiones, tipos); `texto`: una línea libre; `numero`: una cifra. */
  tipo: "texto" | "lista" | "numero";
  opciones?: { valor: string; etiqueta: string }[];
  ayuda?: string;
}

const CAMPO =
  "w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";

const MENSAJE_CAMPO: Record<string, string> = {
  email: "Revisa el correo.",
  ruc: "El RUC debe ser de una empresa (empieza con 20 y tiene 11 dígitos).",
  telefono: "Revisa el número de WhatsApp (sólo cifras, con o sin +51).",
  acepta: "Para anotarte tienes que aceptar que te escribamos.",
  intereses: "Tus intereses son demasiado largos: acórtalos un poco.",
};

/**
 * Anotarse en un producto de Gobserva (POST /gobserva/suscripciones, migración 226): el correo, el plan que le interesa,
 * sus intereses y, si quiere, su nombre, su empresa y su WhatsApp. Es una lista de espera con precio de fundador:
 * todavía no se cobra (se dice arriba del botón). Con Turnstile, como todo formulario público. Al terminar muestra qué
 * quedó guardado y qué viene después.
 */
export function Suscribirse({
  producto,
  planes,
  planInicial,
  intereses = [],
  valoresIniciales,
  conEmpresa = false,
  origen,
  titulo,
  bajada,
  className,
}: {
  producto: Producto;
  planes: OpcionPlan[];
  planInicial?: OpcionPlan["id"];
  intereses?: CampoInteres[];
  /** Lo que ya viene escrito en los intereses (el rubro de `?rubro=`): `{ rubros: "combustible" }`. */
  valoresIniciales?: Record<string, string | string[]>;
  /** Pedir empresa y RUC (licitaciones). */
  conEmpresa?: boolean;
  /** Desde qué página se anotó (para saber qué convierte). */
  origen: string;
  titulo?: ReactNode;
  bajada?: ReactNode;
  className?: string;
}) {
  const verificacion = useTurnstile(`gobserva-${producto}`);
  const [plan, setPlan] = useState<OpcionPlan["id"]>(planInicial ?? planes[0]?.id ?? "gratis");
  const [valores, setValores] = useState<Record<string, string | string[]>>(() => ({ ...(valoresIniciales ?? {}) }));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ email: string; nueva: boolean } | null>(null);

  const alternar = (clave: string, valor: string) =>
    setValores((v) => {
      const actual = Array.isArray(v[clave]) ? (v[clave] as string[]) : [];
      return { ...v, [clave]: actual.includes(valor) ? actual.filter((x) => x !== valor) : [...actual, valor] };
    });

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    const datos = new FormData(e.currentTarget);
    const email = String(datos.get("email") ?? "").trim();
    const interesesLimpios: Record<string, string | number | string[]> = {};
    for (const c of intereses) {
      const v = valores[c.clave];
      if (Array.isArray(v) ? v.length : typeof v === "string" && v.trim()) {
        interesesLimpios[c.clave] = c.tipo === "numero" ? Number(String(v).replace(/[^\d.]/g, "")) || 0 : Array.isArray(v) ? v : v.trim();
      }
    }
    setEnviando(true);
    setError(null);
    try {
      const token = await verificacion.obtenerToken();
      const r = await fetch(`${API_PUBLICA}/gobserva/suscripciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceraTurnstile(token) },
        body: JSON.stringify({
          producto,
          email,
          plan,
          nombre: String(datos.get("nombre") ?? ""),
          empresa: conEmpresa ? String(datos.get("empresa") ?? "") : undefined,
          ruc: conEmpresa ? String(datos.get("ruc") ?? "") : undefined,
          telefono: String(datos.get("telefono") ?? ""),
          intereses: interesesLimpios,
          origen,
          acepta: datos.get("acepta") === "on",
        }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; nueva?: boolean; campos?: string[] } | null;
      if (r.ok && j?.ok) {
        setListo({ email, nueva: j.nueva !== false });
        return;
      }
      if (r.status === 400 && j?.campos?.length) setError(j.campos.map((c) => MENSAJE_CAMPO[c] ?? `Revisa el campo «${c}».`).join(" "));
      else if (r.status === 429) setError("Muchos intentos seguidos. Espera un minuto y vuelve a probar.");
      else setError("No pudimos guardar tu inscripción ahora. Vuelve a intentarlo en un momento.");
    } catch (err) {
      setError(err instanceof ErrorTurnstile ? err.message : "No pudimos conectarnos. Revisa tu internet y vuelve a intentarlo.");
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    const elegido = planes.find((p) => p.id === plan);
    return (
      <div className={cn("rounded-3xl border border-granate/40 bg-granate-50 p-6 sm:p-8", className)} role="status">
        <CheckCircle2 size={32} aria-hidden className="text-granate" />
        <p className="mt-3 font-display text-seccion font-bold leading-tight text-ink">{listo.nueva ? "¡Estás dentro!" : "Actualizamos tu inscripción"}</p>
        <p className="mt-2 max-w-[56ch] text-cuerpo leading-relaxed text-inkSoft">
          Quedaste en la lista de <b className="text-ink">{elegido?.nombre ?? plan}</b> con <b className="text-ink">{listo.email}</b>. Te escribimos apenas
          abramos tu plan, con tu precio de fundador guardado. No cobramos nada hasta que tú lo confirmes.
        </p>
        <p className="mt-4 inline-flex items-center gap-2 text-meta text-mute">
          <MailCheck size={15} aria-hidden /> Si no te llega nada en unos días, revisa la carpeta de spam.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className={cn("rounded-3xl border border-line bg-paper p-5 sm:p-7", className)} noValidate>
      {titulo && <p className="font-display text-seccion font-bold leading-tight text-ink">{titulo}</p>}
      {bajada && <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">{bajada}</p>}

      <fieldset className={cn("grid gap-2", titulo || bajada ? "mt-5" : "", planes.length > 2 ? "sm:grid-cols-2" : "")}>
        <legend className="mb-2 text-meta font-semibold text-ink">Tu plan</legend>
        {planes.map((p) => (
          <label
            key={p.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-2xl border px-3.5 py-3 transition-colors duration-rapido",
              plan === p.id ? "border-granate bg-granate-50" : "border-line hover:border-granate/40",
            )}
          >
            <input type="radio" name="plan" value={p.id} checked={plan === p.id} onChange={() => setPlan(p.id)} className="mt-1 accent-[rgb(var(--granate))]" />
            <span className="min-w-0">
              <span className="block text-dato font-semibold text-ink">{p.nombre}</span>
              <span className="block text-meta text-inkSoft">{p.detalle}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {intereses.length > 0 && (
        <div className="mt-5 space-y-4">
          {intereses.map((c) =>
            c.tipo === "lista" ? (
              <fieldset key={c.clave}>
                <legend className="text-meta font-semibold text-ink">{c.etiqueta}</legend>
                {c.ayuda && <p className="text-meta text-mute">{c.ayuda}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(c.opciones ?? []).map((o) => {
                    const marcado = Array.isArray(valores[c.clave]) && (valores[c.clave] as string[]).includes(o.valor);
                    return (
                      <button
                        key={o.valor}
                        type="button"
                        aria-pressed={marcado}
                        onClick={() => alternar(c.clave, o.valor)}
                        className={cn(
                          "min-h-9 rounded-full border px-3 text-meta font-medium transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                          marcado ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
                        )}
                      >
                        {o.etiqueta}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : (
              <label key={c.clave} className="block">
                <span className="text-meta font-semibold text-ink">{c.etiqueta}</span>
                {c.ayuda && <span className="block text-meta text-mute">{c.ayuda}</span>}
                <input
                  type="text"
                  inputMode={c.tipo === "numero" ? "numeric" : undefined}
                  placeholder={c.placeholder}
                  value={typeof valores[c.clave] === "string" ? (valores[c.clave] as string) : ""}
                  onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
                  maxLength={c.tipo === "numero" ? 9 : 280}
                  className={cn(CAMPO, "mt-1.5")}
                />
              </label>
            ),
          )}
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-meta font-semibold text-ink">Tu correo</span>
          <input name="email" type="email" required autoComplete="email" placeholder="tu@correo.com" maxLength={254} className={cn(CAMPO, "mt-1.5")} />
        </label>
        <label className="block">
          <span className="text-meta font-semibold text-ink">
            Tu nombre <span className="font-normal text-mute">(opcional)</span>
          </span>
          <input name="nombre" type="text" autoComplete="name" maxLength={120} className={cn(CAMPO, "mt-1.5")} />
        </label>
        <label className="block">
          <span className="text-meta font-semibold text-ink">
            WhatsApp <span className="font-normal text-mute">(opcional, para alertas)</span>
          </span>
          <input name="telefono" type="tel" autoComplete="tel" inputMode="tel" placeholder="+51 9…" maxLength={20} className={cn(CAMPO, "mt-1.5")} />
        </label>
        {conEmpresa && (
          <>
            <label className="block">
              <span className="text-meta font-semibold text-ink">
                Empresa <span className="font-normal text-mute">(opcional)</span>
              </span>
              <input name="empresa" type="text" autoComplete="organization" maxLength={160} className={cn(CAMPO, "mt-1.5")} />
            </label>
            <label className="block">
              <span className="text-meta font-semibold text-ink">
                RUC de la empresa <span className="font-normal text-mute">(opcional, 20…)</span>
              </span>
              <input name="ruc" type="text" inputMode="numeric" pattern="20[0-9]{9}" maxLength={11} className={cn(CAMPO, "mt-1.5")} />
            </label>
          </>
        )}
      </div>

      <label className="mt-5 flex items-start gap-2.5 text-meta leading-relaxed text-inkSoft">
        <input name="acepta" type="checkbox" required className="mt-1 accent-[rgb(var(--granate))]" />
        <span>
          Acepto que Gobserva me escriba sobre este producto. Usamos tus datos sólo para eso, nunca los vendemos, y puedes
          pedir que los borremos cuando quieras.
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-crimson/30 bg-crimson-soft px-3.5 py-2.5 text-dato text-crimsonTexto">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-granate px-6 text-cuerpo font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 disabled:opacity-70"
        >
          {enviando && <Loader2 size={16} aria-hidden className="animate-spin" />}
          {enviando ? "Guardando…" : "Reservar mi lugar"}
        </button>
        <p className="text-meta text-mute">Sin tarjeta. No cobramos nada hasta que abramos tu plan y lo confirmes.</p>
      </div>
      {verificacion.widget}
    </form>
  );
}
