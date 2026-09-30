"use client";

/**
 * U6: sesión admin activa (cookie httpOnly de /admin/login, detectada con `useEsAdmin` en
 * ContribuirForm, nunca redirige a un visitante normal). El MISMO paso de cantidad que ve
 * cualquiera, pero en vez de "¿quién financia? / ¿cómo pagas?" hay un solo botón, "Procesar N
 * contratos a nombre de Vigía Perú", que llama a POST /admin/procesar-lote (sin pasarela,
 * resultado inmediato) en vez de POST /contribuciones.
 *
 * Por zona, los contratos salen por antigüedad (mínimo 5); por entidad, al azar entre los
 * suyos en cola (mínimo 1).
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, ShieldAlert, Zap } from "lucide-react";
import { numero, plural, soles } from "@/lib/formato";
import { procesarLote, type LoteProcesado } from "@/lib/admin";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda } from "@/components/patrones/Ayuda";
import { TarjetaConfirmacion } from "./TarjetaConfirmacion";
import { CantidadPicker, TARJETA, errorCantidad } from "./PasosAporte";
import { ERRORES_API, PRESETS, claveAlcance, cuerpoAlcance, erroresCampo, mensajeTope, minimoDe, type AlcanceAporte } from "./alcanceAporte";

/** Mismo tope que valida POST /admin/procesar-lote. */
const MAX_LOTE_ADMIN = 500;

export function LoteAdmin({ alcance, precioPen, restantes, padre = null }: {
  alcance: AlcanceAporte;
  precioPen: number;
  /** Contratos aún sin financiar (zona: `pendientes`; entidad: los que tiene en cola). */
  restantes: number;
  /** Zona superior, para cuando aquí quedan menos del mínimo (sólo por zona). */
  padre?: { ubigeo: string; nombre: string } | null;
}) {
  const minimo = minimoDe(alcance);
  const nombre = alcance.nombre;
  const porZona = alcance.tipo === "zona";
  const [cantidadTxt, setCantidadTxt] = useState<string>(String(Math.min(10, Math.max(restantes, minimo))));
  const [cantidadTocada, setCantidadTocada] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [procesado, setProcesado] = useState<LoteProcesado | null>(null);

  // POST /admin/procesar-lote acepta hasta 500 por lote.
  const tope = Math.min(restantes, MAX_LOTE_ADMIN);
  const contratos = /^\d+$/.test(cantidadTxt) ? Number.parseInt(cantidadTxt, 10) : Number.NaN;
  const errCantidad = contratos > MAX_LOTE_ADMIN && contratos <= restantes
    ? `Un lote de administrador procesa hasta ${MAX_LOTE_ADMIN} contratos.`
    : errorCantidad(contratos, restantes, minimo, mensajeTope(alcance, restantes));
  const monto = errCantidad ? null : contratos * precioPen;

  async function procesarAhora() {
    setError(null);
    setCantidadTocada(true);
    if (errCantidad) return;
    setLoading(true);
    try {
      setProcesado(await procesarLote(cuerpoAlcance(alcance), contratos));
    } catch (err) {
      const msg = (err as Error).message;
      setError(ERRORES_API[msg] ?? erroresCampo(minimo)[msg] ?? msg);
    } finally {
      setLoading(false);
    }
  }

  if (procesado) {
    return (
      <TarjetaConfirmacion
        titulo="Lote procesado a nombre de Vigía Perú"
        acciones={
          // El admin sigue su lote en el panel, no en la vista pública: antes los dos
          // botones llevaban a /impacto y /app/auditoria y el lote no se veía en el admin.
          <>
            <EnlaceAccion href={`/admin/procesamientos?lote=${encodeURIComponent(procesado.codigo)}`}>
              Seguir el lote en el panel <ArrowRight size={14} aria-hidden />
            </EnlaceAccion>
            <EnlaceAccion variante="secundario" href={`/impacto/${procesado.codigo}`}>
              Ver el comprobante público
            </EnlaceAccion>
          </>
        }
        pie={
          <button type="button" onClick={() => setProcesado(null)} className="min-h-[24px] underline underline-offset-2 hover:text-ink">
            Procesar otro lote {porZona ? "en" : "de"} {nombre}
          </button>
        }
      >
        <p>
          <span className="font-mono font-semibold text-ink">{procesado.codigo}</span>:{" "}
          <strong className="font-mono tabular-nums text-ink">{numero(procesado.asignados)}</strong> de{" "}
          {porZona ? <>{numero(procesado.solicitados)} contratos asignados en {nombre}.</> : <>{numero(procesado.solicitados)} contratos de {nombre} asignados.</>}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
          <li>
            {numero(procesado.listosParaProcesar)} ya tenían documentos{" "}
            {procesado.dispatcherDisparado ? "y su lectura empezó ahora mismo." : "y se leen en el próximo ciclo (hasta 5 min)."}
          </li>
          <li>{numero(procesado.pedidosAbiertos)} esperan sus documentos: se leen cuando el lote nocturno los descargue.</li>
        </ul>
      </TarjetaConfirmacion>
    );
  }

  return (
    <div className={TARJETA}>
      <Badge variant="amber">
        <ShieldAlert size={12} aria-hidden /> Modo administrador: a nombre de Vigía Perú, sin pasarela
      </Badge>
      <h2 className="mt-4 font-display text-xl font-bold leading-snug text-ink text-balance">
        ¿Cuántos contratos de {nombre} quieres procesar?
      </h2>
      <p className="mt-1 text-sm text-inkSoft">
        {soles(precioPen)} por contrato (referencial).{" "}
        {porZona ? `Quedan ${numero(restantes)} sin financiar.` : `${plural(restantes, "contrato", "contratos")} en cola.`}
      </p>
      {restantes >= minimo ? (
        <>
          <CantidadPicker
            nombreGrupo={`cantidad-${claveAlcance(alcance)}`}
            cantidadTxt={cantidadTxt}
            setCantidadTxt={setCantidadTxt}
            presets={PRESETS[alcance.tipo].filter((n) => n >= minimo && n <= tope)}
            tope={tope}
            esTodos={tope === restantes}
            precioPen={precioPen}
            monto={monto}
            error={cantidadTocada ? errCantidad : null}
            onBlur={() => setCantidadTocada(true)}
          />
          {error && <p className="mt-4 text-sm text-crimsonTexto" role="alert">{error}</p>}
          <Button type="button" full onClick={procesarAhora} disabled={loading || !!errCantidad} className="mt-5 py-3">
            {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Zap size={14} aria-hidden />}
            {errCantidad
              ? "Procesar a nombre de Vigía Perú"
              : `Procesar ${plural(contratos, "contrato", "contratos")} a nombre de Vigía Perú`}
          </Button>
        </>
      ) : (
        <p className="mt-4 rounded-xl bg-paperDeep px-3 py-2 text-[13px] text-inkSoft">
          {restantes === 0
            ? porZona ? "No quedan contratos sin financiar en esta zona." : "Esta entidad no tiene contratos en cola."
            : `Quedan ${numero(restantes)}, menos que el mínimo de ${minimo} por lote.`}
          {porZona && padre && <> Procesa <Link href={`/app/financiar/${padre.ubigeo}`} className="font-semibold text-granate underline underline-offset-2">{padre.nombre}</Link> en su lugar.</>}
        </p>
      )}
      <p className="mt-3 inline-flex flex-wrap items-center gap-1 text-[12px] text-mute">
        {porZona
          ? "Se asignan por antigüedad: nadie elige contratos, ni el admin."
          : "Se asignan al azar entre los de la entidad: nadie elige contratos, ni el admin."}
        <Ayuda titulo="¿Cuándo se leen?">
          Los que ya tienen sus documentos se leen ahora; los demás, cuando el lote nocturno los descargue.
        </Ayuda>
      </p>
    </div>
  );
}
