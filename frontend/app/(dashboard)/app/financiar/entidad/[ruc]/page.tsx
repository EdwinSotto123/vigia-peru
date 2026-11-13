import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CheckCircle2, ChevronRight, Clock, MapPin, ShieldCheck } from "lucide-react";
import { ApoyarAlcance } from "@/components/financiar/ApoyarAlcance";
import { NombreEntidad, esRucPersona } from "@/components/financiar/NombreEntidad";
import { TablaAliados } from "@/components/financiar/TablaAliados";
import { Ruc } from "@/components/Redact";
import { Ayuda, CabeceraPestana, EncabezadoPagina, FichaNoLeida, Migas, Pagina, type Pestana, Pestanas } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, TablaPaginada, type Columna, type Fila, type Indicador } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { etiquetaTipoEntidad, tipoEntidad } from "@/lib/entidad-tipo";
import { getEntidadFinanciable, getPago, mediosAbiertos, tiposEnPalabras, type EntidadFinanciableDetalle } from "@/lib/financiamiento";
import { numero, oracion, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";

export const revalidate = 60;

/** El nombre para textos planos (título de la pestaña, compartir): nunca el de una persona natural. */
const nombrePlano = (d: EntidadFinanciableDetalle) => (esRucPersona(d.entidad.ruc) ? "esta entidad" : d.entidad.nombre);

export async function generateMetadata({ params }: { params: { ruc: string } }) {
  const d = await getEntidadFinanciable(params.ruc);
  if (d === "no_encontrada") return { title: "Entidad no encontrada" };
  if (!d) return { title: "Lo que falta leer de una entidad" };
  const titulo = `¿En qué gasta tu dinero ${nombrePlano(d)}?`;
  const description = `${plural(d.cola.contratos, "contrato espera", "contratos esperan")} su lectura a fondo, de ${numero(d.contratos.total)} registrados. Ayuda a vigilarla con un aporte al fondo común; los resultados son públicos.`;
  return { title: titulo, description, openGraph: { title: titulo, description } };
}

/**
 * /app/financiar/entidad/[ruc] — lo que falta leer de una ENTIDAD. Una sola pregunta, la de quien desconfía de una
 * entidad concreta: "¿En qué gasta tu dinero {entidad}?".
 *
 *   volver · identidad (la pregunta; tipo, RUC y región) · Indicadores (esperan lectura a fondo, listos para leerse,
 *   con dictamen, registrados: con el alcance activo dicho sin rodeos)
 *   [ pestañas: Qué hay en la cola | Quién financió ]   [ el aporte, a la derecha ]
 *
 * Desde el 2026-10-30 no se paga la lectura de sus contratos («S/ X por contrato» era una venta): a la derecha va el
 * aporte al fondo común con la entidad como destino sugerido (ApoyarAlcance). La cola se lee con ese fondo, lo más grave
 * primero; «Quién financió» es lo que se pagó con el modelo anterior.
 */
export default async function FinanciarEntidadPage({
  params,
  searchParams,
}: {
  params: { ruc: string };
  /** `?seccion=aliados` abre esa pestaña. */
  searchParams?: { seccion?: string | string[] };
}) {
  const [d, pago] = await Promise.all([getEntidadFinanciable(params.ruc), getPago()]);
  if (d === "no_encontrada") notFound();
  if (!d) return <NoSePudoLeer ruc={params.ruc} />;

  const { entidad, cola } = d;
  const tipo = tipoEntidad(entidad.tipo, entidad.nombre);
  const alcance = { tipo: "entidad" as const, ruc: entidad.ruc, nombre: tituloNatural(entidad.nombre) };
  const tipos = tiposEnPalabras(d.tiposActivos);

  return (
    <Pagina className="space-y-6">
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Auditoría en vivo", href: "/app/auditoria" }, { etiqueta: "Lo que falta leer", href: "/app/auditoria?seccion=falta" },
          { etiqueta: "Por entidad", href: "/app/auditoria?seccion=falta&por=entidad" },
          // Una entidad con RUC 10 es una persona: su nombre no va en la ruta (docs/PRIVACIDAD.md).
          { etiqueta: esRucPersona(entidad.ruc) ? "Entidad" : entidad.nombre },
        ]}
      />

      <div className="space-y-4">
        <EncabezadoPagina
          titulo={<>¿En qué gasta tu dinero <NombreEntidad ruc={entidad.ruc} nombre={entidad.nombre} />?</>}
          bajada={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {tipo && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> {etiquetaTipoEntidad(tipo, entidad.nombre)}
                </span>
              )}
              <span>
                RUC{" "}
                <span className="font-mono text-ink" translate="no">
                  <Ruc value={entidad.ruc} />
                </span>
              </span>
              {entidad.region && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} className="shrink-0 text-mute" aria-hidden /> {entidad.region}
                </span>
              )}
              <Link
                href={`/entidad/${entidad.ruc}`}
                prefetch={false}
                className="inline-flex min-h-[24px] items-center gap-0.5 font-medium text-granate underline-offset-2 hover:underline"
              >
                Ver su ficha <ChevronRight size={14} aria-hidden />
              </Link>
            </span>
          }
        />
        <CifrasEnFila items={indicadoresEntidad(d, tipos)} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className="min-w-0 space-y-6">
          <Pestanas
            etiqueta={`Secciones de ${nombrePlano(d)}`}
            activa={typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined}
            pestanas={pestanasEntidad(d)}
          />

          {/* La independencia en una línea; el detalle, en el ⓘ y en las reglas de /app/apoyar. */}
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-inkSoft">
            <ShieldCheck size={15} className="shrink-0 text-granate" aria-hidden />
            <span>Tu aporte va al fondo común: no decide qué se lee.</span>
            <Ayuda titulo="¿Qué garantiza la independencia?">
              La entidad queda como destino sugerido de tu aporte, nada más: lo más grave se lee primero, sea de donde sea, y
              los resultados se publican aunque señalen a quien aportó.
            </Ayuda>
            <Link href="/app/apoyar#independencia" className="font-medium text-granate underline underline-offset-2">Reglas de independencia</Link>
          </p>
        </div>

        {/* En móvil la respuesta va PRIMERO; en escritorio, columna derecha pegajosa (como la ficha de una zona). */}
        <section
          aria-label={`Ayuda a vigilar ${nombrePlano(d)}`}
          className="order-first w-full max-w-2xl xl:order-last xl:sticky xl:top-6 xl:max-w-none xl:self-start"
          id="aportar"
        >
          <ApoyarAlcance alcance={alcance} medios={mediosAbiertos(pago)} lote={{ precioPen: d.precioPen, restantes: cola.contratos }} />
        </section>
      </div>
    </Pagina>
  );
}

/**
 * Las cifras de la entidad (§10.2), cada una con su denominador. La primera responde lo que
 * vino a preguntar quien llega: cuántos contratos se pueden auditar HOY; la última dice por qué
 * no son todos (sólo se auditan los tipos activos).
 */
function indicadoresEntidad(d: EntidadFinanciableDetalle, tipos: string): Indicador[] {
  const { cola, contratos } = d;
  return [
    {
      valor: numero(cola.contratos),
      etiqueta: cola.contratos === 1 ? "espera lectura a fondo" : "esperan lectura a fondo",
      contexto: cola.contratos === 0 ? "ninguno en la cola" : "con el fondo común, lo más grave primero",
      ayuda: (
        <Ayuda titulo="¿Qué espera lectura a fondo?">
          Sus contratos en cola: los que Vigía todavía no lee completos. Se leen con el fondo común, de lo más grave a lo menos
          grave; ningún aporte elige cuáles.
        </Ayuda>
      ),
    },
    {
      valor: numero(cola.conDocumentos),
      etiqueta: "listos para leerse",
      contexto: cola.contratos > 0 ? `de ${numero(cola.contratos)} en cola, ya con sus documentos` : "ninguno en la cola",
      ayuda: (
        <Ayuda titulo="¿Qué es “listos para leerse”?">
          Contratos en cola cuyos documentos ya están en el almacén de Vigía: se leen apenas les toca. Los demás esperan
          que el lote nocturno los descargue.
        </Ayuda>
      ),
    },
    {
      valor: numero(contratos.auditados),
      etiqueta: "con dictamen publicado",
      contexto: `de ${numero(contratos.total)} registrados${contratos.enProceso > 0 ? `, ${numero(contratos.enProceso)} financiados por leer` : ""}`,
      ayuda: (
        <Ayuda titulo="¿Qué cuenta “con dictamen publicado”?">
          Contratos de la entidad que Vigía leyó y publicó, con o sin señales.
        </Ayuda>
      ),
    },
    {
      valor: numero(contratos.total),
      etiqueta: "contratos registrados",
      contexto: tipos ? `hoy Vigía audita solo ${tipos}` : "en el SEACE",
      ayuda: (
        <Ayuda titulo={tipos ? "¿Por qué no se pueden auditar todos?" : "¿Qué cuenta esta cifra?"}>
          Son todas sus convocatorias en el SEACE, de todo tipo.
          {tipos && ` Por ahora Vigía lee solo contratos de ${tipos}; los demás entran a la cola cuando su análisis se active.`}
        </Ayuda>
      ),
    },
  ];
}

const ENLACE_PESTANA = "inline-flex min-h-[24px] items-center gap-1 text-meta font-medium text-granate underline-offset-2 hover:underline";

// El objeto del contrato ES lo que la página responde ("¿en qué gasta?"): se lleva el ancho. El estado de
// sus documentos va en la línea de abajo, junto al código, en vez de una columna de 148 px.
const COLUMNAS_COLA: Columna[] = [
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Valor referencial", ancho: "128px", alinear: "der" },
  { clave: "fecha", titulo: "Fecha", ancho: "96px", desde: "lg" },
];

/** Lo que hace falta para decidir, en pestañas (§14.3): la cola de la entidad y quién ya financió. */
function pestanasEntidad(d: EntidadFinanciableDetalle): Pestana[] {
  const { entidad, cola, enCola, aliados } = d;
  const nombre = nombrePlano(d);
  const parcial = enCola.length > 0 && enCola.length < cola.contratos;
  return [
    {
      // Sin conteo: lo que espera ya tiene su cifra arriba, en los Indicadores.
      clave: "cola",
      etiqueta: "Qué hay en la cola",
      contenido: (
        <>
          <CabeceraPestana
            acciones={
              <Link href={`/app/contratos?entidad=${entidad.ruc}`} prefetch={false} className={ENLACE_PESTANA}>
                Ver todos sus contratos <ChevronRight size={13} aria-hidden />
              </Link>
            }
          >
            {parcial
              ? `${numero(enCola.length)} de ${numero(cola.contratos)} en cola: el resto entró después de cargar esta página.`
              : "Se leen de lo más grave a lo menos grave."}
            <Ayuda titulo="¿Quién elige qué se lee?">
              Los contratos son públicos y puedes verlos, pero nadie elige cuáles se leen: van primero los más graves, aporte
              quien aporte.
            </Ayuda>
          </CabeceraPestana>
          {enCola.length > 0 ? (
            <TablaPaginada
              columnas={COLUMNAS_COLA}
              filas={filasCola(d)}
              tam={15}
              nombre="contratos en cola"
              etiqueta={`Contratos de ${nombre} en cola`}
              buscar={{ placeholder: "Buscar qué se compra o el código del proceso…", etiqueta: "Buscar en los contratos en cola" }}
            />
          ) : cola.contratos > 0 ? (
            // La cifra dice que hay contratos en cola pero la lista no llegó: se dice, no se inventa una tabla vacía.
            <p className="text-dato leading-5 text-inkSoft">La lista de estos contratos no llegó. Vuelve a cargar la página en un momento.</p>
          ) : (
            <p className="text-dato leading-5 text-inkSoft">Ningún contrato de esta entidad espera en la cola hoy.</p>
          )}
        </>
      ),
    },
    {
      // Reconocimiento en contratos, nunca en soles.
      clave: "aliados",
      etiqueta: "Quién financió",
      conteo: aliados.length,
      contenido: aliados.length ? (
        <TablaAliados aliados={aliados} etiqueta={`Quién financió la lectura de ${nombre}`} />
      ) : (
        <p className="text-dato leading-5 text-inkSoft">Nadie ha financiado la lectura de esta entidad todavía.</p>
      ),
    },
  ];
}

/** Una fila por contrato en cola: objeto, y debajo el código y el estado de sus documentos; valor, fecha y la flecha. */
function filasCola(d: EntidadFinanciableDetalle): Fila[] {
  return d.enCola.map((c) => {
    const monto = c.montoReferencial != null && c.montoReferencial > 0 ? soles(c.montoReferencial) : null;
    const documentos = c.documentosListos ? (
      <span className="inline-flex items-center gap-1 text-mossTexto">
        <CheckCircle2 size={12} aria-hidden /> Listo para leerse
      </span>
    ) : (
      <span className="inline-flex items-center gap-1">
        <Clock size={12} aria-hidden /> Por descargar
      </span>
    );
    return {
      id: c.ocid,
      href: `/app/contratos/${encodeURIComponent(c.ocid)}`,
      buscable: [c.objeto, c.codigo, c.documentosListos ? "listo para leerse" : "por descargar"].filter(Boolean).join(" "),
      celdas: {
        contrato: (
          <CeldaPrincipal
            dosLineas
            titulo={c.objeto ? oracion(c.objeto) : "Contrato sin objeto registrado"}
            meta={[
              c.codigo ? (
                <Dato key="codigo" tipo="codigo" nombre="Código del proceso" mono>
                  <span translate="no">{c.codigo}</span>
                </Dato>
              ) : null,
              documentos,
            ]}
          />
        ),
        monto: <CeldaNumero>{monto ?? <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
        fecha: <CeldaFecha fecha={c.fecha} />,
      },
    };
  });
}

function NoSePudoLeer({ ruc }: { ruc: string }) {
  return (
    <FichaNoLeida
      migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Auditoría en vivo", href: "/app/auditoria" }, { etiqueta: "Lo que falta leer", href: "/app/auditoria?seccion=falta" }, { etiqueta: "Por entidad", href: "/app/auditoria?seccion=falta&por=entidad" }]}
      titulo="¿En qué gasta tu dinero esta entidad?"
      error="No pudimos leer la cola de esta entidad"
      reintentar={{ href: `/app/financiar/entidad/${encodeURIComponent(ruc)}` }}
    />
  );
}
