import { BedDouble, CircleCheck, CircleSlash, Gavel, MessageSquareWarning, Scissors } from "lucide-react";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { CLASES_DE_HECHO, numero } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/**
 * Las insignias de una fila de Gobserva Salud con su conteo. Usan el MISMO tono e ícono que `InsigniaHecho`
 * (components/salud/comun.tsx): la sanción firme en rojo con el mazo, la denuncia en ámbar con el globo. Así una fila dice
 * «3 sanciones firmes» o «2 denuncias en 2026» sin que una se parezca a la otra. Server-safe.
 */

/** «3 sanciones firmes» (tono de la sanción firme). */
export function ConteoSanciones({ n, className }: { n: number; className?: string }) {
  return (
    <Insignia tono="urgente" Icono={Gavel} title={CLASES_DE_HECHO.sancion_firme.explica} className={className}>
      {n === 1 ? "1 sanción firme" : `${numero(n)} sanciones firmes`}
    </Insignia>
  );
}

/** «2 denuncias en 2026» (tono de la denuncia: no es una sanción). */
export function ConteoDenuncias({ n, anio, className }: { n: number; anio: number | null; className?: string }) {
  return (
    <Insignia tono="aviso" Icono={MessageSquareWarning} title={CLASES_DE_HECHO.denuncia.explica} className={className}>
      {n === 1 ? "1 denuncia" : `${numero(n)} denuncias`}
      {anio ? ` en ${anio}` : ""}
    </Insignia>
  );
}

/** El estado en RENIPRESS: «Activa» o el estado que registra («Cierre temporal de oficio», «Baja definitiva»). */
export function InsigniaRegistro({ activo, estado, className }: { activo: boolean; estado: string | null; className?: string }) {
  if (activo) {
    return (
      <Insignia tono="exito" Icono={CircleCheck} title={CLASES_DE_HECHO.registro_administrativo.explica} className={className}>
        Activa en RENIPRESS
      </Insignia>
    );
  }
  const texto = (estado ?? "Inactiva").toLocaleLowerCase("es-PE");
  return (
    <Insignia tono="neutro" Icono={CircleSlash} title={`RENIPRESS la registra en estado «${texto}».`} className={cn("text-ink", className)}>
      {texto.charAt(0).toLocaleUpperCase("es-PE") + texto.slice(1)}
    </Insignia>
  );
}

/** El centro quirúrgico cuando se sabe (registro administrativo: lo declaró la IPRESS). */
export function InsigniaQuirurgico({ quirurgico, className }: { quirurgico: boolean | null; className?: string }) {
  if (quirurgico == null) return null;
  return (
    <Insignia
      tono="neutro"
      Icono={Scissors}
      title={quirurgico ? "RENIPRESS le registra la unidad de centro quirúrgico activa." : "RENIPRESS no le registra una unidad de centro quirúrgico activa."}
      className={className}
    >
      {quirurgico ? "Centro quirúrgico" : "Sin centro quirúrgico"}
    </Insignia>
  );
}

/** Con internamiento (camas): del tipo de RENIPRESS. */
export function InsigniaInternamiento({ className }: { className?: string }) {
  return (
    <Insignia tono="neutro" Icono={BedDouble} title="RENIPRESS la registra como establecimiento con internamiento." className={className}>
      Con internamiento
    </Insignia>
  );
}
