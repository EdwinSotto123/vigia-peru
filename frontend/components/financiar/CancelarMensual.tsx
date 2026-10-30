"use client";

/**
 * «Dejar de aportar cada mes» desde el comprobante de un aporte mensual con tarjeta: con el correo con el que se aportó
 * (o la sesión de la cuenta dueña) y el captcha, la API le pide a Mercado Pago que no cobre más
 * (POST /pagos/suscripcion/:codigo/cancelar). Plegado: se abre a pedido. La respuesta es la misma si el código o el correo
 * no coinciden, así que el mensaje de error no dice cuál de los dos falló.
 */

import { useState } from "react";
import { CalendarX, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { idToken } from "@/lib/cuentas";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { useTurnstile } from "@/components/seguridad/Turnstile";
import { cabeceraTurnstile } from "@/components/seguridad/mensajes";

export function CancelarMensual({ codigo }: { codigo: string }) {
  const { user } = useAuth();
  const [correo, setCorreo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verificacion = useTurnstile("cancelar-mensual");

  async function cancelar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user && !/^\S+@\S+\.\S+$/.test(correo.trim())) return setError("Escribe el correo con el que aportaste.");
    setEnviando(true);
    try {
      const token = user ? await idToken() : null;
      const verificado = await verificacion.obtenerToken();
      const r = await fetch(`${PUBLIC_API_BASE}/pagos/suscripcion/${encodeURIComponent(codigo)}/cancelar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...cabeceraTurnstile(verificado) },
        body: JSON.stringify({ email: correo.trim() || undefined }),
      });
      const j = (await r.json().catch(() => null)) as { detail?: string } | null;
      if (!r.ok) throw new Error(j?.detail ?? "No pudimos cancelarlo. Vuelve a intentarlo en unos minutos.");
      setListo(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <p role="status" className="inline-flex items-start gap-1.5 text-dato font-medium text-mossTexto">
        <CheckCircle2 size={15} aria-hidden className="mt-0.5 shrink-0" /> Listo: tu aporte mensual quedó cancelado y no se cobra más.
      </p>
    );
  }

  return (
    <details className="group rounded-xl border border-line px-4 py-3">
      <summary className="inline-flex min-h-[32px] cursor-pointer list-none items-center gap-1.5 text-dato font-medium text-ink [&::-webkit-details-marker]:hidden">
        <CalendarX size={15} aria-hidden /> Dejar de aportar cada mes
        <ChevronDown size={14} aria-hidden className="transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <form onSubmit={cancelar} className="mt-3 space-y-3" noValidate>
        <p className="text-rotulo text-inkSoft">Mercado Pago deja de cobrar desde el próximo mes. Lo que ya aportaste sigue contando.</p>
        {!user && (
          <label className="block text-meta text-inkSoft">
            Correo con el que aportaste
            <input
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              autoComplete="email"
              className="mt-1 w-full max-w-sm rounded-xl border border-line bg-paper px-3 py-2 text-dato leading-5 text-ink"
            />
          </label>
        )}
        {verificacion.widget}
        {error && <p role="alert" className="text-dato leading-5 text-crimsonTexto">{error}</p>}
        <Button type="submit" variant="secondary" disabled={enviando}>
          {enviando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} Cancelar mi aporte mensual
        </Button>
      </form>
    </details>
  );
}
