import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flag, LayoutDashboard } from "lucide-react";
import { Ayuda, AyudaTermino, BanderasFicha, CabeceraPestana, DatosClave, EncabezadoPagina, EstadoVacio, FichaNoLeida, FuenteDato, SinSenalesEstado, Migas, Pagina, Pestanas } from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { CeldaNumero, CeldaPrincipal, CuentaGrupo, Indicadores, TablaPaginada, type Columna, type Fila, type Indicador } from "@/components/listado";
import { LineaMeses } from "@/components/charts/LineaMeses";
import { SenalesPlanillaBreves, SenalesPlanillaLista } from "@/components/personas/SenalesPlanilla";
import { PestanaOrdenes, TAM_ORDENES } from "@/components/personas/OrdenesPersona";
import { IrAPestana } from "@/components/personas/IrAPestana";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { motivoDudoso } from "@/lib/datoDudoso";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { PORTAL_TRANSPARENCIA, personalPte } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { filtrosOrdenesDeUrl, getFichaPersona, getOrdenesPersona, hayFiltrosOrdenes, type FichaPersona } from "@/lib/personas";
import { REGIMEN, SENAL_PLANILLA, getFichaPlanilla, mes, parientesProveedores, periodoMeses, rutaPlanilla, type FichaPlanilla, type ParienteProveedor } from "@/lib/planilla";
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
 *   · Resumen: sus datos, sus señales en una línea cada una y su sueldo mes a mes; la misma persona en otras planillas.
 *   · Señales: cada una con su evidencia plegada y su fuente, lo grave primero. El nepotismo del lado del funcionario
 *     (parientes que declaró en su DJI y que le venden a su entidad) es una señal más, con las órdenes de cada pariente.
 *   · Órdenes: si también recibe órdenes de servicio (su ficha de persona contratada), todas, con sus filtros.
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
  const filtrosOrdenes = filtrosOrdenesDeUrl(searchParams);
  const seccion = uno(searchParams?.seccion) ?? (p.codigo && hayFiltrosOrdenes(filtrosOrdenes) ? "ordenes" : undefined);
  const entidad = p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre";
  const cargo = p.cargo ? tituloNatural(p.cargo) : null;
  const motivo = motivoDudoso(p.dudoso?.motivo);
  // La persona entera: si también es locador, su ficha de persona contratada (lo que cobró por órdenes, de qué
  // entidades); y la de cada pariente que le vende a su entidad (las órdenes concretas, como evidencia).
  const [locador, fichasParientes] = await Promise.all([
    p.codigo ? getFichaPersona(p.codigo) : Promise.resolve(null),
    Promise.all(f.nepotismo.map((x) => (x.proveedorCodigo ? getFichaPersona(x.proveedorCodigo) : Promise.resolve(null)))),
  ]);
  const parientes = parientesProveedores(f, fichasParientes);
  // El pariente locador también llega como señal (migración 179); con la evidencia rica de arriba (sus órdenes y su ficha),
  // la señal simple sobra: se muestra una vez.
  const senalesPlanilla = parientes.length ? p.senales.filter((s) => s.tipo !== "pariente_locador") : p.senales;
  const nSenales = senalesPlanilla.length + (parientes.length ? 1 : 0);
  const altas = senalesPlanilla.filter((s) => s.severidad === "alta").length + (parientes.length ? 1 : 0);
  // Sus banderas, fijas bajo el nombre en todas las pestañas: el nepotismo (parientes que declaró en su DJI y que le
  // venden a su entidad) primero, después sus señales de la planilla, lo grave antes; todas hacia la pestaña Señales.
  const aSenales = `${ruta}?seccion=senales`;
  const banderas = [
    ...(parientes.length
      ? [{ tipo: "nepotismo", severidad: "alta" as const, nombre: "Posible nepotismo", n: parientes.length > 1 ? parientes.length : null, explica: "Declaró en su DJI a un pariente que es locador de su misma entidad", href: aSenales }]
      : []),
    ...senalesPlanilla.map((x) => ({ tipo: x.tipo, severidad: x.severidad, nombre: SENAL_PLANILLA[x.tipo]?.corto ?? x.tipo, explica: SENAL_PLANILLA[x.tipo]?.titulo, href: aSenales })),
  ];
  const ordenesP = p.codigo ? getOrdenesPersona(p.codigo, { ...filtrosOrdenes, size: TAM_ORDENES }) : null;
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
        pestanas={{ primera: "resumen", activa: seccion ?? "resumen", etiquetas: { senales: "Señales", ordenes: "Órdenes" } }}
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
        banderas={banderas.length ? <BanderasFicha etiqueta="Banderas de esta persona" banderas={banderas} todas={aSenales} /> : undefined}
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
      <Indicadores items={indicadores(f, { nSenales, altas, locador }, ruta)} />
      {motivo && (
        <AvisoDato motivo={motivo} fuente="pte_personal">
          {`Su planilla de ${mes(p.ultimoMes) ?? "su último mes"} trae ${p.dudoso?.total != null ? soles(p.dudoso.total) : "un monto"} en total. Mira su sueldo mes a mes, en el Resumen.`}
        </AvisoDato>
      )}

      <Pestanas
        fija
        key={seccion ?? "resumen"}
        etiqueta="Secciones de la persona"
        activa={seccion}
        pestanas={[
          {
            clave: "resumen",
            icono: <LayoutDashboard size={15} aria-hidden />,
            etiqueta: "Resumen",
            contenido: (
              <Resumen
                f={f}
                entidad={entidad}
                cargo={cargo}
                parientes={parientes}
                nSenales={nSenales}
                locador={locador}
                mesesOrden={mesesOrden}
                montoOrden={montoOrden}
              />
            ),
          },
          {
            clave: "senales",
            icono: <Flag size={15} aria-hidden />,
            etiqueta: "Señales",
            conteo: nSenales,
            contenido: (
              <div>
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Qué es una señal?">
                      Dice qué otro registro público coincide con esta persona en su entidad: una candidatura, sus apellidos, lo que
                      cobra frente a su mismo cargo, órdenes de servicio a su nombre, un pariente declarado que le vende. Es un
                      indicio para revisar, no una acusación ni la prueba de un parentesco.
                    </Ayuda>
                  }
                >
                  {nSenales ? `${plural(nSenales, "señal", "señales")} en ${entidad}, de la más grave a la más leve.` : `En ${entidad}, qué dicen de esta persona otros registros públicos.`}
                </CabeceraPestana>
                {nSenales ? (
                  <section aria-label="Sus señales" className="tarjeta rounded-2xl border border-line bg-paper px-4 pb-1 pt-1 sm:px-5">
                    <SenalesPlanillaLista senales={senalesPlanilla} nepotismo={parientes} entidad={entidad} entidadRuc={p.entidadRuc} idPte={p.idPte} />
                  </section>
                ) : (
                  <SinSenalesEstado titulo="Sin señales: ningún otro registro coincide">
                    No cobra también por órdenes de la entidad, no fue candidato del partido que la gobierna, no comparte apellidos
                    con sus autoridades ni sus directivos y su sueldo no se aparta del de su mismo cargo.
                  </SinSenalesEstado>
                )}
              </div>
            ),
          },
          ...(p.codigo && ordenesP
            ? [
                {
                  clave: "ordenes",
                  etiqueta: "Órdenes",
                  conteo: locador?.persona.ordenes ?? null,
                  contenido: (
                    <PestanaOrdenes
                      ruta={ruta}
                      pagina={ordenesP}
                      filtros={filtrosOrdenes}
                      ficha={locador}
                      descripcion="Las órdenes de servicio que recibe a su nombre, de esta y de otras entidades: toca una para su detalle."
                      ayuda={
                        <Ayuda titulo="¿Cómo se sabe que es la misma persona?">
                          Su nombre completo coincide con el de quien recibe órdenes de servicio de esta misma entidad (la planilla no
                          trae DNI ni RUC). Su ficha de persona contratada tiene todas sus órdenes y sus señales como locador.
                        </Ayuda>
                      }
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      <Aviso tono="neutro">
        Una señal no es una acusación ni prueba un parentesco: dice qué registro público coincide con esta persona, para que
        alguien lo revise. El título, la edad o la experiencia de cada persona no están en datos abiertos.
      </Aviso>
    </Pagina>
  );
}

function indicadores(f: FichaPlanilla, s: { nSenales: number; altas: number; locador: FichaPersona | null }, ruta: string): Indicador[] {
  const p = f.persona;
  const ultimo = mes(p.ultimoMes);
  const items: Indicador[] = [
    {
      valor: p.base != null ? soles(p.base) : p.total != null ? soles(p.total) : null,
      etiqueta: "sueldo del último mes",
      contexto: [ultimo, p.total != null && p.base != null && p.total > p.base ? `${soles(p.total)} con todo` : null].filter(Boolean).join(", ") || undefined,
    },
    { valor: numero(p.meses), etiqueta: p.meses === 1 ? "mes en planilla" : "meses en planilla", contexto: periodoMeses(p.primerMes, p.ultimoMes) ?? undefined },
    {
      valor: numero(s.nSenales),
      etiqueta: s.nSenales === 1 ? "señal" : "señales",
      contexto: s.altas > 0 ? plural(s.altas, "alta", "altas") : s.nSenales ? "ninguna alta" : "ningún otro registro coincide",
      tono: s.altas > 0 ? "alta" : "neutro",
      href: `${ruta}?seccion=senales`,
    },
  ];
  // Si también es locador: lo que cobró por órdenes (no un «Sí» del tamaño de un número), y la pestaña con cada una.
  if (p.codigo) {
    const l = s.locador?.persona;
    items.push({
      valor: l ? solesCompacto(l.monto) : null,
      etiqueta: "cobrados por órdenes de servicio",
      contexto: l ? `en ${plural(l.ordenes, "orden", "órdenes")} de ${plural(l.entidades, "entidad", "entidades")}` : "no pudimos leer sus órdenes ahora",
      href: `${ruta}?seccion=ordenes`,
    });
  }
  return items;
}

// ─── Resumen ──────────────────────────────────────────────────────────────────────────────────────

function Resumen({
  f,
  entidad,
  cargo,
  parientes,
  nSenales,
  locador,
  mesesOrden,
  montoOrden,
}: {
  f: FichaPlanilla;
  entidad: string;
  cargo: string | null;
  parientes: ParienteProveedor[];
  nSenales: number;
  locador: FichaPersona | null;
  mesesOrden: string[];
  montoOrden: number | null;
}) {
  const p = f.persona;
  const periodo = periodoMeses(p.primerMes, p.ultimoMes);
  const l = locador?.persona;
  // Como arriba: con la evidencia rica de los parientes, la señal simple «pariente_locador» no se repite.
  const senalesPlanilla = parientes.length ? p.senales.filter((s) => s.tipo !== "pariente_locador") : p.senales;
  return (
    <div className="space-y-4">
      <CabeceraPestana>Quién es en la planilla de {entidad}, qué señales tiene y cuánto cobró cada mes.</CabeceraPestana>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="sus-senales" className="tarjeta space-y-1 rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h3 id="sus-senales" className="inline-flex items-center gap-2 font-display text-bloque font-bold text-ink">
              Sus señales
              {nSenales > 0 && <CuentaGrupo>{numero(nSenales)}</CuentaGrupo>}
            </h3>
            {nSenales > 0 && <IrAPestana clave="senales">Ver cada una con su evidencia</IrAPestana>}
          </div>
          {nSenales ? (
            <SenalesPlanillaBreves senales={senalesPlanilla} nepotismo={parientes} />
          ) : (
            <p className="text-dato text-inkSoft">Ningún otro registro público coincide con esta persona en {entidad}.</p>
          )}
        </section>
        <section aria-labelledby="sus-datos" className="tarjeta space-y-2 rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <h3 id="sus-datos" className="font-display text-bloque font-bold text-ink">Sus datos</h3>
          <DatosClave
            items={[
              { etiqueta: "Entidad", valor: <Link href={`/entidad/${p.entidadRuc}?seccion=planilla`} className="text-granate underline-offset-2 hover:underline">{entidad}</Link> },
              { etiqueta: "Cargo", valor: cargo },
              { etiqueta: "Oficina", valor: p.dependencia ? tituloNatural(p.dependencia) : null },
              { etiqueta: "Régimen", valor: p.regimen != null ? REGIMEN[p.regimen] ?? `Régimen ${p.regimen}` : null, ayuda: <AyudaTermino clave="regimen" /> },
              { etiqueta: "Región", valor: p.depNombre },
              { etiqueta: "En la planilla", valor: `${plural(p.meses, "mes", "meses")}${periodo ? `, ${periodo}` : ""}` },
              { etiqueta: `Sueldo de ${mes(p.ultimoMes) ?? "su último mes"}`, valor: p.base != null ? soles(p.base) : null, mono: true },
              { etiqueta: "Total cobrado ese mes", valor: p.total != null ? soles(p.total) : null, mono: true },
              ...(p.extra ? [{ etiqueta: "Fuera del sueldo", valor: `${soles(p.extra)} (otros beneficios, gratificación, incentivo)` }] : []),
              {
                etiqueta: "Órdenes de servicio",
                valor: p.codigo ? (
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span>{l ? `${soles(l.monto)} en ${plural(l.ordenes, "orden", "órdenes")}` : "También recibe órdenes"}</span>
                    <IrAPestana clave="ordenes">Ver sus órdenes</IrAPestana>
                  </span>
                ) : (
                  "No figura con órdenes de esta entidad a su nombre"
                ),
                ayuda: <AyudaTermino clave="orden-servicio" />,
              },
            ]}
          />
          {/* La página de personal de su entidad en el portal, por su id (sin él, la portada del portal). */}
          <FuenteDato fuente="Portal de Transparencia Estándar de la entidad, rubro Personal" href={personalPte(p.idPte)} className="pt-1" />
        </section>
      </div>
      <section aria-labelledby="sueldo-mes" className="tarjeta space-y-2 rounded-2xl border border-line bg-paper p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 id="sueldo-mes" className="font-display text-bloque font-bold text-ink">Sueldo mes a mes</h3>
          <Ayuda titulo="¿Qué muestra el sueldo mes a mes?">
            Lo que cobró de la planilla cada mes que la entidad la publicó: el sueldo, y aparte lo de fuera del sueldo
            (gratificación, otros beneficios, incentivo). Un mes que se dispara frente a los demás suele ser un pago acumulado o
            un error de carga.{mesesOrden.length ? " El rombo marca los meses en que además cobró por órdenes de servicio." : ""}
          </Ayuda>
        </div>
        {f.historia.length > 1 ? (
          <LineaMeses
            puntos={f.historia.map((h) => ({ mes: h.mes, base: h.base, extra: h.extra, dudoso: h.dudoso }))}
            etiqueta={`Sueldo mes a mes de ${p.nombre}`}
            ordenes={mesesOrden.length ? { meses: mesesOrden, monto: montoOrden } : undefined}
          />
        ) : (
          <p className="text-dato text-inkSoft">
            {f.historia[0]
              ? `Un solo mes cargado: en ${mes(f.historia[0].mes) ?? f.historia[0].mes} cobró ${soles(f.historia[0].total)}. Con más meses publicados se verá su línea de tiempo.`
              : "Todavía no hay meses cargados de su planilla."}
          </p>
        )}
      </section>
      {f.otras.length > 0 && (
        <section aria-labelledby="otras-planillas" className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 id="otras-planillas" className="font-display text-bloque font-bold text-ink">
              {f.otras.length === 1 ? "En la planilla de otra entidad" : `En la planilla de ${numero(f.otras.length)} entidades más`}
            </h3>
            <Ayuda titulo="¿Es la misma persona?">
              Con los dos apellidos y los nombres iguales casi siempre es la misma persona, pero la planilla no trae DNI: puede ser
              alguien con el mismo nombre completo.
            </Ayuda>
          </div>
          <TablaPaginada
            columnas={COLUMNAS_OTRAS}
            filas={filasOtras(f)}
            etiqueta="La misma persona en otras planillas"
            nombre="planillas"
            buscar={{ placeholder: "Buscar por entidad o cargo…", etiqueta: "Buscar en sus otras planillas" }}
          />
          {/* Cada ficha lleva a la página de personal de su entidad; aquí, el portal. */}
          <FuenteDato fuente="Portal de Transparencia Estándar, personal de cada entidad" href={PORTAL_TRANSPARENCIA} />
        </section>
      )}
    </div>
  );
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
    buscable: [o.entidad, o.cargo].filter(Boolean).join(" "),
    celdas: {
      entidad: (
        <CeldaPrincipal
          titulo={o.entidad ? tituloNatural(o.entidad) : o.entidadRuc}
          meta={[
            o.cargo && <Dato key="cargo" tipo="cargo">{tituloNatural(o.cargo)}</Dato>,
            o.ultimoMes && <Dato key="mes" tipo="fecha" nombre="Último mes">{mes(o.ultimoMes) ?? o.ultimoMes}</Dato>,
          ]}
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
