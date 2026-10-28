import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BarraFiltros, CeldaNumero, CeldaPrincipal, Listado, Tabla, ZonaResultados, type Columna, type Fila, type OpcionFaceta, type Parametros } from "@/components/listado";
import { BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EnlaceFuente, EstadoVacio, PieDetalle, Pestanas, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Paginacion } from "@/components/ui/Paginacion";
import { numero, paraBuscar, coincide, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { CONOSCE_BUSCADOR, CONSULTA_AMIGABLE, CONTRATACIONES_ABIERTAS, INFOGOB_JNE, inversionSsi } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { normalizar } from "@/lib/partidos";
import { periodoTexto, type AnioGobierno, type DetallePartido, type GastoPartido, type GobiernoDePartido } from "@/lib/partidosApi";
import { uno } from "@/lib/utils";
import { GastoDetalle } from "@/components/inicio/GastoGobiernos";

/**
 * La pestaña «Gobiernos» de un partido: UNA tabla con TODOS los gobiernos que ganó en el período (región, provincia o
 * distrito) y lo que se sabe de cada uno, en la misma fila: su presupuesto y lo gastado (MEF, sólo en el mandato que
 * incluye el año cargado), sus contratos adjudicados (OECE) y lo que Vigía leyó de ellos, con cuántos tienen señal. Se
 * busca, se filtra por nivel y región y se ordena, todo en la URL (`g…`, compartible; el botón atrás lo deshace), de a
 * 20. Cada fila abre el panel lateral con sus entidades en la base de Vigía (cada una a su ficha), sus proyectos con más
 * presupuesto, la ficha de la entidad que lo abre y sus contratos ya filtrados.
 *
 * Antes la misma relación partido → gobiernos → entidades estaba en tres tablas: «Cada gobierno, por presupuesto» en el
 * Inicio (enlazaba al mapa, y sólo en los regionales), esta pestaña (llevaba a la entidad con más procesos y sus filtros
 * no iban a la URL) y «Sus entidades…» dentro de «Lo que leyó Vigía» (evaluación 2026-10-26).
 *
 * Las unidades ejecutoras del MEF de cada gobierno no llegan una por una (la API da su número total): el panel lista sus
 * entidades con convocatorias en la base de Vigía, que se empatan con el gobierno por nivel, lugar y autoridad. Server
 * component: la barra y el panel son islas de cliente con datos planos.
 */

/** Los parámetros de esta lista en la URL: con su prefijo, para no chocar con los de la lista de contratos. */
export const P_GOB = { q: "gq", nivel: "gnivel", region: "greg", orden: "gord", page: "gpag", vista: "gvista" } as const;
const TAM = 20;
const NIVEL: Record<string, string> = { regional: "Gobierno regional", provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" };
const NIVELES = [
  { valor: "regional", etiqueta: "Regiones" },
  { valor: "provincial", etiqueta: "Provincias" },
  { valor: "distrital", etiqueta: "Distritos" },
] as const;
const ORDENES = [
  { valor: "adjudicado", etiqueta: "Más adjudicado" },
  { valor: "presupuesto", etiqueta: "Más presupuesto" },
  { valor: "gastado", etiqueta: "Menos gastado" },
  { valor: "procesos", etiqueta: "Más contratos" },
  { valor: "senales", etiqueta: "Más con señal" },
  { valor: "nombre", etiqueta: "Nombre, de la A a la Z" },
] as const;
type OrdenGob = (typeof ORDENES)[number]["valor"];

export interface FiltrosGobiernos {
  q?: string;
  nivel?: string;
  region?: string;
  orden: OrdenGob;
  page: number;
  vista?: string;
}

/** Los filtros de la tabla, validados, de la URL. */
export function filtrosGobiernos(sp: Record<string, string | string[] | undefined> | undefined): FiltrosGobiernos {
  const q = uno(sp?.[P_GOB.q])?.slice(0, 80);
  const nivel = uno(sp?.[P_GOB.nivel]);
  const region = uno(sp?.[P_GOB.region]);
  const orden = uno(sp?.[P_GOB.orden]);
  return {
    q: q && q.length >= 2 ? q : undefined,
    nivel: NIVELES.some((n) => n.valor === nivel) ? nivel : undefined,
    region: region && /^\d{2}$/.test(region) ? region : undefined,
    orden: (ORDENES.find((o) => o.valor === orden)?.valor ?? "adjudicado") as OrdenGob,
    page: Math.max(1, Number(uno(sp?.[P_GOB.page])) || 1),
    vista: uno(sp?.[P_GOB.vista]),
  };
}

type Entidad = DetallePartido["entidades"][number];
type Proyecto = NonNullable<GastoPartido["proyectos"]>[number];

interface Gobierno extends GobiernoDePartido {
  pim: number | null;
  devengado: number | null;
  entidades: Entidad[];
  proyectos: Proyecto[];
  texto: string;
}

const claveGob = (nivel: string, ubigeo: string) => `${nivel}|${ubigeo}`;
const claveLugar = (nivel: string, lugar: string | null, autoridad: string | null) => `${nivel}|${normalizar(lugar ?? "")}|${normalizar(autoridad ?? "")}`;
const gastadoPct = (pim: number | null, dev: number | null) => (pim && pim > 0 && dev != null ? (dev / pim) * 100 : null);

/** Cada gobierno con su presupuesto, sus entidades en la base de Vigía y sus proyectos. */
function unir(d: DetallePartido, gasto: GastoPartido | null): Gobierno[] {
  const conMef = !!gasto?.disponible;
  const mef = new Map((gasto?.gobiernos ?? []).map((g) => [claveGob(g.nivel, g.ubigeo), g] as const));
  const proyectos = new Map<string, Proyecto[]>();
  for (const p of gasto?.proyectos ?? []) proyectos.set(claveGob(p.nivel, p.ubigeo), [...(proyectos.get(claveGob(p.nivel, p.ubigeo)) ?? []), p]);
  // Las entidades de la base de Vigía traen el nivel, el lugar y la autoridad de su gobierno (no su ubigeo): con eso se
  // empatan, y sólo si la clave es de UN gobierno (dos distritos homónimos del mismo partido y sin autoridad, no).
  const gobiernos = d.gobiernos ?? [];
  const porLugar = new Map<string, number>();
  for (const g of gobiernos) porLugar.set(claveLugar(g.nivel, g.lugar, g.autoridad), (porLugar.get(claveLugar(g.nivel, g.lugar, g.autoridad)) ?? 0) + 1);
  const entidades = new Map<string, Entidad[]>();
  for (const e of d.entidades) {
    const k = claveLugar(e.nivel, e.lugar, e.autoridad);
    if (porLugar.get(k) === 1) entidades.set(k, [...(entidades.get(k) ?? []), e]);
  }
  return gobiernos.map((g) => {
    const m = conMef ? mef.get(claveGob(g.nivel, g.ubigeo)) : undefined;
    const ents = entidades.get(claveLugar(g.nivel, g.lugar, g.autoridad)) ?? [];
    return {
      ...g,
      pim: m && m.pim > 0 ? m.pim : null,
      devengado: m && m.pim > 0 ? m.devengado : null,
      entidades: ents,
      proyectos: proyectos.get(claveGob(g.nivel, g.ubigeo)) ?? [],
      // Lo que se busca: el lugar, su provincia y región, su autoridad (electa: pública) y el nombre de sus entidades.
      texto: paraBuscar([g.lugar, g.provincia, g.region, g.autoridad, NIVEL[g.nivel], ...ents.map((e) => e.nombre)].filter(Boolean).join(" ")),
    };
  });
}

function ordenar(lista: Gobierno[], orden: OrdenGob): Gobierno[] {
  const nulosAlFinal = (a: number | null, b: number | null, desc = true) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : desc ? b - a : a - b);
  return [...lista].sort((a, b) => {
    switch (orden) {
      case "nombre": return (a.lugar ?? "").localeCompare(b.lugar ?? "", "es");
      case "presupuesto": return nulosAlFinal(a.pim, b.pim) || b.montoAdjudicadoPen - a.montoAdjudicadoPen;
      case "gastado": return nulosAlFinal(gastadoPct(a.pim, a.devengado), gastadoPct(b.pim, b.devengado), false);
      case "procesos": return b.procesos - a.procesos || b.montoAdjudicadoPen - a.montoAdjudicadoPen;
      case "senales": return b.conSenales - a.conSenales || b.leidos - a.leidos;
      default: return b.montoAdjudicadoPen - a.montoAdjudicadoPen || b.procesos - a.procesos;
    }
  });
}

export async function GobiernosPartido({
  d,
  gasto: gastoP,
  filtros: f,
  ruta,
  anio,
}: {
  d: DetallePartido;
  gasto: Promise<GastoPartido | null>;
  filtros: FiltrosGobiernos;
  ruta: string;
  anio: AnioGobierno;
}) {
  const gasto = await gastoP;
  const conMef = !!gasto?.disponible;
  const todos = unir(d, gasto);
  const q = paraBuscar(f.q);
  const pasa = (g: Gobierno, sin?: "nivel" | "region") =>
    (!q || coincide(g.texto, q)) && (sin === "nivel" || !f.nivel || g.nivel === f.nivel) && (sin === "region" || !f.region || g.ubigeo.slice(0, 2) === f.region);
  const filtrados = ordenar(todos.filter((g) => pasa(g)), f.orden);
  const paginas = Math.max(1, Math.ceil(filtrados.length / TAM));
  const actual = Math.min(f.page, paginas);
  const pagina = filtrados.slice((actual - 1) * TAM, actual * TAM);

  // La URL de la lista (sin página: la borra cada filtro) y la de los contratos de un gobierno.
  const parametros: Parametros = { anio: String(anio), seccion: "gobiernos", [P_GOB.q]: f.q, [P_GOB.nivel]: f.nivel, [P_GOB.region]: f.region, [P_GOB.orden]: f.orden === "adjudicado" ? undefined : f.orden };
  const contratosDe = (g: Gobierno) => `${ruta}?${new URLSearchParams({ anio: String(anio), seccion: "procesos", ubigeo: g.ubigeo })}`;

  // Conteos de cada opción sobre los OTROS filtros (ninguna opción lleva a cero).
  const porNivel = (n: string) => todos.filter((g) => pasa(g, "nivel") && g.nivel === n).length;
  const regiones = new Map<string, { nombre: string; n: number }>();
  for (const g of todos.filter((x) => pasa(x, "region"))) {
    const u = g.ubigeo.slice(0, 2);
    regiones.set(u, { nombre: g.region ?? u, n: (regiones.get(u)?.n ?? 0) + 1 });
  }
  const opcionesNivel: OpcionFaceta[] = NIVELES.filter((n) => todos.some((g) => g.nivel === n.valor)).map((n) => ({ valor: n.valor, etiqueta: n.etiqueta, conteo: porNivel(n.valor) }));

  const columnas: Columna[] = [
    { clave: "gobierno", titulo: "Gobierno", ancho: "minmax(0,1.5fr)" },
    ...(conMef
      ? [{ clave: "presupuesto", titulo: `Presupuesto ${gasto?.mef ?? ""}`.trim(), corto: "Presupuesto", ancho: "128px", alinear: "der", desde: "lg", apilar: "con-rotulo" } satisfies Columna]
      : []),
    { clave: "procesos", titulo: "Contratos", ancho: "92px", alinear: "der", desde: "md", apilar: "con-rotulo" },
    { clave: "adjudicado", titulo: "Adjudicado", ancho: "112px", alinear: "der" },
    { clave: "leidos", titulo: "Leídos por Vigía", corto: "Leídos", ancho: "112px", alinear: "der", desde: "xl", apilar: "con-rotulo" },
    { clave: "senales", titulo: "Con señal", ancho: "92px", alinear: "der", desde: "xl", apilar: "con-rotulo" },
  ];

  const filas: Fila[] = pagina.map((g) => {
    const donde = [g.nivel === "distrital" ? g.provincia : null, g.nivel !== "regional" ? g.region : null].filter(Boolean).join(", ");
    const pct = gastadoPct(g.pim, g.devengado);
    return {
      id: `${g.nivel}-${g.ubigeo}`,
      celdas: {
        gobierno: (
          <CeldaPrincipal
            titulo={g.lugar ?? g.ubigeo}
            meta={[
              <Dato key="n" tipo="tipo">{NIVEL[g.nivel]}</Dato>,
              donde && <Dato key="l" tipo="lugar">{donde}</Dato>,
              // Autoridad electa: se muestra completa (docs/PRIVACIDAD.md).
              g.autoridad && <Dato key="a" tipo="cargo" nombre="Autoridad">{g.autoridad}</Dato>,
            ]}
          />
        ),
        presupuesto: g.pim != null ? <CeldaNumero sub={pct != null ? `${porcentaje(pct)} gastado` : undefined}>{solesCompacto(g.pim)}</CeldaNumero> : undefined,
        procesos: <CeldaNumero>{g.procesos > 0 ? numero(g.procesos) : <span className="font-sans text-mute">Ninguno</span>}</CeldaNumero>,
        adjudicado: <CeldaNumero>{g.montoAdjudicadoPen > 0 ? solesCompacto(g.montoAdjudicadoPen) : <span className="font-sans text-mute">Nada</span>}</CeldaNumero>,
        leidos: g.contratos > 0 ? <CeldaNumero sub={`de ${numero(g.contratos)}`}>{numero(g.leidos)}</CeldaNumero> : <span className="text-meta text-mute">Sin convocatorias en la base</span>,
        // Con señal sólo dice algo si se leyó alguno: «0» sin nada leído se leía «limpio».
        senales: g.leidos > 0 ? <CeldaNumero>{numero(g.conSenales)}</CeldaNumero> : <span className="text-meta text-mute">Sin leer</span>,
      },
      detalle: {
        titulo: g.lugar ?? g.ubigeo,
        etiqueta: `Ver ${NIVEL[g.nivel].toLowerCase()} de ${g.lugar ?? g.ubigeo}`,
        descripcion: [NIVEL[g.nivel], donde].filter(Boolean).join(", "),
        contenido: <PanelGobierno g={g} conMef={conMef} mef={gasto?.mef ?? null} contratos={contratosDe(g)} />,
        pie: (
          <PieDetalle
            principal={g.ruc ? <EnlaceAccion href={`/entidad/${g.ruc}`} flecha>{g.nivel === "regional" ? "Abrir la ficha del gobierno regional" : "Abrir la ficha de la municipalidad"}</EnlaceAccion> : undefined}
            secundarias={g.procesos > 0 ? <EnlaceAccion href={contratosDe(g)} variante="secundario">Ver sus {numero(g.procesos)} contratos</EnlaceAccion> : undefined}
          />
        ),
      },
    };
  });

  const tabla = (
    <Listado ruta={ruta} parametros={parametros} paramPagina={P_GOB.page}>
      <BarraFiltros
        busqueda={{ param: P_GOB.q, placeholder: "Buscar un lugar, una autoridad o una entidad…", etiqueta: "Buscar en sus gobiernos", min: 2 }}
        faceta={{ param: P_GOB.nivel, etiqueta: "Nivel", todas: "Todos", conteoTodas: todos.filter((g) => pasa(g, "nivel")).length, opciones: opcionesNivel, nombreEnChip: false }}
        visibles={
          regiones.size > 1 || f.region
            ? [{
                param: P_GOB.region,
                etiqueta: "Región",
                corta: "Región",
                todas: "Todas",
                desplegable: true,
                opciones: [...regiones.entries()].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, "es")).map(([u, r]) => ({ valor: u, etiqueta: r.nombre, conteo: r.n })),
              }]
            : []
        }
        orden={{ param: P_GOB.orden, porDefecto: "adjudicado", opciones: ORDENES.filter((o) => conMef || (o.valor !== "presupuesto" && o.valor !== "gastado")).map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
      />
      <ZonaResultados className="space-y-3">
        {filas.length === 0 ? (
          <EstadoVacio compacto titulo="Ningún gobierno coincide">Prueba con otro lugar o quita el nivel o la región.</EstadoVacio>
        ) : (
          <>
            <div className="flex justify-end">
              <Paginacion actual={actual} paginas={paginas} total={filtrados.length} tam={TAM} navegacion="url" cargando={false} nombre="gobiernos" hrefBase={ruta} query={parametros} paramPagina={P_GOB.page} />
            </div>
            <Tabla columnas={columnas} filas={filas} etiqueta={`Gobiernos de ${d.partido.nombre}, ${periodoTexto(anio)}`} />
            <div className="flex justify-end">
              <Paginacion actual={actual} paginas={paginas} total={filtrados.length} tam={TAM} navegacion="url" cargando={false} nombre="gobiernos" hrefBase={ruta} query={parametros} paramPagina={P_GOB.page} subir />
            </div>
          </>
        )}
        <p className="text-rotulo text-mute">
          Fuente: <EnlaceFuente href={INFOGOB_JNE}>JNE</EnlaceFuente> (quién ganó), OECE (contratos: <EnlaceFuente href={CONOSCE_BUSCADOR}>CONOSCE</EnlaceFuente> desde
          2018, <EnlaceFuente href={CONTRATACIONES_ABIERTAS}>Contrataciones Abiertas</EnlaceFuente> antes)
          {conMef && <>, <EnlaceFuente href={CONSULTA_AMIGABLE}>MEF {gasto?.mef}</EnlaceFuente> (presupuesto)</>} y la base de Vigía (lo leído).
        </p>
      </ZonaResultados>
    </Listado>
  );

  // Sin el detalle del MEF de este mandato, la tabla sola; con él, «En qué gastan» al lado (las tablas que antes iban en
  // el Inicio: proyectos y el reparto por función, tipo de gasto y nivel).
  if (!conMef || !gasto) return tabla;
  return (
    <Pestanas
      variante="segunda"
      param={P_GOB.vista}
      etiqueta="Vistas de sus gobiernos"
      activa={f.vista}
      pestanas={[
        { clave: "lista", etiqueta: "Cada gobierno", conteo: todos.length, contenido: tabla },
        { clave: "gasto", etiqueta: "En qué gastan", titulo: `En qué gastan sus gobiernos (MEF ${gasto.mef})`, contenido: <GastoDetalle gasto={gasto} /> },
      ]}
    />
  );
}

/** El panel de un gobierno (§14.4): sus cifras, sus entidades en la base de Vigía y sus proyectos con más presupuesto. */
function PanelGobierno({ g, conMef, mef, contratos }: { g: Gobierno; conMef: boolean; mef: number | null; contratos: string }) {
  const enlace = "font-medium text-granate underline-offset-2 hover:underline";
  const pct = gastadoPct(g.pim, g.devengado);
  const datos: DatoClave[] = [
    ...(g.autoridad ? [{ etiqueta: g.nivel === "regional" ? "Gobernador o gobernadora" : "Alcalde o alcaldesa", valor: g.autoridad }] : []),
    ...(conMef
      ? [{ etiqueta: `Presupuesto ${mef ?? ""}`.trim(), valor: g.pim != null ? `${solesCompacto(g.pim)}${pct != null ? `, ${porcentaje(pct)} gastado` : ""}` : "Sin dato del MEF para este gobierno" }]
      : []),
    {
      etiqueta: "Contratos adjudicados",
      valor: g.procesos > 0 ? <Link href={contratos} className={enlace}>{plural(g.procesos, "contrato", "contratos")} por {solesCompacto(g.montoAdjudicadoPen)}</Link> : "Ninguno en el período",
    },
    {
      etiqueta: "En la base de Vigía",
      valor: g.contratos > 0 ? `${plural(g.contratos, "convocatoria", "convocatorias")}, ${numero(g.leidos)} ${g.leidos === 1 ? "leída" : "leídas"}${g.leidos > 0 ? `, ${numero(g.conSenales)} con señal` : ""}` : "Ninguna convocatoria en este período",
    },
  ];
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <span className="pill border-line bg-paperSoft text-inkSoft">{NIVEL[g.nivel]}</span>
      </ChipsDetalle>
      <DatosClave items={datos} />
      <BloqueDetalle titulo="Sus entidades en la base de Vigía">
        {g.entidades.length ? (
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {g.entidades.map((e) => (
              <li key={e.ruc}>
                <Link href={`/entidad/${e.ruc}`} className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2 transition-colors duration-rapido hover:bg-granate-50">
                  <span className="min-w-0">
                    <span className="block text-dato leading-snug text-ink">{tituloNatural(e.nombre)}</span>
                    <span className="block text-rotulo text-mute">
                      {plural(e.contratos, "convocatoria", "convocatorias")}, {numero(e.leidos)} {e.leidos === 1 ? "leída" : "leídas"}
                      {e.leidos > 0 ? `, ${numero(e.conSenales)} con señal` : ""}
                    </span>
                  </span>
                  <ChevronRight size={14} aria-hidden className="shrink-0 text-mute" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-inkSoft">
            {g.contratos > 0
              ? "Sus convocatorias en la base de Vigía están en la lista de sus contratos."
              : "Ninguna de sus entidades tiene convocatorias en la base de Vigía en este período."}
          </p>
        )}
      </BloqueDetalle>
      {g.proyectos.length > 0 && (
        <BloqueDetalle titulo="Sus proyectos con más presupuesto">
          <ul className="space-y-2">
            {g.proyectos.map((p) => (
              <li key={p.codigo} className="flex items-baseline justify-between gap-3 text-meta">
                <span className="min-w-0 text-ink">
                  {tituloNatural(p.nombre)}{" "}
                  <EnlaceFuente href={inversionSsi(p.codigo)} className="font-mono text-rotulo">
                    CUI {p.codigo}
                  </EnlaceFuente>
                </span>
                <span className="shrink-0 text-right font-mono tabular-nums text-ink">
                  {solesCompacto(p.pim)}
                  <span className="block font-sans text-rotulo text-mute">{porcentaje(gastadoPct(p.pim, p.devengado) ?? 0)} gastado</span>
                </span>
              </li>
            ))}
          </ul>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}
