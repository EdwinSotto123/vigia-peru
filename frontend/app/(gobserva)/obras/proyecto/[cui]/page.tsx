import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  CirclePause,
  ClipboardList,
  FileCheck2,
  Gavel,
  HardHat,
  Hourglass,
  MapPin,
  PackageOpen,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { BarraAvance, FaseInsignia, iconoSector } from "@/components/gobserva-obras/Piezas";
import { BotonGuardar } from "@/components/gobserva/cuenta/BotonGuardar";
import { DatosEstructurados } from "@/components/seo/DatosEstructurados";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaConAnio, fechaCorta, numero, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { CONTRATACIONES_ABIERTAS, inversionSsi, obraInfobras } from "@/lib/fuentes";
import { PRODUCTOS, rutaEn, urlCanonica } from "@/lib/gobserva";
import {
  ETAPA_PROCESO,
  FASES,
  TIPO_PROCESO,
  conLugares,
  getFichaObras,
  haceTiempo,
  lugarProyecto,
  mesAnio,
  nombreEmpresa,
  nombreEntidad,
  nombreLugar,
  nombreModalidad,
  nombreNivel,
  nombreProyecto,
  nombreSector,
  type Fase,
  type FichaObras,
  type ObraInfobras,
  type QuienObra,
} from "@/lib/gobserva-obras";
import { baseProducto } from "@/lib/gobserva-servidor";
import { limpiar, nombreRegion } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

type Props = { params: { cui: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const f = await getFichaObras(params.cui);
  if (!f) return { title: "Proyecto no encontrado" };
  const nombre = nombreProyecto(f.nombre, f.lugar);
  const fase = f.fase ? FASES[f.fase].nombre.toLocaleLowerCase("es-PE") : "inversión";
  return {
    title: nombre.length > 90 ? `${nombre.slice(0, 88).trimEnd()}…` : nombre,
    description: `${nombre}. ${nombreEntidad(f.entidad.nombre)}, ${lugarProyecto(f.lugar)}. Costo ${solesCompacto(f.montos.actualizado)}, ${fase}. Su plata, su avance, sus obras y procesos y quién la construye.`,
    alternates: { canonical: urlCanonica("obras", `/proyecto/${f.cui}`) },
  };
}

/** El proyecto como Project de schema.org, con la entidad que lo financia, dónde está y su CUI. */
function datosProyecto(f: FichaObras) {
  const url = urlCanonica("obras", `/proyecto/${f.cui}`);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Project",
        "@id": `${url}#proyecto`,
        name: nombreProyecto(f.nombre, f.lugar),
        identifier: { "@type": "PropertyValue", propertyID: "CUI (Código Único de Inversión, MEF)", value: f.cui },
        description: `${f.fase ? FASES[f.fase].nombre : "Inversión pública"} de ${nombreSector(f.sector).toLocaleLowerCase("es-PE")}. Costo actualizado: ${soles(f.montos.actualizado)}.`,
        url,
        sameAs: inversionSsi(f.cui),
        funder: f.entidad.nombre ? { "@type": "GovernmentOrganization", name: nombreEntidad(f.entidad.nombre) } : undefined,
        location: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressLocality: nombreLugar(f.lugar.distrito) ?? undefined,
            addressRegion: f.lugar.region ? nombreRegion(f.lugar.region) : undefined,
            addressCountry: "PE",
          },
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Gobserva Obras", item: urlCanonica("obras", "/") },
          { "@type": "ListItem", position: 2, name: "Proyectos", item: urlCanonica("obras", "/proyectos") },
          { "@type": "ListItem", position: 3, name: `CUI ${f.cui}`, item: url },
        ],
      },
    ],
  };
}

/** Los pasos de una inversión, en orden: dónde está ésta. */
const PASOS: { fase: Fase; nombre: string }[] = [
  { fase: "viable", nombre: "Viable" },
  { fase: "expediente", nombre: "Expediente técnico" },
  { fase: "licitacion", nombre: "Licitación de la obra" },
  { fase: "ejecucion", nombre: "Ejecución" },
  { fase: "terminada", nombre: "Obra terminada" },
];
const POSICION: Record<Fase, number> = { viable: 0, expediente: 1, licitacion: 2, ejecucion: 3, paralizada: 3, sin_movimiento: 3, terminada: 4, cerrada: 5 };

/** Lo que sigue para quien quiere entrar al proyecto, según su fase. */
function loQueSigue(f: FichaObras, licitaciones: string): { titulo: string; texto: ReactNode } {
  const anio = new Date().getFullYear();
  const pim = f.montos.pimAnio > 0 ? ` Tiene ${solesCompacto(f.montos.pimAnio)} de presupuesto este ${anio}.` : "";
  switch (f.fase) {
    case "viable":
      return {
        titulo: "Lo siguiente: el expediente técnico",
        texto: `Es viable pero no registra expediente técnico. La entidad tiene que contratarlo (una consultoría de obra) o hacerlo ella misma; después se licita la obra.${pim}`,
      };
    case "expediente":
      return {
        titulo: "Lo siguiente: licitar la obra",
        texto: `Ya tiene expediente técnico${f.montos.expediente ? ` por ${solesCompacto(f.montos.expediente)}` : ""} y todavía no tiene contrato de obra.${pim} Te avisamos el día que se convoque.`,
      };
    case "licitacion": {
      const abierto = f.procesos.find((p) => p.etapa === "convocada" && p.tipo === "obras") ?? f.procesos.find((p) => p.etapa === "convocada");
      return {
        titulo: "Se está licitando ahora",
        texto: abierto ? (
          <>
            Hay un proceso de {(TIPO_PROCESO[abierto.tipo ?? ""] ?? "obra").toLocaleLowerCase("es-PE")} en convocatoria desde el {fechaCorta(abierto.fecha)}
            {abierto.valor ? `, con un valor referencial de ${solesCompacto(abierto.valor)}` : ""}.{" "}
            <a href={`${licitaciones}/oportunidad/${encodeURIComponent(abierto.ocid)}`} className="font-semibold text-maiz underline-offset-2 hover:underline">
              Ver la convocatoria
            </a>
          </>
        ) : (
          "Hay un proceso de obra con este CUI en etapa de convocatoria en el SEACE."
        ),
      };
    }
    case "ejecucion":
      return {
        titulo: "En ejecución: lo que necesita",
        texto: `La obra está en marcha. Le faltan ${solesCompacto(f.montos.porEjecutar)} por ejecutar: materiales, equipos, servicios y supervisión.${pim}`,
      };
    case "paralizada":
      return {
        titulo: "Paralizada: puede volver a licitarse",
        texto: `Le faltan ${solesCompacto(f.montos.porEjecutar)} por ejecutar. Una obra paralizada suele reiniciarse con un nuevo contrato por el saldo de obra.`,
      };
    case "terminada":
      return { titulo: "Obra terminada", texto: "La obra terminó; falta liquidarla y cerrar la inversión en el MEF." };
    case "sin_movimiento":
      return { titulo: "Sin movimiento", texto: "Tuvo gasto o avance, pero nada en los últimos dos años y no tiene obra en INFOBRAS. Puede reactivarse." };
    default:
      return { titulo: "Inversión cerrada", texto: "El MEF la registra cerrada: su historia sirve para conocer a la entidad y a quién le contrató." };
  }
}

/** Los contratistas del proyecto, juntando las obras de INFOBRAS y los procesos del SEACE (sólo empresas RUC 20). */
function contratistas(f: FichaObras) {
  const m = new Map<string, { ruc: string; nombre: string | null; roles: Set<string>; monto: number; procesos: number; consorcio: boolean }>();
  const sumar = (ruc: string, nombre: string | null | undefined, rol: string, monto = 0, proceso = false, consorcio = false) => {
    const x = m.get(ruc) ?? { ruc, nombre: nombre ?? null, roles: new Set<string>(), monto: 0, procesos: 0, consorcio: false };
    x.roles.add(rol);
    x.monto += monto;
    if (proceso) x.procesos += 1;
    x.consorcio ||= consorcio;
    if (!x.nombre && nombre) x.nombre = nombre;
    m.set(ruc, x);
  };
  for (const o of f.obras) {
    if (o.ejecutor?.tipo === "empresa" && o.ejecutor.ruc) sumar(o.ejecutor.ruc, o.ejecutor.nombre, "Ejecuta la obra");
    if (o.supervisor?.tipo === "empresa" && o.supervisor.ruc) sumar(o.supervisor.ruc, o.supervisor.nombre, "Supervisa la obra");
  }
  for (const p of f.procesos) {
    const rol = p.tipo === "obras" ? "Ganó la obra" : p.tipo === "consultoria" ? "Ganó una consultoría" : p.tipo === "bienes" ? "Vendió bienes" : "Prestó servicios";
    for (const g of p.ganadores.empresas) sumar(g.ruc, g.nombre, rol, g.monto ?? 0, true, g.consorcio);
  }
  return [...m.values()].sort((a, b) => b.monto - a.monto || b.roles.size - a.roles.size);
}

/**
 * La ficha de un proyecto de inversión en Gobserva Obras: qué es, quién lo hace y dónde; su plata (viable, costo,
 * expediente, devengado, presupuesto del año, lo que falta); en qué paso está y qué sigue; sus obras de INFOBRAS con su
 * avance y su contratista; los procesos del SEACE que citan su CUI con quién los ganó; los contratistas juntos;
 * proyectos parecidos; y las fuentes oficiales. Sin nombres de personas naturales. GET /proyectos/ficha/:cui.
 */
export default async function FichaProyecto({ params }: Props) {
  const f = await getFichaObras(params.cui);
  if (!f) notFound();
  const base = baseProducto("obras");
  const ruta = (p: string) => rutaEn(base, p);
  const licitaciones = `https://${PRODUCTOS.licitaciones.host}`;
  const IconoSector = iconoSector(f.sector);
  const anio = new Date().getFullYear();
  const costo = f.montos.actualizado;
  const pctGastado = costo && f.montos.devengado > 0 ? (f.montos.devengado / costo) * 100 : null;
  const pctAnio = f.montos.pimAnio > 0 ? (f.montos.devengadoAnio / f.montos.pimAnio) * 100 : null;
  const sobreViable = costo && f.montos.viable && costo > f.montos.viable * 1.05 ? (costo / f.montos.viable - 1) * 100 : null;
  const principal = f.obras[0] ?? null;
  const sigue = loQueSigue(f, licitaciones);
  const empresas = contratistas(f);
  const posicion = POSICION[f.fase ?? "cerrada"];
  const OBRAS_VISIBLES = 12;

  return (
    <div className="container-page py-8 sm:py-12">
      <DatosEstructurados datos={datosProyecto(f)} />
      <nav aria-label="Ruta" className="flex flex-wrap items-center gap-x-1.5 text-meta text-mute">
        <Link href={ruta("/proyectos")} className="inline-flex items-center gap-1 font-semibold text-granate underline-offset-2 hover:underline">
          <ArrowLeft size={15} aria-hidden /> Proyectos
        </Link>
        <span aria-hidden>/</span>
        <span className="font-mono text-inkSoft">CUI {f.cui}</span>
      </nav>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── El proyecto ── */}
        <div className="min-w-0 space-y-10">
          <header>
            <div className="flex flex-wrap items-center gap-1.5">
              <FaseInsignia fase={f.fase} />
              <span className="inline-flex items-center gap-1 rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">
                <IconoSector size={12} aria-hidden /> {nombreSector(f.sector)}
              </span>
              {f.nivel && <span className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">{nombreNivel(f.nivel)}</span>}
              {f.tipoInversion && <span className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">{tituloTipo(f.tipoInversion)}</span>}
              {f.tipo === "equipamiento" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">
                  <PackageOpen size={12} aria-hidden /> Compra de equipos
                </span>
              )}
            </div>
            {/* Un nombre del MEF puede tener 300 letras: el largo va un escalón más chico. */}
            <h1
              className={cn(
                "mt-3 text-balance font-display font-bold leading-tight text-ink",
                f.nombre.length > 170 ? "text-bloque sm:text-seccion" : "text-seccion sm:text-titulo",
              )}
            >
              {nombreProyecto(f.nombre, f.lugar)}
            </h1>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-dato sm:grid-cols-2">
              <Linea Icono={Building2} etiqueta="Entidad">
                {f.entidad.ruc ? (
                  <Link href={`${ruta("/proyectos")}?pestana=todos&entidad=${f.entidad.ruc}`} className="font-medium text-ink underline-offset-2 hover:text-granate hover:underline">
                    {nombreEntidad(f.entidad.nombre)}
                  </Link>
                ) : (
                  nombreEntidad(f.entidad.nombre)
                )}
                {f.unidadEjecutora && nombreEntidad(f.unidadEjecutora) !== nombreEntidad(f.entidad.nombre) && (
                  <span className="block text-meta text-mute">Unidad ejecutora: {nombreEntidad(f.unidadEjecutora)}</span>
                )}
              </Linea>
              <Linea Icono={MapPin} etiqueta="Dónde">
                {lugarProyecto(f.lugar)}
              </Linea>
              <Linea Icono={HardHat} etiqueta="Cómo se ejecuta">
                {nombreModalidad(f.modalidad)}
              </Linea>
              <Linea Icono={ChartNoAxesCombined} etiqueta="Función del MEF">
                {f.funcion ? tituloTipo(f.funcion) : "Sin función registrada"}
                {f.tipologia && <span className="block text-meta text-mute">{tituloTipo(f.tipologia)}</span>}
              </Linea>
            </dl>
          </header>

          {/* La plata */}
          <section aria-labelledby="plata-t">
            <h2 id="plata-t" className="font-display text-seccion font-bold leading-tight text-ink">
              La plata
            </h2>
            {f.costoDudoso && (
              <p className="mt-2 rounded-xl border border-amber/40 bg-amber-soft px-3 py-2 text-meta text-amberTexto">
                El costo actualizado que publica el MEF es más de mil veces el monto viable (un dato imposible): mostramos el monto viable.
              </p>
            )}
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Cifra Icono={CircleDollarSign} etiqueta="Costo actualizado" valor={solesCompacto(costo)} destacado>
                {soles(costo)}
                {f.montos.viable ? (
                  <>
                    ; viable por {solesCompacto(f.montos.viable)}
                    {sobreViable ? <span className="text-amberTexto">, {porcentaje(sobreViable)} más</span> : null}
                  </>
                ) : null}
              </Cifra>
              <Cifra Icono={FileCheck2} etiqueta="Expediente técnico" valor={f.montos.expediente ? solesCompacto(f.montos.expediente) : f.conExpediente ? "Aprobado" : "Sin expediente"}>
                {f.montos.expediente ? `${soles(f.montos.expediente)}, registrado en el MEF` : f.conExpediente ? "Registrado en el MEF" : "Todavía no lo registra el MEF"}
              </Cifra>
              <Cifra Icono={Wallet} etiqueta="Gastado (devengado)" valor={solesCompacto(f.montos.devengado)}>
                {pctGastado != null ? `${porcentaje(Math.min(pctGastado, 100))} del costo` : "Sin gasto todavía"}
                {f.fechas.ultimoGasto ? `; el último, en ${mesAnio(f.fechas.ultimoGasto)}` : ""}
              </Cifra>
              <Cifra Icono={Hourglass} etiqueta="Por ejecutar" valor={solesCompacto(f.montos.porEjecutar)}>
                {soles(f.montos.porEjecutar)}: el costo menos lo gastado
              </Cifra>
              <Cifra Icono={CalendarClock} etiqueta={`Presupuesto ${anio} (PIM)`} valor={f.montos.pimAnio > 0 ? solesCompacto(f.montos.pimAnio) : "Sin presupuesto"}>
                {f.montos.pimAnio > 0 ? `Gastado este año: ${solesCompacto(f.montos.devengadoAnio)}${pctAnio != null ? ` (${porcentaje(pctAnio)})` : ""}` : `No tiene plata asignada para ${anio}`}
              </Cifra>
              <Cifra Icono={Users} etiqueta="Beneficiarios" valor={f.beneficiarios ? numero(f.beneficiarios) : "Sin dato"}>
                Los que declara la entidad en Invierte.pe
              </Cifra>
            </dl>
            {pctGastado != null && (
              <div className="mt-4 rounded-2xl border border-line bg-paper p-4">
                <BarraAvance real={Math.min(pctGastado, 100)} etiqueta="Gastado del costo total" pie={f.avanceMef != null ? `El MEF registra un avance físico de ${porcentaje(f.avanceMef)}.` : undefined} />
              </div>
            )}
          </section>

          {/* En qué paso está */}
          <section aria-labelledby="paso-t">
            <h2 id="paso-t" className="font-display text-seccion font-bold leading-tight text-ink">
              En qué paso está
            </h2>
            <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="Pasos de la inversión">
              {PASOS.map((p, i) => {
                const hecho = i < posicion;
                const actual = i === posicion;
                const detenida = actual && (f.fase === "paralizada" || f.fase === "sin_movimiento");
                return (
                  <li
                    key={p.fase}
                    aria-current={actual ? "step" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-meta font-semibold sm:flex-col sm:items-start sm:gap-1.5",
                      actual ? (detenida ? "border-crimson/50 bg-crimson-soft text-crimsonTexto" : "border-granate bg-granate-50 text-ink") : hecho ? "border-line bg-paper text-inkSoft" : "border-dashed border-line bg-paperSoft text-mute",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-micro font-bold",
                        actual ? (detenida ? "bg-crimson text-paper" : "bg-granate text-paper") : hecho ? "bg-ink/80 text-paper" : "bg-paperDeep text-mute",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span>
                      {p.nombre}
                      {detenida && <span className="block font-normal">{f.fase === "paralizada" ? "Paralizada" : "Sin movimiento"}</span>}
                      {hecho && <span className="sr-only"> (cumplido)</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-dato leading-relaxed text-inkSoft">{f.fase ? FASES[f.fase].detalle : "Inversión cerrada en el MEF."}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-line bg-paper p-4 text-dato sm:grid-cols-3">
              <Fecha etiqueta="Registrada" valor={f.fechas.registro} />
              <Fecha etiqueta="Viable o aprobada" valor={f.fechas.viabilidad} />
              <Fecha etiqueta="Primer gasto" valor={f.fechas.primerGasto} mes />
              <Fecha etiqueta="Último gasto" valor={f.fechas.ultimoGasto} mes />
              <Fecha etiqueta="Inicio previsto" valor={f.fechas.inicioPrevisto} />
              <Fecha etiqueta={f.estado === "cerrada" ? "Cerrada" : "Fin previsto"} valor={f.estado === "cerrada" ? f.fechas.cierre : f.fechas.finPrevisto} />
            </dl>
          </section>

          {/* Obras de INFOBRAS */}
          <section aria-labelledby="obras-t">
            <h2 id="obras-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
              <HardHat size={20} aria-hidden className="text-granate" /> {f.obras.length === 1 ? "Su obra en INFOBRAS" : f.obras.length > 1 ? `Sus obras en INFOBRAS (${numero(f.obras.length)})` : "Sus obras en INFOBRAS"}
            </h2>
            <p className="mt-1 text-meta text-mute">
              Lo que registra la entidad en INFOBRAS (Contraloría){f.alDia.infobras ? `, archivo del ${fechaConAnio(f.alDia.infobras)}` : ""}. El avance puede llegar con meses de
              atraso: cada obra dice a qué fecha corresponde.
            </p>
            {f.obras.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-line bg-paperSoft p-4 text-dato text-inkSoft">
                INFOBRAS no registra obras con este CUI todavía: una obra aparece ahí cuando la entidad la inscribe, antes de empezarla.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {/* recorte: las 12 primeras (paralizadas y en ejecución primero); el resto en INFOBRAS (más abajo, cuántas faltan). */}
                {f.obras.slice(0, OBRAS_VISIBLES).map((o) => (
                  <ObraFila key={o.codigo} o={o} lugar={f.lugar} />
                ))}
              </ol>
            )}
            {f.obras.length > OBRAS_VISIBLES && (
              <p className="mt-2 text-meta text-mute">
                Y {numero(f.obras.length - OBRAS_VISIBLES)} obras más con este CUI en INFOBRAS (terminadas o sin ejecutar).
              </p>
            )}
          </section>

          {/* Procesos del SEACE */}
          <section aria-labelledby="procesos-t">
            <h2 id="procesos-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
              <Gavel size={20} aria-hidden className="text-granate" /> Sus procesos en el SEACE
            </h2>
            <p className="mt-1 text-meta text-mute">
              Los procesos que citan este CUI (en el registro OCDS o en su descripción), del más nuevo al más antiguo. De quien ganó, el nombre sólo si
              es una empresa; de un consorcio, sus empresas integrantes.
            </p>
            {f.procesos.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-line bg-paperSoft p-4 text-dato text-inkSoft">
                Ningún proceso del SEACE cita este CUI todavía. Cuando se convoque su obra o su expediente técnico, aparecerá aquí.
              </p>
            ) : (
              <ol className="mt-4 divide-y divide-line rounded-2xl border border-line bg-paper">
                {f.procesos.map((p) => (
                  <li key={p.ocid} className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-granate-50 px-2.5 py-0.5 text-rotulo font-semibold text-granate">{TIPO_PROCESO[p.tipo ?? ""] ?? "Proceso"}</span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-rotulo font-medium",
                          p.etapa === "convocada" ? "bg-amber-soft font-semibold text-amberTexto" : "bg-paperDeep text-inkSoft",
                        )}
                      >
                        {ETAPA_PROCESO[p.etapa ?? ""] ?? "Sin etapa"}
                      </span>
                      <span className="ml-auto text-rotulo text-mute">{p.fecha ? fechaConAnio(p.fecha) : "Sin fecha"}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-dato font-medium leading-snug text-ink">{conLugares(limpiar(p.objeto), f.lugar) || "Proceso sin objeto registrado"}</p>
                    <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
                      {p.valor != null && <span>Valor referencial {solesCompacto(p.valor)}</span>}
                      {p.adjudicado != null && <span className="font-semibold text-ink">Adjudicado {solesCompacto(p.adjudicado)}</span>}
                      {p.procedimiento && <span>{p.procedimiento}</span>}
                    </p>
                    {(p.ganadores.empresas.length > 0 || p.ganadores.otros > 0) && (
                      <p className="mt-1.5 text-meta text-inkSoft">
                        Ganó:{" "}
                        {p.ganadores.empresas.map((g, i) => (
                          <span key={g.ruc}>
                            {i > 0 ? ", " : ""}
                            <b className="font-semibold text-ink">{nombreEmpresa(g.nombre)}</b>
                            {g.consorcio ? " (en consorcio)" : ""}
                          </span>
                        ))}
                        {p.ganadores.otros > 0 && (
                          <span className="text-mute">
                            {p.ganadores.empresas.length ? " y " : ""}
                            {p.ganadores.otros === 1 ? "un consorcio o una persona natural" : `${numero(p.ganadores.otros)} consorcios o personas naturales`} (sin nombre)
                          </span>
                        )}
                      </p>
                    )}
                    <a
                      href={`${licitaciones}/oportunidad/${encodeURIComponent(p.ocid)}`}
                      className="mt-2 inline-flex items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline"
                    >
                      Ver el proceso en Gobserva Licitaciones <ArrowUpRight size={13} aria-hidden />
                    </a>
                  </li>
                ))}
              </ol>
            )}
            {f.procesosTotal > f.procesos.length && (
              <p className="mt-2 text-meta text-mute">
                Se muestran los {numero(f.procesos.length)} más nuevos de {numero(f.procesosTotal)} procesos. El resto, en Contrataciones Abiertas del OECE.
              </p>
            )}
          </section>

          {/* Contratistas */}
          {empresas.length > 0 && (
            <section aria-labelledby="contratistas-t">
              <h2 id="contratistas-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                <ClipboardList size={20} aria-hidden className="text-granate" /> Las empresas de este proyecto
              </h2>
              <p className="mt-1 text-meta text-mute">Juntando INFOBRAS y el SEACE. Sólo empresas (RUC 20); lo ganado en consorcio se reparte en partes iguales.</p>
              <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {empresas.map((e) => (
                  <li key={e.ruc} className="min-w-0 rounded-2xl border border-line bg-paper p-4">
                    <p className="text-dato font-semibold leading-snug text-ink">{nombreEmpresa(e.nombre)}</p>
                    <p className="mt-0.5 font-mono text-rotulo text-mute">RUC {e.ruc}</p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {[...e.roles].map((r) => (
                        <li key={r} className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">
                          {r}
                        </li>
                      ))}
                    </ul>
                    {e.monto > 0 && (
                      <p className="mt-2 text-meta text-inkSoft">
                        Adjudicado: <b className="text-ink">{solesCompacto(e.monto)}</b> en {numero(e.procesos)} {e.procesos === 1 ? "proceso" : "procesos"}
                        {e.consorcio ? " (con su parte de un consorcio)" : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Parecidos */}
          {f.parecidos.length > 0 && (
            <section aria-labelledby="parecidos-t">
              <h2 id="parecidos-t" className="font-display text-seccion font-bold leading-tight text-ink">
                Proyectos parecidos
              </h2>
              <p className="mt-1 text-meta text-mute">Del mismo sector y de un costo parecido, de preferencia en la misma región, que se vienen o están en marcha.</p>
              <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {f.parecidos.map((p) => (
                  <li key={p.cui} className="min-w-0">
                    <Link
                      href={ruta(`/proyecto/${p.cui}`)}
                      className="group flex h-full flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <FaseInsignia fase={p.fase} />
                        <span className="text-rotulo text-mute">{lugarProyecto(p)}</span>
                      </span>
                      <span className="mt-2 line-clamp-2 text-dato font-semibold leading-snug text-ink group-hover:text-granate">{nombreProyecto(p.nombre, p)}</span>
                      <span className="mt-auto flex items-end justify-between gap-2 pt-3">
                        <span className="min-w-0 truncate text-meta text-inkSoft">{nombreEntidad(p.entidad)}</span>
                        <span className="shrink-0 font-display text-bloque font-bold tabular-nums text-ink">{solesCompacto(p.costo)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── Columna: qué sigue y acciones ── */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-3xl border border-line bg-paper p-5">
            <a href={inversionSsi(f.cui)} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "w-full")}>
              Ver en el MEF (Invierte.pe) <ArrowUpRight size={16} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            {principal && (
              <a href={obraInfobras(principal.codigo)} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario", "mt-2 w-full")}>
                Ver la obra en INFOBRAS <ArrowUpRight size={16} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            )}
            <BotonGuardar
              producto="obras"
              base={base}
              tipo="proyecto"
              codigo={f.cui}
              titulo={nombreProyecto(f.nombre, f.lugar)}
              datos={{ entidad: f.entidad.nombre ?? null }}
              className="mt-2"
            />
            <Link
              href={`${ruta("/proyectos")}?pestana=todos&sector=${encodeURIComponent(f.sector)}${f.lugar.region ? `&region=${f.lugar.region}` : ""}#crear-alerta`}
              className={claseAccion("fantasma", "mt-2 w-full")}
            >
              <BellRing size={16} aria-hidden /> Crear una alerta así
            </Link>
          </div>

          <section aria-labelledby="sigue-t" className="sobre-oscuro rounded-3xl bg-ink p-5 text-paper">
            <h2 id="sigue-t" className="font-display text-bloque font-bold leading-tight">
              {sigue.titulo}
            </h2>
            <p className="mt-2 text-dato leading-relaxed text-paper/80">{sigue.texto}</p>
            {!f.obraRepresenta && f.avanceMef != null && (
              <div className="mt-4 border-t border-paper/10 pt-4">
                <BarraAvance
                  oscuro
                  real={f.avanceMef}
                  etiqueta="Avance físico (MEF)"
                  pie={`INFOBRAS registra ${numero(f.obras.length)} ${f.obras.length === 1 ? "obra" : "obras"} con su CUI, partes del proyecto.`}
                />
              </div>
            )}
            {f.obraRepresenta && principal && (principal.avance.fisico != null || principal.paralizacion) && (
              <div className="mt-4 space-y-3 border-t border-paper/10 pt-4">
                <BarraAvance
                  oscuro
                  real={principal.avance.fisico}
                  programado={principal.avance.programado}
                  etiqueta="Avance de su obra"
                  pie={principal.avance.al ? `Registrado en INFOBRAS el ${fechaCorta(principal.avance.al)} (${haceTiempo(principal.avance.al)})` : undefined}
                />
                {principal.paralizacion?.hoy && (
                  <p className="flex items-start gap-1.5 text-meta text-paper/80">
                    <CirclePause size={15} aria-hidden className="mt-0.5 shrink-0 text-maiz" />
                    Paralizada{principal.paralizacion.desde ? ` desde el ${fechaCorta(principal.paralizacion.desde)}` : ""}
                    {principal.paralizacion.causal ? `: ${principal.paralizacion.causal.toLocaleLowerCase("es-PE")}` : ""}
                  </p>
                )}
              </div>
            )}
          </section>

          <div className="space-y-2">
            {f.entidad.ruc && (
              <Link href={`${ruta("/proyectos")}?pestana=todos&entidad=${f.entidad.ruc}`} className="block rounded-3xl border border-line bg-paperSoft p-5 transition-colors duration-rapido hover:border-granate/40">
                <p className="font-display text-bloque font-bold leading-tight text-ink">Más proyectos de esta entidad</p>
                <p className="mt-1 text-meta text-inkSoft">{nombreEntidad(f.entidad.nombre)}: lo que se viene, lo que está en marcha y lo paralizado.</p>
              </Link>
            )}
            <Link
              href={`${ruta("/mercado")}?${new URLSearchParams({ ...(f.lugar.region ? { region: f.lugar.region } : {}), sector: f.sector }).toString()}`}
              className="block rounded-3xl border border-line bg-paperSoft p-5 transition-colors duration-rapido hover:border-granate/40"
            >
              <p className="font-display text-bloque font-bold leading-tight text-ink">
                El mercado de {nombreSector(f.sector).toLocaleLowerCase("es-PE")}
                {f.lugar.region ? ` en ${nombreRegion(f.lugar.region)}` : ""}
              </p>
              <p className="mt-1 inline-flex items-center gap-1 text-meta text-inkSoft">
                Cuánto se viene, cuánto está en marcha y quién gana las obras <ArrowRight size={13} aria-hidden />
              </p>
            </Link>
            {f.entidad.ruc && (
              <a
                href={`https://vigia.gobserva.cloud/entidad/${f.entidad.ruc}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-1 text-meta font-semibold text-granate underline-offset-2 hover:underline"
              >
                <ShieldCheck size={15} aria-hidden /> La entidad en Vigía <ArrowUpRight size={13} aria-hidden />
              </a>
            )}
          </div>

          <div className="rounded-3xl border border-line bg-paper p-5 text-meta text-inkSoft">
            <p className="font-semibold text-ink">Fuentes oficiales</p>
            <ul className="mt-2 space-y-1.5">
              <li>
                <a href={inversionSsi(f.cui)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-granate hover:underline">
                  Seguimiento de la inversión (MEF) <ArrowUpRight size={12} aria-hidden />
                </a>
              </li>
              {f.obras.slice(0, 3).map((o) => (
                <li key={o.codigo}>
                  <a href={obraInfobras(o.codigo)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-granate hover:underline">
                    Obra {o.codigo} en INFOBRAS <ArrowUpRight size={12} aria-hidden />
                  </a>
                </li>
              ))}
              <li>
                <a href={CONTRATACIONES_ABIERTAS} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-granate hover:underline">
                  Contrataciones Abiertas (OECE) <ArrowUpRight size={12} aria-hidden />
                </a>
              </li>
            </ul>
            <p className="mt-3 text-rotulo text-mute">
              <CalendarDays size={12} aria-hidden className="mr-1 inline" />
              Invierte.pe al {fechaConAnio(f.alDia.inversiones)}
              {f.alDia.infobras ? `; INFOBRAS al ${fechaConAnio(f.alDia.infobras)}` : ""}.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** «PROYECTO DE INVERSION» → «Proyecto de inversión», «PIP MAYOR (SNIP)» → «PIP mayor (SNIP)»: las siglas del MEF siguen siendo siglas. */
const tituloTipo = (t: string) => limpiar(t).replace(/(?<![\p{L}])(pip|snip|ioarr|iri|app|oxi)(?![\p{L}])/giu, (m) => m.toUpperCase());

function Linea({ Icono, etiqueta, children }: { Icono: LucideIcon; etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <Icono size={17} aria-hidden className="mt-0.5 shrink-0 text-granate" />
      <div className="min-w-0">
        <dt className="text-meta text-mute">{etiqueta}</dt>
        <dd className="text-dato font-medium leading-snug text-ink">{children}</dd>
      </div>
    </div>
  );
}

function Cifra({ Icono, etiqueta, valor, destacado = false, children }: { Icono: LucideIcon; etiqueta: string; valor: string; destacado?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("min-w-0 rounded-2xl border p-4", destacado ? "border-granate/40 bg-granate-50" : "border-line bg-paper")}>
      <dt className="flex items-center gap-1.5 text-meta text-inkSoft">
        <Icono size={16} aria-hidden className="shrink-0 text-granate" /> {etiqueta}
      </dt>
      <dd>
        <span className="mt-2 block font-display text-bloque font-bold leading-tight tabular-nums text-ink sm:text-cifra">{valor}</span>
        {children && <span className="mt-1 block text-rotulo leading-snug text-mute">{children}</span>}
      </dd>
    </div>
  );
}

function Fecha({ etiqueta, valor, mes = false }: { etiqueta: string; valor: string | null | undefined; mes?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-mute">{etiqueta}</dt>
      <dd className="font-medium text-ink">{valor ? (mes ? mesAnio(valor) : fechaConAnio(valor)) : "Sin dato"}</dd>
    </div>
  );
}

/** Quién ejecuta o supervisa: el nombre sólo de una empresa. */
function textoQuien(q: QuienObra | null | undefined, rol: "ejecuta" | "supervisa"): ReactNode {
  if (!q) return rol === "ejecuta" ? "Sin dato en INFOBRAS" : "Sin supervisor registrado";
  if (q.tipo === "empresa") return <b className="font-semibold text-ink">{nombreEmpresa(q.nombre)}</b>;
  if (q.tipo === "entidad") return "La propia entidad (administración directa)";
  if (q.tipo === "consorcio") return "Un consorcio (INFOBRAS no publica sus empresas)";
  return "Una persona natural (no la nombramos)";
}

function ObraFila({ o, lugar }: { o: ObraInfobras; lugar: FichaObras["lugar"] }) {
  const estado = o.estado ?? "Sin estado";
  const tono =
    estado === "Paralizada" ? "bg-crimson-soft text-crimsonTexto" : estado === "En Ejecución" ? "bg-anil/10 text-anilTexto" : estado === "Finalizado" ? "bg-paperDeep text-mute" : "bg-paperDeep text-inkSoft";
  const fin = o.fechas.finReprogramada ?? o.fechas.finProgramada;
  return (
    <li className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full px-2.5 py-0.5 text-rotulo font-semibold", tono)}>{estado === "Finalizado" ? "Terminada" : estado}</span>
        {o.modalidad && <span className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">{o.modalidad}</span>}
        {o.esSaldo && <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-rotulo font-semibold text-amberTexto">Saldo de obra</span>}
        <a
          href={obraInfobras(o.codigo)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-0.5 font-mono text-rotulo text-mute underline-offset-2 hover:text-granate hover:underline"
        >
          INFOBRAS {o.codigo} <ArrowUpRight size={12} aria-hidden />
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      </div>
      <p className="mt-2 line-clamp-3 text-dato font-medium leading-snug text-ink">{nombreProyecto(o.nombre, lugar)}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2">
          <BarraAvance
            real={o.avance.fisico}
            programado={o.avance.programado}
            pie={o.avance.al ? `Registrado el ${fechaConAnio(o.avance.al)} (${haceTiempo(o.avance.al)})` : undefined}
          />
          {o.avance.financiero != null && <p className="text-meta text-inkSoft">Avance financiero: {porcentaje(o.avance.financiero)}</p>}
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 text-meta">
          <div className="min-w-0">
            <dt className="text-mute">Contrato</dt>
            <dd className="font-semibold text-ink">
              {o.montos.contrato ? solesCompacto(o.montos.contrato) : o.montos.contratoDudoso ? <span className="text-amberTexto">Dato dudoso en INFOBRAS</span> : "Sin dato"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-mute">Expediente</dt>
            <dd className="font-semibold text-ink">{o.montos.expediente ? solesCompacto(o.montos.expediente) : "Sin dato"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-mute">Inicio</dt>
            <dd className="font-medium text-ink">{o.fechas.inicio ? fechaConAnio(o.fechas.inicio) : "Sin dato"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-mute">{o.fechas.finReal ? "Terminó" : "Fin previsto"}</dt>
            <dd className="font-medium text-ink">{o.fechas.finReal ? fechaConAnio(o.fechas.finReal) : fin ? fechaConAnio(fin) : "Sin dato"}</dd>
          </div>
        </dl>
      </div>
      {o.paralizacion?.hoy && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-crimson-soft px-3 py-2 text-meta text-crimsonTexto">
          <CirclePause size={15} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            Paralizada{o.paralizacion.desde ? ` desde el ${fechaConAnio(o.paralizacion.desde)}` : ""}
            {o.paralizacion.causal ? `. Causa: ${o.paralizacion.causal.toLocaleLowerCase("es-PE")}` : ". INFOBRAS no registra la causa"}.
          </span>
        </p>
      )}
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-meta text-inkSoft">
        <span>
          <HardHat size={13} aria-hidden className="mr-1 inline text-mute" />
          Ejecuta: {textoQuien(o.ejecutor, "ejecuta")}
        </span>
        {(o.supervisor || o.modalidad === "Contrata") && (
          <span>
            <ShieldCheck size={13} aria-hidden className="mr-1 inline text-mute" />
            Supervisa: {textoQuien(o.supervisor, "supervisa")}
          </span>
        )}
        {(o.montos.adicionales ?? 0) > 0 && <span>Adicionales: {solesCompacto(o.montos.adicionales)}</span>}
        {(o.plazo.ampliacion ?? 0) > 0 && <span>Ampliaciones de plazo: {numero(o.plazo.ampliacion)} días</span>}
      </p>
    </li>
  );
}
