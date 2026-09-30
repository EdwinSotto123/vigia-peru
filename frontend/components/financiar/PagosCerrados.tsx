"use client";

/**
 * Lo que ve un visitante en /app/financiar/[ubigeo] (o en la página de una entidad) mientras
 * no hay medio de pago configurado (`GET /financiamiento/pago` → `configurado: false`). Antes
 * el formulario pedía nombre, correo y método, registraba un aporte y lo dejaba en un paso de
 * pago sin datos. Ahora se dice de entrada que los aportes no están abiertos, quién paga hoy
 * la lectura y qué SÍ se puede hacer: seguir la zona o la entidad (con cuenta) y, en una zona,
 * mirar cómo avanza lo que ya se financió.
 *
 * Es la tarjeta de marca de la pantalla (franja textil + llamita): la pregunta de esta página
 * ("¿cuántos contratos quieres financiar?") todavía no se puede contestar, y se dice con calma.
 * Las cifras (financiados, leídos, en cola) no se repiten acá: la página ya las muestra en sus
 * Indicadores, a la izquierda (DESIGN_SYSTEM.md §10.7).
 *
 * Por entidad no hay acción principal propia: sus contratos ya están en la pestaña "Qué hay
 * en la cola" (con su enlace a la lista completa) y un segundo botón al mismo destino sobra.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { TarjetaConfirmacion } from "./TarjetaConfirmacion";
import { PieSeguir, SeguirAlcance } from "./SeguirAlcance";
import type { AlcanceAporte } from "./alcanceAporte";

export function PagosCerrados({
  alcance,
  financiados,
  codigoPrevio = null,
}: {
  alcance: AlcanceAporte;
  /** Contratos de la zona que ya tienen financiamiento: decide a dónde lleva la acción principal. */
  financiados: number;
  /** Aporte que este navegador registró antes (borrador local), para no perderle el rastro. */
  codigoPrevio?: string | null;
}) {
  const { user } = useAuth();

  return (
    <TarjetaConfirmacion
      titulo="Todavía no se puede financiar desde aquí"
      acciones={
        <>
          {alcance.tipo === "zona" &&
            (financiados > 0 ? (
              <EnlaceAccion href={`/app/auditoria?ubigeo=${alcance.ubigeo}`}>
                Ver cómo avanza la lectura <ArrowRight size={14} aria-hidden />
              </EnlaceAccion>
            ) : (
              <EnlaceAccion href={`/app/contratos?ubigeo=${alcance.ubigeo}`}>
                Ver los contratos en cola <ArrowRight size={14} aria-hidden />
              </EnlaceAccion>
            ))}
          <SeguirAlcance alcance={alcance} />
        </>
      }
      pie={
        <>
          <PieSeguir alcance={alcance} />
          {codigoPrevio && (
            <p className={user ? "mt-1" : undefined}>
              Este navegador registró el aporte{" "}
              <Link href={`/impacto/${codigoPrevio}`} className="font-mono text-inkSoft underline underline-offset-2 hover:text-ink">
                {codigoPrevio}
              </Link>
              : su comprobante sigue disponible.
            </p>
          )}
        </>
      }
    >
      Aún no hay un medio de pago conectado. Mientras tanto, la lectura la paga Vigía Perú con su capital semilla.
    </TarjetaConfirmacion>
  );
}
