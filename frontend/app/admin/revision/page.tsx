"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Eye, RefreshCw, Settings2, ShieldCheck, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch, PERFIL_LABEL, type MotivoBloqueo, type RevisionRow, type SelfEvalConfig } from "@/lib/admin";
import { precargarAdmin, refrescarAdmin, refrescarTodo, useAdmin } from "@/lib/useAdmin";
import { campoMotivo, decidirAlerta } from "@/components/admin/revision/decidir";
import { useSesionEquipo } from "@/lib/useEquipo";
import { puede } from "@/lib/permisos";
import { tipoLabel } from "@/lib/contratos";
import { Partes } from "@/components/ui/Partes";
import {
  Badge,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  Expandable,
  FilterChips,
  PageSection,
  StatCard,
  StatGrid,
  flechasRadio,
  fmtFechaHora,
  hace,
  mensajeError,
  motivoBloqueo,
  type Columna,
} from "@/components/admin/ui";

/**
 * Cola de revisión humana (plan 2026-09-16 · U4): alertas que la autoevaluación del pipeline
 * bloqueó (estado 'revision'). Arriba, cuántas y por qué (cada caja filtra la tabla); cada fila
 * dice el motivo en una frase y se abre para decidir. Publicar o descartar pide motivo (queda en
 * la bitácora y refresca el ranking).
 * Fuente: GET /api/admin/revision · PUT /api/admin/alertas/:id/estado · GET/PUT /api/admin/config/self_eval
 */

type Tab = "revision" | "resueltas";
type Clave = MotivoBloqueo["clave"] | "pipeline";
const pctTxt = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)} %`);

/** El motivo en una frase de persona, desde los números que ya trae el API (valor/umbral). */
function fraseMotivo(m: MotivoBloqueo): string {
  switch (m.clave) {
    case "respaldo": return `Solo ${pctTxt(m.valor)} de las banderas tiene respaldo en el expediente o las fuentes (se pide ${pctTxt(m.umbral)}).`;
    case "precio": return `Solo ${pctTxt(m.valor)} de los precios comparados es plausible (se pide ${pctTxt(m.umbral)}).`;
    case "cita": return `Solo ${pctTxt(m.valor)} de las banderas cita norma y fuente (se pide ${pctTxt(m.umbral)}).`;
    case "tono": return "El dictamen suena acusatorio.";
    case "coherencia": return "Hay ítems que no calzan con el objeto del contrato.";
    default: return m.texto;
  }
}

/**
 * Filas viejas sin `motivos` traen solo el texto que dejó el pipeline al bloquear
 * ("respaldo de banderas 0% < 60% (2 juzgadas); dictamen con tono acusatorio").
 * Se lee por partes: cada una da su clave (para la etiqueta y los filtros) y su frase.
 * La cita el pipeline la escribe al revés, como la fracción que FALTA y sin umbral
 * ("banderas sin norma/fuente 40% (5)", backend/agent/tools/self_eval.py): 40 % sin cita = 60 % con cita.
 */
const PATRONES: { clave: MotivoBloqueo["clave"]; re: RegExp; frase: (m: RegExpMatchArray) => string }[] = [
  { clave: "respaldo", re: /respaldo[^0-9]*(\d+)\s*%\s*<\s*(\d+)\s*%/i, frase: (m) => `Solo ${m[1]} % de las banderas tiene respaldo en el expediente o las fuentes (se pide ${m[2]} %).` },
  { clave: "precio", re: /precio[^0-9]*(\d+)\s*%\s*<\s*(\d+)\s*%/i, frase: (m) => `Solo ${m[1]} % de los precios comparados es plausible (se pide ${m[2]} %).` },
  { clave: "cita", re: /cita[^0-9]*(\d+)\s*%\s*<\s*(\d+)\s*%/i, frase: (m) => `Solo ${m[1]} % de las banderas cita norma y fuente (se pide ${m[2]} %).` },
  {
    clave: "cita",
    re: /sin\s+norma\s*\/\s*fuente[^0-9]*(\d+)\s*%(?:\s*\((\d+)\))?/i,
    frase: (m) => `Solo ${Math.max(0, 100 - Number(m[1]))} % de las banderas cita norma y fuente${m[2] ? ` (${m[2]} juzgadas)` : ""}.`,
  },
  { clave: "tono", re: /tono acusatorio/i, frase: () => "El dictamen suena acusatorio." },
  { clave: "coherencia", re: /incoheren/i, frase: () => "Hay ítems que no calzan con el objeto del contrato." },
];
function leerPipeline(texto: string): { claves: Clave[]; frase: string } {
  const claves: Clave[] = [];
  const frases = texto.split(";").map((parte) => {
    for (const p of PATRONES) {
      const m = parte.match(p.re);
      if (m) { claves.push(p.clave); return p.frase(m); }
    }
    const t = parte.trim();
    return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
  });
  return { claves: claves.length ? claves : ["pipeline"], frase: frases.filter(Boolean).join(" ") };
}

/**
 * El detalle y el informe (75 KB) empiezan a bajar cuando el mouse se detiene en una fila (150 ms),
 * no al clic; pasar de largo por la lista no baja nada.
 */
let esperaPrecarga: ReturnType<typeof setTimeout> | undefined;
function precargarDetalle(id: string) {
  clearTimeout(esperaPrecarga);
  esperaPrecarga = setTimeout(() => {
    precargarAdmin(`/revision/${id}`);
    precargarAdmin(`/revision/${id}/informe`);
  }, 150);
}

export default function RevisionPage() {
  // Al salir de la lista (el clic ya navegó), la precarga pendiente no tiene a quién servir.
  useEffect(() => () => clearTimeout(esperaPrecarga), []);
  const [tab, setTab] = useState<Tab>("revision");
  const [filtro, setFiltro] = useState<Clave | null>(null);
  // Sin keepPreviousData: al pasar a "Resueltas" no se pueden ver, ni un instante, las pendientes como si fueran resueltas.
  const { data, error, isLoading, isValidating, mutate } = useAdmin<{ data: RevisionRow[]; umbrales: SelfEvalConfig }>(`/revision?estado=${tab}`, { keepPreviousData: false });
  const rows = data?.data ?? null;
  const umbrales = data?.umbrales ?? null;
  const { open, toast } = useDialog();
  // Los umbrales los cambia un admin; el revisor los ve en las tarjetas de arriba.
  const { rol } = useSesionEquipo();

  function resolver(r: RevisionRow, estado: "activa" | "descartada") {
    const publicar = estado === "activa";
    open({
      title: publicar ? `Publicar ${r.codigo}` : `Descartar ${r.codigo}`,
      tone: publicar ? "success" : "danger",
      confirmLabel: publicar ? "Publicar" : "Descartar",
      body: publicar
        ? <>La alerta pasa a <strong>activa</strong>: aparece en listas públicas, mapa y ranking, y cuenta como señal hallada si tiene banderas. Motivo del bloqueo: <em>{r.motivo}</em></>
        : <>La alerta pasa a <strong>descartada</strong>: no se publica y deja de contar. El contrato sigue como procesado. Motivo del bloqueo: <em>{r.motivo}</em></>,
      fields: [campoMotivo(publicar ? "Revisé las banderas: la evidencia está en el expediente (pág. …)" : "Las banderas no se sostienen: …")],
      onConfirm: async (v) => {
        await decidirAlerta(r.id, estado, v.motivo);
        toast(`${r.codigo} ${publicar ? "publicada" : "descartada"}. Ranking refrescado.`);
        // La cola, el Resumen, la bitácora y el procesamiento cuentan esta alerta: todos al día.
        void refrescarTodo();
      },
    });
  }

  function editarUmbrales() {
    if (!umbrales) return;
    open({
      title: "Umbrales de la autoevaluación",
      confirmLabel: "Guardar",
      body: <>Explican aquí por qué se bloqueó cada alerta. Ojo: los servicios de agentes aplican los suyos (variables <code>EVAL_MIN_*</code>), así que un cambio acá hay que replicarlo en su despliegue para que bloqueen distinto.</>,
      fields: [
        { name: "min_respaldo", label: "Respaldo mínimo de banderas (0–1)", defaultValue: String(umbrales.min_respaldo), hint: "Bloquea si menos de esta fracción de banderas está respaldada por el expediente/OCDS/fuentes (≥ 2 juzgadas)." },
        { name: "min_cita", label: "Citas correctas mínimas (0–1)", defaultValue: String(umbrales.min_cita), hint: "Bloquea si menos de esta fracción de banderas cita norma y fuente (≥ 3 juzgadas)." },
        { name: "min_precio", label: "Precio plausible mínimo (0–1)", defaultValue: String(umbrales.min_precio), hint: "Bloquea si menos de esta fracción de veredictos de precio es plausible (≥ 3 ítems)." },
        { name: "bloquea_tono", label: "Bloquear por tono acusatorio", type: "select", defaultValue: umbrales.bloquea_tono ? "true" : "false", options: [{ value: "true", label: "Sí" }, { value: "false", label: "No" }] },
        { name: "bloquea_coherencia", label: "Bloquear por ítems incoherentes con el objeto", type: "select", defaultValue: umbrales.bloquea_coherencia ? "true" : "false", options: [{ value: "true", label: "Sí" }, { value: "false", label: "No" }] },
      ],
      onConfirm: async (v) => {
        const num = (k: string) => { const n = Number(v[k]); if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`"${k}" debe estar entre 0 y 1`); return n; };
        const body: SelfEvalConfig = { min_respaldo: num("min_respaldo"), min_cita: num("min_cita"), min_precio: num("min_precio"), bloquea_tono: v.bloquea_tono === "true", bloquea_coherencia: v.bloquea_coherencia === "true", nota: umbrales.nota ?? "" };
        try {
          await adminFetch("/config/self_eval", { method: "PUT", body: JSON.stringify(body) });
        } catch (e) { throw new Error(mensajeError(e)); }
        toast("Umbrales guardados");
        refrescarAdmin("/revision");
      },
    });
  }

  const clavesDe = (r: RevisionRow): Clave[] => (r.motivos.length ? r.motivos.map((m) => m.clave) : r.motivoPipeline ? leerPipeline(r.motivoPipeline).claves : []);
  const fraseDe = (r: RevisionRow) => (r.motivos.length ? r.motivos.map(fraseMotivo).join(" ") : leerPipeline(r.motivoPipeline ?? r.motivo).frase);
  // Filas por motivo. Una fila con el mismo motivo dos veces cuenta una; "Tono o coherencia" es una
  // sola caja: una fila con los dos motivos también cuenta una (antes sumaba dos).
  const porClave = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of rows ?? []) {
      const ks = new Set<string>(clavesDe(r));
      if (ks.has("coherencia")) ks.add("tono");
      ks.forEach((k) => { acc[k] = (acc[k] ?? 0) + 1; });
    }
    return acc;
  }, [rows]);
  const visibles = useMemo(() => (rows ?? []).filter((r) => !filtro || clavesDe(r).includes(filtro) || (filtro === "tono" && clavesDe(r).includes("coherencia"))), [rows, filtro]);
  const alternar = (k: Clave) => setFiltro((f) => (f === k ? null : k));
  const n = rows?.length ?? null;
  const umbral = (x: number | undefined) => (umbrales && x != null ? `se bloquea bajo ${Math.round(x * 100)} %` : undefined);

  const columnas: Columna<RevisionRow>[] = [
    {
      clave: "contrato",
      titulo: "Contrato",
      principal: true,
      className: "max-w-[340px]",
      celda: (r) => (
        <>
          <span className="font-mono text-xs font-medium text-ink">{r.codigo}</span>
          <span className="mt-0.5 line-clamp-2 text-[12px] text-inkSoft" title={r.objeto ?? ""}>{r.objeto ?? r.ocid}</span>
          <span className="block text-[11px] text-mute">
            <Partes partes={[PERFIL_LABEL[r.perfil ?? ""]?.split(" ")[0] ?? tipoLabel(r.tipo) ?? r.tipo, r.contribucionCodigo && `aporte ${r.contribucionCodigo}`]} />
          </span>
        </>
      ),
    },
    {
      clave: "entidad",
      titulo: "Entidad y zona",
      className: "max-w-[240px] text-[12px]",
      anchoCompletoMovil: true,
      celda: (r) => (
        <>
          <span className="line-clamp-2 text-ink" title={r.entidad ?? ""}>{r.entidad ?? r.entidadRuc ?? "Entidad sin dato"}</span>
          <span className="block text-[11px] text-mute">{r.zona ?? r.provincia ?? r.region ?? "Zona sin dato"}</span>
        </>
      ),
    },
    { clave: "score", titulo: "Puntaje", alinear: "derecha", celda: (r) => r.score ?? <span className="text-mute">—</span> },
    { clave: "banderas", titulo: "Banderas", alinear: "derecha", celda: (r) => r.banderas },
    {
      clave: "motivo",
      titulo: "Por qué se bloqueó",
      className: "max-w-[320px]",
      anchoCompletoMovil: true,
      celda: (r) => (
        <div className="text-[12px]">
          <div className="flex flex-wrap gap-1">
            {clavesDe(r).map((k) => {
              const m = motivoBloqueo(k);
              return <Badge key={k} tono={m.tono}>{m.label}</Badge>;
            })}
          </div>
          <p className="mt-1 line-clamp-2 text-inkSoft" title={r.motivo}>
            {fraseDe(r)}
          </p>
          {r.moderacion && (
            <p className="mt-1 text-[11px] text-mute">
              {r.moderacion.accion === "publicar" ? <CheckCircle2 size={11} className="inline text-moss" aria-hidden /> : <XCircle size={11} className="inline text-rust" aria-hidden />}{" "}
              {r.moderacion.accion === "publicar" ? "Publicada" : "Descartada"} por {r.moderacion.actor}, {fmtFechaHora(r.moderacion.at)}: {r.moderacion.motivo}
            </p>
          )}
        </div>
      ),
    },
    {
      clave: "analizado",
      titulo: "Analizada",
      className: "whitespace-nowrap text-[12px] text-mute",
      celda: (r) => <span title={fmtFechaHora(r.analizadoEn ?? r.createdAt) ?? undefined}>{hace(r.analizadoEn ?? r.createdAt) ?? "Sin fecha"}</span>,
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      acciones: true,
      celda: (r) => (
        <div className="inline-flex flex-wrap items-center justify-end gap-1">
          <Link href={`/admin/revision/${r.id}`} className={claseBoton("secundario", "xs")}><Eye size={11} aria-hidden /> Revisar</Link>
          {r.procesamientoOcid && (
            <Link href={`/app/auditoria/${encodeURIComponent(r.procesamientoOcid)}`} target="_blank" className={claseBoton("secundario", "xs")} title="Qué hizo cada revisión, paso a paso">
              <ExternalLink size={11} aria-hidden /> Traza
            </Link>
          )}
          {r.estado === "revision" && (
            <>
              <button onClick={() => resolver(r, "activa")} className={claseBoton("exito", "xs")}>Publicar</button>
              <button onClick={() => resolver(r, "descartada")} className={claseBoton("peligro", "xs")}>Descartar</button>
            </>
          )}
        </div>
      ),
    },
  ];

  const tonoActivos = umbrales ? [umbrales.bloquea_tono && "tono", umbrales.bloquea_coherencia && "coherencia"].filter(Boolean).join(" y ") : "";

  return (
    <AdminShell
      title="Revisión humana"
      subtitle="Alertas que la autoevaluación frenó: una persona decide si se publican"
      actions={
        <>
          {puede(rol, "editar_umbrales") && (
            <button onClick={editarUmbrales} disabled={!umbrales} className={claseBoton("secundario")}>
              <Settings2 size={12} aria-hidden /> Umbrales
            </button>
          )}
          <button onClick={() => mutate()} className={claseBoton("secundario")}>
            <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
          </button>
        </>
      }
    >
      <div className="space-y-8">
        <ErrorBanner error={error} onReintentar={() => mutate()} />

        <section aria-label="Por qué se bloquearon">
          {/* Las cajas son un filtro de selección única: para el lector de pantalla, un grupo de radios. */}
          <div role="radiogroup" aria-label="Filtrar por motivo del bloqueo" onKeyDown={flechasRadio}>
            <StatGrid columnas={5}>
              <StatCard
                etiqueta={tab === "revision" ? "Esperan decisión" : "Resueltas"}
                valor={n}
                cargando={isLoading}
                tono={tab === "revision" && (n ?? 0) > 0 ? "pending" : "neutral"}
                destacado={tab === "revision" && (n ?? 0) > 0}
                pista={filtro ? "toca una caja activa para quitar el filtro" : "todas las alertas de esta bandeja"}
                onClick={() => setFiltro(null)}
                activo={filtro === null}
                rol="radio"
              />
              <StatCard etiqueta="Poco respaldo" valor={rows ? porClave.respaldo ?? 0 : null} cargando={isLoading} tono="warn" pista={umbral(umbrales?.min_respaldo)} onClick={() => alternar("respaldo")} activo={filtro === "respaldo"} rol="radio" />
              <StatCard etiqueta="Precio dudoso" valor={rows ? porClave.precio ?? 0 : null} cargando={isLoading} tono="warn" pista={umbral(umbrales?.min_precio)} onClick={() => alternar("precio")} activo={filtro === "precio"} rol="radio" />
              <StatCard etiqueta="Sin cita" valor={rows ? porClave.cita ?? 0 : null} cargando={isLoading} tono="warn" pista={umbral(umbrales?.min_cita)} onClick={() => alternar("cita")} activo={filtro === "cita"} rol="radio" />
              <StatCard
                etiqueta="Tono o coherencia"
                valor={rows ? porClave.tono ?? 0 : null}
                cargando={isLoading}
                tono="danger"
                pista={umbrales ? (tonoActivos ? `bloquean: ${tonoActivos}` : "no bloquean hoy") : undefined}
                onClick={() => alternar("tono")}
                activo={filtro === "tono"}
                rol="radio"
              />
            </StatGrid>
          </div>
        </section>

        <PageSection
          titulo="Alertas"
          meta={rows ? `${visibles.length} de ${rows.length}` : undefined}
          acciones={
            <FilterChips<Tab>
              etiqueta="Bandeja"
              valor={tab}
              onCambiar={(t) => { setTab(t); setFiltro(null); }}
              opciones={[{ valor: "revision", etiqueta: "Pendientes" }, { valor: "resueltas", etiqueta: "Resueltas" }]}
            />
          }
        >
          <DataTable
            etiqueta="Alertas en revisión humana"
            columnas={columnas}
            filas={rows ? visibles : null}
            claveFila={(r) => r.id}
            hrefFila={(r) => `/admin/revision/${r.id}`}
            alAcercarse={(r) => precargarDetalle(r.id)}
            cargando={isLoading}
            apilarHasta="lg"
            vacio={
              filtro ? (
                <EmptyState compacto titulo="Ninguna alerta con este motivo" descripcion="Toca la caja de nuevo para ver todas." />
              ) : tab === "revision" ? (
                <EmptyState compacto icono={<ShieldCheck size={18} />} titulo="Nada espera revisión" descripcion="La autoevaluación dejó pasar todo lo procesado. Lo que frene aparece aquí." />
              ) : (
                <EmptyState compacto titulo="Todavía no se resolvió ninguna alerta" descripcion="Las que publiques o descartes quedan aquí con quién decidió y por qué." />
              )
            }
          />
          <Expandable variante="linea" resumen="Qué pasa con una alerta en revisión" className="mt-3">
            <p className="max-w-3xl leading-relaxed text-inkSoft">
              No aparece en listas públicas, en el mapa ni en el ranking; sí en su página de detalle, con la etiqueta de revisión.
              Cuenta como contrato procesado, pero no como señal hallada hasta que alguien la publique.
            </p>
          </Expandable>
        </PageSection>
      </div>
    </AdminShell>
  );
}
