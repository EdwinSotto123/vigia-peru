import { unstable_noStore as noStore } from "next/cache";
import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle, SearchX } from "lucide-react";
import { BarraFiltros, CeldaPrincipal, CeldaTexto, Listado, Tabla, ZonaResultados, type Columna, type Fila } from "@/components/listado";
import { EstadoError } from "@/components/patrones";
import { Paginacion } from "@/components/ui/Paginacion";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { numero } from "@/lib/formato";
import { ETIQUETA_BITACORA, getBitacora, TIPOS_BITACORA, type RenglonBitacora, type TipoBitacora } from "@/lib/transparencia";
import { fechaHora, PieDato } from "./piezas";

/** Renglones por página: la bitácora crece con cada carga y cada refresco. */
const TAM = 25;

const COLUMNAS: Columna[] = [
  { clave: "fecha", titulo: "Fecha (hora de Lima)", ancho: "168px", desde: "md" },
  { clave: "que", titulo: "Qué corrió", ancho: "minmax(0,1.2fr)" },
  { clave: "estado", titulo: "Cómo terminó", ancho: "124px" },
  { clave: "resultado", titulo: "Resultado", ancho: "minmax(0,1.4fr)", desde: "md", apilar: true },
  { clave: "version", titulo: "Versión", ancho: "120px", desde: "xl" },
];

const ESTADO: Record<RenglonBitacora["estado"], { texto: string; clase: string; Icono: typeof CircleCheck }> = {
  ok: { texto: "Bien", clase: "text-inkSoft", Icono: CircleCheck },
  error: { texto: "Con error", clase: "text-crimsonTexto", Icono: CircleAlert },
  en_curso: { texto: "En curso", clase: "text-amberTexto", Icono: LoaderCircle },
  saltado: { texto: "Saltado", clase: "text-mute", Icono: CircleDashed },
};

function fila(r: RenglonBitacora, i: number): Fila {
  const e = ESTADO[r.estado] ?? ESTADO.ok;
  return {
    id: `${r.fecha}-${i}`,
    celdas: {
      fecha: <span className="font-mono text-meta tabular-nums text-inkSoft">{fechaHora(r.fecha)}</span>,
      // En el celular no hay columna de fecha: va bajo el nombre.
      que: <CeldaPrincipal titulo={r.titulo} meta={<span className="md:hidden">{fechaHora(r.fecha)}</span>} />,
      estado: (
        <span className={`inline-flex items-center gap-1.5 text-meta font-medium ${e.clase}`}>
          <e.Icono size={14} className="shrink-0" aria-hidden />
          {e.texto}
        </span>
      ),
      resultado: <CeldaTexto sub={r.nota ?? undefined}>{r.resultado}</CeldaTexto>,
      version: r.version ? <span className="font-mono text-rotulo text-inkSoft">{r.version}</span> : null,
    },
  };
}

/**
 * Pestaña «Bitácora»: el registro con fecha de lo que corrió (validaciones, cargas y evaluaciones del RAG, tandas del
 * masivo, refrescos y cargas de datos), del más reciente al más antiguo, con buscador, filtro por tipo y páginas. El
 * estado vive en la URL (`?seccion=bitacora&tipo=&q=&pagina=`): un filtro se comparte con un enlace.
 */
export async function Bitacora({ tipo: tipoPedido, q: qPedida, pagina }: { tipo?: string; q?: string; pagina: number }) {
  const tipo = (TIPOS_BITACORA as readonly string[]).includes(tipoPedido ?? "") ? (tipoPedido as TipoBitacora) : undefined;
  const q = typeof qPedida === "string" && qPedida.trim().length >= 2 ? qPedida.trim().slice(0, 80) : undefined;
  const datos = await getBitacora({ tipo, q, pagina, tam: TAM });
  if (!datos) noStore();
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / TAM)) : 1;
  const query = { seccion: "bitacora", tipo, q };
  const todos = datos ? datos.porTipo.reduce((t, x) => t + x.n, 0) : null;
  const pag = datos ? (
    <Paginacion actual={pagina} paginas={paginas} total={datos.total} tam={TAM} navegacion="url" hrefBase="/metricas" query={query} cargando={false} nombre="renglones" />
  ) : null;
  return (
    <Listado ruta="/metricas" parametros={query}>
      <div className="space-y-3">
        <BarraFiltros
          busqueda={{ param: "q", placeholder: "Buscar una fuente, una red, un refresco o un resultado…", etiqueta: "Buscar en la bitácora", min: 2 }}
          faceta={{ enBotones: true,
            param: "tipo",
            etiqueta: "Tipo de registro",
            todas: "Todo",
            conteoTodas: todos,
            opciones: TIPOS_BITACORA.map((t) => ({ valor: t, etiqueta: ETIQUETA_BITACORA[t], conteo: datos?.porTipo.find((x) => x.tipo === t)?.n ?? null })),
            nombreEnChip: false,
          }}
        />
        <ZonaResultados>
          {!datos ? (
            <EstadoError titulo="No pudimos leer la bitácora">Es una falla de esta página: los registros siguen guardados.</EstadoError>
          ) : datos.data.length === 0 ? (
            <VacioEnLinea icono={<SearchX size={16} />}>{q ? `Ningún registro coincide con “${q}”.` : "Todavía no hay registros de este tipo."}</VacioEnLinea>
          ) : (
            <section aria-label="Bitácora" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-meta text-inkSoft">
                  <strong className="font-semibold tabular-nums text-ink">{numero(datos.total)}</strong>{" "}
                  {datos.total === 1 ? "registro" : "registros"}
                  {tipo ? ` de ${ETIQUETA_BITACORA[tipo].toLowerCase()}` : ""}
                  {q ? ` con “${q}”` : ""}, del más reciente al más antiguo.
                </p>
                {paginas > 1 && pag}
              </div>
              <Tabla columnas={COLUMNAS} filas={datos.data.map(fila)} etiqueta="Bitácora de corridas, cargas y refrescos, de lo más reciente a lo más antiguo" densidad="compacta" colapsarIguales={false} />
              {paginas > 1 && <div className="flex justify-end">{pag}</div>}
            </section>
          )}
        </ZonaResultados>
        <PieDato
          fecha={datos?.hasta}
          fuente="Corridas de las pruebas de oro (golden_corrida), cargas de normas (norma), tandas del masivo (agente_masivo_tanda), cola de refrescos (refresco_cola, guarda 90 días) y cargas de cada fuente (corridas_fuente)."
        />
      </div>
    </Listado>
  );
}
