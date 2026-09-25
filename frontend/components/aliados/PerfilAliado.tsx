import { Severidad } from "@/components/ui/Severidad";
import { Ayuda, Seccion } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import type { Comprobante, ComprobanteContrato } from "@/lib/financiamiento";
import { numero, plural, soles } from "@/lib/formato";
import { pctProporcion } from "./proporcion";
import type { RegionAlcanzada, ResumenPerfil } from "./perfil";

/**
 * Las dos preguntas que la ficha de un aliado contesta sin abrir un panel: **en qué
 * zonas cayó lo que pagó** y **qué se encontró en SUS contratos**. Las dos, con la
 * `Tabla` de todo listado (DESIGN_SYSTEM.md §14.1): antes cada una tenía su propia
 * lista, con barras, puntos medios e íconos por dato.
 *
 * Nada de esto inventa dato: las zonas salen de los propios aportes y las señales de
 * `/financiamiento/impacto/:codigo`, el mismo comprobante público que cualquiera
 * puede consultar por código.
 */

const num = numero;

/**
 * Lo que hizo leer un aliado y qué salió, como `Indicadores` (§10.7): las mismas cifras en
 * su ficha y en el panel de resumen del muro. Antes eran tres barras con leyendas largas,
 * una barra apilada y una línea aparte para "en revisión".
 *
 * `base` es el contexto de la primera cifra: los contratos publicados en la ficha (el único
 * contexto que vuelve legible un "45" entre 18 mil) o lo financiado por todo el muro en el panel.
 */
export function indicadoresAliado(
  r: ResumenPerfil,
  base: { total: number; texto: string } | null,
  regionesConCola: number,
): Indicador[] {
  return [
    {
      valor: num(r.financiados),
      etiqueta: "contratos financiados",
      contexto: base && base.total > 0 ? `${pctProporcion(r.financiados, base.total)} de ${num(base.total)} ${base.texto}` : undefined,
    },
    {
      valor: num(r.leidos),
      etiqueta: "financiados leídos",
      contexto: `de ${num(r.financiados)}`,
    },
    {
      valor: num(r.conSenal),
      etiqueta: "con señales",
      contexto: `de ${num(r.leidos)} leídos${r.enRevision > 0 ? ` · ${num(r.enRevision)} en revisión` : ""}`,
      ayuda: (
        <Ayuda titulo="¿Qué cuenta “con señales”?">
          Leídos con al menos una señal publicada, con la norma citada y el documento que la sostiene. Los que están en
          revisión no cuentan como señal hasta que una persona decida.
        </Ayuda>
      ),
    },
    {
      valor: num(r.regionesDistintas),
      etiqueta: "regiones",
      contexto: `de ${num(regionesConCola)} con cola abierta`,
      ayuda: (
        <Ayuda titulo="¿La región se elige?">
          Sí: al aportar se elige la zona y la cantidad. Los contratos concretos, no: salen de la cola por antigüedad.
        </Ayuda>
      ),
    },
  ];
}

/** Cuántos contratos con señales se listan antes de mandar al resto a la lista de aportes. */
const MAX_SENALES = 12;

const COLUMNAS_REGIONES: Columna[] = [
  { clave: "zona", titulo: "Zona", ancho: "minmax(0,1fr)" },
  { clave: "financiados", titulo: "Financiados", ancho: "112px", alinear: "der" },
  { clave: "leidos", titulo: "Leídos", ancho: "88px", alinear: "der", desde: "md" },
  { clave: "senales", titulo: "Con señales", ancho: "104px", alinear: "der", desde: "md" },
];

/**
 * Las zonas donde cayeron sus aportes: cada fila va a la ficha de la zona, donde se ve
 * su cola y se puede financiar. Sin encabezado propio: la ficha la pone en una `Seccion`
 * y el panel de resumen bajo su h3.
 */
export function RegionesDeAliado({
  regiones,
  financiados,
  className,
}: {
  regiones: RegionAlcanzada[];
  /** Total de contratos financiados por el aliado: denominador de cada zona. */
  financiados: number;
  className?: string;
}) {
  if (regiones.length === 0) return null;
  const filas: Fila[] = regiones.map((r) => ({
    id: r.ubigeo,
    href: `/app/financiar/${r.ubigeo}`,
    celdas: {
      zona: <CeldaPrincipal titulo={r.zona} meta={plural(r.aportes, "aporte", "aportes")} />,
      financiados: <CeldaNumero sub={pctProporcion(r.contratos, financiados) ?? undefined}>{num(r.contratos)}</CeldaNumero>,
      leidos: <CeldaNumero>{num(r.procesados)}</CeldaNumero>,
      senales: <CeldaNumero>{num(r.senales)}</CeldaNumero>,
    },
  }));
  return <Tabla columnas={COLUMNAS_REGIONES} filas={filas} etiqueta="Zonas donde cayeron sus contratos" className={className} />;
}

export interface SenalDeAliado extends ComprobanteContrato {
  codigoAporte: string;
  zona: string;
}

/**
 * Extrae, de los comprobantes ya traídos, los contratos que salieron con señal.
 *
 * El filtro es exactamente el del backend —alerta PUBLICADA y al menos una
 * bandera— y no "tiene severidad". Con el filtro laxo esta lista contaba 30
 * mientras la misma página decía 19 dos bloques más arriba: un dictamen en
 * revisión humana trae severidad pero todavía no es una señal publicada, y
 * mostrarlo como tal es justo lo que este producto no puede hacer.
 */
export function senalesDeComprobantes(
  items: { comprobante: Comprobante | null }[],
): SenalDeAliado[] {
  const senales: SenalDeAliado[] = [];
  for (const { comprobante } of items) {
    if (!comprobante) continue;
    for (const d of comprobante.detalle) {
      const publicada = d.procesadaAt != null && d.alertaEstado !== "revision" && d.banderas > 0;
      if (publicada && (d.severidad === "alta" || d.severidad === "media" || d.severidad === "baja")) {
        senales.push({ ...d, codigoAporte: comprobante.codigo, zona: comprobante.zona });
      }
    }
  }
  return senales.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.banderas - a.banderas);
}

const COLUMNAS_SENALES: Columna[] = [
  {
    clave: "severidad", desde: "md", apilar: true,
    titulo: "Severidad",
    ancho: "124px",
    ayuda: <Ayuda titulo="¿Qué severidad se muestra?">La de la señal más fuerte del contrato.</Ayuda>,
  },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "senales", titulo: "Señales", ancho: "80px", alinear: "der", desde: "md" },
  { clave: "valor", titulo: "Valor referencial", ancho: "132px", alinear: "der", desde: "lg" },
  {
    clave: "aporte",
    titulo: "Aporte",
    ancho: "128px",
    desde: "xl",
    ayuda: <Ayuda titulo="¿Qué aporte?">El que pagó la lectura de ese contrato.</Ayuda>,
  },
];

/**
 * Lo que salió en los contratos de este aliado, sin abrir un solo panel.
 * Ordenado por score: lo más fuerte primero, que es lo que un periodista busca.
 */
export function SenalesDeAliado({
  senales,
  nombre,
  esMaqueta = false,
}: {
  senales: SenalDeAliado[];
  nombre: string;
  /** Un contrato de maqueta no tiene OCID real: se muestra, pero no enlaza a ninguna parte. */
  esMaqueta?: boolean;
}) {
  if (senales.length === 0) return null;
  const visibles = senales.slice(0, MAX_SENALES);
  const filas: Fila[] = visibles.map((s) => ({
    id: `${s.codigoAporte}-${s.ocid}`,
    href: esMaqueta ? undefined : `/app/contratos/${encodeURIComponent(s.ocid)}`,
    celdas: {
      severidad: <Severidad bandera={s.severidad as "alta" | "media" | "baja"} />,
      contrato: (
        <CeldaPrincipal
          titulo={s.titulo ?? "Sin objeto declarado en el expediente"}
          meta={[s.entidad, s.zona].filter(Boolean).join(" · ")}
        />
      ),
      senales: <CeldaNumero>{num(s.banderas)}</CeldaNumero>,
      valor: <CeldaNumero>{s.valorReferencial != null ? soles(s.valorReferencial) : "Sin dato"}</CeldaNumero>,
      aporte: <CeldaTexto><span className="font-mono">{s.codigoAporte}</span></CeldaTexto>,
    },
  }));
  return (
    <Seccion
      titulo="Qué se encontró en sus contratos"
      ayuda={
        <Ayuda titulo="¿Una señal es una acusación?">
          No: cada señal se publica con la norma citada y el documento oficial que la sostiene, y se publicó igual sin
          consultar a {nombre}.
        </Ayuda>
      }
    >
      <div className="space-y-2">
        <Tabla columnas={COLUMNAS_SENALES} filas={filas} etiqueta={`Contratos con señales financiados por ${nombre}`} />
        {/* Parcial (§10.5): se dice qué falta y dónde está. */}
        {senales.length > visibles.length && (
          <p className="text-[12.5px] text-mute">
            {plural(senales.length - visibles.length, "contrato más con señales está", "contratos más con señales están")} en
            la lista de aportes, dentro del aporte que pagó cada uno.
          </p>
        )}
      </div>
    </Seccion>
  );
}
