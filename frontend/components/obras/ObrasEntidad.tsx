import { Suspense } from "react";
import { Ayuda, AyudaTermino, CabeceraPestana, EstadoVacio, Pestanas, type Pestana } from "@/components/patrones";
import { Listado, TablaSkeleton, ZonaResultados, type Parametros } from "@/components/listado";
import { Diferida } from "@/components/entidad/PestanasEntidad";
import { BarraObras, ListaObras } from "./ListaObras";
import { BarraInversiones, ListaInversiones } from "./ListaInversiones";
import { P_INV, P_OBRA, getInversiones, getObras, parametrosDe, parseInversionesQuery, parseObrasQuery } from "@/lib/obras";

/**
 * La pestaña «Obras» de la ficha de una entidad (/entidad/[ruc]?seccion=obras): sus obras públicas en INFOBRAS
 * (Contraloría) y sus inversiones en Invierte.pe (MEF), en dos vistas (`?vista=`), cada una con su número, su buscador y
 * sus filtros (estado, banderas, si tiene su contrato en Vigía, cómo se ejecuta, cuánto cuesta, desde cuándo). Cada fila
 * abre su panel con la evidencia y el enlace a la ficha oficial; las que tienen su contrato en Vigía, también a él.
 *
 * Las banderas de cada obra son las mismas que aparecen en su contrato (pestaña «Antecedentes», grupo «En la obra») y en
 * el Inicio de la entidad: una sola regla, en la base (migración 160).
 */

export const TAM_OBRAS = 25;
export const VISTAS_OBRAS = ["obras", "inversiones"] as const;
export type VistaObras = (typeof VISTAS_OBRAS)[number];

type Busqueda = Record<string, string | string[] | undefined> | undefined;

export function AyudaObras() {
  return (
    <Ayuda titulo="¿De dónde salen las obras y las inversiones?">
      <span className="block">
        Obras: de INFOBRAS, el registro de la Contraloría donde cada entidad anota sus obras públicas, quién las construye y
        las supervisa, cuánto avanzan cada mes, si se paralizaron y sus adicionales. Lo llena la propia entidad.
      </span>
      <span className="mt-2 block">
        Inversiones: de Invierte.pe, el banco de proyectos del MEF: cuánto se aprobó cada uno (monto viable), cuánto cuesta
        hoy y cuánto se gastó.
      </span>
      <span className="mt-2 block">Las banderas son indicios para revisar, no acusaciones.</span>
    </Ayuda>
  );
}

export function ObrasEntidad({
  ruc,
  ruta,
  sp,
  conteo,
}: {
  ruc: string;
  ruta: string;
  sp: Busqueda;
  /** Cuántas obras e inversiones tiene (GET /entidades/:ruc/conteos); null = sin dato (la vista va sin número). */
  conteo: { obras: number | null; inversiones: number | null };
}) {
  const fo = parseObrasQuery(sp);
  const fi = parseInversionesQuery(sp);
  const pedida = VISTAS_OBRAS.find((v) => v === (Array.isArray(sp?.vista) ? sp?.vista[0] : sp?.vista));
  const conFiltrosInv = Object.values(P_INV).some((k) => typeof sp?.[k] === "string");
  // Sin obras pero con inversiones, la primera vista es la de las inversiones.
  const orden: VistaObras[] = conteo.obras === 0 && (conteo.inversiones ?? 0) > 0 ? ["inversiones", "obras"] : ["obras", "inversiones"];
  const activa: VistaObras = pedida ?? (conFiltrosInv ? "inversiones" : orden[0]);
  const base = (v: VistaObras): Parametros => ({ seccion: "obras", ...(v === orden[0] ? {} : { vista: v }) });

  const cuerpo = (v: VistaObras) => {
    if (v === "obras") {
      const parametros: Parametros = { ...parametrosDe(P_OBRA, fo), ...base("obras") };
      const pagina = getObras({ ...fo, entidad: ruc, size: TAM_OBRAS });
      return (
        <Listado ruta={ruta} parametros={parametros} paramPagina={P_OBRA.page}>
          <Suspense fallback={<div className="min-h-[52px]" />}>
            <BarraObras pagina={pagina} />
          </Suspense>
          <ZonaResultados>
            <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Obra", ancho: "1fr" }]} filas={8} />}>
              <ListaObras pagina={pagina} ruta={ruta} parametros={parametros} actual={fo.page ?? 1} />
            </Suspense>
          </ZonaResultados>
        </Listado>
      );
    }
    const parametros: Parametros = { ...parametrosDe(P_INV, fi), ...base("inversiones") };
    const pagina = getInversiones({ ...fi, entidad: ruc, size: TAM_OBRAS });
    return (
      <Listado ruta={ruta} parametros={parametros} paramPagina={P_INV.page}>
        <Suspense fallback={<div className="min-h-[52px]" />}>
          <BarraInversiones pagina={pagina} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: "Inversión", ancho: "1fr" }]} filas={8} />}>
            <ListaInversiones pagina={pagina} ruta={ruta} parametros={parametros} actual={fi.page ?? 1} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    );
  };

  const pestanas: Pestana[] = orden.map((v) => ({
    clave: v,
    etiqueta: v === "obras" ? "Obras (INFOBRAS)" : "Inversiones (Invierte.pe)",
    conteo: conteo[v],
    contenido: v === activa ? cuerpo(v) : (
      <Suspense fallback={<TablaSkeleton columnas={[{ clave: "a", titulo: v === "obras" ? "Obra" : "Inversión", ancho: "1fr" }]} filas={8} />}>
        <Diferida>{cuerpo(v)}</Diferida>
      </Suspense>
    ),
  }));

  return (
    <div>
      <CabeceraPestana ayuda={<AyudaObras />}>
        Sus obras públicas en INFOBRAS <AyudaTermino clave="infobras" /> y sus proyectos de inversión en Invierte.pe <AyudaTermino clave="invierte-pe" />, con
        lo que se encontró en cada uno.
      </CabeceraPestana>
      <Pestanas variante="segunda" key={activa} param="vista" activa={activa} etiqueta="Obras e inversiones de la entidad" pestanas={pestanas} />
    </div>
  );
}

/** La pestaña sin nada: ni obras en INFOBRAS ni inversiones en Invierte.pe. */
export function ObrasVacia() {
  return (
    <div>
      <CabeceraPestana ayuda={<AyudaObras />} />
      <EstadoVacio compacto conLlamita={false} titulo="No registra obras ni inversiones">
        INFOBRAS (Contraloría) no tiene obras registradas por esta entidad e Invierte.pe (MEF) no tiene inversiones de su unidad
        ejecutora. Pasa con las entidades que no construyen (o que no figuran en el SIAF).
      </EstadoVacio>
    </div>
  );
}
