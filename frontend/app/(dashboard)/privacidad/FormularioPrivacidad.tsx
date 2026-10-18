"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CAMPO, ETIQUETA, ErrorCampo, ErrorEnvio } from "@/components/reporte/Campos";
import { ErrorTurnstile, useTurnstile } from "@/components/seguridad/Turnstile";
import { cabeceraTurnstile, mensajeBots } from "@/components/seguridad/mensajes";
import { API_BASE } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Pedido de privacidad (Ley 29733): quien aparece en un análisis pide corregir, retirar, conocer u
 * oponerse al uso de un dato suyo. POST /privacidad/solicitudes (backend/api/src/routes/privacidad.ts),
 * con la verificación contra robots de los formularios públicos. No se pide DNI.
 */

const TIPOS = [
  { valor: "correccion", etiqueta: "Corregir un dato que está mal" },
  { valor: "retiro", etiqueta: "Retirar un dato mío" },
  { valor: "acceso", etiqueta: "Saber qué datos míos aparecen" },
  { valor: "oposicion", etiqueta: "Oponerme a que se use un dato mío" },
  { valor: "otro", etiqueta: "Otro pedido" },
] as const;

type Tipo = (typeof TIPOS)[number]["valor"];

const MENSAJE_MIN = 10;
const MENSAJE_MAX = 4000;

export function FormularioPrivacidad({ enlaceInicial }: { enlaceInicial: string }) {
  const [tipo, setTipo] = useState<Tipo>("correccion");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [enlace, setEnlace] = useState(enlaceInicial);
  const [mensaje, setMensaje] = useState("");
  const [errores, setErrores] = useState<Partial<Record<"nombre" | "email" | "enlace" | "mensaje", string>>>({});
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [codigo, setCodigo] = useState<string | null>(null);
  const verificacion = useTurnstile("privacidad");

  const validar = () => {
    const e: typeof errores = {};
    if (nombre.trim().length < 2) e.nombre = "Escribe tu nombre: con él ubicamos el dato.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) e.email = "Revisa el correo: es donde te respondemos.";
    if (enlace.trim() && !/^(https?:\/\/|\/)/.test(enlace.trim())) e.enlace = "Pega el enlace completo de la página de Vigía (empieza con https://).";
    if (mensaje.trim().length < MENSAJE_MIN) e.mensaje = "Cuéntanos en una o dos frases qué dato es y qué quieres que hagamos.";
    setErrores(e);
    return Object.keys(e).length === 0;
  };

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErrorEnvio(null);
    if (!validar()) return;
    setEnviando(true);
    try {
      const token = await verificacion.obtenerToken();
      const r = await fetch(`${API_BASE}/privacidad/solicitudes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceraTurnstile(token) },
        body: JSON.stringify({ tipo, nombre: nombre.trim(), email: email.trim(), enlace: enlace.trim() || null, mensaje: mensaje.trim() }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setErrorEnvio(
          mensajeBots(j) ??
            (r.status === 400
              ? "Revisa los datos del formulario e inténtalo otra vez."
              : "No pudimos recibir tu pedido por un problema de nuestro lado. Inténtalo otra vez en unos minutos."),
        );
        return;
      }
      setCodigo(j?.codigo ?? "—");
    } catch (err) {
      setErrorEnvio(err instanceof ErrorTurnstile ? err.message : "No hay conexión. Revisa tu internet e inténtalo otra vez.");
    } finally {
      setEnviando(false);
    }
  };

  if (codigo) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-2xl border border-moss/35 bg-moss/10 p-5">
        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-mossTexto" aria-hidden />
        <div className="text-sm leading-relaxed text-inkSoft">
          <p className="font-display text-base font-bold text-ink">Recibimos tu pedido</p>
          <p className="mt-1">
            Su número es <span className="font-mono font-semibold text-ink">{codigo}</span>. Te escribimos a{" "}
            <span className="font-medium text-ink">{email.trim()}</span> en un plazo máximo de 10 días hábiles.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <fieldset>
        <legend className={ETIQUETA}>¿Qué necesitas?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TIPOS.map((t) => (
            <label
              key={t.valor}
              className={cn(
                "flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2 text-sm transition-colors duration-rapido",
                tipo === t.valor ? "border-granate bg-granate-soft font-semibold text-ink" : "border-line bg-paper text-ink hover:border-granate/40",
              )}
            >
              <input type="radio" name="tipo" value={t.valor} checked={tipo === t.valor} onChange={() => setTipo(t.valor)} className="accent-[rgb(var(--granate))]" />
              {t.etiqueta}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="priv-nombre" className={ETIQUETA}>Tu nombre</label>
          <input id="priv-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={160} autoComplete="name" className={CAMPO} aria-invalid={!!errores.nombre} aria-describedby={errores.nombre ? "priv-nombre-error" : undefined} />
          {errores.nombre && <ErrorCampo id="priv-nombre-error">{errores.nombre}</ErrorCampo>}
        </div>
        <div>
          <label htmlFor="priv-email" className={ETIQUETA}>Tu correo</label>
          <input id="priv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" className={CAMPO} aria-invalid={!!errores.email} aria-describedby={errores.email ? "priv-email-error" : undefined} />
          {errores.email && <ErrorCampo id="priv-email-error">{errores.email}</ErrorCampo>}
        </div>
      </div>

      <div>
        <label htmlFor="priv-enlace" className={ETIQUETA}>Página de Vigía donde apareces (opcional)</label>
        <input id="priv-enlace" value={enlace} onChange={(e) => setEnlace(e.target.value)} maxLength={500} inputMode="url" placeholder="https://vigia-peru.web.app/app/contratos/…" className={CAMPO} aria-invalid={!!errores.enlace} aria-describedby={errores.enlace ? "priv-enlace-error" : undefined} />
        {errores.enlace && <ErrorCampo id="priv-enlace-error">{errores.enlace}</ErrorCampo>}
      </div>

      <div>
        <label htmlFor="priv-mensaje" className={ETIQUETA}>Qué dato es y qué quieres que hagamos</label>
        <textarea
          id="priv-mensaje"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value.slice(0, MENSAJE_MAX))}
          rows={5}
          className={cn(CAMPO, "min-h-[120px] py-3 leading-relaxed")}
          aria-invalid={!!errores.mensaje}
          aria-describedby="priv-mensaje-ayuda"
        />
        <p id="priv-mensaje-ayuda" className="mt-1 flex justify-between gap-2 text-[11px] text-mute">
          <span>No escribas tu DNI: no lo necesitamos.</span>
          <span className="shrink-0 font-mono tabular-nums">{mensaje.length}/{MENSAJE_MAX}</span>
        </p>
        {errores.mensaje && <ErrorCampo>{errores.mensaje}</ErrorCampo>}
      </div>

      <p className="text-[12px] leading-relaxed text-mute">
        Usamos tu nombre y tu correo sólo para atender este pedido. No se publican.
      </p>

      {errorEnvio && <ErrorEnvio>{errorEnvio}</ErrorEnvio>}
      {verificacion.widget}
      <Button type="submit" disabled={enviando} variant="primary">
        {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
        {enviando ? "Enviando…" : "Enviar pedido"}
      </Button>
    </form>
  );
}
