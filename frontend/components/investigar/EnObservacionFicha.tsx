import dynamic from "next/dynamic";
import { FuenteDato } from "@/components/patrones";
import { CONOSCE_BUSCADOR, DATASET_AUTORIDADES_JNE, DATASET_DJI, DATASET_SOCIOS_RNP, djiEntidad, fichaRnp } from "@/lib/fuentes";
import { getCasosAutoridadExsocio, getCasosComprasFamilia } from "@/lib/patrones";

/**
 * Las señales en observación de una ficha (migraciones 364-370), con sus casos: quien tiene un puesto de compras y un
 * familiar que cobra de la entidad, y la autoridad electa que dejó de figurar en una empresa que le vende. Es la misma
 * tabla de /app/patrones, sólo con los casos de esta entidad o de esta empresa: cada fila abre su panel con cada orden,
 * su fecha, su enlace y su fuente.
 *
 * El servidor la pide sólo si la ficha trae la bandera (los contadores de su API): la mayoría de las fichas no la tiene.
 * Las tablas van en un trozo aparte (dynamic): cargan el panel de detalle, que pesa, y sólo hace falta aquí.
 */
const TablaCasosCompras = dynamic(() => import("./filasCasos").then((m) => m.TablaCasosCompras));
const TablaCasosAutoridad = dynamic(() => import("./filasCasos").then((m) => m.TablaCasosAutoridad));

export async function EnObservacionFicha({
  ruc,
  de,
  compras,
  autoridad,
}: {
  ruc: string;
  /** De quién es la ficha: cambia cómo se nombra cada lista. */
  de: "entidad" | "empresa";
  compras: boolean;
  autoridad: boolean;
}) {
  const [c, a] = await Promise.all([compras ? getCasosComprasFamilia(ruc) : null, autoridad ? getCasosAutoridadExsocio(ruc) : null]);
  const casosCompras = c?.data ?? [];
  const casosAutoridad = a?.data ?? [];
  if (!casosCompras.length && !casosAutoridad.length) return null;
  return (
    <section id="en-observacion" className="scroll-mt-28 space-y-5" aria-labelledby="en-observacion-titulo">
      <div className="space-y-1">
        <h3 id="en-observacion-titulo" className="font-display text-bloque font-bold text-ink">En observación</h3>
        <p className="max-w-prose text-meta text-inkSoft">
          Señales nuevas: se muestran con su evidencia y todavía no cuentan para el puntaje. Cada fila abre el caso, con cada orden, su fecha, su
          enlace y la norma que lo hace revisable.
        </p>
      </div>
      {casosCompras.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-cuerpo font-semibold text-ink">
            {de === "entidad"
              ? "Trabajan en sus compras y un familiar cobra de la entidad"
              : "Un familiar de quien trabaja en las compras de un cliente figura en la empresa"}
          </h4>
          <TablaCasosCompras casos={casosCompras} />
        </div>
      )}
      {casosAutoridad.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-cuerpo font-semibold text-ink">
            {de === "entidad"
              ? "Una autoridad suya dejó de figurar en una empresa que le vende"
              : "Una autoridad electa dejó de figurar en la empresa, que le vendió a su entidad"}
          </h4>
          <TablaCasosAutoridad casos={casosAutoridad} />
        </div>
      )}
      <FuenteDato
        fuente="Contraloría (declaraciones juradas de intereses), JNE (autoridades electas), Registro Nacional de Proveedores y órdenes y procesos de CONOSCE (OECE)"
        href={DATASET_DJI}
        enlaces={[
          de === "entidad" ? { texto: "Declaraciones juradas de esta entidad (Contraloría)", href: djiEntidad(ruc) } : { texto: "Su ficha en el RNP (OECE)", href: fichaRnp(ruc) },
          { texto: "Conformación jurídica de proveedores (datos abiertos)", href: DATASET_SOCIOS_RNP },
          casosAutoridad.length ? { texto: "Autoridades vigentes (JNE, datos abiertos)", href: DATASET_AUTORIDADES_JNE } : null,
          { texto: "Órdenes y procesos en CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
        ]}
      />
    </section>
  );
}
