"use client";

import Link from "next/link";
import { AlertTriangle, Bell, MessageSquareWarning, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ayuda } from "@/components/patrones/Ayuda";
import { FiltroMes, type RangoMes } from "./FiltroMes";
import { LeyendaEscala } from "./LeyendaEscala";
import { FILTROS, MEDIDAS, type Escala, type FiltroZona, type Medida, type MedidaId } from "./escala";
import { hrefContratos, type FiltrosMapa } from "./filtrosMapa";
import { LECTURAS, TIPOS } from "@/lib/contratos";

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
  filtros,
  onFiltros,
  partidos,
  regiones,
  region,
  onRegion,
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
  /** Filtros de contratos (partido que gobierna, tipo, lectura, antecedentes): el mapa pinta sólo lo que cumple. */
  filtros: FiltrosMapa;
  onFiltros: (f: FiltrosMapa) => void;
  /** Partidos que gobiernan hoy; `null` = cargando. */
  partidos: { clave: string; nombre: string }[] | null;
  /** Departamentos, para ir a uno sin buscarlo en el mapa. */
  regiones: { ubigeo: string; nombre: string }[];
  region: string | null;
  onRegion: (ubigeo: string | null) => void;
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
          <span className="shrink-0 whitespace-nowrap px-2 text-[11px] font-medium text-mute">Pintar por</span>
          {MEDIDAS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onMedida(m.id)}
              aria-pressed={medida === m.id}
              title={m.ayuda}
              className={cn(
                "min-h-[36px] sm:min-h-[28px] shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
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
          <span className="shrink-0 whitespace-nowrap px-2 text-[11px] font-medium text-mute">Ver solo</span>
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFiltro(f.id)}
              aria-pressed={filtro === f.id}
              title={f.ayuda}
              className={cn(
                "min-h-[36px] sm:min-h-[28px] shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
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

      {/* Qué contratos cuentan: los mismos filtros de la lista de contratos, en desplegables. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label="Filtrar los contratos del mapa">
        <Desplegable
          etiqueta="Región"
          valor={region ?? ""}
          todas="Todo el Perú"
          opciones={regiones.map((r) => ({ valor: r.ubigeo, etiqueta: r.nombre }))}
          onCambio={(v) => onRegion(v || null)}
        />
        <Desplegable
          etiqueta="Partido que gobierna"
          valor={filtros.partido ?? ""}
          todas={partidos === null ? "Cargando…" : "Cualquiera"}
          opciones={(partidos ?? []).map((p) => ({ valor: p.clave, etiqueta: p.nombre }))}
          onCambio={(v) => onFiltros({ ...filtros, partido: v || undefined })}
          ancho="sm:max-w-[16rem]"
        />
        <Desplegable
          etiqueta="Tipo"
          valor={filtros.tipo ?? ""}
          todas="Todos"
          opciones={TIPOS.map((t) => ({ valor: t.value, etiqueta: t.label }))}
          onCambio={(v) => onFiltros({ ...filtros, tipo: (v || undefined) as FiltrosMapa["tipo"] })}
        />
        <Desplegable
          etiqueta="¿Lo leyó Vigía?"
          valor={filtros.lectura ?? ""}
          todas="Todos"
          opciones={LECTURAS.map((l) => ({ valor: l.value, etiqueta: l.label }))}
          onCambio={(v) => onFiltros({ ...filtros, lectura: (v || undefined) as FiltrosMapa["lectura"] })}
        />
        <Desplegable
          etiqueta="Antecedentes del ganador"
          valor={filtros.cruces ?? ""}
          todas="Todos"
          opciones={[
            { valor: "alta", etiqueta: "Con uno grave" },
            { valor: "con", etiqueta: "Con alguno" },
          ]}
          onCambio={(v) => onFiltros({ ...filtros, cruces: (v || undefined) as FiltrosMapa["cruces"] })}
        />
        {Object.values(filtros).some(Boolean) && (
          <span className="flex items-center gap-3 text-[12px]">
            <button type="button" className="font-medium text-granate hover:underline" onClick={() => onFiltros({})}>
              Quitar filtros
            </button>
            <Link href={hrefContratos(filtros, region)} prefetch={false} className="font-medium text-granate hover:underline">
              Ver estos contratos →
            </Link>
          </span>
        )}
      </div>

      {Object.values(filtros).some(Boolean) && (
        <p className="flex items-center gap-1 text-[12px] text-inkSoft" role="status">
          <span>El color y las cifras cuentan sólo los contratos que cumplen los filtros.</span>
          <Ayuda titulo="¿Qué cambia con los filtros?">
            El color del mapa, el encabezado y la ficha de cada zona cuentan sólo los contratos que cumplen. El partido es el
            que ganó la elección del gobierno regional, provincial o distrital que contrató (JNE, período 2023–2026). El
            panel de la zona y los puntos de riesgo siguen mostrando todo.
          </Ayuda>
        </p>
      )}

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
        "inline-flex min-h-[36px] sm:min-h-[28px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
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

/** Un filtro del mapa: su pregunta y un desplegable compacto (granate cuando está puesto). */
function Desplegable({
  etiqueta,
  valor,
  todas,
  opciones,
  onCambio,
  ancho = "sm:max-w-[12rem]",
}: {
  etiqueta: string;
  valor: string;
  todas: string;
  opciones: { valor: string; etiqueta: string }[];
  onCambio: (v: string) => void;
  ancho?: string;
}) {
  return (
    // En el celular cada filtro ocupa la fila (la etiqueta a la izquierda, el desplegable lo que queda); desde sm, compactos.
    <label className="flex w-full min-w-0 items-center gap-1.5 sm:inline-flex sm:w-auto">
      <span className="w-28 shrink-0 text-[11px] font-medium text-mute sm:w-auto">{etiqueta}</span>
      <select
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className={cn(
          "h-9 min-w-0 flex-1 rounded-full border bg-paper pl-3 pr-7 text-[12.5px] text-ink transition-colors duration-rapido hover:bg-paperSoft focus:border-granate sm:h-8 sm:flex-none",
          ancho,
          valor ? "border-granate/60 font-medium" : "border-line",
        )}
      >
        <option value="">{todas}</option>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
    </label>
  );
}
