"use client";

import { Suspense } from "react";
import { RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { CasosGolden } from "@/components/admin/golden/Casos";
import { ConjuntosGolden } from "@/components/admin/golden/Conjuntos";
import { CorridasGolden } from "@/components/admin/golden/Corridas";
import { DetalleCorrida } from "@/components/admin/golden/DetalleCorrida";
import { NormasGolden } from "@/components/admin/golden/Normas";
import { ErrorGolden } from "@/components/admin/golden/comunes";
import { fmtEjecutada, fmtF1, porFechaDesc, useParametros, type RespuestaGolden } from "@/components/admin/golden/tipos";
import { PanelPestana, Pestanas, SkeletonPanel, StatCard, StatGrid, claseBoton, plural, usePestana } from "@/components/admin/ui";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";

const PESTANAS = ["conjuntos", "corridas", "casos", "normas"] as const;
type Pestana = (typeof PESTANAS)[number];

/**
 * Pruebas de oro en el panel: cada conjunto de casos con respuesta de referencia y cada corrida de una imagen del agente
 * contra él, para saber si una imagen es mejor o peor que la anterior, en qué regla y en qué contrato. La pestaña
 * «Normas» muestra el corpus del RAG normativo y un probador con lo mismo que recibe el agente legal.
 *
 * Todo vive en la URL: `?tab=` (la pestaña), `?conjunto=` (el conjunto elegido en Corridas y Casos) y `?corrida=` (el
 * detalle de una corrida, dentro de Corridas). Sólo se pide lo de la pestaña abierta. Fuente: /api/admin/golden/* y
 * /api/admin/normas/* (sólo lectura).
 */
export default function PanelGolden() {
  return (
    <AdminShell
      title="Pruebas de oro"
      subtitle="Qué tan bien responde cada imagen del agente frente a los casos de referencia, y qué normas recibe"
      actions={
        <button type="button" onClick={() => refrescarAdmin("/golden", "/normas")} className={claseBoton("secundario")}>
          <RefreshCw size={15} aria-hidden /> Actualizar
        </button>
      }
    >
      <Suspense fallback={<SkeletonPanel lineas={6} />}>
        <Contenido />
      </Suspense>
    </AdminShell>
  );
}

function Contenido() {
  const { data, error, isLoading, mutate } = useAdmin<RespuestaGolden>("/golden");
  const [pedida, setTab] = usePestana(PESTANAS);
  const { conjunto: pedido, corrida, poner } = useParametros();
  // Un enlace con solo `?corrida=<id>` abre su detalle, que vive en Corridas.
  const tab: Pestana = corrida ? "corridas" : pedida;
  const conjuntos = data?.conjuntos;
  // Sin `?conjunto=` (o con uno que ya no existe) vale el primero.
  const conjunto = conjuntos?.some((c) => c.clave === pedido) ? pedido! : conjuntos?.[0]?.clave ?? "";

  const casos = (conjuntos ?? []).reduce((s, c) => s + (c.casos ?? 0), 0);
  const corridas = (conjuntos ?? []).reduce((s, c) => s + (c.corridas ?? 0), 0);
  const ultima = porFechaDesc((conjuntos ?? []).flatMap((c) => (c.ultima ? [{ ...c.ultima, nombre: c.nombre }] : [])))[0];

  const sinConjuntos = <SkeletonPanel lineas={5} />;
  const panel: Record<Pestana, React.ReactNode> = {
    conjuntos: (
      <ConjuntosGolden
        conjuntos={conjuntos}
        cargando={isLoading}
        onCorridas={(clave) => poner({ tab: "corridas", conjunto: clave, corrida: null })}
        onCasos={(clave) => poner({ tab: "casos", conjunto: clave, corrida: null })}
      />
    ),
    corridas: corrida ? (
      <DetalleCorrida id={corrida} onVolver={() => poner({ corrida: null })} />
    ) : conjuntos ? (
      <CorridasGolden conjuntos={conjuntos} conjunto={conjunto} onConjunto={(clave) => poner({ conjunto: clave })} onCorrida={(id) => poner({ corrida: id })} />
    ) : isLoading ? (
      sinConjuntos
    ) : null,
    casos: conjuntos ? <CasosGolden conjuntos={conjuntos} conjunto={conjunto} onConjunto={(clave) => poner({ conjunto: clave })} /> : isLoading ? sinConjuntos : null,
    normas: <NormasGolden />,
  };

  return (
    <div className="space-y-5">
      {/* En «Normas» la lista de conjuntos no hace falta: su error no tapa el corpus ni el probador. */}
      {tab !== "normas" && <ErrorGolden error={error} titulo="No se pudieron leer las pruebas de oro" onReintentar={() => mutate()} />}
      <StatGrid columnas={4}>
        <StatCard etiqueta="Conjuntos" valor={conjuntos ? conjuntos.length : null} pista={conjuntos ? plural(casos, "caso de referencia", "casos de referencia") : undefined} cargando={isLoading} />
        <StatCard etiqueta="Corridas" valor={conjuntos ? corridas : null} pista="subidas, entre todos los conjuntos" cargando={isLoading} />
        <StatCard
          etiqueta="Última corrida"
          valor={ultima ? ultima.imagen ?? "Sin imagen" : conjuntos ? "Ninguna todavía" : null}
          pista={ultima ? `${ultima.nombre}, ${fmtEjecutada(ultima.ejecutada) ?? "sin fecha"}` : undefined}
          cargando={isLoading}
        />
        <StatCard etiqueta="F1 de esa corrida" valor={ultima ? fmtF1(ultima.f1) : null} pista={ultima?.errores ? `${plural(ultima.errores, "corte", "cortes")} (errores)` : ultima ? "sin cortes" : undefined} cargando={isLoading} />
      </StatGrid>

      <Pestanas<Pestana>
        etiqueta="Secciones de Pruebas de oro"
        activa={tab}
        onCambiar={(t) => {
          // Al salir de Corridas se cierra el detalle: volver a la pestaña abre la lista.
          if (t !== "corridas" && corrida) poner({ corrida: null });
          setTab(t);
        }}
        pestanas={[
          { clave: "conjuntos", etiqueta: "Conjuntos", conteo: conjuntos ? conjuntos.length : null },
          { clave: "corridas", etiqueta: "Corridas", conteo: conjuntos ? corridas : null },
          { clave: "casos", etiqueta: "Casos", conteo: conjuntos ? casos : null },
          { clave: "normas", etiqueta: "Normas" },
        ]}
      />
      <PanelPestana clave={tab}>{panel[tab]}</PanelPestana>
    </div>
  );
}
