import { Ayuda } from "@/components/patrones";
import { DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { plural, solesCompacto } from "@/lib/formato";
import { AVISO_PARTIDO, getGastoPartido, getProcesosPartido, periodoTexto, type AnioGobierno, type DetallePartido } from "@/lib/partidosApi";
import { getCorrupcionPartido, rutaCorrupcion } from "@/lib/corrupcion";
import { Banderas, BarrasMonto, BloqueInicio, Fichas, RejillaInicio, SinDato } from "./BloquesInicio";
import { CasosCorrupcion } from "./CasosCorrupcion";
import { BloquePersonas } from "./BloquePersonas";
import { GastoGobiernos } from "./GastoGobiernos";

/**
 * Inicio de un partido (/app/partidos/[clave], primera pestaña) en un período: en qué gastan sus gobiernos (MEF), en
 * qué contrataron (OECE), dónde, sus contratos, las banderas levantadas y los informes de la Contraloría sobre las
 * entidades que gobernó.
 */
export async function InicioPartido({ clave, anio, ruta, d }: { clave: string; anio: AnioGobierno; ruta: string; d: DetallePartido }) {
  // Los conteos de lectura y antecedentes de TODOS sus procesos del período (sin los filtros de la pestaña de procesos).
  const [procesosTodos, corrupcion, gasto] = await Promise.all([
    getProcesosPartido(clave, anio, { size: 1 }),
    getCorrupcionPartido(clave, anio),
    getGastoPartido(clave, anio),
  ]);
  const facetas = procesosTodos?.facetas ?? null;
  const procesos = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "procesos", ...f })}`;
  const h = d.historia;
  const t = d.totales;
  const g = d.partido.gobiernos;

  const datos: DatoClave[] = [
    { etiqueta: "Contratos adjudicados", valor: h ? plural(h.procesos, "contrato", "contratos") : null },
    { etiqueta: "Monto adjudicado", valor: h ? solesCompacto(h.montoAdjudicadoPen) : null },
    {
      etiqueta: "Gobiernos que ganó",
      valor: <Fichas items={[{ etiqueta: "Regiones", n: g.regional }, { etiqueta: "Provincias", n: g.provincial }, { etiqueta: "Distritos", n: g.distrital }]} />,
    },
    {
      etiqueta: "Entidades y proveedores",
      valor: h ? <Fichas items={[{ etiqueta: "Entidades", n: h.entidades }, { etiqueta: "Proveedores", n: h.proveedores }]} /> : null,
    },
    {
      etiqueta: "En la base de Vigía",
      valor:
        t.contratos > 0 ? (
          <Fichas items={[{ etiqueta: "Contratos", n: t.contratos }, { etiqueta: "Leídos", n: t.leidos, destacada: true }, { etiqueta: "En cola", n: t.enCola }]} />
        ) : (
          "Ninguno en este período"
        ),
    },
  ];

  return (
    <RejillaInicio>
      <GastoGobiernos gasto={gasto} ruta={ruta} anio={anio} />

      <BloqueInicio
        titulo="En qué contrataron sus gobiernos"
        ayuda={
          <Ayuda titulo="¿De dónde sale?">
            De lo adjudicado por las entidades que gobernó en {periodoTexto(anio)} (OECE), por objeto. Cada barra abre esos
            contratos.
          </Ayuda>
        }
        enlace={{ href: procesos(), texto: "Ver los contratos" }}
      >
        {h && h.porObjeto.length > 0 ? (
          <BarrasMonto
            items={h.porObjeto.map((o) => ({ nombre: o.objeto, monto: o.montoAdjudicadoPen, detalle: plural(o.procesos, "contrato", "contratos"), href: procesos({ objeto: o.objeto }) }))}
          />
        ) : (
          <SinDato>Sin contratos adjudicados registrados en este período.</SinDato>
        )}
      </BloqueInicio>

      <BloqueInicio titulo="Sus contratos" ayuda={<Ayuda titulo="Una advertencia">{AVISO_PARTIDO}</Ayuda>} enlace={{ href: `${ruta}?anio=${anio}&seccion=gobiernos`, texto: "Ver sus gobiernos" }}>
        <DatosClave items={datos} />
      </BloqueInicio>

      <BloqueInicio titulo="Dónde contrataron" enlace={{ href: procesos(), texto: "Filtrar por región" }}>
        {(d.gobiernos ?? []).length > 0 ? (
          <BarrasMonto
            items={regiones(d).map((r) => ({ nombre: r.nombre, monto: r.monto, detalle: plural(r.procesos, "contrato", "contratos"), href: procesos({ region: r.ubigeo }) }))}
          />
        ) : (
          <SinDato>Sin datos por región.</SinDato>
        )}
      </BloqueInicio>

      <BloqueInicio
        titulo="Banderas levantadas"
        ayuda={
          <Ayuda titulo="¿Qué es una bandera?">
            El riesgo que encontró Vigía al leer un contrato y los antecedentes de quien lo ganó. Sólo cuentan los contratos
            que también están en la base de Vigía (más o menos la mitad). Son motivos para revisar, no prueban una
            irregularidad ni acusan al partido.
          </Ayuda>
        }
        enlace={{ href: procesos({ cruces: "con" }), texto: "Contratos con antecedentes" }}
      >
        <Banderas porRiesgo={facetas?.porRiesgo} porCruces={facetas?.porCruces} href={procesos} />
      </BloqueInicio>

      <BloquePersonas
        alcance={{ partido: clave, periodo: anio }}
        de="sus gobiernos"
        href={(f) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "personas", ...f })}`}
      />

      <CasosCorrupcion
        datos={corrupcion}
        ruta={rutaCorrupcion.partido(clave, anio)}
        ambito="partido"
        nota={`Informes sobre las entidades que gobernó, emitidos de ${periodoTexto(anio)}. No dicen que la responsabilidad sea de sus autoridades: cada informe nombra a los funcionarios comprendidos, de carrera o de confianza.`}
      />
    </RejillaInicio>
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
  return [...m.values()];
}

