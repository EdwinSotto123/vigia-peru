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

      <Bloque titulo="Historia de estados en RENIPRESS" icono={CalendarClock} cuenta={leido ? numero(historial.length) : undefined}>
        {!leido ? (
          <DetallePendiente url={ren?.url ?? ""} />
        ) : historial.length ? (
          <ol className="divide-y divide-line">
            {historial.map((h, i) => (
              <li key={i} className="py-2.5 first:pt-0 last:pb-0">
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {Object.entries(h)
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k} className="flex min-w-0 flex-wrap gap-x-2">
                        <dt className="text-meta text-mute">{claveLegible(k)}</dt>
                        <dd className="min-w-0 text-dato text-ink [overflow-wrap:anywhere]">{v}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-dato text-inkSoft">El detalle de RENIPRESS no trae una historia de estados (consultado el {fechaCorta(f.detalle?.leidoAl)}).</p>
        )}
        {leido && <FuenteFecha nombre="Detalle de RENIPRESS (SUSALUD)" url={f.fuentes.detalle?.url ?? ren?.url ?? null} al={f.detalle?.leidoAl} className="mt-3" />}
      </Bloque>
    </div>
  );
}
