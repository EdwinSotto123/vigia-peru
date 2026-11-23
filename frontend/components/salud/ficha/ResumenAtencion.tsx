import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Accessibility, Baby, BedDouble, ChevronRight, CircleCheck, CircleMinus, CirclePause, Droplets, FlaskConical, HeartPulse, Hourglass, Phone, Pill, ScanLine, Scissors, Siren, Users, Video } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import { FuenteFecha } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { nombrePropio, numero, rutaMedico, type FichaIpress } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { itemsDeclarados, personalDeclarado, serviciosClave, type Sabe } from "./atencion";
import { URL_RENIPRESS_CONSULTA, detalleLeido, esColegioMedico } from "./piezas";
import { ConTuSeguro } from "./ConTuSeguro";
import { TeAtiendenAqui } from "./TeAtiendenAqui";

const SABE: Record<Sabe, { Icono: LucideIcon; texto: string; clase: string; baldosa: string }> = {
  si: { Icono: CircleCheck, texto: "Sí", clase: "text-mossTexto", baldosa: "border-mossTexto/25 bg-mossTexto/[0.07]" },
  no: { Icono: CircleMinus, texto: "No lo declaró", clase: "text-mute", baldosa: "border-dashed border-line bg-paper" },
  suspendida: { Icono: CirclePause, texto: "Suspendido", clase: "text-amberTexto", baldosa: "border-amber/30 bg-amber/[0.08]" },
  sin_dato: { Icono: Hourglass, texto: "Sin dato todavía", clase: "text-mute", baldosa: "border-dashed border-line bg-paper" },
};

/** El ícono de cada servicio clave (atencion.ts, SERVICIOS_CLAVE). */
const ICONO_SERVICIO: Record<string, LucideIcon> = {
  emergencia: Siren, hospitalizacion: BedDouble, partos: Baby, quirurgico: Scissors, uci: HeartPulse, laboratorio: FlaskConical,
  imagenes: ScanLine, farmacia: Pill, rehabilitacion: Accessibility, dialisis: Droplets, telesalud: Video,
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
      {f.activo ? (
        <ConTuSeguro institucion={f.institucion} horario={f.horario} className="border-b border-line" />
      ) : (
        // Cerrado o dado de baja (2026-11-22): antes decía «declaró atender las 24 horas» y «aquí te tienen que atender».
        <p role="note" className="flex gap-3 border-b border-crimson/25 bg-crimson-soft/50 px-4 py-4 text-dato leading-relaxed text-ink sm:px-6">
          <CirclePause size={20} aria-hidden className="mt-0.5 shrink-0 text-crimsonTexto" />
          <span>
            <b className="font-semibold">No está atendiendo.</b> RENIPRESS lo registra en estado «{(f.estado ?? "inactivo").toLowerCase()}». Lo de abajo
            es lo que declaró cuando funcionaba: para atenderte, busca otro establecimiento cerca.
          </span>
        </p>
      )}

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
            <>
              {/* 2026-11-22 («esta mierda es texto plano»): de once filas «Servicio … Sí» a baldosas con su ícono, verdes
                  las declaradas y punteadas las que no, con cuántas declaró arriba y una barra que se llena a pasos. */}
              <p className="mt-2 flex items-center gap-3 text-dato text-inkSoft">
                <span>
                  Declaró <b className="font-display text-bloque font-bold tabular-nums text-ink">{servicios.filter((s) => s.sabe === "si").length}</b> de{" "}
                  {servicios.length}
                </span>
                <span aria-hidden className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
                  <span
                    className="gs-barra-crece block h-full rounded-full bg-mossTexto"
                    style={{ width: `${Math.round((servicios.filter((s) => s.sabe === "si").length / Math.max(1, servicios.length)) * 100)}%` }}
                  />
                </span>
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3" aria-label="Servicios declarados en RENIPRESS">
                {servicios.map((s) => {
                  const e = SABE[s.sabe];
                  const Icono = ICONO_SERVICIO[s.clave] ?? CircleCheck;
                  return (
                    <li key={s.clave} title={s.como ?? undefined} className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl border px-3 py-2.5", e.baldosa)}>
                      <span className="flex items-center justify-between gap-2">
                        <Icono size={18} aria-hidden className={s.sabe === "si" ? "text-ink" : "text-mute"} />
                        <e.Icono size={15} aria-hidden className={e.clase} />
                      </span>
                      <span className={cn("text-dato font-semibold leading-snug", s.sabe === "si" ? "text-ink" : "text-inkSoft")}>{s.pregunta}</span>
                      <span className={cn("text-rotulo font-semibold", e.clase)}>{e.texto}</span>
                    </li>
                  );
                })}
              </ul>
            </>
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
          {f.activo && <TeAtiendenAqui items={itemsDeclarados(f)} leido={leido} telefono={f.telefono} base={base} renipressUrl={renipress} />}
        </div>
      </div>
    </section>
  );
}
