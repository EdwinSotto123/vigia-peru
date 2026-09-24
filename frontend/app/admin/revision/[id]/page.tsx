"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ExternalLink, RotateCcw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { BarraDecision } from "@/components/admin/revision/BarraDecision";
import { DetalleTecnico } from "@/components/admin/revision/DetalleTecnico";
import { EsqueletoPagina, EsqueletoPorQue } from "@/components/admin/revision/Esqueleto";
import { PorQueBloqueo } from "@/components/admin/revision/PorQueBloqueo";
import { VistaPublicada } from "@/components/admin/revision/VistaPublicada";
import { campoMotivo, decidirAlerta } from "@/components/admin/revision/decidir";
import type { ApiResult } from "@/components/convocatoria/types";
import { nombresPrivadosDe } from "@/components/convocatoria/nombresPrivados";
import { setRedactNames } from "@/components/Redact";
import type { AdminError, InformeRevision, RevisionDetalle } from "@/lib/admin";
import { claseBoton, explicarError, mensajeError } from "@/components/admin/ui";
import { adaptLoadedToUi } from "@/lib/dossier-adaptar";
import { refrescarTodo, useAdmin } from "@/lib/useAdmin";

/**
 * Revisión de una alerta que la autoevaluación no dejó publicar. De arriba abajo:
 *  · la decisión: estado, contrato, por qué se frenó (en palabras) y Publicar / Descartar;
 *  · el INFORME tal como lo verá el público al publicarlo (el mismo <ResultadoView>);
 *  · el juicio del evaluador señal por señal;
 *  · el detalle técnico (evidencia cruda, verificación, agentes, descartes, bitácora), plegado.
 * Los DNI y apellidos que puedan venir en evidencias, juicios o dictamen pasan por Redact.
 */
export default function RevisionDetallePage({ params }: { params: { id: string } }) {
  const id = params.id;
  const { open, toast } = useDialog();
  // Sin keepPreviousData: al pasar de una alerta a otra no se puede mostrar, ni un instante, la anterior.
  const det = useAdmin<RevisionDetalle>(`/revision/${id}`, { keepPreviousData: false });
  const inf = useAdmin<InformeRevision>(`/revision/${id}/informe`, { keepPreviousData: false, revalidateOnFocus: false });
  const ui = useMemo(() => (inf.data ? (adaptLoadedToUi(inf.data) as ApiResult) : null), [inf.data]);
  // Los apellidos de las personas privadas del dossier se registran acá, en el render y antes de
  // pintar los paneles: antes lo hacía sólo ResultadoView, que carga aparte (next/dynamic), y
  // "Por qué se bloqueó" y el detalle técnico se pintaban primero con la lista vacía.
  const nombresPrivados = useMemo(() => (ui ? nombresPrivadosDe(ui) : []), [ui]);
  setRedactNames(nombresPrivados);
  const d = det.data;
  // El informe público (~120 KB de JS) empieza a bajar ya, a la par de los datos, y no recién
  // cuando llegan: así no se suma su descarga a la espera.
  useEffect(() => {
    void import("@/components/convocatoria/ResultadoView");
  }, []);

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
      title={d ? d.codigo : "Revisión"}
      subtitle="Decide si este análisis se publica"
      actions={
        <>
          <Link href="/admin/revision" className={claseBoton("secundario")}><ArrowLeft size={12} aria-hidden /> Cola</Link>
          {d?.procesamientoOcid && (
            <Link href={`/app/auditoria/${encodeURIComponent(d.procesamientoOcid)}`} target="_blank" className={claseBoton("secundario")}><ExternalLink size={12} aria-hidden /> Ver traza</Link>
          )}
        </>
      }
    >
      {!d && det.error ? (
        <ErrorCarga error={det.error} onReintentar={() => det.mutate()} />
      ) : !d ? (
        <EsqueletoPagina />
      ) : (
        <div className="space-y-6">
          <BarraDecision d={d} onDecidir={resolver} />
          <VistaPublicada
            ui={ui}
            publicada={d.estado === "activa" || d.estado === "confirmada"}
            ocid={(inf.data?.ocid ?? d.ocid ?? "").split("-").pop() || null}
            error={!inf.data && inf.error ? sinInforme(inf.error) : null}
            onReintentar={() => inf.mutate()}
          />
          {/* Los apellidos de personas privadas se tapan con el diccionario que arma el informe:
              hasta que llegue, el juicio del evaluador (que puede nombrarlas) espera. */}
          {ui || inf.error ? <PorQueBloqueo d={d} /> : <EsqueletoPorQue />}
          {(ui || inf.error) && <DetalleTecnico d={d} />}
        </div>
      )}
    </AdminShell>
  );
}

function ErrorCarga({ error, onReintentar }: { error: AdminError; onReintentar: () => void }) {
  const noExiste = error.status === 404 || error.status === 400;
  const x = explicarError(error);
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-line bg-paper p-6 text-center">
      <AlertTriangle size={28} className="mx-auto text-amberTexto" aria-hidden />
      <h2 className="mt-3 font-serif text-lg font-bold text-ink">{noExiste ? "Esta alerta no existe" : "No se pudo cargar la revisión"}</h2>
      <p className="mt-1 text-sm text-inkSoft">
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
