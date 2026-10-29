import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Clock, HandHeart, XCircle } from "lucide-react";
import { FranjaTextil } from "@/components/marca";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { fecha, soles } from "@/lib/formato";
import type { ComprobanteApoyo } from "@/lib/financiamiento";
import { rutaRegion } from "@/lib/regiones";

const ESTADO: Record<string, { texto: string; clase: string; Icono: typeof Clock }> = {
  pendiente_pago: { texto: "Pago pendiente de validación", clase: "text-inkSoft", Icono: Clock },
  pagada: { texto: "Pago confirmado: ya suma a lo recaudado del mes", clase: "text-mossTexto", Icono: CheckCircle2 },
  en_proceso: { texto: "Pago confirmado", clase: "text-mossTexto", Icono: CheckCircle2 },
  procesada: { texto: "Pago confirmado", clase: "text-mossTexto", Icono: CheckCircle2 },
  rechazada: { texto: "Aporte rechazado", clase: "text-crimsonTexto", Icono: XCircle },
};

/**
 * El comprobante público de un aporte para seguir vigilando (migración 206): cuánto, cada cuánto, en qué estado, quién
 * (si eligió aparecer) y qué lo motivó. No lista contratos: el aporte va al fondo común y nadie elige qué se lee; lo que
 * paga está en /app/cuanto-cuesta. Server-safe.
 */
export function ReciboApoyo({ c }: { c: ComprobanteApoyo }) {
  const est = ESTADO[c.estado] ?? { texto: c.estado, clase: "text-inkSoft", Icono: Clock };
  const motivo = c.paraEntidad && c.paraRuc
    ? { href: `/entidad/${c.paraRuc}`, nombre: c.paraEntidad }
    : c.paraZona && c.paraUbigeo
      ? { href: c.paraUbigeo.length === 2 ? rutaRegion(c.paraUbigeo) : null, nombre: c.paraZona }
      : null;
  return (
    <div className="container-page py-8 sm:py-10">
      <article className="overflow-hidden rounded-2xl border border-line bg-paper">
        <FranjaTextil alto={8} />
        <div className="space-y-5 p-5 sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h1 className="break-all font-mono text-cifra font-bold leading-tight text-ink sm:text-titulo">
                <span className="sr-only">Comprobante de aporte </span>
                {c.codigo}
              </h1>
              <p className="mt-1 inline-flex items-center gap-1.5 text-dato text-inkSoft">
                <HandHeart size={15} aria-hidden className="text-granate" />
                Aporte para seguir vigilando{c.periodicidad === "mensual" ? ", de cada mes" : ""}
              </p>
              <p className={`mt-2 inline-flex items-start gap-1.5 text-dato font-medium ${est.clase}`}>
                <est.Icono size={15} aria-hidden className="mt-0.5 shrink-0" />
                {est.texto}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-cifra font-bold leading-tight text-ink">{soles(c.montoPen)}</p>
              <p className="text-meta text-inkSoft">{c.pagadaAt ? `Validado el ${fecha(c.pagadaAt)}` : `Registrado el ${fecha(c.createdAt)}`}</p>
            </div>
          </header>

          <dl className="grid gap-3 text-dato sm:grid-cols-2">
            <div className="rounded-xl bg-paperSoft px-4 py-3">
              <dt className="text-meta text-inkSoft">Quién aporta</dt>
              <dd className="font-semibold text-ink">
                {c.slug ? <Link href={`/aliado/${c.slug}`} prefetch={false} className="hover:underline">{c.financiador}</Link> : c.financiador}
              </dd>
            </div>
            <div className="rounded-xl bg-paperSoft px-4 py-3">
              <dt className="text-meta text-inkSoft">Lo motivó</dt>
              <dd className="font-semibold text-ink">
                {motivo ? (motivo.href ? <Link href={motivo.href} prefetch={false} className="hover:underline">{motivo.nombre}</Link> : motivo.nombre) : "La vigilancia en general"}
              </dd>
            </div>
          </dl>

          {c.mensajePublico && (
            <blockquote className="rounded-r-xl border-l-2 border-granate/40 bg-paperSoft px-4 py-3 text-dato text-ink">«{c.mensajePublico}»</blockquote>
          )}

          <p className="max-w-prose text-dato leading-relaxed text-inkSoft">
            Este aporte va al fondo común: paga la base de datos, los servidores, la captura de datos y la lectura a fondo de los
            contratos más graves, en ese orden. Nadie, tampoco quien aporta, elige qué contrato se lee.
          </p>
          {c.periodicidad === "mensual" && (
            <p className="inline-flex items-start gap-1.5 text-meta text-inkSoft">
              <CalendarClock size={15} aria-hidden className="mt-0.5 shrink-0" />
              Aporte de cada mes: cada mes se registra un aporte nuevo, con su propio comprobante.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <EnlaceAccion href="/app/cuanto-cuesta" variante="secundario" flecha prefetch={false}>
              En qué se usa
            </EnlaceAccion>
            <Link href="/app/apoyar" prefetch={false} className="inline-flex min-h-[40px] items-center gap-1 text-dato font-semibold text-granate hover:underline">
              Aportar de nuevo <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}
