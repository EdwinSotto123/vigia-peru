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
 */

import Link from "next/link";
import { ArrowRight, Bell } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { SeguirZonaBoton } from "@/components/mapa/SeguirZonaBoton";
import { numero } from "@/lib/formato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { TarjetaConfirmacion } from "./TarjetaConfirmacion";

export function PagosCerrados({
  ubigeo,
  zonaNombre,
  restantes,
  financiados,
  procesados,
  codigoPrevio = null,
}: {
  ubigeo: string;
  zonaNombre: string;
  restantes: number;
  financiados: number;
  procesados: number;
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
      <p>
        Aún no hay un medio de pago conectado. Mientras tanto, la lectura de contratos la paga Vigía Perú con su
        propio capital semilla.
      </p>
      <p className="mt-2">
        {financiados > 0 ? (
          <>
            En {zonaNombre},{" "}
            <strong className="font-mono font-semibold tabular-nums text-ink">{numero(financiados)}</strong>{" "}
            {financiados === 1 ? "contrato ya tiene" : "contratos ya tienen"} financiamiento y{" "}
            <strong className="font-mono font-semibold tabular-nums text-ink">{numero(procesados)}</strong> de{" "}
            {financiados === 1 ? "ese" : `esos ${numero(financiados)}`} ya {procesados === 1 ? "se leyó" : "se leyeron"}.
            {restantes === 1 && <> Otro contrato espera financiamiento en la cola.</>}
            {restantes > 1 && <> Otros {numero(restantes)} esperan financiamiento en la cola.</>}
          </>
        ) : (
          <>
            En {zonaNombre} ningún contrato tiene financiamiento todavía:{" "}
            <strong className="font-mono font-semibold tabular-nums text-ink">{numero(restantes)}</strong>{" "}
            {restantes === 1 ? "espera" : "esperan"} en la cola.
          </>
        )}
      </p>
    </TarjetaConfirmacion>
  );
}
