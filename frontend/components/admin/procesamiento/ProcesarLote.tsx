"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Loader2, X, Zap } from "lucide-react";
import { procesarLote, type Operacion, type PreviewLote } from "@/lib/admin";
import { useAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";
import { useDialog } from "@/components/admin/Dialog";
import { Aviso, claseBoton, mensajeError, plural } from "@/components/admin/ui";
import { loteNocturnoParado } from "./tipos";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { PERIODOS_GOBIERNO, type AnioGobierno, type RankingPartidos } from "@/lib/partidosApi";
// ── Procesar a nombre de Vigía ────────────────────────────────────────────

interface ZonaCola { ubigeo: string; nombre: string; pendientes: number }
const MIN_LOTE = 5;
const MAX_LOTE = 500;
/** Un revisor procesa hasta 50 por lote (lo exige el API): cada contrato leído cuesta. */
const MAX_LOTE_REVISOR = 50;

const periodoLargo = (anio: AnioGobierno) => PERIODOS_GOBIERNO.find((p) => p.anio === anio)!.texto;

/** /api/zonas es público (mismos datos del mapa, caché de 5 min en el servidor). */
const pedirZonas = (url: string) => fetch(url).then((r) => r.json() as Promise<{ data?: ZonaCola[] }>);

/**
 * El mismo procesamiento que la página pública de financiar ofrece al admin,
 * pero sin salir del panel. Se asignan por antigüedad en la región: nadie,
 * tampoco el admin, elige qué contratos se leen.
 */
export function ProcesarLote({ op, onCerrar, onCreado }: { op: Operacion | null; onCerrar: () => void; onCreado: (codigo: string) => void }) {
  const maxLote = useSesionEquipo().rol === "revisor" ? MAX_LOTE_REVISOR : MAX_LOTE;
  // De dónde salen los contratos: una región (por antigüedad) o un partido en un período (al azar entre los de sus gobiernos).
  const [modo, setModo] = useState<"region" | "partido">("region");
  const [anio, setAnio] = useState<AnioGobierno>(2022);
  const [partido, setPartido] = useState("");
  const [ubigeo, setUbigeo] = useState("");
  const [cantidad, setCantidad] = useState(10);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { open, toast } = useDialog();

  // Cacheadas: cerrar y volver a abrir el panel (o volver a elegir una región) es instantáneo.
  const zonasQ = useSWR("/api/zonas", pedirZonas, { revalidateOnFocus: false });
  const zonas = useMemo<ZonaCola[] | null>(() => {
    if (!zonasQ.data) return zonasQ.error ? [] : null;
    return (zonasQ.data.data ?? []).filter((z) => z.pendientes > 0).sort((a, b) => b.pendientes - a.pendientes);
  }, [zonasQ.data, zonasQ.error]);

  // Los partidos del período con su cola (el mismo ranking público de /app/partidos).
  const partidosQ = useSWR<RankingPartidos>(
    modo === "partido" ? `${PUBLIC_API_BASE}/partidos/ranking?anio=${anio}` : null,
    (url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<RankingPartidos>) : Promise.reject(new Error(String(r.status))))),
    { revalidateOnFocus: false },
  );
  const partidos = useMemo(() => (partidosQ.data?.data ?? []).filter((p) => p.enCola > 0).sort((a, b) => b.enCola - a.enCola), [partidosQ.data]);

  // Sin keepPreviousData: al cambiar de región o de partido no queda a la vista la vista previa de la anterior.
  const rutaPreview = modo === "partido"
    ? partido ? `/procesar-lote/preview?partido=${encodeURIComponent(partido)}&anio=${anio}` : null
    : ubigeo ? `/procesar-lote/preview?ubigeo=${encodeURIComponent(ubigeo)}` : null;
  const previewQ = useAdmin<PreviewLote>(rutaPreview, { keepPreviousData: false });
  const preview = previewQ.data ?? null;
  const destino = modo === "partido" ? (preview?.partido?.nombre ?? "este partido") : (preview?.zona ?? "");
  useEffect(() => {
    if (!preview) return;
    setCantidad((c) => Math.max(Math.min(Math.round(c) || MIN_LOTE, preview.enCola, maxLote), Math.min(MIN_LOTE, preview.enCola)));
  }, [preview, maxLote]);
  useEffect(() => {
    if (previewQ.error) setError(mensajeError(previewQ.error));
  }, [previewQ.error]);

  const tope = preview ? Math.min(preview.enCola, maxLote) : 0;
  // El API sólo acepta enteros: 10,5 contratos no se puede pedir.
  const entero = Number.isInteger(cantidad);
  const valido = !!preview && preview.enCola >= MIN_LOTE && entero && cantidad >= MIN_LOTE && cantidad <= tope;
  // Sólo se dice que el lote nocturno no corre si /operacion lo dice: mientras carga (null) o con
  // un lote en curso, no (antes, sin datos, lo afirmaba igual).
  const loteParado = loteNocturnoParado(op) === true;

  function confirmar() {
    if (!preview || !valido) return;
    open({
      title: `Procesar ${cantidad} contratos de ${modo === "partido" ? `${destino} en ${periodoLargo(anio)}` : preview.zona}`,
      confirmLabel: "Procesar",
      body: (
        <>
          A nombre de Vigía Perú, sin pasarela. Costo referencial <strong>S/ {(cantidad * preview.precioPen).toLocaleString("es-PE")}</strong>. Se asignan los{" "}
          {modo === "partido" ? <>{cantidad} al azar entre los de las entidades que gobernó en ese período.</> : <>{cantidad} más antiguos de la región.</>}
          {loteParado && <> Los que no tengan documentos van a esperar al lote nocturno, que hoy no está corriendo.</>}
        </>
      ),
      onConfirm: async () => {
        setTrabajando(true);
        try {
          const r = await procesarLote(modo === "partido" ? { partido: { clave: partido, anio } } : ubigeo, cantidad);
          toast(
            `${r.codigo}: ${plural(r.asignados, "asignado", "asignados")}, ${plural(r.listosParaProcesar, "ya puede leerse", "ya pueden leerse")} y ${plural(r.pedidosAbiertos, "espera", "esperan")} documentos`,
          );
          onCreado(r.codigo);
        } catch (e) {
          throw new Error(mensajeError(e));
        } finally {
          setTrabajando(false);
        }
      },
    });
  }

  return (
    <section className="mb-5 rounded-2xl border border-granate/30 bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Procesar a nombre de Vigía Perú</h2>
          <p className="mt-0.5 text-[13px] text-inkSoft">
            {modo === "partido"
              ? "Se leen contratos al azar de las entidades que el partido gobernó en el período. Nadie elige cuáles."
              : "Se leen los contratos más antiguos de la región que elijas. Nadie elige cuáles."}
          </p>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar" className={claseBoton("fantasma", "xs", "p-1")}>
          <X size={16} aria-hidden />
        </button>
      </div>

      <div role="radiogroup" aria-label="De dónde salen los contratos" className="mt-3 inline-flex rounded-full border border-line bg-paperSoft p-1 text-sm">
        {(["region", "partido"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={modo === m}
            onClick={() => { setError(null); setModo(m); }}
            className={"rounded-full px-3.5 py-1 font-medium transition-colors " + (modo === m ? "bg-granate text-paper" : "text-inkSoft hover:text-ink")}
          >
            {m === "region" ? "Por región" : "Por partido"}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] sm:items-end">
        {modo === "partido" ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.5fr)]">
            <label className="block text-sm">
              <span className="font-medium text-inkSoft">Período</span>
              <select
                value={anio}
                onChange={(e) => { setError(null); setPartido(""); setAnio(Number(e.target.value) as AnioGobierno); }}
                className="mt-1 w-full rounded-xl border border-line bg-paperDeep px-3 py-2 text-ink focus:border-granate/60"
              >
                {PERIODOS_GOBIERNO.map((p) => <option key={p.anio} value={p.anio}>{p.texto}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-inkSoft">Partido</span>
              <select
                value={partido}
                onChange={(e) => { setError(null); setPartido(e.target.value); }}
                className="mt-1 w-full rounded-xl border border-line bg-paperDeep px-3 py-2 text-ink focus:border-granate/60"
              >
                <option value="">{partidosQ.isLoading ? "Cargando partidos…" : "Elige un partido"}</option>
                {partidos.map((p) => (
                  <option key={p.clave} value={p.clave}>{p.nombre} ({p.enCola.toLocaleString("es-PE")} sin leer)</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
        <label className="block text-sm">
          <span className="font-medium text-inkSoft">Región</span>
          <select
            value={ubigeo}
            onChange={(e) => {
              setError(null);
              setUbigeo(e.target.value);
            }}
            className="mt-1 w-full rounded-xl border border-line bg-paperDeep px-3 py-2 text-ink focus:border-granate/60"
          >
            <option value="">{zonas === null ? "Cargando regiones…" : "Elige una región"}</option>
            {(zonas ?? []).map((z) => (
              <option key={z.ubigeo} value={z.ubigeo}>
                {z.nombre} ({z.pendientes.toLocaleString("es-PE")} sin leer)
              </option>
            ))}
          </select>
        </label>
        )}
        <label className="block text-sm">
          <span className="font-medium text-inkSoft">Contratos</span>
          <input
            type="number"
            inputMode="numeric"
            step={1}
            min={MIN_LOTE}
            max={tope || undefined}
            value={Number.isFinite(cantidad) ? cantidad : ""}
            disabled={!preview}
            aria-invalid={!!preview && !entero ? true : undefined}
            onChange={(e) => setCantidad(e.target.value === "" ? NaN : Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-line bg-paperDeep px-3 py-2 font-mono text-ink focus:border-granate/60 disabled:opacity-50"
          />
        </label>
        <div className="text-sm">
          <span className="font-medium text-inkSoft">Costo referencial</span>
          <p className="mt-1 rounded-lg bg-paperSoft px-3 py-2 font-mono text-ink">{preview && entero ? `S/ ${(cantidad * preview.precioPen).toLocaleString("es-PE")}` : "—"}</p>
        </div>
        <button onClick={confirmar} disabled={!valido || trabajando} className={claseBoton("marca", "md")}>
          {trabajando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Zap size={14} aria-hidden />} Procesar
        </button>
      </div>
      {preview && (
        <p className="mt-2 text-[12px] text-inkSoft">
          {modo === "partido" ? `${destino}, ${periodoLargo(anio)}` : preview.zona}: {preview.enCola.toLocaleString("es-PE")} contratos sin financiar.{" "}
          {preview.enCola < MIN_LOTE ? `El mínimo por lote es ${MIN_LOTE}.` : `Entre ${MIN_LOTE} y ${tope.toLocaleString("es-PE")} por lote, en números enteros.`}
        </p>
      )}
      {error && (
        <Aviso tono="danger" className="mt-3">
          {error}
        </Aviso>
      )}
    </section>
  );
}
