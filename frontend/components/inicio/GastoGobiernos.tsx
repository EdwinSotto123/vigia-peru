import Link from "next/link";
import { Ayuda } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, CeldaTexto, Indicadores, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { periodoTexto, type GastoPartido } from "@/lib/partidosApi";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { BarrasGasto, BloqueInicio, SinDato } from "./BloquesInicio";

/**
 * "En qué gastan sus gobiernos": el presupuesto del MEF de los gobiernos que ganó un partido (sus ejecutoras: todas las
 * de un gobierno regional, la municipalidad en uno provincial o distrital). Cifras arriba; por función, por tipo de gasto
 * y por nivel en barras; los proyectos con más presupuesto y cada gobierno en tablas paginadas.
 */
const NIVEL: Record<string, string> = { regional: "Gobierno regional", provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" };
const NIVELES: Record<string, string> = { regional: "Gobiernos regionales", provincial: "Municipalidades provinciales", distrital: "Municipalidades distritales" };
const gastado = (pim: number, dev: number) => (pim > 0 ? (dev / pim) * 100 : 0);

export function GastoGobiernos({ gasto, ruta, anio }: { gasto: GastoPartido | null; ruta: string; anio: number }) {
  const t = gasto?.totales;
  return (
    <BloqueInicio
      ancho
      titulo={gasto?.mef ? `En qué gastan sus gobiernos (MEF ${gasto.mef})` : "En qué gastan sus gobiernos"}
      ayuda={
        <Ayuda titulo="¿De dónde sale?">
          <span className="block">
            Del MEF (Consulta Amigable): el presupuesto modificado (PIM) y lo ya gastado (devengado) de cada gobierno que
            ganó el partido. Un gobierno regional suma todas sus unidades ejecutoras (sede, salud, educación, UGEL); uno
            provincial o distrital, su municipalidad.
          </span>
          <span className="mt-2 block">
            El detalle por función, tipo de gasto y proyecto está cargado para {gasto?.mef ?? "el año en curso"}: sale sólo en
            el mandato que incluye ese año.
          </span>
        </Ayuda>
      }
      enlace={{ href: `${ruta}?anio=${anio}&seccion=gobiernos`, texto: "Ver sus gobiernos" }}
    >
      {!gasto ? (
        <SinDato>Sin dato: el servicio no respondió.</SinDato>
      ) : !gasto.disponible || !t ? (
        <SinDato>
          El detalle del MEF que tiene Vigía es de {gasto.mef ?? "otro año"}: el mandato de {periodoTexto(gasto.anio)} ya había
          terminado. Lo que contrataron sus gobiernos en ese período está abajo.
        </SinDato>
      ) : (
        <div className="space-y-6">
          <Indicadores
            items={[
              { valor: solesCompacto(t.pim), etiqueta: "de presupuesto", contexto: `en ${gasto.mef}` },
              { valor: porcentaje(gastado(t.pim, t.devengado)), etiqueta: "ya gastado", contexto: solesCompacto(t.devengado) },
              { valor: numero(t.conMef), etiqueta: "gobiernos con presupuesto", contexto: `de ${numero(t.gobiernos)} que ganó` },
              { valor: numero(t.ejecutoras), etiqueta: "unidades ejecutoras" },
            ]}
          />

          <div className="grid gap-6 [container-type:inline-size] lg:grid-cols-2">
            <div className="min-w-0">
              <h4 className="mb-3 text-[14px] font-semibold text-ink">Por función</h4>
              <BarrasGasto rubros={gasto.funciones ?? []} total={t.pim} maximo={8} />
            </div>
            <div className="min-w-0 space-y-6">
              <div>
                <h4 className="mb-3 text-[14px] font-semibold text-ink">Por tipo de gasto</h4>
                <BarrasGasto rubros={gasto.genericas ?? []} total={t.pim} maximo={5} />
              </div>
              <div>
                <h4 className="mb-3 text-[14px] font-semibold text-ink">Por nivel de gobierno</h4>
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
              <h4 className="mb-3 text-[14px] font-semibold text-ink">Proyectos con más presupuesto</h4>
              <TablaPaginada columnas={COLUMNAS_PROYECTOS} filas={filasProyectos(gasto)} etiqueta="Proyectos de inversión con más presupuesto" tam={8} nombre="proyectos" />
            </div>
          )}

          {(gasto.gobiernos?.length ?? 0) > 0 && (
            <div>
              <h4 className="mb-3 text-[14px] font-semibold text-ink">Cada gobierno, por presupuesto</h4>
              <TablaPaginada columnas={COLUMNAS_GOBIERNOS} filas={filasGobiernos(gasto)} etiqueta="Gobiernos del partido por presupuesto" tam={10} nombre="gobiernos" />
            </div>
          )}
        </div>
      )}
    </BloqueInicio>
  );
}

const COLUMNAS_PROYECTOS: Columna[] = [
  { clave: "proyecto", titulo: "Proyecto", ancho: "minmax(0,1.8fr)" },
  { clave: "gobierno", titulo: "Gobierno", ancho: "minmax(0,0.9fr)", desde: "md", apilar: true },
  { clave: "pim", titulo: "Presupuesto", ancho: "112px", alinear: "der" },
  { clave: "gastado", titulo: "Gastado", ancho: "88px", alinear: "der", desde: "md" },
];

function filasProyectos(g: GastoPartido): Fila[] {
  return (g.proyectos ?? []).map((p) => ({
    id: `${p.codigo}-${p.ubigeo}`,
    celdas: {
      proyecto: <CeldaPrincipal titulo={tituloNatural(p.nombre)} dosLineas meta={[`CUI ${p.codigo}`]} />,
      gobierno: <CeldaTexto sub={NIVEL[p.nivel]}>{p.lugar ?? p.ubigeo}</CeldaTexto>,
      pim: <CeldaNumero>{solesCompacto(p.pim)}</CeldaNumero>,
      gastado: <CeldaNumero>{porcentaje(gastado(p.pim, p.devengado))}</CeldaNumero>,
    },
  }));
}

const COLUMNAS_GOBIERNOS: Columna[] = [
  { clave: "gobierno", titulo: "Gobierno", ancho: "minmax(0,1.2fr)" },
  { clave: "region", titulo: "Región", ancho: "minmax(0,0.7fr)", desde: "md" },
  { clave: "barra", titulo: "Gastado", ancho: "minmax(0,0.8fr)", desde: "lg" },
  { clave: "pim", titulo: "Presupuesto", ancho: "112px", alinear: "der" },
  { clave: "gastado", titulo: "Gastado", ancho: "80px", alinear: "der", desde: "md" },
];

function filasGobiernos(g: GastoPartido): Fila[] {
  return (g.gobiernos ?? []).map((x) => {
    const pct = gastado(x.pim, x.devengado);
    return {
      id: `${x.nivel}-${x.ubigeo}`,
      celdas: {
        gobierno: (
          <CeldaPrincipal
            titulo={
              UBIGEO_REGION[x.departamento] ? (
                <Link href={`/app/mapa?region=${UBIGEO_REGION[x.departamento]}`} prefetch={false} className="underline-offset-4 hover:text-granate hover:underline">
                  {x.lugar ?? x.ubigeo}
                </Link>
              ) : (
                x.lugar ?? x.ubigeo
              )
            }
            meta={[NIVEL[x.nivel]]}
          />
        ),
        region: <CeldaTexto>{x.region ?? "Sin dato"}</CeldaTexto>,
        barra: <CeldaBarra parte={pct / 100} resumen={`${porcentaje(pct)} gastado`} />,
        pim: <CeldaNumero>{x.pim > 0 ? solesCompacto(x.pim) : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
        gastado: <CeldaNumero>{x.pim > 0 ? porcentaje(pct) : "—"}</CeldaNumero>,
      },
    };
  });
}
