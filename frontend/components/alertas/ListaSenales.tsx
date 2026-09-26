import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { Tabla, TablaSkeleton, CeldaNumero, CeldaPrincipal, CeldaTexto, type Columna, type Fila } from "@/components/listado";
import { SelloCotejo } from "@/components/alertas/SelloCotejo";
import { SenalDetalle } from "@/components/alertas/SenalDetalle";
import { ResumenEvidencia } from "@/components/agentes/ListaSenales";
import { TOTAL_FASES } from "@/lib/auditoria";
import { plural, soles } from "@/lib/formato";
import { hayFiltrosSenales, type Senal, type SenalesQuery } from "@/lib/revision";

/**
 * El índice de señales sobre la plantilla Listado (§14.1): la `Tabla` compartida,
 * con la anatomía de fila de todos los listados —severidad (chip) · la señal y su
 * evidencia · el contrato · el monto · el cotejo · ›— y el detalle en el panel
 * lateral, sin perder la tabla filtrada de atrás.
 *
 * El panel (`SenalDetalle`) es un componente cliente: cada fila le pasa su señal como
 * datos y el panel se arma al abrirlo, no en el servidor para las 25 filas.
 *
 * La paginación la arma la página (`paginador`): por cursor con `/senales`, por número
 * de página con el respaldo de la API vieja.
 */

export const COLUMNAS_SENALES: Columna[] = [
  { clave: "severidad", desde: "md", apilar: true, titulo: "Severidad", ancho: "124px" },
  { clave: "senal", titulo: "Señal y evidencia", ancho: "minmax(0,1.5fr)" },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)", desde: "lg" },
  { clave: "monto", titulo: "Monto", ancho: "112px", alinear: "der", desde: "xl" },
  { clave: "cotejo", titulo: "Cotejo", ancho: "136px", desde: "md" },
];

interface Props {
  /** Las señales de ESTA página. */
  senales: Senal[];
  /** Cuántas cumplen los filtros (conteo del API o del respaldo). */
  total: number;
  query: SenalesQuery;
  /** El API de alertas no respondió: se dice, no se rellena con nada. */
  fallo: boolean;
  /** Contratos cuyo detalle no respondió — sus señales van sin agente ni cotejo (sólo el respaldo). */
  contratosSinDetalle: number;
  /** La paginación ya armada (datos y JSX, nunca una función): va arriba y abajo de la tabla. */
  paginador: ReactNode;
  /** Una página por cursor que ya no trae filas (el índice cambió): se ofrece volver al inicio. */
  paginaVacia?: boolean;
}

export function ListaSenales({ senales, total, query, fallo, contratosSinDetalle, paginador, paginaVacia = false }: Props) {
  const filtrado = hayFiltrosSenales(query);
  const pag = paginador;

  if (fallo) {
    return (
      <EstadoError titulo="No pudimos leer el índice de señales" accion={<Link href="/app/hallazgos" className={ACCION}>Reintentar</Link>}>
        El servidor no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }
  if (paginaVacia && total > 0) {
    return (
      <EstadoVacio titulo="Esta página de la lista ya no está disponible" compacto accion={<Link href="/app/hallazgos" className={ACCION} prefetch={false}>Ir al inicio de la lista</Link>}>
        Se publicaron o retiraron señales desde que se abrió. La lista vuelve a empezar desde la primera página.
      </EstadoVacio>
    );
  }
  if (total === 0) {
    return filtrado ? (
      <EstadoVacio titulo="Ninguna señal cumple estos filtros" compacto accion={<Link href="/app/hallazgos" className={ACCION}>Quitar los filtros</Link>}>
        Prueba quitando el último filtro que agregaste.
      </EstadoVacio>
    ) : (
      <EstadoVacio titulo="Todavía no hay señales publicadas" accion={<Link href="/app/contratos" className={ACCION}>Ver los contratos</Link>}>
        Aparecen cuando un contrato pasa por los {TOTAL_FASES} agentes y la autoevaluación deja publicar el resultado.
      </EstadoVacio>
    );
  }

  const filas: Fila[] = senales.map((s) => ({
    id: s.id,
    celdas: {
      severidad: <Severidad bandera={s.severidad} />,
      senal: (
        <CeldaPrincipal
          titulo={s.etiqueta}
          meta={s.evidencia ? <ResumenEvidencia texto={s.evidencia} nombres={s.personasPrivadas} /> : "Sin evidencia registrada"}
        />
      ),
      contrato: <CeldaTexto sub={<span className="font-mono">{s.ocid}</span>}>{s.entidad}</CeldaTexto>,
      monto: <CeldaNumero>{s.montoSoles > 0 ? soles(s.montoSoles) : "Sin dato"}</CeldaNumero>,
      cotejo: <SelloCotejo verificada={s.verificada} />,
    },
    detalle: {
      titulo: s.etiqueta,
      etiqueta: `Ver la señal ${s.etiqueta} del contrato ${s.ocid}`,
      descripcion: (
        <span className="flex flex-wrap gap-x-3">
          <span>{s.entidad}</span>
          <span className="font-mono">{s.ocid}</span>
        </span>
      ),
      contenido: <SenalDetalle s={s} />,
      pie: (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <Link href={`/app/convocatoria/${s.ocid}`} className="font-medium text-granate hover:underline">
            Abrir el informe del contrato
          </Link>
          {s.fuenteUrl && (
            <a href={s.fuenteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mute hover:text-ink hover:underline">
              Ficha oficial en el OECE <ExternalLink size={11} aria-hidden />
            </a>
          )}
        </span>
      ),
    },
  }));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag}</div>
      <Tabla columnas={COLUMNAS_SENALES} filas={filas} etiqueta="Señales publicadas" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {contratosSinDetalle > 0 ? (
          <p className="inline-flex items-center gap-1 text-[12.5px] text-mute">
            {plural(contratosSinDetalle, "contrato ya no figura", "contratos ya no figuran")} en el OECE
            <Ayuda titulo="¿Qué pasa con esas señales?">
              Se listan igual, con la norma y la evidencia que se guardaron, pero sin saber qué agente las encontró:
              aparecen como &ldquo;agente no registrado&rdquo;, no con un agente supuesto.
            </Ayuda>
          </p>
        ) : (
          <span />
        )}
        {pag}
      </div>
    </div>
  );
}

/** La acción de un estado vacío o de error: un enlace con forma de píldora secundaria. */
const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";

export function ListaSenalesSkeleton() {
  return <TablaSkeleton columnas={COLUMNAS_SENALES} filas={10} />;
}
