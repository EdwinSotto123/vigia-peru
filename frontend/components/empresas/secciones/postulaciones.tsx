import Link from "next/link";
import { DatosClave, EstadoVacio, FuenteDato } from "@/components/patrones";
import { CONOSCE_BUSCADOR, busquedaOece } from "@/lib/fuentes";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Tabla,
  type Columna,
  type Fila,
  type Parametros,
} from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { fecha, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import {
  OBJETO_TEXTO,
  esRucEmpresa,
  rutaEmpresa,
  type FacetasPostulaciones,
  type Pagina,
  type PostulacionEmpresa,
} from "@/lib/empresas";
import { entidadEtq, NoCargo, opcionesDe, ORDEN_LISTA, Paginas } from "./comun";

/** La pestaña Postulaciones: los procesos a los que se presentó, ganara o no. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Postulaciones ────────────────────────────────────────────────────────────

export const P_POSTULACIONES = { q: "pq", resultado: "pres", anio: "panio", objeto: "pobj", entidad: "pent", ganador: "pgan", orden: "pord", page: "ppag" } as const;

const COLUMNAS_POSTULACIONES: Columna[] = [
  { clave: "fecha", titulo: "Propuesta", ancho: "92px", desde: "md", apilar: true },
  { clave: "proceso", titulo: "Proceso", ancho: "minmax(0,1.6fr)" },
  { clave: "resultado", titulo: "Resultado", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Adjudicado", ancho: "116px", alinear: "der", desde: "lg" },
];

/**
 * Los filtros de sus postulaciones, con su conteo: el resultado a la vista; año, entidad y quién le ganó (sus
 * competidores, de los que más veces le ganaron a los que menos); detrás, el rubro.
 */
export function BarraPostulaciones({ facetas: f }: { facetas: FacetasPostulaciones | null }) {
  return (
    <BarraFiltros
      busqueda={{ param: P_POSTULACIONES.q, placeholder: "Buscar por objeto, entidad o código…", etiqueta: "Buscar en sus postulaciones", min: 3 }}
      faceta={{
        param: P_POSTULACIONES.resultado,
        etiqueta: "Resultado",
        todas: "Todas",
        conteoTodas: f ? f.resultado.gano + f.resultado.perdio + f.resultado.sin : null,
        nombreEnChip: false,
        opciones: [
          { valor: "gano", etiqueta: "Ganó", conteo: f?.resultado.gano ?? null, tono: "positivo" as const },
          { valor: "perdio", etiqueta: "Ganó otro postor", conteo: f?.resultado.perdio ?? null },
          { valor: "sin", etiqueta: "Sin adjudicación publicada", conteo: f?.resultado.sin ?? null },
        ].filter((o) => o.conteo == null || o.conteo > 0),
      }}
      visibles={[
        { param: P_POSTULACIONES.anio, etiqueta: "Año", corta: "Año", todas: "Todos los años", opciones: opcionesDe(f?.anios) },
        { param: P_POSTULACIONES.entidad, etiqueta: "Entidad que convocó", corta: "Entidad", todas: "Toda entidad", opciones: opcionesDe(f?.entidades, entidadEtq) },
        { param: P_POSTULACIONES.ganador, etiqueta: "Quién le ganó", corta: "Quién le ganó", todas: "Cualquier ganador", opciones: opcionesDe(f?.ganadores) },
      ]}
      filtros={[
        { param: P_POSTULACIONES.objeto, etiqueta: "Rubro", todas: "Todo rubro", opciones: opcionesDe(f?.objetos, (x) => OBJETO_TEXTO[String(x.valor)] ?? String(x.valor)) },
      ]}
      orden={{ param: P_POSTULACIONES.orden, porDefecto: "reciente", opciones: ORDEN_LISTA.filter((o) => o.valor !== "monto_asc") }}
    />
  );
}

export async function BarraPostulacionesConConteos({ pagina }: { pagina: Promise<(Pagina<PostulacionEmpresa> & { facetas: FacetasPostulaciones | null }) | null> }) {
  return <BarraPostulaciones facetas={(await pagina)?.facetas ?? null} />;
}

export async function PostulacionesEmpresa({ pagina: p, ruta, parametros, actual, ruc }: { pagina: Promise<(Pagina<PostulacionEmpresa> & { ganadas: number }) | null>; ruta: string; parametros: Parametros; actual: number; ruc: string }) {
  const pagina = await p;
  if (!pagina) return <NoCargo que="sus postulaciones" />;
  if (!pagina.total) return <EstadoVacio compacto titulo="Ninguna postulación con estos filtros">CONOSCE publica los postores desde 2018.</EstadoVacio>;
  const filas: Fila[] = pagina.data.map((x) => {
    const otros = x.ganadores.filter((g) => g.ruc !== ruc);
    const titulo = x.descripcion ? oracion(x.descripcion) : `Proceso ${x.codigo}`;
    // Una fila es una acción (DESIGN_SYSTEM.md): el panel lleva al proceso y a la ficha de quien ganó.
    return {
      id: x.codigo,
      detalle: {
        titulo,
        etiqueta: `Ver el proceso ${x.codigo}`,
        descripcion: x.entidad ? tituloNatural(x.entidad) : undefined,
        contenido: (
          <div className="space-y-3">
            <DatosClave
              items={[
                {
                  etiqueta: "Entidad",
                  // La entidad que convocó, a su ficha (si la API trae su RUC).
                  valor: !x.entidad ? null : x.entidadRuc ? (
                    <Link href={`/entidad/${x.entidadRuc}`} prefetch={false} className="font-semibold text-granate underline-offset-2 hover:underline">
                      {tituloNatural(x.entidad)}
                    </Link>
                  ) : (
                    tituloNatural(x.entidad)
                  ),
                },
                { etiqueta: "Propuesta", valor: x.fecha ? fecha(x.fecha) : null },
                { etiqueta: "Postuló", valor: x.consorcio ? `En ${tituloNatural(x.consorcio)}` : "Sola" },
                { etiqueta: "Resultado", valor: x.gano ? "Ganó" : otros.length ? "Ganó otro postor" : "Sin adjudicación publicada" },
                { etiqueta: "Adjudicado", valor: x.monto != null ? soles(x.monto) : null, mono: true },
              ]}
            />
            {otros.length > 0 && (
              <div className="space-y-1">
                <p className="text-meta font-semibold text-ink">{otros.length === 1 ? "Quién ganó" : "Quiénes ganaron"}</p>
                <ul className="space-y-1 text-meta">
                  {otros.map((g, i) => (
                    <li key={`${g.ruc ?? g.nombre}-${i}`}>
                      {g.ruc && esRucEmpresa(g.ruc) ? <Link href={rutaEmpresa(g.ruc)} className="font-semibold text-granate underline-offset-2 hover:underline">{g.nombre ?? g.ruc}</Link> : <b>{g.nombre ?? "Una persona natural"}</b>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link href={rutaContrato(x.codigo)} className="inline-block text-meta font-semibold text-granate underline-offset-2 hover:underline">Abrir la ficha del proceso</Link>
          </div>
        ),
        pie: (
          <FuenteDato
            fuente="OECE, CONOSCE, postores y adjudicaciones"
            enlaces={[
              { texto: `El proceso ${x.codigo} en Contrataciones Abiertas (OECE)`, href: busquedaOece(x.codigo) },
              { texto: "Buscador de CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
            ]}
          />
        ),
      },
      celdas: {
        fecha: <CeldaFecha fecha={x.fecha} />,
        proceso: (
          <CeldaPrincipal
            titulo={titulo}
            dosLineas
            meta={[
              x.entidad && <Dato key="entidad" tipo="entidad">{tituloNatural(x.entidad)}</Dato>,
              x.objeto && <Dato key="tipo" tipo="tipo">{OBJETO_TEXTO[x.objeto] ?? x.objeto}</Dato>,
              x.consorcio && <Dato key="consorcio" tipo="personas" nombre="Postuló en consorcio">{`En ${tituloNatural(x.consorcio)}`}</Dato>,
            ]}
          />
        ),
        resultado: x.gano ? (
          <Badge variant="marca">Ganó</Badge>
        ) : otros.length ? (
          <span className="text-meta text-inkSoft">
            Ganó <b className="font-semibold text-ink">{otros[0].nombre ?? otros[0].ruc}</b>
            {otros.length > 1 ? ` y ${otros.length - 1} más` : ""}
          </span>
        ) : (
          <span className="text-meta text-mute">Sin adjudicación publicada</span>
        ),
        monto: <CeldaNumero>{x.monto != null ? solesCompacto(x.monto) : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      },
    };
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-inkSoft">{`${plural(pagina.total, "postulación", "postulaciones")}, ${numero(pagina.ganadas)} ganadas`}</p>
        <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_POSTULACIONES.page} nombre="postulaciones" />
      </div>
      <Tabla columnas={COLUMNAS_POSTULACIONES} filas={filas} etiqueta="Procesos en que fue postor" />
      <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_POSTULACIONES.page} nombre="postulaciones" />
    </div>
  );
}
