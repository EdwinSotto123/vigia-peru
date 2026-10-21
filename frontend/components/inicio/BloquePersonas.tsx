import { Ayuda } from "@/components/patrones";
import { getPersonas, type FiltrosPersonas } from "@/lib/personas";
import { BloqueInicio } from "./BloquesInicio";
import { ContenidoPersonas } from "./ContenidoPersonas";

/**
 * "Personas contratadas" en el Inicio de una entidad o un partido: cuántas personas recibieron órdenes de servicio,
 * cuánto se les pagó y qué señales tienen, cada fila con su enlace a la pestaña ya filtrada. `href(filtro)` arma ese
 * enlace con los parámetros de la ficha (PARAMS_EN_FICHA).
 */
export async function BloquePersonas({
  alcance,
  href,
  de,
}: {
  alcance: Pick<FiltrosPersonas, "entidad" | "partido" | "periodo">;
  href: (filtro: Record<string, string>) => string;
  /** "esta entidad", "sus gobiernos". */
  de: string;
}) {
  const r = (await getPersonas({ ...alcance, size: 0 }))?.resumen ?? null;
  return (
    <BloqueInicio
      titulo="Personas contratadas"
      ayuda={
        <Ayuda titulo="¿Quiénes son?">
          Las personas a las que {de} pagó por órdenes de servicio (locadores, asesores, choferes…), según el OECE. Las señales
          dicen qué otro registro público coincide con cada una: candidaturas y aportes al partido que gobierna, autoridades,
          apellidos de autoridades y funcionarios, órdenes casi todos los meses, pagos muy por encima de lo usual. No prueban
          nada.
        </Ayuda>
      }
      enlace={{ href: href({}), texto: "Ver a las personas" }}
    >
      <ContenidoPersonas r={r} href={href} />
    </BloqueInicio>
  );
}
