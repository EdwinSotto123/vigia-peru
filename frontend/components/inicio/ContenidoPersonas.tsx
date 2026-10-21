import { DatosClave } from "@/components/patrones/Detalle";
import { plural, solesCompacto } from "@/lib/formato";
import { PARAMS_EN_FICHA, SENAL, type ParamsPersonas, type ResumenPersonas } from "@/lib/personas";
import { ListaConteos, SinDato } from "./BloquesInicio";

/**
 * Lo de adentro del bloque "Personas contratadas" (BloquePersonas en el servidor, InicioRegion en el navegador):
 * cuántas personas y cuánto se les pagó, y las señales, cada una con su enlace a la lista filtrada.
 */
export function ContenidoPersonas({
  r,
  href,
  P = PARAMS_EN_FICHA,
}: {
  r: ResumenPersonas | null;
  href: (filtro: Record<string, string>) => string;
  P?: ParamsPersonas;
}) {
  if (!r) return <SinDato>Sin dato: el servicio de personas no respondió.</SinDato>;
  if (!r.filas) return <SinDato>Sin órdenes de servicio a personas registradas.</SinDato>;
  return (
    <div className="space-y-3">
      <DatosClave
        items={[
          { etiqueta: "Personas", valor: plural(r.personas, "persona", "personas") },
          { etiqueta: "Se les pagó", valor: `${solesCompacto(r.monto)} en ${plural(r.ordenes, "orden", "órdenes")}` },
        ]}
      />
      <ListaConteos
        filas={[
          { etiqueta: "Con una señal grave", n: r.alta, href: href({ [P.severidad]: "alta" }), grave: true },
          { etiqueta: "Con alguna señal", n: r.conSenales, href: href({ [P.severidad]: "con" }) },
          ...r.porSenal.slice(0, 5).map((s) => ({ etiqueta: SENAL[s.tipo]?.titulo ?? s.tipo, n: s.n, href: href({ [P.senal]: s.tipo }) })),
        ]}
      />
    </div>
  );
}
