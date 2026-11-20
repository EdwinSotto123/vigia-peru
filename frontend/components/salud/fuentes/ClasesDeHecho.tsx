import { ClipboardList, FileText, Gavel, MessageSquareWarning, type LucideIcon } from "lucide-react";
import { InsigniaHecho } from "@/components/salud/comun";
import { CLASES_DE_HECHO, type TipoHecho } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/** Las cuatro clases de hecho, con su ícono en su tono (el de InsigniaHecho) y lo que NO son. */
const CLASES: { tipo: TipoHecho | "reclamo"; Icono: LucideIcon; tinte: string; fuente: string; noEs: string }[] = [
  {
    tipo: "sancion_firme",
    Icono: Gavel,
    tinte: "bg-crimson-soft text-crimsonTexto",
    fuente: "Registro de Sanciones de SUSALUD.",
    noEs: "Es de la institución sancionada, no de sus médicos ni de quien la dirige.",
  },
  {
    tipo: "denuncia",
    Icono: MessageSquareWarning,
    tinte: "bg-amber-soft text-amberTexto",
    fuente: "Datos abiertos de SUSALUD, por año.",
    noEs: "No es una sanción. Un hospital grande recibe más porque atiende a más gente.",
  },
  {
    tipo: "reclamo",
    Icono: ClipboardList,
    tinte: "bg-paperDeep text-ink",
    fuente: "El libro de reclamaciones de cada establecimiento.",
    noEs: "Gobserva Salud no los muestra: se presentan y se resuelven en cada establecimiento.",
  },
  {
    tipo: "registro_administrativo",
    Icono: FileText,
    tinte: "bg-paperDeep text-ink",
    fuente: "RENIPRESS y lo que cada IPRESS informa a SUSALUD.",
    noEs: "SUSALUD lo publica; la IPRESS responde por lo que declaró.",
  },
];

/**
 * Las cuatro clases de hecho de Gobserva Salud (sanción firme, denuncia, reclamo, registro administrativo), cada una con su
 * rótulo, qué es, de dónde sale y qué no es. La usan la portada y /fuentes. Server-safe.
 */
export function ClasesDeHecho({ conFuente = false, className }: { conFuente?: boolean; className?: string }) {
  return (
    <dl className={cn("grid min-w-0 gap-x-8 gap-y-7 sm:grid-cols-2", className)}>
      {CLASES.map(({ tipo, Icono, tinte, fuente, noEs }) => (
        <div key={tipo} className="min-w-0">
          <dt className="flex items-center gap-2.5">
            <span aria-hidden className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", tinte)}>
              <Icono size={17} />
            </span>
            <InsigniaHecho tipo={tipo} className="text-meta" />
          </dt>
          <dd className="mt-2.5 text-dato leading-relaxed text-ink">{CLASES_DE_HECHO[tipo].explica}</dd>
          {conFuente && <dd className="mt-1 text-meta leading-relaxed text-inkSoft">Sale de: {fuente}</dd>}
          <dd className="mt-1 text-meta leading-relaxed text-inkSoft">{noEs}</dd>
        </div>
      ))}
    </dl>
  );
}
