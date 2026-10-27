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
import { BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { motivoDudoso } from "@/lib/datoDudoso";
import { numero, oracion, plural, soles } from "@/lib/formato";
import { GRUPOS_CRUCE } from "@/lib/cruces";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { OBJETO_TEXTO, type ContratoEmpresa, type FacetasContratos, type Pagina } from "@/lib/empresas";
import { conAnio, entidadEtq, entidadTexto, NoCargo, opcionesDe, ORDEN_LISTA, Paginas } from "./comun";

/** La pestaña Contratos de la ficha de una empresa: lo que ganó, con filtros en la URL. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Contratos ────────────────────────────────────────────────────────────────

export const P_CONTRATOS = { q: "cq", anio: "canio", como: "ccomo", entidad: "cent", objeto: "cobj", familia: "cfam", departamento: "cdep", bandera: "cband", dudoso: "cdud", cruce: "ccruce", orden: "cord", page: "cpag" } as const;

/** Los valores de la faceta de sanciones (la partición) y los de los enlaces de antes, que siguen filtrando. */
export const BANDERAS_CONTRATO = ["inhabilitada", "sancionada_antes", "solo_despues", "sin_sancion", "sancionada_despues", "antecedentes", "dudoso", "sin"] as const;

const COLUMNAS_CONTRATOS: Columna[] = [
  { clave: "fecha", titulo: "Buena pro", ancho: "92px", desde: "md", apilar: true },
  { clave: "proceso", titulo: "Proceso", ancho: "minmax(0,1.8fr)" },
  {
    // Una sola línea de banderas (las dos de señal más alta y «+n»): antes la sanción, su frase y los chips hacían filas
    // de 170 px en escritorio y 310 en el celular.
    clave: "banderas", titulo: "Banderas", ancho: "minmax(0,1fr)", desde: "lg", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son estas banderas?">
        <span className="block">
          Las sanciones del Tribunal frente a la fecha de la buena pro: «Inhabilitada al ganar» (no podía contratar),
          «Sancionada antes» (ya no estaba vigente al ganar) o «Sancionada después». Luego, los demás antecedentes que pesan
          sobre ese proceso (visitas, postores con el mismo socio, el partido que gobierna…) y un monto con posible error de
          carga, que no se suma.
        </span>
        <span className="mt-2 block">Se ven las dos de señal más alta; las demás, en «+n» y en la ficha del proceso, con sus fechas y su fuente.</span>
      </Ayuda>
    ),
  },
  // En el celular el monto va bajo el título, con su nombre: en su columna de 120 px le dejaba 160 al título.
  { clave: "monto", titulo: "Adjudicado", ancho: "120px", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

/** Las banderas de sanción de un proceso, como antecedentes más de la celda (las etiquetas, en `ETIQUETAS_SANCION`). */
const ETIQUETAS_SANCION: Record<string, string> = {
  sancion_vigente: "Inhabilitada al ganar",
  sancionada_antes: "Sancionada antes",
  sancionada_despues: "Sancionada después",
};

/** Los antecedentes que YA son una sanción del Tribunal anterior al proceso, con su tipo (casos_cruce, migración 121). */
const SANCIONES_CON_TIPO = new Set(["sancion_definitiva", "sancion_temporal", "sancion_multa"]);

/**
 * Lo que va en la celda de banderas de un proceso: su sanción del Tribunal frente a la buena pro (inhabilitada al
 * ganar, o sancionada antes; y sancionada después) y los antecedentes que pesan sobre él, UNA vez cada hecho: si un
 * antecedente ya dice qué sanción tuvo antes («Multa del Tribunal antes»), no va además «Sancionada antes» (era la misma
 * multa dos veces en la fila, 2026-10-27). `CrucesCelda` los ordena por severidad y deja los dos primeros a la vista.
 */
function banderasDe(c: ContratoEmpresa): { tipo: string; severidad: "alta" | "media" | "baja" }[] {
  const s = c.sancion;
  const conTipo = c.antecedentes.some((a) => SANCIONES_CON_TIPO.has(a.tipo));
  return [
    ...(s?.alGanar ? [{ tipo: "sancion_vigente", severidad: "alta" as const }] : s && s.antes > 0 && !conTipo ? [{ tipo: "sancionada_antes", severidad: "media" as const }] : []),
    ...(s && s.despues > 0 ? [{ tipo: "sancionada_despues", severidad: "baja" as const }] : []),
    ...c.antecedentes,
  ];
}

/**
 * La sanción en palabras, con sus fechas (pedido del usuario, 2026-10-22: «Sancionado» no decía si lo estaba cuando
 * contrató o antes). Va en el `title` de la celda: la ficha del proceso la trae completa con su resolución.
 */
function fraseSancion(s: ContratoEmpresa["sancion"]): string | undefined {
  if (!s) return undefined;
  const partes: string[] = [];
  if (s.alGanar) {
    const cual = s.alGanar.tipo === "definitivo" ? " definitiva" : s.alGanar.tipo === "temporal" ? " temporal" : "";
    partes.push(
      `Ganó con una inhabilitación${cual} vigente${s.alGanar.desde ? ` desde el ${conAnio(s.alGanar.desde)}` : ""}${s.alGanar.hasta ? ` hasta el ${conAnio(s.alGanar.hasta)}` : ""}${s.alGanar.resolucion ? ` (Res. ${s.alGanar.resolucion})` : ""}: no podía contratar con el Estado.`,
    );
  } else if (s.antes > 0) {
    partes.push(`${plural(s.antes, "sanción anterior", "sanciones anteriores")} a la buena pro, ninguna vigente al ganar${s.antesHasta ? `: la última terminó el ${conAnio(s.antesHasta)}` : ""}.`);
  }
  if (s.despues > 0) {
    partes.push(`${plural(s.despues, "sanción posterior", "sanciones posteriores")} a la buena pro${s.despuesDesde ? `, desde el ${conAnio(s.despuesDesde)}` : ""}: al ganar no las tenía.`);
  }
  return partes.join(" ") || undefined;
}

/**
 * Los filtros de sus contratos, con cuántos procesos tiene cada opción (§14.1): la faceta de la sanción del Tribunal en
 * chips y los antecedentes del ganador a la vista; detrás de «Filtros», el año, la entidad, el tipo de proceso, el
 * rubro, la región y si la ganó sola o en consorcio. Antes eran 12 controles en la barra y 4 renglones en el celular
 * antes de la primera fila. `facetas` null mientras carga: los mismos filtros sin conteos.
 *
 * La faceta es una PARTICIÓN de sus procesos por la sanción del Tribunal frente a la buena pro (cada proceso en un solo
 * chip y los chips suman «Todos»): antes decía «Todos 321, Sancionada antes 149, Sancionada después 172, Sin banderas
 * 171», que no sumaba (un proceso podía estar en «antes» y en «después», y «sin banderas» contaba los de «después»). El
 * posible error de carga se cruza con cualquiera: va aparte, en su conmutador.
 */
export function BarraContratos({ facetas: f }: { facetas: FacetasContratos | null }) {
  const b = f?.banderas;
  const k = f?.cruces;
  return (
    <BarraFiltros
      busqueda={{ param: P_CONTRATOS.q, placeholder: "Buscar por objeto, entidad o código…", etiqueta: "Buscar en sus contratos", min: 3 }}
      faceta={{
        param: P_CONTRATOS.bandera,
        etiqueta: "Sanción del Tribunal",
        todas: "Todos",
        conteoTodas: f ? f.como.sola + f.como.consorcio : null,
        nombreEnChip: false,
        opciones: [
          { valor: "inhabilitada", etiqueta: "Inhabilitada al ganar", conteo: b?.inhabilitada ?? null, tono: "alta" as const, icono: "alerta" as const },
          { valor: "sancionada_antes", etiqueta: "Sancionada antes", conteo: b?.sancionada_antes ?? null, tono: "media" as const, icono: "atencion" as const },
          { valor: "solo_despues", etiqueta: "Sancionada sólo después", conteo: b?.solo_despues ?? null },
          { valor: "sin_sancion", etiqueta: "Sin sanciones", conteo: b?.sin_sancion ?? null },
        ].filter((o) => o.conteo == null || o.conteo > 0),
      }}
      visibles={[
        // Un conmutador (una sola opción): el monto que el Estado publicó y no se puede creer.
        // Mientras cargan los conteos (o si no llegaron), va igual: si está puesto, tiene que poder quitarse.
        ...(!b || b.dudoso > 0
          ? [{ param: P_CONTRATOS.dudoso, etiqueta: "Posible error de carga", corta: "Error de carga", todas: "Todos", opciones: [{ valor: "si", etiqueta: "Posible error de carga", conteo: b?.dudoso ?? null }] }]
          : []),
        {
          // Cada antecedente del ganador sobre estos procesos, segmentado por familia (Política, En el proceso, Registro
          // SUNAT…), como en /app/contratos. Sólo los tipos que aparecen en sus contratos.
          param: P_CONTRATOS.cruce,
          etiqueta: "Antecedentes del ganador",
          corta: "Antecedentes",
          todas: "Todos",
          opciones: [
            { valor: "con", etiqueta: "Con alguno", conteo: k?.con ?? null },
            { valor: "alta", etiqueta: "Con alguno de señal alta", conteo: k?.alta ?? null },
            ...(k
              ? GRUPOS_CRUCE.flatMap((g) =>
                  g.tipos
                    .filter((t) => (k.tipos?.[t.tipo] ?? 0) > 0)
                    .map((t) => ({ valor: t.tipo, etiqueta: t.corto, grupo: g.titulo, conteo: k.tipos[t.tipo] })))
              : []),
          ],
        },
      ]}
      filtros={[
        { param: P_CONTRATOS.anio, etiqueta: "Año de la buena pro", todas: "Todos los años", opciones: opcionesDe(f?.anios), seccion: "Cuándo y dónde" },
        { param: P_CONTRATOS.entidad, etiqueta: "Entidad que contrató", todas: "Toda entidad", opciones: opcionesDe(f?.entidades, entidadEtq), seccion: "Cuándo y dónde" },
        { param: P_CONTRATOS.departamento, etiqueta: "Región de la entidad", todas: "Todo el Perú", opciones: opcionesDe(f?.departamentos, (x) => tituloNatural(String(x.valor))), seccion: "Cuándo y dónde" },
        { param: P_CONTRATOS.familia, etiqueta: "Tipo de proceso", todas: "Todo tipo de proceso", opciones: opcionesDe(f?.familias), seccion: "Qué y cómo" },
        { param: P_CONTRATOS.objeto, etiqueta: "Rubro", todas: "Todo rubro", opciones: opcionesDe(f?.objetos, (x) => OBJETO_TEXTO[String(x.valor)] ?? String(x.valor)), seccion: "Qué y cómo" },
        {
          param: P_CONTRATOS.como, etiqueta: "Cómo la ganó", todas: "Sola y en consorcio", seccion: "Qué y cómo",
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
    const banderas = banderasDe(c);
    return {
      id: `${c.codigo}-${c.entidadRuc}`,
      href: rutaContrato(c.ocid ?? c.codigo),
      celdas: {
        fecha: <CeldaFecha fecha={c.fecha} />,
        // Una línea en escritorio y dos en el celular (§10.7); el texto completo, en el `title`.
        proceso: (
          <CeldaPrincipal
            titulo={titulo}
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
          <span className="flex min-w-0 max-w-full flex-nowrap items-center gap-1" title={fraseSancion(c.sancion)}>
            {c.dudoso && <BanderaDato motivo={motivoDudoso(c.dudoso) ?? "adjudicado_20x"} fuente="conosce_ordenes" />}
            {(banderas.length > 0 || !c.dudoso) && <CrucesCelda cruces={banderas} etiquetas={ETIQUETAS_SANCION} />}
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
