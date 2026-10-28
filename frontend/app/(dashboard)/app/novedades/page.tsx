import type { Metadata } from "next";
import Link from "next/link";
import { CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { EncabezadoPagina, EnlaceFuente, FuenteDato, Migas, Nota, Pagina } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { API_BASE } from "@/lib/api-client";
import { GRUPOS_CRUCE } from "@/lib/cruces";
import { fechaCorta, numero, plural, solesCompacto } from "@/lib/formato";
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
 */
interface Novedades {
  dias: number;
  contratos: { ocid: string; ruc: string | null; proveedor: string | null; entidad: string | null; entidadRuc: string | null; tipo: string | null; objeto: string | null; fecha: string; monto: number | null; tipos: string[] | null; nAlta: number }[];
  sanciones: { id: number; ruc: string; nombre: string | null; tipo: string | null; resolucion: string | null; fecha: string; desde: string | null; hasta: string | null; multa: number | null }[];
  informes: { codigo: string; numero: string | null; titulo: string | null; entidad: string | null; entidadRuc: string | null; responsabilidades: string[] | null; fecha: string; url: string | null }[];
  fuentes: { sanciones: string };
}

const NOMBRE_CRUCE = new Map(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t.chip ?? t.corto] as const)));
const RESP: Record<string, string> = { penal: "penal", civil: "civil", administrativa_entidad: "administrativa", administrativa_pas: "administrativa (PAS)", administrativa: "administrativa" };

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
        bajada="Los contratos con antecedentes graves de la última semana, y las sanciones y los informes de control del último mes. Cada uno lleva a su ficha y a su fuente."
      />
      {!d ? (
        <EstadoVacio variante="compacta" tono="error">No pudimos leer lo nuevo ahora. Vuelve a intentarlo en un momento.</EstadoVacio>
      ) : (
        <div className="space-y-8">
          <Contratos d={d} />
          <Sanciones d={d} />
          <Informes d={d} />
          <Nota>
            Un antecedente es un dato oficial que coincide con el ganador (una sanción, un vínculo, un aporte): no prueba una
            irregularidad. La fecha de un contrato es la de su buena pro; la de una sanción, la de su resolución.
          </Nota>
          <FuenteDato fuente="OECE (SEACE y CONOSCE), Tribunal de Contrataciones y Contraloría" />
        </div>
      )}
    </Pagina>
  );
}

function Contratos({ d }: { d: Novedades }) {
  const columnas: Columna[] = [
    { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
    { clave: "monto", titulo: "Monto", ancho: "7.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const filas: FilaFiltrable[] = d.contratos.map((c) => {
    const tipos = (c.tipos ?? []).map((t) => NOMBRE_CRUCE.get(t) ?? t.replace(/_/g, " "));
    return {
      id: `${c.ocid}-${c.ruc ?? "x"}`,
      href: rutaContrato(c.ocid),
      celdas: {
        contrato: (
          <CeldaPrincipal
            titulo={c.objeto ? `${c.objeto.charAt(0).toUpperCase()}${c.objeto.slice(1).toLowerCase()}` : "Contrato sin objeto registrado"}
            meta={[
              <Dato key="e" tipo="entidad" nombre="Entidad">{c.entidad ? tituloNatural(c.entidad) : "Sin entidad"}</Dato>,
              <Dato key="g" tipo="personas" nombre="Ganó">{c.proveedor ? tituloNatural(c.proveedor) : "Una persona natural"}</Dato>,
              <Dato key="f" tipo="fecha" nombre="Buena pro">{fechaCorta(c.fecha)}</Dato>,
              tipos.length ? <Dato key="t" tipo="tipo" nombre="Antecedentes">{tipos.slice(0, 3).join(", ")}{tipos.length > 3 ? ` y ${tipos.length - 3} más` : ""}</Dato> : null,
            ]}
          />
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
  return (
    <section aria-labelledby="nuevo-contratos" className="space-y-2">
      <h2 id="nuevo-contratos" className="font-display text-bloque font-bold text-ink">
        Contratos con antecedentes graves, últimos {d.dias} días
      </h2>
      {filas.length === 0 ? (
        <EstadoVacio variante="compacta">En los últimos {d.dias} días no hubo buenas pro con antecedentes graves del ganador.</EstadoVacio>
      ) : (
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
          descargar={{ archivo: "lo-nuevo-contratos" }}
        />
      )}
    </section>
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
  return (
    <section aria-labelledby="nuevo-sanciones" className="space-y-2">
      <h2 id="nuevo-sanciones" className="font-display text-bloque font-bold text-ink">
        Sanciones nuevas del Tribunal, último mes
      </h2>
      {filas.length === 0 ? (
        <EstadoVacio variante="compacta">
          El último mes no trae sanciones nuevas a empresas en el registro que publica la OECE (su última actualización está en «De dónde salen los
          datos»).
        </EstadoVacio>
      ) : (
        <TablaFiltrable columnas={columnas} filas={filas} etiqueta="Empresas sancionadas (toca una para ver sus antecedentes)" tam={10} nombre="sanciones" descargar={{ archivo: "lo-nuevo-sanciones" }} />
      )}
      <p className="text-rotulo text-mute">
        Fuente: <EnlaceFuente href={d.fuentes.sanciones}>Proveedores sancionados (OECE, datos abiertos)</EnlaceFuente>
      </p>
    </section>
  );
}

function Informes({ d }: { d: Novedades }) {
  const columnas: Columna[] = [
    { clave: "informe", titulo: "Informe", ancho: "minmax(0,1fr)" },
    { clave: "fecha", titulo: "Emitido", ancho: "7rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = d.informes.map((i) => ({
    id: i.codigo,
    href: i.entidadRuc ? `/entidad/${i.entidadRuc}?seccion=control` : undefined,
    celdas: {
      informe: (
        <CeldaPrincipal
          titulo={i.titulo ?? `Informe ${i.numero ?? i.codigo}`}
          meta={[
            <Dato key="e" tipo="entidad" nombre="Entidad">{i.entidad ? tituloNatural(i.entidad) : "Sin entidad"}</Dato>,
            i.responsabilidades?.length ? <Dato key="r" tipo="tipo" nombre="Responsabilidad">{i.responsabilidades.map((x) => RESP[x] ?? x).join(", ")}</Dato> : null,
          ]}
        />
      ),
      fecha: <CeldaNumero>{fechaCorta(i.fecha)}</CeldaNumero>,
    },
    buscable: `${i.titulo ?? ""} ${i.entidad ?? ""} ${i.numero ?? ""}`,
    valores: { resp: i.responsabilidades ?? [] },
    claves: { fecha: i.fecha },
    csv: { emitido: i.fecha, informe: i.numero ?? i.codigo, titulo: i.titulo, entidad: i.entidad, ruc_entidad: i.entidadRuc, responsabilidades: (i.responsabilidades ?? []).join("; "), documento: i.url },
  }));
  return (
    <section aria-labelledby="nuevo-informes" className="space-y-2">
      <h2 id="nuevo-informes" className="font-display text-bloque font-bold text-ink">
        Informes de control nuevos, último mes
      </h2>
      {filas.length === 0 ? (
        <EstadoVacio variante="compacta">No hay informes nuevos de la Contraloría en el último mes cargado.</EstadoVacio>
      ) : (
        <TablaFiltrable
          columnas={columnas}
          filas={filas}
          etiqueta={`${plural(filas.length, "informe", "informes")} (toca uno para ver los de su entidad)`}
          tam={10}
          nombre="informes"
          buscar={{ placeholder: "Buscar una entidad o un tema…", etiqueta: "Buscar entre los informes" }}
          filtros={[{ clave: "resp", etiqueta: "Responsabilidad", corta: "Responsabilidad", opciones: [{ valor: "penal", etiqueta: "Penal" }, { valor: "civil", etiqueta: "Civil" }, { valor: "administrativa_entidad", etiqueta: "Administrativa" }, { valor: "administrativa_pas", etiqueta: "Administrativa (PAS)" }] }]}
          descargar={{ archivo: "lo-nuevo-informes" }}
        />
      )}
      {d.informes.length > 0 && <p className="text-rotulo text-mute">{numero(d.informes.length)} informes; cada uno abre los de su entidad, con su documento oficial.</p>}
    </section>
  );
}
