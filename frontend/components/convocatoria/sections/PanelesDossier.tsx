"use client";

/**
 * El contenido de cada pestaña del dossier. Salió de ResultadoView, que rozaba las 800 líneas:
 * allá queda la estructura (identidad → veredicto → pestañas) y acá lo que se lee en cada una.
 *
 * Las `Pestanas` del kit (§14.3) montan cada pestaña la primera vez que se abre. La primera es
 * «La historia» (pedido del usuario del 2026-11-05: contar una historia en vez de apilar bloques;
 * ver ../relato/HistoriaDossier) y viene en el HTML del servidor, como Señales, que es estática
 * por la misma razón (se abre desde los enlaces viejos con `?tab=resumen`). Las otras son módulos
 * aparte cargados con `next/dynamic` y sin render en el servidor: su JS (react-markdown del
 * dictamen, el grafo de la red de personas, el recorrido de los agentes) recién baja al abrir su
 * pestaña. Mientras llega, un esqueleto con la forma del contenido; si el módulo no llega, el
 * límite de error de la pestaña (SeccionSegura, en ResultadoView) lo dice en vez de tirar la página.
 *
 * Dentro del informe los avisos de "no hay nada acá" van con <AvisoSeccion>, sin la llamita:
 * el informe es evidencia (DESIGN_SYSTEM.md §6).
 */

import dynamic from "next/dynamic";
import type { ApiResult, Bandera } from "../types";
import type { EstadoCorrida } from "../dossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { BanderasAgrupadas } from "./BanderasAgrupadas";
import { CausalDirectaSection } from "./CausalDirectaSection";
import { CumplimientoNormativoSection } from "./CumplimientoNormativoSection";
import { mercadoMedido } from "@/components/charts/mercado";
import { SeccionSegura } from "./SeccionSegura";
import { Skeleton } from "@/components/ui/Skeleton";
import { setRedactNames, type NombreConocido } from "../../Redact";
import { HistoriaDossier } from "../relato/HistoriaDossier";
import type { PostoresDelContrato } from "../relato/PostoresOfertas";
import { contextoDeSenales } from "../senal/directorio";

export type TabKey = "historia" | "resumen" | "dictamen" | "control" | "obra" | "items" | "proveedor" | "documentos" | "prensa" | "trace";

export interface PanelDossierProps {
  tab: TabKey;
  result: ApiResult;
  conv: any;
  dict: string;
  corrida: EstadoCorrida;
  banderasArr: Bandera[];
  noVerificables: Bandera[];
  /** Hechos de contexto (`puntua: false`): aparte y fuera de los conteos. */
  contexto: Bandera[];
  nombresPrivados: NombreConocido[];
  nombresSunat: string[];
  ganador: any;
  ganadores: any[];
  ocidContrato: string | null;
  nItems: number;
  nDocs: number;
  nEvents: number;
  /**
   * Cambia de pestaña y baja a ella (o a `ancla`, un id dentro de la nueva). La usa «La historia», cuyos capítulos llevan
   * cada uno a su pestaña de detalle; la arma ResultadoView.
   */
  abrirTab?: (t: TabKey, ancla?: string) => void;
  /**
   * Los postores de la ficha del contrato y la evaluación leída por pieza, para el capítulo «Postores y ofertas» de la
   * historia. Sólo la página del contrato los pasa; sin ellos (panel admin, informe suelto), el capítulo no aparece.
   */
  postoresContrato?: PostoresDelContrato | null;
}

/** Mientras baja el JS de una pestaña: la forma de su contenido, sin la llamita (es evidencia). */
function PanelCargando() {
  return (
    <div role="status" aria-busy className="space-y-3">
      <span className="sr-only">Cargando la pestaña…</span>
      <Skeleton className="h-6 w-56 max-w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

// Una por pestaña, así cada una es su propio fragmento de JS. `ssr: false`: no pasan por el
// servidor (sólo la pestaña Señales llega en el HTML), y su render no depende de nada global
// del servidor (ver el registro de nombres privados en ResultadoView).
// (Las opciones van escritas en cada llamada: `next/dynamic` exige un objeto literal.)
const PanelDictamen = dynamic(() => import("./PanelDictamen").then((m) => m.PanelDictamen), { ssr: false, loading: () => <PanelCargando /> });
const PanelItems = dynamic(() => import("./PanelItems").then((m) => m.PanelItems), { ssr: false, loading: () => <PanelCargando /> });
const PanelProveedor = dynamic(() => import("./PanelProveedor").then((m) => m.PanelProveedor), { ssr: false, loading: () => <PanelCargando /> });
const PanelDocumentos = dynamic(() => import("./PanelDocumentos").then((m) => m.PanelDocumentos), { ssr: false, loading: () => <PanelCargando /> });
const PanelPrensa = dynamic(() => import("./PanelPrensa").then((m) => m.PanelPrensa), { ssr: false, loading: () => <PanelCargando /> });
const PanelTraza = dynamic(() => import("./PanelTraza").then((m) => m.PanelTraza), { ssr: false, loading: () => <PanelCargando /> });
const PanelObra = dynamic(() => import("./PanelObra").then((m) => m.PanelObra), { ssr: false, loading: () => <PanelCargando /> });
const PanelInformeControl = dynamic(() => import("./PanelInformeControl").then((m) => m.PanelInformeControl), { ssr: false, loading: () => <PanelCargando /> });

export function PanelDossier(p: PanelDossierProps) {
  switch (p.tab) {
    case "historia":
      return <HistoriaDossier {...p} />;
    case "resumen":
      return <PanelResumen {...p} />;
    case "dictamen":
      return <PanelDictamen {...p} />;
    case "control":
      return <PanelInformeControl {...p} />;
    case "items":
      return <PanelItems {...p} />;
    case "proveedor":
      return <PanelProveedor {...p} />;
    case "documentos":
      return <PanelDocumentos {...p} />;
    case "prensa":
      return <PanelPrensa {...p} />;
    case "trace":
      return <PanelTraza {...p} />;
    case "obra":
      return <PanelObra {...p} />;
    default:
      return null;
  }
}

// ─── Señales: TODAS las señales con su evidencia (el anticipo del dictamen va en el veredicto) ───
// Estática (sin `next/dynamic`), como «La historia»: los enlaces viejos con `?tab=resumen` la abren de entrada y llega en
// el HTML del servidor. Desde el 2026-11-05 la primera es «La historia»; ésta queda para la evidencia entera, en tabla.

function PanelResumen({ result, banderasArr, noVerificables, contexto, corrida, nombresPrivados, ganador }: PanelDossierProps) {
  // Se registran otra vez las personas privadas justo antes de redactar: en el servidor el
  // registro de Redact es global del proceso y otro informe pudo cambiarlo en el medio.
  setRedactNames(nombresPrivados);
  const compl = result.compliance || {};
  const causal = (result as any).causal_directa_invocada;
  // De quién habla cada señal: el panel lateral de cada una lo dice arriba (el ganador, la entidad, las empresas aludidas).
  const ctxSenales = contextoDeSenales(result, ganador);
  return (
    <div className="space-y-4">
      <div id="senales" className="scroll-mt-24">
        {banderasArr.length > 0 || noVerificables.length > 0 || contexto.length > 0 ? (
          <SeccionSegura nombre="las señales">
            {/* `perfil` y `reglasDisparadas` destraban la matriz de reglas evaluadas; sin
                ellas el componente dice que no tiene catálogo, en vez de inventar uno. */}
            <BanderasAgrupadas
              banderas={banderasArr}
              reglas_evaluadas={compl.reglas_evaluadas ?? null}
              perfil={compl.perfil ?? null}
              reglasDisparadas={compl.reglas_disparadas ?? compl.reglasDisparadas ?? null}
              noVerificables={noVerificables}
              contexto={contexto}
              nombresPrivados={nombresPrivados}
              ctxSenales={ctxSenales}
              ganadores={Array.isArray((result as any).ganadores_ficha) ? (result as any).ganadores_ficha : []}
            />
          </SeccionSegura>
        ) : corrida.completa ? (
          // El veredicto de arriba ya lo explica (con su ⓘ): aquí sólo el hecho.
          <AvisoSeccion titulo="El análisis terminó sin señales">Ninguna regla de contratación disparó una señal.</AvisoSeccion>
        ) : (
          <AvisoSeccion titulo="Análisis incompleto: sin señales registradas">
            {corrida.faltan.length > 0 && `Faltó ${corrida.faltan.join(" y ")}. `}
            Que no aparezcan señales no quiere decir que el contrato no las tenga.
          </AvisoSeccion>
        )}
      </div>

      {causal?.match && (
        <SeccionSegura nombre="la causal de contratación directa">
          <CausalDirectaSection causal={causal} acto={(result as any).acto_resolutivo_directa} />
        </SeccionSegura>
      )}

      {/* Las opiniones del OECE que citan las señales, plegadas (antes, una tabla en Documentos que repetía cada señal). */}
      {result.normative_compliance && (
        <SeccionSegura nombre="las opiniones del OECE">
          <CumplimientoNormativoSection nc={result.normative_compliance} sobreprecioMedido={mercadoMedido(result.market_analysis)} />
        </SeccionSegura>
      )}
    </div>
  );
}
