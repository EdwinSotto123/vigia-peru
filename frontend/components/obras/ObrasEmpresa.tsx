import { Suspense, type ReactNode } from "react";
import { Ayuda, AyudaTermino, CabeceraPestana, EstadoVacio } from "@/components/patrones";
import { Listado, TablaSkeleton, ZonaResultados, type Parametros } from "@/components/listado";
import { BarraObras, ListaObras } from "./ListaObras";
import { P_OBRA, getObras, parametrosDe, parseObrasQuery, type ObrasPagina } from "@/lib/obras";

/**
 * La pestaña «Obras» de la ficha de una empresa (/empresa/[RUC]?seccion=obras): las obras públicas que construye o
 * supervisa según INFOBRAS (por su RUC como ejecutora o supervisora, y las de un consorcio que integra y que ganó el
 * contrato del mismo CUI). Son hechos, sin puntaje: cada obra con lo que registró la entidad (estado, avance, paralización,
 * adicionales) y su contrato en Vigía. La causa de una paralización o de un atraso puede ser de la entidad.
 */

export const TAM_OBRAS_EMPRESA = 25;

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/** La primera página de sus obras con los filtros de la URL, y cuántas tiene en total (sin filtros): el número de la pestaña. */
export function obrasDeEmpresa(ruc: string, sp: Busqueda): { pagina: Promise<ObrasPagina | null>; total: Promise<number | null> } {
  const f = parseObrasQuery(sp);
  const pagina = getObras({ ...f, empresa: ruc, size: TAM_OBRAS_EMPRESA });
  const filtrada = Object.keys(parametrosDe(P_OBRA, f)).some((k) => k !== P_OBRA.orden);
  const total = (filtrada ? getObras({ empresa: ruc, size: 1 }) : pagina).then((p) => (p && !p.sinDatos ? p.total : null));
  return { pagina, total };
}

function AyudaObrasEmpresa() {
  return (
    <Ayuda titulo="¿De dónde salen sus obras?">
      <span className="block">
        De INFOBRAS, el registro de obras públicas de la Contraloría: cada entidad anota quién construye y quién supervisa cada
        obra (por su RUC), cuánto avanza y si se paralizó. Las de un consorcio que integra se reconocen por el contrato del mismo
        CUI que ganó el consorcio.
      </span>
      <span className="mt-2 block">
        Son datos de la entidad, no un juicio sobre la empresa: un atraso o una paralización pueden venir de la falta de pago o
        de presupuesto.
      </span>
    </Ayuda>
  );
}

const SIN_OBRAS_EMPRESA: ReactNode = (
  <EstadoVacio compacto conLlamita={false} titulo="No figura en obras de INFOBRAS">
    Ninguna entidad la registra en INFOBRAS como ejecutora ni como supervisora de una obra.
  </EstadoVacio>
);

export function ObrasEmpresa({ ruc, ruta, sp, pagina, base }: { ruc: string; ruta: string; sp: Busqueda; pagina: Promise<ObrasPagina | null>; base: Parametros }) {
  const f = parseObrasQuery(sp);
  const parametros: Parametros = { ...base, ...parametrosDe(P_OBRA, f) };
  return (
    <div className="space-y-4">
      <CabeceraPestana ayuda={<AyudaObrasEmpresa />}>
        Las obras públicas que construye o supervisa según INFOBRAS <AyudaTermino clave="infobras" />, con lo que registró cada entidad.
      </CabeceraPestana>
      <Listado ruta={ruta} parametros={parametros} paramPagina={P_OBRA.page}>
        <Suspense fallback={<div className="min-h-[52px]" />}>
          <BarraObras pagina={pagina} deEmpresa />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Obra", ancho: "1fr" }]} filas={8} />}>
            <ListaObras pagina={pagina} ruta={ruta} parametros={parametros} actual={f.page ?? 1} conEntidad empresaRuc={ruc} vacia={SIN_OBRAS_EMPRESA} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </div>
  );
}
