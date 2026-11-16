"use client";

/**
 * Las señales de un contrato, en la pestaña Señales del informe (DESIGN_SYSTEM.md §14.2).
 *
 * La lista es la `Tabla` del kit, con la anatomía de fila de todos los listados —severidad
 * (chip) · la señal y su evidencia en una línea · cotejo · ›— y el detalle completo en el
 * panel lateral (evidencia, texto citado, norma, opinión OECE, agente y fuente). Antes era una
 * lista propia con su barra de colores, su chip de filtro por severidad y su propio contador.
 *
 * Alrededor, lo que hace único a este producto, plegado para no tapar la evidencia:
 *   · "Quién encontró cada señal": los carriles de agentes (o su eje de tiempo real, si el
 *     análisis lo guardó); cada agente filtra la tabla;
 *   · la matriz de reglas evaluadas, con las que NO dispararon (`Seccion` plegable, al final).
 *
 * Privacidad: la línea de evidencia de cada fila va por `ResumenEvidencia` (DNI y apellidos
 * privados tapados sin revelar); el vidrio revelable está en el panel.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { EstadoProc, FasesMap } from "@/lib/auditoria";
import { Severidad } from "@/components/ui/Severidad";
import { Ayuda, Seccion } from "@/components/patrones";
import { CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { SelloCotejo } from "@/components/alertas/SelloCotejo";
import type { NombreConocido } from "@/components/Redact";
import { cn } from "@/lib/utils";
import { PASOS, nombreDeAgente, pasoDeClave, pasosDelPerfil, TOTAL_PASOS, type PasoPipeline } from "./catalogo";
import { CarrilesAgentes } from "./CarrilesAgentes";
import { EjeAgentes, rangoDelAnalisis, ventanaDe } from "./EjeAgentes";
import { FiltrosSenales, type GravedadFiltro } from "./FiltrosSenales";
import { DetalleSenal, ResumenEvidencia, evidenciaRecortada, sinRepetidas } from "./ListaSenales";
import { MatrizReglas } from "./MatrizReglas";
import { LeyendaCotejo } from "./SelloVerificada";
import { agruparPorAgente, contar, ORDEN_SEVERIDAD, SIN_AGENTE, type SenalAgente } from "./senales";
import { descripcionDeRegla, etiquetaDeRegla, useReglasPerfil } from "./useReglasPerfil";

interface Props {
  senales: SenalAgente[];
  /** Ventanas reales por fase. Sin esto NO se dibuja un eje de tiempo inventado. */
  fases?: FasesMap | null;
  estadoProc?: EstadoProc;
  /** Reloj del cliente; 0 en el render del servidor. */
  ahora?: number;
  perfil?: string | null;
  reglasDisparadas?: string[] | null;
  reglasEvaluadas?: number | null;
  titulo?: string;
  /** Personas privadas del dossier: su apellido va tapado también en la línea de evidencia de cada fila. */
  nombresPrivados?: NombreConocido[];
  /** Lo que va entre la tabla y la matriz de reglas (las señales de precio no verificables). */
  anexo?: React.ReactNode;
  /**
   * El tema de cada regla (la competencia, el precio, el proveedor…): con él la tabla se filtra por tema y cada fila lo
   * dice. Lo da quien conoce el relato del dictamen (convocatoria/relato/historia); sin él, sólo se filtra por gravedad.
   */
  temaDe?: (regla: string) => { clave: string; titulo: string };
  /** Sobre quién es cada señal (el ganador, la entidad, las empresas que nombra): va arriba en su panel lateral. */
  contextoDeSenal?: (s: SenalAgente) => React.ReactNode;
}

/** Lo que entra en la fila de la evidencia: hasta el final de una oración. El resto, en su panel. */
const MAX_EVIDENCIA = 230;

const COLUMNA_SEVERIDAD: Columna = { clave: "severidad", desde: "md", apilar: true, titulo: "Severidad", ancho: "116px" };
const COLUMNA_SENAL: Columna = { clave: "senal", titulo: "Señal y evidencia", ancho: "minmax(0,1fr)" };
const COLUMNA_COTEJO: Columna = { clave: "cotejo", titulo: "Cotejo", ancho: "148px", desde: "lg" };

/** Cómo corren los carriles, dicho como corren: expediente y proveedor a la vez, la síntesis al final. */
function formaCarriles(n: number): string {
  if (n >= 3) return "en dos ramas en paralelo y una síntesis al final";
  if (n === 2) return "en dos carriles";
  return "en un solo carril";
}

export function AuditoriaDeAgentes({
  senales,
  fases,
  estadoProc = "procesado",
  ahora = 0,
  perfil,
  reglasDisparadas,
  reglasEvaluadas,
  titulo = "Las señales, una por una",
  nombresPrivados,
  anexo,
  temaDe,
  contextoDeSenal,
}: Props) {
  const [agente, setAgente] = useState<string | null>(null);
  const [gravedad, setGravedad] = useState<GravedadFiltro | null>(null);
  const [tema, setTema] = useState<string | null>(null);
  const { reglas, cargando } = useReglasPerfil(perfil);

  const mapaFases: FasesMap = fases ?? {};
  const hayEje = rangoDelAnalisis(mapaFases, ahora) != null;
  const porAgente = useMemo(() => agruparPorAgente(senales), [senales]);
  // Los pasos del perfil, más cualquier agente que haya emitido una señal aunque el perfil no lo
  // declare: si encontró algo, corrió — esconderlo dejaría evidencia sin dueño visible.
  const pasos = useMemo(() => {
    const base = pasosDelPerfil(reglas?.agentes);
    const claves = new Set(base.map((p) => p.clave));
    const conSenal = Object.keys(porAgente).filter((k) => k !== SIN_AGENTE && !claves.has(k));
    if (!conSenal.length) return base;
    for (const k of conSenal) claves.add(k);
    return PASOS.filter((p) => claves.has(p.clave));
  }, [reglas, porAgente]);
  const conteo = useMemo(() => contar(senales), [senales]);
  // Las del agente elegido, con su tema: sobre ellas cuentan los filtros de gravedad y de tema.
  const delAgente = useMemo(
    () =>
      senales
        .filter((s) => (agente ? (s.agente ?? SIN_AGENTE) === agente : true))
        .map((s) => ({ s, severidad: s.severidad, tema: temaDe?.(s.regla).clave ?? "" })),
    [senales, agente, temaDe],
  );
  const temas = useMemo(() => {
    if (!temaDe) return [];
    const vistos = new Map<string, string>();
    for (const x of [...delAgente].sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad])) {
      const t = temaDe(x.s.regla);
      if (!vistos.has(t.clave)) vistos.set(t.clave, t.titulo);
    }
    return [...vistos].map(([clave, titulo]) => ({ clave, titulo }));
  }, [delAgente, temaDe]);
  const filtradas = useMemo(
    () =>
      delAgente
        .filter((x) => (!gravedad || x.severidad === gravedad) && (!tema || x.tema === tema))
        .map((x) => x.s)
        .sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad]),
    [delAgente, gravedad, tema],
  );

  const agentesConSenales = Object.keys(porAgente).filter((k) => k !== SIN_AGENTE).length;
  const sinAgente = porAgente[SIN_AGENTE]?.length ?? 0;
  const omitidos = hayEje ? pasos.filter((p) => ventanaDe(mapaFases, p.clave, estadoProc, ahora).estado === "omitido").length : 0;
  const nAgentes = pasos.filter((p) => p.tipo === "agente").length;
  const carriles = new Set(pasos.map((p) => p.carril)).size;
  const pasoSel = agente ? pasoDeClave(agente) : null;

  // Cuando ninguna señal trae cotejo, veinte sellos "sin cotejo" no informan: lo dice la leyenda.
  const columnas = conteo.conCotejo > 0 ? [COLUMNA_SEVERIDAD, COLUMNA_SENAL, COLUMNA_COTEJO] : [COLUMNA_SEVERIDAD, COLUMNA_SENAL];
  // La misma sanción por dos reglas («Sanción vigente en el OECE» y «Proveedor con sanción OSCE/OECE») va en UNA fila, la
  // más grave, que dice que otra regla marca lo mismo: como en el índice de señales (auditoría del 2026-11-05). Después
  // del filtro por agente: si cada regla la encontró un agente distinto, el de la que se quita sigue viendo la suya.
  // Los conteos (la leyenda del cotejo, «n de N») siguen siendo de señales: las dos están en el análisis.
  const filas: Fila[] = sinRepetidas(filtradas).map(({ s, tambien }, i) => {
    const etiqueta = etiquetaDeRegla(s.regla, reglas);
    const otraRegla = tambien ? `También la marca la regla «${etiquetaDeRegla(tambien.regla, reglas)}», con el mismo hecho` : null;
    return {
      id: `${s.regla}-${s.agenteBruto ?? ""}-${i}`,
      celdas: {
        severidad: <Severidad bandera={s.severidad} />,
        senal: (
          <CeldaPrincipal
            titulo={
              tambien ? (
                <>
                  {etiqueta} <span className="font-normal text-mute">(y otra regla con lo mismo)</span>
                </>
              ) : (
                etiqueta
              )
            }
            textoCompleto={otraRegla ? `${etiqueta}. ${otraRegla}.` : etiqueta}
            // La evidencia hasta el final de una oración y en las líneas que haga falta: antes iba en UNA línea recortada
            // a media frase («…figura como representante de 3 empresas distintas que ga…») y no se veía cómo leer el resto.
            metaEnVarias
            meta={
              <span className="block max-w-prose text-pretty leading-relaxed text-inkSoft">
                {(temaDe || s.item) && (
                  <span className="mb-0.5 block text-rotulo text-mute">
                    {temaDe?.(s.regla).titulo}
                    {temaDe && s.item ? ", " : ""}
                    {s.item && <span className="font-mono">ítem {s.item}</span>}
                  </span>
                )}
                {s.evidencia ? <ResumenEvidencia texto={s.evidencia} nombres={nombresPrivados} max={MAX_EVIDENCIA} /> : "Sin evidencia registrada"}
                <span className="mt-1 flex items-center gap-1 text-rotulo font-semibold text-granate">
                  {s.evidencia && evidenciaRecortada(s.evidencia, MAX_EVIDENCIA) ? "Ver la evidencia completa" : "Ver la evidencia"}
                  <ChevronRight size={12} aria-hidden />
                </span>
              </span>
            }
          />
        ),
        cotejo: <SelloCotejo verificada={s.verificada} />,
      },
      detalle: {
        titulo: etiqueta,
        // El nombre accesible empieza por lo que se ve ("Señal alta …") y dice qué abre.
        etiqueta: `Ver la evidencia de ${etiqueta}`,
        descripcion: (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Severidad bandera={s.severidad} formato="linea" />
            <span>
              la encontró <strong className="font-semibold text-ink">{nombreDeAgente(s.agenteBruto ?? s.agente)}</strong>
            </span>
            {otraRegla && <span>{otraRegla}.</span>}
          </span>
        ),
        contenido: <DetalleSenal senal={s} etiqueta={etiqueta} descripcion={descripcionDeRegla(s.regla, reglas)} contexto={contextoDeSenal?.(s)} />,
      },
    };
  });

  return (
    <>
    <Seccion
      titulo={titulo}
      ayuda={
        <Ayuda titulo="¿Qué trae cada señal?">
          El patrón que se encontró, la norma que lo sostiene y su evidencia. Toca una para ver el detalle y la fuente; las
          reglas que se evaluaron y no dispararon están al final, en &ldquo;Reglas evaluadas&rdquo;.
        </Ayuda>
      }
      acciones={conteo.total > 0 ? <LeyendaCotejo verificadas={conteo.verificadas} conCotejo={conteo.conCotejo} total={conteo.total} /> : undefined}
    >
      <div className="space-y-3">
        {/* Quién encontró qué: plegado (vocabulario técnico, §12). Cada agente filtra la tabla. */}
        <details className="group rounded-2xl border border-line bg-paper">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-meta font-semibold text-ink hover:bg-paperSoft sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex flex-wrap items-center gap-x-1.5">
              Quién encontró cada señal
              <span className="font-normal text-mute">
                ({nAgentes} agentes{agentesConSenales > 0 ? `, ${agentesConSenales} con señales` : ""})
              </span>
            </span>
            <ChevronDown size={14} className="shrink-0 text-mute transition-transform duration-rapido group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-line px-3 py-3 sm:px-5">
            {/* Sin ⓘ dentro del <summary>: un botón ahí también abriría y cerraría el pliegue. */}
            <p className="mb-2 text-rotulo leading-snug text-mute">
              {hayEje
                ? `Corrieron ${nAgentes} agentes ${formaCarriles(carriles)}${omitidos > 0 ? ` (${omitidos} de los ${pasos.length} pasos no aplicaban y se saltaron)` : ""}.`
                : `Le aplican ${nAgentes} agentes de los ${TOTAL_PASOS} pasos del análisis, ${formaCarriles(carriles)}.`}{" "}
              Toca un agente para ver sólo lo suyo.
            </p>
            {hayEje ? (
              <EjeAgentes
                fases={mapaFases}
                estado={estadoProc}
                ahora={ahora}
                pasos={pasos}
                senalesPorAgente={porAgente}
                totalSenales={conteo.total}
                seleccion={agente}
                onSeleccion={setAgente}
              />
            ) : (
              <>
                <CarrilesAgentes pasos={pasos} senalesPorAgente={porAgente} totalSenales={conteo.total} seleccion={agente} onSeleccion={setAgente} />
                <p className="mt-2 border-t border-line pt-2 text-micro leading-snug text-mute">
                  Sin marcas de tiempo por agente: se ve qué hace cada uno y qué encontró, no cuánto tardó.
                </p>
              </>
            )}
            {/* Las señales sin agente declarado también tienen que ser alcanzables desde acá. */}
            {sinAgente > 0 && (
              <button
                type="button"
                onClick={() => setAgente(agente === SIN_AGENTE ? null : SIN_AGENTE)}
                aria-pressed={agente === SIN_AGENTE}
                className={cn(
                  "mt-2 flex w-full items-baseline gap-2 rounded-lg border-t border-line px-1 pt-2 text-left text-rotulo transition-colors duration-rapido",
                  "hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50",
                  agente === SIN_AGENTE && "bg-granate-soft",
                )}
              >
                <span className="text-ink">Sin agente declarado</span>
                <span className="text-mute">
                  {sinAgente} de {conteo.total} señales llegaron sin decir qué agente las produjo
                </span>
              </button>
            )}
          </div>
        </details>

        {/* Por gravedad y por tema, con cuántas hay de cada una (pedido del usuario del 2026-11-16). */}
        <FiltrosSenales
          senales={delAgente}
          temas={temas}
          gravedad={gravedad}
          tema={tema}
          alCambiar={(f) => {
            setGravedad(f.gravedad);
            setTema(f.tema);
          }}
        />

        {/* El recorte activo, con su salida: la tabla nunca queda filtrada sin decirlo. */}
        {agente && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-inkSoft" aria-live="polite">
            <span>
              Señales de <strong className="font-semibold text-ink">{pasoSel?.nombre ?? "sin agente declarado"}</strong>:{" "}
              <span className="tabular-nums">
                {delAgente.length} de {conteo.total}
              </span>
            </span>
            <button type="button" onClick={() => setAgente(null)} className="font-medium text-granate hover:underline">
              Ver las {conteo.total}
            </button>
          </p>
        )}

        {filas.length > 0 ? <Tabla columnas={columnas} filas={filas} etiqueta="Señales del contrato" /> : <VacioAgente agente={pasoSel} />}

        {anexo}
      </div>
    </Seccion>

    {/* Lo que se descartó también es evidencia, pero secundaria: plegada, al final. */}
    <Seccion
      plegable
      titulo="Reglas evaluadas"
      descripcion="Las que dispararon y las que se evaluaron sin disparar."
      className="mt-6"
    >
      {/* MatrizReglas trae su propio relleno: se compensa el del pliegue para no duplicarlo. */}
      <div className="-mx-4 -my-4">
        <MatrizReglas reglas={reglas} cargando={cargando} reglasDisparadas={reglasDisparadas} senales={senales} reglasEvaluadas={reglasEvaluadas} />
      </div>
    </Seccion>
    </>
  );
}

/** El agente elegido no emitió señales: se dice qué hace, para que el vacío también enseñe. */
function VacioAgente({ agente }: { agente: PasoPipeline | null }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paperSoft px-4 py-5 text-meta leading-relaxed text-mute sm:px-5">
      <p className="text-ink">
        {agente ? `${agente.nombre} corrió sobre este contrato y no emitió ninguna señal.` : "Ninguna señal coincide con el recorte elegido."}
      </p>
      {agente && <p className="mt-1 max-w-[65ch]">{agente.que}</p>}
    </div>
  );
}

export type { SenalAgente };
