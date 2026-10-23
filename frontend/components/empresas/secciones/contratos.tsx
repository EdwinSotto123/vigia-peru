import { Ayuda, EstadoVacio } from "@/components/patrones";
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
import { BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fecha, fechaCorta, numero, oracion, plural, soles } from "@/lib/formato";
import { GRUPOS_CRUCE } from "@/lib/cruces";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { OBJETO_TEXTO, type ContratoEmpresa, type FacetasContratos, type Pagina } from "@/lib/empresas";
import { entidadEtq, entidadTexto, NoCargo, opcionesDe, ORDEN_LISTA, Paginas } from "./comun";

/** La pestaña Contratos de la ficha de una empresa: lo que ganó, con filtros en la URL. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Contratos ────────────────────────────────────────────────────────────────

export const P_CONTRATOS = { q: "cq", anio: "canio", como: "ccomo", entidad: "cent", objeto: "cobj", familia: "cfam", departamento: "cdep", bandera: "cband", cruce: "ccruce", orden: "cord", page: "cpag" } as const;

const COLUMNAS_CONTRATOS: Columna[] = [
  { clave: "fecha", titulo: "Buena pro", ancho: "92px", desde: "md", apilar: true },
  { clave: "proceso", titulo: "Proceso", ancho: "minmax(0,1.8fr)" },
  {
    clave: "banderas", titulo: "Banderas", ancho: "minmax(0,0.8fr)", desde: "lg", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son estas banderas?">
        Las sanciones del Tribunal frente a la fecha de la buena pro: «Inhabilitada al ganar» (no podía contratar), «Sancionada
        antes» (ya no estaban vigentes al ganar) o «Sancionada después». Luego, los demás antecedentes que pesan sobre ese proceso
        (visitas, postores con el mismo socio, el partido que gobierna…) y un monto con posible error de carga, que no se suma.
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Adjudicado", ancho: "120px", alinear: "der" },
];

/**
 * Los filtros de sus contratos, con cuántos procesos tiene cada opción: las banderas a la vista (inhabilitada al ganar,
 * sancionada antes, con antecedentes, posible error de carga), año, entidad y tipo de proceso; detrás de «Filtros», el
 * rubro, la región y si la ganó sola o en consorcio. `facetas` null mientras carga: los mismos filtros sin conteos.
 */
export function BarraContratos({ facetas: f }: { facetas: FacetasContratos | null }) {
  const b = f?.banderas;
  const k = f?.cruces;
  return (
    <BarraFiltros
      busqueda={{ param: P_CONTRATOS.q, placeholder: "Buscar por objeto, entidad o código…", etiqueta: "Buscar en sus contratos", min: 3 }}
      faceta={{
        // La faceta guarda sólo las banderas propias del PROCESO (sanción del Tribunal frente a la buena pro, monto
        // dudoso, sin nada). El "Con antecedentes" agrupado se abrió en el desplegable "Antecedentes del ganador".
        param: P_CONTRATOS.bandera,
        etiqueta: "Banderas",
        todas: "Todos",
        conteoTodas: f ? f.como.sola + f.como.consorcio : null,
        nombreEnChip: false,
        opciones: [
          { valor: "inhabilitada", etiqueta: "Inhabilitada al ganar", conteo: b?.inhabilitada ?? null, tono: "alta" as const, icono: "alerta" as const },
          { valor: "sancionada_antes", etiqueta: "Sancionada antes", conteo: b?.sancionada_antes ?? null, tono: "media" as const, icono: "atencion" as const },
          { valor: "dudoso", etiqueta: "Posible error de carga", conteo: b?.dudoso ?? null },
          { valor: "sancionada_despues", etiqueta: "Sancionada después", conteo: b?.sancionada_despues ?? null },
          { valor: "sin", etiqueta: "Sin banderas", conteo: b?.sin ?? null },
        ].filter((o) => o.conteo == null || o.conteo > 0),
      }}
      visibles={[
        {
          // Cada antecedente del ganador sobre estos procesos, segmentado por familia (Política, En el proceso, Registro
          // SUNAT…), como en /app/contratos. Sólo los tipos que aparecen en sus contratos.
          param: P_CONTRATOS.cruce,
          etiqueta: "Antecedentes del ganador",
          corta: "Antecedentes",
          todas: "Todos",
          opciones: [
            { valor: "con", etiqueta: "Con alguno", conteo: k?.con ?? null },
            { valor: "alta", etiqueta: "Con uno grave", conteo: k?.alta ?? null },
            ...(k
              ? GRUPOS_CRUCE.flatMap((g) =>
                  g.tipos
                    .filter((t) => (k.tipos?.[t.tipo] ?? 0) > 0)
                    .map((t) => ({ valor: t.tipo, etiqueta: t.corto, grupo: g.titulo, conteo: k.tipos[t.tipo] })))
              : []),
          ],
        },
        { param: P_CONTRATOS.anio, etiqueta: "Año de la buena pro", corta: "Año", todas: "Todos los años", opciones: opcionesDe(f?.anios) },
        { param: P_CONTRATOS.entidad, etiqueta: "Entidad que contrató", corta: "Entidad", todas: "Toda entidad", opciones: opcionesDe(f?.entidades, entidadEtq) },
        { param: P_CONTRATOS.familia, etiqueta: "Tipo de proceso", corta: "Proceso", todas: "Todo tipo de proceso", opciones: opcionesDe(f?.familias) },
      ]}
      filtros={[
        { param: P_CONTRATOS.objeto, etiqueta: "Rubro", todas: "Todo rubro", opciones: opcionesDe(f?.objetos, (x) => OBJETO_TEXTO[String(x.valor)] ?? String(x.valor)) },
        { param: P_CONTRATOS.departamento, etiqueta: "Región de la entidad", todas: "Todo el Perú", opciones: opcionesDe(f?.departamentos, (x) => tituloNatural(String(x.valor))) },
        {
          param: P_CONTRATOS.como, etiqueta: "Cómo la ganó", todas: "Sola y en consorcio",
          opciones: [{ valor: "sola", etiqueta: "Sola", conteo: f?.como.sola ?? null }, { valor: "consorcio", etiqueta: "En consorcio", conteo: f?.como.consorcio ?? null }],
        },
      ]}
      orden={{ param: P_CONTRATOS.orden, porDefecto: "reciente", opciones: ORDEN_LISTA }}
    />
  );
}

/** La barra con los conteos de la página ya pedida (espera la misma promesa que la tabla). */
export async function BarraContratosConConteos({ pagina }: { pagina: Promise<(Pagina<ContratoEmpresa> & { facetas: FacetasContratos | null }) | null> }) {
  return <BarraContratos facetas={(await pagina)?.facetas ?? null} />;
}

export async function ContratosEmpresa({ pagina: p, ruta, parametros, actual }: { pagina: Promise<Pagina<ContratoEmpresa> | null>; ruta: string; parametros: Parametros; actual: number }) {
  const pagina = await p;
  if (!pagina) return <NoCargo que="sus contratos" />;
  if (!pagina.total) return <EstadoVacio compacto titulo="Ningún contrato con estos filtros">Quita el filtro de año o la búsqueda.</EstadoVacio>;
  const filas: Fila[] = pagina.data.map((c) => {
    const entidad = entidadTexto(c.entidad, c.entidadRuc);
    const titulo = c.descripcion ? oracion(c.descripcion) : c.nomenclatura ?? "Proceso sin descripción";
    return {
      id: `${c.codigo}-${c.entidadRuc}`,
      href: rutaContrato(c.ocid ?? c.codigo),
      celdas: {
        fecha: <CeldaFecha fecha={c.fecha} />,
        proceso: (
          <CeldaPrincipal
            titulo={titulo}
            dosLineas
            meta={[
              <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              c.objeto && <Dato key="tipo" tipo="tipo">{OBJETO_TEXTO[c.objeto] ?? c.objeto}</Dato>,
              c.familia && c.familia !== "Sin dato" && <Dato key="proceso" tipo="documento" nombre="Tipo de proceso">{c.familia}</Dato>,
              c.nomenclatura && <Dato key="codigo" tipo="codigo" mono>{c.nomenclatura}</Dato>,
              c.consorcio && <Dato key="consorcio" tipo="personas" nombre="Ganó en consorcio">{`En ${tituloNatural(c.consorcio)}`}</Dato>,
            ]}
          />
        ),
        banderas: (
          <span className="flex flex-wrap gap-1">
            {c.sancion && <SancionAlGanar s={c.sancion} />}
            {c.dudoso && <BanderaDato motivo={motivoDudoso(c.dudoso) ?? "adjudicado_20x"} fuente="conosce_ordenes" />}
            {c.antecedentes.length > 0 && <CrucesCelda cruces={c.antecedentes} />}
            {!c.sancion && !c.dudoso && !c.antecedentes.length && <span className="text-meta text-mute">Ninguna</span>}
          </span>
        ),
        monto: (
          <CeldaNumero sub={c.consorcio ? "de todo el consorcio" : c.dudoso ? "posible error de carga" : plural(c.items, "ítem", "ítems")}>
            {c.monto != null ? soles(c.monto) : c.montoOtraMoneda != null ? `${numero(c.montoOtraMoneda)} ${c.otraMoneda ?? ""}`.trim() : "Sin dato"}
          </CeldaNumero>
        ),
      },
    };
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-inkSoft">{plural(pagina.total, "proceso ganado", "procesos ganados")}</p>
        <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_CONTRATOS.page} nombre="contratos" />
      </div>
      <Tabla columnas={COLUMNAS_CONTRATOS} filas={filas} etiqueta="Contratos que ganó" />
      <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_CONTRATOS.page} nombre="contratos" />
    </div>
  );
}

/**
 * Las sanciones del Tribunal frente a la fecha de la buena pro de un contrato, con la fecha que importa escrita al lado
 * (no sólo en el `title`: en el celular no hay cursor). Pedido del usuario (2026-10-22): «Sancionado» no decía si lo
 * estaba cuando contrató o antes.
 */
/** "13 may. 2026" siempre con el año: al lado de un contrato de 2022, «desde el 13 may.» no dice de qué año. */
const conAnio = (d: string) => {
  const f = fechaCorta(d);
  return /\d{4}/.test(f) ? f : `${f} ${d.slice(0, 4)}`;
};

function SancionAlGanar({ s }: { s: NonNullable<ContratoEmpresa["sancion"]> }) {
  const cual = (t: string) => (t === "definitivo" ? "definitiva" : t === "temporal" ? "temporal" : "");
  return (
    <span className="flex w-full flex-col gap-1">
      {s.alGanar ? (
        <span
          className="flex flex-wrap items-center gap-1"
          title={`Ganó con una inhabilitación ${cual(s.alGanar.tipo)} vigente${s.alGanar.desde ? ` desde el ${conAnio(s.alGanar.desde)}` : ""}${s.alGanar.hasta ? ` hasta el ${conAnio(s.alGanar.hasta)}` : ""}${s.alGanar.resolucion ? ` (Res. ${s.alGanar.resolucion})` : ""}: no podía contratar con el Estado.`}
        >
          <Badge variant="crimson">Inhabilitada al ganar</Badge>
          <span className="text-rotulo text-crimsonTexto">
            {s.alGanar.hasta ? `hasta el ${conAnio(s.alGanar.hasta)}` : `inhabilitación ${cual(s.alGanar.tipo)}`}
          </span>
        </span>
      ) : s.antes > 0 ? (
        <span
          className="flex flex-wrap items-center gap-1"
          title={`${plural(s.antes, "sanción anterior", "sanciones anteriores")} a la buena pro; ninguna inhabilitación vigente al ganar${s.antesHasta ? `: la última terminó el ${conAnio(s.antesHasta)}` : ""}.`}
        >
          <Badge variant="amber">Sancionada antes</Badge>
          <span className="text-rotulo text-inkSoft">
            {s.antesHasta ? `ya cumplida el ${conAnio(s.antesHasta)}` : `${plural(s.antes, "sanción", "sanciones")}, ninguna vigente al ganar`}
          </span>
        </span>
      ) : null}
      {s.despues > 0 && (
        <span className="flex flex-wrap items-center gap-1" title={`${plural(s.despues, "sanción", "sanciones")} posteriores a la buena pro${s.despuesDesde ? `, desde el ${conAnio(s.despuesDesde)}` : ""}: al ganar no las tenía.`}>
          <Badge variant="neutral">Sancionada después</Badge>
          {s.despuesDesde && <span className="text-rotulo text-mute">{`desde el ${conAnio(s.despuesDesde)}`}</span>}
        </span>
      )}
    </span>
  );
}
