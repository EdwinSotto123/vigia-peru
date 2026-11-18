"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, CalendarDays, ChevronDown, Loader2, ReceiptText, Store, Users } from "lucide-react";
import { BarraSegmentada, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { usePoder } from "@/components/grafo/vista";
import { ListaPaginada } from "@/components/listado";
import { DatosClave, type DatoClave } from "@/components/patrones";
import { Button } from "@/components/ui/Button";
import { fechaConAnio, numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { MOMENTOS_VENTA, rutaVentasCompraFamilia, type EvidenciaCompraFamilia, type MomentoVenta, type VentaCompraFamilia } from "@/lib/comprasFamilia";

/**
 * La evidencia de un caso de «trabaja en compras y un familiar cobra de su entidad» (migración 369): cada orden y cada
 * proceso frente al puesto, con su enlace. Se pide al abrir el panel (o, en la ficha, al tocar «Ver las órdenes»).
 *
 * Con la empresa del familiar, cada orden lleva su número y abre la lista de compras de la entidad en esa orden; cada
 * proceso, su ficha. A nombre del familiar sólo van la fecha y el monto: el número de la orden llevaría a su nombre.
 */
const ENLACE = "font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate";
const ESTADO_ORDEN: Record<string, string> = { Devengada: "devengada", Emitida: "emitida", Comprometida: "comprometida" };

/**
 * Una orden no tiene ficha propia: la lista de compras de la entidad, sólo con lo que le compró a esa empresa ese año y,
 * si su número tiene tres cifras o más (lo mínimo que acepta el buscador), buscándolo. El número es lo primero después del
 * prefijo («O/C-17-2026-SALUD»: 17, no 2026).
 */
const rutaOrden = (entidadRuc: string, orden: string, fecha: string, empresaRuc: string | null) => {
  const n = /^\D*(\d+)/.exec(orden)?.[1];
  const q = new URLSearchParams({
    seccion: "contratos",
    ...(empresaRuc ? { ccon: empresaRuc } : {}),
    ...(n && n.length >= 3 ? { cq: n } : {}),
    canio: fecha.slice(0, 4),
  });
  return `/entidad/${entidadRuc}?${q}`;
};

function Titulo({ icono: Icono, children }: { icono: typeof Store; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-cuerpo font-semibold text-ink">
      <Icono size={15} strokeWidth={1.9} className="shrink-0 text-inkSoft" aria-hidden />
      {children}
    </h3>
  );
}

/** Antes, durante y después del puesto: una barra con su leyenda (cuántas, cuánto y entre qué fechas). */
function CuandoSeEmitieron({ d }: { d: EvidenciaCompraFamilia }) {
  const grupos = MOMENTOS_VENTA.map((m) => {
    const filas = d.resumen.filter((r) => r.momento === m.clave);
    const ordenes = filas.filter((r) => r.tipo === "orden").reduce((s, r) => s + r.n, 0);
    const procesos = filas.filter((r) => r.tipo === "proceso").reduce((s, r) => s + r.n, 0);
    const monto = filas.reduce((s, r) => s + r.monto, 0);
    const desde = filas.map((r) => r.desde).filter(Boolean).sort()[0] ?? null;
    const hasta = filas.map((r) => r.hasta).filter(Boolean).sort().pop() ?? null;
    return { ...m, ordenes, procesos, n: ordenes + procesos, monto, desde, hasta };
  }).filter((g) => g.n > 0);
  if (!grupos.length) return null;
  const cuantas = (g: (typeof grupos)[number]) =>
    [g.ordenes ? plural(g.ordenes, "orden", "órdenes") : null, g.procesos ? plural(g.procesos, "proceso", "procesos") : null].filter(Boolean).join(" y ");
  return (
    <section className="space-y-2.5" data-bloque>
      <Titulo icono={CalendarDays}>Cuándo se emitieron</Titulo>
      <BarraSegmentada
        etiqueta="Las ventas frente al puesto"
        partes={grupos.map((g) => ({ clave: g.clave, nombre: g.nombre, valor: g.n, texto: cuantas(g) }))}
      />
      <ul className="space-y-1.5">
        {grupos.map((g, i) => (
          <li key={g.clave} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2 text-dato">
            <MuestraSerie i={i} className="translate-y-px" />
            <span className="min-w-0">
              <span className={g.clave === "en_puesto" ? "font-semibold text-ink" : "text-ink"}>{g.nombre}</span>
              <span className="block text-rotulo text-mute">
                {cuantas(g)}
                {g.desde && g.hasta ? (g.desde === g.hasta ? `, el ${fechaConAnio(g.desde)}` : `, del ${fechaConAnio(g.desde)} al ${fechaConAnio(g.hasta)}`) : ""}
              </span>
            </span>
            <span className="font-mono text-meta tabular-nums text-ink">{solesCompacto(g.monto)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FilaVenta({ v, entidadRuc, empresaRuc, indice }: { v: VentaCompraFamilia; entidadRuc: string; empresaRuc: string | null; indice: Map<MomentoVenta, number> }) {
  const momento = MOMENTOS_VENTA.find((m) => m.clave === v.momento);
  const i = indice.get(v.momento);
  const titulo =
    v.tipo === "proceso" ? (
      v.ocid ? (
        <Link href={rutaContrato(v.ocid, "ficha")} prefetch={false} className={`${ENLACE} font-mono`}>
          {v.nomenclatura ?? "Proceso de selección"}
        </Link>
      ) : (
        <span className="font-mono text-ink">{v.nomenclatura ?? "Proceso de selección"}</span>
      )
    ) : v.orden ? (
      <Link href={rutaOrden(entidadRuc, v.orden, v.fecha, empresaRuc)} prefetch={false} className={`${ENLACE} font-mono`}>
        {v.orden}
      </Link>
    ) : (
      <span className="text-ink">Orden de servicio</span>
    );
  return (
    <div className="space-y-0.5 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-dato">
        <span className="min-w-0 truncate">{titulo}</span>
        <span className="shrink-0 font-mono text-meta tabular-nums text-ink">{v.monto != null ? solesCompacto(v.monto) : "Sin monto"}</span>
      </div>
      {v.descripcion ? <p className="line-clamp-2 text-meta text-inkSoft">{tituloNatural(v.descripcion)}</p> : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-rotulo text-mute">
        <span>
          {v.tipo === "proceso" ? "Buena pro del " : ""}
          {fechaConAnio(v.fecha)}
          {v.estado ? `, ${ESTADO_ORDEN[v.estado] ?? v.estado.toLowerCase()}` : ""}
        </span>
        {momento ? (
          <span className="inline-flex items-center gap-1.5">
            {i != null ? <MuestraSerie i={i} /> : null}
            {momento.corto}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function LaEmpresa({ d }: { d: EvidenciaCompraFamilia }) {
  const e = d.empresa;
  if (!e || !d.empresaRuc) return null;
  const parte = e.monto > 0 ? e.montoDeEstaEntidad / e.monto : null;
  const gente = [e.socios ? plural(e.socios, "socio", "socios") : null, e.representantes ? plural(e.representantes, "representante", "representantes") : null]
    .filter(Boolean).join(" y ");
  const items = ([
    e.fechaAlta ? { etiqueta: "Inscrita en la SUNAT", valor: `${fechaConAnio(e.fechaAlta)}${e.estadoSunat ? `, hoy ${e.estadoSunat.toLowerCase()}` : ""}` } : null,
    {
      etiqueta: "Le vende al Estado",
      valor: `${plural(e.entidades ?? 0, "entidad", "entidades")}; ${solesCompacto(e.monto)} por órdenes${e.procesos ? ` y ${solesCompacto(e.montoProcesos)} en ${plural(e.procesos, "proceso", "procesos")}` : ""}`,
    },
    parte != null
      ? { etiqueta: "De esta entidad viene", valor: `${porcentaje(parte * 100)} de lo que cobró por órdenes (${solesCompacto(e.montoDeEstaEntidad)} en ${plural(e.ordenesDeEstaEntidad, "orden", "órdenes")})` }
      : null,
    gente ? { etiqueta: "Su gente en el RNP", valor: gente } : null,
    e.inhabilitada ? { etiqueta: "Inhabilitación", valor: e.inhabilitada } : null,
  ] as (DatoClave | null)[]).filter((x): x is DatoClave => !!x);
  return (
    <section className="space-y-2" data-bloque>
      <Titulo icono={Building2}>La empresa del familiar</Titulo>
      <p className="text-dato">
        <Link href={`/empresa/${d.empresaRuc}`} prefetch={false} className={ENLACE}>
          {e.nombre ? tituloNatural(e.nombre) : `RUC ${d.empresaRuc}`}
        </Link>
        <span className="ml-2 font-mono text-meta tabular-nums text-mute">RUC {d.empresaRuc}</span>
      </p>
      <DatosClave items={items} />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
        <Link href={`/empresa/${d.empresaRuc}?seccion=gente`} prefetch={false} className={`inline-flex min-h-8 items-center gap-1.5 ${ENLACE}`}>
          <Users size={14} aria-hidden /> Sus socios y representantes
        </Link>
        <Link href={`/empresa/${d.empresaRuc}?seccion=historia`} prefetch={false} className={`inline-flex min-h-8 items-center gap-1.5 ${ENLACE}`}>
          <CalendarDays size={14} aria-hidden /> Su historia
        </Link>
      </p>
    </section>
  );
}

function Cuerpo({ clave, entidadRuc }: { clave: string; entidadRuc: string }) {
  const carga = usePoder<EvidenciaCompraFamilia>(rutaVentasCompraFamilia(clave));
  if (carga.cargando && !carga.datos) {
    return (
      <p className="flex items-center gap-2 text-dato text-mute">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Buscando cada orden…
      </p>
    );
  }
  if (carga.error || !carga.datos) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-dato text-inkSoft">
        No pudimos traer las órdenes ahora.
        <Button variant="secondary" onClick={carga.reintentar}>Reintentar</Button>
      </div>
    );
  }
  const d = carga.datos;
  const conEmpresa = d.via === "empresa";
  const presentes = MOMENTOS_VENTA.filter((m) => d.resumen.some((r) => r.momento === m.clave && r.n > 0));
  const indice = new Map(presentes.map((m, i) => [m.clave, i]));
  const total = d.resumen.reduce((s, r) => s + r.n, 0);
  const items = d.ventas.map((v, i) => ({
    id: `${v.tipo}-${v.orden ?? v.nomenclatura ?? ""}-${v.fecha}-${i}`,
    contenido: <FilaVenta v={v} entidadRuc={entidadRuc} empresaRuc={d.empresaRuc} indice={indice} />,
    buscable: [v.orden, v.nomenclatura, v.descripcion, v.fecha.slice(0, 4), MOMENTOS_VENTA.find((m) => m.clave === v.momento)?.corto].filter(Boolean).join(" "),
  }));
  return (
    <div className="space-y-5">
      <CuandoSeEmitieron d={d} />
      <section className="space-y-2" data-bloque>
        <Titulo icono={ReceiptText}>{conEmpresa ? "Cada orden y cada proceso" : "Cada orden al familiar"}</Titulo>
        {items.length ? (
          <div className="[&_[data-paginado]]:m-0 [&_li]:border-b [&_li]:border-line/70 [&_li:last-child]:border-b-0">
            <ListaPaginada
              items={items}
              tam={8}
              nombre={conEmpresa ? "ventas" : "órdenes"}
              buscar={conEmpresa ? { placeholder: "Buscar por número, objeto o año…", etiqueta: "Buscar en estas ventas por número, objeto o año" } : undefined}
            />
          </div>
        ) : (
          <p className="text-dato text-inkSoft">El registro de órdenes no trae el detalle de este caso.</p>
        )}
        {total > d.ventas.length ? <p className="text-rotulo text-mute">Se muestran las {numero(d.ventas.length)} más recientes de {numero(total)}.</p> : null}
        {conEmpresa && d.empresaRuc ? (
          <p className="text-meta">
            <Link href={`/entidad/${entidadRuc}?seccion=contratos&ccon=${d.empresaRuc}`} prefetch={false} className={`inline-flex min-h-8 items-center gap-1.5 ${ENLACE}`}>
              <Store size={14} aria-hidden /> Ver todo lo que la entidad le compró a esta empresa
            </Link>
          </p>
        ) : (
          <p className="text-rotulo leading-relaxed text-mute">
            Van la fecha y el monto de cada orden, sin su número: con él se llegaría al nombre del familiar. Quien investiga puede pedir las órdenes
            a la entidad con el puesto, el parentesco y estas fechas.
          </p>
        )}
      </section>
      <LaEmpresa d={d} />
    </div>
  );
}

export function VentasCompraFamilia({ clave, entidadRuc, aPedido = false }: { clave: string; entidadRuc: string; aPedido?: boolean }) {
  const [abierto, setAbierto] = useState(!aPedido);
  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`inline-flex min-h-9 items-center gap-1.5 text-meta ${ENLACE}`}
        aria-expanded={false}
      >
        <ChevronDown size={14} aria-hidden /> Ver cada orden, con su fecha y su monto
      </button>
    );
  }
  return <Cuerpo clave={clave} entidadRuc={entidadRuc} />;
}
