"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, Loader2, MessageSquareWarning, Palette, SearchX, SlidersHorizontal, WifiOff, X } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";
import { Ayuda } from "@/components/patrones/Ayuda";
import { ultimosMeses, type RangoMes } from "./meses";
import { FILTROS, MEDIDAS, type FiltroZona, type Medida, type MedidaId } from "./escala";
import { hrefContratos, type FiltrosMapa } from "./filtrosMapa";
import { anioLectura, LECTURAS, TIPOS } from "@/lib/contratos";

/**
 * Barra de control del mapa: UNA superficie con divisores (antes eran cajas con borde dentro del bloque del mapa, y
 * otra dentro de esa). De arriba abajo:
 *
 *   1. Color del mapa (un desplegable compacto), los puntos que se dibujan encima y «Filtros (n)».
 *   2. Los filtros, plegados detrás de «Filtros (n)» también en escritorio: abiertos, empujaban el mapa fuera de la
 *      primera pantalla (el lienzo empezaba a 770 px). Lo que está puesto no se esconde: va como chip en la fila 3.
 *   3. «Estás viendo»: SIEMPRE visible. Cada filtro activo es un chip que se quita con ×, cuántos contratos cumplen,
 *      "Actualizando el mapa…" mientras llega y un aviso si ninguno cumple.
 *
 * La leyenda de colores va superpuesta en una esquina del lienzo (LeyendaEscala), no aquí.
 */
export function BarraMapa({
  medida,
  onMedida,
  filtro,
  onFiltro,
  medidaActual,
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
  medidaActual: Medida;
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
  const idFiltros = useId();

  // Cada filtro activo, con su nombre legible y cómo quitarlo: los chips de "Estás viendo".
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
  if (filtro !== "todas") {
    const f = FILTROS.find((x) => x.id === filtro);
    chips.push({ clave: "resaltar", texto: `Resaltadas: ${filtro === "senal" ? "con riesgo medio o alto" : (f?.label ?? filtro).toLowerCase()}`, quitar: () => onFiltro("todas") });
  }
  const quitarTodo = () => {
    onFiltros({});
    onMes(null);
    onFiltro("todas");
  };

  return (
    <div className="divide-y divide-line">
      {/* 1. Qué pinta el mapa, qué se dibuja encima y la puerta a los filtros */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-3 sm:px-5">
        <Desplegable
          etiqueta="Color del mapa"
          valor={medida}
          opciones={MEDIDAS.map((m) => ({ valor: m.id, etiqueta: m.label }))}
          onCambio={(v) => onMedida(v as MedidaId)}
          ayuda={medidaActual.ayuda}
        />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Puntos sobre el mapa">
          <span className="flex items-center gap-0.5 text-rotulo font-semibold text-inkSoft">
            Puntos
            <Ayuda titulo="¿Qué son los puntos?">
              Los puntos se dibujan sobre el color y no siguen los filtros ni el año: muestran todos los contratos leídos de
              riesgo medio o alto, de todos los años, y todas las denuncias ciudadanas de la zona.
            </Ayuda>
          </span>
          {/* La capa dice lo que cuenta: TODOS los años, sin filtros (la cifra del panel es la del año). */}
          <BotonCapa activa={alertas} onClick={onAlertas} n={nAlertas} parcial={alertasParcial} icono={<AlertTriangle size={13} />} vacio="No hay contratos de riesgo medio o alto para dibujar">
            Riesgo medio o alto, todos los años
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
        <button
          type="button"
          onClick={() => setAbiertos((a) => !a)}
          aria-expanded={abiertos}
          aria-controls={idFiltros}
          className={cn(
            "ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido sm:min-h-9",
            chips.length > 0 ? "border-granate bg-granate-50 text-granate" : "border-line bg-paper text-ink hover:bg-paperDeep",
          )}
        >
          <SlidersHorizontal size={14} aria-hidden />
          {abiertos ? "Cerrar filtros" : "Filtros"}
          {chips.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-granate px-1 text-micro font-semibold text-paper">
              {chips.length}
            </span>
          )}
        </button>
      </div>

      {/* 2. Qué contratos cuentan y qué zonas se resaltan, plegados (también en escritorio). */}
      <div id={idFiltros} className={cn("grid-cols-1 gap-x-4 gap-y-2.5 px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-4", abiertos ? "grid" : "hidden")}>
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
        {/* "Resaltar": atenúa las zonas que no cumplen en vez de esconderlas (el valor está en ver dónde SÍ pasa). */}
        <Desplegable
          etiqueta="Resaltar zonas"
          valor={filtro === "todas" ? "" : filtro}
          todas="Ninguna en especial"
          opciones={FILTROS.filter((f) => f.id !== "todas").map((f) => ({ valor: f.id, etiqueta: f.label === "Riesgo medio o alto" ? "Con riesgo medio o alto" : f.label }))}
          onCambio={(v) => onFiltro((v || "todas") as FiltroZona)}
          ayuda={FILTROS.find((f) => f.id === filtro)?.ayuda}
          bloque
        />
      </div>

      {/* 3. Lo que estás viendo */}
      <LoQueVes
        chips={chips}
        nContratos={nContratos}
        cargando={cargando}
        conMes={!!mes}
        medida={medidaActual.titulo}
        quitarTodo={chips.some((c) => c.clave !== "region") ? quitarTodo : null}
        hrefLista={hrefContratos(filtros, region, mes)}
      />

      {sinConexion.length > 0 && (
        <p className="flex items-center gap-1.5 px-4 py-2 text-rotulo text-inkSoft sm:px-5" role="status" aria-live="polite">
          <WifiOff size={13} className="text-clayTexto" aria-hidden />
          Sin conexión con {sinConexion.join(" y ")}; reintentando…
        </p>
      )}
    </div>
  );
}

/**
 * "Estás viendo": la respuesta a "¿qué muestra este mapa?" sin abrir los filtros. Siempre visible, como una fila de la
 * misma superficie (no una caja): teñida cuando hay filtros, ámbar si ninguno cumple, y anunciada al lector de pantalla
 * cuando cambia. Sin filtros dice el año: el mapa es de los contratos convocados este año, no de toda la base.
 */
function LoQueVes({
  chips,
  nContratos,
  cargando,
  conMes,
  medida,
  quitarTodo,
  hrefLista,
}: {
  chips: { clave: string; texto: string; quitar: () => void }[];
  nContratos: number | null;
  cargando: boolean;
  /** Hay un mes elegido: el conteo ya no es "del año". */
  conMes: boolean;
  medida: string;
  quitarTodo: (() => void) | null;
  hrefLista: string;
}) {
  const ninguno = !cargando && nContratos === 0;
  const anio = anioLectura();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5", ninguno ? "bg-amber-soft/60" : chips.length ? "bg-granate-50" : "")}
    >
      <span className="text-meta font-semibold text-ink">{chips.length ? "Estás viendo:" : `Estás viendo los contratos de ${anio} de todo el Perú`}</span>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Filtros activos">
          {chips.map((c) => (
            <li key={c.clave}>
              <button
                type="button"
                onClick={c.quitar}
                className="inline-flex min-h-[30px] max-w-[18rem] items-center gap-1 rounded-full border border-granate/30 bg-paper py-0.5 pl-2.5 pr-1.5 text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate hover:text-granate"
              >
                <span className="truncate">{c.texto}</span>
                <X size={13} aria-hidden />
                <span className="sr-only">Quitar este filtro</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
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
            <Partes
              partes={[
                <span key="n">
                  <strong className="font-semibold tabular-nums text-ink">{numero(nContratos)}</strong> {nContratos === 1 ? "contrato" : "contratos"}
                  {chips.length > 0 && !conMes ? ` de ${anio}` : ""}
                </span>,
                <Dato key="c" icono={Palette} nombre="Color del mapa">color por {medida.toLowerCase()}</Dato>,
              ]}
            />
          </span>
        ) : null}
        {quitarTodo && (
          <button type="button" onClick={quitarTodo} className="inline-flex min-h-[30px] items-center font-semibold text-granate hover:underline">
            Quitar todo
          </button>
        )}
        {!ninguno && (
          <Link href={hrefLista} prefetch={false} className="inline-flex min-h-[30px] items-center gap-1 font-semibold text-granate hover:underline">
            Ver estos contratos <ArrowRight size={13} aria-hidden />
          </Link>
        )}
      </span>
    </div>
  );
}

/**
 * Un control del mapa: su pregunta y un desplegable con fondo y texto del modo (nada de gris sobre gris), borde de
 * marca cuando está puesto. `bloque`: ocupa su celda de la grilla (etiqueta arriba); si no, la etiqueta va al lado.
 * `todas`: la opción vacía ("Todo el Perú"); sin ella, el desplegable siempre tiene un valor (el color del mapa).
 * `ayuda`: un ⓘ junto a la pregunta.
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
  todas?: string;
  opciones: { valor: string; etiqueta: string }[];
  onCambio: (v: string) => void;
  ayuda?: string;
  bloque?: boolean;
}) {
  const puesto = todas != null && !!valor;
  return (
    <label className={cn("min-w-0", bloque ? "flex flex-col gap-1" : "inline-flex items-center gap-2")}>
      {/* Alto fijo: la etiqueta con ⓘ no baja su desplegable respecto de los demás de la fila. */}
      <span className="flex h-5 shrink-0 items-center gap-0.5 text-rotulo font-semibold text-inkSoft">
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
          "h-10 min-w-0 rounded-lg border bg-paper pl-3 pr-8 text-meta text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate sm:h-9",
          bloque ? "w-full" : "max-w-[14rem]",
          puesto ? "border-granate font-semibold text-granate" : "border-line",
        )}
      >
        {todas != null && <option value="">{todas}</option>}
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
        "inline-flex min-h-[36px] sm:min-h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-rotulo leading-4 font-medium transition-colors duration-rapido",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-paperDeep disabled:text-mute",
        activa && !vacia && !cargando
          ? "border-granate bg-granate-soft text-granate"
          : "border-line bg-paper text-ink hover:bg-paperDeep",
      )}
      title={vacia ? vacio : parcial && n !== null ? `Se dibujan ${numero(n)}; la lista llegó incompleta y faltan otros` : undefined}
    >
      <span aria-hidden>{icono}</span>
      {/* En móvil la palabra no se ve pero se lee: con `hidden` el lector de pantalla perdía qué capa era. */}
      <span className="sr-only sm:not-sr-only">{children}</span>
      {cargando ? (
        <span className="inline-block h-2.5 w-4 animate-pulse rounded bg-paperEdge" aria-hidden />
      ) : (
        <span className="text-micro font-semibold tabular-nums">
          {numero(n)}
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
