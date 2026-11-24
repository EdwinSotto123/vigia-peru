import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BellPlus,
  BellRing,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleDollarSign,
  CirclePause,
  ClipboardList,
  FileCheck2,
  Gavel,
  HardHat,
  Hourglass,
  MapPin,
  PackageOpen,
  Route,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { BarraAvance, BarrasComparadas, CaminoMini, FaseInsignia, LineaTiempo, TiraCifras, iconoSector, type CifraTira } from "@/components/gobserva-obras/Piezas";
import { Odometro } from "@/components/gobserva/portada/Odometro";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { BotonGuardar } from "@/components/gobserva/cuenta/BotonGuardar";
import { Nota } from "@/components/patrones/Estructura";
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
  estadoObra,
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
  type ProcesoSeace,
  type QuienObra,
} from "@/lib/gobserva-obras";
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
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

/** Los pasos de una inversión, en orden: dónde está ésta. `corto`, para el celular. */
const PASOS: { fase: Fase; nombre: string; corto: string }[] = [
  { fase: "viable", nombre: "Viable", corto: "Viable" },
  { fase: "expediente", nombre: "Expediente técnico", corto: "Expediente" },
  { fase: "licitacion", nombre: "Licitación de la obra", corto: "Licitación" },
  { fase: "ejecucion", nombre: "Ejecución", corto: "Ejecución" },
  { fase: "terminada", nombre: "Obra terminada", corto: "Terminada" },
];
const POSICION: Record<Fase, number> = { viable: 0, expediente: 1, licitacion: 2, ejecucion: 3, paralizada: 3, sin_movimiento: 3, terminada: 4, cerrada: 5 };

/**
 * De qué avisa la alerta de un proyecto (una búsqueda por su CUI): las alertas de Obras avisan cuando un proyecto cambia de
 * fase (lib/gobservaAlertas.ts de la API). Lo terminado o cerrado ya no cambia: ahí no se ofrece.
 */
const AVISO_FASE: Partial<Record<Fase, string>> = {
  viable: "Te avisamos cuando apruebe su expediente técnico o se licite.",
  expediente: "Te avisamos cuando se licite la obra.",
  licitacion: "Te avisamos cuando se contrate y empiece la obra.",
  ejecucion: "Te avisamos si se paraliza o cuando termine.",
  paralizada: "Te avisamos cuando se reactive.",
  sin_movimiento: "Te avisamos si vuelve a tener gasto o avance.",
};

/** El proceso de obra en convocatoria (o, si no, cualquiera en convocatoria). */
const procesoAbierto = (f: FichaObras): ProcesoSeace | undefined =>
  f.procesos.find((p) => p.etapa === "convocada" && p.tipo === "obras") ?? f.procesos.find((p) => p.etapa === "convocada");

/** Lo que sigue para quien quiere entrar al proyecto, según su fase. */
function loQueSigue(f: FichaObras, licitaciones: string): { titulo: string; texto: ReactNode } {
  const anio = new Date().getFullYear();
  const pim = f.montos.pimAnio > 0 ? ` Tiene ${solesCompacto(f.montos.pimAnio)} de presupuesto este ${anio}.` : "";
  // La fecha de inicio de ejecución que registra el MEF: la pista de cuándo se contrataría (la ejecución empieza con el
  // expediente técnico y sigue con la obra). Si ya pasó, también dice algo: va atrasado.
  const inicio = f.fechas.inicioPrevisto;
  const previsto = inicio
    ? inicio.slice(0, 10) > new Date().toISOString().slice(0, 10)
      ? ` Según el MEF, su ejecución empezaría en ${mesAnio(inicio)}.`
      : ` Según el MEF, su ejecución debía empezar en ${mesAnio(inicio)}.`
    : "";
  switch (f.fase) {
    case "viable":
      return {
        titulo: "Lo siguiente: el expediente técnico",
        texto: `Es viable pero no registra expediente técnico. La entidad tiene que contratarlo (una consultoría de obra) o hacerlo ella misma; después se licita la obra.${pim}${previsto}`,
      };
    case "expediente":
      return {
        titulo: "Lo siguiente: licitar la obra",
        texto: `Ya tiene expediente técnico${f.montos.expediente ? ` por ${solesCompacto(f.montos.expediente)}` : ""} y todavía no tiene contrato de obra.${pim}${previsto}`,
      };
    case "licitacion": {
      const abierto = procesoAbierto(f);
      return {
        titulo: "Se está licitando ahora",
        texto: abierto ? (
          <>
            Hay un proceso de {(TIPO_PROCESO[abierto.tipo ?? ""] ?? "obra").toLocaleLowerCase("es-PE")} en convocatoria desde el {fechaCorta(abierto.fecha)}
            {abierto.valor ? `, con un valor referencial de ${solesCompacto(abierto.valor)}` : ""}.{" "}
            <a href={`${licitaciones}/oportunidad/${encodeURIComponent(abierto.ocid)}`} className="font-semibold text-maiz underline underline-offset-2">
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
 * Quién construye el proyecto, para el resumen: la empresa (RUC 20) de su obra principal si esa obra es el proyecto; si no,
 * la que ganó su licitación de obra en el SEACE; si la hace la entidad o un consorcio sin empresas publicadas, eso. De una
 * persona natural, nunca el nombre (y aquí, nada).
 */
function quienConstruye(f: FichaObras): { rol: string; texto: string } | null {
  const principal = f.obras[0];
  const q = f.obraRepresenta ? principal?.ejecutor : null;
  if (q?.tipo === "empresa" && q.ruc) return { rol: "La construye", texto: nombreEmpresa(q.nombre) };
  const obra = f.procesos.find((p) => p.tipo === "obras" && p.ganadores.empresas.length > 0);
  if (obra) {
    const g = obra.ganadores.empresas[0];
    return { rol: "Ganó la licitación de la obra", texto: `${nombreEmpresa(g.nombre)}${g.consorcio ? " (en consorcio)" : ""}` };
  }
  if (q?.tipo === "entidad") return { rol: "La construye", texto: "La propia entidad, por administración directa" };
  if (q?.tipo === "consorcio") return { rol: "La construye", texto: "Un consorcio (INFOBRAS no publica sus empresas)" };
  return null;
}

/** La cuarta cifra del resumen, según la fase: el expediente, la licitación o el avance de la obra. */
function cifraFase(f: FichaObras): CifraTira {
  const principal = f.obras[0];
  switch (f.fase) {
    case "viable":
      return { Icono: FileCheck2, etiqueta: "Expediente técnico", valor: "Todavía no", detalle: "Lo siguiente es contratarlo" };
    case "expediente":
      return { Icono: FileCheck2, etiqueta: "Expediente técnico", valor: f.montos.expediente ? solesCompacto(f.montos.expediente) : "Aprobado", detalle: "Lo siguiente: licitar la obra" };
    case "licitacion": {
      const abierto = procesoAbierto(f);
      return { Icono: Gavel, etiqueta: "Licitación", valor: "En convocatoria", detalle: abierto?.fecha ? `Desde el ${fechaCorta(abierto.fecha)}` : "Un proceso de obra en el SEACE" };
    }
    default: {
      if (f.obraRepresenta && principal && principal.avance.fisico != null) {
        const prog = principal.avance.programado;
        return {
          Icono: HardHat,
          etiqueta: "Avance de la obra",
          valor: porcentaje(principal.avance.fisico),
          detalle: prog != null ? `De ${porcentaje(prog)} programado${prog - principal.avance.fisico >= 20 ? ": atrasada" : ""}` : principal.avance.al ? `Registrado ${haceTiempo(principal.avance.al)}` : undefined,
        };
      }
      if (f.avanceMef != null) return { Icono: HardHat, etiqueta: "Avance físico (MEF)", valor: porcentaje(f.avanceMef), detalle: "El que registra el MEF" };
      return { Icono: HardHat, etiqueta: "Avance de la obra", valor: "Sin dato", detalle: f.obras.length ? "INFOBRAS no registra su avance" : "Sin obra en INFOBRAS" };
    }
  }
}

/**
 * La ficha de un proyecto de inversión en Gobserva Obras, para responder de un vistazo qué es, cuánto cuesta y cuánto
 * falta, en qué paso está, cuándo se licita y quién lo construye: la cabecera (fase, nombre, entidad, lugar), el resumen
 * en cifras, lo que sigue y las acciones (al costado en escritorio, debajo del resumen en el celular), la plata, el camino
 * del proyecto, sus obras de INFOBRAS con su avance y su contratista, los procesos del SEACE que citan su CUI con quién los
 * ganó, los contratistas juntos, proyectos parecidos, dónde seguir y las fuentes oficiales. Sin nombres de personas
 * naturales. GET /proyectos/ficha/:cui.
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
  const sobreViable = costo && f.montos.viable && costo > f.montos.viable * 1.05 ? (costo / f.montos.viable - 1) * 100 : null;
  const principal = f.obras[0] ?? null;
  const sigue = loQueSigue(f, licitaciones);
  const empresas = contratistas(f);
  const quien = quienConstruye(f);
  const posicion = POSICION[f.fase ?? "cerrada"];
  const aviso = f.fase ? AVISO_FASE[f.fase] : undefined;
  const OBRAS_VISIBLES = 6;
  const nombre = nombreProyecto(f.nombre, f.lugar);
  const hoy = new Date().toISOString().slice(0, 10);
  const porEstado = [...f.obras.reduce((m, o) => m.set(estadoObra(o.estado), (m.get(estadoObra(o.estado)) ?? 0) + 1), new Map<string, number>())].sort(
    (a, b) => b[1] - a[1],
  );
  const maxEmpresa = Math.max(...empresas.map((e) => e.monto), 1);
  const alertaCui = `${ruta("/proyectos")}?pestana=todos&q=${f.cui}#crear-alerta`;
  const alertaParecidos = `${ruta("/proyectos")}?pestana=todos&sector=${encodeURIComponent(f.sector)}${f.lugar.region ? `&region=${f.lugar.region}` : ""}#crear-alerta`;

  const resumen: CifraTira[] = [
    {
      Icono: CircleDollarSign,
      etiqueta: "Costo actualizado",
      valor: solesCompacto(costo),
      detalle: sobreViable ? `${porcentaje(sobreViable)} más que al declararse viable` : f.montos.viable ? `Viable por ${solesCompacto(f.montos.viable)}` : undefined,
    },
    {
      Icono: Hourglass,
      etiqueta: "Falta ejecutar",
      valor: solesCompacto(f.montos.porEjecutar),
      detalle: pctGastado != null ? `${porcentaje(Math.min(pctGastado, 100))} ya gastado` : "Nada gastado todavía",
      destacado: true,
    },
    {
      Icono: Wallet,
      etiqueta: `Presupuesto ${anio}`,
      valor: f.montos.pimAnio > 0 ? solesCompacto(f.montos.pimAnio) : "Sin presupuesto",
      detalle:
        f.montos.pimAnio > 0
          ? `Gastado este año: ${solesCompacto(f.montos.devengadoAnio)} (${porcentaje((f.montos.devengadoAnio / f.montos.pimAnio) * 100)})`
          : `Sin plata asignada para ${anio}`,
    },
    cifraFase(f),
  ];

  /** Lo que sigue, en la banda oscura. Va dos veces (celular y escritorio): `sufijo` evita ids repetidos. */
  const bloqueSigue = (sufijo: string) => (
    <section aria-labelledby={`sigue-t${sufijo}`} className="sobre-oscuro rounded-3xl bg-ink p-5 text-paper">
      <h2 id={`sigue-t${sufijo}`} className="font-display text-bloque font-bold leading-tight">
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
  );

  /** Seguir el proyecto: la alerta de su CUI (lo que la vende), guardarlo y la alerta de los parecidos. */
  const acciones = (
    <div className="rounded-3xl border border-line bg-paper p-5">
      <h2 className="font-display text-bloque font-bold leading-tight text-ink">Sigue este proyecto</h2>
      <p className="mt-1 text-meta leading-relaxed text-inkSoft">
        {aviso
          ? `${aviso} ${COBROS_EN_PAUSA ? "Cada mañana, gratis con tu cuenta." : "Con la cuenta gratis, cada semana; con Pro, cada mañana."}`
          : "Guárdalo en tu cuenta con una nota y su estado, o recibe los proyectos nuevos que se le parecen."}
      </p>
      {aviso && (
        <Link href={alertaCui} prefetch={false} className={claseAccion("primario", "mt-4 min-h-11 w-full")}>
          <BellRing size={16} aria-hidden /> Avísame cuando cambie de fase
        </Link>
      )}
      <Suspense fallback={<span aria-hidden className="mt-2 block h-11 w-full animate-pulse rounded-full bg-paperDeep" />}>
        <BotonGuardar producto="obras" base={base} tipo="proyecto" codigo={f.cui} titulo={nombre} datos={{ entidad: f.entidad.nombre ?? null }} className="mt-2 w-full" />
      </Suspense>
      <Link href={alertaParecidos} prefetch={false} className={claseAccion(aviso ? "fantasma" : "primario", "mt-2 min-h-11 w-full")}>
        <BellPlus size={16} aria-hidden /> Alerta de proyectos parecidos
      </Link>
    </div>
  );

  return (
    <div className="container-page pb-8 pt-3 sm:pb-12 sm:pt-6">
      <DatosEstructurados datos={datosProyecto(f)} />
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <nav aria-label="Ruta" className="flex flex-wrap items-center gap-x-1.5 text-meta text-mute">
          <Link href={ruta("/proyectos")} className="inline-flex min-h-11 items-center gap-1 font-semibold text-granate underline-offset-2 hover:underline">
            <ArrowLeft size={15} aria-hidden /> Proyectos
          </Link>
          <span aria-hidden>/</span>
          <span className="font-mono text-inkSoft">CUI {f.cui}</span>
        </nav>
        <a
          href={inversionSsi(f.cui)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-inkSoft underline-offset-2 hover:text-granate hover:underline"
        >
          Ver en el MEF (Invierte.pe) <ArrowUpRight size={14} aria-hidden />
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      </div>

      <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── El proyecto ── */}
        <div className="min-w-0 space-y-10">
          <header>
            <div className="flex flex-wrap items-center gap-1.5">
              <FaseInsignia fase={f.fase} tamano="md" />
              <span className="inline-flex items-center gap-1 rounded-full bg-paperDeep px-2.5 py-1 text-rotulo font-medium text-inkSoft">
                <IconoSector size={12} aria-hidden /> {nombreSector(f.sector)}
              </span>
              {f.nivel && <span className="rounded-full bg-paperDeep px-2.5 py-1 text-rotulo font-medium text-inkSoft">{nombreNivel(f.nivel)}</span>}
              {f.tipoInversion && <span className="rounded-full bg-paperDeep px-2.5 py-1 text-rotulo font-medium text-inkSoft">{tituloTipo(f.tipoInversion)}</span>}
              {f.tipo === "equipamiento" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-paperDeep px-2.5 py-1 text-rotulo font-medium text-inkSoft">
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
              {nombre}
            </h1>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-dato sm:grid-cols-2">
              <Linea Icono={Building2} etiqueta="Entidad">
                {f.entidad.ruc ? (
                  <Link href={`${ruta("/proyectos")}?pestana=todos&entidad=${f.entidad.ruc}`} prefetch={false} className="font-medium text-ink underline-offset-2 hover:text-granate hover:underline">
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

          {/* El resumen: cuánto cuesta, cuánto falta, cuánta plata hay este año y en qué va. */}
          <div>
            <TiraCifras etiqueta="El proyecto en cifras" items={resumen} />
            {quien && (
              <dl className="mt-3 flex items-start gap-2.5 rounded-2xl border border-line bg-paper px-4 py-3">
                <HardHat size={17} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                <div className="min-w-0">
                  <dt className="text-meta text-mute">{quien.rol}</dt>
                  <dd className="text-dato font-semibold leading-snug text-ink">{quien.texto}</dd>
                </div>
              </dl>
            )}
            {f.costoDudoso && (
              <p className="mt-3 rounded-xl border border-amber/40 bg-amber-soft px-3 py-2 text-meta text-amberTexto">
                El costo actualizado que publica el MEF es más de mil veces el monto viable (un dato imposible): mostramos el monto viable.
              </p>
            )}
          </div>

          {/* En el celular, lo que sigue y las acciones van aquí, no al final de la página. */}
          <div className="space-y-4 lg:hidden">
            {bloqueSigue("-movil")}
            {acciones}
          </div>

          {/* El detalle, en pestañas (2026-11-22, el usuario: «itera sobre todo… esto es texto plano»): la ficha apilaba la
              plata, el camino, hasta doce obras de INFOBRAS, los procesos y las empresas, y en el celular medía 16,000 px. Ahora
              una cosa a la vista y las demás a un toque (o deslizando), cada una con su forma: barras, línea de tiempo, fichas. */}
          <section aria-labelledby="detalle-t">
            <h2 id="detalle-t" className="font-display text-seccion font-bold leading-tight text-ink">
              El proyecto por dentro
            </h2>
            <PestanasVivas
              etiqueta="El proyecto por dentro"
              className="-mx-1 mt-3 overflow-x-clip px-1"
              pestanas={[
                { titulo: "Su camino", icono: <Route size={16} aria-hidden /> },
                { titulo: "La plata", icono: <CircleDollarSign size={16} aria-hidden /> },
                { titulo: <Contada texto="Obras" n={f.obras.length} />, icono: <HardHat size={16} aria-hidden /> },
                { titulo: <Contada texto="Procesos" n={f.procesosTotal || f.procesos.length} />, icono: <Gavel size={16} aria-hidden /> },
                ...(empresas.length ? [{ titulo: <Contada texto="Empresas" n={empresas.length} />, icono: <ClipboardList size={16} aria-hidden /> }] : []),
              ]}
            >
              {/* Su camino: los cinco pasos y las fechas en una línea de tiempo con la marca de hoy. */}
              <div>
                <ol className="flex items-start" aria-label="Pasos de la inversión">
                  {PASOS.map((p, i) => {
                    const hecho = i < posicion;
                    const actual = i === posicion;
                    const detenida = actual && (f.fase === "paralizada" || f.fase === "sin_movimiento");
                    return (
                      <li key={p.fase} aria-current={actual ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
                        {i < PASOS.length - 1 && <span aria-hidden className={cn("absolute left-1/2 top-3.5 h-0.5 w-full", i < posicion ? "bg-granate" : "bg-line")} />}
                        <span
                          aria-hidden
                          className={cn(
                            "relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-micro font-bold tabular-nums",
                            actual
                              ? detenida
                                ? "bg-crimson text-paper ring-4 ring-crimson/20"
                                : "bg-granate text-paper ring-4 ring-granate/20"
                              : hecho
                                ? "bg-granate text-paper"
                                : "border border-line bg-paper text-mute",
                          )}
                        >
                          {actual && !detenida && <span className="absolute inset-0 rounded-full bg-granate/40 motion-safe:animate-ping" />}
                          <span className="relative">{hecho ? <Check size={14} /> : detenida ? <CirclePause size={14} /> : i + 1}</span>
                        </span>
                        <span
                          className={cn(
                            "mt-2 px-0.5 text-rotulo font-semibold leading-tight sm:text-meta",
                            actual ? (detenida ? "text-crimsonTexto" : "text-ink") : hecho ? "text-inkSoft" : "text-mute",
                          )}
                        >
                          <span className="sm:hidden">{p.corto}</span>
                          <span className="hidden sm:inline">{p.nombre}</span>
                          {detenida && <span className="block font-normal">{f.fase === "paralizada" ? "Paralizada" : "Sin movimiento"}</span>}
                          {hecho && <span className="sr-only"> (cumplido)</span>}
                          {actual && <span className="sr-only"> (paso actual)</span>}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-4 rounded-2xl bg-granate-50 px-4 py-3 text-dato leading-relaxed text-ink">{f.fase ? FASES[f.fase].detalle : "Inversión cerrada en el MEF."}</p>
                <div className="mt-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
                  <LineaTiempo
                    hoy={hoy}
                    hitos={[
                      { etiqueta: "Registrada en el MEF", fecha: f.fechas.registro, texto: f.fechas.registro ? fechaConAnio(f.fechas.registro) : "" },
                      { etiqueta: "Viable o aprobada", fecha: f.fechas.viabilidad, texto: f.fechas.viabilidad ? fechaConAnio(f.fechas.viabilidad) : "" },
                      { etiqueta: "Primer gasto", fecha: f.fechas.primerGasto, texto: mesAnio(f.fechas.primerGasto) },
                      { etiqueta: "Inicio previsto", fecha: f.fechas.inicioPrevisto, texto: f.fechas.inicioPrevisto ? fechaConAnio(f.fechas.inicioPrevisto) : "" },
                      { etiqueta: "Último gasto", fecha: f.fechas.ultimoGasto, texto: mesAnio(f.fechas.ultimoGasto) },
                      f.estado === "cerrada"
                        ? { etiqueta: "Cerrada", fecha: f.fechas.cierre, texto: f.fechas.cierre ? fechaConAnio(f.fechas.cierre) : "" }
                        : { etiqueta: "Fin previsto", fecha: f.fechas.finPrevisto, texto: f.fechas.finPrevisto ? fechaConAnio(f.fechas.finPrevisto) : "" },
                    ]}
                  />
                </div>
              </div>

              {/* La plata: lo gastado en barras, cómo cambió el costo a la misma escala y, a un toque, los montos exactos. */}
              <div>
                <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
                  <div className="space-y-3">
                    <BarraPlata
                      titulo="Del costo total"
                      gastado={f.montos.devengado}
                      total={costo}
                      pie={f.avanceMef != null ? `El MEF registra un avance físico de ${porcentaje(f.avanceMef)}.` : undefined}
                    />
                    {f.montos.pimAnio > 0 && <BarraPlata titulo={`Del presupuesto de ${anio}`} gastado={f.montos.devengadoAnio} total={f.montos.pimAnio} />}
                    {f.beneficiarios ? (
                      <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-4">
                        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
                          <Users size={20} />
                        </span>
                        <p className="min-w-0">
                          <span className="block font-display text-seccion font-bold leading-none tabular-nums text-ink">
                            <Odometro texto={numero(f.beneficiarios)} />
                          </span>
                          <span className="mt-1 block text-meta text-inkSoft">beneficiarios, los que declara la entidad en Invierte.pe</span>
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
                    <h3 className="font-display text-cuerpo font-bold text-ink">Cómo cambió su costo</h3>
                    <BarrasComparadas
                      className="mt-3"
                      etiqueta="Los montos del proyecto, a la misma escala"
                      items={[
                        { etiqueta: "Al declararse viable", valor: f.montos.viable, texto: solesCompacto(f.montos.viable), tono: "suave" },
                        {
                          etiqueta: "Expediente técnico",
                          valor: f.montos.expediente,
                          texto: f.montos.expediente ? solesCompacto(f.montos.expediente) : f.conExpediente ? "Aprobado, sin monto" : "Todavía no",
                          tono: "suave",
                        },
                        {
                          etiqueta: "Costo actualizado",
                          valor: costo,
                          texto: solesCompacto(costo),
                          detalle: sobreViable ? <span className="text-amberTexto">{porcentaje(sobreViable)} más que al declararse viable</span> : undefined,
                        },
                        { etiqueta: "Gastado en total", valor: f.montos.devengado, texto: solesCompacto(f.montos.devengado), tono: "ink" },
                      ]}
                    />
                  </div>
                </div>
                <details className="group/montos mt-4 rounded-2xl border border-line bg-paper">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-dato font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    Los montos exactos, en soles
                    <ChevronDown size={16} aria-hidden className="shrink-0 text-mute transition-transform duration-rapido group-open/montos:rotate-180" />
                  </summary>
                  <dl className="divide-y divide-line border-t border-line">
                    <FilaPlata etiqueta="Monto al declararse viable" valor={soles(f.montos.viable)} />
                    <FilaPlata
                      etiqueta="Costo actualizado"
                      valor={soles(costo)}
                      detalle={sobreViable ? <span className="text-amberTexto">{porcentaje(sobreViable)} más que al declararse viable</span> : undefined}
                    />
                    <FilaPlata
                      etiqueta="Expediente técnico"
                      valor={f.montos.expediente ? soles(f.montos.expediente) : f.conExpediente ? "Aprobado" : "Todavía no"}
                      detalle={f.montos.expediente || f.conExpediente ? "Registrado en el MEF" : "El MEF no lo registra"}
                    />
                    <FilaPlata etiqueta="Gastado en total" valor={soles(f.montos.devengado)} detalle="El devengado: lo que el Estado ya reconoció como gasto" />
                    <FilaPlata etiqueta="Por ejecutar" valor={soles(f.montos.porEjecutar)} detalle="El costo menos lo gastado" />
                    <FilaPlata
                      etiqueta={`Presupuesto ${anio}`}
                      valor={f.montos.pimAnio > 0 ? soles(f.montos.pimAnio) : "Sin presupuesto"}
                      detalle="El PIM: lo que la entidad puede gastar este año"
                    />
                    <FilaPlata etiqueta={`Gastado en ${anio}`} valor={soles(f.montos.devengadoAnio)} />
                    <FilaPlata etiqueta="Beneficiarios" valor={f.beneficiarios ? numero(f.beneficiarios) : "Sin dato"} detalle="Los que declara la entidad en Invierte.pe" />
                  </dl>
                </details>
              </div>

              {/* Las obras de INFOBRAS: cuántas hay en cada estado y las primeras seis; el resto, a un toque. */}
              <div>
                <p className="text-meta text-mute">
                  Lo que registra la entidad en INFOBRAS (Contraloría){f.alDia.infobras ? `, archivo del ${fechaConAnio(f.alDia.infobras)}` : ""}. El avance puede llegar
                  con meses de atraso: cada obra dice a qué fecha corresponde.
                </p>
                {f.obras.length === 0 ? (
                  <Nota className="mt-4">INFOBRAS no registra obras con este CUI todavía: una obra aparece ahí cuando la entidad la inscribe, antes de empezarla.</Nota>
                ) : (
                  <>
                    {f.obras.length > 1 && (
                      <ul aria-label="Sus obras por estado" className="mt-3 flex flex-wrap gap-2">
                        {porEstado.map(([estado, n]) => (
                          <li key={estado} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-semibold", TONO_ESTADO[estado] ?? "bg-paperDeep text-inkSoft")}>
                            <b className="tabular-nums">{numero(n)}</b> {estado.toLocaleLowerCase("es-PE")}
                          </li>
                        ))}
                      </ul>
                    )}
                    <ol className="mt-4 grid gap-3 xl:grid-cols-2">
                      {/* recorte: las seis primeras; las demás en «Ver las otras … obras», debajo */}
                      {f.obras.slice(0, OBRAS_VISIBLES).map((o) => (
                        <ObraFila key={o.codigo} o={o} lugar={f.lugar} />
                      ))}
                    </ol>
                    {f.obras.length > OBRAS_VISIBLES && (
                      <details className="group/obras mt-3">
                        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
                          <ChevronDown size={16} aria-hidden className="transition-transform duration-rapido group-open/obras:rotate-180" />
                          <span className="group-open/obras:hidden">Ver las otras {numero(f.obras.length - OBRAS_VISIBLES)} obras con este CUI</span>
                          <span className="hidden group-open/obras:inline">Ver menos obras</span>
                        </summary>
                        <ol className="mt-3 grid gap-3 xl:grid-cols-2">
                          {f.obras.slice(OBRAS_VISIBLES).map((o) => (
                            <ObraFila key={o.codigo} o={o} lugar={f.lugar} />
                          ))}
                        </ol>
                      </details>
                    )}
                  </>
                )}
              </div>

              {/* Los procesos del SEACE: cada uno una ficha que lleva a Gobserva Licitaciones. */}
              <div>
                <p className="text-meta text-mute">
                  Los procesos que citan este CUI (en el registro OCDS o en su descripción), del más nuevo al más antiguo. De quien ganó, el nombre sólo si es
                  una empresa; de un consorcio, sus empresas integrantes.
                </p>
                {f.procesos.length === 0 ? (
                  <Nota className="mt-4">Ningún proceso del SEACE cita este CUI todavía. Cuando se convoque su obra o su expediente técnico, aparecerá aquí.</Nota>
                ) : (
                  <ol className="mt-4 grid gap-3 lg:grid-cols-2">
                    {f.procesos.map((p) => (
                      <ProcesoFicha key={p.ocid} p={p} lugar={f.lugar} href={`${licitaciones}/oportunidad/${encodeURIComponent(p.ocid)}`} />
                    ))}
                  </ol>
                )}
                {f.procesosTotal > f.procesos.length && (
                  <Nota className="mt-3">
                    Se muestran los {numero(f.procesos.length)} más nuevos de {numero(f.procesosTotal)} procesos. El resto, en{" "}
                    <a href={CONTRATACIONES_ABIERTAS} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-2 hover:underline">
                      Contrataciones Abiertas del OECE
                    </a>
                    .
                  </Nota>
                )}
              </div>

              {/* Las empresas: cada una con su inicial, lo que hizo y lo adjudicado, a la misma escala. */}
              {empresas.length > 0 ? (
                <div>
                  <p className="text-meta text-mute">Juntando INFOBRAS y el SEACE. Sólo empresas (RUC 20); lo ganado en consorcio se reparte en partes iguales.</p>
                  <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {empresas.map((e) => (
                      <li key={e.ruc} className="min-w-0 rounded-2xl border border-line bg-paper p-4">
                        <div className="flex items-start gap-3">
                          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink font-display text-cuerpo font-bold text-paper">
                            {nombreEmpresa(e.nombre).trim().charAt(0).toUpperCase() || "E"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-dato font-semibold leading-snug text-ink">{nombreEmpresa(e.nombre)}</p>
                            <p className="mt-0.5 font-mono text-rotulo text-mute">RUC {e.ruc}</p>
                          </div>
                        </div>
                        <ul className="mt-3 flex flex-wrap gap-1.5">
                          {[...e.roles].map((r) => (
                            <li key={r} className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">
                              {r}
                            </li>
                          ))}
                        </ul>
                        {e.monto > 0 && (
                          <div className="mt-3 border-t border-line pt-3">
                            <p className="flex items-baseline justify-between gap-2 text-meta text-inkSoft">
                              <span>
                                Adjudicado en {numero(e.procesos)} {e.procesos === 1 ? "proceso" : "procesos"}
                                {e.consorcio ? " (con su parte de un consorcio)" : ""}
                              </span>
                              <b className="shrink-0 font-display text-cuerpo font-bold tabular-nums text-ink">{solesCompacto(e.monto)}</b>
                            </p>
                            <span aria-hidden className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                              <span className="gs-barra-crece block h-full rounded-full bg-granate" style={{ width: `${Math.max(3, (e.monto / maxEmpresa) * 100)}%` }} />
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </PestanasVivas>
          </section>

          {/* Parecidos */}
          {f.parecidos.length > 0 && (
            <section aria-labelledby="parecidos-t">
              <h2 id="parecidos-t" className="font-display text-seccion font-bold leading-tight text-ink">
                Proyectos parecidos
              </h2>
              <p className="mt-1 text-meta text-mute">Del mismo sector y de un costo parecido, de preferencia en la misma región, que se vienen o están en marcha.</p>
              {/* En el celular, una fila que se desliza (seis tarjetas apiladas eran una pantalla y media). */}
              <ul className="-mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
                {f.parecidos.map((p) => (
                  <li key={p.cui} className="w-[85%] min-w-0 shrink-0 snap-start scroll-ml-4 sm:w-auto">
                    <Link
                      href={ruta(`/proyecto/${p.cui}`)}
                      className="gs-mira group flex h-full flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <FaseInsignia fase={p.fase} />
                        <span className="text-rotulo text-mute">{lugarProyecto(p)}</span>
                      </span>
                      <CaminoMini fase={p.fase} className="mt-2.5" />
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

          {/* Dónde seguir y las fuentes */}
          <section aria-labelledby="mas-t">
            <h2 id="mas-t" className="font-display text-seccion font-bold leading-tight text-ink">
              Para seguir investigando
            </h2>
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {f.entidad.ruc && (
                <li className="min-w-0">
                  <Link
                    href={`${ruta("/proyectos")}?pestana=todos&entidad=${f.entidad.ruc}`}
                    prefetch={false}
                    className="gs-mira group flex h-full flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50"
                  >
                    <span className="flex items-center gap-2 text-dato font-semibold text-ink group-hover:text-granate">
                      <Building2 size={16} aria-hidden className="shrink-0 text-granate" /> Más proyectos de esta entidad
                    </span>
                    <span className="mt-1 text-meta leading-snug text-inkSoft">{nombreEntidad(f.entidad.nombre)}: lo que se viene, lo que está en marcha y lo paralizado.</span>
                  </Link>
                </li>
              )}
              <li className="min-w-0">
                <Link
                  href={`${ruta("/mercado")}?${new URLSearchParams({ ...(f.lugar.region ? { region: f.lugar.region } : {}), sector: f.sector }).toString()}`}
                  prefetch={false}
                  className="gs-mira group flex h-full flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50"
                >
                  <span className="flex items-center gap-2 text-dato font-semibold text-ink group-hover:text-granate">
                    <ChartNoAxesCombined size={16} aria-hidden className="shrink-0 text-granate" />
                    <span className="min-w-0">
                      El mercado de {nombreSector(f.sector).toLocaleLowerCase("es-PE")}
                      {f.lugar.region ? ` en ${nombreRegion(f.lugar.region)}` : ""}
                    </span>
                  </span>
                  <span className="mt-1 text-meta leading-snug text-inkSoft">Cuánto se viene, cuánto está en marcha y quién gana las obras.</span>
                </Link>
              </li>
              {f.entidad.ruc && (
                <li className="min-w-0">
                  <a
                    href={`https://vigia.gobserva.cloud/entidad/${f.entidad.ruc}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gs-mira group flex h-full flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50"
                  >
                    <span className="flex items-center gap-2 text-dato font-semibold text-ink group-hover:text-granate">
                      <ShieldCheck size={16} aria-hidden className="shrink-0 text-granate" /> La entidad en Vigía <ArrowUpRight size={14} aria-hidden />
                    </span>
                    <span className="mt-1 text-meta leading-snug text-inkSoft">Sus contratos y su presupuesto, en la vigilancia cívica de Gobserva (gratis).</span>
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </a>
                </li>
              )}
            </ul>
            <div className="mt-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
              <h3 className="font-display text-cuerpo font-bold text-ink">Fuentes oficiales</h3>
              <ul className="mt-2 grid gap-x-6 gap-y-1 text-meta sm:grid-cols-2">
                <li>
                  <Fuente href={inversionSsi(f.cui)}>Seguimiento de la inversión (MEF)</Fuente>
                </li>
                {f.obras.slice(0, 3).map((o) => (
                  <li key={o.codigo}>
                    <Fuente href={obraInfobras(o.codigo)}>Obra {o.codigo} en INFOBRAS</Fuente>
                  </li>
                ))}
                {f.obras.length > 3 && (
                  <li className="flex min-h-11 items-center text-mute sm:min-h-8">
                    Y {numero(f.obras.length - 3)} {f.obras.length - 3 === 1 ? "obra más" : "obras más"}: su enlace está en «Sus obras en INFOBRAS».
                  </li>
                )}
                <li>
                  <Fuente href={CONTRATACIONES_ABIERTAS}>Contrataciones Abiertas (OECE)</Fuente>
                </li>
              </ul>
              <p className="mt-3 flex items-start gap-1.5 text-rotulo text-mute">
                <CalendarDays size={13} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  Invierte.pe al {fechaConAnio(f.alDia.inversiones)}
                  {f.alDia.infobras ? `; INFOBRAS al ${fechaConAnio(f.alDia.infobras)}` : ""}.
                </span>
              </p>
            </div>
          </section>
        </div>

        {/* ── Al costado (escritorio): lo que sigue y las acciones, a la vista mientras se lee ── */}
        <aside className="hidden min-w-0 lg:block">
          <div className="space-y-4 lg:sticky lg:top-24">
            {bloqueSigue("")}
            {acciones}
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

/** Una barra de plata: cuánto se gastó de un total, con el porcentaje y lo que falta. */
function BarraPlata({ titulo, gastado, total, pie }: { titulo: string; gastado: number; total: number | null; pie?: ReactNode }) {
  if (!total || total <= 0) return null;
  const pct = Math.max(0, Math.min(100, (gastado / total) * 100));
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-paper p-4">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-meta text-inkSoft">
        <span className="font-semibold text-ink">{titulo}</span>
        <span className="tabular-nums">
          {solesCompacto(gastado)} de {solesCompacto(total)}
        </span>
      </p>
      <span role="img" aria-label={`${titulo}: ${porcentaje(pct)} gastado`} className="mt-2 block h-3 overflow-hidden rounded-full bg-paperDeep">
        <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(pct, 1)}%` }} />
      </span>
      <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-rotulo text-mute">
        <span>
          <b className="font-semibold tabular-nums text-ink">{porcentaje(pct)}</b> gastado
        </span>
        <span className="tabular-nums">Falta {solesCompacto(Math.max(total - gastado, 0))}</span>
      </p>
      {pie && <p className="mt-1 text-rotulo text-mute">{pie}</p>}
    </div>
  );
}

/** Una fila de la tabla de la plata: qué es (y qué quiere decir) y cuánto. */
function FilaPlata({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="min-w-0 text-meta text-inkSoft">
        {etiqueta}
        {detalle && <span className="block text-rotulo text-mute">{detalle}</span>}
      </dt>
      <dd className="shrink-0 text-right text-dato font-semibold tabular-nums text-ink">{valor}</dd>
    </div>
  );
}

function Fuente({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-inkSoft underline-offset-2 hover:text-granate hover:underline sm:min-h-8">
      {children} <ArrowUpRight size={12} aria-hidden />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
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

const TONO_ESTADO: Record<string, string> = {
  Paralizada: "bg-crimson-soft text-crimsonTexto",
  "En ejecución": "bg-anil/10 text-anilTexto",
  Terminada: "bg-paperDeep text-mute",
};

function ObraFila({ o, lugar }: { o: ObraInfobras; lugar: FichaObras["lugar"] }) {
  const estado = estadoObra(o.estado);
  const tono = TONO_ESTADO[estado] ?? "bg-paperDeep text-inkSoft";
  const fin = o.fechas.finReprogramada ?? o.fechas.finProgramada;
  // Una obra inscrita sin avance, montos, fechas ni contratista: una línea, no una tarjeta llena de «Sin dato».
  const vacia = o.avance.fisico == null && !o.montos.contrato && !o.montos.contratoDudoso && !o.montos.expediente && !o.fechas.inicio && !fin && !o.fechas.finReal && !o.ejecutor;
  const cabecera = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cn("rounded-full px-2.5 py-0.5 text-rotulo font-semibold", tono)}>{estado}</span>
      {o.modalidad && <span className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">{o.modalidad}</span>}
      {o.esSaldo && <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-rotulo font-semibold text-amberTexto">Saldo de obra</span>}
      <a
        href={obraInfobras(o.codigo)}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto inline-flex min-h-11 items-center gap-0.5 text-rotulo tabular-nums text-mute underline-offset-2 hover:text-granate hover:underline sm:min-h-0"
      >
        INFOBRAS {o.codigo} <ArrowUpRight size={12} aria-hidden />
        <span className="sr-only"> (se abre en otra pestaña)</span>
      </a>
    </div>
  );
  if (vacia) {
    return (
      <li className="rounded-2xl border border-line bg-paper px-4 py-3">
        {cabecera}
        <p className="mt-1.5 line-clamp-2 text-dato font-medium leading-snug text-ink">{nombreProyecto(o.nombre, lugar)}</p>
        <p className="mt-1 text-rotulo text-mute">INFOBRAS todavía no registra su avance, su contrato ni sus fechas.</p>
      </li>
    );
  }
  return (
    <li className="rounded-2xl border border-line bg-paper p-4">
      {cabecera}
      <p className="mt-2 line-clamp-3 text-dato font-medium leading-snug text-ink">{nombreProyecto(o.nombre, lugar)}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2">
          <BarraAvance
            real={o.avance.fisico}
            programado={o.avance.programado}
            pie={o.avance.al ? `Registrado el ${fechaConAnio(o.avance.al)} (${haceTiempo(o.avance.al)})` : undefined}
          />
          {o.avance.financiero != null && <p className="text-meta text-inkSoft">Avance financiero (lo pagado del contrato): {porcentaje(o.avance.financiero)}</p>}
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 text-meta">
          <div className="min-w-0">
            <dt className="text-mute">Contrato</dt>
            <dd className="font-semibold tabular-nums text-ink">
              {o.montos.contrato ? solesCompacto(o.montos.contrato) : o.montos.contratoDudoso ? <span className="text-amberTexto">Dato dudoso en INFOBRAS</span> : "Sin dato"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-mute">Expediente</dt>
            <dd className="font-semibold tabular-nums text-ink">{o.montos.expediente ? solesCompacto(o.montos.expediente) : "Sin dato"}</dd>
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
      <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-line pt-3 text-meta sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-mute">
            <HardHat size={13} aria-hidden className="shrink-0" /> La ejecuta
          </dt>
          <dd className="mt-0.5 text-inkSoft">{textoQuien(o.ejecutor, "ejecuta")}</dd>
        </div>
        {(o.supervisor || o.modalidad === "Contrata") && (
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-mute">
              <ShieldCheck size={13} aria-hidden className="shrink-0" /> La supervisa
            </dt>
            <dd className="mt-0.5 text-inkSoft">{textoQuien(o.supervisor, "supervisa")}</dd>
          </div>
        )}
        {(o.montos.adicionales ?? 0) > 0 && (
          <div className="min-w-0">
            <dt className="text-mute">Adicionales de obra (lo que se sumó al contrato)</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ink">{solesCompacto(o.montos.adicionales)}</dd>
          </div>
        )}
        {(o.plazo.ampliacion ?? 0) > 0 && (
          <div className="min-w-0">
            <dt className="text-mute">Ampliaciones de plazo</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ink">{numero(o.plazo.ampliacion)} días</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

/** El título de una pestaña con su cuenta («Obras 40»). */
function Contada({ texto, n }: { texto: string; n: number }) {
  return (
    <>
      {texto}
      {n > 0 && <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-meta font-semibold tabular-nums">{numero(n)}</span>}
    </>
  );
}

/** Un monto de un proceso con su barra, a la escala del mayor de los dos (lo referencial contra lo adjudicado). */
function MontoProceso({ etiqueta, valor, max, fuerte = false, barra = true }: { etiqueta: string; valor: number; max: number; fuerte?: boolean; barra?: boolean }) {
  return (
    <span className="block">
      <span className="flex items-baseline justify-between gap-2 text-meta">
        <span className="text-mute">{etiqueta}</span>
        <span className={cn("tabular-nums", fuerte ? "font-display text-cuerpo font-bold text-ink" : "font-semibold text-inkSoft")}>{solesCompacto(valor)}</span>
      </span>
      {barra && (
        <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
          <span className={cn("gs-barra-crece block h-full rounded-full", fuerte ? "bg-granate" : "bg-granate/35")} style={{ width: `${Math.max(2, (valor / max) * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

/**
 * Un proceso del SEACE como ficha que se toca entera (lleva a su página en Gobserva Licitaciones): su tipo y su etapa en
 * pastillas (la convocatoria abierta, con el punto que late), el objeto, la fecha, el valor referencial contra lo
 * adjudicado en barras y quién ganó (sólo empresas por su nombre).
 */
function ProcesoFicha({ p, lugar, href }: { p: ProcesoSeace; lugar: FichaObras["lugar"]; href: string }) {
  const convocada = p.etapa === "convocada";
  const max = Math.max(p.valor ?? 0, p.adjudicado ?? 0, 1);
  return (
    <li className="min-w-0">
      <a
        href={href}
        className="gs-mira group flex h-full min-w-0 flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      >
        <span className="flex items-start justify-between gap-3">
          <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", convocada ? "bg-amber-soft text-amberTexto" : "bg-granate-50 text-granate")}>
            <Gavel size={18} />
          </span>
          <span className="flex flex-wrap justify-end gap-1.5">
            <span className="rounded-full bg-granate-50 px-2.5 py-0.5 text-rotulo font-semibold text-granate">{TIPO_PROCESO[p.tipo ?? ""] ?? "Proceso"}</span>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-rotulo font-semibold", convocada ? "bg-amber-soft text-amberTexto" : "bg-paperDeep text-inkSoft")}>
              {convocada && (
                <span aria-hidden className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-amber opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber" />
                </span>
              )}
              {ETAPA_PROCESO[p.etapa ?? ""] ?? "Sin etapa"}
            </span>
          </span>
        </span>
        <span className="mt-3 line-clamp-3 text-dato font-semibold leading-snug text-ink group-hover:text-granate">
          {conLugares(limpiar(p.objeto), lugar) || "Proceso sin objeto registrado"}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-rotulo text-mute">
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={12} aria-hidden /> {p.fecha ? fechaConAnio(p.fecha) : "Sin fecha"}
          </span>
          {p.procedimiento && <span>{p.procedimiento}</span>}
        </span>
        {(p.valor != null || p.adjudicado != null) && (
          <span className="mt-3 block space-y-2">
            {p.valor != null && <MontoProceso etiqueta="Valor referencial" valor={p.valor} max={max} barra={p.adjudicado != null} />}
            {p.adjudicado != null && <MontoProceso etiqueta="Adjudicado" valor={p.adjudicado} max={max} fuerte barra={p.valor != null} />}
          </span>
        )}
        {(p.ganadores.empresas.length > 0 || p.ganadores.otros > 0) && (
          <span className="mt-3 flex items-start gap-1.5 text-meta text-inkSoft">
            <Building2 size={14} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            <span>
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
            </span>
          </span>
        )}
        <span className="mt-auto inline-flex items-center gap-1 pt-3 text-meta font-semibold text-granate">
          Ver el proceso en Gobserva Licitaciones <ArrowUpRight size={13} aria-hidden />
        </span>
      </a>
    </li>
  );
}
