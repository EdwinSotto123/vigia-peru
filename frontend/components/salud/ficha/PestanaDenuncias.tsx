import { FileSearch, HelpCircle, Info, Megaphone, MessageSquareWarning, Search, ChevronRight } from "lucide-react";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { CabeceraPestana } from "@/components/patrones/Pestanas";
import { FuenteFecha, InsigniaHecho } from "@/components/salud/comun";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { CLASES_DE_HECHO, numero, type FichaIpress } from "@/lib/gobserva-salud";
import { ColumnasAgrupadas, type SerieGrafico } from "./Graficos";
import { Bloque, EnlaceOficial, URL_DENUNCIA_SUSALUD } from "./piezas";

/**
 * La pestaña «Denuncias»: cuántas denuncias, consultas e intervenciones de oficio recibió SUSALUD sobre la IPRESS cada
 * año (datos abiertos, anonimizados). Dicho arriba y en cada rótulo: no son sanciones ni hechos comprobados, y un
 * hospital grande recibe más porque atiende a más gente. Server-safe.
 */

const SERIES: SerieGrafico[] = [
  { nombre: "Denuncias", color: 4 },
  { nombre: "Consultas", color: 1 },
  { nombre: "De oficio", color: 5 },
];

export function PestanaDenuncias({ f }: { f: FichaIpress }) {
  const anios = [...f.denunciasPorAnio].sort((a, b) => a.anio - b.anio);
  const fuente = f.fuentes.denuncias;
  const nota = (
    <div className="flex items-start gap-2.5 rounded-2xl border border-amber/30 bg-amber-soft/40 px-4 py-3 text-meta leading-relaxed text-ink">
      <MessageSquareWarning size={16} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
      <p>
        <span className="font-semibold">Estas cifras no son sanciones.</span>{" "}
        <span className="text-inkSoft">
          Una denuncia es el pedido de un ciudadano ante SUSALUD: no es un hecho comprobado. Un hospital grande recibe más
          porque atiende a más personas.
        </span>{" "}
        <a href={URL_DENUNCIA_SUSALUD} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-4 hover:underline">
          ¿Tuviste un problema? Presenta una denuncia<span className="sr-only"> ante SUSALUD (se abre en otra pestaña)</span>
        </a>
      </p>
    </div>
  );
  if (!anios.length) {
    return (
      <div className="space-y-4">
        <CabeceraPestana>Lo que recibió SUSALUD sobre este establecimiento, por año.</CabeceraPestana>
        {nota}
        <div className="tarjeta rounded-2xl border border-line bg-paper">
          <EstadoVacio
            Icono={FileSearch}
            titulo={`No figura en los datos de consultas y denuncias de SUSALUD${fuente?.al ? ` publicados hasta ${fuente.al}` : ""}`}
            texto="Si tuviste un problema con la atención, puedes presentar una consulta o una denuncia ante SUSALUD."
            acciones={<EnlaceOficial href={URL_DENUNCIA_SUSALUD}>Presentar una denuncia ante SUSALUD</EnlaceOficial>}
          />
        </div>
      </div>
    );
  }
  const ultimo = anios[anios.length - 1];
  return (
    <div className="space-y-5">
      <CabeceraPestana acciones={fuente ? <FuenteFecha nombre="Consultas y denuncias ante SUSALUD (anonimizado)" url={fuente.url} al={fuente.al} /> : undefined}>
        Lo que recibió SUSALUD sobre este establecimiento, año por año.
      </CabeceraPestana>
      {nota}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Bloque titulo="Por año" icono={MessageSquareWarning} ayuda={<span className="ml-1"><InsigniaHecho tipo="denuncia" /></span>}>
          <ColumnasAgrupadas
            etiqueta="Denuncias, consultas e intervenciones de oficio ante SUSALUD por año"
            series={SERIES}
            grupos={anios.map((a) => ({
              clave: String(a.anio),
              rotulo: String(a.anio),
              valores: [a.denuncias, a.consultas, a.deOficio],
              detalle: `${a.anio}: ${numero(a.denuncias)} ${a.denuncias === 1 ? "denuncia" : "denuncias"}, ${numero(a.consultas)} ${a.consultas === 1 ? "consulta" : "consultas"} y ${numero(a.deOficio)} de oficio`,
            }))}
          />
          {ultimo && fuente?.al && Number(fuente.al) === ultimo.anio && (
            <p className="mt-3 flex items-start gap-1.5 text-meta leading-snug text-mute">
              <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
              {ultimo.anio} puede estar incompleto: SUSALUD publica el año en curso varias veces al año.
            </p>
          )}
        </Bloque>

        <Bloque titulo="Qué cuenta cada cifra" icono={HelpCircle}>
          <ul className="space-y-3">
            <li className="flex items-start gap-2.5">
              <Megaphone size={16} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
              <span className="text-meta leading-snug text-inkSoft">
                <span className="block text-dato font-semibold text-ink">Denuncia</span>
                {CLASES_DE_HECHO.denuncia.explica}
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <HelpCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
              <span className="text-meta leading-snug text-inkSoft">
                <span className="block text-dato font-semibold text-ink">Consulta</span>
                Un pedido de orientación o de información a SUSALUD sobre este establecimiento.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <Search size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
              <span className="text-meta leading-snug text-inkSoft">
                <span className="block text-dato font-semibold text-ink">De oficio</span>
                Una intervención que SUSALUD inició por su cuenta, sin que nadie la pidiera.
              </span>
            </li>
          </ul>
        </Bloque>
      </div>

      <details className="group/tabla">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-meta font-semibold text-granate [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} aria-hidden className="transition-transform duration-rapido group-open/tabla:rotate-90" />
          Las mismas cifras en tabla
        </summary>
      <Bloque titulo="Año por año" cuenta={numero(anios.length)} descripcion="Del año más reciente al más antiguo.">
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[22rem] text-dato">
            <caption className="sr-only">Denuncias, consultas e intervenciones de oficio ante SUSALUD por año (no son sanciones)</caption>
            <thead>
              <tr className="border-b border-line text-left text-meta text-mute">
                <th scope="col" className="px-4 pb-2 font-medium sm:px-5">Año</th>
                <th scope="col" className="px-3 pb-2 text-right font-medium">Denuncias</th>
                <th scope="col" className="px-3 pb-2 text-right font-medium">Consultas</th>
                <th scope="col" className="px-4 pb-2 text-right font-medium sm:px-5">De oficio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...anios].reverse().map((a) => (
                <tr key={a.anio}>
                  <th scope="row" className="px-4 py-2 text-left font-mono font-semibold tabular-nums text-ink sm:px-5">{a.anio}</th>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{numero(a.denuncias)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-inkSoft">{numero(a.consultas)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-inkSoft sm:px-5">{numero(a.deOficio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bloque>
      </details>
    </div>
  );
}
