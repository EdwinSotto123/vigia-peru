import Link from "next/link";
import { Coins, FileSearch, ScanSearch } from "lucide-react";
import { Ayuda, Seccion } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, CeldaTexto, CLASE_ENLACE_CELDA, Indicadores, Tabla, type Columna, type Fila } from "@/components/listado";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import type { ResumenControl } from "@/lib/corrupcion";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { LoObservado } from "./LoObservado";

/**
 * «Dónde señala más perjuicio la Contraloría» (GET /informes-control/resumen, migración 314): las cifras de lo leído, el
 * reparto por tema (cada tema filtra el ranking con `?tema=`) y las entidades con más perjuicio cuantificado, cada una
 * con su enlace a su pestaña Control. Va debajo del buscador de /app/contraloria. Server component.
 */
const COLUMNAS: Columna[] = [
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.6fr)" },
  {
    clave: "perjuicio",
    titulo: "Perjuicio que cuantifican",
    ancho: "minmax(9rem,0.9fr)",
    alinear: "der",
    ayuda: (
      <Ayuda titulo="¿Qué suma?">
        <span className="block">
          Lo que cuantifican las observaciones leídas de los informes de control de la entidad, en soles. Si varias observaciones de un
          informe repiten el mismo monto, se cuenta una vez. Lo sacó una lectura automática: es un orden de magnitud.
        </span>
      </Ayuda>
    ),
  },
  { clave: "observaciones", titulo: "Observaciones", ancho: "7.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "penal", titulo: "Informes con penal presunta", ancho: "8rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "Con penal presunta" },
  { clave: "contratos", titulo: "Contratos nombrados", ancho: "7.5rem", alinear: "der", desde: "lg", apilar: "con-rotulo", corto: "Contratos" },
  { clave: "tema", titulo: "Lo que más se le observa", ancho: "minmax(0,0.9fr)", desde: "xl", apilar: "con-rotulo", corto: "Tema" },
];

const rutaTema = (tema: string | null) => (tema ? `/app/contraloria?tema=${tema}#mapa` : "/app/contraloria#mapa");

export function MapaObservado({ datos }: { datos: ResumenControl | null }) {
  if (!datos?.total || !datos.total.observaciones) return null;
  const t = datos.total;
  const temaActivo = datos.porTema.find((x) => x.tema === datos.tema) ?? null;
  const maximo = Math.max(1, ...datos.entidades.map((e) => e.perjuicioPen));
  const filas: Fila[] = datos.entidades.map((e, i) => ({
    id: `ent-${e.ruc}`,
    celdas: {
      entidad: (
        <CeldaPrincipal
          dosLineas
          titulo={
            <Link href={`/entidad/${e.ruc}?seccion=control`} prefetch={false} className={CLASE_ENLACE_CELDA}>
              {i + 1}. {tituloNatural(e.entidad ?? `RUC ${e.ruc}`)}
            </Link>
          }
          meta={
            <span className="block">
              {e.departamento ? tituloNatural(e.departamento) : (e.departamentos ?? 0) > 1 ? `En ${e.departamentos} departamentos` : "Sin departamento registrado"},{" "}
              {plural(e.informes, "informe leído", "informes leídos")}
            </span>
          }
        />
      ),
      perjuicio: (
        <span className="block">
          <CeldaNumero>{solesCompacto(e.perjuicioPen)}</CeldaNumero>
          <CeldaBarra parte={e.perjuicioPen / maximo} resumen={`${solesCompacto(e.perjuicioPen)} de perjuicio señalado`} className="mt-1" />
        </span>
      ),
      observaciones: <CeldaNumero>{numero(e.observaciones)}</CeldaNumero>,
      penal: <CeldaNumero>{e.penal > 0 ? numero(e.penal) : <span className="font-sans text-mute">Ninguno</span>}</CeldaNumero>,
      contratos: (
        <CeldaNumero>
          {e.contratos > 0 ? (
            <Link href={`/app/contratos?entidad=${e.ruc}&cruce=observado_por_contraloria`} prefetch={false} className={CLASE_ENLACE_CELDA} title="Ver los contratos de esta entidad que la Contraloría observó">
              {numero(e.contratos)}
            </Link>
          ) : (
            <span className="font-sans text-mute">Ninguno</span>
          )}
        </CeldaNumero>
      ),
      tema: <CeldaTexto>{e.temaPrincipalTexto}</CeldaTexto>,
    },
  }));
  return (
    <Seccion
      id="mapa"
      titulo="Dónde señala más perjuicio"
      descripcion="Lo que cuantifican las observaciones de los informes de control ya leídos, por tema y por entidad."
      ayuda={
        <Ayuda titulo="¿Cómo se arma?">
          <span className="block">
            De cada observación de la Ficha Resumen de un informe, una lectura automática (IA) saca su tema y el perjuicio que cuantifica.
            Aquí se suman por tema y por la entidad del informe.
          </span>
          <span className="mt-1.5 block">
            Es un orden de magnitud para saber dónde mirar, no una liquidación: la lectura puede equivocarse y no todos los informes
            cuantifican un perjuicio. La responsabilidad que identifica un informe es presunta.
          </span>
        </Ayuda>
      }
    >
      <div className="space-y-4">
        <Indicadores
          franja
          items={[
            { valor: numero(t.observaciones), etiqueta: "observaciones leídas", contexto: `de ${numero(t.leidos)} informes de control`, icono: <FileSearch size={15} strokeWidth={1.9} aria-hidden />, parte: null },
            { valor: solesCompacto(t.perjuicioPen), etiqueta: "de perjuicio cuantificado", contexto: `en ${numero(t.conPerjuicio)} observaciones`, icono: <Coins size={15} strokeWidth={1.9} aria-hidden />, parte: null },
            { valor: numero(t.contratos), etiqueta: "contratos de Vigía nombrados", contexto: "una observación nombra su proceso o su obra", icono: <ScanSearch size={15} strokeWidth={1.9} aria-hidden />, parte: null },
          ]}
        />
        <LoObservado
          datos={{ observaciones: t.observaciones, perjuicioPen: t.perjuicioPen, contratos: 0, porTema: datos.porTema }}
          titulo="Por tema: elige uno para ver sus entidades"
          enlaceTema={rutaTema}
          activo={datos.tema}
        />
        <div>
          <h3 className="mb-2 text-cuerpo font-semibold text-ink">
            {temaActivo ? `Las ${filas.length} entidades con más perjuicio señalado en ${temaActivo.temaTexto.toLocaleLowerCase("es")}` : `Las ${filas.length} entidades con más perjuicio señalado`}
          </h3>
          {filas.length > 0 ? (
            <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Entidades con más perjuicio señalado por la Contraloría" />
          ) : (
            <VacioEnLinea>Ninguna observación leída de ese tema cuantifica un perjuicio.</VacioEnLinea>
          )}
        </div>
      </div>
    </Seccion>
  );
}
