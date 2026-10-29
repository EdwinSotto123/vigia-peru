"use client";

import { CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { Severidad } from "@/components/ui/Severidad";
import { numero } from "@/lib/formato";
import { ARISTA, type NodoOrganigrama, type TipoArista } from "@/lib/organigrama";
import { FUNCION_OFICINA, NIVEL_OFICINA } from "@/lib/planilla";

/** Una oficina de «Todas sus oficinas», sólo con lo que la tabla muestra, busca y ordena (la arma OrganizacionEntidad). */
export interface OficinaFila {
  id: string;
  /** Su nombre legible (`nombreOficina`). */
  nombre: string;
  sigla: string | null;
  funcion: NodoOrganigrama["funcion"];
  nivel: number;
  /** Quién la encabeza: su nombre (con un apellido tapado), su cargo ya legible y si sale de su DJI. */
  jefe: { nombre: string; cargo: string | null; dji: boolean } | null;
  /** El nombre de la oficina de la que depende y según qué. */
  padre: string | null;
  arista: TipoArista | null;
  personas: number;
  cas: number;
  conSenales: number;
  altas: number;
  planilla: number;
  /** Su gente en la pestaña Planilla (si la planilla escribe su oficina). */
  href: string | null;
  /** Los cargos de sus jefaturas, para el buscador. */
  cargos: string;
}

const columnas: Columna[] = [
  { clave: "oficina", titulo: "Oficina", ancho: "minmax(0,1.4fr)" },
  { clave: "jefe", titulo: "Quién la encabeza", corto: "Jefatura", ancho: "minmax(0,1.2fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "depende", titulo: "Depende de", ancho: "minmax(0,1fr)", desde: "lg", apilar: "con-rotulo" },
  { clave: "personas", titulo: "Personas", ancho: "6.5rem", alinear: "der" },
  { clave: "senales", titulo: "Con señales", ancho: "7rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

/**
 * «Todas sus oficinas», armada en el navegador: el servidor manda cada oficina como datos (`OficinaFila`) y no la fila
 * hecha. En el Minsa eran 1,486 filas, 2,8 MB de la pestaña Organización.
 */
export function TablaOficinas({ oficinas }: { oficinas: OficinaFila[] }) {
  const filas: FilaFiltrable[] = oficinas.map((x) => ({
    id: x.id,
    href: x.href ?? undefined,
    buscable: `${x.nombre} ${x.sigla ?? ""} ${x.cargos}`,
    valores: { funcion: x.funcion, nivel: String(x.nivel), arista: x.arista ?? "raiz" },
    claves: { personas: x.personas, planilla: x.planilla, senales: x.conSenales, nombre: x.nombre },
    celdas: {
      oficina: (
        <CeldaPrincipal
          titulo={x.nombre}
          meta={[
            x.sigla && <Dato key="s" tipo="codigo" nombre="Sigla en la planilla" mono>{x.sigla}</Dato>,
            <Dato key="f" tipo="tipo" nombre="Función">{FUNCION_OFICINA[x.funcion]}</Dato>,
            <Dato key="n" tipo="dependencia" nombre="Nivel">{NIVEL_OFICINA[x.nivel] ?? "Otra área"}</Dato>,
          ]}
        />
      ),
      jefe: x.jefe ? (
        <span className="block min-w-0 text-meta">
          <span className="block truncate font-semibold text-ink">{x.jefe.nombre}</span>
          <span className="block truncate text-inkSoft">
            {x.jefe.cargo ?? "Jefatura"}
            {x.jefe.dji ? ", según su DJI" : ""}
          </span>
        </span>
      ) : (
        <span className="text-meta text-mute">Sin jefatura en sus datos</span>
      ),
      depende: x.padre ? (
        <span className="block min-w-0 text-meta">
          <span className="block truncate text-ink">{x.padre}</span>
          {x.arista && <span className={x.arista === "funcion" || x.arista === "nivel" ? "text-mute" : "text-inkSoft"}>{ARISTA[x.arista].corto}</span>}
        </span>
      ) : (
        <span className="text-meta text-mute">De la entidad</span>
      ),
      personas: <CeldaNumero sub={x.cas ? `${numero(x.cas)} CAS` : undefined}>{numero(x.personas)}</CeldaNumero>,
      senales: x.conSenales ? (
        <span className="inline-flex items-center justify-end gap-1.5 text-meta tabular-nums text-ink">
          {numero(x.conSenales)}
          {x.altas > 0 && <Severidad bandera="alta" />}
        </span>
      ) : (
        <span className="text-meta text-mute">Ninguna</span>
      ),
    },
  }));
  return (
    <TablaFiltrable
      columnas={columnas}
      filas={filas}
      etiqueta="Oficinas de la entidad (toca una para ver a su gente)"
      tam={20}
      nombre="oficinas"
      buscar={{ placeholder: "Buscar una oficina, una sigla o un cargo…", etiqueta: "Buscar entre las oficinas" }}
      filtros={[
        {
          clave: "funcion", etiqueta: "Función", corta: "Función",
          opciones: (Object.keys(FUNCION_OFICINA) as NodoOrganigrama["funcion"][])
            .filter((f) => oficinas.some((x) => x.funcion === f))
            .map((f) => ({ valor: f, etiqueta: FUNCION_OFICINA[f] })),
        },
        {
          clave: "nivel", etiqueta: "Nivel", corta: "Nivel",
          opciones: [1, 2, 3, 4].filter((n) => oficinas.some((x) => x.nivel === n)).map((n) => ({ valor: String(n), etiqueta: NIVEL_OFICINA[n] })),
        },
        {
          clave: "arista", etiqueta: "De quién depende, según", corta: "Dependencia",
          opciones: (["rof", "ley", "planilla", "funcion", "nivel"] as const)
            .filter((t) => oficinas.some((x) => x.arista === t))
            .map((t) => ({ valor: t, etiqueta: ARISTA[t].corto })),
        },
      ]}
      ordenes={[
        { valor: "personas", etiqueta: "Más personas", clave: "personas", dir: "desc" },
        { valor: "planilla", etiqueta: "Más sueldos", clave: "planilla", dir: "desc" },
        { valor: "senales", etiqueta: "Más personas con señales", clave: "senales", dir: "desc" },
        { valor: "nombre", etiqueta: "Por nombre", clave: "nombre", dir: "asc" },
      ]}
    />
  );
}
