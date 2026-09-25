import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Paginacion } from "@/components/ui/Paginacion";
import { Severidad } from "@/components/ui/Severidad";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { Tabla, TablaSkeleton, CeldaNumero, CeldaPrincipal, CeldaTexto, type Columna, type Fila } from "@/components/listado";
import { SelloCotejo } from "@/components/alertas/SelloCotejo";
import { SenalDetalle } from "@/components/alertas/SenalDetalle";
import { ResumenEvidencia } from "@/components/agentes/ListaSenales";
import { TOTAL_FASES } from "@/lib/auditoria";
import { plural, soles } from "@/lib/formato";
import { senalesQueryParams, type Senal, type SenalesQuery } from "@/lib/revision";

/**
 * El índice de señales sobre la plantilla Listado (§14.1): la `Tabla` compartida,
 * con la anatomía de fila de todos los listados —severidad (chip) · la señal y su
 * evidencia · el contrato · el monto · el cotejo · ›— y el detalle en el panel
 * lateral, sin perder la tabla filtrada de atrás.
 */

export const COLUMNAS_SENALES: Columna[] = [
  { clave: "severidad", desde: "md", apilar: true, titulo: "Severidad", ancho: "124px" },
  { clave: "senal", titulo: "Señal y evidencia", ancho: "minmax(0,1.5fr)" },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)", desde: "lg" },
  { clave: "monto", titulo: "Monto", ancho: "112px", alinear: "der", desde: "xl" },
  { clave: "cotejo", titulo: "Cotejo", ancho: "136px", desde: "md" },
];

interface Props {
  senales: Senal[];
  total: number;
  pagina: number;
  tam: number;
  query: SenalesQuery;
  /** El API de alertas no respondió: se dice, no se rellena con nada. */
  fallo: boolean;
  /** Contratos cuyo detalle no respondió — sus señales van sin agente ni cotejo. */
  contratosSinDetalle: number;
}

export function ListaSenales({ senales, total, pagina, tam, query, fallo, contratosSinDetalle }: Props) {
  const filtrado = !!(query.regla || query.severidad || query.entidad || query.agente);
  const pag = (
    <Paginacion
      actual={pagina}
      paginas={Math.max(1, Math.ceil(total / tam))}
      total={total}
      tam={tam}
      navegacion="url"
      hrefBase="/app/hallazgos"
      query={senalesQueryParams(query)}
      cargando={false}
      nombre="señales"
    />
  );

  if (fallo) {
    return (
      <EstadoError titulo="No pudimos leer el índice de señales" accion={<Link href="/app/hallazgos" className={ACCION}>Reintentar</Link>}>
        El servidor no respondió. No mostramos nada en su lugar.
      </EstadoError>
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
