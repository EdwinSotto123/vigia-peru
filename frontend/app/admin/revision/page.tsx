"use client";

import { rutaContrato } from "@/lib/rutas";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw, Settings2, ShieldCheck, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch, PERFIL_LABEL, type MotivoBloqueo, type RevisionRow, type SelfEvalConfig } from "@/lib/admin";
import { precargarAdmin, refrescarAdmin, refrescarTodo, useAdmin } from "@/lib/useAdmin";
import { campoMotivo, decidirAlerta } from "@/components/admin/revision/decidir";
import { useSesionEquipo } from "@/lib/useEquipo";
import { puede } from "@/lib/permisos";
import { tipoLabel } from "@/lib/contratos";
import { Partes } from "@/components/ui/Partes";
import { Ayuda } from "@/components/patrones/Ayuda";
import {
  Badge,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  FilterChips,
  MenuFila,
  PageSection,
  StatCard,
  flechasRadio,
  fmtFechaHora,
  hace,
  mensajeError,
  motivoBloqueo,
  type AccionMenu,
  type Columna,
} from "@/components/admin/ui";

/**
 * Cola de revisión humana (plan 2026-09-16, U4; rediseño 2026-10-30): alertas que la autoevaluación del pipeline
 * bloqueó (estado 'revision'). Arriba, cuántas y por qué en UNA fila de cifras que filtran la lista (en el celular la
 * fila se desliza de costado: antes eran tres renglones de cajas); abajo la lista, 25 por página. Cada fila dice el
 * motivo sólo con sus etiquetas: la frase con los números va en el `title` de cada etiqueta y, entera, en la ficha
 * (antes cada fila repetía «Solo 33 % de las banderas…» y el celular medía 10 pantallas). En el celular cada alerta
 * ocupa dos renglones: código y objeto; motivos y entidad. La fila abre la ficha, donde se decide; en escritorio
 * Publicar, Descartar y la traza también están en el menú «⋯» de la fila. Publicar o descartar pide motivo (queda en
 * la bitácora y refresca el ranking).
 * Fuente: GET /api/admin/revision · PUT /api/admin/alertas/:id/estado · GET/PUT /api/admin/config/self_eval
 */

type Tab = "revision" | "resueltas";
type Clave = MotivoBloqueo["clave"] | "pipeline";
/** Un motivo de la fila: su clave (etiqueta y filtro) y la frase con sus números, que va en el `title` de la etiqueta. */
type MotivoFila = { clave: Clave; frase: string };

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

/** Las claves (filtros y conteos), la frase entera y cada motivo con su propia frase (una etiqueta por motivo). */
function leerPipeline(texto: string): { claves: Clave[]; frase: string; motivos: MotivoFila[] } {
  const motivos: MotivoFila[] = [];
  const frases = texto.split(";").map((parte) => {
    for (const p of PATRONES) {
      const m = parte.match(p.re);
      if (m) {
        const frase = p.frase(m);
        motivos.push({ clave: p.clave, frase });
        return frase;
      }
    }
    const t = parte.trim();
    return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
  });
  const frase = frases.filter(Boolean).join(" ");
  // Un aviso que no se reconoce entero es un bloqueo del análisis, con todo su texto.
  if (!motivos.length) return { claves: ["pipeline"], frase, motivos: [{ clave: "pipeline", frase }] };
  return { claves: motivos.map((m) => m.clave), frase, motivos };
}

const clavesDe = (r: RevisionRow): Clave[] => (r.motivos.length ? r.motivos.map((m) => m.clave) : r.motivoPipeline ? leerPipeline(r.motivoPipeline).claves : []);
const fraseDe = (r: RevisionRow) => (r.motivos.length ? r.motivos.map(fraseMotivo).join(" ") : leerPipeline(r.motivoPipeline ?? r.motivo).frase);

/** Una etiqueta por motivo, sin repetir: el mismo motivo dos veces (dos tramos del aviso) junta sus frases. */
function motivosDe(r: RevisionRow): MotivoFila[] {
  const lista: MotivoFila[] = r.motivos.length
    ? r.motivos.map((m) => ({ clave: m.clave, frase: fraseMotivo(m) }))
    : r.motivoPipeline
      ? leerPipeline(r.motivoPipeline).motivos
      : [];
  const porClave = new Map<Clave, string[]>();
  for (const m of lista) porClave.set(m.clave, [...(porClave.get(m.clave) ?? []), m.frase]);
  return Array.from(porClave.entries()).map(([clave, frases]) => ({ clave, frase: frases.join(" ") }));
}

const entidadDe = (r: RevisionRow) => r.entidad ?? r.entidadRuc ?? null;
const zonaDe = (r: RevisionRow) => r.zona ?? r.provincia ?? r.region ?? null;

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

/**
 * Cada cifra-filtro en la fila de arriba: un ancho mínimo para que la etiqueta y la cifra con su pista quepan en dos
 * renglones; en escritorio las cinco se reparten el ancho, en el celular la fila se desliza de costado.
 */
const CIFRA = "min-w-[10.5rem] flex-1";

/**
 * «Por qué se bloqueó» de una fila: sólo las etiquetas de motivo, cada una con su frase en el `title`. En el celular
 * esta celda es el segundo renglón de la alerta: va primero la decisión ya tomada (en la bandeja de resueltas) y al final
 * la entidad, recortada; en escritorio la entidad tiene su columna y la decisión su renglón bajo las etiquetas.
 */
function MotivosFila({ r }: { r: RevisionRow }) {
  const motivos = motivosDe(r);
  const frase = fraseDe(r);
  const mod = r.moderacion;
  const publicada = mod?.accion === "publicar";
  // Quién y cuándo decidió («edwin@…, 12 oct., 10:04»), sin coma colgando si no hay fecha.
  const quien = mod ? [mod.actor, fmtFechaHora(mod.at)].filter(Boolean).join(", ") : "";
  const pipeline = motivoBloqueo("pipeline");
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5 lg:flex-wrap">
        {mod && (
          <Badge tono={publicada ? "ok" : "muted"} className="lg:hidden" title={`${quien}: ${mod.motivo}`}>
            {publicada ? "Publicada" : "Descartada"}
          </Badge>
        )}
        {motivos.length ? (
          motivos.map((m) => {
            const e = motivoBloqueo(m.clave);
            return <Badge key={m.clave} tono={e.tono} title={m.frase}>{e.label}</Badge>;
          })
        ) : frase ? (
          // Sin motivo reconocible (ni recalculado ni del pipeline): la etiqueta genérica, con el texto que dejó el API.
          <Badge tono={pipeline.tono} title={frase}>{pipeline.label}</Badge>
        ) : (
          <span className="text-rotulo text-mute">Sin motivo registrado</span>
        )}
        <span className="min-w-0 truncate text-rotulo text-mute lg:hidden">
          <Partes partes={[entidadDe(r), zonaDe(r)]} />
        </span>
      </span>
      {mod && (
        <span className="mt-0.5 hidden truncate text-micro text-mute lg:block" title={`${quien}: ${mod.motivo}`}>
          {publicada ? <CheckCircle2 size={11} className="inline text-moss" aria-hidden /> : <XCircle size={11} className="inline text-rust" aria-hidden />}{" "}
          {publicada ? "Publicada" : "Descartada"} por {quien}: {mod.motivo}
        </span>
      )}
    </>
  );
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
  // Los umbrales los cambia un admin; el revisor los ve en las cifras de arriba.
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

  // Filas por motivo. Una fila con el mismo motivo dos veces cuenta una; "Tono o coherencia" es una
  // sola cifra: una fila con los dos motivos también cuenta una (antes sumaba dos).
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
  // La pista de cada cifra es corta («mínimo 60 %»): con la cifra, cabe en un renglón también en el celular.
  const minimo = (x: number | undefined) => (umbrales && x != null ? `mínimo ${Math.round(x * 100)} %` : undefined);
  const pistaTono = !umbrales
    ? undefined
    : umbrales.bloquea_tono && umbrales.bloquea_coherencia
      ? "bloquean los dos"
      : umbrales.bloquea_tono
        ? "bloquea el tono"
        : umbrales.bloquea_coherencia
          ? "bloquea la coherencia"
          : "no bloquean hoy";

  /** Lo que se hace con una fila además de abrirla: decidir sin entrar y la traza del procesamiento. */
  const accionesDe = (r: RevisionRow): AccionMenu[] => [
    ...(r.estado === "revision"
      ? [
          { etiqueta: "Publicar", icono: <CheckCircle2 size={14} className="text-moss" aria-hidden />, onClick: () => resolver(r, "activa") },
          { etiqueta: "Descartar", icono: <XCircle size={14} aria-hidden />, onClick: () => resolver(r, "descartada"), peligro: true },
        ]
      : []),
    ...(r.procesamientoOcid
      ? [{ etiqueta: "Ver la traza", icono: <ExternalLink size={14} aria-hidden />, href: rutaContrato(r.procesamientoOcid, "vivo"), externo: true }]
      : []),
  ];

  const columnas: Columna<RevisionRow>[] = [
    {
      clave: "contrato",
      titulo: "Contrato",
      principal: true,
      className: "max-w-[320px]",
      // Escritorio: el código con su tipo y aporte, y el objeto debajo. Celular: código y objeto en un renglón.
      celda: (r) => (
        <span className="flex min-w-0 items-baseline gap-2 lg:block">
          <span className="flex shrink-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-rotulo leading-4 font-medium text-ink">{r.codigo}</span>
            <span className="hidden truncate text-micro text-mute lg:inline">
              <Partes partes={[PERFIL_LABEL[r.perfil ?? ""]?.split(" ")[0] ?? tipoLabel(r.tipo) ?? r.tipo, r.contribucionCodigo && `aporte ${r.contribucionCodigo}`]} />
            </span>
          </span>
          <span className="min-w-0 truncate text-rotulo text-inkSoft lg:block" title={r.objeto ?? ""}>{r.objeto ?? r.ocid}</span>
        </span>
      ),
    },
    {
      clave: "entidad",
      titulo: "Entidad y zona",
      className: "max-w-[210px] text-rotulo",
      soloEscritorio: true,
      celda: (r) => (
        <>
          <span className="block truncate text-ink" title={r.entidad ?? ""}>{entidadDe(r) ?? "Entidad sin dato"}</span>
          <span className="block truncate text-micro text-mute">{zonaDe(r) ?? "Zona sin dato"}</span>
        </>
      ),
    },
    { clave: "score", titulo: "Puntaje", alinear: "derecha", soloEscritorio: true, celda: (r) => r.score ?? <span className="text-mute">—</span> },
    { clave: "banderas", titulo: "Banderas", alinear: "derecha", soloEscritorio: true, celda: (r) => r.banderas },
    { clave: "motivo", titulo: "Por qué se bloqueó", className: "max-w-[260px]", celda: (r) => <MotivosFila r={r} /> },
    {
      clave: "analizado",
      titulo: "Analizada",
      soloEscritorio: true,
      className: "whitespace-nowrap text-rotulo text-mute",
      celda: (r) => <span title={fmtFechaHora(r.analizadoEn ?? r.createdAt) ?? undefined}>{hace(r.analizadoEn ?? r.createdAt) ?? "Sin fecha"}</span>,
    },
    {
      // Sólo escritorio: en el celular la fila ocupa dos renglones y se decide en la ficha (ahí Publicar y Descartar
      // quedan fijos al pie de la pantalla).
      clave: "menu",
      titulo: <span className="sr-only">Acciones</span>,
      soloEscritorio: true,
      className: "w-12 text-right",
      celda: (r) => {
        const acciones = accionesDe(r);
        return acciones.length ? <MenuFila acciones={acciones} etiqueta={`Acciones de ${r.codigo}`} /> : null;
      },
    },
  ];

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
      <div className="space-y-4">
        <ErrorBanner error={error} onReintentar={() => mutate()} />

        {/* Las cifras son un filtro de selección única: para el lector de pantalla, un grupo de radios. Una sola fila; en
            el celular se desliza de costado (de borde a borde) y el aire de arriba y abajo deja ver el anillo de foco. */}
        <section aria-label="Por qué se bloquearon">
          <div
            role="radiogroup"
            aria-label="Filtrar por motivo del bloqueo"
            onKeyDown={flechasRadio}
            className="-mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:-mx-1 lg:px-1 [&::-webkit-scrollbar]:hidden"
          >
            <StatCard
              className={CIFRA}
              etiqueta={tab === "revision" ? "Esperan decisión" : "Resueltas"}
              valor={n}
              cargando={isLoading}
              tono={tab === "revision" && (n ?? 0) > 0 ? "pending" : "neutral"}
              destacado={tab === "revision" && (n ?? 0) > 0}
              pista={filtro ? "ver todas" : "toda la bandeja"}
              onClick={() => setFiltro(null)}
              activo={filtro === null}
              rol="radio"
            />
            <StatCard className={CIFRA} etiqueta="Poco respaldo" valor={rows ? porClave.respaldo ?? 0 : null} cargando={isLoading} tono="warn" pista={minimo(umbrales?.min_respaldo)} onClick={() => alternar("respaldo")} activo={filtro === "respaldo"} rol="radio" />
            <StatCard className={CIFRA} etiqueta="Precio dudoso" valor={rows ? porClave.precio ?? 0 : null} cargando={isLoading} tono="warn" pista={minimo(umbrales?.min_precio)} onClick={() => alternar("precio")} activo={filtro === "precio"} rol="radio" />
            <StatCard className={CIFRA} etiqueta="Sin cita" valor={rows ? porClave.cita ?? 0 : null} cargando={isLoading} tono="warn" pista={minimo(umbrales?.min_cita)} onClick={() => alternar("cita")} activo={filtro === "cita"} rol="radio" />
            <StatCard className={CIFRA} etiqueta="Tono o coherencia" valor={rows ? porClave.tono ?? 0 : null} cargando={isLoading} tono="danger" pista={pistaTono} onClick={() => alternar("tono")} activo={filtro === "tono"} rol="radio" />
          </div>
        </section>

        <PageSection
          titulo="Alertas"
          // Sin filtro, el total ya está en la primera cifra (y en el paginador): el «N de M» sólo cuando filtra. Así el
          // título y los chips de la bandeja caben en un renglón también en el celular.
          meta={rows && filtro ? `${visibles.length} de ${rows.length}` : undefined}
          ayuda={
            <Ayuda titulo="¿Qué pasa con una alerta en revisión?">
              <span className="block">
                No aparece en listas públicas, en el mapa ni en el ranking, y no cuenta como señal hallada hasta que alguien la
                publique; sí se ve en su página de detalle, con la etiqueta de revisión.
              </span>
              <span className="mt-1.5 block">
                Cada cifra de arriba filtra la lista; su porcentaje es el mínimo que pide la autoevaluación. Abre una alerta
                para decidir: Publicar y Descartar te piden el motivo.
              </span>
            </Ayuda>
          }
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
            porPagina={25}
            compactoMovil
            anchoMinimo="min-w-[940px]"
            vacio={
              filtro ? (
                <EmptyState compacto titulo="Ninguna alerta con este motivo" descripcion="Toca la cifra otra vez para ver todas." />
              ) : tab === "revision" ? (
                <EmptyState compacto icono={<ShieldCheck size={18} />} titulo="Nada espera revisión" descripcion="La autoevaluación dejó pasar todo lo procesado. Lo que frene aparece aquí." />
              ) : (
                <EmptyState compacto titulo="Todavía no se resolvió ninguna alerta" descripcion="Las que publiques o descartes quedan aquí con quién decidió y por qué." />
              )
            }
          />
        </PageSection>
      </div>
    </AdminShell>
  );
}
