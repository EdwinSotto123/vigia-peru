import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, CircleCheck, CircleMinus, CirclePause, Hourglass, Phone, Users } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import { FuenteFecha } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { nombrePropio, numero, rutaMedico, type FichaIpress } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { itemsDeclarados, personalDeclarado, serviciosClave, type Sabe } from "./atencion";
import { URL_RENIPRESS_CONSULTA, detalleLeido, esColegioMedico } from "./piezas";
import { ConTuSeguro } from "./ConTuSeguro";
import { TeAtiendenAqui } from "./TeAtiendenAqui";

const SABE: Record<Sabe, { Icono: LucideIcon; texto: string; clase: string }> = {
  si: { Icono: CircleCheck, texto: "Sí", clase: "text-mossTexto" },
  no: { Icono: CircleMinus, texto: "No lo declaró", clase: "text-mute" },
  suspendida: { Icono: CirclePause, texto: "Suspendido", clase: "text-amberTexto" },
  sin_dato: { Icono: Hourglass, texto: "Sin dato todavía", clase: "text-mute" },
};

/**
 * «Para atenderte aquí» (Gobserva Salud, 2026-11-20): lo que una persona quiere saber antes de atenderse, en palabras
 * simples, después de «Lo esencial». Primero, con qué seguro atiende y el derecho a la emergencia (ConTuSeguro.tsx) (la frase de la verificación vive ahí, una sola vez, y el asistente en «Qué puedes
 * hacer»: antes había tres tarjetas de «Pregúntale»). Qué servicios declaró (emergencia, hospitalización, partos,
 * centro quirúrgico…: sí, no lo declaró, suspendido o sin dato); su personal declarado a SUSALUD (cuántos médicos, no
 * quién está hoy); «¿Te pueden atender aquí?» para buscar lo que necesita; y el asistente para lo demás. Cada bloque con
 * su fuente y su fecha. Nunca dice «no te atienden»: dice «no lo declaró» y que se pregunte. Server-safe.
 */
export function ResumenAtencion({ f, base }: { f: FichaIpress; base: string }) {
  const leido = detalleLeido(f);
  const servicios = serviciosClave(f);
  const personal = personalDeclarado(f);
  const nombre = nombrePropio(f.nombre);
  const telEmergencia = leido && f.detalle.telefonoEmergencia && f.detalle.telefonoEmergencia !== f.telefono && !f.detalle.telefonoEmergencia.includes("•")
    ? f.detalle.telefonoEmergencia
    : null;
  const renipress = f.fuentes.renipress?.url ?? URL_RENIPRESS_CONSULTA;
  const medicos = personal?.filas.find((x) => x.clave === "medicos")?.n ?? null;
  const otros = personal?.filas.filter((x) => x.clave !== "medicos") ?? [];
  const especialidades = leido ? f.detalle.especialidades.length : null;
  // La colegiatura del responsable, sólo si es del Colegio Médico: /medico busca en el CMP (piezas.tsx).
  const responsableCmp = leido && f.detalle.responsableColegiatura && esColegioMedico(f.detalle.responsableColegio) ? f.detalle.responsableColegiatura : null;

  return (
    <section aria-labelledby="atencion-t" className="tarjeta min-w-0 rounded-2xl border border-line bg-paper">
      {/* Vive en la pestaña «Para atenderte» de la ficha: el nombre lo da la pestaña (sólo para lectores de pantalla). */}
      <h2 id="atencion-t" className="sr-only">
        Para atenderte aquí
      </h2>

      {/* ── Con qué seguro te atienden (2026-11-22): lo primero que pregunta quien va a atenderse ── */}
      <ConTuSeguro institucion={f.institucion} horario={f.horario} className="border-b border-line" />

      <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* ── Qué servicios declaró ─────────────────────────────────────────────── */}
        <div className="min-w-0 bg-paper px-4 py-5 sm:px-6">
          <h3 className="font-display text-bloque font-bold leading-snug text-ink">Qué servicios declaró</h3>
          {!leido && (
            <p className="mt-3 flex gap-2.5 rounded-xl border border-amber/30 bg-amber-soft/50 px-3.5 py-3 text-dato leading-relaxed text-ink">
              <Hourglass size={17} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
              <span>
                Todavía no leímos sus servicios en RENIPRESS. Ya los pedimos: RENIPRESS se consulta de madrugada, así que suelen estar aquí al día siguiente.
                {f.internamiento ? " Por ahora, RENIPRESS lo registra como establecimiento con internamiento." : ""}
              </span>
            </p>
          )}
          {leido && (
          <ul className="mt-3 grid gap-x-6 sm:grid-cols-2" aria-label="Servicios declarados en RENIPRESS">
            {servicios.map((s) => {
              const e = SABE[s.sabe];
              return (
                <li key={s.clave} className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-2">
                  <span className="min-w-0 text-dato font-medium text-ink" title={s.como ?? undefined}>
                    {s.pregunta}
                  </span>
                  <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-meta font-semibold", e.clase)}>
                    <e.Icono size={16} aria-hidden />
                    {e.texto}
                  </span>
                </li>
              );
            })}
          </ul>
          )}
          {telEmergencia && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-dato text-inkSoft">
              <Phone size={15} aria-hidden className="text-crimsonTexto" />
              Teléfono de emergencia:
              <a href={`tel:${telEmergencia.replace(/[^\d+]/g, "")}`} className="font-mono font-semibold text-ink underline decoration-line underline-offset-2">
                {telEmergencia}
              </a>
            </p>
          )}
          {leido && (
            <p className="mt-3 text-meta leading-relaxed text-mute">«No lo declaró» no prueba que no lo hagan: pregunta. «Sí» no asegura cupo hoy: llama antes.</p>
          )}
          <FuenteFecha nombre="RENIPRESS (SUSALUD)" url={renipress} al={leido ? f.detalle.leidoAl : f.fuentes.renipress?.al ?? null} className="mt-2" />
        </div>

        {/* ── Su personal ───────────────────────────────────────────────────────── */}
        <div className="min-w-0 bg-paper px-4 py-5 sm:px-6">
          <h3 className="font-display text-bloque font-bold leading-snug text-ink">Su personal</h3>
          {personal && (medicos || otros.length > 0) ? (
            <>
              {medicos ? (
                <p className="mt-3 flex items-end gap-2.5">
                  <Pixel nombre="doctora" escala={2} retardo={1500} className="-mb-0.5" />
                  <span className="font-display text-cifra font-bold leading-none tabular-nums text-ink">{numero(medicos)}</span>
                  <span className="text-cuerpo text-inkSoft">{medicos === 1 ? "médico" : "médicos"}</span>
                </p>
              ) : (
                <p className="mt-3 text-dato text-inkSoft">No declaró médicos para ese mes.</p>
              )}
              {otros.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-dato text-inkSoft" aria-label="Otro personal declarado">
                  {otros.map((x) => (
                    <li key={x.clave} className="inline-flex items-center gap-1.5">
                      <Users size={14} aria-hidden className="text-mute" />
                      <b className="font-semibold tabular-nums text-ink">{numero(x.n)}</b> {x.etiqueta}
                    </li>
                  ))}
                </ul>
              )}
              {especialidades || personal.camas ? (
                <p className="mt-3 text-dato text-inkSoft">
                  {especialidades ? (
                    <>
                      <b className="font-semibold tabular-nums text-ink">{numero(especialidades)}</b> especialidades declaradas
                    </>
                  ) : null}
                  {especialidades && personal.camas ? ", " : null}
                  {personal.camas ? (
                    <>
                      <b className="font-semibold tabular-nums text-ink">{numero(personal.camas)}</b> camas
                    </>
                  ) : null}
                  .
                </p>
              ) : null}
              <p className="mt-3 text-meta leading-relaxed text-mute">
                Lo que declaró a SUSALUD{personal.mes ? ` para ${personal.mes}` : ""}. No dice quién atiende hoy ni en qué turno: para una cita, llama.
              </p>
            </>
          ) : (
            <p className="mt-3 text-dato leading-relaxed text-inkSoft">
              No figura su personal en los datos abiertos de SUSALUD. {especialidades ? `Declaró ${numero(especialidades)} especialidades en RENIPRESS.` : ""}
            </p>
          )}
          <Link
            href={responsableCmp ? rutaEn(base, rutaMedico(responsableCmp)) : rutaEn(base, "/medico")}
            className="mt-3 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline"
          >
            {responsableCmp ? "Verificar al médico responsable" : "Verificar a un médico con su colegiatura"}
            <ChevronRight size={15} aria-hidden />
          </Link>
          {personal && <FuenteFecha nombre="Recursos de salud (SUSALUD)" url={f.fuentes.recursos?.url ?? renipress} al={f.recursosAl} className="mt-1" />}
        </div>
      </div>

      {/* ── ¿Te pueden atender aquí? ────────────────────────────────────────────── */}
      <div className="border-t border-line px-4 py-5 sm:px-6">
        <h3 className="font-display text-bloque font-bold leading-snug text-ink">¿Te pueden atender aquí?</h3>
        {leido && (
          <p className="mt-1 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
            Escribe lo que necesitas o toca una opción: buscamos en lo que {nombre} declaró en RENIPRESS.
          </p>
        )}
        <div className="mt-3">
          <TeAtiendenAqui items={itemsDeclarados(f)} leido={leido} telefono={f.telefono} base={base} renipressUrl={renipress} />
        </div>
      </div>
    </section>
  );
}
