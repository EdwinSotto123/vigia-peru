import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Paginacion } from "@/components/ui/Paginacion";
import { Skeleton } from "@/components/ui/Skeleton";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { NivelSenal } from "@/components/alertas/NivelSenal";
import { SelloCotejo, LeyendaCotejo } from "@/components/alertas/SelloCotejo";
import { SenalDetalle } from "@/components/alertas/SenalDetalle";
import { TextoProtegido } from "@/components/alertas/Protegido";
import { TOTAL_FASES } from "@/lib/auditoria";
import { plural, soles } from "@/lib/formato";
import { senalesQueryParams, type Senal, type SenalesQuery } from "@/lib/revision";

/**
 * El índice de señales: una tabla densa, no una rejilla de tarjetas.
 *
 * Son 220 filas homogéneas que el usuario compara en columna —severidad, regla,
 * agente, cotejo— y ese trabajo lo hace una tabla. La tarjeta se reserva a objetos
 * con identidad propia (un contrato, una entidad, un aliado); una señal no la
 * tiene: existe *dentro* de un contrato. La lista vieja de /app/alertas usaba una
 * tarjeta con sombra por fila y un círculo de score de 48 px, y a pesar de eso no
 * mostraba ni la regla en castellano ni quién la había encontrado.
 *
 * Cada fila abre su detalle EN SITIO con <Revelar>: panel al costado, la tabla
 * filtrada sigue detrás. Navegar al dossier destruiría el contexto de la búsqueda,
 * que es justo el trabajo del periodista aquí. El dossier sigue estando, en el pie
 * del panel, para quien sí quiera irse.
 */

interface Props {
  senales: Senal[];
  total: number;
  pagina: number;
  tam: number;
  query: SenalesQuery;
  cotejadas: number;
  /** El API de alertas no respondió: se dice, no se rellena con nada. */
  fallo: boolean;
  /** Contratos cuyo detalle no respondió — sus señales van sin agente ni cotejo. */
  contratosSinDetalle: number;
}

export function ListaSenales({ senales, total, pagina, tam, query, cotejadas, fallo, contratosSinDetalle }: Props) {
  const paginas = Math.max(1, Math.ceil(total / tam));
  const filtrado = !!(query.regla || query.severidad || query.entidad || query.agente);

  const pag = (
    <Paginacion
      actual={pagina}
      paginas={paginas}
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
      <EstadoError
        titulo="No pudimos leer el índice de señales"
        accion={
          <Link href="/app/hallazgos" className={ACCION}>
            Reintentar
          </Link>
        }
      >
        El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
      </EstadoError>
    );
  }

  if (total === 0) {
    return filtrado ? (
      <EstadoVacio
        titulo="Ninguna señal cumple estos filtros"
        accion={
          <Link href="/app/hallazgos" className={ACCION}>
            Quitar todos los filtros
          </Link>
        }
      >
        Los conteos junto a cada opción se calculan sobre los filtros que ya están puestos: esta combinación quedó vacía
        por el último que sumaste.
      </EstadoVacio>
    ) : (
      <EstadoVacio
        titulo="Todavía no hay señales publicadas"
        accion={
          <Link href="/app/contratos" className={ACCION}>
            Ver los contratos sin leer
          </Link>
        }
      >
        Una señal aparece aquí cuando un contrato pasa por los {TOTAL_FASES} agentes, dispara al menos una regla y la
        autoevaluación deja publicar el resultado.
      </EstadoVacio>
    );
  }

  return (
    <div className="space-y-3">
      {/* Una sola barra: la cifra del cotejo, el aviso (una línea + ⓘ) y la paginación. */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <LeyendaCotejo cotejadas={cotejadas} total={total} />
          {contratosSinDetalle > 0 && (
            <span className="inline-flex items-center gap-1 text-[13px] text-mute">
              {plural(contratosSinDetalle, "contrato ya no figura", "contratos ya no figuran")} en el OECE
              <Ayuda titulo="¿Qué pasa con esas señales?">
                Se listan igual, con la norma y la evidencia que se guardaron, pero sin saber qué agente las encontró:
                aparecen como &ldquo;agente no registrado&rdquo;, no con un agente supuesto.
              </Ayuda>
            </span>
          )}
        </div>
        {pag}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <div
          className="hidden grid-cols-[112px_minmax(0,1fr)_150px_24px] items-center gap-3 border-b border-line bg-paperSoft px-4 py-2 text-[11px] font-semibold text-mute md:grid"
          aria-hidden
        >
          <span>Severidad</span>
          <span>Regla, evidencia y contrato</span>
          <span>Cotejo</span>
          <span />
        </div>

        <ul>
          {senales.map((s) => (
            <li key={s.id} className="border-b border-line/70 last:border-b-0">
              <Fila s={s} />
            </li>
          ))}
        </ul>
      </div>

      {pag}
    </div>
  );
}

function Fila({ s }: { s: Senal }) {
  return (
    <Revelar
      titulo={s.etiqueta}
      etiqueta={`Ver la señal ${s.etiqueta} del contrato ${s.ocid}`}
      descripcion={
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span>{s.entidad}</span>
          <span>
            contrato <span className="font-mono">{s.ocid}</span>
          </span>
        </span>
      }
      ancho="lg"
      className="px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft"
      detalle={<SenalDetalle s={s} />}
      pie={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <Link href={`/app/convocatoria/${s.ocid}`} className="font-medium text-granate hover:underline">
            Abrir el dossier completo del contrato
          </Link>
          {s.fuenteUrl && (
            <a
              href={s.fuenteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-mute hover:text-ink hover:underline"
            >
              Ficha oficial en el OECE <ExternalLink size={11} aria-hidden />
            </a>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-1 items-start gap-x-3 gap-y-1.5 md:grid-cols-[112px_minmax(0,1fr)_150px_24px] md:items-center">
        <NivelSenal nivel={s.severidad} className="shrink-0" />

        {/* En el escritorio cada fila ocupa una línea por campo: la densidad es el
            punto. En el celular el recorte a una línea dejaba la evidencia ilegible
            (misma corrección que ya se hizo en ContratosLista), así que ahí respira
            hasta dos líneas. */}
        <div className="min-w-0">
          <p className="line-clamp-2 text-[14.5px] font-semibold leading-snug text-ink md:truncate">{s.etiqueta}</p>
          {s.evidencia && (
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-inkSoft md:truncate">
              <TextoProtegido texto={s.evidencia} nombres={s.personasPrivadas} />
            </p>
          )}
          {/* Cuatro datos que antes iban unidos por tres puntos medios sueltos
              (`<span aria-hidden>·</span>`, o sea texto plano puesto a dibujar
              una raya). Lo que los separa ahora es espacio: gap-x-4 los deja
              distinguirse sin agregar un carácter que no dice nada. */}
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11.5px] text-mute">
            <span className="max-w-[34ch] truncate font-medium text-inkSoft">{s.entidad}</span>
            <span>{s.agenteLabel ?? "agente no registrado"}</span>
            <span className="font-mono tabular-nums">{s.montoSoles > 0 ? soles(s.montoSoles) : "Monto sin dato"}</span>
            <span className="font-mono tabular-nums">{s.ocid}</span>
          </p>
        </div>

        <div className="md:justify-self-start">
          <SelloCotejo verificada={s.verificada} />
        </div>

        <ChevronRight size={16} className="hidden shrink-0 text-mute md:block" aria-hidden />
      </div>
    </Revelar>
  );
}

/** La acción de un estado vacío o de error: un enlace con forma de píldora secundaria. */
const ACCION =
  "inline-flex min-h-[36px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[13px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";

/**
 * Lo que se ve mientras el servidor cruza cada señal con su contrato para saber qué
 * agente la produjo y si se cotejó. Tiene la forma exacta de la tabla que va a
 * llegar —mismas columnas, mismas alturas— así que nada salta cuando el contenido
 * entra. Skeleton, no spinner.
 */
export function ListaSenalesSkeleton({ filas = 10 }: { filas?: number }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-full max-w-[72ch]" />
      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <div className="border-b border-line bg-paperSoft px-4 py-2.5">
          <Skeleton className="h-3 w-40" />
        </div>
        <ul>
          {Array.from({ length: filas }).map((_, i) => (
            <li
              key={i}
              className="grid grid-cols-1 items-center gap-x-3 gap-y-2 border-b border-line/70 px-4 py-3 last:border-b-0 md:grid-cols-[112px_minmax(0,1fr)_150px_24px]"
            >
              <Skeleton className="h-3.5 w-20" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <Skeleton className="h-5 w-24 rounded-full" />
              <span />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
