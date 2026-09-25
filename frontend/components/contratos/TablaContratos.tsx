"use client";

/**
 * Los resultados de /app/contratos sobre la plantilla Listado (DESIGN_SYSTEM.md §14.1):
 * paginación arriba a la derecha y abajo, la `Tabla` del kit y los estados vacío y
 * error. Anatomía de fila, la de todos los listados:
 *
 *   estado (chip) · objeto + entidad y zona · tipo y etapa · valor referencial · convocada · ›
 *
 * La fila abre el resumen del contrato en el panel lateral (`detalle`) y no navega: el
 * panel dice su estado de lectura, qué falta y cómo financiarlo con los datos que la
 * fila ya trae, sin pedir el dossier (pesado) de un contrato que casi siempre está sin
 * leer. El dossier queda en el pie del panel. Una sola acción por fila.
 *
 * Componente cliente porque usa `estadoLecturaDe` (módulo cliente): llamada desde un
 * server component sería una referencia, no una función. `Paginacion` recibe datos
 * (`hrefBase`, `query`, `paramPagina="page"`, el parámetro del API de contratos).
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Paginacion } from "@/components/ui/Paginacion";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, type Columna, type Fila, type Parametros } from "@/components/listado";
import { numero, plural } from "@/lib/formato";
import { severidadDeContrato } from "@/lib/severidad";
import { etapaLabel, formatFecha, formatMonto, tipoLabel, type ContratoResumen, type ContratosPagina } from "@/lib/contratos";
import { DetalleContrato } from "./DetalleContrato";
import { EstadoContratoChip, estadoLecturaDe } from "./estadoLectura";
import { recortar } from "./recortar";

const RUTA = "/app/contratos";

const COLUMNAS: Columna[] = [
  {
    clave: "estado", desde: "md", apilar: true,
    titulo: "Estado",
    ancho: "136px",
    // Reemplaza a las dos leyendas que iban al pie de la tabla vieja: el vocabulario, a un clic.
    ayuda: (
      <Ayuda titulo="¿Qué dice el estado?">
        <span className="block">
          Si el contrato ya se leyó, su peso del riesgo: alto, medio o bajo según el puntaje de sus señales; «Sin
          señales» si no se encontró ninguna; «En revisión» mientras una persona revisa el dictamen.
        </span>
        <span className="mt-2 block">
          Si todavía no se leyó, en qué punto está: «En cola» se puede financiar hoy; «Docs listos» tiene el expediente
          descargado y su análisis en preparación; «Sin leer», ninguna de las dos.
        </span>
      </Ayuda>
    ),
  },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1.6fr)" },
  { clave: "tipo", titulo: "Tipo y etapa", ancho: "minmax(0,0.6fr)", desde: "xl" },
  { clave: "valor", titulo: "Valor referencial", ancho: "128px", alinear: "der", desde: "md" },
  { clave: "convocada", titulo: "Convocada", ancho: "96px", desde: "lg" },
];

export function TablaContratos({
  pagina,
  parametros,
  actual,
  tam,
}: {
  /** La página que trajo el servidor; `null` = el API no respondió. */
  pagina: ContratosPagina | null;
  /** Los filtros actuales de la URL (sin página), para armar los enlaces de página. */
  parametros: Parametros;
  actual: number;
  tam: number;
}) {
  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, v);
    if (n > 1) q.set("page", String(n));
    const qs = q.toString();
    return qs ? `${RUTA}?${qs}` : RUTA;
  };
  // El orden no recorta la lista: sólo los demás parámetros cuentan como filtro.
  const filtrado = Object.entries(parametros).some(([k, v]) => k !== "orden" && !!v);

  if (!pagina) {
    return (
      <EstadoError
        titulo="No pudimos cargar la lista de contratos"
        // `<a>` y no `<Link>`: reintentar es pedir la página de nuevo al servidor, con los mismos filtros.
        accion={<a href={href(actual)} className={ACCION}>Reintentar</a>}
      >
        Suele ser momentáneo: vuelve a intentarlo en unos segundos.
      </EstadoError>
    );
  }

  const { total, data } = pagina;
  const paginas = Math.max(1, Math.ceil(total / tam));

  if (total === 0) {
    return filtrado ? (
      <EstadoVacio titulo="Ningún contrato cumple todos los filtros a la vez" compacto accion={<Link href={RUTA} className={ACCION}>Quitar los filtros</Link>}>
        Los filtros se suman: quita el más restrictivo y la lista se vuelve a llenar.
      </EstadoVacio>
    ) : (
      <EstadoVacio titulo="Todavía no hay contratos en la base">
        Las convocatorias del SEACE aparecen aquí cuando entran a la base de Vigía.
      </EstadoVacio>
    );
  }

  // ?page=999 con 368 páginas: hay contratos, sólo que no tantos. "No hay contratos" sería falso.
  if (data.length === 0) {
    return (
      <EstadoVacio
        compacto
        titulo={`Esta página no existe: la lista llega hasta la página ${numero(paginas)}`}
        accion={<Link href={href(paginas)} className={ACCION}>Ir a la última página</Link>}
      >
        Hay {plural(total, "contrato", "contratos")}
        {filtrado ? " con estos filtros" : ""}, {tam} por página.
      </EstadoVacio>
    );
  }

  const pag = (
    <Paginacion actual={pagina.page || actual} paginas={paginas} total={total} tam={tam} navegacion="url" hrefBase={RUTA} query={parametros} paramPagina="page" cargando={false} nombre="contratos" />
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag}</div>
      <Tabla columnas={COLUMNAS} filas={data.map(filaDe)} etiqueta="Contratos" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}

function filaDe(c: ContratoResumen): Fila {
  const titulo = c.titulo ?? "Sin objeto registrado";
  const entidad = c.entidad ?? "Entidad no identificada";
  const monto = formatMonto(c.montoPen, c.moneda);
  // Lo mismo que dice el chip: el peso del riesgo si ya se leyó, si no, el estado de lectura.
  const estado = c.enRevision || c.score != null ? severidadDeContrato(c).etiqueta : estadoLecturaDe(c).label;
  // El peso del riesgo nunca va sin las señales que lo explican (§10.4): la meta dice cuántas hay.
  const nSenales = c.enRevision ? 0 : c.banderas ?? 0;
  const meta = [nSenales > 0 ? plural(nSenales, "señal", "señales") : null, entidad, c.zona].filter(Boolean).join(" · ");
  return {
    id: c.ocid,
    celdas: {
      estado: <EstadoContratoChip c={c} />,
      // Recortado en una palabra: el objeto entero va en el panel (títulos de 300 caracteres en el DOM).
      contrato: <CeldaPrincipal titulo={recortar(titulo, 160)} meta={meta} />,
      tipo: <CeldaTexto sub={etapaLabel(c.etapa) ?? undefined}>{tipoLabel(c.tipo) ?? "Sin clasificar"}</CeldaTexto>,
      valor: <CeldaNumero>{c.montoPen ? monto : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      convocada: <CeldaFecha fecha={c.fecha?.slice(0, 10)} />,
    },
    detalle: {
      titulo,
      etiqueta: [
        `Ver el resumen de ${titulo}`,
        entidad,
        c.montoPen ? monto : "sin valor referencial publicado",
        `estado: ${estado}`,
      ].join(". "),
      descripcion: (
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono">{c.codigo}</span>
          {c.fecha && <span className="tabular-nums">Convocada el {formatFecha(c.fecha)}</span>}
          {c.zona && <span>{c.zona}</span>}
        </span>
      ),
      contenido: <DetalleContrato c={c} />,
      pie: (
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-mute">Fuente: SEACE/OECE, vía la API OCDS</span>
          <Link
            href={`${RUTA}/${encodeURIComponent(c.ocid)}`}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-granate px-4 py-1.5 text-[13px] font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
          >
            Ver el dossier completo <ArrowRight size={14} aria-hidden />
          </Link>
        </span>
      ),
    },
  };
}

/** La acción de un estado vacío o de error: la píldora secundaria de los listados. */
const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";
