"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CircleDashed, Clock, FileCheck2 } from "lucide-react";
import { rutaContrato } from "@/lib/rutas";
import { PulseDot } from "@/components/ui/PulseDot";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { BotonFila, ProveedorDetalle, type DetalleFila } from "@/components/listado/DetalleFilas";
import { ChipsDetalle, CuerpoDetalle, DatosClave, PieDetalle, type DatoClave } from "@/components/patrones/Detalle";
import { PesoRiesgo } from "@/components/contratos/PesoRiesgo";
import { severidadDeContrato } from "@/lib/severidad";
import { PUBLIC_API_BASE, faseHumana, faseProgreso, type Procesamiento } from "@/lib/auditoria";
import { fecha, numero, oracion, porcentaje, relativo, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { aFilaVivo, deAnalisis, deProcesamiento, esAnalisisReal, unirLecturas, type FilaLectura, type FilaVivo, type FotoVivo } from "./vivo";

/**
 * «Últimas lecturas»: lo que los agentes de Vigía tienen entre manos ahora y lo último que terminaron de leer, en UN
 * bloque (antes eran dos, con 4 de 6 contratos repetidos y comportamientos distintos). Cada fila lleva su chip de peso
 * del riesgo, la entidad y el lugar con su ícono, y la fecha; al tocarla abre el panel compartido del kit (§14.4:
 * chips, cifras, datos clave y, al pie, el dictamen y la ficha), anclado al costado en escritorio.
 *
 * Honestidad: el punto late sólo si hay algo en análisis ahora. Si no, queda quieto y se dice desde cuándo no se
 * termina una lectura, con la fecha real del dato. Nunca se hace pasar lo leído por lo que se está leyendo.
 *
 * Se refresca cada ~10 s SOLO mientras la pestaña está visible; las lecturas se vuelven a pedir sólo cuando la cola
 * cambió. El servidor entrega la primera foto (props con sólo datos); el cliente la mantiene al día.
 */

const INTERVALO_MS = 10_000;
const MAX_FILAS = 6;

async function pedir(ruta: string): Promise<unknown | null> {
  try {
    const r = await fetch(`${PUBLIC_API_BASE}${ruta}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** "3 min", "1 h 5 min": cuánto lleva. */
function duracion(seg: number): string {
  if (seg < 60) return "menos de 1 min";
  const m = Math.floor(seg / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** «desde hace 3 h», «desde ayer», «desde el 12 oct.»: la fecha real de la última lectura terminada. */
function desdeCuando(iso: string): string {
  const r = relativo(iso);
  return /^(hace|ayer)/.test(r) ? r : `el ${r}`;
}

const pctDe = (f: FilaVivo) => faseProgreso({ estado: "procesando", faseIndex: f.faseIndex, faseActual: f.faseActual, fases: f.fases });
const faseDe = (f: FilaVivo) =>
  faseHumana({ estado: "procesando", faseActual: f.faseActual, faseIndex: f.faseIndex, fases: f.fases, iniciadoAt: null });

/** La lectura se publicó: tiene dictamen público que abrir. */
const publicable = (f: FilaLectura) => !f.enRevision && !f.descartada;

/** La palabra del chip de una lectura, para el nombre accesible de su fila (el botón lo reemplaza entero). */
function palabraLectura(f: FilaLectura): string {
  if (f.descartada) return "Descartada";
  if (!f.enRevision && f.score == null) return f.banderas === 0 ? "Sin señales" : "Leída";
  return severidadDeContrato({ score: f.score, banderas: f.banderas, enRevision: f.enRevision }).etiqueta;
}

/** El estado de una lectura terminada, con color, ícono y palabra (nunca color solo). */
function ChipLectura({ f }: { f: FilaLectura }) {
  if (f.descartada) {
    return (
      <span className="pill border-line bg-paperDeep text-inkSoft">
        <CircleDashed size={11} aria-hidden /> Descartada
      </span>
    );
  }
  // Leída y sin puntaje: sin señales si se sabe que no tiene ninguna; si no, sólo "leída" (nunca "sin leer").
  if (!f.enRevision && f.score == null) {
    if (f.banderas === 0) return <PesoRiesgo score={0} banderas={0} formato="pastilla" />;
    return (
      <span className="pill border-line bg-paperDeep text-inkSoft">
        <FileCheck2 size={11} aria-hidden /> Leída
      </span>
    );
  }
  return <PesoRiesgo score={f.score} banderas={f.banderas} enRevision={f.enRevision} formato="pastilla" />;
}

function ChipEnAnalisis() {
  return (
    <span className="pill border-moss/40 bg-moss/10 text-mossTexto">
      <PulseDot color="moss" size={6} /> En análisis
    </span>
  );
}

const FILA =
  "block w-full px-4 py-3 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5";

export function EnVivoInicio({ inicial }: { inicial: FotoVivo }) {
  const [foto, setFoto] = useState<FotoVivo>(inicial);
  // `desde` = el momento (ms) en que se tomó la foto; el reloj corre aparte para que el tiempo avance entre pedidos.
  const [desde, setDesde] = useState<number | null>(null);
  const [ahora, setAhora] = useState<number | null>(null);
  const [aviso, setAviso] = useState("");
  const enCurso = useRef(false);
  /** Lo que identifica el estado de la cola: si no cambió, las lecturas tampoco y no se vuelven a pedir. */
  const firma = useRef<string | null>(null);

  const refrescar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    try {
      const r = (await pedir("/financiamiento/procesamientos/resumen")) as { activos?: Record<string, any>[]; porEstado?: Record<string, number> } | null;
      if (!r) return;
      const activos = (r.activos ?? []).map(aFilaVivo);
      const total = r.porEstado?.procesando || activos.length;
      const nueva = `${r.porEstado?.procesado ?? "?"}|${activos.map((a) => a.ocid).join(",")}`;
      let lecturas: FilaLectura[] | null = null;
      if (nueva !== firma.current) {
        firma.current = nueva;
        const [cola, publicados] = (await Promise.all([
          pedir("/financiamiento/procesamientos?estado=procesado&limit=8"),
          pedir("/alertas/analizadas?limit=8&orden=reciente"),
        ])) as [{ data?: Procesamiento[] } | null, { items?: unknown[] } | null];
        const deCola = cola?.data ? cola.data.map(deProcesamiento) : null;
        const dePublicados = publicados?.items ? publicados.items.filter(esAnalisisReal).map(deAnalisis) : null;
        if (deCola || dePublicados) lecturas = unirLecturas([dePublicados ?? [], deCola ?? []], MAX_FILAS);
      }
      setFoto((prev) => ({
        enAnalisis: activos.slice(0, MAX_FILAS),
        totalEnAnalisis: total,
        vivoConocido: true,
        lecturas: lecturas ?? prev.lecturas,
      }));
      setDesde(Date.now());
      setAviso(activos.length > 0 ? `${total} ${total === 1 ? "contrato" : "contratos"} en análisis ahora.` : "Ahora no se está analizando ninguno.");
    } finally {
      enCurso.current = false;
    }
  }, []);

  const sinNada = inicial.enAnalisis.length === 0 && inicial.lecturas.length === 0;
  useEffect(() => {
    setDesde(Date.now());
    setAhora(Date.now());
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    const sondeo = setInterval(() => { if (document.visibilityState === "visible") void refrescar(); }, INTERVALO_MS);
    const alVolver = () => { if (document.visibilityState === "visible") void refrescar(); };
    document.addEventListener("visibilitychange", alVolver);
    if (sinNada) void refrescar();
    return () => { clearInterval(reloj); clearInterval(sondeo); document.removeEventListener("visibilitychange", alVolver); };
  }, [refrescar, sinNada]);

  const extra = desde != null && ahora != null ? Math.max(0, Math.round((ahora - desde) / 1000)) : 0;
  const vivo = foto.enAnalisis.length > 0;
  if (!vivo && foto.lecturas.length === 0) return null;

  const ultima = foto.lecturas[0]?.fecha ?? null;
  // El estado, en una línea: late sólo si de verdad hay algo en análisis; si no, la fecha real de la última lectura.
  const estado = vivo
    ? `${numero(foto.totalEnAnalisis)} en análisis ahora`
    : !foto.vivoConocido
      ? ultima ? `La última terminó ${relativo(ultima)}` : null
      : ultima ? `Sin lecturas desde ${desdeCuando(ultima)}` : "Ninguna en análisis ahora";

  const detalles: DetalleFila[] = [
    ...foto.enAnalisis.map((f) => detalleVivo(f, extra)),
    ...foto.lecturas.map(detalleLectura),
  ];

  return (
    <section aria-labelledby="lecturas-titulo" className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="lecturas-titulo" className="font-display text-seccion font-bold leading-tight text-ink">
          Últimas lecturas
        </h2>
        {estado && (
          <p className="inline-flex items-center gap-2 text-meta text-inkSoft">
            {vivo ? <PulseDot color="moss" size={8} /> : <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-mute" />}
            {estado}
          </p>
        )}
        <p className="sr-only" role="status" aria-live="polite">{aviso}</p>
      </div>

      <ProveedorDetalle detalles={detalles} nombre="Últimas lecturas">
        <ul className="divide-y divide-line">
          {foto.enAnalisis.map((f) => (
            <li key={`vivo-${f.ocid}`}>
              <BotonFila id={`vivo-${f.ocid}`} etiqueta={`${tituloDe(f.titulo)}: en análisis, ${faseDe(f)}. Ver el detalle`} className={FILA}>
                <span className="flex items-start gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-dato font-semibold leading-snug text-ink sm:line-clamp-1">{tituloDe(f.titulo)}</span>
                    <span className="mt-0.5 block truncate text-meta text-mute">
                      <Partes partes={[<span key="fase">{faseDe(f)}</span>, f.zona && <Dato key="lugar" tipo="lugar">{f.zona}</Dato>]} />
                    </span>
                    <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-paperDeep">
                      <span className="block h-full rounded-full bg-granate transition-[width] duration-700" style={{ width: `${Math.max(4, pctDe(f))}%` }} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <ChipEnAnalisis />
                    <Dato icono={Clock} nombre="Lleva" className="text-rotulo tabular-nums text-mute">
                      {duracion(f.desdeSeg + extra)}
                    </Dato>
                  </span>
                </span>
              </BotonFila>
            </li>
          ))}
          {/* recorte: las últimas lecturas; todas, con buscador, en «Ver la auditoría en vivo» y en Contratos */}
          {foto.lecturas.slice(0, MAX_FILAS).map((f) => (
            <li key={`leida-${f.ocid}`}>
              <BotonFila
                id={`leida-${f.ocid}`}
                etiqueta={`${tituloDe(f.titulo)}: ${palabraLectura(f)}, terminó ${f.fecha ? relativo(f.fecha) : "sin fecha"}. Ver el detalle`}
                className={FILA}
              >
                <span className="flex items-start gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-dato font-semibold leading-snug text-ink sm:line-clamp-1">{tituloDe(f.titulo)}</span>
                    <span className="mt-0.5 block truncate text-meta text-mute">
                      <Partes
                        partes={[
                          f.entidad && <Dato key="entidad" tipo="entidad">{tituloNatural(f.entidad)}</Dato>,
                          f.lugar && <Dato key="lugar" tipo="lugar">{f.lugar}</Dato>,
                        ]}
                      />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <ChipLectura f={f} />
                    <Dato tipo="fecha" nombre="Terminó" className="text-rotulo text-mute">
                      {f.fecha ? relativo(f.fecha) : "Sin fecha"}
                    </Dato>
                  </span>
                </span>
              </BotonFila>
            </li>
          ))}
        </ul>
      </ProveedorDetalle>

      {vivo && foto.totalEnAnalisis > foto.enAnalisis.length && (
        <p className="border-t border-line px-4 py-2.5 text-meta text-mute sm:px-5">
          y {numero(foto.totalEnAnalisis - foto.enAnalisis.length)} más en análisis.
        </p>
      )}
      <div className="border-t border-line px-4 py-3 sm:px-5">
        <Link href="/app/auditoria" className="inline-flex min-h-10 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline">
          Ver la auditoría en vivo <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

const tituloDe = (t: string | null) => (t ? oracion(t) : "Contrato sin título");

const NOTA_SENAL = "Una señal es un motivo para revisar un contrato, nunca una acusación.";

/** El panel de un contrato que se está analizando ahora (§14.4). */
function detalleVivo(f: FilaVivo, extra: number): DetalleFila {
  const pct = pctDe(f);
  return {
    id: `vivo-${f.ocid}`,
    titulo: tituloDe(f.titulo),
    descripcion: "Se está analizando ahora",
    contenido: (
      <CuerpoDetalle>
        <ChipsDetalle>
          <ChipEnAnalisis />
        </ChipsDetalle>
        <div>
          <p className="text-dato font-semibold text-ink">{faseDe(f)}</p>
          <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-full bg-paperDeep">
            <div className="h-full rounded-full bg-granate" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          <p className="mt-1.5 text-meta text-mute">{porcentaje(pct)} del recorrido de los agentes</p>
        </div>
        <DatosClave
          items={[
            { etiqueta: "Lleva", valor: duracion(f.desdeSeg + extra) },
            { etiqueta: "Lugar", valor: f.zona },
            { etiqueta: "Lo financia", valor: f.financiador || "Anónimo" },
          ]}
        />
        <p className="text-meta leading-snug text-mute">{NOTA_SENAL} El resultado aparece cuando terminan los agentes.</p>
      </CuerpoDetalle>
    ),
    pie: (
      <PieDetalle
        principal={
          <>
            <EnlaceAccion href={rutaContrato(f.ocid, "vivo")} flecha>
              Ver el análisis en vivo
            </EnlaceAccion>
            <EnlaceAccion variante="secundario" href={rutaContrato(f.ocid)}>
              Ver la ficha del contrato
            </EnlaceAccion>
          </>
        }
      />
    ),
  };
}

/** El panel de una lectura terminada (§14.4): su estado, sus señales por severidad, los datos y, al pie, el dictamen. */
function detalleLectura(f: FilaLectura): DetalleFila {
  const sev = f.porSeveridad;
  const conSenales = publicable(f) && sev != null && (f.banderas ?? 0) > 0;
  const datos: DatoClave[] = [
    { etiqueta: "Entidad", valor: f.entidad ? tituloNatural(f.entidad) : null },
    { etiqueta: "Lugar", valor: f.lugar },
    { etiqueta: "Terminó de leerse", valor: f.fecha ? fecha(f.fecha) : null },
  ];
  // En revisión se dice "En revisión" y nada más (§10.4): sin montos ni señales.
  if (publicable(f) && f.valorReferencial) datos.push({ etiqueta: "Valor referencial", valor: soles(f.valorReferencial), mono: true });
  if (publicable(f) && f.montoAdjudicado) datos.push({ etiqueta: "Monto adjudicado", valor: soles(f.montoAdjudicado), mono: true });
  if (f.financiador) datos.push({ etiqueta: "Lo financió", valor: f.financiador });
  if (f.comprobante) {
    datos.push({
      etiqueta: "Comprobante",
      valor: (
        <Link href={`/impacto/${f.comprobante}`} className="font-mono text-meta text-granate underline-offset-2 hover:underline">
          {f.comprobante}
        </Link>
      ),
    });
  }
  return {
    id: `leida-${f.ocid}`,
    titulo: tituloDe(f.titulo),
    descripcion: f.enRevision ? "Leída, en revisión humana" : f.descartada ? "Leída, alerta descartada" : "Ya se leyó",
    contenido: (
      <CuerpoDetalle>
        <ChipsDetalle>
          <ChipLectura f={f} />
        </ChipsDetalle>
        {conSenales && sev && (
          <CifrasEnFila
            chico
            items={[
              { valor: numero(sev.alta), etiqueta: "señales altas" },
              { valor: numero(sev.media), etiqueta: "señales medias" },
              { valor: numero(sev.baja), etiqueta: "señales bajas" },
            ]}
          />
        )}
        <DatosClave items={datos} />
        <p className="text-meta leading-snug text-mute">{NOTA_SENAL}</p>
      </CuerpoDetalle>
    ),
    pie: (
      <PieDetalle
        principal={
          <>
            {publicable(f) && (
              <EnlaceAccion href={rutaContrato(f.ocid, "dictamen")} flecha>
                Ver el dictamen
              </EnlaceAccion>
            )}
            <EnlaceAccion variante={publicable(f) ? "secundario" : "primario"} href={rutaContrato(f.ocid)}>
              Ver la ficha del contrato
            </EnlaceAccion>
          </>
        }
      />
    ),
  };
}
