import { CabeceraPestana, EnlaceFuente, FuenteDato } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { CONSULTA_AMIGABLE, DATASET_MEF, inversionSsi } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { periodoTexto, type GastoPartido } from "@/lib/partidosApi";
import { BarrasGasto } from "./BloquesInicio";

/**
 * "En qué gastan sus gobiernos": el presupuesto del MEF de los gobiernos que ganó un partido (sus ejecutoras: todas las
 * de un gobierno regional, la municipalidad en uno provincial o distrital):
 *   · en el Inicio del partido, una fila de «Ver más» con el presupuesto y lo gastado, que abre esta vista;
 *   · `GastoDetalle`, en la pestaña Gobiernos («En qué gastan»): el reparto por función, tipo de gasto y nivel, y los
 *     proyectos con más presupuesto. Cada gobierno con su presupuesto va en la tabla de esa pestaña (GobiernosPartido).
 * Antes todo estaba en el Inicio: ~2,650 px (≈3,900 en el celular) con dos tablas paginadas adentro, antes de las
 * banderas (evaluación 2026-10-26).
 */
const NIVEL: Record<string, string> = { regional: "Gobierno regional", provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" };
const NIVELES: Record<string, string> = { regional: "Gobiernos regionales", provincial: "Municipalidades provinciales", distrital: "Municipalidades distritales" };
const gastado = (pim: number, dev: number) => (pim > 0 ? (dev / pim) * 100 : 0);

/** Por qué no hay «en qué gastan»: el servicio no respondió, o el detalle del MEF es de un año fuera de este mandato. */
export function motivoSinGasto(gasto: GastoPartido | null): string | null {
  if (!gasto) return "Sin dato: el servicio no respondió.";
  if (!gasto.disponible || !gasto.totales) {
    return `El detalle del MEF que tiene Vigía es de ${gasto.mef ?? "otro año"}: el mandato de ${periodoTexto(gasto.anio)} ya había terminado.`;
  }
  return null;
}

/** La vista «En qué gastan» de la pestaña Gobiernos: el reparto entero y los proyectos con más presupuesto. */
export function GastoDetalle({ gasto }: { gasto: GastoPartido }) {
  const t = gasto.totales;
  if (!t) return null;
  return (
    <div className="space-y-6">
      {/* El título es el de la vista (h3 bajo el h2 de la pestaña): «En qué gastan sus gobiernos (MEF 2026)». */}
      <CabeceraPestana />
      <div className="grid gap-6 [container-type:inline-size] lg:grid-cols-2">
        <div className="min-w-0">
          <h4 className="mb-3 text-dato font-semibold text-ink">Por función</h4>
          <BarrasGasto rubros={gasto.funciones ?? []} total={t.pim} maximo={8} />
        </div>
        <div className="min-w-0 space-y-6">
          <div>
            <h4 className="mb-3 text-dato font-semibold text-ink">Por tipo de gasto</h4>
            <BarrasGasto rubros={gasto.genericas ?? []} total={t.pim} maximo={5} />
          </div>
          <div>
            <h4 className="mb-3 text-dato font-semibold text-ink">Por nivel de gobierno</h4>
            <BarrasGasto
              rubros={(gasto.porNivel ?? []).map((n) => ({ nombre: `${NIVELES[n.nivel]} (${numero(n.gobiernos)})`, pim: n.pim, devengado: n.devengado }))}
              total={t.pim}
              maximo={3}
            />
          </div>
        </div>
      </div>

      {(gasto.proyectos?.length ?? 0) > 0 && (
        <div>
          <h4 className="mb-3 text-dato font-semibold text-ink">Proyectos con más presupuesto</h4>
          <TablaPaginada
            columnas={COLUMNAS_PROYECTOS}
            filas={filasProyectos(gasto)}
            etiqueta="Proyectos de inversión con más presupuesto"
            tam={10}
            nombre="proyectos"
            buscar={{ placeholder: "Buscar un proyecto, su CUI o el gobierno…", etiqueta: "Buscar en los proyectos" }}
          />
        </div>
      )}
      <FuenteDato
        fuente={`MEF, Consulta Amigable (${gasto.mef}): presupuesto modificado (PIM) y devengado`}
        href={CONSULTA_AMIGABLE}
        enlaces={[{ texto: "Presupuesto y ejecución (Datos Abiertos del MEF)", href: DATASET_MEF }]}
      />
    </div>
  );
}

const COLUMNAS_PROYECTOS: Columna[] = [
  { clave: "proyecto", titulo: "Proyecto", ancho: "minmax(0,1.8fr)" },
  { clave: "gobierno", titulo: "Gobierno", ancho: "minmax(0,0.9fr)", desde: "md", apilar: true },
  { clave: "pim", titulo: "Presupuesto", ancho: "112px", alinear: "der" },
  { clave: "gastado", titulo: "Gastado", ancho: "88px", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

function filasProyectos(g: GastoPartido): Fila[] {
  return (g.proyectos ?? []).map((p) => ({
    id: `${p.codigo}-${p.ubigeo}`,
    buscable: [p.nombre, p.codigo, p.lugar, NIVEL[p.nivel]].filter(Boolean).join(" "),
    celdas: {
      proyecto: (
        <CeldaPrincipal
          titulo={tituloNatural(p.nombre)}
          dosLineas
          // El CUI abre la inversión en el seguimiento del MEF: lo que se aprobó, lo que cuesta y lo gastado.
          meta={[
            <Dato key="c" tipo="codigo" nombre="Código único de inversión" mono>
              <EnlaceFuente href={inversionSsi(p.codigo)}>CUI {p.codigo}</EnlaceFuente>
            </Dato>,
          ]}
        />
      ),
      gobierno: <CeldaTexto sub={<Dato tipo="tipo">{NIVEL[p.nivel]}</Dato>}><Dato tipo="lugar">{p.lugar ?? p.ubigeo}</Dato></CeldaTexto>,
      pim: <CeldaNumero>{solesCompacto(p.pim)}</CeldaNumero>,
      gastado: <CeldaNumero>{porcentaje(gastado(p.pim, p.devengado))}</CeldaNumero>,
    },
  }));
}
