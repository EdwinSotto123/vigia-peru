import { Ayuda } from "@/components/patrones";
import { plural } from "@/lib/formato";
import { getGastoPartido, getProcesosPartido, periodoTexto, type AnioGobierno, type DetallePartido, type GastoPartido } from "@/lib/partidosApi";
import { getCorrupcionPartido, rutaCorrupcion } from "@/lib/corrupcion";
import { PARAMS_EN_FICHA, getPersonas } from "@/lib/personas";
import { Banderas, BarrasMonto, BloqueInicio, LineasSinDato, SubseccionInicio } from "./BloquesInicio";
import { CasosCorrupcion } from "./CasosCorrupcion";
import { ContenidoPersonas } from "./ContenidoPersonas";
import { GastoInicio, motivoSinGasto } from "./GastoGobiernos";

/**
 * Inicio de un partido (/app/partidos/[clave], primera pestaña) en un período, con el orden de las demás fichas
 * (entidad, región): qué se encontró (las banderas de los contratos de sus gobiernos y de las personas que contrataron)
 * → dinero (en qué gastan según el MEF, en qué y dónde contrataron) → control (los informes de la Contraloría sobre las
 * entidades que gobernó) y, al final, lo que no tiene dato, en una línea cada uno.
 *
 * Antes abría con un bloque del MEF de ~2,650 px con dos tablas paginadas (ahora en la pestaña Gobiernos), tenía «En
 * números», que repetía la cabecera (gobiernos, entidades, proveedores, contratos), y «Personas» quedaba sola en su fila
 * (evaluación 2026-10-26). Las cifras de la cabecera no se repiten aquí.
 */
export async function InicioPartido({
  clave,
  anio,
  ruta,
  d,
  gasto: gastoP,
}: {
  clave: string;
  anio: AnioGobierno;
  ruta: string;
  d: DetallePartido;
  /** El mismo pedido que la pestaña Gobiernos (Next lo hace una sola vez). */
  gasto?: Promise<GastoPartido | null>;
}) {
  // Los conteos de lectura y antecedentes de TODOS sus procesos del período (sin los filtros de la pestaña de contratos).
  const [procesosTodos, corrupcion, gasto, personas] = await Promise.all([
    getProcesosPartido(clave, anio, { size: 1 }),
    getCorrupcionPartido(clave, anio),
    gastoP ?? getGastoPartido(clave, anio),
    getPersonas({ partido: clave, periodo: anio, size: 0 }),
  ]);
  const facetas = procesosTodos?.facetas ?? null;
  const procesos = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "procesos", ...f })}`;
  const enPersonas = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "personas", ...f })}`;
  const h = d.historia;
  const p = personas?.resumen ?? null;
  const leidos = (facetas?.porLectura?.publicado ?? 0) + (facetas?.porLectura?.revision ?? 0);
  const porObjeto = h?.porObjeto ?? [];
  const porRegion = regiones(d);
  const hayGasto = !!gasto?.disponible && !!gasto.totales;

  const sinDato: { titulo: string; motivo: string }[] = [];
  const sinGasto = motivoSinGasto(gasto);
  if (sinGasto) sinDato.push({ titulo: "En qué gastan sus gobiernos", motivo: sinGasto });
  if (!porObjeto.length) sinDato.push({ titulo: "En qué y dónde contrataron", motivo: "Sin contratos adjudicados registrados en este período." });
  if (!p) sinDato.push({ titulo: "Personas contratadas", motivo: "Sin dato: el servicio de personas no respondió." });
  else if (!p.filas) sinDato.push({ titulo: "Personas contratadas", motivo: "Sus gobiernos no registran órdenes de servicio a personas en este período." });

  return (
    <div className="space-y-10">
      <SubseccionInicio
        titulo="Qué se encontró"
        descripcion="Cruces de datos públicos en los contratos de sus gobiernos y en quienes contrataron: indicios para revisar, no acusaciones."
        ayuda={
          <Ayuda titulo="¿Qué es una bandera?">
            <span className="block">
              El riesgo que encontró Vigía al leer un contrato y lo que otros registros públicos dicen de quien lo ganó (o de
              quien recibió una orden). Sólo cuentan los contratos que también están en la base de Vigía (más o menos la mitad).
            </span>
            <span className="mt-2 block">Son motivos para revisar, no prueban una irregularidad ni acusan al partido. Cada fila abre esa lista ya filtrada.</span>
          </Ayuda>
        }
      >
        <BloqueInicio nivel={3} titulo="En sus contratos" enlace={{ href: procesos({ cruces: "con" }), texto: "Ver los que tienen antecedentes" }}>
          <Banderas porRiesgo={facetas?.porRiesgo} porCruces={facetas?.porCruces} href={procesos} conRiesgo={leidos > 0} />
        </BloqueInicio>
        {p && p.filas > 0 && (
          <BloqueInicio
            nivel={3}
            titulo="En las personas que contrataron"
            ayuda={
              <Ayuda titulo="¿Quiénes son?">
                Las personas a las que sus gobiernos pagaron por órdenes de servicio (locadores, asesores, choferes…), según el
                OECE. Las señales dicen qué otro registro público coincide con cada una: candidaturas y aportes al partido que
                gobierna, autoridades, apellidos de autoridades y funcionarios. No prueban nada.
              </Ayuda>
            }
            enlace={{ href: enPersonas(), texto: "Ver a las personas" }}
          >
            <ContenidoPersonas r={p} P={PARAMS_EN_FICHA} href={enPersonas} />
          </BloqueInicio>
        )}
      </SubseccionInicio>

      {(hayGasto || porObjeto.length > 0) && (
        <SubseccionInicio titulo="Dinero" descripcion={`En qué gastan sus gobiernos según el MEF y qué contrataron en ${periodoTexto(anio)}.`}>
          {/* El gasto, a lo alto de las dos filas: al lado, en qué y dónde contrataron (ninguno queda solo en su fila). */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <GastoInicio gasto={gasto} ruta={ruta} anio={anio} className="lg:row-span-2" />
            {porObjeto.length > 0 && (
              <BloqueInicio
                nivel={3}
                titulo="En qué contrataron"
                ayuda={
                  <Ayuda titulo="¿De dónde sale?">
                    De lo adjudicado por las entidades que gobernó en {periodoTexto(anio)} (OECE), por objeto. Cada barra abre esos
                    contratos.
                  </Ayuda>
                }
                enlace={{ href: procesos(), texto: "Ver los contratos" }}
              >
                <BarrasMonto
                  items={porObjeto.map((o) => ({ nombre: o.objeto, monto: o.montoAdjudicadoPen, detalle: plural(o.procesos, "contrato", "contratos"), href: procesos({ objeto: o.objeto }) }))}
                />
              </BloqueInicio>
            )}
            {porRegion.length > 0 && (
              <BloqueInicio nivel={3} titulo="Dónde contrataron" enlace={{ href: `${ruta}?anio=${anio}&seccion=gobiernos`, texto: "Ver sus gobiernos" }}>
                <BarrasMonto
                  items={porRegion.map((r) => ({ nombre: r.nombre, monto: r.monto, detalle: plural(r.procesos, "contrato", "contratos"), href: procesos({ region: r.ubigeo }) }))}
                />
              </BloqueInicio>
            )}
          </div>
        </SubseccionInicio>
      )}

      {/* Control: los informes de la Contraloría sobre sus entidades (no hay cifras de la Procuraduría por partido). */}
      <CasosCorrupcion
        datos={corrupcion}
        ruta={rutaCorrupcion.partido(clave, anio)}
        ambito="partido"
        nota={`Informes sobre las entidades que gobernó, emitidos de ${periodoTexto(anio)}. No dicen que la responsabilidad sea de sus autoridades: cada informe nombra a los funcionarios comprendidos, de carrera o de confianza.`}
      />

      <LineasSinDato items={sinDato} />
    </div>
  );
}

/** Procesos y monto por región, de sus gobiernos (la ficha trae cada gobierno con su ubigeo). */
function regiones(d: DetallePartido): { ubigeo: string; nombre: string; procesos: number; monto: number }[] {
  const m = new Map<string, { ubigeo: string; nombre: string; procesos: number; monto: number }>();
  for (const x of d.gobiernos ?? []) {
    const u = x.ubigeo.slice(0, 2);
    const r = m.get(u) ?? { ubigeo: u, nombre: x.region ?? u, procesos: 0, monto: 0 };
    r.procesos += x.procesos;
    r.monto += x.montoAdjudicadoPen;
    m.set(u, r);
  }
  return [...m.values()].filter((r) => r.monto > 0);
}
