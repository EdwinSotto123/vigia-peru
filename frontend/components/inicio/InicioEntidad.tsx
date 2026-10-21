import { Ayuda } from "@/components/patrones";
import { DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { getGastoEntidad } from "@/lib/api-client";
import { getCorrupcionEntidad } from "@/lib/corrupcion";
import { CasosCorrupcion } from "./CasosCorrupcion";
import { TIPOS, type ResumenContratos } from "@/lib/contratos";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { Banderas, BarrasGasto, BloqueInicio, RejillaInicio, SinDato } from "./BloquesInicio";

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
  const porTipo = resumen
    ? TIPOS.map((t) => [t.label, resumen.porTipo[t.value] ?? 0] as const).filter(([, n]) => n > 0).map(([e, n]) => `${e} ${numero(n)}`).join(" · ")
    : null;
  const datosContratos: DatoClave[] = [
    { etiqueta: "Desde 2015", valor: plural(totalContratos, "contrato", "contratos") },
    { etiqueta: "Por tipo", valor: porTipo || null },
    {
      etiqueta: "¿Lo leyó Vigía?",
      valor: l
        ? [
            l.publicado ? `${numero(l.publicado)} con dictamen` : null,
            l.revision ? `${numero(l.revision)} en revisión humana` : null,
            l.leyendo ? `${numero(l.leyendo)} leyéndose` : null,
            `${numero(l.sin_leer ?? 0)} aún no`,
          ].filter(Boolean).join(" · ")
        : null,
    },
    { etiqueta: "Esperan lectura", valor: enCola > 0 ? plural(enCola, "contrato en la cola", "contratos en la cola") : "ninguno en la cola" },
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
        enlace={{ href: `${ruta}?seccion=presupuesto`, texto: "Todo el presupuesto" }}
      >
        {gasto && totalGasto > 0 ? (
          <>
            <p className="mb-3 text-[13.5px] text-inkSoft">
              {solesCompacto(totalGasto)} de presupuesto, {solesCompacto(devengado)} ya gastado.
            </p>
            <BarrasGasto rubros={gasto.funciones} total={totalGasto} />
          </>
        ) : (
          <SinDato>Sin dato del MEF para esta entidad.</SinDato>
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

      <CasosCorrupcion datos={corrupcion} ambito="entidad" nombreRegion={region} />
    </RejillaInicio>
  );
}
