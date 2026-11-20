import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Activity, Database, FileSpreadsheet, Gavel, Hourglass, Info, ListChecks, MessageSquareWarning, Scissors } from "lucide-react";
import { CabeceraPestana } from "@/components/patrones/Pestanas";
import { FuenteFecha, InsigniaHecho } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import type { FichaIpress, TipoHecho } from "@/lib/gobserva-salud";

/**
 * La pestaña «Fuentes»: cada fuente de esta ficha con su fecha y su enlace oficial (el archivo de RENIPRESS, el detalle,
 * el Registro de Sanciones, las denuncias, los recursos y las cirugías), qué clase de hecho aporta y el aviso de la API.
 */

type Clave = keyof FichaIpress["fuentes"];

const FUENTES: { clave: Clave; nombre: string; que: string; tipo: TipoHecho; Icono: LucideIcon }[] = [
  { clave: "renipress", nombre: "RENIPRESS: Registro Nacional de IPRESS (archivo)", que: "Estado, categoría, tipo, dirección, ubicación, teléfono y horario.", tipo: "registro_administrativo", Icono: FileSpreadsheet },
  { clave: "detalle", nombre: "Detalle de la IPRESS en RENIPRESS", que: "Unidades (UPSS), especialidades, cartera de servicios, documentos declarados y responsable.", tipo: "registro_administrativo", Icono: ListChecks },
  { clave: "sanciones", nombre: "Registro de Sanciones de SUSALUD", que: "Las sanciones firmes, con su resolución, procedimiento, infracción y estado judicial.", tipo: "sancion_firme", Icono: Gavel },
  { clave: "denuncias", nombre: "Consultas y denuncias ante SUSALUD (anonimizado)", que: "Cuántas consultas, denuncias e intervenciones de oficio recibió SUSALUD, por año.", tipo: "denuncia", Icono: MessageSquareWarning },
  { clave: "recursos", nombre: "Recursos de salud por IPRESS (Consulta A)", que: "Consultorios, camas, personal y ambulancias que la IPRESS declara al mes.", tipo: "registro_administrativo", Icono: Activity },
  { clave: "cirugias", nombre: "Producción de intervenciones quirúrgicas (Consulta H)", que: "Cirugías mayores y menores que la IPRESS declara al mes.", tipo: "registro_administrativo", Icono: Scissors },
];

/** Una fecha de fuente como se lee: el mes («2026-10-01» de un archivo mensual → «2026-10»), el año o el día. */
const comoFecha = (clave: Clave, al: string | number | null | undefined) =>
  al == null ? null : typeof al === "number" ? al : clave === "recursos" || clave === "cirugias" ? al.slice(0, 7) : al;

export function PestanaFuentes({ f, base }: { f: FichaIpress; base: string }) {
  return (
    <div className="space-y-5">
      <CabeceraPestana>De dónde sale cada dato de esta ficha, de qué fecha es y dónde verificarlo.</CabeceraPestana>
      <div className="tarjeta rounded-2xl border border-line bg-paper">
        <ul className="divide-y divide-line">
          {FUENTES.map(({ clave, nombre, que, tipo, Icono }) => {
            const x = f.fuentes[clave];
            return (
              <li key={clave} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 px-4 py-4 sm:px-5">
                <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-ink/[0.06] text-inkSoft">
                  <Icono size={18} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-cuerpo font-semibold text-ink">{nombre}</h3>
                    <InsigniaHecho tipo={tipo} />
                  </div>
                  <p className="mt-0.5 text-meta leading-snug text-inkSoft">{que}</p>
                  {x ? (
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <FuenteFecha nombre="SUSALUD" url={x.url} al={comoFecha(clave, x.al)}>
                        {clave === "renipress" || clave === "detalle" ? "Consulta oficial de RENIPRESS" : "Publicación oficial de SUSALUD"}
                      </FuenteFecha>
                      {x.archivo && <span className="font-mono text-rotulo text-mute">{x.archivo}</span>}
                    </div>
                  ) : (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-meta text-amberTexto">
                      <Hourglass size={13} aria-hidden /> Pedido a RENIPRESS: todavía no lo leemos.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-paperSoft px-4 py-3 text-meta leading-relaxed text-inkSoft">
        <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
        <p>{f.aviso}</p>
      </div>
      <Link
        href={rutaEn(base, "/fuentes")}
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-2 text-dato font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate"
      >
        <Database size={16} aria-hidden /> Cómo leemos cada fuente y cada cuánto
      </Link>
    </div>
  );
}
