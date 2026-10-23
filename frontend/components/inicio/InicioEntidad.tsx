import { Ayuda } from "@/components/patrones";
import { DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { Indicadores } from "@/components/listado";
import { getGastoEntidad } from "@/lib/api-client";
import { getCorrupcionEntidad, rutaCorrupcion } from "@/lib/corrupcion";
import { TIPOS, type ResumenContratos } from "@/lib/contratos";
import { plural, porcentaje, solesCompacto } from "@/lib/formato";
import { Banderas, BarrasGasto, BloqueInicio, Fichas, RejillaInicio, SinDato } from "./BloquesInicio";
import { CasosCorrupcion } from "./CasosCorrupcion";
import { BloquePersonas } from "./BloquePersonas";

/**
 * Inicio de una entidad (/entidad/[ruc], primera pestaña): en qué gasta (MEF), sus contratos, las banderas levantadas
 * y los casos de corrupción (Procuraduría Anticorrupción y Contraloría), cada bloque con su enlace al detalle.
 */
export async function InicioEntidad({
  ruc,
  ruta,
  resumen,
  totalContratos,
  enCola,
  region,
}: {
  ruc: string;
  ruta: string;
  resumen: ResumenContratos | null;
  totalContratos: number;
  enCola: number;
  /** Su departamento, por nombre: las cifras de la Procuraduría son de la región, no de la entidad. */
  region: string | null;
}) {
  const [gasto, corrupcion] = await Promise.all([getGastoEntidad(ruc), getCorrupcionEntidad(ruc)]);
  const contratos = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ seccion: "contratos", ...f })}`;
  const totalGasto = (gasto?.funciones ?? []).reduce((s, f) => s + f.pim, 0);
  const devengado = (gasto?.funciones ?? []).reduce((s, f) => s + f.devengado, 0);
  const l = resumen?.porLectura;
  const hayGasto = !!gasto && totalGasto > 0;

  const datosContratos: DatoClave[] = [
    { etiqueta: "Desde 2015", valor: plural(totalContratos, "contrato", "contratos") },
    {
      etiqueta: "Por tipo",
      valor: resumen ? <Fichas items={TIPOS.map((t) => ({ etiqueta: t.label, n: resumen.porTipo[t.value] ?? 0, href: contratos({ tipo: t.value }) }))} /> : null,
    },
    {
      etiqueta: "¿Lo leyó Vigía?",
      valor: l ? (
        <Fichas
          items={[
            { etiqueta: "Con dictamen", n: l.publicado ?? 0, href: contratos({ lectura: "publicado" }), destacada: true },
            { etiqueta: "En revisión humana", n: l.revision ?? 0, href: contratos({ lectura: "revision" }) },
            { etiqueta: "Leyéndose", n: l.leyendo ?? 0, href: contratos({ lectura: "leyendo" }) },
            { etiqueta: "Aún no", n: l.sin_leer ?? 0, href: contratos({ lectura: "sin_leer" }) },
          ]}
        />
      ) : null,
    },
    { etiqueta: "Esperan lectura", valor: enCola > 0 ? plural(enCola, "contrato en la cola", "contratos en la cola") : "Ninguno en la cola" },
  ];

  return (
    <RejillaInicio>
      <BloqueInicio
        titulo={gasto?.anio ? `En qué gasta (${gasto.anio})` : "En qué gasta"}
        ayuda={
          <Ayuda titulo="¿De dónde sale?">
            Del MEF (Consulta Amigable): el presupuesto modificado (PIM) de cada función del Estado y la parte ya gastada
            (devengado). {gasto?.cruce === "pliego" ? "Es el de todo el gobierno regional, no sólo esta sede." : ""}
          </Ayuda>
        }
        enlace={hayGasto ? { href: `${ruta}?seccion=presupuesto`, texto: "Todo el presupuesto" } : undefined}
        className={hayGasto ? undefined : "lg:self-start"}
      >
        {gasto && hayGasto ? (
          <div className="space-y-4">
            <Indicadores
              items={[
                { valor: solesCompacto(totalGasto), etiqueta: "de presupuesto" },
                { valor: porcentaje(totalGasto > 0 ? (devengado / totalGasto) * 100 : 0), etiqueta: "ya gastado", contexto: solesCompacto(devengado) },
              ]}
            />
            <BarrasGasto rubros={gasto.funciones} total={totalGasto} />
          </div>
        ) : (
          <SinDato>Vigía no encontró su presupuesto en el MEF (Consulta Amigable).</SinDato>
        )}
      </BloqueInicio>

      <BloqueInicio titulo="Sus contratos" enlace={{ href: contratos(), texto: "Ver los contratos" }}>
        <DatosClave items={datosContratos} />
      </BloqueInicio>

      <BloqueInicio
        titulo="Banderas levantadas"
        ayuda={
          <Ayuda titulo="¿Qué es una bandera?">
            El riesgo que encontró Vigía al leer un contrato y los antecedentes de quien lo ganó (sanciones, aportes de
            campaña, socios comunes…). Son motivos para revisar, no prueban una irregularidad. Cada fila abre esos
            contratos.
          </Ayuda>
        }
        enlace={{ href: contratos({ cruces: "con" }), texto: "Contratos con antecedentes" }}
      >
        <Banderas porRiesgo={resumen?.porRiesgo} porCruces={resumen?.porCruces} href={contratos} />
      </BloqueInicio>

      <BloquePersonas alcance={{ entidad: ruc }} de="esta entidad" href={(f) => `${ruta}?${new URLSearchParams({ seccion: "personas", ...f })}`} />

      <CasosCorrupcion datos={corrupcion} ruta={rutaCorrupcion.entidad(ruc)} ambito="entidad" nombreRegion={region} />
    </RejillaInicio>
  );
}

