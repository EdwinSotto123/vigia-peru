"use client";

import { useState } from "react";
import { BellRing, Loader2, Mail, Play } from "lucide-react";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { Aviso, Badge, DataTable, EmptyState, ErrorBanner, FilterChips, claseBoton, mensajeError, type Columna } from "@/components/admin/ui";
import { ESTADO_ENVIO, PRODUCTO, TIPO_ENVIO, type EnvioAdmin, type ResumenTareas } from "./tipos";

type FiltroEstado = "" | "enviado" | "en_la_web" | "fallido";

/** «12 alertas revisadas, 3 con novedades: 2 correos y 1 en la web». */
function resumir(r: ResumenTareas): string {
  const partes: string[] = [];
  if (r.alertas != null) partes.push(`${r.alertas} ${r.alertas === 1 ? "alerta revisada" : "alertas revisadas"}, ${r.conNovedades ?? 0} con novedades`);
  if (r.correos != null || r.enLaWeb != null) partes.push(`${r.correos ?? 0} por correo y ${r.enLaWeb ?? 0} en la web`);
  if (r.fallidas) partes.push(`${r.fallidas} fallaron`);
  if (r.recordatorios != null) partes.push(`${r.recordatorios} ${r.recordatorios === 1 ? "recordatorio" : "recordatorios"}`);
  if (r.vencidos != null) partes.push(`${r.vencidos} ${r.vencidos === 1 ? "plan vencido" : "planes vencidos"}`);
  return partes.join("; ") || "Listo";
}

/**
 * Lo último que Gobserva avisó (alertas, recordatorios de cierre y comprobantes) y si salió por correo, quedó en la web
 * (sin correo verificado o sin llaves de SES) o falló. Las alertas corren solas cada mañana a las 7:00 (Lima); aquí se
 * pueden correr ahora.
 */
export function EnviosGobserva({ correoActivo }: { correoActivo: boolean | undefined }) {
  const { data, error, isLoading, mutate } = useAdmin<{ data: EnvioAdmin[] }>("/gobserva/envios");
  const [estado, setEstado] = useState<FiltroEstado>("");
  const [corriendo, setCorriendo] = useState<"" | "alertas" | "todo">("");
  const { open, toast } = useDialog();
  const filas = data?.data.filter((e) => !estado || e.estado === estado);
  const cuenta = (e: FiltroEstado) => data?.data.filter((x) => x.estado === e).length ?? null;

  function correr(que: "alertas" | "todo") {
    open({
      title: que === "alertas" ? "Correr las alertas ahora" : "Correr las tareas de la mañana",
      confirmLabel: "Correr ahora",
      body:
        que === "alertas" ? (
          <>Revisa todas las alertas activas y avisa lo nuevo ahora, sin esperar a las 7:00. Cada alerta avisa una sola vez por lo mismo.</>
        ) : (
          <>Vence los planes que ya terminaron, corre las alertas y manda los recordatorios de cierre de pasado mañana, como el cron de las 7:00.</>
        ),
      onConfirm: async () => {
        setCorriendo(que);
        try {
          const r = await adminFetch<ResumenTareas>(`/gobserva/tareas${que === "alertas" ? "?solo=alertas" : ""}`, { method: "POST" });
          toast(resumir(r));
        } catch (e) {
          throw new Error(mensajeError(e));
        } finally {
          setCorriendo("");
        }
        void refrescarAdmin("/gobserva");
      },
    });
  }

  const columnas: Columna<EnvioAdmin>[] = [
    {
      clave: "asunto",
      titulo: "Aviso",
      principal: true,
      celda: (e) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink" title={e.asunto}>{e.asunto}</span>
          <span className="block truncate text-rotulo text-mute">{e.email ?? "Cuenta borrada"}</span>
        </span>
      ),
    },
    {
      clave: "tipo",
      titulo: "Tipo",
      celda: (e) => (
        <span className="block whitespace-nowrap text-meta text-ink">
          {TIPO_ENVIO[e.tipo] ?? e.tipo}, {PRODUCTO[e.producto] ?? e.producto}
          {e.nItems > 0 && <span className="block text-micro text-mute">{e.nItems} {e.nItems === 1 ? "resultado" : "resultados"}</span>}
        </span>
      ),
    },
    {
      clave: "estado",
      titulo: "Salió",
      celda: (e) => (
        <span className="block min-w-0">
          <Badge tono={ESTADO_ENVIO[e.estado]?.tono ?? "neutral"}>{ESTADO_ENVIO[e.estado]?.etiqueta ?? e.estado}</Badge>
          {e.error && <span className="mt-0.5 block truncate text-micro text-crimsonTexto" title={e.error}>{e.error}</span>}
        </span>
      ),
    },
    {
      clave: "creado",
      titulo: "Cuándo",
      alinear: "derecha",
      celda: (e) => <span className="whitespace-nowrap font-mono text-meta text-inkSoft">{e.creado}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      {correoActivo === false && (
        <Aviso tono="warn" icono={<Mail size={16} aria-hidden />} titulo="Los correos todavía no salen">
          Faltan las llaves de Amazon SES en la API: corre infrastructure/aws/crear_envio_ses.sh con un perfil administrador de AWS (y pide el acceso de producción de
          SES). Mientras tanto, cada aviso queda en la cuenta de la persona, en «Lo último que te avisamos».
        </Aviso>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterChips<FiltroEstado>
          etiqueta="Cómo salió"
          valor={estado}
          onCambiar={setEstado}
          opciones={[
            { valor: "", etiqueta: "Todos", cuenta: data?.data.length ?? null },
            { valor: "enviado", etiqueta: "Por correo", cuenta: cuenta("enviado") },
            { valor: "en_la_web", etiqueta: "En la web", cuenta: cuenta("en_la_web") },
            { valor: "fallido", etiqueta: "Fallaron", cuenta: cuenta("fallido"), tono: "danger" },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => correr("alertas")} disabled={!!corriendo} className={claseBoton("secundario", "sm")}>
            {corriendo === "alertas" ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <BellRing size={14} aria-hidden />} Correr las alertas
          </button>
          <button type="button" onClick={() => correr("todo")} disabled={!!corriendo} className={claseBoton("secundario", "sm")}>
            {corriendo === "todo" ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Play size={14} aria-hidden />} Correr todo
          </button>
        </div>
      </div>
      {error && <ErrorBanner error={error} onReintentar={() => mutate()} />}
      <DataTable
        columnas={columnas}
        filas={filas}
        claveFila={(e) => String(e.id)}
        etiqueta="Avisos de Gobserva"
        cargando={isLoading}
        porPagina={25}
        compactoMovil
        reinicio={estado}
        vacio={
          <EmptyState
            compacto
            icono={<Mail size={20} aria-hidden />}
            titulo={estado ? "Nada con ese filtro" : "Todavía no se avisó nada"}
            descripcion="Las alertas corren cada mañana a las 7:00; los comprobantes salen al confirmar cada pago."
          />
        }
      />
    </div>
  );
}
