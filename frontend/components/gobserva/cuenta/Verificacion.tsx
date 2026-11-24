"use client";

import { useState, type ReactNode } from "react";
import { Loader2, MailWarning } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
import { cn } from "@/lib/utils";

/**
 * Sin el correo verificado no salen correos: la franja para verificarlo (y el botón para cuando ya lo hizo). Con los
 * cobros en pausa, además es lo que falta para tenerlo todo gratis.
 */
export function VerificarCorreo({ email, onListo, className }: { email: string; onListo: () => void; className?: string }) {
  const { estado, reenviar, yaVerifique } = useVerificacion(onListo);
  return (
    <div className={cn("mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber/40 bg-amber-soft px-4 py-3", className)}>
      <p className="flex min-w-0 flex-[1_1_18rem] items-start gap-2.5 text-dato text-amberTexto">
        <MailWarning size={18} aria-hidden className="mt-0.5 shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {COBROS_EN_PAUSA ? (
            <>
              Confirma tu correo y tienes todo gratis: alertas cada mañana, Excel y el asistente. Te mandamos el enlace a <b>{email}</b>.
            </>
          ) : (
            <>
              Verifica tu correo para recibir alertas y recibos en <b>{email}</b>.
            </>
          )}
          <NotaVerificacion estado={estado} />
        </span>
      </p>
      <BotonesVerificacion estado={estado} reenviar={reenviar} yaVerifique={yaVerifique} />
    </div>
  );
}

export type EstadoVerificacion = "" | "enviando" | "enviado" | "revisando" | "error";

/** Reenviar el correo de verificación y volver a leer la cuenta cuando ya lo verificó (en otra pestaña). */
export function useVerificacion(onListo: () => void) {
  const [estado, setEstado] = useState<EstadoVerificacion>("");
  async function reenviar() {
    setEstado("enviando");
    try {
      const { reenviarVerificacion } = await import("@/lib/gobserva-auth");
      await reenviarVerificacion(window.location.href);
      setEstado("enviado");
    } catch {
      setEstado("error");
    }
  }
  async function yaVerifique() {
    setEstado("revisando");
    try {
      const { refrescarUsuario } = await import("@/lib/gobserva-auth");
      await refrescarUsuario();
      onListo();
    } finally {
      setEstado("");
    }
  }
  return { estado, reenviar, yaVerifique };
}

export function NotaVerificacion({ estado }: { estado: EstadoVerificacion }): ReactNode {
  if (estado === "enviado") return " Te lo volvimos a enviar: revisa también el spam.";
  if (estado === "error") return " No pudimos enviarlo ahora; intenta en unos minutos.";
  return null;
}

export function BotonesVerificacion({ estado, reenviar, yaVerifique }: { estado: EstadoVerificacion; reenviar: () => void; yaVerifique: () => void }) {
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      <button type="button" onClick={reenviar} disabled={estado === "enviando"} className={claseAccion("secundario")}>
        {estado === "enviando" && <Loader2 size={15} aria-hidden className="animate-spin" />} Reenviar el correo
      </button>
      <button type="button" onClick={yaVerifique} disabled={estado === "revisando"} className={claseAccion("fantasma")}>
        {estado === "revisando" && <Loader2 size={15} aria-hidden className="animate-spin" />} Ya lo verifiqué
      </button>
    </div>
  );
}
