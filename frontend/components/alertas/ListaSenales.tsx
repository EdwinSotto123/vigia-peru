import { rutaContrato } from "@/lib/rutas";
import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Flag } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { Dato } from "@/components/ui/Dato";
import { Partes, Separador } from "@/components/ui/Partes";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { Tabla, TablaSkeleton, CeldaPrincipal, type Columna, type Fila, type GrupoFilas } from "@/components/listado";
import { Llamita } from "@/components/marca/Llamita";
import { SelloCotejo } from "@/components/alertas/SelloCotejo";
import { SenalDetalle } from "@/components/alertas/SenalDetalle";
import { ResumenEvidencia } from "@/components/agentes/ListaSenales";
import { limpiarObjeto } from "@/components/contratos/recortar";
import { TOTAL_FASES } from "@/lib/auditoria";
import { fechaCorta, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { hayFiltrosSenales, type Senal, type SenalesQuery } from "@/lib/revision";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";

/**
 * El índice de señales sobre la plantilla Listado (§14.1): la `Tabla` compartida y el detalle en el panel lateral, sin
 * perder la tabla filtrada de atrás.
 *
 * Las señales van agrupadas por su contrato (`Tabla grupos`): el rótulo del grupo dice qué se compró, la entidad, la
 * región, cuántas señales tiene el contrato y el valor del contrato; cada fila, una señal —severidad (chip) · la señal y
 * su evidencia · el cotejo · ›—. Antes cada fila repetía el mismo contrato, identificado sólo por su código (699 señales
 * en 252 contratos), y en el celular la señal quedaba sin su contrato. Se agrupan las señales SEGUIDAS del mismo contrato
 * dentro de la página: el orden y la paginación siguen siendo los del API (por señal), así que un contrato cuyas señales
 * caen en dos tramos (las altas al principio, las medias después) sale en dos grupos.
 *
 * El panel (`SenalDetalle`) es un componente cliente: cada fila le pasa su señal como datos y el panel se arma al
 * abrirlo, no en el servidor para las 25 filas.
 *
 * La paginación la arma la página (`paginador` arriba, `paginadorAbajo` con `subir`): por cursor con `/senales`, por
 * número de página con el respaldo de la API vieja.
 */

export const COLUMNAS_SENALES: Columna[] = [
  { clave: "severidad", desde: "md", apilar: true, titulo: "Severidad", ancho: "124px" },
  { clave: "senal", titulo: "Señal y evidencia", ancho: "minmax(0,1fr)" },
  // «No se pudo cotejar» entra entero; en el celular el sello va bajo la señal, junto a la severidad.
  { clave: "cotejo", titulo: "Cotejo", ancho: "152px", desde: "md", apilar: true },
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
  /** La paginación ya armada (datos y JSX, nunca una función): va arriba de la tabla. */
  paginador: ReactNode;
  /** La de abajo, con `subir` (lleva al inicio de los resultados). Sin ella, se repite la de arriba. */
  paginadorAbajo?: ReactNode;
  /** Una página por cursor que ya no trae filas (el índice cambió): se ofrece volver al inicio. */
  paginaVacia?: boolean;
  /** Adónde lleva «Reintentar»: esta misma vista, con sus filtros y su página. */
  reintentar?: string;
}

const RUTA = "/app/hallazgos";

export function ListaSenales({ senales, total, query, fallo, contratosSinDetalle, paginador, paginadorAbajo, paginaVacia = false, reintentar = RUTA }: Props) {
  const filtrado = hayFiltrosSenales(query);

  if (fallo) {
    return (
      <EstadoError
        titulo="No pudimos leer el índice de señales"
        // `<a>` y no `<Link>`: reintentar es pedir la página otra vez al servidor, con los mismos filtros.
        accion={<a href={reintentar} className={ACCION}>Reintentar</a>}
      >
        El servidor no respondió. No mostramos nada en su lugar: vuelve a intentarlo en unos segundos.
      </EstadoError>
    );
  }
  if (paginaVacia && total > 0) {
    return (
      <EstadoVacio titulo="Esta página de la lista ya no está disponible" compacto accion={<Link href={RUTA} className={ACCION} prefetch={false}>Ir al inicio de la lista</Link>}>
        Se publicaron o retiraron señales desde que se abrió. La lista vuelve a empezar desde la primera página.
      </EstadoVacio>
    );
  }
  if (total === 0) {
    return filtrado ? (
      <EstadoVacio titulo="Ninguna señal cumple estos filtros" compacto accion={<Link href={RUTA} className={ACCION}>Quitar los filtros</Link>}>
        Prueba quitando el último filtro que agregaste.
      </EstadoVacio>
    ) : (
      <EstadoVacio titulo="Todavía no hay señales publicadas" accion={<Link href="/app/contratos" className={ACCION}>Ver los contratos</Link>}>
        Aparecen cuando un contrato pasa por los {TOTAL_FASES} agentes y la autoevaluación deja publicar el resultado.
      </EstadoVacio>
    );
  }

  const grupos: GrupoFilas[] = agrupar(senales).map((g, i) => ({
    // El mismo contrato puede salir en dos tramos de la página: la clave lleva su lugar.
    clave: `${g.clave}-${i}`,
    titulo: <ContratoDelGrupo s={g.senales[0]} enGrupo={g.senales.length} />,
    filas: g.senales.map(filaDe),
  }));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{paginador}</div>
      <Tabla columnas={COLUMNAS_SENALES} grupos={grupos} etiqueta="Señales publicadas" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {contratosSinDetalle > 0 ? (
          <p className="inline-flex items-center gap-1 text-meta text-mute">
            {plural(contratosSinDetalle, "contrato ya no figura", "contratos ya no figuran")} en el OECE
            <Ayuda titulo="¿Qué pasa con esas señales?">
              Se listan igual, con la norma y la evidencia que se guardaron, pero sin saber qué agente las encontró:
              aparecen como &ldquo;agente no registrado&rdquo;, no con un agente supuesto.
            </Ayuda>
          </p>
        ) : (
          <span />
        )}
        {paginadorAbajo ?? paginador}
      </div>
    </div>
  );
}

/** Las señales seguidas del mismo contrato, juntas (en el orden en que llegan: el del API). */
function agrupar(senales: Senal[]): { clave: string; senales: Senal[] }[] {
  const grupos: { clave: string; senales: Senal[] }[] = [];
  for (const s of senales) {
    const clave = s.alertaCodigo || s.ocid || s.id;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.senales.push(s);
    else grupos.push({ clave, senales: [s] });
  }
  return grupos;
}

const conDato = (t: string | null | undefined) => (t && t !== "Sin dato" ? t : null);

/**
 * El rótulo de un grupo: el contrato de esas señales. Qué se compró (una línea, entero en el `title`), y debajo la
 * entidad, la región, cuántas señales tiene el contrato (si son más que las del grupo: las demás son de otra severidad o
 * quedaron fuera por los filtros), la buena pro y el código. «Valor del contrato» con su nombre (antes, una columna
 * «Monto» que no decía de qué era): a la derecha en escritorio, al inicio de la segunda línea en el celular.
 */
function ContratoDelGrupo({ s, enGrupo }: { s: Senal; enGrupo: number }) {
  const objeto = conDato(s.objeto) ? oracion(limpiarObjeto(s.objeto)) : "Contrato sin objeto registrado";
  const entidad = conDato(s.entidad);
  const region = conDato(s.region);
  const n = s.senalesDelContrato;
  const valor = s.montoSoles > 0 ? s.montoSoles : null;
  return (
    <span className="flex min-w-0 items-baseline justify-between gap-x-4">
      <span className="min-w-0 flex-1">
        {/* El tamaño y el peso, los del rótulo de grupo del kit (h3): sobre las señales, que van en `text-dato`. */}
        <span className="block truncate text-ink" title={objeto}>
          {objeto}
        </span>
        <span className="mt-0.5 block truncate text-meta font-normal text-mute">
          <span className="sm:hidden">
            Valor <span className="font-mono tabular-nums text-ink">{valor != null ? solesCompacto(valor) : "Sin dato"}</span>
            <Separador />
          </span>
          <Partes
            partes={[
              entidad && <Dato key="e" tipo="entidad">{tituloNatural(entidad)}</Dato>,
              region && <Dato key="r" tipo="lugar">{tituloNatural(region)}</Dato>,
              n != null && n > enGrupo && (
                <Dato key="n" icono={Flag} nombre="Señales del contrato">
                  {plural(n, "señal", "señales")} en total
                </Dato>
              ),
              s.fechaBuenaPro && (
                <Dato key="f" tipo="fecha" nombre="Buena pro">
                  Buena pro {fechaCorta(s.fechaBuenaPro.slice(0, 10))}
                </Dato>
              ),
              s.ocid && (
                <Dato key="o" tipo="codigo" nombre="Contrato" mono>
                  {s.ocid}
                </Dato>
              ),
            ]}
          />
        </span>
      </span>
      <span className="hidden shrink-0 text-meta font-normal text-mute sm:inline">
        Valor del contrato <span className="font-mono tabular-nums text-ink">{valor != null ? soles(valor) : "Sin dato"}</span>
      </span>
    </span>
  );
}

function filaDe(s: Senal): Fila {
  const entidad = conDato(s.entidad);
  return {
    id: s.id,
    celdas: {
      severidad: <Severidad bandera={s.severidad} />,
      senal: (
        <CeldaPrincipal
          titulo={s.etiqueta}
          meta={s.evidencia ? <ResumenEvidencia texto={s.evidencia} nombres={s.personasPrivadas} /> : "Sin evidencia registrada"}
        />
      ),
      cotejo: <SelloCotejo verificada={s.verificada} />,
    },
    detalle: {
      titulo: s.etiqueta,
      etiqueta: `Ver la señal ${s.etiqueta} del contrato ${s.ocid}`,
      descripcion: (
        <Partes
          partes={[
            entidad && <Dato key="e" tipo="entidad">{tituloNatural(entidad)}</Dato>,
            <Dato key="o" tipo="codigo" nombre="Contrato" mono>{s.ocid}</Dato>,
          ]}
        />
      ),
      contenido: <SenalDetalle s={s} />,
      pie: (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
          <Link href={rutaContrato(s.ocid, "dictamen")} className="font-medium text-granate hover:underline">
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
  };
}

const ACCION = CLASE_ACCION_LISTA;

export function ListaSenalesSkeleton() {
  return <TablaSkeleton columnas={COLUMNAS_SENALES} filas={10} />;
}

/**
 * La espera de la lista (§10.5): la rejilla en esqueleto y, en el renglón del paginador, qué se espera con la llamita
 * caminando, que aparece pasado 1 s. La demora es de CSS: sin JS ni movimiento, igual se ve.
 */
export function ListaSenalesCargando() {
  return (
    <div className="space-y-3" role="status" aria-busy>
      <p className="flex min-h-[44px] items-center gap-2.5 text-dato text-mute animate-[fadeIn_200ms_ease-out_1s_both] sm:min-h-[36px]">
        <Llamita caminando className="w-6 text-granate/70" />
        Cargando las señales…
      </p>
      <ListaSenalesSkeleton />
    </div>
  );
}
