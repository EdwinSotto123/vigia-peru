import { CalendarClock, Eye, History, Hourglass } from "lucide-react";
import { CabeceraPestana } from "@/components/patrones/Pestanas";
import { FuenteFecha } from "@/components/salud/comun";
import { fechaCorta, numero, type FichaIpress } from "@/lib/gobserva-salud";
import { Bloque, DetallePendiente, detalleLeido } from "./piezas";

/**
 * La pestaña «Historial»: lo que cambió en RENIPRESS desde que lo leemos (estado, categoría, nombre, dirección, altas y
 * bajas), lo más nuevo primero, y la historia de estados que trae el detalle de RENIPRESS. Server-safe.
 */

const CAMPOS: Record<string, string> = {
  nombre: "Nombre",
  estado: "Estado",
  categoria: "Categoría",
  tipo: "Tipo",
  institucion: "Institución",
  clasificacion: "Clasificación",
  direccion: "Dirección",
  telefono: "Teléfono",
  alta: "Apareció en RENIPRESS",
  baja_registro: "Salió del archivo de RENIPRESS",
  categoria_detalle: "Categoría (en el detalle)",
  situacion: "Situación (en el detalle)",
};
const FUENTES: Record<string, string> = { renipress_csv: "Archivo de RENIPRESS", renipress_detalle: "Detalle de RENIPRESS" };

/** «fe_inicio» → «Fecha inicio»; «de_motivo» → «Motivo». Las claves del historial de RENIPRESS, legibles. */
function claveLegible(k: string): string {
  const t = k.replace(/^fe_/, "fecha_").replace(/^(de|co|no|nu)_/, "").replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const valor = (v: string | null) => (v == null || v === "" ? "vacío" : `«${v}»`);

/** «ACTIVO» → «Activo» (las siglas cortas quedan). */
const enOracion = (t: string | null | undefined) => (t ? t.charAt(0) + t.slice(1).toLowerCase().replace(/(ruc|sunat|ipress|upss|susalud)/g, (m) => m.toUpperCase()) : "");

/**
 * La historia de estados que trae el detalle de RENIPRESS, legible (2026-11-22, auditoría: salían «Ti condicion 3» y «Es
 * estado 1»): el estado, la condición, la fecha (inicio, cierre o fin, la que haya) y el motivo. Los códigos internos
 * (es_estado, ti_condicion) no se muestran y las entradas repetidas se juntan.
 */
function estados(h: Record<string, string | null>[]): { estado: string | null; condicion: string | null; fecha: string | null; motivo: string | null }[] {
  const out: { estado: string | null; condicion: string | null; fecha: string | null; motivo: string | null }[] = [];
  const vistos = new Set<string>();
  for (const x of h) {
    const fecha = x.de_fecha_ini ? `desde el ${x.de_fecha_ini}` : x.de_fecha_cie ? `cierre el ${x.de_fecha_cie}` : x.de_fecha_fin ? `hasta el ${x.de_fecha_fin}` : null;
    const e = { estado: x.estado ?? null, condicion: x.condicion && x.condicion !== x.estado ? x.condicion : null, fecha, motivo: x.de_motivo ?? null };
    const clave = JSON.stringify(e);
    if (vistos.has(clave) || (!e.estado && !e.condicion && !e.motivo)) continue;
    vistos.add(clave);
    out.push(e);
  }
  return out;
}

export function PestanaHistorial({ f }: { f: FichaIpress }) {
  const leido = detalleLeido(f);
  const historial = leido && f.detalle ? f.detalle.historial.filter((h) => Object.values(h).some((v) => v)) : [];
  const ren = f.fuentes.renipress;
  return (
    <div className="space-y-5">
      <CabeceraPestana>Lo que cambió en RENIPRESS desde que lo leemos, y la historia de estados que trae su detalle.</CabeceraPestana>

      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-meta text-inkSoft" aria-label="Desde cuándo lo leemos">
        {f.primeraVez && (
          <li className="inline-flex items-center gap-1.5">
            <Eye size={14} aria-hidden className="text-mute" />
            En nuestra lectura de RENIPRESS desde el {fechaCorta(f.primeraVez)}
          </li>
        )}
        {f.vistoAl && (
          <li className="inline-flex items-center gap-1.5">
            <CalendarClock size={14} aria-hidden className="text-mute" />
            Última lectura del archivo: {fechaCorta(f.vistoAl)}
          </li>
        )}
        {f.inicioActividad && (
          <li className="inline-flex items-center gap-1.5">
            <Hourglass size={14} aria-hidden className="text-mute" />
            Inicio de actividad según RENIPRESS: {fechaCorta(f.inicioActividad)}
          </li>
        )}
      </ul>

      {/* Sin cambios y sin historia de estados: una sola nota, no dos cajas vacías (2026-11-22, auditoría). */}
      {f.cambios.length === 0 && leido && historial.length === 0 ? (
        <Bloque titulo="Cambios en RENIPRESS" icono={History}>
          <p className="text-dato leading-relaxed text-inkSoft">
            No registramos cambios en RENIPRESS{f.primeraVez ? ` desde el ${fechaCorta(f.primeraVez)}, cuando empezamos a leerlo` : ""}, y su detalle no
            trae una historia de estados. Comparamos el archivo cada viernes y el detalle cada 30 días.
          </p>
          <FuenteFecha nombre="Detalle de RENIPRESS (SUSALUD)" url={f.fuentes.detalle?.url ?? ren?.url ?? null} al={f.detalle?.leidoAl} className="mt-3" />
        </Bloque>
      ) : (
        <>
          <Bloque titulo="Cambios detectados" icono={History} cuenta={numero(f.cambios.length)}>
            {f.cambios.length ? (
              <ol className="relative space-y-4 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-line">
                {f.cambios.map((c, i) => (
                  <li key={`${c.fecha}-${c.campo}-${i}`} className="relative pl-6">
                    <span aria-hidden className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-paper bg-granate" />
                    <p className="flex flex-wrap items-baseline gap-x-2 text-dato">
                      <span className="font-semibold text-ink">{CAMPOS[c.campo] ?? claveLegible(c.campo)}</span>
                      <span className="text-meta tabular-nums text-mute">{fechaCorta(c.fecha)}</span>
                    </p>
                    <p className="mt-0.5 text-dato leading-snug text-inkSoft [overflow-wrap:anywhere]">
                      {c.campo === "alta" ? `Con estado ${valor(c.despues)}.` : c.campo === "baja_registro" ? `Su último estado era ${valor(c.antes)}.` : `De ${valor(c.antes)} a ${valor(c.despues)}.`}
                    </p>
                    <p className="mt-0.5 text-rotulo text-mute">{FUENTES[c.fuente] ?? c.fuente}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-dato text-inkSoft">
                No registramos cambios en RENIPRESS{f.primeraVez ? ` desde el ${fechaCorta(f.primeraVez)}, cuando empezamos a leerlo` : ""}. Comparamos el archivo cada
                viernes y el detalle cada 30 días.
              </p>
            )}
          </Bloque>

          <Bloque titulo="Historia de estados en RENIPRESS" icono={CalendarClock} cuenta={leido ? numero(estados(historial).length) : undefined}>
            {!leido ? (
              <DetallePendiente url={ren?.url ?? ""} />
            ) : historial.length ? (
              <ol className="relative space-y-4 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-line">
                {estados(historial).map((e, i) => (
                  <li key={i} className="relative pl-6">
                    <span aria-hidden className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-paper ${i === 0 ? "bg-granate" : "bg-ink/25"}`} />
                    <p className="flex flex-wrap items-baseline gap-x-2 text-dato">
                      <span className="font-semibold text-ink">{enOracion(e.estado) || "Estado sin nombre"}</span>
                      {e.fecha && <span className="text-meta tabular-nums text-mute">{e.fecha}</span>}
                      {i === 0 && <span className="text-rotulo font-semibold text-granate">el último</span>}
                    </p>
                    {e.condicion && <p className="mt-0.5 text-dato text-inkSoft">{enOracion(e.condicion)}</p>}
                    {e.motivo &&
                      (e.motivo.length > 160 ? (
                        <details className="group mt-1">
                          <summary className="cursor-pointer list-none text-meta leading-relaxed text-inkSoft [&::-webkit-details-marker]:hidden">
                            {e.motivo.slice(0, 150).trimEnd()}…{" "}
                            <span className="font-semibold text-granate group-open:hidden">Leer el motivo completo</span>
                          </summary>
                          <p className="mt-1 text-meta leading-relaxed text-inkSoft [overflow-wrap:anywhere]">{e.motivo}</p>
                        </details>
                      ) : (
                        <p className="mt-1 text-meta leading-relaxed text-inkSoft [overflow-wrap:anywhere]">{e.motivo}</p>
                      ))}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-dato text-inkSoft">El detalle de RENIPRESS no trae una historia de estados (consultado el {fechaCorta(f.detalle?.leidoAl)}).</p>
            )}
            {leido && <FuenteFecha nombre="Detalle de RENIPRESS (SUSALUD)" url={f.fuentes.detalle?.url ?? ren?.url ?? null} al={f.detalle?.leidoAl} className="mt-3" />}
          </Bloque>
        </>
      )}
    </div>
  );
}
