"use client";

/**
 * Lo que ve un visitante en /app/financiar/[ubigeo] mientras no hay medio de pago configurado
 * (`GET /financiamiento/pago` → `configurado: false`). Antes el formulario pedía nombre, correo
 * y método, registraba un aporte y lo dejaba en un paso de pago sin datos. Ahora se dice de
 * entrada que los aportes no están abiertos, quién paga hoy la lectura y qué SÍ se puede hacer:
 * seguir la zona (con cuenta) y mirar cómo avanza lo que ya se financió.
 *
 * Es la tarjeta de marca de la pantalla (franja textil + llamita): la pregunta de esta página
 * ("¿cuántos contratos quieres financiar?") todavía no se puede contestar, y se dice con calma.
 * Las cifras de la zona (financiados, leídos, en cola) no se repiten acá: la página ya las
 * muestra en su línea de datos, a la izquierda (DESIGN_SYSTEM.md §10.7).
 */

import Link from "next/link";
import { ArrowRight, Bell } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { SeguirZonaBoton } from "@/components/mapa/SeguirZonaBoton";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { TarjetaConfirmacion } from "./TarjetaConfirmacion";

export function PagosCerrados({
  ubigeo,
  zonaNombre,
  financiados,
  codigoPrevio = null,
}: {
  ubigeo: string;
  zonaNombre: string;
  /** Contratos de la zona que ya tienen financiamiento: decide a dónde lleva la acción principal. */
  financiados: number;
  /** Aporte que este navegador registró antes (borrador local), para no perderle el rastro. */
  codigoPrevio?: string | null;
}) {
  const { user, loading } = useAuth();
  const volver = `/app/financiar/${ubigeo}`;

  return (
    <TarjetaConfirmacion
      titulo="Todavía no se puede financiar desde aquí"
      acciones={
        <>
          {financiados > 0 ? (
            <EnlaceAccion href={`/app/auditoria?ubigeo=${ubigeo}`}>
              Ver cómo avanza la lectura <ArrowRight size={14} aria-hidden />
            </EnlaceAccion>
          ) : (
            <EnlaceAccion href={`/app/contratos?ubigeo=${ubigeo}`}>
              Ver los contratos en cola <ArrowRight size={14} aria-hidden />
            </EnlaceAccion>
          )}
          {!loading &&
            (user ? (
              <SeguirZonaBoton ubigeo={ubigeo} nombre={zonaNombre} className="min-h-[40px] text-[13px]" />
            ) : (
              <EnlaceAccion variante="secundario" href={`/login?next=${encodeURIComponent(volver)}`}>
                <Bell size={14} aria-hidden /> Entra para seguir {zonaNombre}
              </EnlaceAccion>
            ))}
        </>
      }
      pie={
        <>
          {user && !loading && <p>Siguiendo la zona, la ves en Mi impacto con cada contrato que se lea.</p>}
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
