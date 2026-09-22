"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PresupuestoRegional } from "@/components/PresupuestoRegional";
import { REGION_TO_MEF_DEPT } from "@/lib/peru-data";
import {
  X,
  LineChart,
  Layers,
  Building2,
  AlertTriangle,
  MessageSquareWarning,
  Camera,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Landmark,
} from "lucide-react";
import {
  getZona,
  ESTADO_LABEL,
  alcanceCorto,
  alcanceLargo,
  formatPEN,
  pct,
  type ZonaDetalle,
} from "@/lib/financiamiento";
import { CATEGORIA_META, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { cn } from "@/lib/utils";
import { EntidadesDeZona } from "./EntidadesDeZona";
import { AlertasDeZona } from "./AlertasDeZona";
import { belongsToRegion } from "./region-match";
import { ContratosLista, useMapaContratos } from "@/components/contratos/ContratosLista";
import { SeguirZonaBoton } from "./SeguirZonaBoton";

export type ZonaTab = "resumen" | "cola" | "entidades" | "alertas" | "denuncias" | "presupuesto";

const ORDEN_TABS: ZonaTab[] = ["resumen", "cola", "entidades", "alertas", "denuncias", "presupuesto"];

const enteros = (n: number) => n.toLocaleString("es-PE");

export interface ZonaHubPanelProps {
  /** Slug de `lib/peru-data` (p. ej. "ancash"). */
  regionId: string;
  /** Ubigeo INEI del departamento (2 dígitos). */
  ubigeo: string;
  nombre: string;
  onClose?: () => void;
  /** Señales ya cargadas por el mapa (se filtran por región acá). */
  alertas?: any[];
  /** Denuncias ciudadanas ya cargadas por el mapa. */
  reportes?: any[];
  /** Contratos ingresados de la zona (`/contratos/geo`): es el denominador de la cola. */
  totalIngresados?: number | null;
  initialTab?: ZonaTab;
}

/**
 * Panel lateral del mapa cuando hay un departamento abierto: qué espera
 * auditoría, qué se encontró, quién contrata, qué denuncian los vecinos, y las
 * dos acciones que una persona puede tomar.
 *
 * Sin cajas anidadas. Antes este panel (que ya es una superficie) metía dentro
 * una `section` con borde y fondo propios, y dentro de esa cuatro tiles con
 * borde y fondo: tres niveles de contenedor para cuatro números. Los grupos se
 * separan con una regla y un rótulo, que es lo que hace un documento.
 *
 * Y ninguna cifra va sola: toda cifra lleva su denominador en la misma línea.
 * "45 financiados" no dice nada; "45 de 1.204 en cola" sí.
 */
export function ZonaHubPanel({
  regionId,
  ubigeo,
  nombre,
  onClose,
  alertas = [],
  reportes = [],
  totalIngresados = null,
  initialTab = "resumen",
}: ZonaHubPanelProps) {
  const [tab, setTab] = useState<ZonaTab>(initialTab);
  const [detalle, setDetalle] = useState<ZonaDetalle | null | undefined>(undefined);
  const mapa = useMapaContratos();

  // Clic en una provincia o en un punto del mapa → pestaña Cola con esa zona.
  useEffect(() => {
    if (mapa?.distritoUbigeo) setTab("cola");
  }, [mapa?.distritoUbigeo]);

  useEffect(() => {
    setTab(initialTab);
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
  }, [ubigeo, regionId, initialTab]);

  const alertasRegion = useMemo(() => alertas.filter((a) => belongsToRegion(a, regionId)), [alertas, regionId]);
  const reportesRegion = useMemo(() => reportes.filter((r) => belongsToRegion(r, regionId)), [reportes, regionId]);

  const zona = detalle?.zona ?? null;
  const financiarHref = ubigeo ? `/app/financiar/${ubigeo}` : "/app/financiar";
  const denunciarHref = `/reporte/nuevo?region=${encodeURIComponent(regionId)}`;
  const enVivoHref = ubigeo ? `/app/auditoria?ubigeo=${ubigeo}` : "/app/auditoria";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-paperSoft">
      {/* Encabezado: sin kicker sobre el título. El estado va debajo, que es donde informa. */}
      <div className="flex items-start justify-between gap-3 border-b border-line bg-paperDeep px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-serif text-2xl font-bold leading-tight text-ink">{nombre}</h3>
          <p className="mt-0.5 text-[12px] leading-snug text-inkSoft">
            {zona ? ESTADO_LABEL[zona.estado] : "Cargando el estado de la zona…"}
            {zona && zona.precioPen > 0 && ` · ${formatPEN(zona.precioPen)} por contrato leído`}
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

      {/* Pestañas. `scrollbar-none` no existe en este proyecto: la barra de scroll
          del sistema operativo se veía cruzando el panel. Se oculta con utilidades
          arbitrarias reales, que sí compilan. */}
      <div
        className="flex shrink-0 items-stretch overflow-x-auto border-b border-line bg-paperSoft [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={`Secciones de ${nombre}`}
        onKeyDown={(e) => {
          const i = ORDEN_TABS.indexOf(tab);
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setTab(ORDEN_TABS[(i + 1) % ORDEN_TABS.length]);
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setTab(ORDEN_TABS[(i - 1 + ORDEN_TABS.length) % ORDEN_TABS.length]);
          }
        }}
      >
        <TabBtn active={tab === "resumen"} onClick={() => setTab("resumen")} icon={<LineChart size={12} />}>
          Resumen
        </TabBtn>
        <TabBtn active={tab === "cola"} onClick={() => setTab("cola")} icon={<Layers size={12} />} count={zona?.totalCola}>
          Cola
        </TabBtn>
        <TabBtn active={tab === "entidades"} onClick={() => setTab("entidades")} icon={<Building2 size={12} />}>
          Entidades
        </TabBtn>
        <TabBtn active={tab === "alertas"} onClick={() => setTab("alertas")} icon={<AlertTriangle size={12} />} count={alertasRegion.length}>
          Señales
        </TabBtn>
        <TabBtn
          active={tab === "denuncias"}
          onClick={() => setTab("denuncias")}
          icon={<MessageSquareWarning size={12} />}
          count={reportesRegion.length}
        >
          Denuncias
        </TabBtn>
        <TabBtn active={tab === "presupuesto"} onClick={() => setTab("presupuesto")} icon={<Landmark size={12} />}>
          Presupuesto
        </TabBtn>
      </div>

      <div className="scrollbar-warm flex-1 overflow-y-auto px-5 py-4" role="tabpanel" aria-label={`${nombre} · ${tab}`}>
        <div key={`${ubigeo || regionId}-${tab}`}>
          {tab === "resumen" && (
            <ResumenTab
              nombre={nombre}
              detalle={detalle}
              totalIngresados={totalIngresados}
              nSenales={alertasRegion.length}
              nDenuncias={reportesRegion.length}
              financiarHref={financiarHref}
              denunciarHref={denunciarHref}
              enVivoHref={enVivoHref}
              goTo={setTab}
            />
          )}
          {tab === "cola" && <ColaTab nombre={nombre} ubigeo={ubigeo} detalle={detalle} />}
          {tab === "entidades" && <EntidadesDeZona regionId={regionId} nombre={nombre} />}
          {tab === "alertas" && <AlertasDeZona regionId={regionId} nombre={nombre} alertas={alertas} />}
          {tab === "denuncias" && <DenunciasTab nombre={nombre} reportes={reportesRegion} denunciarHref={denunciarHref} />}
          {tab === "presupuesto" && <PresupuestoRegional mefDept={REGION_TO_MEF_DEPT[regionId] ?? null} regionId={regionId} />}
        </div>
      </div>

      {tab !== "resumen" && (
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-line bg-paperDeep px-5 py-3">
          <Link
            href={financiarHref}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-ink px-3 py-2.5 text-[12px] font-semibold text-paper transition-colors duration-rapido hover:bg-inkSoft"
          >
            Financiar la lectura
          </Link>
          <Link
            href={denunciarHref}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-rust/40 bg-crimson-soft px-3 py-2.5 text-[12px] font-semibold text-rust transition-colors duration-rapido hover:bg-rust hover:text-paper"
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
  totalIngresados,
  nSenales,
  nDenuncias,
  financiarHref,
  denunciarHref,
  enVivoHref,
  goTo,
}: {
  nombre: string;
  detalle: ZonaDetalle | null | undefined;
  totalIngresados: number | null;
  nSenales: number;
  nDenuncias: number;
  financiarHref: string;
  denunciarHref: string;
  enVivoHref: string;
  goTo: (t: ZonaTab) => void;
}) {
  const zona = detalle?.zona ?? null;
  const cargando = detalle === undefined;
  const financiadoPct = zona ? pct(zona.financiados, zona.totalCola) : 0;
  const procesadoPct = zona ? pct(zona.procesados, zona.totalCola) : 0;
  const restantes = zona ? Math.max(0, zona.totalCola - zona.financiados) : 0;

  if (cargando) {
    return (
      <div className="space-y-2" aria-busy>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-paperDeep" />
        ))}
        <span className="sr-only">Cargando el estado de la auditoría</span>
      </div>
    );
  }

  if (!zona) {
    return (
      <Vacio
        titulo="No se pudo cargar el estado de la zona"
        texto="El servicio de financiamiento no respondió. Las cifras de esta zona aparecen apenas vuelva; no se muestran cifras de reemplazo."
      />
    );
  }

  return (
    <div className="space-y-5">
      <section>
        <Rotulo>Auditoría de {nombre}</Rotulo>
        {zona.totalCola > 0 ? (
          <>
            <dl className="divide-y divide-line border-y border-line">
              <Cifra
                etiqueta="En cola de lectura"
                valor={enteros(zona.totalCola)}
                de={totalIngresados ? `${enteros(totalIngresados)} contratos ingresados` : "los contratos ingresados"}
              />
              <Cifra etiqueta="Financiados" valor={enteros(zona.financiados)} de={`${enteros(zona.totalCola)} en cola`} />
              <Cifra etiqueta="Leídos por los agentes" valor={enteros(zona.procesados)} de={`${enteros(zona.totalCola)} en cola`} tono="text-moss" />
              <Cifra
                etiqueta="Con señal publicada"
                valor={enteros(zona.senales)}
                de={zona.procesados > 0 ? `${enteros(zona.procesados)} leídos` : "0 leídos — todavía no hay nada que señalar"}
                tono="text-rust"
              />
            </dl>

            <div className="mt-3">
              <div
                className="relative h-2 overflow-hidden rounded-full bg-paperDeep"
                role="img"
                aria-label={`${financiadoPct}% de la cola financiada, ${procesadoPct}% leída`}
              >
                <div className="absolute inset-y-0 left-0 rounded-full bg-amber transition-[width] duration-normal ease-salida" style={{ width: `${financiadoPct}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-moss transition-[width] duration-normal ease-salida" style={{ width: `${procesadoPct}%` }} />
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-mute">
                {restantes > 0 ? (
                  <>
                    <strong className="font-semibold text-ink">{enteros(restantes)}</strong> de los{" "}
                    {enteros(zona.totalCola)} contratos en cola de {nombre} esperan que alguien financie su lectura.
                  </>
                ) : (
                  <>Toda la cola de {nombre} está financiada. Se procesan en orden de llegada.</>
                )}
              </p>
            </div>
          </>
        ) : (
          <Vacio
            titulo={`Todavía no hay contratos de ${nombre} en la cola`}
            texto={`La ingesta diaria del OECE descarga los expedientes nuevos y los clasifica. Un contrato entra a la cola cuando su tipo y etapa tienen análisis activo: hoy, ${alcanceCorto(detalle?.alcance)}.`}
          />
        )}
        <NotaAlcance alcance={detalle?.alcance} documentosListos={zona.documentosListos ?? 0} enRevision={zona.enRevision ?? 0} />
      </section>

      <section className="border-t border-line pt-4">
        <Rotulo>Qué puedes hacer</Rotulo>
        <div className="space-y-2">
          <Link
            href={financiarHref}
            className="group flex items-center justify-between gap-3 rounded-full bg-ink px-4 py-2.5 text-paper transition-colors duration-rapido hover:bg-inkSoft"
          >
            <span className="text-sm font-semibold">
              Financiar la lectura {restantes > 0 ? `de hasta ${enteros(restantes)} contratos` : `en ${nombre}`}
            </span>
            <ArrowRight size={16} className="shrink-0 transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <Link
            href={denunciarHref}
            className="group flex items-center justify-between gap-3 rounded-full border border-rust/40 bg-crimson-soft px-4 py-2.5 text-rust transition-colors duration-rapido hover:border-rust"
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <Camera size={14} aria-hidden /> Denunciar una obra en {nombre}
            </span>
            <ArrowRight size={16} className="shrink-0 transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
          </Link>
          {zona.financiados > 0 ? (
            <Link href={enVivoHref} className="inline-flex items-center gap-1 px-1 text-[12px] font-medium text-heroViolet hover:underline">
              Ver los {enteros(zona.financiados)} financiados pasar de la cola al dictamen
              <ArrowUpRight size={12} aria-hidden />
            </Link>
          ) : (
            <p className="px-1 text-[11px] leading-relaxed text-mute">
              Nadie financió esta zona todavía. Cuando alguien lo haga, acá se ve cada contrato pasar de la cola al
              análisis, agente por agente.
            </p>
          )}
          <p className="px-1 text-[11px] leading-relaxed text-mute">
            El que paga no elige: la asignación es por antigüedad, en la base. Los resultados se publican igual.
          </p>
        </div>
      </section>

      <section className="border-t border-line pt-4">
        <Rotulo>Lo que ya se sabe de {nombre}</Rotulo>
        <ul className="divide-y divide-line border-y border-line">
          <Salto
            etiqueta="Señales publicadas"
            valor={enteros(nSenales)}
            de={zona.procesados > 0 ? `${enteros(zona.procesados)} contratos leídos` : "ningún contrato leído aún"}
            onClick={() => goTo("alertas")}
          />
          <Salto
            etiqueta="Denuncias ciudadanas"
            valor={enteros(nDenuncias)}
            de={`reportes con foto en ${nombre}`}
            onClick={() => goTo("denuncias")}
          />
          <Salto etiqueta="Presupuesto MEF" valor="PIA · PIM" de="y su ejecución al día" onClick={() => goTo("presupuesto")} />
        </ul>
      </section>
    </div>
  );
}

function ColaTab({ nombre, ubigeo, detalle }: { nombre: string; ubigeo: string; detalle: ZonaDetalle | null | undefined }) {
  const mapa = useMapaContratos();
  const zonaUb = mapa?.distritoUbigeo ?? null;
  const zonaNombre = zonaUb ? mapa?.distritoNombre || `zona ${zonaUb}` : nombre;
  const query = useMemo(() => ({ ubigeo: zonaUb ?? ubigeo }), [zonaUb, ubigeo]);

  if (detalle === undefined) {
    return (
      <div className="space-y-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-paperDeep" />
        ))}
      </div>
    );
  }
  if (!detalle) {
    return <Vacio titulo="No se pudo cargar la cola" texto="El servicio de financiamiento no respondió. No se muestran cifras de reemplazo." />;
  }

  const { zona, cola, hijas, aliados } = detalle;
  const provinciasConCola = hijas.filter((h) => h.totalCola > 0).sort((a, b) => b.totalCola - a.totalCola);
  const costoTotal = zona.totalCola * zona.precioPen;

  return (
    <div className="space-y-5">
      <section>
        <Rotulo>Qué hay en la cola</Rotulo>
        {zona.totalCola > 0 ? (
          <dl className="divide-y divide-line border-y border-line">
            <Cifra etiqueta={`Contratos en cola (${alcanceCorto(detalle.alcance)})`} valor={enteros(cola.contratos)} de={`${enteros(cola.entidades)} entidades`} />
            <Cifra etiqueta="Monto contratado" valor={cola.montoReferencial > 0 ? formatPEN(cola.montoReferencial) : "—"} de={`${enteros(cola.contratos)} contratos`} />
            <Cifra etiqueta="Costo de leerla entera" valor={costoTotal > 0 ? formatPEN(costoTotal) : "—"} de={`${formatPEN(zona.precioPen)} por contrato`} />
            <Cifra
              etiqueta="Documentos listos"
              valor={enteros(cola.documentosListos ?? 0)}
              de="contratos de otros tipos, con expediente descargado y análisis en preparación"
            />
            <Cifra etiqueta="En revisión humana" valor={enteros(zona.enRevision ?? 0)} de="leídos cuya publicación quedó frenada" />
          </dl>
        ) : (
          <Vacio
            titulo={`Todavía no ingresamos contratos de ${nombre}`}
            texto="La ingesta diaria del OECE los irá sumando: primero se descargan y clasifican, y entran a la cola cuando su tipo y etapa tienen análisis activo."
          />
        )}
        <DetalleAlcance alcance={detalle.alcance} />
        <p className="mt-3 text-[11px] leading-relaxed text-mute">
          Se procesan en orden de llegada; quien financia no elige cuáles.
          {zona.totalCola - zona.financiados > 0
            ? ` Quedan ${enteros(zona.totalCola - zona.financiados)} sin financiar.`
            : " Toda la cola está financiada."}
        </p>
      </section>

      {ubigeo && (
        <section className="border-t border-line pt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <Rotulo sinMargen>Contratos de {zonaNombre}</Rotulo>
            {zonaUb && mapa && (
              <button type="button" onClick={mapa.limpiarDistrito} className="shrink-0 text-[11px] text-mute hover:text-ink hover:underline">
                ver todo {nombre}
              </button>
            )}
          </div>
          {!zonaUb && mapa?.activa && (
            <p className="mb-2 text-[11px] text-mute">Toca una provincia del mapa, o un punto, para acotar esta lista.</p>
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
        </section>
      )}

      {provinciasConCola.length > 0 && (
        <section className="border-t border-line pt-4">
          <Rotulo>
            Provincias con cola · {provinciasConCola.length} de {hijas.length}
          </Rotulo>
          <ul className="divide-y divide-line border-y border-line">
            {provinciasConCola.slice(0, 8).map((h) => (
              <li key={h.ubigeo}>
                <Link href={`/app/financiar/${h.ubigeo}`} className="group flex items-baseline justify-between gap-3 py-2 transition-colors duration-rapido hover:bg-paper">
                  <span className="min-w-0 truncate text-[13px] text-ink group-hover:text-heroViolet">{h.nombre}</span>
                  <span className="shrink-0 font-mono text-[12px] text-mute tabular-nums">
                    <span className="font-semibold text-amberTexto">{enteros(h.financiados)}</span> financiados de {enteros(h.totalCola)} en cola
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {aliados.length > 0 && (
        <section className="border-t border-line pt-4">
          <Rotulo>Quién pagó estas lecturas</Rotulo>
          <ul className="divide-y divide-line border-y border-line">
            {aliados.slice(0, 6).map((a, i) => (
              <li key={`${a.nombre}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
                {a.slug ? (
                  <Link href={`/aliado/${a.slug}`} className="min-w-0 truncate text-ink hover:text-heroViolet hover:underline">
                    {a.nombre}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-ink">{a.nombre}</span>
                )}
                <span className="shrink-0 font-mono text-[12px] text-mute tabular-nums">{enteros(a.contratos)} contratos leídos</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DenunciasTab({ nombre, reportes, denunciarHref }: { nombre: string; reportes: any[]; denunciarHref: string }) {
  const rows = [...reportes].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <Vacio
          titulo={`Nadie reportó todavía una obra en ${nombre}`}
          texto="Una denuncia necesita foto y ubicación. Cuando dos personas distintas reportan el mismo punto en 30 días, queda confirmada y aparece en el mapa."
        />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.slice(0, 20).map((r) => {
            const meta = CATEGORIA_META[r.categoria as CategoriaDenuncia];
            const Icon = meta?.icon ?? MessageSquareWarning;
            return (
              <li key={r.id}>
                <Link href={`/app/denuncias/${r.id}`} className="group flex items-start gap-2.5 py-2.5 transition-colors duration-rapido hover:bg-paper">
                  <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border", meta?.tone ?? "border-line bg-paperDeep text-mute")}>
                    <Icon size={13} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-mute">
                      <span>{meta?.label ?? "Reporte"}</span>
                      {r.confirmado ? (
                        <span className="inline-flex items-center gap-0.5 text-moss">
                          <CheckCircle2 size={10} aria-hidden /> confirmado por 2 vecinos
                        </span>
                      ) : (
                        <span className="text-inkSoft">en validación</span>
                      )}
                      {r.fecha && <span>· {String(r.fecha).slice(0, 10)}</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink">{r.descripcion}</span>
                  </span>
                  <ArrowUpRight size={13} className="mt-1 shrink-0 text-mute opacity-0 transition-opacity duration-rapido group-hover:opacity-100" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <Link
          href={denunciarHref}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-rust px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-rust/90"
        >
          <Camera size={14} aria-hidden /> Denunciar una obra en {nombre}
        </Link>
        <Link href="/app/denuncias" className="text-center text-[12px] text-mute hover:text-ink hover:underline">
          Ver las denuncias de todo el país
        </Link>
      </div>
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────

function Rotulo({ children, sinMargen }: { children: React.ReactNode; sinMargen?: boolean }) {
  return (
    <h4 className={cn("text-[11px] font-semibold uppercase tracking-wider text-mute", sinMargen ? "" : "mb-2")}>{children}</h4>
  );
}

/** Una cifra con su denominador en la misma línea. Nunca un número suelto. */
/* `tono` sólo acepta clases que pasen 4,5:1 sobre `paperSoft`: text-ink,
   text-rust (6,79) o text-moss (4,60). `text-amberTexto` da 3,21 y `text-clayTexto` 3,89:
   como texto no pasan, y acá el número ES el texto. */
function Cifra({ etiqueta, valor, de, tono }: { etiqueta: string; valor: string; de: string; tono?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="min-w-0 text-[12px] text-mute">{etiqueta}</dt>
      <dd className="shrink-0 text-right">
        <span className={cn("font-mono text-[15px] font-semibold tabular-nums", tono ?? "text-ink")}>{valor}</span>
        <span className="ml-1.5 text-[11px] text-mute">de {de}</span>
      </dd>
    </div>
  );
}

function Salto({ etiqueta, valor, de, onClick }: { etiqueta: string; valor: string; de: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-baseline justify-between gap-3 py-2 text-left transition-colors duration-rapido hover:bg-paper"
      >
        <span className="min-w-0 text-[12px] text-mute group-hover:text-ink">{etiqueta}</span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-mono text-[15px] font-semibold text-ink tabular-nums">{valor}</span>
          <span className="text-[11px] text-mute">de {de}</span>
          <ArrowRight size={12} className="self-center text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-heroViolet" aria-hidden />
        </span>
      </button>
    </li>
  );
}

function NotaAlcance({
  alcance,
  documentosListos,
  enRevision,
}: {
  alcance: ZonaDetalle["alcance"] | undefined;
  documentosListos: number;
  enRevision: number;
}) {
  return (
    <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-mute">
      <p>
        Cola = <strong className="text-ink">{alcanceCorto(alcance)}</strong>.
        {documentosListos > 0 && (
          <>
            {" "}Además, <strong className="text-ink">{enteros(documentosListos)}</strong> contrato
            {documentosListos === 1 ? "" : "s"} de otros tipos ya {documentosListos === 1 ? "tiene" : "tienen"} su
            expediente descargado y el análisis en preparación.
          </>
        )}
        {enRevision > 0 && (
          <>
            {" "}<strong className="text-inkSoft">{enteros(enRevision)}</strong> leído{enRevision === 1 ? "" : "s"} espera
            {enRevision === 1 ? "" : "n"} revisión humana y no cuenta{enRevision === 1 ? "" : "n"} como señal.
          </>
        )}
      </p>
      <DetalleAlcance alcance={alcance} />
    </div>
  );
}

function DetalleAlcance({ alcance }: { alcance: ZonaDetalle["alcance"] | undefined }) {
  return (
    <details className="mt-1 text-[11px] text-mute">
      <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-2 hover:text-ink">
        ¿Qué se analiza hoy?
      </summary>
      <p className="mt-1 leading-relaxed">{alcanceLargo(alcance)}</p>
    </details>
  );
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
  active,
  onClick,
  icon,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={cn(
        "relative flex flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap px-2 py-2.5 text-[11px] font-medium transition-colors duration-rapido",
        active ? "text-ink" : "text-mute hover:text-ink",
      )}
    >
      <span className={active ? "text-heroViolet" : ""} aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
      {count !== undefined && count > 0 && (
        <span className={cn("rounded-full px-1.5 py-0 text-[9px] font-bold tabular-nums", active ? "bg-heroViolet text-paper" : "bg-paperDeep text-mute")}>
          {count > 999 ? "999+" : count}
        </span>
      )}
      {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-heroViolet" />}
    </button>
  );
}
