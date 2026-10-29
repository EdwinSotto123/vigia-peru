import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, FileWarning, Gavel, ShieldAlert } from "lucide-react";
import { CeldaNumero, CeldaPrincipal, Indicadores, TablaFiltrable, type Columna, type FilaFiltrable, type Indicador } from "@/components/listado";
import { BotonCsv, ConCsv } from "@/components/listado/Paginado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { Ayuda, AyudaTermino, EncabezadoPagina, Franja, FuenteDato, Migas, Nota, Pagina, Seccion } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { API_BASE } from "@/lib/api-client";
import { TIPO_RESPONSABILIDAD } from "@/lib/corrupcion";
import { GRUPOS_CRUCE } from "@/lib/cruces";
import { BUSCADOR_CONTRALORIA } from "@/lib/fuentes";
import { fechaCorta, numero, oracion, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";

export const metadata: Metadata = {
  title: "Lo nuevo",
  description: "Los contratos con antecedentes graves de la última semana, las sanciones nuevas del Tribunal y los informes nuevos de la Contraloría.",
};

/**
 * /app/novedades — lo nuevo (fase 6 del plan del 2026-10-27): los contratos con antecedentes graves cuya buena pro fue en
 * los últimos días, las sanciones nuevas del Tribunal de Contrataciones y los informes nuevos de la Contraloría, cada uno
 * con su ficha y su fuente, y su lista en CSV. GET /novedades.
 *
 * Arriba, las tres cifras (cada una lleva a su sección); cada bloque es una `Seccion` con su descripción de una línea, su ⓘ
 * y el CSV en la cabecera. Antes eran tres h2 de 18 px y un párrafo de tres renglones con las cifras adentro (2026-10-29,
 * el dueño: «texto y ya, nada de jerarquía»).
 */
interface Novedades {
  dias: number;
  contratosHasta: string | null;
  contratos: Contrato[];
  sanciones: { id: number; ruc: string; nombre: string | null; tipo: string | null; resolucion: string | null; fecha: string; desde: string | null; hasta: string | null; multa: number | null }[];
  informes: { codigo: string; numero: string | null; titulo: string | null; entidad: string | null; entidadRuc: string | null; responsabilidades: string[] | null; fecha: string; url: string | null }[];
  /** Cuántos hay de verdad (las listas llegan con tope de 150). Opcional: una API anterior no lo trae. */
  totales?: { contratos: number; sanciones: number; informes: number };
  fuentes: { sanciones: string };
}

interface Contrato {
  ocid: string;
  ruc: string | null;
  proveedor: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  tipo: string | null;
  objeto: string | null;
  fecha: string;
  monto: number | null;
  tipos: string[] | null;
  /** Cada antecedente con su gravedad (casos_cruce.cruces). Opcional: una respuesta anterior, aún en caché, no lo trae. */
  cruces?: { tipo: string; severidad: string; n?: number }[] | null;
  nAlta: number;
}

type Severidad = "alta" | "media" | "baja";

const NOMBRE_CRUCE = new Map(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t.chip ?? t.corto] as const)));
// Las mismas insignias que la pestaña «Control» de una entidad (InformesContraloria): penal en rojo, civil en ámbar.
const VARIANTE_RESP: Record<string, "crimson" | "amber"> = { penal: "crimson", civil: "amber" };
const esSeveridad = (s: unknown): s is Severidad => s === "alta" || s === "media" || s === "baja";

/** Los antecedentes con su gravedad para `CrucesCelda`; `null` si la respuesta no los trae. */
function crucesDe(c: Contrato): { tipo: string; severidad: Severidad }[] | null {
  if (!Array.isArray(c.cruces)) return null;
  return c.cruces.flatMap((x) => {
    const severidad: unknown = x?.severidad;
    return x?.tipo && esSeveridad(severidad) ? [{ tipo: x.tipo, severidad }] : [];
  });
}

async function getNovedades(): Promise<Novedades | null> {
  try {
    const r = await fetch(`${API_BASE}/novedades?dias=7`, { next: { revalidate: 1800 } } as RequestInit);
    return r.ok ? ((await r.json()) as Novedades) : null;
  } catch {
    return null;
  }
}

export default async function NovedadesPage() {
  const d = await getNovedades();
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Lo nuevo", href: "/app/novedades" }]} />
      <EncabezadoPagina
        titulo="Lo nuevo"
        bajada="Los contratos con antecedentes graves de la última semana, y las sanciones y los informes de control del último mes."
      />
      {!d ? (
        <EstadoVacio variante="compacta" tono="error">No pudimos leer lo nuevo ahora. Vuelve a intentarlo en un momento.</EstadoVacio>
      ) : (
        <>
          <Indicadores items={cifras(d)} />
          <div className="space-y-10">
            <Contratos d={d} />
            <Sanciones d={d} />
            <Informes d={d} />
          </div>
          <Nota>
            Un antecedente es un dato oficial que coincide con el ganador (una sanción, un vínculo, un aporte): no prueba una
            irregularidad. La fecha de un contrato es la de su buena pro; la de una sanción, la de su resolución.
          </Nota>
          <FuenteDato fuente="OECE (SEACE y CONOSCE), Tribunal de Contrataciones y Contraloría" />
        </>
      )}
    </Pagina>
  );
}

/** «En los 7 días hasta el 20 oct.»: la semana termina en el último día con antecedentes ya calculados. */
function ventana(d: Novedades): string {
  return d.contratosHasta ? `en los ${d.dias} días hasta el ${fechaCorta(d.contratosHasta)}` : `en los últimos ${d.dias} días`;
}

/** Las tres cifras de la cabecera, cada una con el ancla de su sección. Sin `totales` (una API anterior), las listas. */
function cifras(d: Novedades): Indicador[] {
  const t = d.totales ?? { contratos: d.contratos.length, sanciones: d.sanciones.length, informes: d.informes.length };
  return [
    {
      valor: t.contratos ? numero(t.contratos) : "Ninguno",
      etiqueta: t.contratos === 1 ? "contrato con antecedentes graves" : "contratos con antecedentes graves",
      contexto: `buena pro ${ventana(d)}`,
      tono: t.contratos ? "alta" : "neutro",
      href: "#nuevo-contratos",
    },
    {
      valor: t.sanciones ? numero(t.sanciones) : "Ninguna",
      etiqueta: t.sanciones === 1 ? "sanción nueva a una empresa" : "sanciones nuevas a empresas",
      contexto: "del Tribunal, último mes",
      href: "#nuevo-sanciones",
    },
    {
      valor: t.informes ? numero(t.informes) : "Ninguno",
      etiqueta: t.informes === 1 ? "informe de control nuevo" : "informes de control nuevos",
      contexto: "de la Contraloría, último mes",
      href: "#nuevo-informes",
    },
  ];
}

/** Un enlace a la fuente oficial con la forma de una acción (la de una `Franja`): se abre en otra pestaña. */
function AccionFuente({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
      {children}
      <ExternalLink size={14} aria-hidden />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}

function Contratos({ d }: { d: Novedades }) {
  const columnas: Columna[] = [
    { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1.6fr)" },
    // La razón de que el contrato esté aquí: antes era el cuarto dato gris de la fila, cortado en escritorio y ausente en el
    // celular. Desde md en su columna; en el celular, bajo el título.
    { clave: "antecedentes", titulo: "Antecedentes del ganador", corto: "Antecedentes", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
    { clave: "monto", titulo: "Monto", ancho: "7.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const filas: FilaFiltrable[] = d.contratos.map((c) => {
    const tipos = (c.tipos ?? []).map((t) => NOMBRE_CRUCE.get(t) ?? t.replace(/_/g, " "));
    const cruces = crucesDe(c);
    return {
      id: `${c.ocid}-${c.ruc ?? "x"}`,
      href: rutaContrato(c.ocid),
      celdas: {
        contrato: (
          <CeldaPrincipal
            // Dos líneas, como en la lista de contratos: «qué se compra» es el dato de la fila.
            titulo={c.objeto ? oracion(c.objeto) : "Contrato sin objeto registrado"}
            dosLineas
            meta={[
              <Dato key="e" tipo="entidad" nombre="Entidad">{c.entidad ? tituloNatural(c.entidad) : "Sin entidad"}</Dato>,
              <Dato key="g" tipo="personas" nombre="Ganó">{c.proveedor ? tituloNatural(c.proveedor) : "Una persona natural"}</Dato>,
              <Dato key="f" tipo="fecha" nombre="Buena pro">{fechaCorta(c.fecha)}</Dato>,
            ]}
          />
        ),
        // Sin `cruces` (una respuesta vieja en caché) no se sabe la gravedad de cada uno: van los nombres, sin inventarla.
        antecedentes: cruces ? (
          <CrucesCelda cruces={cruces} />
        ) : tipos.length ? (
          <Dato tipo="tipo" nombre="Antecedentes" className="line-clamp-2 text-meta text-inkSoft">{tipos.join(", ")}</Dato>
        ) : (
          <span className="text-meta text-mute">Sin dato</span>
        ),
        monto: <CeldaNumero>{c.monto ? solesCompacto(c.monto) : "Sin monto"}</CeldaNumero>,
      },
      buscable: `${c.objeto ?? ""} ${c.entidad ?? ""} ${c.proveedor ?? ""} ${tipos.join(" ")}`,
      valores: { tipo: c.tipos ?? [] },
      claves: { fecha: c.fecha, monto: c.monto ?? 0 },
      csv: { buena_pro: c.fecha, objeto: c.objeto, entidad: c.entidad, ruc_entidad: c.entidadRuc, ganador: c.proveedor, ruc_ganador: c.ruc, monto: c.monto, antecedentes: tipos.join("; "), ficha: rutaContrato(c.ocid) },
    };
  });
  const tiposPresentes = [...new Set(d.contratos.flatMap((c) => c.tipos ?? []))];
  const total = d.totales?.contratos ?? d.contratos.length;
  const seccion = (cuerpo: ReactNode, acciones?: ReactNode) => (
    <Seccion
      id="nuevo-contratos"
      titulo="Contratos con antecedentes graves"
      descripcion={
        total > d.contratos.length
          ? `Los ${numero(d.contratos.length)} con más antecedentes graves y de mayor monto, de ${numero(total)} con buena pro ${ventana(d)}.`
          : `Con buena pro ${ventana(d)}. Cada uno abre su ficha, con la evidencia de sus antecedentes.`
      }
      ayuda={
        d.contratosHasta ? (
          <Ayuda titulo="¿Por qué hasta esa fecha?">
            Las buenas pro llegan del OECE una vez por semana y sus antecedentes se calculan después: la semana termina el
            {" "}{fechaCorta(d.contratosHasta)}, el último día con antecedentes graves ya calculados.
          </Ayuda>
        ) : undefined
      }
      acciones={acciones}
    >
      {cuerpo}
    </Seccion>
  );
  if (filas.length === 0) {
    return seccion(<Franja icono={<ShieldAlert size={18} />} titulo={`Ninguna buena pro con antecedentes graves del ganador ${ventana(d)}`} />);
  }
  return (
    <ConCsv>
      {seccion(
        <TablaFiltrable
          columnas={columnas}
          filas={filas}
          etiqueta={`${plural(filas.length, "contrato", "contratos")} (toca uno para ver su evidencia)`}
          tam={15}
          nombre="contratos"
          buscar={{ placeholder: "Buscar una entidad, una empresa, un objeto…", etiqueta: "Buscar entre los contratos" }}
          filtros={[{ clave: "tipo", etiqueta: "Antecedente", corta: "Antecedente", opciones: tiposPresentes.map((t) => ({ valor: t, etiqueta: NOMBRE_CRUCE.get(t) ?? t })) }]}
          ordenes={[
            { valor: "monto", etiqueta: "Mayor monto", clave: "monto", dir: "desc" },
            { valor: "reciente", etiqueta: "Lo más reciente", clave: "fecha", dir: "desc" },
          ]}
        />,
        <BotonCsv archivo="lo-nuevo-contratos" total={filas.length} />,
      )}
    </ConCsv>
  );
}

function Sanciones({ d }: { d: Novedades }) {
  const columnas: Columna[] = [
    { clave: "empresa", titulo: "Empresa sancionada", ancho: "minmax(0,1fr)" },
    { clave: "fecha", titulo: "Resolución", ancho: "7rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = d.sanciones.map((s) => ({
    id: String(s.id),
    href: `/empresa/${s.ruc}?seccion=antecedentes`,
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={s.nombre ? tituloNatural(s.nombre) : `Empresa con RUC ${s.ruc}`}
          meta={[
            <Dato key="t" tipo="tipo" nombre="Sanción">{s.tipo === "multa" ? `Multa${s.multa ? ` de ${solesCompacto(s.multa)}` : ""}` : s.tipo === "definitivo" ? "Inhabilitación definitiva" : "Inhabilitación temporal"}</Dato>,
            s.desde ? <Dato key="p" tipo="fecha" nombre="Vigencia">{s.hasta ? `${fechaCorta(s.desde)} a ${fechaCorta(s.hasta)}` : `Desde ${fechaCorta(s.desde)}`}</Dato> : null,
            s.resolucion ? <Dato key="r" tipo="documento" nombre="Resolución">{s.resolucion}</Dato> : null,
          ]}
        />
      ),
      fecha: <CeldaNumero>{fechaCorta(s.fecha)}</CeldaNumero>,
    },
    buscable: `${s.nombre ?? ""} ${s.ruc} ${s.resolucion ?? ""}`,
    valores: { tipo: s.tipo ?? "" },
    claves: { fecha: s.fecha },
    csv: { resolucion_fecha: s.fecha, empresa: s.nombre, ruc: s.ruc, tipo: s.tipo, resolucion: s.resolucion, desde: s.desde, hasta: s.hasta, multa: s.multa },
  }));
  const seccion = (cuerpo: ReactNode, acciones?: ReactNode) => (
    <Seccion
      id="nuevo-sanciones"
      titulo="Sanciones nuevas del Tribunal"
      descripcion="Multas e inhabilitaciones a empresas, con resolución en el último mes."
      ayuda={<AyudaTermino clave="tribunal-contrataciones" />}
      acciones={acciones}
    >
      {cuerpo}
    </Seccion>
  );
  if (filas.length === 0) {
    // Una franja con la fuente como acción (antes, una frase gris junto a un filete y un «Fuente:» suelto debajo).
    return seccion(
      <Franja
        icono={<Gavel size={18} />}
        titulo="Ninguna sanción nueva a empresas en el último mes"
        accion={<AccionFuente href={d.fuentes.sanciones}>Ver el registro del OECE</AccionFuente>}
      >
        Es lo que trae el registro de proveedores sancionados que publica el OECE. Su última actualización está en{" "}
        <Link href="/fuentes" className="font-medium text-ink underline underline-offset-2 hover:text-granate">
          De dónde salen los datos
        </Link>
        .
      </Franja>,
    );
  }
  return (
    <ConCsv>
      {seccion(
        <div className="space-y-2">
          <TablaFiltrable columnas={columnas} filas={filas} etiqueta="Empresas sancionadas (toca una para ver sus antecedentes)" tam={10} nombre="sanciones" />
          <FuenteDato fuente="Proveedores sancionados (OECE, datos abiertos)" href={d.fuentes.sanciones} />
        </div>,
        <BotonCsv archivo="lo-nuevo-sanciones" total={filas.length} />,
      )}
    </ConCsv>
  );
}

/** La responsabilidad presunta que señala el informe, en insignias; sin ninguna registrada, «Sin dato». */
function Responsabilidades({ tipos }: { tipos: string[] | null }) {
  if (!tipos?.length) return <span className="text-meta text-mute">Sin dato</span>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Tipos de responsabilidad">
      {tipos.map((r) => (
        <li key={r}>
          <Badge variant={VARIANTE_RESP[r] ?? "neutral"}>{TIPO_RESPONSABILIDAD[r] ?? r}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Informes({ d }: { d: Novedades }) {
  const columnas: Columna[] = [
    { clave: "informe", titulo: "Informe", ancho: "minmax(0,1.6fr)" },
    { clave: "resp", titulo: "Responsabilidad presunta", corto: "Responsabilidad", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
    { clave: "fecha", titulo: "Emitido", ancho: "7rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = d.informes.map((i) => ({
    id: i.codigo,
    href: i.entidadRuc ? `/entidad/${i.entidadRuc}?seccion=control` : undefined,
    celdas: {
      informe: (
        <CeldaPrincipal
          // En oración: la Contraloría manda casi todos los asuntos en mayúsculas.
          titulo={i.titulo ? oracion(i.titulo) : `Informe ${i.numero ?? i.codigo}`}
          dosLineas
          meta={[
            <Dato key="e" tipo="entidad" nombre="Entidad">{i.entidad ? tituloNatural(i.entidad) : "Sin entidad"}</Dato>,
            i.numero ? <Dato key="n" tipo="codigo" nombre="Informe" mono>{i.numero}</Dato> : null,
          ]}
        />
      ),
      resp: <Responsabilidades tipos={i.responsabilidades} />,
      fecha: <CeldaNumero>{fechaCorta(i.fecha)}</CeldaNumero>,
    },
    buscable: `${i.titulo ?? ""} ${i.entidad ?? ""} ${i.numero ?? ""}`,
    valores: { resp: i.responsabilidades ?? [] },
    claves: { fecha: i.fecha },
    csv: { emitido: i.fecha, informe: i.numero ?? i.codigo, titulo: i.titulo, entidad: i.entidad, ruc_entidad: i.entidadRuc, responsabilidades: (i.responsabilidades ?? []).join("; "), documento: i.url },
  }));
  const seccion = (cuerpo: ReactNode, acciones?: ReactNode) => (
    <Seccion
      id="nuevo-informes"
      titulo="Informes de control nuevos"
      descripcion="Emitidos por la Contraloría en el último mes. Cada uno abre los informes de su entidad, con su documento oficial."
      ayuda={<AyudaTermino clave="informe-control" />}
      acciones={acciones}
    >
      {cuerpo}
    </Seccion>
  );
  if (filas.length === 0) {
    return seccion(
      <Franja
        icono={<FileWarning size={18} />}
        titulo="Ningún informe de control nuevo en el último mes cargado"
        accion={<AccionFuente href={BUSCADOR_CONTRALORIA}>Ver el buscador de la Contraloría</AccionFuente>}
      />,
    );
  }
  return (
    <ConCsv>
      {seccion(
        <TablaFiltrable
          columnas={columnas}
          filas={filas}
          etiqueta={`${plural(filas.length, "informe", "informes")} (toca uno para ver los de su entidad)`}
          tam={10}
          nombre="informes"
          buscar={{ placeholder: "Buscar una entidad o un tema…", etiqueta: "Buscar entre los informes" }}
          // Los mismos nombres que las insignias (y que la pestaña «Control» de la entidad).
          filtros={[{ clave: "resp", etiqueta: "Responsabilidad presunta", corta: "Responsabilidad", opciones: Object.entries(TIPO_RESPONSABILIDAD).map(([valor, etiqueta]) => ({ valor, etiqueta })) }]}
        />,
        <BotonCsv archivo="lo-nuevo-informes" total={filas.length} />,
      )}
    </ConCsv>
  );
}
