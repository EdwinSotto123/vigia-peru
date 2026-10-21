import type { ReactNode } from "react";
import { Ayuda } from "@/components/patrones";
import { DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { AVISO_PARTIDO, getProcesosPartido, periodoTexto, type AnioGobierno, type DetallePartido } from "@/lib/partidosApi";
import { Banderas, BarrasMonto, BloqueInicio, RejillaInicio, SinDato } from "./BloquesInicio";

/**
 * Inicio de un partido (/app/partidos/[clave], primera pestaña) en un período: en qué contrataron sus gobiernos,
 * dónde, sus contratos y las banderas levantadas. El MEF no se suma por partido (cada gobierno tiene su presupuesto):
 * "en qué" sale de lo adjudicado (OECE). `corrupcion` lo arma la página.
 */
export async function InicioPartido({
  clave,
  anio,
  ruta,
  d,
  corrupcion,
}: {
  clave: string;
  anio: AnioGobierno;
  ruta: string;
  d: DetallePartido;
  corrupcion?: ReactNode;
}) {
  // Los conteos de lectura y antecedentes de TODOS sus procesos del período (sin los filtros de la pestaña de procesos).
  const facetas = (await getProcesosPartido(clave, anio, { size: 1 }))?.facetas ?? null;
  const procesos = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "procesos", ...f })}`;
  const h = d.historia;
  const t = d.totales;
  const g = d.partido.gobiernos;

  const datos: DatoClave[] = [
    { etiqueta: "Contratos adjudicados", valor: h ? `${numero(h.procesos)} · ${solesCompacto(h.montoAdjudicadoPen)}` : null },
    { etiqueta: "Gobiernos que ganó", valor: [g.regional && plural(g.regional, "región", "regiones"), g.provincial && plural(g.provincial, "provincia", "provincias"), g.distrital && plural(g.distrital, "distrito", "distritos")].filter(Boolean).join(", ") || null },
    { etiqueta: "Entidades y proveedores", valor: h ? `${plural(h.entidades, "entidad", "entidades")}, ${plural(h.proveedores, "proveedor", "proveedores")}` : null },
    { etiqueta: "En la base de Vigía", valor: t.contratos > 0 ? `${plural(t.contratos, "contrato", "contratos")}, ${numero(t.leidos)} leídos, ${numero(t.enCola)} en cola` : "ninguno en este período" },
  ];

  return (
    <RejillaInicio>
      <BloqueInicio
        titulo="En qué contrataron sus gobiernos"
        ayuda={
          <Ayuda titulo="¿De dónde sale?">
            De lo adjudicado por las entidades que gobernó en {periodoTexto(anio)} (OECE), por objeto. El presupuesto del MEF
            es de cada gobierno, no del partido: está en la ficha de cada entidad.
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
        {d.regiones.length > 0 || (d.gobiernos ?? []).length > 0 ? (
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

      {corrupcion}
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
