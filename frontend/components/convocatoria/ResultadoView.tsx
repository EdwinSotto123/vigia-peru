"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { setRedactNames } from "../Redact";
import { nombresPrivadosDe } from "./nombresPrivados";
import { ArrowRight, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta, numero } from "@/lib/formato";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { Ayuda } from "@/components/patrones/Ayuda";
import { EVENTO_ACTIVA, Pestanas, irAPestana } from "@/components/patrones/Pestanas";
import { ICONO_SEVERIDAD } from "@/components/ui/Severidad";
import type { ApiResult } from "./types";
import { contarSeveridades, dossierEnRevision, estadoCorrida, nivelDelDossier, resumenDeTraza, separarBanderas } from "./dossier";
import { IdentidadDossier } from "./sections/IdentidadDossier";
import { SeccionSegura } from "./sections/SeccionSegura";
import { EnRevisionDossier } from "./sections/EnRevisionDossier";
import { PanelDossier, type TabKey } from "./sections/PanelesDossier";
import { FraseDossier } from "./relato/FraseDossier";
import { senalesDelRelato } from "./relato/historia";
import { NotaPrivacidad } from "@/components/privacidad/NotaPrivacidad";

/** Las pestañas del informe, en orden. La primera («historia», el relato) no va a la URL. */

/** El parámetro de la pestaña en la URL: `?tab=`, el de siempre, para que los enlaces viejos sigan abriendo la suya. */
const PARAM_TAB = "tab";

/**
 * El informe de un contrato, tal como lo ve el público, contado como una historia (pedido del usuario del 2026-11-05:
 * «veo que solo apilamos y demás sin dar orden o contar una historia»):
 *   1. identidad: volver, qué se contrató (h1), código, quién compra, quién ganó y chips de estado;
 *   2. el veredicto EN UNA FRASE (FraseDossier), armado con los datos: quién le compró qué a quién, por cuánto, frente
 *      a cuántos postores y lo más grave que se encontró, con las cifras que lo sostienen debajo. Reemplaza a las
 *      cuatro cifras sueltas (`Indicadores`) y a la tarjeta «El análisis encontró N señales», que se apilaban;
 *   3. las `Pestanas` del kit (§14.3). La primera y la inicial es «La historia» (relato/HistoriaDossier): qué pasó en
 *      orden con cada señal en su paso, por qué llama la atención, quién ganó, qué dice el dictamen y de dónde sale cada
 *      dato. Las demás (señales en tabla, dictamen, ítems, proveedor, documentos, prensa) son el detalle entero y,
 *      desde xl, la columna de datos del proceso;
 *   4. "Cómo se hizo", la última pestaña: ahí sí va el vocabulario técnico.
 *
 * La pestaña va a la URL como `?tab=` (el parámetro de antes), así los enlaces ya compartidos
 * siguen abriendo la misma pestaña. Antes la barra era propia de esta vista; ahora es la de toda
 * ficha, con su conteo en cada pestaña y el mismo teclado.
 *
 * El informe es evidencia: sin franja textil ni llamita en su cuerpo. La llamita vive en los
 * estados de la página (cargando, no encontrado, error), que arma la página y no este componente.
 *
 * `vistaPrevia` es para el panel admin, que muestra el informe de una alerta en revisión antes de
 * publicarla: mismo contenido, sin las acciones que no tienen sentido ahí (volver al listado,
 * compartir un enlace que todavía no es público). Por eso la vista previa NUNCA cae en el aviso
 * "En revisión": el equipo tiene que ver el informe entero para decidir.
 */
export function ResultadoView({
  result,
  vistaPrevia = false,
  tabInicial,
}: {
  result: ApiResult;
  vistaPrevia?: boolean;
  /**
   * La pestaña de `?tab=`, leída en el servidor (la página pública llega armada del servidor:
   * leer la URL en el navegador desfasaría la hidratación). `null` = la primera. Sin la prop
   * (panel admin, que pinta sólo en el cliente), se lee de la URL al montar.
   */
  tabInicial?: string | null;
}) {
  const conv = result.convocatoria || {};
  const compl = result.compliance || {};
  const dict = result.dictamen?.dictamen_markdown || "";
  const ocidContrato: string | null = conv.ocid || conv.codigo || result.ocid || null;
  const entidadRuc: string | null = conv.buyer_ruc || (result as any).entidad_ruc || null;
  // La identidad enlaza la entidad por su RUC: si la convocatoria no lo trae, el del análisis.
  const convIdentidad = entidadRuc && !conv.buyer_ruc ? { ...conv, buyer_ruc: entidadRuc } : conv;
  const enRevision = !vistaPrevia && dossierEnRevision(result);

  // ─── Pestaña inicial: la de `?tab=` (se lee una vez; después la lleva `Pestanas`) ───
  // La página pública la pasa desde el servidor. Sólo el panel admin (ssr:false, nunca pasa por
  // el servidor) cae en leer la URL al montar, que ahí no desfasa ninguna hidratación.
  const [tabElegida] = useState<string | undefined>(() =>
    tabInicial !== undefined
      ? tabInicial ?? undefined
      : typeof window === "undefined"
        ? undefined
        : new URLSearchParams(window.location.search).get(PARAM_TAB) ?? undefined,
  );

  // Los botones del veredicto y de la barra lateral cambian de pestaña con `irAPestana` (kit):
  // el estado y la URL quedan igual que si la hubiera tocado quien lee.
  const pestanas = useRef<HTMLDivElement>(null);
  const irATab = useCallback((t: TabKey) => irAPestana(t, PARAM_TAB), []);
  /** Si la barra de pestañas quedó fuera de la pantalla (arriba, o tan abajo que no se vería el panel), se va a ella. */
  const mostrarPestanas = useCallback(() => {
    const el = pestanas.current;
    const top = el?.getBoundingClientRect().top;
    if (!el || top == null || (top >= 0 && top < window.innerHeight - 160)) return;
    const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
  }, []);
  // Cambia de pestaña y baja a ella; con `ancla` («Ver la evidencia completa» → `senales`), hasta ese punto de la nueva.
  // Tras el clic el panel ya está a la vista (Pestanas lo monta en el mismo turno): el cuadro siguiente ya puede bajar.
  const abrirTab = useCallback(
    (t: TabKey, ancla?: string) => {
      irATab(t);
      const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => {
        const destino = ancla ? document.getElementById(ancla) : null;
        if (destino) destino.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
        else mostrarPestanas();
      });
    },
    [irATab, mostrarPestanas],
  );

  // ─── Qué corrió, qué señales se sostienen, qué nivel tiene ───
  const corrida = useMemo(() => estadoCorrida(result), [result]);
  const { visibles: banderasArr, noVerificables, contexto } = useMemo(() => separarBanderas(result), [result]);
  // UNA lectura de severidad para la cabecera, los chips y la lista (ver ./dossier).
  const conteo = useMemo(() => contarSeveridades(banderasArr), [banderasArr]);
  // De la más grave a la más leve y sin la que repite el hecho de otra: la frase del veredicto nombra las dos primeras.
  const senales = useMemo(() => senalesDelRelato(banderasArr), [banderasArr]);
  const nivel = nivelDelDossier(compl.score, banderasArr.length, corrida);
  // El puntaje nunca aparece sin las señales que lo explican (§10.4).
  const score = typeof compl.score === "number" && banderasArr.length > 0 ? compl.score : null;

  const ganadores = ((result.postores || []) as any[]).filter((p) => p?.es_ganador);
  const ganador = [...ganadores].sort((a, b) => (Number(b?.monto_ganado) || 0) - (Number(a?.monto_ganado) || 0))[0];

  // Contadores para las pestañas
  const nItems = Math.max(
    (result.items || []).length,
    (result.market_analysis?.findings || []).length,
    (result.document_analysis?.items_consolidados || []).length,
  );
  const nDocs = (result.documentos || []).length;
  const nNoticias = (result.news_research?.noticias || []).length;
  // El informe público llega sin la traza: su largo sale del resumen que armó el servidor.
  const nEvents = useMemo(() => resumenDeTraza(result).eventos, [result]);

  const _pn = result.person_network || {};
  const _red = _pn.red_empresarial || {};
  const _persona = _pn.persona_principal || {};
  const nRed =
    (_red.empresas_mismo_titular || []).length +
    (_red.empresas_misma_direccion || []).length +
    (_persona.candidaturas || []).length +
    (_persona.aportes_campañas || _persona.aportes_campanas || []).length +
    (result.web_research?.otros_contratos_con_estado || []).length;

  // Diccionario de personas PRIVADAS conocidas para censurar su apellido también en la
  // PROSA (síntesis, dictamen, evidencia). Se arma en ./nombresPrivados.ts, que también
  // usa el panel de revisión para registrarla antes de que este componente cargue.
  // Ahora el informe también se dibuja en el SERVIDOR, donde ese registro es global del proceso:
  // se fija aquí y la cabecera, el veredicto y la pestaña Señales redactan en el mismo render,
  // sin nada que suspenda en el medio. Las demás pestañas no pasan por el servidor y cada una
  // vuelve a registrarlo antes de redactar (PanelesDossier).
  const nombresPrivados = useMemo(() => nombresPrivadosDe(result), [result]);
  setRedactNames(nombresPrivados);
  const nombresSunat = useMemo(
    () => nombresPrivados.flatMap((n) => (n && typeof n === "object" && n.orden === "sunat" && n.nombre ? [n.nombre] : [])),
    [nombresPrivados],
  );

  // (El anticipo del dictamen ya no va en una tarjeta arriba: su resumen ejecutivo es el capítulo «Lo que dice el
  // análisis» de La historia, ver relato/historia.ts `resumenDelDictamen`.)

  // Conteos de las pestañas, en tinta neutra (los pinta `Pestanas`). Un cero no se muestra: aquí
  // suele querer decir "esa parte no corrió", no "no hay nada" (§10.2: sin dato no es cero).
  // La obra en INFOBRAS (redes de obras y consultoría): su pestaña sólo si el proceso está enlazado a una obra.
  const _sup = (result as any).supervision_obra;
  const _obra = (result as any).obra_ejecucion;
  const nObras = ((_sup?.enlazada && _sup.obras) || (_obra?.enlazada && _obra.obras) || []).length;
  const TABS: { key: TabKey; label: string; badge: number | null }[] = [
    // La primera, la que abre el informe: el relato (pedido del usuario del 2026-11-05). Sin conteo: no es una lista.
    { key: "historia", label: "La historia", badge: null },
    { key: "resumen", label: "Señales", badge: banderasArr.length || null },
    { key: "dictamen", label: "Dictamen", badge: null },
    ...(nObras ? [{ key: "obra" as TabKey, label: _sup?.enlazada ? "La obra supervisada" : "La obra", badge: null }] : []),
    { key: "items", label: "Ítems y mercado", badge: nItems || null },
    { key: "proveedor", label: "Proveedor y red", badge: nRed || null },
    { key: "documentos", label: "Documentos", badge: nDocs || null },
    { key: "prensa", label: "Prensa", badge: nNoticias || null },
    { key: "trace", label: "Cómo se hizo", badge: null },
  ];

  // La pestaña abierta, para una sola cosa: en «La historia» la columna «Datos del proceso» no se repite al pie en el
  // celular (su capítulo «De dónde sale cada dato» dice lo mismo). Pestanas avisa cada cambio con EVENTO_ACTIVA.
  const [activa, setActiva] = useState<string>(() => (tabElegida && TABS.some((t) => t.key === tabElegida) ? tabElegida : TABS[0].key));
  useEffect(() => {
    const alCambiar = (e: Event) => {
      const d = (e as CustomEvent<{ param: string; clave: string }>).detail;
      if (d?.param === PARAM_TAB && typeof d.clave === "string") setActiva(d.clave);
    };
    window.addEventListener(EVENTO_ACTIVA, alCambiar);
    return () => window.removeEventListener(EVENTO_ACTIVA, alCambiar);
  }, []);

  // ─── Alerta frenada para revisión humana: "En revisión" y nada más (§10.4) ───
  if (enRevision) {
    return <EnRevisionDossier conv={convIdentidad} ganador={ganador} nGanadores={ganadores.length} />;
  }

  const analizadoEn = (result._bridge_meta?.analizado_en as string | undefined) ?? null;
  const IconoNivel = ICONO_SEVERIDAD[nivel.ui.icono];

  return (
    <div className="space-y-5">
      {/* 1. Identidad: qué, quién compra, quién ganó; el peso del riesgo como chip de estado. */}
      <IdentidadDossier
        conv={convIdentidad}
        ganador={ganador}
        nGanadores={ganadores.length}
        volver={!vistaPrevia}
        compartible={!vistaPrevia}
        ruta={{ param: PARAM_TAB, primera: TABS[0].key, activa: tabElegida, etiquetas: Object.fromEntries(TABS.map((t) => [t.key, t.label])) }}
        chips={
          <>
            <span className={cn("pill font-semibold", nivel.ui.fondo, nivel.ui.texto, nivel.ui.borde)}>
              <IconoNivel size={11} aria-hidden />
              {nivel.etiqueta}
            </span>
            {conv.tipo_proceso && <span className="pill border-line bg-paperSoft text-inkSoft">{conv.tipo_proceso}</span>}
            {analizadoEn && <span className="text-meta text-mute">Leído el {fechaCorta(analizadoEn)}</span>}
          </>
        }
      />

      {/* 2. El veredicto en una frase, con sus cifras (en todas las pestañas: es lo primero que se lee). */}
      <SeccionSegura nombre="el veredicto">
        <FraseDossier
          conv={conv}
          ganador={ganador}
          nGanadores={ganadores.length}
          senales={senales}
          conteo={conteo}
          score={score}
          corrida={corrida}
          perfil={compl.perfil ?? null}
        />
      </SeccionSegura>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),300px]">
        {/* ─── COLUMNA PRINCIPAL ─── */}
        <div className="min-w-0 space-y-4">
          {/* 3. La historia y la evidencia, en pestañas. Cada panel con su propio límite de error: si uno no se
              puede dibujar, las demás pestañas se siguen leyendo. (El aviso de estado del expediente va ahora al pie
              de «Qué pasó», en La historia.) */}
          <div ref={pestanas} className="scroll-mt-24">
            <Pestanas
              etiqueta="Secciones del informe"
              fija
              param={PARAM_TAB}
              activa={tabElegida}
              pestanas={TABS.map((t) => ({
                clave: t.key,
                etiqueta: t.label,
                conteo: t.badge,
                contenido: (
                  <SeccionSegura nombre={`la pestaña ${t.label}`}>
                    <PanelDossier
                      tab={t.key}
                      result={result}
                      conv={conv}
                      dict={dict}
                      corrida={corrida}
                      banderasArr={banderasArr}
                      noVerificables={noVerificables}
                      contexto={contexto}
                      nombresPrivados={nombresPrivados}
                      nombresSunat={nombresSunat}
                      ganador={ganador}
                      ganadores={ganadores}
                      ocidContrato={ocidContrato}
                      nItems={nItems}
                      nDocs={nDocs}
                      nEvents={nEvents}
                      abrirTab={abrirTab}
                    />
                  </SeccionSegura>
                ),
              }))}
            />
          </div>

          {/* Una línea + ⓘ (§10.7). Es la única vez que el informe lo dice: antes lo repetían el
              veredicto, el pie de la lista de señales y este párrafo. */}
          <p className="flex items-center gap-1 border-t border-line pt-3 text-rotulo text-mute">
            <Info size={13} className="shrink-0" aria-hidden />
            Una señal no es una acusación.
            <Ayuda titulo="¿De dónde salen y qué hago con ellas?">
              Vigía detecta señales cruzando datos públicos (OECE, SUNAT, ONPE, JNE, prensa). Cada una es una pista para
              comprobar en su fuente. La denuncia formal corresponde a la Contraloría, la Fiscalía o el periodismo.
            </Ayuda>
          </p>
          {/* En la vista previa del panel admin los datos llegan completos (en vidrio): ahí no aplica. */}
          {!vistaPrevia && <NotaPrivacidad className="-mt-2" />}
        </div>

        {/* ─── BARRA LATERAL: datos del proceso y cómo se hizo ───
            En «La historia», debajo de xl no se repite al pie: lo dice su capítulo «De dónde sale cada dato». */}
        <aside className={cn("space-y-3 xl:sticky xl:top-20 xl:self-start", activa === "historia" && "hidden xl:block")} aria-label="Datos del proceso">
          <div className="rounded-2xl border border-line bg-paper p-4">
            <h2 className="font-display text-bloque font-bold text-ink">Datos del proceso</h2>
            {/* Filas etiqueta · cifra, alineadas a la izquierda: antes eran tres baldosas centradas. */}
            <dl className="mt-1.5 divide-y divide-line/70 text-meta">
              <DatoProceso valor={conv.n_postores} etiqueta={Number(conv.n_postores) === 1 ? "Postor" : "Postores"} />
              <DatoProceso valor={conv.n_items} etiqueta="Ítems" />
              <DatoProceso valor={conv.n_docs} etiqueta="Documentos" />
            </dl>
            {Number(conv.n_postores) === 1 && <p className="mt-1.5 text-rotulo leading-snug text-inkSoft">Se presentó un solo postor.</p>}
            {/* El perfil de la entidad ya se enlaza desde la identidad: aquí sólo lo que no está arriba. */}
            {ocidContrato && (
              <p className="mt-3 border-t border-line pt-3 text-meta">
                <Link href={`/app/contratos/${encodeURIComponent(ocidContrato)}`} className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
                  Documentos oficiales y citas por página <ArrowRight size={13} aria-hidden />
                </Link>
              </p>
            )}
          </div>

          {/* 5. Cómo se hizo: plegado detrás de su pestaña. Aquí sólo el acceso. */}
          <button
            type="button"
            onClick={() => abrirTab("trace")}
            className="w-full rounded-2xl border border-line bg-paperSoft p-4 text-left transition-colors duration-rapido hover:bg-paperDeep"
          >
            <span className="flex items-center justify-between gap-2 text-meta font-semibold text-ink">
              Cómo se hizo este análisis
              <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />
            </span>
            <span className="mt-1 block text-rotulo leading-snug text-inkSoft">
              {corrida.hayTraza ? (
                <>
                  Corrieron <strong className="font-semibold text-ink">{corrida.agentes.length} de {TOTAL_AGENTES}</strong> agentes
                  {nEvents > 0 && <>, en {numero(nEvents)} pasos registrados</>}.
                </>
              ) : (
                "Este análisis no guardó el registro de qué agentes corrieron."
              )}
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
}

/** Una cifra del proceso con su etiqueta, en una fila. Sin dato no se inventa un cero. */
function DatoProceso({ valor, etiqueta }: { valor: unknown; etiqueta: string }) {
  const n = typeof valor === "number" && Number.isFinite(valor) ? valor : null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-mute">{etiqueta}</dt>
      <dd className={cn("font-mono tabular-nums", n === null ? "font-sans text-rotulo text-mute" : "font-semibold text-ink")}>
        {n === null ? "Sin dato" : numero(n)}
      </dd>
    </div>
  );
}
