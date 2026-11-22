import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Award, BadgeCheck, GraduationCap, Hospital, Lock, ShieldQuestion, Stethoscope } from "lucide-react";
import { Migas } from "@/components/patrones/Migas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PreguntaRapida } from "@/components/salud/asistente/PreguntaRapida";
import { FormColegiatura } from "@/components/salud/medico/FormColegiatura";
import { PasosVerificar } from "@/components/salud/medico/PasosVerificar";
import { Pixel } from "@/components/pixel/Pixel";
import { URL_CMP, URL_SUNEDU, pasosVerificarMedico } from "@/components/salud/medico/pasos";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Verificar a un médico",
  description:
    "Con el número de colegiatura (CMP): lo que dicen las fuentes abiertas y cómo confirmar en el Colegio Médico del Perú si está habilitado, su especialidad (RNE) y su título en SUNEDU.",
  alternates: { canonical: urlCanonica("salud", "/medico") },
};

const EXTERNO = <span className="sr-only"> (se abre en otra pestaña)</span>;

/**
 * «Verificar a un médico» (Gobserva Salud): el número de colegiatura lleva a /medico/<n>; debajo, lo que hay que saber
 * dicho con honestidad (la habilitación la dice sólo el CMP, cuya consulta pide cuenta y captcha y no leemos), los
 * cuatro pasos de la API, qué son el RNE y la recertificación, el título en SUNEDU y el establecimiento. Sin búsqueda
 * por nombre.
 */
export default function VerificarMedico() {
  const base = baseProducto("salud");
  return (
    <div className="container-page pb-6 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Verificar a un médico" }]} />

      <div className="mt-4 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="min-w-0">
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-balance font-display text-seccion font-bold leading-tight tracking-[-0.015em] text-ink">Verificar a un médico</h1>
              <p className="mt-1 max-w-[70ch] text-pretty text-dato leading-relaxed text-inkSoft">
                Con su número de colegiatura ves lo que dicen las fuentes abiertas y cómo confirmar en el Colegio Médico si está habilitado.
              </p>
            </div>
            <div aria-hidden className="flex shrink-0 items-end gap-2">
              <Pixel nombre="doctora" escala={4} className="h-auto w-12 sm:w-16" />
              <Pixel nombre="carnet" escala={4} acento="accion" className="mb-6 hidden h-auto w-16 sm:block" />
            </div>
          </div>

          <div className="tarjeta mt-6 rounded-2xl border border-line bg-paper p-4 sm:p-6">
            <FormColegiatura base={base} />
          </div>

          <section aria-labelledby="honesto-t" className="mt-6 flex gap-3.5 rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
              <Lock size={19} />
            </span>
            <div className="min-w-0">
              <h2 id="honesto-t" className="font-display text-bloque font-bold leading-snug text-ink">
                Si está habilitado lo dice sólo el Colegio Médico del Perú
              </h2>
              <p className="mt-1 max-w-[68ch] text-dato leading-relaxed text-inkSoft">
                Su consulta «Conoce a tu médico» pide una cuenta gratuita y un captcha, y limita las consultas: no la leemos de forma
                automática ni copiamos sus datos. Aquí te decimos qué dicen las fuentes abiertas de ese número; los pasos de abajo te
                llevan al CMP para confirmarlo.
              </p>
            </div>
          </section>

          <section aria-labelledby="pasos-t" className="mt-10">
            <h2 id="pasos-t" className="font-display text-seccion font-bold leading-tight text-ink">
              Cómo verificarlo, paso a paso
            </h2>
            <PasosVerificar pasos={pasosVerificarMedico()} base={base} className="mt-5" />
          </section>
        </div>

        <aside aria-label="Qué significa cada cosa" className="min-w-0 space-y-4 lg:sticky lg:top-24">
          <section aria-labelledby="terminos-t" className="tarjeta rounded-2xl border border-line bg-paper">
            <h2 id="terminos-t" className="border-b border-line px-4 py-3 font-display text-bloque font-bold text-ink sm:px-5">
              Lo que vas a ver en el CMP
            </h2>
            <ul className="divide-y divide-line">
              <li className="flex gap-3 px-4 py-3.5 sm:px-5">
                <BadgeCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
                <p className="min-w-0 text-meta leading-relaxed text-inkSoft">
                  <span className="block text-dato font-semibold text-ink">Hábil</span>
                  Que el Colegio Médico lo tiene habilitado para ejercer. Es lo primero que hay que ver.
                </p>
              </li>
              <li className="flex gap-3 px-4 py-3.5 sm:px-5">
                <Stethoscope size={18} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                <p className="min-w-0 text-meta leading-relaxed text-inkSoft">
                  <span className="block text-dato font-semibold text-ink">RNE: Registro Nacional de Especialistas</span>
                  El número de la especialidad que el CMP le tiene registrada. Si no figura un RNE, no está registrado como especialista.
                </p>
              </li>
              <li className="flex gap-3 px-4 py-3.5 sm:px-5">
                <Award size={18} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                <p className="min-w-0 text-meta leading-relaxed text-inkSoft">
                  <span className="block text-dato font-semibold text-ink">Recertificación</span>
                  La certificación que el CMP renueva cada cierto tiempo; en «Conoce a tu médico» ves si la tiene vigente.
                </p>
              </li>
              <li className="flex gap-3 px-4 py-3.5 sm:px-5">
                <GraduationCap size={18} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                <p className="min-w-0 text-meta leading-relaxed text-inkSoft">
                  <span className="block text-dato font-semibold text-ink">El título, en SUNEDU</span>
                  El Registro Nacional de Grados y Títulos muestra el título de médico cirujano y, si la tiene, la segunda especialidad.
                  Pide un captcha.{" "}
                  <a href={URL_SUNEDU} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
                    Abrir SUNEDU
                    <ArrowUpRight size={12} aria-hidden className="ml-0.5 inline" />
                    {EXTERNO}
                  </a>
                </p>
              </li>
            </ul>
          </section>

          <PreguntaRapida base={base} pregunta="¿Cómo verifico si un médico está habilitado?" />

          <p className="flex items-start gap-2 px-1 text-meta leading-snug text-mute">
            <ShieldQuestion size={15} aria-hidden className="mt-0.5 shrink-0" />
            No mostramos nombres ni documentos de los profesionales: sólo su colegio, su colegiatura y su RNE.
          </p>
        </aside>
      </div>
    </div>
  );
}
