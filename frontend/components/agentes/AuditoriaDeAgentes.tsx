"use client";

/**
 * "Quién encontró qué" — la auditoría de los agentes de IA, que es el mecanismo único de este
 * producto y hasta ahora no se veía en ninguna parte.
 *
 * Reúne tres cosas que ya existían en el dato y que nada unía:
 *   1. las ventanas reales de ejecución por agente (`procesamiento.fases`, con desde/hasta),
 *   2. el agente que produjo cada señal (`SenalRiesgo.agente`),
 *   3. el catálogo de reglas del perfil, con las que NO dispararon.
 *
 * Y las cruza con la única interacción que el dato permite y que vale la pena: cada agente es
 * un filtro sobre la evidencia. Se hace sin navegar y sin abrir nada — el contexto de atrás
 * (qué más se encontró, qué se descartó) es parte de la prueba.
 */

import { useMemo, useState } from "react";
import { ChevronDown, FilterX } from "lucide-react";
import type { EstadoProc, FasesMap } from "@/lib/auditoria";
import { severidadDeBandera } from "@/lib/severidad";
import { Severidad } from "@/components/ui/Severidad";
import { Ayuda } from "@/components/patrones/Ayuda";
import type { NombreConocido } from "@/components/Redact";
import { cn } from "@/lib/utils";
import { PASOS, pasoDeClave, pasosDelPerfil, TOTAL_PASOS, type PasoPipeline } from "./catalogo";
import { CarrilesAgentes } from "./CarrilesAgentes";
import { EjeAgentes, rangoDelAnalisis, ventanaDe } from "./EjeAgentes";
import { ListaSenales } from "./ListaSenales";
import { MatrizReglas } from "./MatrizReglas";
import { LeyendaCotejo } from "./SelloVerificada";
import { agruparPorAgente, contar, ORDEN_SEVERIDAD, SIN_AGENTE, type SenalAgente, type Severidad as Sev } from "./senales";
import { useReglasPerfil } from "./useReglasPerfil";

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
  nota?: React.ReactNode;
  /**
   * El informe del ciudadano (dossier) pone primero las señales y pliega "quién las encontró"
   * (los carriles de agentes): el vocabulario técnico va plegado (DESIGN_SYSTEM.md §12).
   * Sin esto, el tablero de hallazgos sigue mostrando los carriles arriba, como antes.
   */
  carrilesPlegados?: boolean;
  /** Personas privadas del dossier: su apellido va tapado también en la línea de evidencia de cada fila. */
  nombresPrivados?: NombreConocido[];
}

const SEVERIDADES: Sev[] = ["alta", "media", "baja"];

/**
 * Cómo corren los carriles, dicho como corren (CARRILES en lib/auditoria): expediente y
 * proveedor a la vez, la síntesis al final. "N carriles en paralelo" era falso: la síntesis
 * espera a las otras dos ramas.
 */
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
  titulo = "Quién encontró qué",
  nota,
  carrilesPlegados = false,
  nombresPrivados,
}: Props) {
  const [agente, setAgente] = useState<string | null>(null);
  const [sev, setSev] = useState<Sev | null>(null);
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

  const filtradas = useMemo(
    () =>
      senales
        .filter((s) => (agente ? (s.agente ?? SIN_AGENTE) === agente : true))
        .filter((s) => (sev ? s.severidad === sev : true))
        .sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad]),
    [senales, agente, sev],
  );

  const agentesConSenales = Object.keys(porAgente).filter((k) => k !== SIN_AGENTE).length;
  const sinAgente = porAgente[SIN_AGENTE]?.length ?? 0;
  const omitidos = hayEje ? pasos.filter((p) => ventanaDe(mapaFases, p.clave, estadoProc, ahora).estado === "omitido").length : 0;
  const nAgentes = pasos.filter((p) => p.tipo === "agente").length;
  const carriles = new Set(pasos.map((p) => p.carril)).size;
  const pasoSel = agente ? pasoDeClave(agente) : null;
  const filtroActivo = agente != null || sev != null;

  // Qué agente encontró qué: el eje de tiempo (o los carriles, sin marcas de tiempo). Cada
  // agente es un filtro sobre la lista de señales.
  const carriles_ = (
      <div className="border-b border-line bg-paper px-3 py-3 sm:px-5">
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
            <CarrilesAgentes
              pasos={pasos}
              senalesPorAgente={porAgente}
              totalSenales={conteo.total}
              seleccion={agente}
              onSeleccion={setAgente}
            />
            <p className="mt-2 border-t border-line pt-2 text-[11px] leading-snug text-mute">
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
              "mt-2 flex w-full items-baseline gap-2 rounded-lg border-t border-line px-1 pt-2 text-left text-[12px] transition-colors duration-rapido",
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
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      {/* Dato primero (DESIGN_SYSTEM.md §10.7): título, su ⓘ y la cifra del cotejo en una
          línea. Lo que antes era un párrafo abierto encima de la lista está en la ⓘ. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-line bg-paperSoft px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="font-display text-xl font-bold leading-tight text-ink">{titulo}</h2>
          <Ayuda titulo={carrilesPlegados ? "¿Qué trae cada señal?" : "¿Qué agentes corrieron?"}>
            {carrilesPlegados ? (
              "El patrón que se encontró, la norma que lo sostiene y su evidencia. Toca una para ver el detalle y la fuente; las reglas que se evaluaron y no dispararon están al final."
            ) : (
              <>
                {hayEje
                  ? `Sobre este contrato corrieron ${nAgentes} agentes de IA ${formaCarriles(carriles)}${omitidos > 0 ? ` (${omitidos} de los ${pasos.length} pasos no aplicaban y se saltaron)` : ""}.`
                  : `A este contrato le aplican ${nAgentes} agentes de IA de los ${TOTAL_PASOS} pasos del análisis, ${formaCarriles(carriles)}.`}{" "}
                Toca un agente para ver sólo lo suyo.
              </>
            )}
          </Ayuda>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] tabular-nums text-inkSoft">
          {!carrilesPlegados && (
            <span>
              <strong className="font-semibold text-ink">{conteo.total}</strong> {conteo.total === 1 ? "señal" : "señales"}
              {agentesConSenales > 0 && <> de {agentesConSenales} {agentesConSenales === 1 ? "agente" : "agentes"}</>}
              {sinAgente > 0 && <> · {sinAgente} sin agente declarado</>}
            </span>
          )}
          {conteo.total > 0 && <LeyendaCotejo verificadas={conteo.verificadas} conCotejo={conteo.conCotejo} total={conteo.total} />}
        </div>
      </header>

      {carrilesPlegados ? (
        <details className="group border-b border-line bg-paper">
          <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-[13px] font-semibold text-ink hover:bg-paperSoft sm:px-5 [&::-webkit-details-marker]:hidden">
            <span>
              Quién encontró cada señal{" "}
              <span className="font-normal text-mute">
                ({nAgentes} agentes{agentesConSenales > 0 ? `, ${agentesConSenales} con señales` : ""})
              </span>
            </span>
            <ChevronDown size={14} className="shrink-0 text-mute transition-transform duration-rapido group-open:rotate-180" aria-hidden />
          </summary>
          {carriles_}
        </details>
      ) : (
        carriles_
      )}

      {/* Barra de la evidencia: qué se está mirando y con qué recorte. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-paperSoft px-4 py-2 sm:px-5">
        <h3 className="text-[13px] font-semibold text-ink">
          {agente ? (
            <>
              Señales de {pasoSel?.nombre ?? "sin agente declarado"}{" "}
              <span className="font-normal text-mute">
                ({filtradas.length} de {conteo.total})
              </span>
            </>
          ) : (
            <>
              Señales{" "}
              <span className="font-normal text-mute">
                ({filtradas.length} de {conteo.total})
              </span>
            </>
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {SEVERIDADES.map((s) => {
            const n = conteo[s];
            if (!n) return null;
            const ui = severidadDeBandera(s);
            const on = sev === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSev(on ? null : s)}
                aria-pressed={on}
                className={cn(
                  "pill border text-[11px] transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50",
                  on ? cn(ui.fondo, ui.texto, ui.borde, "font-semibold") : "border-line bg-paper text-mute hover:text-ink",
                )}
              >
                <Severidad bandera={s} formato="punto" />
                {ui.etiqueta} ({n})
              </button>
            );
          })}
          {filtroActivo && (
            <button
              type="button"
              onClick={() => { setAgente(null); setSev(null); }}
              className="pill border-line bg-paper text-[11px] text-mute transition-colors duration-rapido hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
            >
              <FilterX size={11} aria-hidden /> Ver las {conteo.total}
            </button>
          )}
        </div>
      </div>

      {filtradas.length > 0 ? (
        <ListaSenales senales={filtradas} reglas={reglas} mostrarSello={conteo.conCotejo > 0} nombres={nombresPrivados} />
      ) : (
        <VacioSenales total={conteo.total} filtroActivo={filtroActivo} agente={pasoSel} />
      )}

      <div className="border-t border-line bg-paperSoft">
        <MatrizReglas
          reglas={reglas}
          cargando={cargando}
          reglasDisparadas={reglasDisparadas}
          senales={senales}
          reglasEvaluadas={reglasEvaluadas}
        />
      </div>

      {nota && <p className="border-t border-line px-4 py-2 text-[11px] text-mute sm:px-5">{nota}</p>}
    </section>
  );
}

/** El vacío también enseña: distingue "no hay nada" de "tu filtro no deja ver nada". */
function VacioSenales({ total, filtroActivo, agente }: { total: number; filtroActivo: boolean; agente: PasoPipeline | null }) {
  if (total === 0) {
    return (
      <div className="px-4 py-6 text-[13px] leading-relaxed text-mute sm:px-5">
        <p className="text-ink">Ningún agente emitió señales sobre este contrato.</p>
        <p className="mt-1">Las reglas del perfil se evaluaron y ninguna disparó: el detalle está abajo.</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-6 text-[13px] leading-relaxed text-mute sm:px-5">
      <p className="text-ink">
        {agente
          ? `${agente.nombre} corrió sobre este contrato y no emitió ninguna señal con ese recorte.`
          : "Ninguna señal coincide con el recorte elegido."}
      </p>
      {agente && <p className="mt-1 max-w-[65ch]">{agente.que}</p>}
      {filtroActivo && <p className="mt-1">Las otras {total} siguen ahí: quita el filtro para verlas.</p>}
    </div>
  );
}

export type { SenalAgente };
