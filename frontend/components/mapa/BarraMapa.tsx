"use client";

import { AlertTriangle, Bell, MessageSquareWarning, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ayuda } from "@/components/patrones/Ayuda";
import { FiltroMes, type RangoMes } from "./FiltroMes";
import { LeyendaEscala } from "./LeyendaEscala";
import { FILTROS, MEDIDAS, type Escala, type FiltroZona, type Medida, type MedidaId } from "./escala";

/**
 * Barra de control del mapa: qué se pinta, de qué mes, qué capas se ven y qué
 * significa cada tono. Todo lo que antes flotaba sobre el lienzo tapando
 * geografía vive acá.
 *
 * En pantalla angosta los controles van en UNA fila que se desliza, no en
 * cuatro filas de píldoras: a 390 px la barra sola empujaba el mapa por debajo
 * del primer pantallazo.
 */
export function BarraMapa({
  medida,
  onMedida,
  filtro,
  onFiltro,
  escala,
  medidaActual,
  ambito,
  conPines,
  cargando,
  mes,
  onMes,
  alertas,
  onAlertas,
  nAlertas,
  alertasParcial = false,
  denuncias,
  onDenuncias,
  nDenuncias,
  misZonas,
  onMisZonas,
  nMisZonas,
  sinConexion,
}: {
  medida: MedidaId;
  onMedida: (m: MedidaId) => void;
  filtro: FiltroZona;
  onFiltro: (f: FiltroZona) => void;
  escala: Escala;
  medidaActual: Medida;
  ambito: string;
  conPines: boolean;
  cargando: boolean;
  mes: RangoMes | null;
  onMes: (r: RangoMes | null) => void;
  alertas: boolean;
  onAlertas: () => void;
  /** Puntos de señal que se dibujan. `null` = cargando. */
  nAlertas: number | null;
  /** COMPAT-API-VIEJA: la lista de alertas llegó recortada, así que faltan puntos: el número es un piso. */
  alertasParcial?: boolean;
  denuncias: boolean;
  onDenuncias: () => void;
  /** Puntos de denuncia que se dibujan. `null` = cargando. */
  nDenuncias: number | null;
  misZonas: boolean;
  onMisZonas: () => void;
  nMisZonas: number;
  /** Qué fuentes no respondieron. Si hay alguna, se dice; nunca se rellena con otra cosa. */
  sinConexion: string[];
}) {
  return (
    <div className="space-y-3 px-4 py-3 sm:px-5">
      {/* Una fila deslizable en móvil; en escritorio, envuelve. Los grupos no
          tienen scroll propio en móvil: dos scrolls anidados no se entienden. */}
      <div className="scrollbar-warm -mx-4 flex flex-nowrap items-center gap-x-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:gap-x-4 sm:gap-y-2 sm:overflow-visible sm:px-0 sm:pb-0">
        {/* Qué se pinta */}
        <div
          className="flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-paperDeep p-0.5"
          role="group"
          aria-label="Qué se pinta en el mapa"
        >
          <span className="hidden shrink-0 whitespace-nowrap px-2 text-[11px] text-inkSoft sm:inline">Pintar por</span>
          {MEDIDAS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onMedida(m.id)}
              aria-pressed={medida === m.id}
              title={m.ayuda}
              className={cn(
                "min-h-[28px] shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
                // Granate = elegido (la marca), el mismo idioma en los dos grupos y en las capas.
                medida === m.id ? "bg-granate text-paper" : "text-inkSoft hover:bg-paper hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* "Ver solo": acota el mapa a la pregunta que el usuario tiene en la
            cabeza. Atenúa lo que no cumple en vez de esconderlo, porque el
            valor está en ver dónde SÍ pasa contra dónde no. */}
        <div
          className="flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-paperDeep p-0.5"
          role="group"
          aria-label="Acotar el mapa"
        >
          <span className="hidden shrink-0 whitespace-nowrap px-2 text-[11px] text-inkSoft sm:inline">Ver solo</span>
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFiltro(f.id)}
              aria-pressed={filtro === f.id}
              title={f.ayuda}
              className={cn(
                "min-h-[28px] shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
                filtro === f.id ? "bg-granate text-paper" : "text-inkSoft hover:bg-paper hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <FiltroMes valor={mes} onChange={onMes} />

        {/* Capas de puntos */}
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Capas del mapa">
          {/* Los puntos son los contratos de peso del riesgo medio o alto (lib/severidad ≥ 40):
              la capa se nombra por lo que dibuja, no "Señales" (§10.1). */}
          <BotonCapa activa={alertas} onClick={onAlertas} n={nAlertas} parcial={alertasParcial} icono={<AlertTriangle size={13} />} vacio="No hay contratos de riesgo medio o alto para dibujar">
            Riesgo medio o alto
          </BotonCapa>
          <BotonCapa activa={denuncias} onClick={onDenuncias} n={nDenuncias} icono={<MessageSquareWarning size={13} />} vacio="Todavía no hay denuncias ciudadanas">
            Denuncias
          </BotonCapa>
          {nMisZonas > 0 && (
            <BotonCapa activa={misZonas} onClick={onMisZonas} n={nMisZonas} icono={<Bell size={13} />} vacio="">
              Mis zonas
            </BotonCapa>
          )}
        </div>

        {sinConexion.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-inkSoft" role="status" aria-live="polite">
            <WifiOff size={13} className="text-clayTexto" aria-hidden />
            Sin conexión con {sinConexion.join(" y ")}; reintentando…
          </span>
        )}
      </div>

      {/* Aviso inevitable = una línea + ⓘ (§10.7): qué se acota por mes y qué no. */}
      {mes && (
        <p className="flex items-center gap-1 text-[12px] text-inkSoft" role="status">
          <span>
            Mostrando <strong className="font-semibold text-ink">{mes.etiqueta}</strong>
          </span>
          <Ayuda titulo="¿Qué cambia con el mes?">
            El color del mapa, el encabezado y la ficha de cada zona cuentan sólo los contratos de {mes.etiqueta}. El
            panel de la zona y los puntos de riesgo siguen mostrando todo el histórico.
          </Ayuda>
        </p>
      )}

      <LeyendaEscala escala={escala} medida={medidaActual} ambito={ambito} conPines={conPines} cargando={cargando} />
    </div>
  );
}

/**
 * Conmutador de capa. El estado encendido/apagado lo lleva el contraste, no el
 * matiz: el `bg-amber text-paper` que tenía antes da 3,47:1 y no llega al piso
 * de 4,5:1 para texto. Qué capa es cada una lo dicen el ícono y la palabra, que
 * además sobreviven al daltonismo; el color de cada capa se ve en sus puntos.
 *
 * El número es lo que se DIBUJA en el mapa. Mientras carga no es un cero
 * deshabilitado: es un esqueleto.
 */
function BotonCapa({
  activa,
  onClick,
  n,
  parcial = false,
  icono,
  vacio,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  n: number | null;
  /** Faltan puntos (lista recortada): el número se lee "N o más". */
  parcial?: boolean;
  icono: React.ReactNode;
  /** Por qué el botón está deshabilitado cuando no hay nada que mostrar. */
  vacio: string;
  children: React.ReactNode;
}) {
  const cargando = n === null;
  const vacia = n === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      disabled={vacia}
      aria-busy={cargando || undefined}
      className={cn(
        "inline-flex min-h-[28px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-paperDeep disabled:text-mute",
        activa && !vacia && !cargando
          ? "border-granate bg-granate-soft text-granate"
          : "border-line bg-paperDeep text-inkSoft hover:bg-paper hover:text-ink",
      )}
      title={vacia ? vacio : parcial && n !== null ? `Se dibujan ${n.toLocaleString("es-PE")}; la lista llegó incompleta y faltan otros` : undefined}
    >
      <span aria-hidden>{icono}</span>
      {/* En móvil la palabra no se ve pero se lee: con `hidden` el lector de pantalla perdía qué capa era. */}
      <span className="sr-only sm:not-sr-only">{children}</span>
      {cargando ? (
        <span className="inline-block h-2.5 w-4 animate-pulse rounded bg-paperEdge" aria-hidden />
      ) : (
        <span className="text-[11px] font-semibold tabular-nums">
          {n.toLocaleString("es-PE")}
          {parcial && (
            <>
              <span aria-hidden>+</span>
              <span className="sr-only"> o más, lista incompleta</span>
            </>
          )}
        </span>
      )}
      {cargando && <span className="sr-only">, cargando</span>}
    </button>
  );
}
