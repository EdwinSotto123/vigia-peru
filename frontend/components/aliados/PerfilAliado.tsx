import { Severidad } from "@/components/ui/Severidad";
import { Ayuda } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import type { Comprobante, ComprobanteContrato } from "@/lib/financiamiento";
import { numero, plural } from "@/lib/formato";
import { pctProporcion } from "./proporcion";
import type { RegionAlcanzada, ResumenPerfil } from "./perfil";

/**
 * Las piezas de datos del perfil de un aliado (DESIGN_SYSTEM.md §14.6): sus cifras, las
 * zonas donde cayó lo que pagó y las señales que salieron en SUS contratos, las dos con
 * la `Tabla` de todo listado. Sin montos en soles: el perfil se cuenta en contratos.
 *
 * Nada de esto inventa dato: las zonas salen de los propios aportes y las señales de
 * `/financiamiento/impacto/:codigo`, el mismo comprobante público que cualquiera puede
 * consultar por código.
 */

const num = numero;

/**
 * Lo que hizo leer un aliado y qué salió, como `Indicadores` (§10.7). `base` es el
 * contexto de la primera cifra: los contratos publicados (el único contexto que vuelve
 * legible un "45" entre 18 mil).
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
      contexto: `de ${num(r.leidos)} leídos${r.enRevision > 0 ? `, ${num(r.enRevision)} en revisión` : ""}`,
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
      contexto: regionesConCola > 0 ? `de ${num(regionesConCola)} con cola abierta` : undefined,
      ayuda: (
        <Ayuda titulo="¿La región se elige?">
          Sí: al aportar se elige la zona y la cantidad. Los contratos concretos, no: salen de la cola por antigüedad.
        </Ayuda>
      ),
    },
  ];
}

const COLUMNAS_REGIONES: Columna[] = [
  { clave: "zona", titulo: "Zona", ancho: "minmax(0,1fr)" },
  { clave: "financiados", titulo: "Financiados", ancho: "104px", alinear: "der" },
  { clave: "leidos", titulo: "Leídos", ancho: "88px", alinear: "der", desde: "md" },
  { clave: "senales", titulo: "Con señales", ancho: "104px", alinear: "der", desde: "lg" },
];

/**
 * Las zonas donde cayeron sus aportes: cada fila va a la ficha de la zona, donde se ve
 * su cola y se puede financiar. `limite` para el resumen (las primeras, por contratos).
 */
export function RegionesDeAliado({
  regiones,
  financiados,
  limite,
  className,
}: {
  regiones: RegionAlcanzada[];
  /** Total de contratos financiados por el aliado: denominador de cada zona. */
  financiados: number;
  limite?: number;
  className?: string;
}) {
  if (regiones.length === 0) return null;
  const filas: Fila[] = (limite ? regiones.slice(0, limite) : regiones).map((r) => ({
    id: r.ubigeo,
    href: `/app/financiar/${r.ubigeo}`,
    celdas: {
      zona: <CeldaPrincipal titulo={r.zona} meta={plural(r.aportes, "aporte", "aportes")} />,
      financiados: <CeldaNumero sub={pctProporcion(r.contratos, financiados) ?? undefined}>{num(r.contratos)}</CeldaNumero>,
      leidos: <CeldaNumero sub={`de ${num(r.contratos)}`}>{num(r.procesados)}</CeldaNumero>,
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
 * El filtro es exactamente el del backend —alerta PUBLICADA y al menos una bandera—
 * y no "tiene severidad": un dictamen en revisión humana trae severidad pero todavía
 * no es una señal publicada, y mostrarlo como tal es justo lo que este producto no
 * puede hacer. Ordenadas por puntaje: lo más fuerte primero.
 */
export function senalesDeComprobantes(items: { comprobante: Comprobante | null }[]): SenalDeAliado[] {
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

/** Las más recientes primero (para el resumen): por fecha de lectura. */
export const senalesRecientes = (senales: SenalDeAliado[], n: number) =>
  [...senales].sort((a, b) => Date.parse(b.procesadaAt ?? "") - Date.parse(a.procesadaAt ?? "")).slice(0, n);

const AYUDA_SEVERIDAD = <Ayuda titulo="¿Qué severidad se muestra?">La de la señal más fuerte del contrato.</Ayuda>;

const COLUMNAS_SENALES: Columna[] = [
  { clave: "severidad", desde: "md", apilar: true, titulo: "Severidad", ancho: "124px", ayuda: AYUDA_SEVERIDAD },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "senales", titulo: "Señales", ancho: "80px", alinear: "der", desde: "md" },
  { clave: "leido", titulo: "Leído", ancho: "96px", desde: "lg" },
  {
    clave: "aporte",
    titulo: "Aporte",
    ancho: "140px",
    desde: "xl",
    ayuda: <Ayuda titulo="¿Qué aporte?">El que pagó la lectura de ese contrato.</Ayuda>,
  },
];

/** En el resumen (media página de ancho): estado, contrato y cuándo se leyó. */
const COLUMNAS_SENALES_COMPACTAS: Columna[] = [
  { clave: "severidad", desde: "md", apilar: true, titulo: "Severidad", ancho: "124px", ayuda: AYUDA_SEVERIDAD },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "leido", titulo: "Leído", ancho: "88px", desde: "lg" },
];

/**
 * Lo que salió en los contratos de este aliado. Cada fila va al contrato.
 */
export function TablaSenales({
  senales,
  nombre,
  compacta = false,
}: {
  senales: SenalDeAliado[];
  nombre: string;
  compacta?: boolean;
}) {
  const filas: Fila[] = senales.map((s) => ({
    id: `${s.codigoAporte}-${s.ocid}`,
    href: `/app/contratos/${encodeURIComponent(s.ocid)}`,
    celdas: {
      severidad: <Severidad bandera={s.severidad as "alta" | "media" | "baja"} />,
      contrato: (
        <CeldaPrincipal
          titulo={s.titulo ?? "Sin objeto declarado en el expediente"}
          meta={[s.entidad, s.zona].filter(Boolean).join(", ")}
        />
      ),
      senales: <CeldaNumero>{num(s.banderas)}</CeldaNumero>,
      leido: <CeldaFecha fecha={s.procesadaAt} />,
      aporte: (
        <CeldaTexto>
          <span className="font-mono">{s.codigoAporte}</span>
        </CeldaTexto>
      ),
    },
  }));
  return (
    <Tabla
      columnas={compacta ? COLUMNAS_SENALES_COMPACTAS : COLUMNAS_SENALES}
      filas={filas}
      etiqueta={`Contratos con señales financiados por ${nombre}`}
    />
  );
}
