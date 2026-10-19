"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, Filter, Loader2, MessageSquareWarning, SearchX, SlidersHorizontal, WifiOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";
import { Ayuda } from "@/components/patrones/Ayuda";
import { LeyendaEscala } from "./LeyendaEscala";
import { ultimosMeses, type RangoMes } from "./meses";
import { FILTROS, MEDIDAS, type Escala, type FiltroZona, type Medida, type MedidaId } from "./escala";
import { hrefContratos, type FiltrosMapa } from "./filtrosMapa";
import { anioLectura, LECTURAS, TIPOS } from "@/lib/contratos";

/**
 * Barra de control del mapa, en cuatro bloques que se leen de arriba abajo:
 *
 *   1. Color del mapa: qué se pinta (monto, contratos, cola…) y qué zonas se resaltan.
 *   2. Contratos que cuentan: región, mes, partido que gobierna, tipo, lectura y antecedentes del ganador, todos
 *      desplegables del mismo estilo. En el celular se pliegan detrás de "Filtros (n)": a 390 px empujaban el mapa
 *      fuera de la pantalla.
 *   3. Lo que estás viendo: SIEMPRE visible. Cada filtro activo es un chip que se quita con ×, cuántos contratos
 *      cumplen, "Actualizando el mapa…" mientras llega y un aviso si ninguno cumple. Antes un filtro cambiaba el color
 *      sin decir nada y no se entendía qué estaba filtrado.
 *   4. Puntos sobre el mapa (riesgo, denuncias, mis zonas) y la leyenda de colores.
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
  nContratos,
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
  /** Contratos que cumplen todo lo elegido, en lo que se ve (país o región). `null` = cargando. */
  nContratos: number | null;
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
  const meses = useMemo(() => ultimosMeses(12), []);
  const [abiertos, setAbiertos] = useState(false);

  // Cada filtro activo, con su nombre legible y cómo quitarlo: los chips de "Lo que estás viendo".
  const nombreRegion = region ? regiones.find((r) => r.ubigeo === region)?.nombre ?? region : null;
  const chips: { clave: string; texto: string; quitar: () => void }[] = [];
  if (nombreRegion) chips.push({ clave: "region", texto: nombreRegion, quitar: () => onRegion(null) });
  if (mes) chips.push({ clave: "mes", texto: `Convocados en ${mes.etiqueta}`, quitar: () => onMes(null) });
  if (filtros.partido) {
    const p = partidos?.find((x) => x.clave === filtros.partido)?.nombre ?? filtros.partido;
    chips.push({ clave: "partido", texto: `Gobierna: ${p}`, quitar: () => onFiltros({ ...filtros, partido: undefined }) });
  }
  if (filtros.tipo) {
    chips.push({ clave: "tipo", texto: TIPOS.find((t) => t.value === filtros.tipo)?.label ?? filtros.tipo, quitar: () => onFiltros({ ...filtros, tipo: undefined }) });
  }
  if (filtros.lectura) {
    const l = LECTURAS.find((x) => x.value === filtros.lectura)?.label ?? filtros.lectura;
    chips.push({ clave: "lectura", texto: `Lectura: ${l}`, quitar: () => onFiltros({ ...filtros, lectura: undefined }) });
  }
  if (filtros.cruces) {
    chips.push({
      clave: "cruces",
      texto: filtros.cruces === "alta" ? "Ganador con un antecedente grave" : "Ganador con algún antecedente",
      quitar: () => onFiltros({ ...filtros, cruces: undefined }),
    });
  }
  const filtrosContrato = chips.filter((c) => c.clave !== "region").length;
  const quitarTodo = () => {
    onFiltros({});
    onMes(null);
  };

  return (
    <div className="space-y-3 px-4 py-3 sm:px-5">
      {/* 1. Color del mapa */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          className="scrollbar-warm -mx-4 flex max-w-[calc(100%+2rem)] shrink-0 items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-paperDeep p-0.5 px-4 sm:mx-0 sm:max-w-full sm:px-0.5"
          role="group"
          aria-label="Qué se pinta en el mapa"
        >
          <span className="shrink-0 whitespace-nowrap px-2 text-[11.5px] font-semibold text-inkSoft">Color del mapa</span>
          {MEDIDAS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onMedida(m.id)}
              aria-pressed={medida === m.id}
              title={m.ayuda}
              className={cn(
                "min-h-[36px] shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors duration-rapido sm:min-h-[30px]",
                // Granate = elegido (la marca), el mismo idioma en todos los controles.
                medida === m.id ? "bg-granate text-paper shadow-sm" : "text-ink hover:bg-paper",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        {/* "Resaltar": atenúa las zonas que no cumplen en vez de esconderlas (el valor está en ver dónde SÍ pasa). */}
        <Desplegable
          etiqueta="Resaltar zonas"
          valor={filtro === "todas" ? "" : filtro}
          todas="Ninguna en especial"
          opciones={FILTROS.filter((f) => f.id !== "todas").map((f) => ({ valor: f.id, etiqueta: f.label === "Riesgo medio o alto" ? "Con riesgo medio o alto" : f.label }))}
          onCambio={(v) => onFiltro((v || "todas") as FiltroZona)}
          ayuda={FILTROS.find((f) => f.id === filtro)?.ayuda}
        />
      </div>

      {/* 2. Contratos que cuentan */}
      <div className="rounded-xl border border-line bg-paperSoft p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
            <Filter size={14} aria-hidden className="text-granate" />
            Contratos que cuentan
          </p>
          {/* En el celular los filtros se pliegan: el mapa tiene que entrar en el primer pantallazo. */}
          <button
            type="button"
            onClick={() => setAbiertos((a) => !a)}
            aria-expanded={abiertos}
            aria-controls="filtros-mapa"
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium sm:hidden",
              filtrosContrato + (region ? 1 : 0) > 0 ? "border-granate bg-granate-50 text-granate" : "border-line bg-paper text-ink",
            )}
          >
            <SlidersHorizontal size={14} aria-hidden />
            {abiertos ? "Cerrar filtros" : "Filtros"}
            {chips.length > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-granate px-1 text-[11px] font-semibold text-paper">
                {chips.length}
              </span>
            )}
          </button>
        </div>
        <div id="filtros-mapa" className={cn("mt-2.5 grid-cols-1 gap-x-4 gap-y-2.5 sm:grid sm:grid-cols-2 lg:grid-cols-3", abiertos ? "grid" : "hidden")}>
          <Desplegable
            etiqueta="Región"
            valor={region ?? ""}
            todas="Todo el Perú"
            opciones={regiones.map((r) => ({ valor: r.ubigeo, etiqueta: r.nombre }))}
            onCambio={(v) => onRegion(v || null)}
            bloque
          />
          <Desplegable
            etiqueta="Mes de convocatoria"
            valor={mes?.desde ?? ""}
            todas={`Todo ${anioLectura()}`}
            opciones={meses.map((m) => ({ valor: m.desde, etiqueta: m.etiqueta }))}
            onCambio={(v) => onMes(meses.find((m) => m.desde === v) ?? null)}
            bloque
          />
          <Desplegable
            etiqueta="Partido que gobierna"
            valor={filtros.partido ?? ""}
            todas={partidos === null ? "Cargando…" : "Cualquiera"}
            opciones={(partidos ?? []).map((p) => ({ valor: p.clave, etiqueta: p.nombre }))}
            onCambio={(v) => onFiltros({ ...filtros, partido: v || undefined })}
            ayuda="El que ganó la elección del gobierno regional, provincial o distrital que contrató (JNE, período 2023–2026)."
            bloque
          />
          <Desplegable
            etiqueta="Tipo de contrato"
            valor={filtros.tipo ?? ""}
            todas="Todos"
            opciones={TIPOS.map((t) => ({ valor: t.value, etiqueta: t.label }))}
            onCambio={(v) => onFiltros({ ...filtros, tipo: (v || undefined) as FiltrosMapa["tipo"] })}
            bloque
          />
          <Desplegable
            etiqueta="¿Lo leyó Vigía?"
            valor={filtros.lectura ?? ""}
            todas="Todos"
            opciones={LECTURAS.map((l) => ({ valor: l.value, etiqueta: l.label }))}
            onCambio={(v) => onFiltros({ ...filtros, lectura: (v || undefined) as FiltrosMapa["lectura"] })}
            bloque
          />
          <Desplegable
            etiqueta="Antecedentes del ganador"
            valor={filtros.cruces ?? ""}
            todas="Todos"
            opciones={[
              { valor: "alta", etiqueta: "Con un antecedente grave" },
              { valor: "con", etiqueta: "Con algún antecedente" },
            ]}
            onCambio={(v) => onFiltros({ ...filtros, cruces: (v || undefined) as FiltrosMapa["cruces"] })}
            bloque
          />
        </div>
      </div>

      {/* 3. Lo que estás viendo */}
      <LoQueVes
        chips={chips}
        nContratos={nContratos}
        cargando={cargando}
        medida={medidaActual.titulo}
        quitarTodo={chips.length > 0 ? quitarTodo : null}
        hrefLista={hrefContratos(filtros, region)}
      />

      {/* 4. Puntos y leyenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex shrink-0 flex-wrap items-center gap-1.5" role="group" aria-label="Puntos sobre el mapa">
          <span className="flex items-center gap-0.5 text-[11.5px] font-semibold text-inkSoft">
            Puntos
            <Ayuda titulo="¿Qué son los puntos?">
              Los puntos se dibujan sobre el color y no siguen los filtros de contratos: muestran todos los contratos de riesgo
              medio o alto y todas las denuncias ciudadanas de la zona.
            </Ayuda>
          </span>
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
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-inkSoft" role="status" aria-live="polite">
            <WifiOff size={13} className="text-clayTexto" aria-hidden />
            Sin conexión con {sinConexion.join(" y ")}; reintentando…
          </span>
        )}
      </div>

      <LeyendaEscala escala={escala} medida={medidaActual} ambito={ambito} conPines={conPines} cargando={cargando} />
    </div>
  );
}

/**
 * "Lo que estás viendo": la respuesta a "¿qué filtra este mapa?" sin tener que leer los controles. Siempre visible,
 * con un borde de color cuando hay filtros, y anunciado al lector de pantalla cuando cambia.
 */
function LoQueVes({
  chips,
  nContratos,
  cargando,
  medida,
  quitarTodo,
  hrefLista,
}: {
  chips: { clave: string; texto: string; quitar: () => void }[];
  nContratos: number | null;
  cargando: boolean;
  medida: string;
  quitarTodo: (() => void) | null;
  hrefLista: string;
}) {
  const ninguno = !cargando && nContratos === 0;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5",
        ninguno ? "border-amber/50 bg-amber-soft" : chips.length ? "border-granate/40 bg-granate-50" : "border-line bg-paperDeep",
      )}
    >
      <span className="text-[12.5px] font-semibold text-ink">{chips.length ? "Estás viendo:" : "Estás viendo todos los contratos del Perú"}</span>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Filtros activos">
          {chips.map((c) => (
            <li key={c.clave}>
              <button
                type="button"
                onClick={c.quitar}
                className="inline-flex min-h-[30px] max-w-[18rem] items-center gap-1 rounded-full border border-granate/30 bg-paper py-0.5 pl-2.5 pr-1.5 text-[12.5px] font-medium text-ink transition-colors duration-rapido hover:border-granate hover:text-granate"
              >
                <span className="truncate">{c.texto}</span>
                <X size={13} aria-hidden />
                <span className="sr-only">Quitar este filtro</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        {cargando ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-inkSoft">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Actualizando el mapa…
          </span>
        ) : ninguno ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-amberTexto">
            <SearchX size={14} aria-hidden /> Ningún contrato cumple estos filtros
          </span>
        ) : nContratos != null ? (
          <span className="text-inkSoft">
            <strong className="font-semibold tabular-nums text-ink">{numero(nContratos)}</strong> {nContratos === 1 ? "contrato" : "contratos"} · color: {medida.toLowerCase()}
          </span>
        ) : null}
        {quitarTodo && (
          <button type="button" onClick={quitarTodo} className="font-semibold text-granate hover:underline">
            Quitar todo
          </button>
        )}
        {!ninguno && (
          <Link href={hrefLista} prefetch={false} className="inline-flex items-center gap-1 font-semibold text-granate hover:underline">
            Ver estos contratos <ArrowRight size={13} aria-hidden />
          </Link>
        )}
      </span>
    </div>
  );
}

/**
 * Un filtro del mapa: su pregunta y un desplegable con fondo y texto del modo (nada de gris sobre gris), borde de
 * marca cuando está puesto. `bloque`: ocupa su celda de la grilla (etiqueta arriba). `ayuda`: un ⓘ junto a la pregunta.
 */
function Desplegable({
  etiqueta,
  valor,
  todas,
  opciones,
  onCambio,
  ayuda,
  bloque = false,
}: {
  etiqueta: string;
  valor: string;
  todas: string;
  opciones: { valor: string; etiqueta: string }[];
  onCambio: (v: string) => void;
  ayuda?: string;
  bloque?: boolean;
}) {
  return (
    <label className={cn("min-w-0", bloque ? "flex flex-col gap-1" : "inline-flex w-full items-center gap-2 sm:w-auto")}>
      {/* Alto fijo: la etiqueta con ⓘ no baja su desplegable respecto de los demás de la fila. */}
      <span className="flex h-5 shrink-0 items-center gap-0.5 text-[11.5px] font-semibold text-inkSoft">
        {etiqueta}
        {ayuda && (
          <Ayuda titulo={etiqueta}>
            {ayuda}
          </Ayuda>
        )}
      </span>
      <select
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className={cn(
          "h-10 min-w-0 rounded-lg border bg-paper pl-3 pr-8 text-[13px] text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate sm:h-9",
          bloque ? "w-full" : "flex-1 sm:w-56 sm:flex-none",
          valor ? "border-granate font-semibold text-granate" : "border-line",
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
        "inline-flex min-h-[36px] sm:min-h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-paperDeep disabled:text-mute",
        activa && !vacia && !cargando
          ? "border-granate bg-granate-soft text-granate"
          : "border-line bg-paper text-ink hover:bg-paperDeep",
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
