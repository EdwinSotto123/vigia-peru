import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, BadgeCheck, Database, Gavel, Info, MapPin, ScanSearch, Stethoscope } from "lucide-react";
import { Medidor } from "@/components/charts/BarraSegmentada";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { Migas } from "@/components/patrones/Migas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { FuenteFecha, InsigniaCategoria, InsigniaHecho } from "@/components/salud/comun";
import { estadoRegistro } from "@/components/salud/ficha/Cabecera";
import { CopiarNumero } from "@/components/salud/medico/CopiarNumero";
import { FormColegiatura } from "@/components/salud/medico/FormColegiatura";
import { PasosVerificar } from "@/components/salud/medico/PasosVerificar";
import { BotonGuardarSalud } from "@/components/salud/cuenta/BotonGuardar";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { fechaCorta, getMedico, nombrePropio, numero, rutaFicha, rutaMedico, type Medico } from "@/lib/gobserva-salud";

/** El resultado se pide a la API con 15 minutos de caché (getMedico); la página se arma en cada pedido (la base). */
export const revalidate = 900;

type Props = { params: { colegiatura: string } };

const numeroDe = (crudo: string) => {
  const n = decodeURIComponent(crudo).replace(/\D/g, "").replace(/^0+/, "");
  return n && n.length <= 7 ? n : null;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = numeroDe(params.colegiatura);
  if (!n) return { title: "Colegiatura no válida", robots: { index: false } };
  return {
    title: `Colegiatura N.° ${n} del CMP: cómo verificarla`,
    description: `Lo que dicen las fuentes abiertas de la colegiatura N.° ${n} del Colegio Médico del Perú (RENIPRESS) y cómo confirmar en el CMP si está habilitado.`,
    alternates: { canonical: urlCanonica("salud", rutaMedico(n)) },
    // Una página por número de colegiatura no tiene por qué estar en los buscadores: se llega desde aquí.
    robots: { index: false, follow: true },
  };
}

const EXTERNO = <span className="sr-only"> (se abre en otra pestaña)</span>;

/** Cada IPRESS donde la colegiatura figura como responsable: su estado, categoría y sanciones (de la IPRESS). */
function Establecimiento({ x, base }: { x: Medico["responsableDe"][number]; base: string }) {
  const estado = estadoRegistro({ enRegistro: true, activo: x.activo, estado: x.estado });
  const lugar = [nombrePropio(x.distrito), nombrePropio(x.departamento)].filter((v, i, a) => v && a.indexOf(v) === i).join(", ");
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <Link
          href={rutaEn(base, rutaFicha(x.codigo))}
          prefetch={false}
          className="min-w-0 text-cuerpo font-semibold leading-snug text-ink underline decoration-line underline-offset-4 hover:text-granate hover:decoration-granate"
        >
          {nombrePropio(x.nombre)}
        </Link>
        <InsigniaCategoria categoria={x.categoria} />
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
        <Insignia tono={estado.tono} Icono={estado.Icono}>
          {estado.texto}
        </Insignia>
        {lugar && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={13} aria-hidden className="text-mute" />
            {lugar}
          </span>
        )}
        {x.responsableRne && (
          <span className="inline-flex items-center gap-1">
            <Stethoscope size={13} aria-hidden className="text-mute" />
            RNE <span className="font-mono">{x.responsableRne}</span>
          </span>
        )}
      </p>
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-meta text-inkSoft">
        {x.sanciones > 0 ? (
          <>
            <InsigniaHecho tipo="sancion_firme" />
            <span>
              La IPRESS tiene {x.sanciones === 1 ? "una sanción firme" : `${numero(x.sanciones)} sanciones firmes`} de SUSALUD
              {x.ultimaSancion ? ` (la última, ${fechaCorta(x.ultimaSancion)})` : ""}. No son sanciones al médico.
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Gavel size={13} aria-hidden className="text-mute" />
            Sus sanciones firmes y servicios, con la fecha de cada fuente, están en su ficha.
          </span>
        )}
      </p>
      <p className="mt-1 text-rotulo text-mute">Declarado en RENIPRESS{x.leidoAl ? `, consultado el ${fechaCorta(x.leidoAl)}` : ""}.</p>
    </li>
  );
}

/**
 * El resultado de una colegiatura (GET /salud/medico/:colegiatura), en dos bloques que no se mezclan: «Lo que dicen las
 * fuentes abiertas» (el resumen de la API, sus RNE y cada IPRESS donde figura como responsable, con la aclaración de que
 * la sanción de una clínica no es del médico, y cuánto del detalle de RENIPRESS revisamos) y «Lo que tienes que verificar
 * en el CMP» (la habilitación, los pasos y el botón a «Conoce a tu médico»). Abajo, las fuentes y el aviso.
 */
export default async function ResultadoMedico({ params }: Props) {
  const n = numeroDe(params.colegiatura);
  if (!n) notFound();
  const m = await getMedico(n);
  if (!m) notFound();
  const base = baseProducto("salud");
  const cob = m.cobertura;
  const parte = cob.total ? cob.leidas / cob.total : 0;

  return (
    <div className="container-page pb-6 pt-5 sm:pt-8">
      <Migas
        items={[
          { etiqueta: "Inicio", href: rutaEn(base, "/") },
          { etiqueta: "Verificar a un médico", href: rutaEn(base, "/medico") },
          { etiqueta: `Colegiatura N.° ${m.colegiatura}` },
        ]}
      />

      <header className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-balance font-display text-cifra font-bold leading-tight tracking-tight text-ink sm:text-titulo">
            Colegiatura N.° <span className="font-mono">{m.colegiatura}</span>
          </h1>
          <p className="mt-1.5 text-cuerpo text-inkSoft">{m.colegio ?? "Colegio profesional sin precisar"}</p>
          <BotonGuardarSalud tipo="medico" codigo={m.colegiatura} nombre={`Colegiatura N.° ${m.colegiatura}`} base={base} className="mt-3" />
        </div>
        <details className="group w-full sm:w-auto">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-dato font-semibold text-granate [&::-webkit-details-marker]:hidden">
            <ScanSearch size={16} aria-hidden /> Verificar otro número
          </summary>
          <div className="mt-2 sm:w-[28rem]">
            <FormColegiatura base={base} />
          </div>
        </details>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* Lo que dicen las fuentes abiertas */}
        <section aria-labelledby="abiertas-t" className="tarjeta min-w-0 rounded-2xl border border-line bg-paper">
          <header className="border-b border-line px-4 py-4 sm:px-6">
            <h2 id="abiertas-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
              <Database size={20} aria-hidden className="shrink-0 text-mute" /> Lo que dicen las fuentes abiertas
            </h2>
            <p className="mt-2 max-w-[68ch] text-pretty text-dato leading-relaxed text-ink">{m.resumen}</p>
          </header>

          <div className="space-y-5 px-4 py-4 sm:px-6">
            <div>
              <h3 className="text-cuerpo font-semibold text-ink">Especialidad registrada (RNE) según RENIPRESS</h3>
              {m.rne.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {m.rne.map((r) => (
                    <li key={r}>
                      <Insignia tono="acento" Icono={Stethoscope} className="font-mono text-meta">{`RNE ${r}`}</Insignia>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-dato text-inkSoft">RENIPRESS no le registra un RNE. Su especialidad, si la tiene, la dice el CMP.</p>
              )}
              <p className="mt-1.5 text-meta text-mute">El nombre de la especialidad de cada RNE se ve en el CMP.</p>
            </div>

            <div>
              <h3 className="text-cuerpo font-semibold text-ink">
                Responsable de la atención en {m.responsableDe.length === 1 ? "un establecimiento" : `${numero(m.responsableDe.length)} establecimientos`}
              </h3>
              {m.responsableDe.length ? (
                <>
                  <ul className="mt-3 divide-y divide-line">
                    {m.responsableDe.map((x) => (
                      <Establecimiento key={x.codigo} x={x} base={base} />
                    ))}
                  </ul>
                  <p className="mt-3 flex items-start gap-2 rounded-xl bg-paperSoft px-3 py-2.5 text-meta leading-snug text-inkSoft">
                    <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
                    La sanción de una clínica es de la clínica: no es una sanción al médico que la dirige ni dice nada de su habilitación.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-dato text-inkSoft">No figura como responsable en los establecimientos revisados (ver abajo cuántos).</p>
              )}
            </div>

            <div className="border-t border-line pt-4">
              <h3 className="text-cuerpo font-semibold text-ink">Cuánto revisamos</h3>
              <p className="mt-1 text-meta leading-snug text-inkSoft">
                Leímos el detalle de RENIPRESS de <span className="font-semibold tabular-nums text-ink">{numero(cob.leidas)}</span> de{" "}
                <span className="tabular-nums">{numero(cob.total)}</span> establecimientos{cob.al ? `, hasta el ${fechaCorta(cob.al)}` : ""}. Sumamos más cada día.
              </p>
              <Medidor parte={parte} etiqueta={`Detalle de RENIPRESS revisado: ${numero(cob.leidas)} de ${numero(cob.total)} establecimientos`} className="mt-2" />
            </div>
          </div>
        </section>

        {/* Lo que tienes que verificar en el CMP */}
        <section aria-labelledby="cmp-t" className="tarjeta min-w-0 rounded-2xl border border-granate/40 bg-paper">
          <header className="border-b border-line px-4 py-4 sm:px-6">
            <h2 id="cmp-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
              <BadgeCheck size={20} aria-hidden className="shrink-0 text-granate" /> Lo que tienes que verificar en el CMP
            </h2>
            <p className="mt-2 max-w-[68ch] text-pretty text-dato leading-relaxed text-ink">{m.habilitacion.detalle}</p>
            <a href={m.habilitacion.url} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "mt-4 min-h-12 w-full text-cuerpo sm:w-auto")}>
              <BadgeCheck size={18} aria-hidden /> Abrir «Conoce a tu médico» del CMP
              <ArrowUpRight size={16} aria-hidden />
              {EXTERNO}
            </a>
            <div className="mt-3">
              <p className="mb-1.5 text-meta text-inkSoft">Copia el número para buscarlo allá:</p>
              <CopiarNumero numero={m.colegiatura} />
            </div>
          </header>
          <div className="px-4 py-5 sm:px-6">
            <PasosVerificar pasos={m.verificar} base={base} />
          </div>
        </section>
      </div>

      <section aria-labelledby="fuentes-t" className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="tarjeta rounded-2xl border border-line bg-paper px-4 py-4 sm:px-6">
          <h2 id="fuentes-t" className="font-display text-bloque font-bold text-ink">
            Fuentes
          </h2>
          <ul className="mt-2 space-y-1.5">
            {m.fuentes.map((x) => (
              <li key={x.nombre}>
                <FuenteFecha nombre={x.nombre} url={x.url} al={x.al} className="text-meta" />
              </li>
            ))}
          </ul>
        </div>
        <p className="flex items-start gap-2.5 self-start rounded-2xl border border-line bg-paperSoft px-4 py-3.5 text-meta leading-relaxed text-inkSoft">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
          {m.aviso}
        </p>
      </section>
    </div>
  );
}
