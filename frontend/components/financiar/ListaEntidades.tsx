import Link from "next/link";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Paginacion } from "@/components/ui/Paginacion";
import { etiquetaTipoEntidad, tipoEntidad } from "@/lib/entidad-tipo";
import { alcanceCorto, type AlcanceProcesamiento, type EntidadFinanciable, type EntidadesFinanciables } from "@/lib/financiamiento";
import { numero, soles } from "@/lib/formato";
import { NombreEntidad, esRucPersona } from "./NombreEntidad";

/**
 * La vista "Por entidad" de /app/financiar (§14.1): entidades con contratos en cola, con la
 * anatomía de todo listado:
 *   entidad (nombre + tipo y región) · en cola · listos para leerse · con dictamen · costo · ›
 * Cada fila lleva a /app/financiar/entidad/[ruc], donde se financia.
 *
 * La tabla vive en la columna de la izquierda (al lado de los últimos aportes): las columnas
 * entran por el ancho de la TABLA (`medida="contenedor"`), no de la pantalla.
 *
 * Server-safe: todo llega como datos planos desde page.tsx.
 */

/** Entidades por página (el API acepta hasta 50). */
export const TAM_ENTIDADES = 25;

/** La acción de un estado vacío o de error: la misma píldora secundaria de todos los listados. */
const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";

const hrefVista = (q?: string, pagina?: number) => {
  const p = new URLSearchParams({ por: "entidad" });
  if (q) p.set("q", q);
  if (pagina && pagina > 1) p.set("pagina", String(pagina));
  return `/app/financiar?${p.toString()}`;
};

function columnas(precioPen: number | null, alcance: AlcanceProcesamiento | null | undefined): Columna[] {
  return [
    { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)" },
    {
      clave: "cola",
      titulo: "En cola",
      ancho: "84px",
      alinear: "der",
      ayuda: (
        <Ayuda titulo="¿Qué es “en cola”?">
          Los contratos de la entidad que se pueden auditar hoy: esperan financiamiento para leerse. Hoy entran solo{" "}
          {alcanceCorto(alcance)}.
        </Ayuda>
      ),
    },
    {
      clave: "listos",
      titulo: "Listos",
      ancho: "84px",
      alinear: "der",
      desde: "md",
      ayuda: (
        <Ayuda titulo="¿Qué es “listos”?">
          De los que están en cola, los que ya tienen sus documentos descargados: se leen apenas se financian.
        </Ayuda>
      ),
    },
    {
      clave: "dictamen",
      titulo: "Con dictamen",
      ancho: "112px",
      alinear: "der",
      desde: "lg",
      ayuda: (
        <Ayuda titulo="¿Qué cuenta “con dictamen”?">
          Contratos de la entidad leídos y publicados, con o sin señales, sobre todos los que tiene registrados.
        </Ayuda>
      ),
    },
    {
      clave: "costo",
      titulo: "Costo",
      ancho: "104px",
      alinear: "der",
      desde: "xl",
      ayuda: (
        <Ayuda titulo="¿Qué es el costo?">
          Lo que cuesta leer todos sus contratos en cola{precioPen != null ? `, a ${soles(precioPen)} cada uno` : ""}.
        </Ayuda>
      ),
    },
  ];
}

function fila(e: EntidadFinanciable, precioPen: number | null): Fila {
  // El tipo se infiere del nombre oficial cuando el API no lo declara; si no se puede, no se dice.
  const t = tipoEntidad(e.tipo, e.nombre);
  const persona = esRucPersona(e.ruc);
  return {
    id: e.ruc,
    href: `/app/financiar/entidad/${e.ruc}`,
    celdas: {
      entidad: (
        <CeldaPrincipal
          titulo={<NombreEntidad ruc={e.ruc} nombre={e.nombre} />}
          textoCompleto={persona ? undefined : e.nombre}
          meta={[t ? etiquetaTipoEntidad(t, e.nombre) : null, e.region]}
        />
      ),
      cola: <CeldaNumero>{numero(e.enCola)}</CeldaNumero>,
      listos: <CeldaNumero>{numero(e.conDocumentos)}</CeldaNumero>,
      dictamen: <CeldaNumero sub={`de ${numero(e.contratos)}`}>{numero(e.auditados)}</CeldaNumero>,
      costo: <CeldaNumero>{soles(precioPen != null ? e.enCola * precioPen : null)}</CeldaNumero>,
    },
  };
}

/** Lo que va en la zona de resultados: los cinco estados de §10.5, y la tabla. */
export function ResultadosEntidades({
  datos,
  q,
  pagina,
  precioPen,
  alcance,
}: {
  /** La página del API; `null` = no respondió. */
  datos: EntidadesFinanciables | null;
  q: string;
  pagina: number;
  precioPen: number | null;
  alcance: AlcanceProcesamiento | null | undefined;
}) {
  if (!datos) {
    return (
      <EstadoError titulo="No pudimos leer las entidades" accion={<Link href={hrefVista(q, pagina)} className={ACCION}>Reintentar</Link>}>
        El servidor no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }
  const { total, items } = datos;
  const paginas = Math.max(1, Math.ceil(total / TAM_ENTIDADES));
  if (items.length === 0 && total > 0) {
    return (
      <EstadoVacio compacto titulo="Esta página no tiene entidades" accion={<Link href={hrefVista(q)} className={ACCION}>Ir a la página 1</Link>}>
        La lista llega hasta la página {numero(paginas)}.
      </EstadoVacio>
    );
  }
  if (items.length === 0 && !q) {
    return (
      <EstadoVacio titulo="Ninguna entidad tiene contratos en cola">
        Aparecen aquí cuando el OECE publica contratos que entran a la cola.
      </EstadoVacio>
    );
  }
  if (items.length === 0) {
    return (
      <EstadoVacio
        compacto
        titulo={`Ninguna entidad coincide con “${q}”`}
        accion={<Link href={hrefVista()} className={ACCION}>Quitar la búsqueda</Link>}
      >
        Prueba con otra palabra de su nombre oficial o con su RUC de 11 dígitos.
      </EstadoVacio>
    );
  }
  const pag = (
    <Paginacion
      actual={pagina}
      paginas={paginas}
      total={total}
      tam={TAM_ENTIDADES}
      navegacion="url"
      hrefBase="/app/financiar"
      query={{ por: "entidad", q: q || undefined }}
      cargando={false}
      nombre="entidades"
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag}</div>
      <Tabla
        columnas={columnas(precioPen, alcance)}
        filas={items.map((e) => fila(e, precioPen))}
        etiqueta={q ? `Entidades que coinciden con “${q}”` : "Entidades con contratos en cola"}
        medida="contenedor"
      />
      {paginas > 1 && <div className="flex justify-end">{pag}</div>}
    </div>
  );
}
