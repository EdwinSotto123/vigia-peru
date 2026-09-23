"use client";

/**
 * Lo que ve un visitante en /app/financiar/[ubigeo] mientras no hay medio de pago configurado
 * (`GET /financiamiento/pago` → `configurado: false`). Antes el formulario pedía nombre, correo
 * y método, registraba un aporte y lo dejaba en un paso de pago sin datos. Ahora se dice de
 * entrada que los aportes no están abiertos, quién paga hoy la lectura y qué SÍ se puede hacer:
 * seguir la zona (con cuenta) y mirar cómo avanza lo que ya se financió.
 */

import Link from "next/link";
import { ArrowRight, Bell, Clock } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { SeguirZonaBoton } from "@/components/mapa/SeguirZonaBoton";

const num = (n: number) => n.toLocaleString("es-PE");

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
    <div className="rounded-2xl border border-line bg-paper p-5 shadow-card sm:p-6">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-paperDeep px-2.5 py-1 text-[11px] font-semibold text-inkSoft">
        <Clock size={12} aria-hidden /> Aportes todavía cerrados
      </div>
      <h3 className="mt-3 font-serif text-xl font-bold leading-snug text-ink">
        Todavía no se puede financiar desde esta página
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-inkSoft">
        Aún no hay un medio de pago conectado. Mientras tanto, la lectura de contratos la paga
        Vigía Perú con su propio capital semilla.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-inkSoft">
        {financiados > 0 ? (
          <>
            En {zonaNombre} hay <strong className="font-mono text-ink">{num(financiados)}</strong> contratos
            financiados y <strong className="font-mono text-ink">{num(procesados)}</strong> ya leídos.{" "}
            {restantes > 0 && <>Otros <strong className="font-mono text-ink">{num(restantes)}</strong> esperan en la cola.</>}
          </>
        ) : (
          <>
            En {zonaNombre} todavía no hay contratos financiados:{" "}
            <strong className="font-mono text-ink">{num(restantes)}</strong> esperan en la cola.
          </>
        )}
      </p>

      <div className="mt-5 flex flex-col gap-2.5">
        {financiados > 0 ? (
          <Link
            href={`/app/auditoria?ubigeo=${ubigeo}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper"
          >
            Ver cómo avanza la lectura <ArrowRight size={14} aria-hidden />
          </Link>
        ) : (
          <Link
            href={`/app/contratos?ubigeo=${ubigeo}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper"
          >
            Ver los contratos en cola <ArrowRight size={14} aria-hidden />
          </Link>
        )}

        {!loading && (user ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-inkSoft">
            <SeguirZonaBoton ubigeo={ubigeo} nombre={zonaNombre} className="text-[12px]" />
            <span>La ves en Mi impacto con cada contrato que se lea.</span>
          </div>
        ) : (
          <Link
            href={`/login?next=${encodeURIComponent(volver)}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-paperDeep"
          >
            <Bell size={14} aria-hidden /> Entra para seguir {zonaNombre}
          </Link>
        ))}
      </div>

      {codigoPrevio && (
        <p className="mt-4 text-[12px] text-inkSoft">
          Este navegador registró el aporte{" "}
          <Link href={`/impacto/${codigoPrevio}`} className="font-mono underline">{codigoPrevio}</Link>: su
          comprobante sigue disponible.
        </p>
      )}
    </div>
  );
}
