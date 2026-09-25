"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PresupuestoRegional } from "@/components/PresupuestoRegional";
import { REGION_TO_MEF_DEPT } from "@/lib/peru-data";
import { X, MessageSquareWarning, Camera, ArrowRight, ArrowUpRight, CheckCircle2 } from "lucide-react";
import {
  getZona,
  ESTADO_LABEL,
  alcanceCorto,
  alcanceLargo,
  pct,
  type ZonaDetalle,
} from "@/lib/financiamiento";
import { fechaCorta, numero, soles, solesCompacto } from "@/lib/formato";
import { Skeleton } from "@/components/ui/Skeleton";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, CuerpoDetalle, DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { Indicadores } from "@/components/listado/Indicadores";
import type { ContratoZona } from "@/lib/contratos";
import { CATEGORIA_META, estaConfirmada, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { cn } from "@/lib/utils";
import { EntidadesDeZona } from "./EntidadesDeZona";
import { AlertasDeZona } from "./AlertasDeZona";
import { belongsToRegion } from "./region-match";
import { departamentoDeAlerta, MIN_CONFIRMACIONES, tieneSenales } from "./senales";
import { ContratosLista, useMapaContratos } from "@/components/contratos/ContratosLista";
import { SeguirZonaBoton } from "./SeguirZonaBoton";

export type ZonaTab = "resumen" | "cola" | "entidades" | "alertas" | "denuncias" | "presupuesto";

export const ORDEN_TABS: ZonaTab[] = ["resumen", "cola", "entidades", "alertas", "denuncias", "presupuesto"];

/** Nombre humano de cada pestaña: es lo que lee el lector de pantalla, no el id interno. */
export const TAB_LABEL: Record<ZonaTab, string> = {
  resumen: "Resumen",
  cola: "Cola",
  entidades: "Entidades",
  alertas: "Señales",
  denuncias: "Denuncias",
  presupuesto: "Presupuesto",
};

const enteros = (n: number) => numero(n);

export interface ZonaHubPanelProps {
  /** Slug de `lib/peru-data` (p. ej. "ancash"). */
  regionId: string;
  /** Ubigeo INEI del departamento (2 dígitos). */
  ubigeo: string;
  nombre: string;
  onClose?: () => void;
  /** Alertas ya cargadas por el mapa (se filtran por departamento acá). `null` = cargando. */
  alertas: any[] | null;
  /** Denuncias ciudadanas ya cargadas por el mapa. `null` = cargando. */
  reportes: any[] | null;
  /**
   * Cifras del departamento en `/contratos/geo`, SIN filtro de mes. Son la única
   * fuente de "leídos" y "con señal": cuentan toda lectura, se haya financiado
   * o no. `undefined` = cargando; `null` = no respondió.
   */
  geo: ContratoZona | null | undefined;
  /** Pestaña abierta. La controla el mapa, que la escribe en `?tab=`. */
  tab: ZonaTab;
  onTab: (t: ZonaTab) => void;
}

/**
 * Panel lateral del mapa cuando hay un departamento abierto: qué espera
 * auditoría, qué se encontró, quién contrata, qué denuncian los vecinos, y las
 * dos acciones que una persona puede tomar.
 *
 * Una fuente por concepto. "Leídos" y "con señal" salen de `/contratos/geo`
 * (cuentan toda lectura); "esperando" y "financiados" salen de
 * `/financiamiento/zonas`. Antes el panel tomaba "leídos" y "con señal" del
 * financiamiento, que sólo cuenta lo financiado, y Lima decía "Leídos 0" y
 * "Con señal 0 de 0" al lado de un encabezado con 19 leídos y 6 con señal.
 *
 * Ninguna cifra va sola: toda cifra lleva su contexto en la misma línea, y la
 * frase completa ("de 4.704 ingresados", "en 203 entidades") la escribe quien
 * arma la fila, porque no toda cifra tiene un denominador.
 */
export function ZonaHubPanel({ regionId, ubigeo, nombre, onClose, alertas, reportes, geo, tab, onTab }: ZonaHubPanelProps) {
  const [detalle, setDetalle] = useState<ZonaDetalle | null | undefined>(undefined);
  const tabRefs = useRef<Partial<Record<ZonaTab, HTMLButtonElement | null>>>({});

  // Sólo depende del departamento: cambiar de pestaña o tocar una provincia no vuelve a pedir la zona.
  useEffect(() => {
    setDetalle(undefined);
    let vivo = true;
    if (!ubigeo) {
      setDetalle(null);
      return;
    }
    getZona(ubigeo).then((d) => vivo && setDetalle(d));
    return () => {
      vivo = false;
    };
  }, [ubigeo]);

  // "Con señales" = al menos una señal publicada, de cualquier peso (§10.1): es lo que lista la pestaña.
  const nSenales = useMemo(
    () => (alertas ? alertas.filter((a) => tieneSenales(a) && departamentoDeAlerta(a) === ubigeo).length : null),
    [alertas, ubigeo],
  );
  const reportesRegion = useMemo(() => (reportes ? reportes.filter((r) => belongsToRegion(r, regionId)) : null), [reportes, regionId]);

  const zona = detalle?.zona ?? null;
  const financiarHref = ubigeo ? `/app/financiar/${ubigeo}` : "/app/financiar";
  const denunciarHref = `/reporte/nuevo?region=${encodeURIComponent(regionId)}`;
  const enVivoHref = ubigeo ? `/app/auditoria?ubigeo=${ubigeo}` : "/app/auditoria";

  const irA = (t: ZonaTab, enfocar = false) => {
    onTab(t);
    if (enfocar) tabRefs.current[t]?.focus();
  };

  const idTab = (t: ZonaTab) => `zona-${ubigeo}-tab-${t}`;
  const idPanel = `zona-${ubigeo}-panel`;

  const conteo: Partial<Record<ZonaTab, number | undefined>> = {
    cola: zona?.pendientes,
    alertas: nSenales ?? undefined,
    denuncias: reportesRegion?.length,
  };

  // La pestaña Denuncias y el Resumen ya traen sus propias acciones: repetirlas abajo era un tercer botón igual.
  const conPie = tab !== "resumen" && tab !== "denuncias";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-paperSoft">
      {/* Encabezado: sin kicker sobre el título. El estado va debajo, que es donde informa. */}
      <div className="flex items-start justify-between gap-3 border-b border-line bg-paperDeep px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold leading-tight text-ink">{nombre}</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-inkSoft">
            {zona ? ESTADO_LABEL[zona.estado] : detalle === null ? "Sin conexión con el estado de la zona" : "Cargando el estado de la zona…"}
            {zona && zona.precioPen > 0 && `, a ${soles(zona.precioPen)} por contrato leído`}
          </p>
          <div className="mt-2">
            <SeguirZonaBoton ubigeo={ubigeo} nombre={nombre} />
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-paperSoft text-mute transition-colors duration-rapido hover:bg-paper hover:text-ink"
            aria-label={`Cerrar el panel de ${nombre}`}
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      {/* Pestañas. Sin íconos: con ícono las seis sumaban ~520 px y "Presupuesto"
          quedaba cortada en un panel de 460. En pantalla angosta van en dos
          filas de tres en vez de esconder la sexta detrás de un scroll invisible. */}
      <div
        className="grid shrink-0 grid-cols-3 border-b border-line bg-paperSoft sm:flex sm:items-stretch"
        role="tablist"
        aria-label={`Secciones de ${nombre}`}
        onKeyDown={(e) => {
          const i = ORDEN_TABS.indexOf(tab);
          let sig: ZonaTab | null = null;
          if (e.key === "ArrowRight") sig = ORDEN_TABS[(i + 1) % ORDEN_TABS.length];
          if (e.key === "ArrowLeft") sig = ORDEN_TABS[(i - 1 + ORDEN_TABS.length) % ORDEN_TABS.length];
          if (e.key === "Home") sig = ORDEN_TABS[0];
          if (e.key === "End") sig = ORDEN_TABS[ORDEN_TABS.length - 1];
          if (sig) {
            e.preventDefault();
            irA(sig, true);
          }
        }}
      >
        {ORDEN_TABS.map((t) => (
          <TabBtn
            key={t}
            id={idTab(t)}
            controla={idPanel}
            active={tab === t}
            onClick={() => irA(t)}
            count={conteo[t]}
            refBoton={(el) => {
              tabRefs.current[t] = el;
            }}
          >
            {TAB_LABEL[t]}
          </TabBtn>
        ))}
      </div>

      <div
        id={idPanel}
        className="scrollbar-warm flex-1 overflow-y-auto px-5 py-4"
        role="tabpanel"
        aria-labelledby={idTab(tab)}
        tabIndex={0}
      >
        <div key={`${ubigeo || regionId}-${tab}`}>
          {tab === "resumen" && (
            <ResumenTab
              nombre={nombre}
              detalle={detalle}
              geo={geo}
              nSenales={nSenales}
              nDenuncias={reportesRegion?.length ?? null}
              financiarHref={financiarHref}
              denunciarHref={denunciarHref}
              enVivoHref={enVivoHref}
              goTo={(t) => irA(t, true)}
            />
          )}
          {tab === "cola" && <ColaTab nombre={nombre} ubigeo={ubigeo} detalle={detalle} />}
          {tab === "entidades" && <EntidadesDeZona ubigeo={ubigeo} nombre={nombre} />}
          {tab === "alertas" && <AlertasDeZona ubigeo={ubigeo} nombre={nombre} alertas={alertas} />}
          {tab === "denuncias" && <DenunciasTab nombre={nombre} reportes={reportesRegion} denunciarHref={denunciarHref} />}
          {tab === "presupuesto" && <PresupuestoRegional mefDept={REGION_TO_MEF_DEPT[regionId] ?? null} regionId={regionId} />}
        </div>
      </div>

      {conPie && (
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-line bg-paperDeep px-5 py-3">
          <Link
            href={financiarHref}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full bg-granate px-3 py-2.5 text-[12px] font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
          >
            Financiar la lectura
          </Link>
          {/* Secundario y sin rojo: en este producto el rojo dice "riesgo", no "acción". */}
          <Link
            href={denunciarHref}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full border border-line bg-paper px-3 py-2.5 text-[12px] font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
          >
            <Camera size={13} aria-hidden /> Denunciar
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Pestañas ────────────────────────────────────────────────────────────

function ResumenTab({
  nombre,
  detalle,
  geo,
  nSenales,
  nDenuncias,
  financiarHref,
  denunciarHref,
  enVivoHref,
  goTo,
}: {
  nombre: string;
  detalle: ZonaDetalle | null | undefined;
  geo: ContratoZona | null | undefined;
  nSenales: number | null;
  nDenuncias: number | null;
  financiarHref: string;
  denunciarHref: string;
  enVivoHref: string;
  goTo: (t: ZonaTab) => void;
}) {
  const zona = detalle?.zona ?? null;
  const cargando = detalle === undefined;
  const financiadoPct = zona ? pct(zona.financiados, zona.totalCola) : 0;
  const leidoFinPct = zona ? pct(zona.procesados, zona.totalCola) : 0;
  const esperando = zona?.pendientes ?? 0;

  if (cargando) {
    return (
      <div className="space-y-2" role="status" aria-busy>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8" />
        ))}
        <span className="sr-only">Cargando el estado de la auditoría…</span>
      </div>
    );
  }

  if (!zona) {
    return (
      <Vacio
        titulo="No pudimos cargar el estado de la zona"
        texto="El servicio de financiamiento no respondió; las cifras aparecen apenas vuelva."
      />
    );
  }

  /**
   * "Leídos" y "riesgo medio o alto" vienen de /contratos/geo: mientras no llega, se dice.
   * `conSenales` de geo es score ≥ 40, no "con señales" (§10.1): se nombra por lo que mide.
   */
  const deGeo = (f: (g: ContratoZona) => React.ReactNode) =>
    geo === undefined ? <Skeleton className="h-4 w-24" /> : geo === null ? <span className="text-mute">Sin dato, el servicio de contratos no respondió</span> : f(geo);
  const datos: DatoClave[] = [
    { etiqueta: "Leídos por los agentes", valor: deGeo((g) => <DeTotal n={enteros(g.procesados)} de={`de ${enteros(g.total)} publicados`} />) },
    { etiqueta: "De riesgo medio o alto", valor: deGeo((g) => <DeTotal n={enteros(g.conSenales)} de={`de ${enteros(g.procesados)} leídos`} />) },
    ...datosAlcance(detalle?.alcance, zona.documentosListos ?? 0, zona.enRevision ?? 0),
  ];

  // Formato de panel (§14.4): cifras → la barra de la cola → datos en filas → bloques.
  return (
    <CuerpoDetalle>
      {zona.totalCola > 0 ? (
        <>
          <Indicadores
            items={[
              { valor: enteros(esperando), etiqueta: "esperando lectura", contexto: geo ? `de ${enteros(geo.total)} publicados` : undefined },
              {
                valor: enteros(zona.financiados),
                etiqueta: "financiados",
                contexto: zona.financiados > 0 ? `${enteros(zona.procesados)} ya leídos` : "con la lectura ya pagada",
              },
            ]}
          />
          <div>
            <div
              className="relative h-2 overflow-hidden rounded-full bg-paperDeep"
              role="img"
              aria-label={`${financiadoPct}% de la cola financiada, ${leidoFinPct}% ya leída con financiamiento`}
            >
              <div className="absolute inset-y-0 left-0 rounded-full bg-granate-300 transition-[width] duration-normal ease-salida" style={{ width: `${financiadoPct}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-moss transition-[width] duration-normal ease-salida" style={{ width: `${leidoFinPct}%` }} />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-mute">
              {esperando > 0 ? (
                <>
                  <strong className="font-semibold text-ink">{enteros(esperando)}</strong>{" "}
                  {esperando === 1 ? "contrato" : "contratos"} de {nombre} {esperando === 1 ? "espera" : "esperan"} que
                  alguien financie su lectura.
                </>
              ) : (
                <>Toda la cola de {nombre} está financiada. Se procesan en orden de llegada.</>
              )}
            </p>
          </div>
        </>
      ) : (
        <Vacio titulo={`Todavía no hay contratos de ${nombre} en la cola`} texto={`Hoy entran a la cola ${alcanceCorto(detalle?.alcance)}.`} />
      )}

      <DatosClave items={datos} />

      <BloqueDetalle
        titulo="Qué puedes hacer"
        ayuda={
          <Ayuda titulo="¿Quién elige qué se lee?">
            El que paga no elige: la asignación es por antigüedad, en la base. Los resultados se publican igual.
          </Ayuda>
        }
      >
        <div className="space-y-2">
          <Link
            href={financiarHref}
            className="group flex min-h-[44px] items-center justify-between gap-3 rounded-full bg-granate px-4 py-2.5 text-paper transition-colors duration-rapido hover:bg-granate-deep"
          >
            <span className="text-sm font-semibold">
              Financiar la lectura {esperando > 0 ? `de hasta ${enteros(esperando)} contratos` : `en ${nombre}`}
            </span>
            <ArrowRight size={16} className="shrink-0 transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <Link
            href={denunciarHref}
            className="group flex min-h-[44px] items-center justify-between gap-3 rounded-full border border-line bg-paper px-4 py-2.5 text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <Camera size={14} aria-hidden /> Denunciar una obra en {nombre}
            </span>
            <ArrowRight size={16} className="shrink-0 transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
          </Link>
          {zona.financiados > 0 ? (
            <Link href={enVivoHref} className="inline-flex items-center gap-1 px-1 text-[12px] font-medium text-granate hover:underline">
              Ver los {enteros(zona.financiados)} financiados pasar de la cola al dictamen
              <ArrowUpRight size={12} aria-hidden />
            </Link>
          ) : (
            <p className="px-1 text-[12px] text-mute">Nadie financió esta zona todavía.</p>
          )}
        </div>
      </BloqueDetalle>

      <BloqueDetalle titulo={`Lo que ya se sabe de ${nombre}`}>
        <ul className="divide-y divide-line border-y border-line">
          <Salto
            etiqueta="Contratos con señales"
            valor={nSenales != null ? enteros(nSenales) : "…"}
            detalle={geo ? `de ${enteros(geo.procesados)} leídos` : undefined}
            onClick={() => goTo("alertas")}
          />
          <Salto
            etiqueta="Denuncias ciudadanas"
            valor={nDenuncias != null ? enteros(nDenuncias) : "…"}
            detalle="con foto y ubicación"
            onClick={() => goTo("denuncias")}
          />
          <Salto etiqueta="Presupuesto MEF" detalle="PIA, PIM y ejecución por año" onClick={() => goTo("presupuesto")} />
        </ul>
      </BloqueDetalle>
    </CuerpoDetalle>
  );
}

function ColaTab({ nombre, ubigeo, detalle }: { nombre: string; ubigeo: string; detalle: ZonaDetalle | null | undefined }) {
  const mapa = useMapaContratos();
  const zonaUb = mapa?.distritoUbigeo ?? null;
  const zonaNombre = zonaUb ? mapa?.distritoNombre || `zona ${zonaUb}` : nombre;
  const query = useMemo(() => ({ ubigeo: zonaUb ?? ubigeo }), [zonaUb, ubigeo]);

  if (detalle === undefined) {
    return (
      <div className="space-y-2" role="status" aria-busy>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
        <span className="sr-only">Cargando la cola…</span>
      </div>
    );
  }
  if (!detalle) {
    return <Vacio titulo="No pudimos cargar la cola" texto="El servicio de financiamiento no respondió. No te mostramos cifras de reemplazo." />;
  }

  const { zona, cola, hijas, aliados } = detalle;
  const provinciasConCola = hijas.filter((h) => h.totalCola > 0).sort((a, b) => b.totalCola - a.totalCola);
  const costoEsperando = zona.pendientes * zona.precioPen;

  // Formato de panel (§14.4): las dos cifras de la cola → el resto en filas → bloques.
  return (
    <CuerpoDetalle>
      {zona.totalCola > 0 ? (
        <>
          <Indicadores
            items={[
              {
                valor: enteros(cola.contratos),
                etiqueta: "en cola",
                contexto: `en ${enteros(cola.entidades)} ${cola.entidades === 1 ? "entidad" : "entidades"}`,
                ayuda: (
                  <Ayuda titulo="¿Qué entra en la cola?">
                    <span className="block">{alcanceLargo(detalle.alcance)}</span>
                    <span className="mt-2 block">Se procesan en orden de llegada; quien financia no elige cuáles.</span>
                  </Ayuda>
                ),
              },
              {
                valor: enteros(zona.pendientes),
                etiqueta: "esperando financiamiento",
                contexto: `y ${enteros(zona.financiados)} ${zona.financiados === 1 ? "financiado" : "financiados"}`,
              },
            ]}
          />
          <DatosClave
            items={[
              { etiqueta: "Qué entra en la cola", valor: alcanceCorto(detalle.alcance) },
              {
                etiqueta: "Valor referencial",
                valor: cola.montoReferencial > 0 ? <DeTotal n={solesCompacto(cola.montoReferencial)} de={`en ${enteros(cola.contratos)} contratos`} /> : null,
              },
              {
                etiqueta: "Costo de leer lo que espera",
                valor: <DeTotal n={soles(Math.max(0, costoEsperando))} de={`a ${soles(zona.precioPen)} por contrato`} />,
              },
              { etiqueta: "Documentos listos", valor: <DeTotal n={enteros(cola.documentosListos ?? 0)} de="de otros tipos, con el análisis en preparación" /> },
              { etiqueta: "Financiados en revisión", valor: <DeTotal n={enteros(zona.enRevision ?? 0)} de="leídos con la publicación en pausa" /> },
            ]}
          />
        </>
      ) : (
        <Vacio
          titulo={`Todavía no hay contratos de ${nombre} en la base`}
          texto="Los expedientes nuevos del OECE entran a la cola cuando su tipo y etapa ya se analizan."
        />
      )}

      {ubigeo && (
        <BloqueDetalle
          titulo={`Contratos de ${zonaNombre}`}
          acciones={
            zonaUb && mapa ? (
              <button type="button" onClick={mapa.limpiarDistrito} className="min-h-[24px] shrink-0 text-[12px] font-medium text-granate underline-offset-2 hover:underline">
                Ver todo {nombre}
              </button>
            ) : undefined
          }
        >
          {!zonaUb && mapa?.activa && (
            <p className="mb-2 text-[12px] text-mute">Toca una provincia del mapa, o un punto, para acotar esta lista.</p>
          )}
          <ContratosLista
            key={query.ubigeo}
            query={query}
            size={20}
            navegacion="interna"
            compacto
            selectedOcid={mapa?.ocidSeleccionado ?? null}
            onSelect={mapa?.seleccionar}
            onHover={mapa?.hover}
            onCargada={(p) => {
              if (zonaUb && p.total === 1 && p.data[0]) mapa?.seleccionar(p.data[0]);
            }}
          />
        </BloqueDetalle>
      )}

      {provinciasConCola.length > 0 && (
        <BloqueDetalle
          titulo="Provincias con cola"
          acciones={<span className="shrink-0 text-[12px] tabular-nums text-mute">{provinciasConCola.length} de {hijas.length}</span>}
        >
          <ul className="divide-y divide-line border-y border-line">
            {provinciasConCola.slice(0, 8).map((h) => (
              <li key={h.ubigeo}>
                <Link href={`/app/financiar/${h.ubigeo}`} className="group flex items-baseline justify-between gap-3 py-2 transition-colors duration-rapido hover:bg-paper">
                  <span className="min-w-0 truncate text-[13px] text-ink group-hover:text-granate">{h.nombre}</span>
                  <span className="shrink-0 font-mono text-[12px] text-mute tabular-nums">
                    <span className="font-semibold text-ink">{enteros(h.financiados)}</span> financiados,{" "}
                    {enteros(h.pendientes)} esperando
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </BloqueDetalle>
      )}

      {aliados.length > 0 && (
        <BloqueDetalle titulo="Quién pagó estas lecturas">
          <ul className="divide-y divide-line border-y border-line">
            {aliados.slice(0, 6).map((a, i) => (
              <li key={`${a.nombre}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
                {a.slug ? (
                  <Link href={`/aliado/${a.slug}`} className="min-w-0 truncate text-ink hover:text-granate hover:underline">
                    {a.nombre}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-ink">{a.nombre}</span>
                )}
                <span className="shrink-0 font-mono text-[12px] text-mute tabular-nums">{enteros(a.contratos)} contratos leídos</span>
              </li>
            ))}
          </ul>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}

function DenunciasTab({ nombre, reportes, denunciarHref }: { nombre: string; reportes: any[] | null; denunciarHref: string }) {
  if (reportes === null) {
    return (
      <div className="space-y-2" role="status" aria-busy>
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
        <span className="sr-only">Cargando las denuncias…</span>
      </div>
    );
  }
  const rows = [...reportes].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <Vacio
          titulo={`Todavía no hay denuncias en ${nombre}`}
          texto={`Con foto y ubicación; se confirma cuando ${MIN_CONFIRMACIONES} personas reportan el mismo punto en 30 días.`}
        />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.slice(0, 20).map((r) => {
            const meta = CATEGORIA_META[r.categoria as CategoriaDenuncia];
            const Icon = meta?.icon ?? MessageSquareWarning;
            const n = Number(r.confirmaciones ?? 0);
            const confirmada = estaConfirmada(r);
            return (
              <li key={r.id}>
                <Link href={`/app/denuncias/${r.id}`} className="group flex items-start gap-2.5 py-2.5 transition-colors duration-rapido hover:bg-paper">
                  <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border", meta?.tone ?? "border-line bg-paperDeep text-mute")}>
                    <Icon size={13} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-mute">
                      <span>{meta?.label ?? "Reporte"}</span>
                      {confirmada ? (
                        <span className="inline-flex items-center gap-0.5 text-mossTexto">
                          <CheckCircle2 size={10} aria-hidden /> confirmada por {n} personas
                        </span>
                      ) : (
                        <span className="text-inkSoft">
                          en validación, {n} de {MIN_CONFIRMACIONES} reportes
                        </span>
                      )}
                      {r.fecha && <span className="tabular-nums">{fechaCorta(String(r.fecha).slice(0, 10))}</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink">{r.descripcion}</span>
                  </span>
                  <ArrowUpRight size={13} className="mt-1 shrink-0 text-mute transition-colors duration-rapido group-hover:text-granate" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <Link
          href={denunciarHref}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-granate px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
        >
          <Camera size={14} aria-hidden /> Denunciar una obra en {nombre}
        </Link>
        <Link href="/app/denuncias" className="text-center text-[12px] font-medium text-granate underline-offset-2 hover:underline">
          Ver las denuncias de todo el país
        </Link>
      </div>
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────

/** Una cifra con su contexto: la frase completa ("de 4.704 publicados") la escribe quien arma la fila. */
function DeTotal({ n, de }: { n: React.ReactNode; de: string }) {
  return (
    <span className="tabular-nums">
      <span className="font-mono font-semibold text-ink">{n}</span>
      <span className="ml-1.5 text-[12px] text-mute">{de}</span>
    </span>
  );
}

function Salto({ etiqueta, valor, detalle, onClick }: { etiqueta: string; valor?: string; detalle?: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-baseline justify-between gap-3 py-2 text-left transition-colors duration-rapido hover:bg-paper"
      >
        <span className="min-w-0 text-[12px] text-mute group-hover:text-ink">{etiqueta}</span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          {valor && <span className="font-mono text-[15px] font-semibold text-ink tabular-nums">{valor}</span>}
          {detalle && <span className="text-[11px] text-mute">{detalle}</span>}
          <ArrowRight size={12} className="self-center text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate" aria-hidden />
        </span>
      </button>
    </li>
  );
}

/**
 * Qué cuenta la cola, en filas (§14.4); qué se analiza hoy y qué es "en revisión", en
 * el ⓘ. Antes era "Cola = …" dentro de una línea de texto.
 */
function datosAlcance(alcance: ZonaDetalle["alcance"] | undefined, documentosListos: number, enRevision: number): DatoClave[] {
  return [
    {
      etiqueta: "Qué entra en la cola",
      valor: alcanceCorto(alcance),
      ayuda: (
        <Ayuda titulo="¿Qué se analiza hoy?">
          <span className="block">{alcanceLargo(alcance)}</span>
          {enRevision > 0 && (
            <span className="mt-2 block">
              Los financiados en revisión ya se leyeron, pero su publicación está en pausa: no cuentan como señal.
            </span>
          )}
        </Ayuda>
      ),
    },
    ...(documentosListos > 0 ? [{ etiqueta: "Documentos listos", valor: <DeTotal n={enteros(documentosListos)} de="de otros tipos" /> }] : []),
    ...(enRevision > 0 ? [{ etiqueta: "Financiados en revisión", valor: <DeTotal n={enteros(enRevision)} de="con la publicación en pausa" /> }] : []),
  ];
}

function Vacio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="border-y border-dashed border-line py-4">
      <p className="text-[13px] font-semibold text-ink">{titulo}</p>
      <p className="mt-1 max-w-[46ch] text-[12px] leading-relaxed text-mute">{texto}</p>
    </div>
  );
}

function TabBtn({
  id,
  controla,
  active,
  onClick,
  children,
  count,
  refBoton,
}: {
  id: string;
  controla: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  refBoton: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={refBoton}
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controla}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={cn(
        "relative flex shrink-0 items-center justify-center gap-1 whitespace-nowrap px-1.5 py-2.5 text-[12px] font-medium transition-colors duration-rapido sm:flex-1",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
        active ? "text-granate" : "text-inkSoft hover:text-ink",
      )}
    >
      <span>{children}</span>
      {count !== undefined && count > 0 && (
        <span className={cn("rounded-full px-1.5 py-0 text-[10px] font-bold tabular-nums", active ? "bg-granate text-paper" : "bg-paperDeep text-inkSoft")}>
          {count > 999 ? "999+" : count}
        </span>
      )}
      {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-granate" aria-hidden />}
    </button>
  );
}
