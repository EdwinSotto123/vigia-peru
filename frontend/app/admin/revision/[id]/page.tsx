"use client";

import { rutaContrato } from "@/lib/rutas";
import { Suspense, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ExternalLink, RotateCcw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { BarraDecisionMovil, ContratoDeAlerta, EstadoAlerta, PanelDecision } from "@/components/admin/revision/BarraDecision";
import { DetalleTecnico } from "@/components/admin/revision/DetalleTecnico";
import { EsqueletoPagina, EsqueletoPorQue } from "@/components/admin/revision/Esqueleto";
import { PorQueBloqueo } from "@/components/admin/revision/PorQueBloqueo";
import { VistaPublicada } from "@/components/admin/revision/VistaPublicada";
import { campoMotivo, decidirAlerta } from "@/components/admin/revision/decidir";
import type { ApiResult } from "@/components/convocatoria/types";
import { nombresPrivadosDe } from "@/components/convocatoria/nombresPrivados";
import { setRedactNames } from "@/components/Redact";
import type { AdminError, InformeRevision, RevisionDetalle } from "@/lib/admin";
import { claseBoton, explicarError, mensajeError, PanelPestana, Pestanas, usePestana } from "@/components/admin/ui";
import { adaptLoadedToUi } from "@/lib/dossier-adaptar";
import { refrescarTodo, useAdmin } from "@/lib/useAdmin";

/**
 * Revisión de una alerta que la autoevaluación no dejó publicar (rediseño 2026-10-30: antes eran 1.5 pantallas de
 * escritorio con 12 párrafos y 7 cajas dentro de cajas). Dos columnas en escritorio:
 *  · a la izquierda, el objeto del contrato y tres pestañas (`?tab=`; sólo se pinta la activa): «Por qué se bloqueó»
 *    (el motivo con su cifra, cada señal con su juicio y las comprobaciones, en filas que se abren a pedido), «Así se
 *    verá publicado» (el INFORME con el mismo <ResultadoView> del público; su JS se baja al abrir la pestaña) y
 *    «Detalle técnico» (evidencia cruda, verificación, descartes, bitácora y umbrales);
 *  · a la derecha, fija al bajar, la decisión (estado y Publicar / Descartar) y los datos del contrato y del análisis.
 * En el celular: el objeto y el estado arriba, las pestañas, los datos al final, y Publicar / Descartar en una barra
 * pegada al pie de la pantalla, siempre a mano.
 * Los DNI y apellidos que puedan venir en evidencias, juicios o dictamen pasan por Redact.
 */

const PESTANAS = ["porque", "publicado", "tecnico"] as const;
const TITULO = "Revisión";
const SUBTITULO = "Decide si este análisis se publica";

function Ficha({ id }: { id: string }) {
  const { open, toast } = useDialog();
  const [tab, setTab] = usePestana(PESTANAS);
  // Sin keepPreviousData: al pasar de una alerta a otra no se puede mostrar, ni un instante, la anterior.
  const det = useAdmin<RevisionDetalle>(`/revision/${id}`, { keepPreviousData: false });
  const inf = useAdmin<InformeRevision>(`/revision/${id}/informe`, { keepPreviousData: false, revalidateOnFocus: false });
  const ui = useMemo(() => (inf.data ? (adaptLoadedToUi(inf.data) as ApiResult) : null), [inf.data]);
  // Los apellidos de las personas privadas del dossier se registran acá, en el render y antes de
  // pintar las pestañas: antes lo hacía sólo ResultadoView, que carga aparte (next/dynamic), y
  // "Por qué se bloqueó" y el detalle técnico se pintaban primero con la lista vacía.
  const nombresPrivados = useMemo(() => (ui ? nombresPrivadosDe(ui) : []), [ui]);
  setRedactNames(nombresPrivados);
  const d = det.data;
  // El juicio del evaluador y la evidencia cruda pueden nombrar a personas privadas: esperan al diccionario que arma el
  // informe (o a saber que no llegará) para pintarse ya tapados.
  const nombresListos = !!ui || !!inf.error;

  function resolver(estado: "activa" | "descartada") {
    if (!d) return;
    const publicar = estado === "activa";
    open({
      title: publicar ? `Publicar ${d.codigo}` : `Descartar ${d.codigo}`,
      tone: publicar ? "success" : "danger",
      confirmLabel: publicar ? "Publicar" : "Descartar",
      body: publicar
        ? <>La alerta pasa a <strong>activa</strong>: aparece en listas públicas, mapa y ranking, y cuenta como señal hallada. Queda en la bitácora con tu correo.</>
        : <>La alerta pasa a <strong>descartada</strong>: no se publica y deja de contar como señal. El contrato sigue como procesado. Queda en la bitácora con tu correo.</>,
      fields: [campoMotivo()],
      onConfirm: async (v) => {
        await decidirAlerta(d.id, estado, v.motivo);
        toast(`${d.codigo} ${publicar ? "publicada" : "descartada"}. Ranking refrescado.`);
        // La cola, el Resumen, la bitácora y el procesamiento cuentan esta alerta: todos al día.
        await refrescarTodo();
      },
    });
  }

  return (
    <AdminShell
      title={d ? d.codigo : TITULO}
      subtitle={SUBTITULO}
      actions={
        <>
          <Link href="/admin/revision" className={claseBoton("secundario")}><ArrowLeft size={12} aria-hidden /> Cola</Link>
          {d?.procesamientoOcid && (
            <Link href={rutaContrato(d.procesamientoOcid, "vivo")} target="_blank" className={claseBoton("secundario")}><ExternalLink size={12} aria-hidden /> Ver traza</Link>
          )}
        </>
      }
    >
      {!d && det.error ? (
        <ErrorCarga error={det.error} onReintentar={() => det.mutate()} />
      ) : !d ? (
        <EsqueletoPagina />
      ) : (
        // Un bloque que envuelve toda la ficha: la barra del celular se pega al pie mientras éste siga en pantalla.
        <div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start">
            <div className="min-w-0">
              {/* El objeto del contrato es el título de lo que se revisa (el h1 es el código): dos renglones como mucho
                  en escritorio, tres en el celular; entero al pasar el mouse. */}
              {d.objeto && (
                <h2 className="line-clamp-3 break-words font-display text-destacado font-bold leading-snug text-ink lg:line-clamp-2" title={d.objeto}>
                  {d.objeto}
                </h2>
              )}
              {/* En escritorio el estado va en el panel de la derecha. */}
              <EstadoAlerta d={d} className={d.objeto ? "mt-2 lg:hidden" : "lg:hidden"} />

              <Pestanas
                className="mt-3"
                etiqueta={`Secciones de la revisión de ${d.codigo}`}
                pestanas={[
                  { clave: "porque", etiqueta: "Por qué se bloqueó" },
                  { clave: "publicado", etiqueta: "Así se verá publicado" },
                  { clave: "tecnico", etiqueta: "Detalle técnico" },
                ]}
                activa={tab}
                onCambiar={setTab}
              />
              <PanelPestana clave={tab}>
                {tab === "porque" ? (
                  <PorQueBloqueo d={d} listo={nombresListos} />
                ) : tab === "publicado" ? (
                  <VistaPublicada
                    ui={ui}
                    publicada={d.estado === "activa" || d.estado === "confirmada"}
                    ocid={(inf.data?.ocid ?? d.ocid ?? "").split("-").pop() || null}
                    error={!inf.data && inf.error ? sinInforme(inf.error) : null}
                    onReintentar={() => inf.mutate()}
                  />
                ) : nombresListos ? (
                  <DetalleTecnico d={d} />
                ) : (
                  <EsqueletoPorQue />
                )}
              </PanelPestana>
            </div>

            {/* `flex gap` y no `space-y`: en el celular el panel de decisión no se pinta y no deja su margen. */}
            <aside aria-label="Decisión y datos de la alerta" className="flex flex-col gap-3 lg:sticky lg:top-20">
              <PanelDecision d={d} onDecidir={resolver} className="hidden lg:block" />
              <ContratoDeAlerta d={d} />
            </aside>
          </div>

          {d.estado === "revision" && <BarraDecisionMovil codigo={d.codigo} onDecidir={resolver} />}
        </div>
      )}
    </AdminShell>
  );
}

export default function RevisionDetallePage({ params }: { params: { id: string } }) {
  // usePestana lee la URL (useSearchParams) y pide un límite de Suspense; mientras tanto, el esqueleto de la ficha.
  return (
    <Suspense
      fallback={
        <AdminShell title={TITULO} subtitle={SUBTITULO}>
          <EsqueletoPagina />
        </AdminShell>
      }
    >
      <Ficha id={params.id} />
    </Suspense>
  );
}

function ErrorCarga({ error, onReintentar }: { error: AdminError; onReintentar: () => void }) {
  const noExiste = error.status === 404 || error.status === 400;
  const x = explicarError(error);
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-line bg-paperSoft p-6 text-center">
      <AlertTriangle size={28} className="mx-auto text-amberTexto" aria-hidden />
      <h2 className="mt-3 font-display text-bloque leading-7 font-bold text-ink">{noExiste ? "Esta alerta no existe" : "No se pudo cargar la revisión"}</h2>
      <p className="mt-1 text-dato leading-5 text-inkSoft">
        {noExiste
          ? "El enlace no corresponde a ninguna alerta. Puede que se haya reprocesado con otro identificador: búscala en la cola."
          : `${x.titulo}. ${x.detalle}`}
      </p>
      {!noExiste && (
        <button type="button" onClick={onReintentar} className={claseBoton("primario", "sm", "mt-4")}>
          <RotateCcw size={12} aria-hidden /> Reintentar
        </button>
      )}
    </div>
  );
}

/**
 * Por qué no llegó el informe, en palabras. Un 404 sin cuerpo JSON es la API que todavía no tiene
 * la ruta de la vista previa (versión anterior desplegada); con `not_found` es la alerta que no está.
 */
function sinInforme(e: AdminError): string {
  if (e.status === 404 && e.message === "HTTP 404")
    return "el servidor de datos todavía no tiene la vista previa; aparece apenas se actualice la API";
  if (e.status === 404) return "no encontramos el informe de esta alerta";
  return mensajeError(e).replace(/\.$/, "");
}
