import { Suspense } from "react";
import { Ayuda, EncabezadoPagina, EstadoError, EstadoVacio, Pagina } from "@/components/patrones";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Indicadores,
  IndicadoresSkeleton,
  Listado,
  Tabla,
  TablaSkeleton,
  ZonaResultados,
  type Columna,
  type FiltroSecundario,
  type Fila,
  type Indicador,
  type OpcionFaceta,
} from "@/components/listado";
import { TiposCruce } from "@/components/cruces/TiposCruce";
import { Badge } from "@/components/ui/Badge";
import { Separador } from "@/components/ui/Partes";
import { Paginacion } from "@/components/ui/Paginacion";
import { limpiarObjeto } from "@/components/contratos/recortar";
import { CONTRATACION, ORDENES_CRUCE, TAM_CRUCES, TIPO_CRUCE, getCruces, parseCrucesQuery, type CrucesPagina } from "@/lib/cruces";
import { numero, soles, solesCompacto } from "@/lib/formato";

export const metadata = {
  title: "Cruces de datos",
  description:
    "Ganadores de contratos públicos que aparecen en otros registros oficiales: aportes y gastos de campaña, candidaturas, sanciones, penalidades, visitas, socios comunes y órdenes fraccionadas.",
};

const RUTA = "/app/cruces";

/**
 * /app/cruces — plantilla Listado (DESIGN_SYSTEM.md §14.1). Los cruces del ganador con otras fuentes (ONPE, JNE,
 * OSCE, visitas, CONOSCE) antes sólo se veían dentro de la ficha de cada contrato o en la pestaña de la entidad;
 * acá están todos, por proceso y ganador, con el tipo de cruce a la vista (TiposCruce) y lo demás en la barra.
 * Cada fila abre la ficha del contrato en su sección de cruces, donde está cada dato con su fuente.
 */
export default async function CrucesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = parseCrucesQuery(searchParams);
  if (searchParams?.todos === "1") query.todos = "1";
  const datos = getCruces(query);
  const parametros = { ...query, pagina: undefined };

  return (
    <Pagina className="space-y-5">
      <EncabezadoPagina
        titulo="Cruces de datos"
        bajada="Ganadores de contratos públicos que aparecen en otros registros oficiales. Sin IA: cada dato sale de su fuente."
        ayuda={
          <Ayuda titulo="¿Qué es un cruce?">
            Vigía compara, por RUC y DNI, a cada ganador (y a sus socios y representantes del RNP) con los registros de la ONPE, el JNE, el
            Tribunal de Contrataciones, las visitas a entidades y CONOSCE. Un cruce es un dato verificable, no una acusación: abre el contrato
            para ver cada uno con su fuente.
          </Ayuda>
        }
      />

      <Suspense fallback={<IndicadoresSkeleton n={4} />}>
        <Cifras datos={datos} parametros={parametros} />
      </Suspense>

      <Listado ruta={RUTA} parametros={parametros}>
        <Suspense fallback={<TiposCruce conteos={null} />}>
          <Tipos datos={datos} />
        </Suspense>
        <Suspense fallback={<Barra datos={null} />}>
          <BarraConConteos datos={datos} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<TablaSkeleton columnas={COLUMNAS} />}>
            <Resultados datos={datos} parametros={parametros} pagina={Math.max(1, Number(query.pagina) || 1)} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </Pagina>
  );
}

// ─── Piezas que esperan la consulta ──────────────────────────────────────────

async function Cifras({ datos, parametros }: { datos: Promise<CrucesPagina | null>; parametros: Record<string, string | undefined> }) {
  const d = await datos;
  const r = d?.resumen;
  if (!r) return <p className="text-[13px] text-mute" role="status">No pudimos contar los cruces en este momento.</p>;
  const items: Indicador[] = [
    { valor: numero(r.total), etiqueta: "ganadores con cruces", contexto: `en ${numero(r.procesos)} procesos` },
    {
      valor: numero(r.altas),
      etiqueta: "con un cruce grave",
      tono: "alta",
      contexto: "partido que gobierna, socio común, visita previa, ganó inhabilitado",
      href: hrefCon(parametros, { severidad: "alta" }),
    },
    { valor: numero(r.entidades), etiqueta: "entidades", contexto: `${numero(r.proveedores)} proveedores distintos` },
    { valor: solesCompacto(r.monto), etiqueta: "adjudicado a estos ganadores", contexto: "suma de las buenas pro" },
  ];
  return <Indicadores items={items} />;
}

async function Tipos({ datos }: { datos: Promise<CrucesPagina | null> }) {
  const d = await datos;
  const conteos = d?.facetas ? Object.fromEntries(d.facetas.tipos.map((t) => [t.valor, t.n])) : null;
  return <TiposCruce conteos={conteos} />;
}

async function BarraConConteos({ datos }: { datos: Promise<CrucesPagina | null> }) {
  return <Barra datos={await datos} />;
}

function Barra({ datos }: { datos: CrucesPagina | null }) {
  const f = datos?.facetas ?? null;
  const faceta = {
    param: "severidad",
    etiqueta: "Gravedad",
    todas: "Todos",
    nombreEnChip: false,
    conteoTodas: f ? f.severidad.baja : null,
    opciones: [
      { valor: "alta", etiqueta: "Con un cruce grave", conteo: f ? f.severidad.alta : null, icono: "alerta", tono: "alta" },
      { valor: "media", etiqueta: "Medio o más", conteo: f ? f.severidad.media : null, icono: "atencion", tono: "media" },
    ] satisfies OpcionFaceta[],
  };
  const filtros: FiltroSecundario[] = [
    {
      param: "departamento",
      etiqueta: "Departamento",
      todas: "Todo el Perú",
      opciones: (f?.departamentos ?? [])
        .map((x) => ({ valor: x.valor, etiqueta: x.nombre ?? `Ubigeo ${x.valor}`, conteo: x.n }))
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es")),
    },
    {
      param: "contratacion",
      etiqueta: "Tipo de contratación",
      todas: "Todo tipo",
      opciones: (f?.contratacion ?? []).map((x) => ({ valor: x.valor, etiqueta: CONTRATACION[x.valor] ?? x.valor, conteo: x.n })),
    },
    {
      param: "desde",
      etiqueta: "Buena pro desde",
      todas: "Cualquier fecha",
      opciones: ultimosMeses(12).map((m) => ({ valor: m.valor, etiqueta: m.etiqueta })),
    },
    {
      param: "montoMin",
      etiqueta: "Monto adjudicado desde",
      todas: "Sin mínimo",
      opciones: [50_000, 100_000, 500_000, 1_000_000, 5_000_000].map((m) => ({ valor: String(m), etiqueta: soles(m) })),
    },
  ];
  return (
    <BarraFiltros
      busqueda={{ param: "q", placeholder: "Buscar empresa, entidad, objeto o código…", etiqueta: "Buscar en los cruces", min: 3 }}
      faceta={faceta}
      filtros={filtros}
      orden={{ param: "orden", porDefecto: "puntaje", opciones: ORDENES_CRUCE }}
    />
  );
}

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;

const COLUMNAS: Columna[] = [
  { clave: "caso", titulo: "Proceso y ganador", ancho: "minmax(0,1fr)" },
  { clave: "cruces", titulo: "Qué se cruzó", ancho: "minmax(0,1.1fr)", desde: "md", apilar: true },
  { clave: "adjudicado", titulo: "Adjudicado", ancho: "130px", alinear: "der", desde: "lg" },
  { clave: "buenaPro", titulo: "Buena pro", ancho: "96px", desde: "lg" },
];

async function Resultados({ datos, parametros, pagina }: { datos: Promise<CrucesPagina | null>; parametros: Record<string, string | undefined>; pagina: number }) {
  const d = await datos;
  if (!d) return <EstadoError titulo="No pudimos traer los cruces">Vuelve a intentarlo en unos minutos.</EstadoError>;
  if (!d.casos.length) {
    return (
      <EstadoVacio titulo="Ningún caso con estos filtros">
        Prueba quitando un filtro o eligiendo otro tipo de cruce.
      </EstadoVacio>
    );
  }
  const filas: Fila[] = d.casos.map((k) => ({
    id: `${k.ocid}-${k.rucProveedor}`,
    // La ficha del contrato en su sección de cruces: ahí está cada dato con su fuente.
    href: `/app/contratos/${encodeURIComponent(k.ocid)}#cruces-proveedor`,
    celdas: {
      caso: (
        <CeldaPrincipal
          titulo={k.objeto ? limpiarObjeto(k.objeto) : "Proceso sin objeto registrado"}
          meta={
            <>
              <span className="font-medium text-ink">
                {k.proveedor ?? "Ganador sin nombre"}
                {k.consorcio ? ` (en ${k.consorcio})` : ""}
              </span>
              <Separador />
              <span>{k.entidad ?? `RUC ${k.entidadRuc}`}</span>
              {k.codigo && (
                <>
                  <Separador />
                  <span className="font-mono" translate="no">{k.codigo}</span>
                </>
              )}
            </>
          }
        />
      ),
      cruces: (
        <ul className="flex flex-wrap gap-1.5" aria-label="Registros donde aparece">
          {k.cruces.map((c) => (
            <li key={c.tipo} title={TIPO_CRUCE[c.tipo]?.explica}>
              <Badge variant={VARIANTE[c.severidad]}>{TIPO_CRUCE[c.tipo]?.corto ?? c.etiqueta}</Badge>
            </li>
          ))}
        </ul>
      ),
      adjudicado: k.montoSoles != null ? <CeldaNumero>{soles(k.montoSoles)}</CeldaNumero> : undefined,
      buenaPro: <CeldaFecha fecha={k.fechaBuenaPro} />,
    },
  }));
  return (
    <div className="space-y-3">
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Ganadores que aparecen en otros registros públicos" />
      <Paginacion
        actual={pagina}
        paginas={Math.max(1, Math.ceil(d.total / TAM_CRUCES))}
        total={d.total}
        tam={TAM_CRUCES}
        navegacion="url"
        hrefBase={RUTA}
        query={parametros}
        cargando={false}
        nombre="casos"
      />
    </div>
  );
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

function hrefCon(parametros: Record<string, string | undefined>, cambio: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...parametros, ...cambio })) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${RUTA}?${qs}` : RUTA;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Primer día de cada uno de los últimos `n` meses ("Desde octubre de 2026"). */
function ultimosMeses(n: number): { valor: string; etiqueta: string }[] {
  const hoy = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    return { valor: d.toISOString().slice(0, 10), etiqueta: `Desde ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}` };
  });
}
