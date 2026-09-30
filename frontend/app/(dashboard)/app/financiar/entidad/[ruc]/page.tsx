import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CheckCircle2, ChevronRight, Clock, MapPin, ShieldCheck } from "lucide-react";
import { ContribuirForm } from "@/components/financiar/ContribuirForm";
import { NombreEntidad, esRucPersona } from "@/components/financiar/NombreEntidad";
import { SeguirAlcance } from "@/components/financiar/SeguirAlcance";
import { TablaAliados } from "@/components/financiar/TablaAliados";
import { TarjetaConfirmacion } from "@/components/financiar/TarjetaConfirmacion";
import { Ruc } from "@/components/Redact";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda, CabeceraPestana, EncabezadoPagina, EstadoError, Pagina, Pestanas, Volver, type Pestana } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { etiquetaTipoEntidad, tipoEntidad } from "@/lib/entidad-tipo";
import { getEntidadFinanciable, getPago, tiposEnPalabras, type EntidadFinanciableDetalle } from "@/lib/financiamiento";
import { numero, plural, soles } from "@/lib/formato";

export const revalidate = 60;

/** El nombre para textos planos (título de la pestaña, compartir): nunca el de una persona natural. */
const nombrePlano = (d: EntidadFinanciableDetalle) => (esRucPersona(d.entidad.ruc) ? "esta entidad" : d.entidad.nombre);

export async function generateMetadata({ params }: { params: { ruc: string } }) {
  const d = await getEntidadFinanciable(params.ruc);
  if (d === "no_encontrada") return { title: "Entidad no encontrada" };
  if (!d) return { title: "Financiar la auditoría de una entidad" };
  const titulo = `¿En qué gasta tu dinero ${nombrePlano(d)}?`;
  const description = `${plural(d.cola.contratos, "contrato se puede", "contratos se pueden")} auditar hoy, de ${numero(d.contratos.total)} registrados. Financia su lectura a ${soles(d.precioPen)} por contrato; los resultados son públicos.`;
  return { title: titulo, description, openGraph: { title: titulo, description } };
}

/**
 * /app/financiar/entidad/[ruc] — plantilla de conversión (§14) por ENTIDAD. Una sola pregunta,
 * la de quien desconfía de una entidad concreta: "¿En qué gasta tu dinero {entidad}?".
 *
 *   volver · identidad (la pregunta; tipo, RUC y región) · Indicadores (se pueden auditar hoy,
 *   listos para leerse, con dictamen, registrados: con el alcance activo dicho sin rodeos)
 *   [ pestañas: Qué hay en la cola | Quién financió ]   [ el formulario, a la derecha ]
 *
 * Los contratos se asignan al azar entre los de la entidad en cola, primero los que ya tienen
 * documentos: quien financia elige la entidad, no los contratos. Mínimo 1, máximo lo que haya
 * en cola. Sin nada en cola, se dice (TarjetaConfirmacion), como en la ficha de una zona.
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
  const metodos = pago ? ([pago.yape && "yape", pago.plin && "plin", ...pago.cuentas.map((c) => c.banco)].filter(Boolean) as string[]) : [];
  const tipo = tipoEntidad(entidad.tipo, entidad.nombre);
  const alcance = { tipo: "entidad" as const, ruc: entidad.ruc, nombre: entidad.nombre };
  const tipos = tiposEnPalabras(d.tiposActivos);

  return (
    <Pagina className="space-y-6">
      <Volver href="/app/financiar?por=entidad">Financiar por entidad</Volver>

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
        <Indicadores items={indicadoresEntidad(d, tipos)} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className="min-w-0 space-y-6">
          <Pestanas
            etiqueta={`Secciones de ${nombrePlano(d)}`}
            activa={typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined}
            pestanas={pestanasEntidad(d)}
          />

          {/* La independencia en una línea; el detalle, en el ⓘ y en las reglas de /app/financiar. */}
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-inkSoft">
            <ShieldCheck size={15} className="shrink-0 text-granate" aria-hidden />
            <span>Financias capacidad de lectura, no resultados.</span>
            <Ayuda titulo="¿Qué garantiza la independencia?">
              Eliges la entidad, no los contratos: se asignan al azar entre los suyos en cola, y los resultados se publican
              aunque señalen a quien financió.
            </Ayuda>
            <Link href="/app/financiar#independencia" className="font-medium text-granate underline underline-offset-2">Reglas de independencia</Link>
          </p>
        </div>

        {/* En móvil la respuesta va PRIMERO; en escritorio, columna derecha pegajosa (como la ficha de una zona). */}
        <section
          aria-label={`Financiar la lectura de ${nombrePlano(d)}`}
          className="order-first w-full max-w-2xl xl:order-last xl:sticky xl:top-6 xl:max-w-none xl:self-start"
          id="aportar"
        >
          {cola.contratos > 0 ? (
            <ContribuirForm
              alcance={alcance}
              precioPen={d.precioPen}
              restantes={cola.contratos}
              metodos={metodos}
              pagoConfigurado={!!pago?.configurado}
              financiados={d.contratos.enProceso}
            />
          ) : (
            <TarjetaConfirmacion
              titulo="Hoy no hay contratos de esta entidad para auditar"
              acciones={
                <>
                  <EnlaceAccion href="/app/financiar?por=entidad">Elegir otra entidad</EnlaceAccion>
                  <SeguirAlcance alcance={alcance} />
                </>
              }
            >
              {tipos
                ? `Por ahora Vigía audita solo contratos de ${tipos}, y ninguno de esta entidad espera en la cola. Podrás financiar su lectura cuando entre uno.`
                : "Ninguno de sus contratos espera en la cola. Podrás financiar su lectura cuando entre uno."}
            </TarjetaConfirmacion>
          )}
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
  const { cola, contratos, precioPen } = d;
  return [
    {
      valor: numero(cola.contratos),
      etiqueta: cola.contratos === 1 ? "se puede auditar hoy" : "se pueden auditar hoy",
      contexto:
        cola.contratos === 0
          ? "ninguno en la cola"
          : cola.contratos === 1
            ? `${soles(precioPen)} leerlo`
            : `${soles(cola.contratos * precioPen)} leerlos, a ${soles(precioPen)} cada uno`,
      ayuda: (
        <Ayuda titulo="¿Qué se puede auditar hoy?">
          Sus contratos en cola: los que esperan financiamiento para leerse. Se asignan al azar entre ellos, primero los que ya
          tienen sus documentos.
        </Ayuda>
      ),
    },
    {
      valor: numero(cola.conDocumentos),
      etiqueta: "listos para leerse",
      contexto: cola.contratos > 0 ? `de ${numero(cola.contratos)} en cola, ya con sus documentos` : "ninguno en la cola",
      ayuda: (
        <Ayuda titulo="¿Qué es “listos para leerse”?">
          Contratos en cola cuyos documentos ya están en el almacén de Vigía: se leen apenas se financian. Los demás esperan
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

const ENLACE_PESTANA = "inline-flex min-h-[24px] items-center gap-1 text-[13px] font-medium text-granate underline-offset-2 hover:underline";

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
              ? `Los ${numero(enCola.length)} más recientes, de ${numero(cola.contratos)} en cola.`
              : "Se asignan al azar, primero los que ya tienen documentos."}
            <Ayuda titulo="¿Quién elige qué se lee?">
              Los contratos son públicos y puedes verlos, pero quien financia elige la entidad, no los contratos: se asignan al
              azar entre los que están en cola, primero los que ya tienen sus documentos.
            </Ayuda>
          </CabeceraPestana>
          {enCola.length > 0 ? (
            <Tabla columnas={COLUMNAS_COLA} filas={filasCola(d)} etiqueta={`Contratos de ${nombre} en cola`} />
          ) : cola.contratos > 0 ? (
            // La cifra dice que hay contratos en cola pero la lista no llegó: se dice, no se inventa una tabla vacía.
            <p className="text-sm text-inkSoft">La lista de estos contratos no llegó. Vuelve a cargar la página en un momento.</p>
          ) : (
            <p className="text-sm text-inkSoft">Ningún contrato de esta entidad espera en la cola hoy.</p>
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
        <p className="text-sm text-inkSoft">Nadie ha financiado la lectura de esta entidad todavía.</p>
      ),
    },
  ];
}

/** Una fila por contrato en cola: objeto, y debajo el código y el estado de sus documentos · valor · fecha · ›. */
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
      celdas: {
        contrato: (
          <CeldaPrincipal
            dosLineas
            titulo={c.objeto || "Contrato sin objeto registrado"}
            meta={[
              c.codigo ? (
                <span key="codigo" className="font-mono" translate="no">
                  {c.codigo}
                </span>
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
    <Pagina>
      <Volver href="/app/financiar?por=entidad">Financiar por entidad</Volver>
      <EncabezadoPagina titulo="¿En qué gasta tu dinero esta entidad?" />
      <EstadoError
        titulo="No pudimos leer la cola de esta entidad"
        accion={<EnlaceAccion href={`/app/financiar/entidad/${encodeURIComponent(ruc)}`}>Reintentar</EnlaceAccion>}
      >
        El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
      </EstadoError>
    </Pagina>
  );
}
