import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ayuda, CabeceraPestana, DatosClave, EncabezadoPagina, EstadoVacio, FichaNoLeida, Migas, Pagina, Pestanas } from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { CeldaNumero, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { LineaMeses } from "@/components/charts/LineaMeses";
import { SenalesPlanillaLista } from "@/components/personas/SenalesPlanilla";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { motivoDudoso } from "@/lib/datoDudoso";
import { numero, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { REGIMEN, getFichaPlanilla, rutaPlanilla, type FichaPlanilla } from "@/lib/planilla";
import { uno } from "@/lib/utils";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { codigo: string } }): Promise<Metadata> {
  const f = await getFichaPlanilla(params.codigo);
  return { title: f?.persona.nombre ? `${f.persona.nombre}, en planilla` : "Persona en planilla", robots: { index: false } };
}


/**
 * /app/personas/planilla/[codigo] — una persona de la planilla de una entidad (Portal de Transparencia), con la misma
 * información que la ficha de quien recibe órdenes (pedido del usuario, 2026-10-22). Código al azar (migración 107):
 * nunca el nombre, que lleva el materno tapado. Pestañas (?seccion=):
 *   · Señales: cada una numerada, con su detalle y su fuente.
 *   · Sueldo mes a mes: la línea de tiempo y la tabla de cada mes cargado.
 *   · Datos: cargo, oficina, régimen, entidad, y la misma persona en la planilla de otras entidades.
 * No se indexa en buscadores (robots).
 */
export default async function FichaPlanillaPage({ params, searchParams }: { params: { codigo: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const f = await getFichaPlanilla(params.codigo);
  if (!f) {
    if (!/^[0-9a-f]{12}$/.test(params.codigo)) notFound();
    return <NoSePudoLeer codigo={params.codigo} />;
  }
  const p = f.persona;
  const ruta = rutaPlanilla(params.codigo);
  const seccion = uno(searchParams?.seccion);
  const entidad = p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre";
  const cargo = p.cargo ? tituloNatural(p.cargo) : null;
  const graves = p.senales.filter((s) => s.severidad === "alta").length;
  const motivo = motivoDudoso(p.dudoso?.motivo);
  // Meses en que además cobró por órdenes de servicio (señal tambien_ordenes), para marcarlos en el cuadro mes a mes.
  const detOrden = p.senales.find((s) => s.tipo === "tambien_ordenes")?.detalle;
  const mesesOrden = Array.isArray(detOrden?.meses) ? (detOrden!.meses as unknown[]).map(String) : [];
  const montoOrden = typeof detOrden?.monto === "number" ? (detOrden!.monto as number) : null;

  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Personas contratadas", href: "/app/personas" },
          { etiqueta: "Planilla", href: "/app/personas?seccion=planilla" },
          { etiqueta: p.nombre, href: ruta },
        ]}
        pestanas={{ primera: "senales", activa: seccion ?? "senales", etiquetas: { sueldo: "Cobros al Estado", datos: "Datos" } }}
      />
      <EncabezadoPagina
        titulo={p.nombre}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {cargo && <Dato tipo="cargo">{cargo}</Dato>}
            <Link href={`/entidad/${p.entidadRuc}?seccion=planilla`} className="underline-offset-2 hover:text-granate hover:underline">
              <Dato tipo="entidad">{entidad}</Dato>
            </Link>
            {p.regimen != null && <Dato tipo="regimen">{REGIMEN[p.regimen] ?? `Régimen ${p.regimen}`}</Dato>}
          </span>
        }
        ayuda={
          <Ayuda titulo="¿Por qué está esta persona aquí?">
            <span className="block">
              Porque figura en la planilla que su entidad publica en el Portal de Transparencia Estándar, con su cargo y lo que
              cobra cada mes. Vigía tapa uno de sus apellidos y no muestra su DNI (la planilla no lo trae).
            </span>
            <span className="mt-2 block">
              Las señales dicen qué otro registro público coincide con esta persona. Ninguna prueba un delito ni un parentesco.{" "}
              <Link href="/privacidad" className="text-granate underline-offset-2 hover:underline">¿Eres tú? Pide una corrección</Link>
            </span>
          </Ayuda>
        }
      />
      <Indicadores items={indicadores(f, graves, ruta)} />
      {motivo && (
        <AvisoDato motivo={motivo} fuente="pte_personal">
          {`Su planilla de ${p.ultimoMes ?? "su último mes"} trae ${p.dudoso?.total != null ? soles(p.dudoso.total) : "un monto"} en total. Mira su sueldo mes a mes.`}
        </AvisoDato>
      )}

      <Pestanas
        key={seccion ?? "senales"}
        etiqueta="Secciones de la persona"
        activa={seccion}
        pestanas={[
          {
            clave: "senales",
            etiqueta: "Señales",
            conteo: p.senales.length,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>En {entidad}, qué dicen de esta persona otros registros públicos.</CabeceraPestana>
                {p.senales.length ? (
                  <SenalesPlanillaLista senales={p.senales} />
                ) : (
                  <EstadoVacio compacto titulo="Ningún otro registro coincide">
                    No cobra también por órdenes de la entidad, no fue candidato del partido que la gobierna, no comparte apellidos
                    con sus autoridades ni sus directivos y su sueldo no se aparta del de su mismo cargo.
                  </EstadoVacio>
                )}
              </div>
            ),
          },
          {
            clave: "sueldo",
            etiqueta: "Cobros al Estado",
            conteo: f.historia.length,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana>Lo que cobró de la planilla cada mes que la entidad la publicó.{mesesOrden.length ? " El ◆ marca los meses en que además cobró por órdenes de servicio." : ""}</CabeceraPestana>
                {f.historia.length > 1 ? (
                  <section className="rounded-2xl border border-line bg-paper p-4">
                    <LineaMeses
                      puntos={f.historia.map((h) => ({ mes: h.mes, base: h.base, extra: h.extra, dudoso: h.dudoso }))}
                      etiqueta={`Cobros al Estado mes a mes de ${p.nombre}`}
                      ordenes={mesesOrden.length ? { meses: mesesOrden, monto: montoOrden } : undefined}
                    />
                  </section>
                ) : (
                  <EstadoVacio compacto titulo="Un solo mes cargado">
                    {f.historia[0]
                      ? `En ${f.historia[0].mes} cobró ${soles(f.historia[0].total)}. Con más meses publicados se verá su línea de tiempo.`
                      : "Todavía no hay meses cargados de su planilla."}
                  </EstadoVacio>
                )}
              </div>
            ),
          },
          {
            clave: "datos",
            etiqueta: "Datos",
            conteo: f.otras.length ? f.otras.length + 1 : undefined,
            contenido: (
              <div className="space-y-5">
                <CabeceraPestana>Lo que publica su entidad, y la misma persona en la planilla de otras entidades.</CabeceraPestana>
                <DatosClave
                  items={[
                    { etiqueta: "Entidad", valor: <Link href={`/entidad/${p.entidadRuc}?seccion=planilla`} className="text-granate hover:underline">{entidad}</Link> },
                    { etiqueta: "Cargo", valor: cargo },
                    { etiqueta: "Oficina", valor: p.dependencia ? tituloNatural(p.dependencia) : null },
                    { etiqueta: "Régimen", valor: p.regimen != null ? REGIMEN[p.regimen] ?? `Régimen ${p.regimen}` : null },
                    { etiqueta: "Sueldo del último mes", valor: p.base != null ? soles(p.base) : null, mono: true },
                    { etiqueta: "Total cobrado ese mes", valor: p.total != null ? soles(p.total) : null, mono: true },
                    ...(p.extra ? [{ etiqueta: "Fuera del sueldo", valor: `${soles(p.extra)} (otros beneficios, gratificación, incentivo)` }] : []),
                    { etiqueta: "Meses en planilla", valor: `${numero(p.meses)} (${[p.primerMes, p.ultimoMes].filter(Boolean).join(" a ")})` },
                    { etiqueta: "Región", valor: p.depNombre },
                    ...(p.codigo
                      ? [{ etiqueta: "Órdenes de servicio", valor: <Link href={`/app/personas/${p.codigo}`} className="text-granate hover:underline">También recibe órdenes: ver su ficha</Link> }]
                      : []),
                  ]}
                />
                {f.otras.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="font-display text-bloque font-bold text-ink">
                      {plural(f.otras.length, "otra planilla", "otras planillas")} con su mismo nombre completo
                    </h3>
                    <p className="text-meta text-mute">Con los dos apellidos y los nombres iguales: casi siempre es la misma persona.</p>
                    <Tabla columnas={COLUMNAS_OTRAS} filas={filasOtras(f)} etiqueta="La misma persona en otras planillas" />
                  </section>
                )}
                <p className="text-rotulo text-mute">Fuente: Portal de Transparencia Estándar de cada entidad, rubro Personal.</p>
              </div>
            ),
          },
        ]}
      />
      <Aviso tono="neutro">
        Una señal no es una acusación ni prueba un parentesco: dice qué registro público coincide con esta persona, para que
        alguien lo revise. El título, la edad o la experiencia de cada persona no están en datos abiertos.
      </Aviso>
    </Pagina>
  );
}

function indicadores(f: FichaPlanilla, graves: number, ruta: string): Indicador[] {
  const p = f.persona;
  return [
    {
      valor: p.base != null ? soles(p.base) : p.total != null ? soles(p.total) : null,
      etiqueta: "sueldo del último mes",
      contexto: [p.ultimoMes, p.total != null && p.base != null && p.total > p.base ? `${soles(p.total)} con todo` : null].filter(Boolean).join(", ") || undefined,
      href: `${ruta}?seccion=sueldo`,
    },
    { valor: numero(p.meses), etiqueta: p.meses === 1 ? "mes en planilla" : "meses en planilla", contexto: [p.primerMes, p.ultimoMes].filter(Boolean).join(" a "), href: `${ruta}?seccion=sueldo` },
    { valor: numero(p.senales.length), etiqueta: p.senales.length === 1 ? "señal" : "señales", contexto: graves > 0 ? plural(graves, "grave", "graves") : "ninguna grave", tono: graves > 0 ? "alta" : "neutro", href: ruta },
    {
      valor: p.codigo ? "Sí" : "No",
      etiqueta: "recibe órdenes de servicio",
      contexto: p.codigo ? "de esta u otras entidades: ver su ficha" : "de esta entidad, por su nombre",
      href: p.codigo ? `/app/personas/${p.codigo}` : undefined,
    },
  ];
}

const COLUMNAS_OTRAS: Columna[] = [
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.4fr)" },
  { clave: "regimen", titulo: "Régimen", ancho: "130px", desde: "lg" },
  { clave: "sueldo", titulo: "Sueldo", ancho: "110px", alinear: "der" },
];

function filasOtras(f: FichaPlanilla): Fila[] {
  return f.otras.map((o, i) => ({
    id: `${o.entidadRuc}-${i}`,
    href: o.ficha ? rutaPlanilla(o.ficha) : `/entidad/${o.entidadRuc}?seccion=planilla`,
    celdas: {
      entidad: (
        <CeldaPrincipal
          titulo={o.entidad ? tituloNatural(o.entidad) : o.entidadRuc}
          meta={[o.cargo && <Dato key="cargo" tipo="cargo">{tituloNatural(o.cargo)}</Dato>, o.ultimoMes && <Dato key="mes" tipo="fecha" nombre="Último mes">{o.ultimoMes}</Dato>]}
        />
      ),
      regimen: <span className="text-meta text-inkSoft">{o.regimen != null ? REGIMEN[o.regimen] ?? `Régimen ${o.regimen}` : "Sin dato"}</span>,
      sueldo: <CeldaNumero>{o.base != null ? soles(o.base) : "Sin dato"}</CeldaNumero>,
    },
  }));
}

function NoSePudoLeer({ codigo }: { codigo: string }) {
  return (
    <FichaNoLeida
      migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Personas contratadas", href: "/app/personas" }, { etiqueta: "Planilla", href: "/app/personas?seccion=planilla" }]}
      titulo="Persona en planilla"
      error="No pudimos leer esta ficha"
      reintentar={{ href: rutaPlanilla(codigo) }}
    >
      Puede que el código no exista o que el servidor no respondiera. No mostramos nada en su lugar.
    </FichaNoLeida>
  );
}
