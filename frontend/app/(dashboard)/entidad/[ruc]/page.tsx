import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Building2, Flag, MapPin } from "lucide-react";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { esAlertaReal } from "@/lib/semillas";
import { ETIQUETA_PESO, nivelDeScore } from "@/lib/severidad";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { EjecucionPresupuestal, EjecucionPresupuestalSkeleton } from "@/components/EjecucionPresupuestal";
import { getEntidad } from "@/lib/api-client";
import { SeguirEntidadBoton } from "@/components/mapa/SeguirEntidadBoton";
import { CabeceraPestana, Ayuda, EncabezadoPagina, EstadoError, Pagina, Pestanas, Volver } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Separador } from "@/components/ui/Partes";
import { Severidad } from "@/components/ui/Severidad";

/**
 * /entidad/[ruc] — la plantilla Ficha (DESIGN_SYSTEM.md §14.2):
 *   volver → identidad (nombre; tipo, RUC y zona en una línea; acciones) → Indicadores
 *   (con dictamen, con señales, adjudicado, en cola) → pestañas (§14.3): sus contratos con
 *   dictamen en la `Tabla` del kit (la misma fila que el listado de contratos: chip · objeto ·
 *   monto · fecha · ›) | la ejecución presupuestal del MEF, con sus cifras como Indicadores.
 *   El MEF antes iba plegado al pie: ahora es una pestaña, a un clic y sin bajar.
 *
 * Antes las cuatro cifras iban en una frase gris y el peso del riesgo en una fila de chips
 * con conteo encima de una <table> propia; ahora cada cifra tiene su número, su nombre y su
 * contexto, y la tabla es la de todos los listados.
 */

/** Lo que devuelve `GET /entidades/:ruc` en `alertas[]` (snake_case, máximo 20, por score). */
interface AlertaEntidad {
  id: string;
  codigo?: string | null;
  codigo_convocatoria?: string | null;
  score?: number | string | null;
  fecha_buena_pro?: string | null;
  monto_adjudicado?: number | string | null;
  estado?: string | null;
  objeto?: string | null;
}

/** Departamentos por los dos primeros dígitos del ubigeo INEI. */
const DEPARTAMENTO: Record<string, string> = {
  "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa", "05": "Ayacucho",
  "06": "Cajamarca", "07": "Callao", "08": "Cusco", "09": "Huancavelica", "10": "Huánuco",
  "11": "Ica", "12": "Junín", "13": "La Libertad", "14": "Lambayeque", "15": "Lima",
  "16": "Loreto", "17": "Madre de Dios", "18": "Moquegua", "19": "Pasco", "20": "Piura",
  "21": "Puno", "22": "San Martín", "23": "Tacna", "24": "Tumbes", "25": "Ucayali",
};

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * ¿El ubigeo que trae la entidad cae en su misma región? El ubigeo de la ficha
 * sale de un cruce automático y a veces apunta a otro departamento; ofrecer
 * "Financiar la auditoría de X" sobre una zona equivocada manda el aporte de un
 * vecino a otro lugar. Sin región declarada no hay contra qué comparar.
 */
function ubigeoCoincide(ubigeo: string | null, region: string | null): boolean {
  if (!ubigeo) return false;
  const dep = DEPARTAMENTO[ubigeo.slice(0, 2)];
  if (!dep) return false;
  if (!region) return true;
  const r = normal(region);
  const d = normal(dep);
  return r === d || r.startsWith(d) || d.startsWith(r);
}

/** DATE/TIMESTAMP a medianoche UTC → sólo el día (AAAA-MM-DD), que `fechaCorta` toma como día de Lima. */
const diaDe = (v: string | null | undefined): string | null => {
  const ymd = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
};


/** La fila de un contrato, como en el listado de contratos: peso del riesgo (chip) · objeto · monto · fecha · ›. */
const COLUMNAS: Columna[] = [
  {
    clave: "peso",
    titulo: ETIQUETA_PESO,
    ancho: "140px",
    ayuda: (
      <Ayuda titulo="¿Qué es el peso del riesgo?">
        Cómo pesan las señales de cada contrato. Sale de su puntaje; no es una probabilidad de delito.
      </Ayuda>
    ),
  },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "adjudicado", titulo: "Adjudicado", ancho: "140px", alinear: "der", desde: "md" },
  { clave: "buenaPro", titulo: "Buena pro", ancho: "96px", desde: "md" },
];

export async function generateMetadata({ params }: { params: { ruc: string } }): Promise<Metadata> {
  const r = await getEntidad(params.ruc).catch(() => null);
  const nombre = r?.entidad?.nombre as string | undefined;
  return { title: nombre ?? `Entidad ${params.ruc}` };
}

export default async function EntidadProfile({
  params,
  searchParams,
}: {
  params: { ruc: string };
  /** `?seccion=presupuesto` abre la pestaña del MEF. */
  searchParams?: { seccion?: string | string[] };
}) {
  // Antes, si el API fallaba o no conocía el RUC, la ficha se armaba con
  // lib/mock-entities y ALERTAS_MOCK: una entidad inventada con alertas
  // inventadas. Ahora: sin respuesta, se dice; RUC desconocido, 404.
  let apiResp: Awaited<ReturnType<typeof getEntidad>> = null;
  let fallo = false;
  try {
    apiResp = await getEntidad(params.ruc);
  } catch (e) {
    console.error("[entidad] el API no respondió:", (e as Error).message);
    fallo = true;
  }
  if (fallo) return <NoSePudoLeer ruc={params.ruc} />;
  if (!apiResp?.entidad) notFound();

  const e = apiResp.entidad;
  const nombre: string = e.nombre;
  const region: string | null = e.region || null;
  const ubigeo: string | null = e.ubigeo || null;
  const zonaNombre: string | null = e.zonaNombre || null;
  const enCola = Number(e.contratosEnCola || 0);
  const contratos = Number(e.contratos || 0);

  // Sólo las alertas PUBLICADAS y reales: el endpoint también devuelve las que
  // quedaron en revisión humana (no publicadas) y las de demo `ALT-…`.
  const crudas = (apiResp.alertas ?? []) as AlertaEntidad[];
  const publicadas = crudas.filter((a) => esAlertaReal({ codigo: a.codigo }) && (a.estado ?? "activa") === "activa");
  const truncada = crudas.length >= 20; // el backend corta en 20, ordenadas por score de mayor a menor
  const demo = crudas.filter((a) => !esAlertaReal({ codigo: a.codigo }) && (a.estado ?? "activa") === "activa");
  const nAlertas = truncada ? Math.max(0, Number(e.alertas || 0) - demo.length) : publicadas.length;
  const monto = truncada
    ? Math.max(0, Number(e.monto || 0) - demo.reduce((s, a) => s + Number(a.monto_adjudicado || 0), 0))
    : publicadas.reduce((s, a) => s + Number(a.monto_adjudicado || 0), 0);
  const financiable = enCola > 0 && ubigeoCoincide(ubigeo, region);
  const zonaFinanciar = ubigeo ? zonaNombre ?? DEPARTAMENTO[ubigeo.slice(0, 2)] : null;

  // "Con señales" = contratos con al menos una señal publicada (DESIGN_SYSTEM.md §10.1).
  // El score es la suma de los pesos de las señales (todo peso ≥ 5), así que score > 0 ⇔ hay señales.
  // Con la lista cortada en 20 (por score, de mayor a menor): si la última listada ya tiene
  // score 0, las que no vinieron tampoco tienen señales y el conteo es exacto; si no, es un piso.
  const scores = publicadas.map((a) => Number(a.score) || 0);
  const ultimo = scores.length > 0 ? scores[scores.length - 1] : null;
  const conSenales = scores.filter((x) => x > 0).length;
  const conSenalesEsPiso = truncada && ultimo != null && ultimo > 0;
  // Los de riesgo alto, con el mismo criterio: exactos si la última listada ya no es alta.
  const altos = scores.filter((x) => nivelDeScore(x) === "alta").length;
  const altosExacto = !truncada || (ultimo != null && nivelDeScore(ultimo) !== "alta");

  const indicadores: Indicador[] = [
    {
      valor: numero(nAlertas),
      etiqueta: "con dictamen publicado",
      contexto: `de ${plural(contratos, "contrato registrado", "contratos registrados")}`,
      ayuda: (
        <Ayuda titulo="¿Qué cuenta esta cifra?">
          Contratos de esta entidad en el SEACE que Vigía leyó y publicó, con o sin señales.
        </Ayuda>
      ),
    },
    {
      valor: nAlertas === 0 ? null : numero(conSenales),
      etiqueta: "con señales",
      contexto:
        nAlertas === 0
          ? undefined
          : `${conSenalesEsPiso ? "como mínimo, " : ""}de ${numero(nAlertas)} con dictamen${altos > 0 && altosExacto ? `, ${numero(altos)} de riesgo alto` : ""}`,
      ayuda: (
        <Ayuda titulo="¿Qué es un contrato con señales?">
          Uno con al menos una señal publicada, de cualquier peso.
          {conSenalesEsPiso && ` Se cuentan los ${numero(publicadas.length)} de mayor puntaje: el total puede ser mayor.`}
        </Ayuda>
      ),
    },
    {
      valor: nAlertas === 0 ? null : solesCompacto(monto),
      etiqueta: "adjudicado",
      contexto: nAlertas === 0 ? undefined : "en sus contratos con dictamen",
    },
    {
      valor: numero(enCola),
      etiqueta: "en cola",
      contexto: enCola > 0 && !financiable ? "no se puede financiar desde aquí" : `de ${numero(contratos)} registrados`,
      ayuda: (
        <Ayuda titulo="¿Qué está en cola?">
          <span className="block">Convocatorias que Vigía todavía no leyó y esperan financiamiento.</span>
          {financiable && (
            <span className="mt-2 block">Se leen por antigüedad dentro de la zona: no se puede elegir una entidad concreta.</span>
          )}
          {enCola > 0 && !financiable && (
            <span className="mt-2 block">
              Todavía no sabemos a qué zona pertenece esta entidad. La lectura se financia por zona, y un aporte sobre una
              zona equivocada iría a otro lugar.
            </span>
          )}
        </Ayuda>
      ),
    },
  ];

  const filas: Fila[] = publicadas.map((a) => {
    const codigo = String(a.codigo_convocatoria ?? a.codigo ?? "").replace(/^OECE-/, "");
    const adjudicado = a.monto_adjudicado != null ? soles(Number(a.monto_adjudicado)) : null;
    return {
      id: a.id,
      href: codigo ? `/app/convocatoria/${encodeURIComponent(codigo)}` : undefined,
      celdas: {
        peso: <Severidad score={Number(a.score) || 0} formato="pastilla" />,
        contrato: (
          <CeldaPrincipal
            titulo={a.objeto || "Contrato sin objeto registrado"}
            meta={
              <>
                <span className="font-mono" translate="no">
                  {codigo || "Sin código"}
                </span>
                {/* En el celular la columna del monto no entra: va en la meta. */}
                {adjudicado && (
                  <span className="md:hidden">
                    <Separador />
                    {adjudicado}
                  </span>
                )}
              </>
            }
          />
        ),
        adjudicado: adjudicado ? <CeldaNumero>{adjudicado}</CeldaNumero> : undefined,
        buenaPro: <CeldaFecha fecha={diaDe(a.fecha_buena_pro)} />,
      },
    };
  });

  return (
    <Pagina>
      <Volver href="/app/entidades">Entidades</Volver>

      {/* 1. Identidad: nombre; tipo, RUC y zona en una línea; lo que se puede hacer con ella. */}
      <EncabezadoPagina
        titulo={nombre}
        bajada={
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> {etiquetaTipoEntidad(e.tipo ?? null, nombre)}
            </span>
            <span>
              RUC{" "}
              <span className="font-mono text-ink" translate="no">
                {e.ruc}
              </span>
            </span>
            {region && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} className="shrink-0 text-mute" aria-hidden /> {[region, e.provincia, e.distrito].filter(Boolean).join(", ")}
              </span>
            )}
          </span>
        }
        acciones={
          <>
            <SeguirEntidadBoton ruc={e.ruc} nombre={nombre} />
            <EnlaceAccion href={`/reporte/nuevo?modo=entidad&ruc=${e.ruc}`} variante="secundario">
              <Flag size={14} aria-hidden /> Denunciar a esta entidad
            </EnlaceAccion>
            {/* La única acción sobre su cola: financiar la zona. Por qué no hay botón, en el ⓘ de "en cola". */}
            {financiable && ubigeo && (
              <EnlaceAccion href={`/app/financiar/${ubigeo}`} flecha>
                Financiar la lectura de {zonaFinanciar}
              </EnlaceAccion>
            )}
          </>
        }
      />

      {/* 2. Lo que Vigía sabe de ella, cifra por cifra. */}
      <Indicadores items={indicadores} />

      {/* 3. Sus contratos con dictamen | el presupuesto del MEF, cada uno en su pestaña. */}
      <Pestanas
        etiqueta="Secciones de la entidad"
        activa={typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined}
        pestanas={[
          {
            clave: "contratos",
            etiqueta: "Contratos con dictamen",
            conteo: nAlertas,
            contenido: (
              <>
                {/* La bajada de la pestaña (una línea + ⓘ) y su acción: el h2 de antes ya lo dice la pestaña. */}
                {(publicadas.length > 0 || contratos > 0) && (
                  <CabeceraPestana
                    ayuda={
                      publicadas.length > 0 ? (
                        <Ayuda titulo="¿Qué abre cada contrato?">
                          Su dictamen, con las señales y la norma que las respalda. Se listan los leídos y publicados, con o
                          sin señales.
                        </Ayuda>
                      ) : undefined
                    }
                    acciones={
                      contratos > 0 ? (
                        <EnlaceAccion href={`/app/contratos?entidad=${e.ruc}`} variante="secundario" flecha>
                          Ver sus {plural(contratos, "contrato", "contratos")}
                        </EnlaceAccion>
                      ) : undefined
                    }
                  >
                    {publicadas.length > 0 &&
                      (truncada
                        ? `Los ${numero(publicadas.length)} de mayor puntaje, de ${numero(nAlertas)} con dictamen publicado.`
                        : "Del mayor peso del riesgo al menor; cada uno abre su dictamen.")}
                  </CabeceraPestana>
                )}
                <DisclaimerBanner className="mb-3" />
                {publicadas.length === 0 ? (
                  // Sin llamita: esta pestaña habla de una entidad, y la llamita no acompaña a nadie señalado.
                  <p className="rounded-2xl border border-dashed border-line bg-paperSoft px-4 py-5 text-sm text-mute">
                    Todavía no hay contratos de esta entidad con dictamen publicado. Aparecen aquí cuando Vigía lee uno.
                  </p>
                ) : (
                  <Tabla columnas={COLUMNAS} filas={filas} etiqueta={`Contratos de ${nombre} con dictamen publicado`} />
                )}
              </>
            ),
          },
          {
            // Sin conteo: los años del MEF se saben recién cuando responde (puede tardar más de 20 s).
            clave: "presupuesto",
            etiqueta: "Presupuesto MEF",
            contenido: (
              <>
                <p className="mb-3 text-sm text-inkSoft">Gasto real frente al presupuesto asignado, según el MEF.</p>
                {/* El MEF llega por streaming: la pestaña muestra su esqueleto hasta que responde. */}
                <Suspense fallback={<EjecucionPresupuestalSkeleton />}>
                  <EjecucionPresupuestal query={mefSearchKeywordFor(nombre)} ruc={e.ruc} />
                </Suspense>
              </>
            ),
          },
        ]}
      />
    </Pagina>
  );
}

function NoSePudoLeer({ ruc }: { ruc: string }) {
  return (
    <Pagina>
      <Volver href="/app/entidades">Entidades</Volver>
      <EncabezadoPagina titulo={`Entidad con RUC ${ruc}`} />
      <EstadoError
        titulo="No pudimos leer la ficha de esta entidad"
        accion={<EnlaceAccion href={`/entidad/${encodeURIComponent(ruc)}`}>Reintentar</EnlaceAccion>}
      >
        El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
      </EstadoError>
    </Pagina>
  );
}

/** Convierte el nombre de la entidad en un keyword que MEF entiende. */
function mefSearchKeywordFor(nombre: string): string {
  if (!nombre) return "";
  const n = nombre.toUpperCase();
  // Gobiernos regionales: "Gob. Reg. de Cusco" → "REGIONAL DEL DEPARTAMENTO DE CUSCO"
  if (n.includes("GOBIERNO REGIONAL") || n.includes("GOB. REG")) {
    const m = nombre.match(/de ([A-Za-záéíóúñÁÉÍÓÚÑ ]+)$/);
    if (m) return `REGIONAL DEL DEPARTAMENTO DE ${m[1].trim().toUpperCase()}`;
  }
  // Municipalidades distritales/provinciales: usar el distrito/provincia clave
  if (n.includes("MUNICIPALIDAD") || n.includes("MUN.")) {
    const m = nombre.match(/de ([A-Za-záéíóúñÁÉÍÓÚÑ]+)\s*$/);
    if (m)
      return `MUNICIPALIDAD ${n.includes("DISTRITAL") || n.includes("DIST") ? "DISTRITAL" : n.includes("PROVINCIAL") || n.includes("PROV") ? "PROVINCIAL" : ""} DE ${m[1].trim().toUpperCase()}`
        .replace(/\s+/g, " ")
        .trim();
  }
  // Ministerios: dejar tal cual en mayúsculas
  return n;
}
