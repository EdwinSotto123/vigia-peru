/**
 * Ficha de un contrato (DESIGN_SYSTEM.md §14.2), en el orden de la plantilla:
 *   volver → identidad (el objeto; código, entidad y zona en una línea; chips de estado)
 *   → Indicadores (cuánto y cuándo; sólo las cifras que hay, las que faltan en una línea) → pestañas (§14.3): Resumen
 *   (el estado de su lectura en una franja con qué hacer, los antecedentes del ganador en un renglón por tipo y, sin leer,
 *   qué se leerá) | Antecedentes | Ítems | Participantes (sin dictamen) o Postores y
 *   ofertas (las actas leídas) | Adjudicación y contrato | Precio contratado | Dónde dice cada señal | Cronograma |
 *   Documentos oficiales, cada una con su conteo y su fuente al pie. Participantes, adjudicación y cronograma salen
 *   del registro del proceso (OCDS, CONOSCE, SUNAT, MEF: ProcesoContrato.tsx), así una ficha sin leer también dice
 *   quién compitió, quién ganó, qué se firmó y cuándo.
 *   Antes esas cinco tablas se apilaban debajo del estado y había que bajar y bajar; después, los
 *   antecedentes del ganador iban ENTRE las cifras y las pestañas (hasta 1,100 px de sanciones en prosa) y
 *   en el celular «quién ganó» quedaba al final, a 3.6 pantallas (evaluación 2026-10-26).
 *
 * Antes las cifras vivían en una grilla de formulario ("Valor referencial / Monto adjudicado /
 * Convocatoria / Buena pro / Postores / Quién ganó") y cada tabla tenía su propio estilo. Ahora
 * las cifras son `Indicadores`, quién ganó y los códigos van en "Datos del proceso" (columna
 * lateral) y las pestañas de evidencia (`EvidenciaContrato.tsx`) usan la `Tabla` del kit (§14.1).
 *
 * Server component; `ContratoEnVivo` y `Redact` son islas de cliente. Cifras de cabecera
 * compactas con el monto exacto como contexto; en tablas, soles completos (lib/formato, §10.3).
 */

import Link from "next/link";
import { rutaContrato } from "@/lib/rutas";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { Suspense, type ReactNode } from "react";
import { Building2, CalendarRange, Clock, FileCheck, FileText, Hash, History, Hourglass, Info, MapPin, Package, ShieldAlert } from "lucide-react";
import { ContratoEnVivo } from "@/components/auditoria/ContratoEnVivo";
import { ResultadoAnalisis } from "@/components/auditoria/ResultadoAnalisis";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { PersonName, Ruc } from "@/components/Redact";
import { NotaPrivacidad } from "@/components/privacidad/NotaPrivacidad";
import { Ayuda, AyudaTermino, Cargando, EncabezadoPagina, EnlaceFuente, Franja, FuenteDato, Migas, Pestanas, type Pestana } from "@/components/patrones";
import { HistoriaFicha } from "@/components/historia/HistoriaFicha";
import { busquedaOece, enlacesProceso, procesoOece } from "@/lib/fuentes";
import { migasConDesde } from "@/lib/desde";
import { Indicadores, type Indicador } from "@/components/listado";
import { EnlaceAccion, claseAccion } from "@/components/ui/EnlaceAccion";
import { BotonPestana } from "./BotonPestana";
import { EstadoContratoPill } from "./ContratosLista";
import { OCDS, dia, monto, pestanasEvidencia } from "./EvidenciaContrato";
import { pestanasProceso } from "./ProcesoContrato";
import { recortar, limpiarObjeto } from "./recortar";
import { OtrosContratosEntidad } from "./OtrosContratosEntidad";
import { LineaTiempoProceso, fechaGano } from "./LineaTiempoProceso";
import { EntidadEnVigia } from "./EntidadEnVigia";
import { CrucesProveedor, ResumenAntecedentes, clasificarCruces } from "./CrucesProveedor";
import { DossierDrawerProvider } from "./DossierDrawer";
import { PartidoQueGobierna } from "./PartidoQueGobierna";
import { AvisoContrato } from "./DatoDudosoContrato";
import { BanderaDato } from "@/components/ui/BanderaDato";
import { motivoDudoso } from "@/lib/datoDudoso";
import type { ContratoResumen } from "@/lib/contratos";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { FASES } from "@/lib/auditoria";
import type { CatalogoReglas } from "@/lib/revision";
import { fecha, fechaConAnio, fechaCorta, listaY, numero, oracion, plural, solesCompacto } from "@/lib/formato";
import {
  adjudicacionesVigentes, cambioDeGanador, esCodigoConsorcio, esPersonaNatural, etapaLabel, motivoLabel, tipoLabel,
  type ContratoDetalle as Detalle,
} from "@/lib/contratos";
import { cn } from "@/lib/utils";
import { tituloNatural } from "@/lib/landing";
import { enlaceProveedor } from "@/lib/empresas";

/** Qué se analiza hoy, tal como lo informa la API (`procesamientoActivo` del resumen de procesamientos). */
export interface AlcanceActivo {
  tipos_activos?: string[];
  etapas_activas?: string[];
  nota?: string;
}

/** Cuántos lleva la pestaña «Antecedentes»: los del ganador y los del proceso (sin los datos del proveedor ni lo posterior). */
function conteoAntecedentes(cruces: Parameters<typeof clasificarCruces>[0]): number {
  const { antecedentes, delProceso } = clasificarCruces(cruces);
  return antecedentes.length + delProceso.length;
}

/** Cifra de cabecera: compacta, como en toda tarjeta (§10.3). En otra moneda, el número entero con su código. */
function cifra(n: number, moneda: string | null): string {
  return moneda && moneda !== "PEN" ? `${moneda} ${numero(n)}` : solesCompacto(n);
}

/** El monto exacto como contexto de la cifra compacta; nada si la compacta ya es exacta. */
function exacto(n: number, moneda: string | null): string | null {
  const completo = monto(n, moneda);
  return completo === cifra(n, moneda) ? null : completo;
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

export function ContratoDetalle({
  c,
  alcance = null,
  catalogo = {},
  seccion,
  relacionados = null,
  entidadEnVigia = null,
  parecidos = null,
  vistas = null,
  desde,
}: {
  c: Detalle;
  /** De dónde vino el usuario (?desde): antepone esa miga para no perder el flujo de navegación. */
  desde?: string;
  /** El selector de vistas del contrato (ficha · dictamen · en vivo): arriba de todo, como en las otras dos vistas. */
  vistas?: ReactNode;
  alcance?: AlcanceActivo | null;
  catalogo?: CatalogoReglas;
  /** Otros contratos de la misma entidad (solo en fichas cortas): hasta 5 y el total de la entidad. */
  relacionados?: Llega<{ contratos: ContratoResumen[]; total: number } | null>;
  /** Cifras de la entidad que contrata (publicados, leídos, riesgo medio o alto, esperando lectura). */
  entidadEnVigia?: Llega<{ total: number; leidos: number; conSenales: number; esperando: number; listos?: number } | null>;
  /** Contratos del mismo tipo en la misma provincia, de otras entidades (con qué comparar este). */
  parecidos?: Llega<{ contratos: ContratoResumen[]; total: number; provincia: string | null } | null>;
  /** La pestaña abierta al cargar (`?seccion=` de la URL). */
  seccion?: string;
}) {
  const regionId = c.ubigeo ? UBIGEO_REGION[c.ubigeo.slice(0, 2)] : undefined;
  const mapaHref = regionId ? `/app/mapa?region=${regionId}&tab=cola${c.ubigeo && c.ubigeo.length === 6 ? `&ubigeo=${c.ubigeo}` : ""}` : "/app/mapa";
  // En revisión humana se dice "En revisión" y nada más (DESIGN_SYSTEM.md §10.4): ni señales ni
  // comparaciones de precio del análisis, que son los montos que la lectura cuestionaría.
  const enRevision = c.alerta?.estado === "revision";
  // Lo adjudicado es la suma de las adjudicaciones VIGENTES del registro (una buena pro que pasó a otro postor no se
  // suma dos veces); el referencial, lo presupuestado.
  const adjudicado = adjudicacionesVigentes(c).reduce((s, a) => s + (a.montoPen ?? 0), 0) || null;
  const cambio = cambioDeGanador(c);
  // El cruce "otro_postor" dice lo mismo que el aviso de cambio de ganador: en la ficha va una sola vez, en el aviso.
  const cruces = (c.cruces ?? []).filter((x) => !(cambio && x.tipo === "otro_postor"));

  const varios = new Set(cruces.map((x) => x.rucProveedor)).size > 1;

  // Lo de la entidad y la provincia llega después (streaming): no frena la ficha. «Mira más contratos de esta entidad»
  // es secundario y va a la pestaña Contratos de su ficha (antes un botón verde a todo el ancho en el Resumen que
  // llevaba a /app/contratos?entidad=, mientras «Ver su ficha», justo al lado, iba a la entidad).
  const otros =
    relacionados && c.entidadRuc ? (
      <Esperar p={relacionados}>
        {(r) => (r && r.contratos.length > 0 ? <OtrosContratosEntidad entidadRuc={c.entidadRuc!} contratos={r.contratos} total={r.total} /> : null)}
      </Esperar>
    ) : null;

  // Las pestañas de evidencia y las del registro del proceso se arman una vez: el estado de la lectura ofrece abrir las
  // que existen (los ítems, el cronograma) y la barra las ordena con `conProceso`.
  const evidencia = pestanasEvidencia({ c, enRevision, catalogo });
  const proceso = pestanasProceso({ c });
  // Leído (con dictamen) y sin procesamiento en vivo: el resultado llena el Resumen y las partes del análisis quedan en la
  // columna lateral. Sin leer, «Qué se leerá» va en el Resumen, bajo el estado.
  const leido = c.estadoProcesamiento === "procesado" && !!c.alerta;
  const cifras = indicadoresDe(c, adjudicado);

  // El Resumen: en qué va su lectura (una franja con qué hacer), los antecedentes de quien ganó en un renglón por tipo
  // (cada uno abre su grupo en la pestaña Antecedentes) y, sin leer, qué partes se leerán. Los antecedentes van antes que
  // «Qué se leerá»: son datos del ganador y la lista de partes es cómo se hará la lectura. Antes, en un contrato sin
  // leer, era un título y una frase gris junto a un filete, y debajo ~350 px de columna vacía.
  const resumen = (
    <div className="space-y-6">
      <AnalisisCard c={c} alcance={alcance} conCronograma={!!proceso.cronograma} />
      {cruces.length > 0 && <ResumenAntecedentes cruces={cruces} varios={varios} />}
      {!c.procesamiento && !leido && <QueSeLeera c={c} />}
    </div>
  );

  const pestanas: Pestana[] = [
    { clave: "resumen", etiqueta: "Resumen", contenido: resumen },
    // El ganador en otros registros (ONPE, JNE, visitas, penalidades, sanciones): datos, no lectura. Su pestaña, con
    // cuántos antecedentes hay (lo que ya había pasado cuando se convocó y es de esta entidad).
    // El conteo, con lo que es del proceso (un solo postor), que va en la misma pestaña bajo «En este proceso».
    ...(cruces.length > 0
      ? [{ clave: "antecedentes", etiqueta: "Antecedentes", conteo: conteoAntecedentes(cruces), contenido: <CrucesProveedor cruces={cruces} varios={varios} gobierna={c.gobierno} /> }]
      : []),
    // Todo en una línea de tiempo (fase 3 del plan del 2026-10-27): el proceso, las visitas del ganador a la entidad, sus
    // antecedentes en la fecha de cada hecho, sus sanciones y la obra. GET /historia/contrato/:ocid, en su propia lectura.
    // Sólo cuando se abre (?seccion=historia): hay cientos de miles de contratos y los buscadores los recorren todos;
    // armarla en cada ficha eran ocho consultas más por visita. Con la pestaña cerrada, el enlace que la abre.
    {
      clave: "historia",
      etiqueta: "Historia",
      icono: <History size={15} aria-hidden />,
      contenido:
        seccion === "historia" ? (
          <Suspense fallback={<Cargando texto="Armando la historia del contrato…" />}>
            <HistoriaFicha tipo="contrato" id={c.ocid} nombre="este contrato" />
          </Suspense>
        ) : (
          <div className="space-y-2 rounded-xl border border-line bg-paper px-4 py-4">
            <p className="text-meta text-inkSoft">
              Una línea de tiempo con el proceso (convocatoria, ofertas, buena pro y contrato), las visitas de la gente del ganador a la
              entidad, sus antecedentes en la fecha de cada hecho, sus sanciones y la obra que ejecuta.
            </p>
            <Link href={rutaContrato(c.ocid, "ficha", { seccion: "historia" })} prefetch={false} className="inline-flex min-h-[32px] items-center gap-1.5 text-meta font-semibold text-granate underline-offset-2 hover:underline">
              <History size={14} aria-hidden /> Ver la historia del contrato
            </Link>
          </div>
        ),
    },
    ...conProceso(evidencia, proceso),
  ];

  return (
    // Envuelve el dossier con el drawer lateral: cualquier componente cliente de adentro (p. ej. una orden del
    // fraccionamiento) puede abrir el detalle a la derecha con useDossierDrawer(), sin salir de la pestaña.
    <DossierDrawerProvider>
      {vistas && <div className="mb-4">{vistas}</div>}
      <Migas
        items={migasConDesde(desde, [{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Contratos", href: "/app/contratos" }, { etiqueta: `Contrato ${c.codigo ?? c.ocid}` }])}
        pestanas={{ primera: "resumen", activa: seccion ?? "resumen", etiquetas: Object.fromEntries(pestanas.map((p) => [p.clave, p.etiqueta])) }}
      />

      <DisclaimerBanner className="mb-4" />

      {/* Dos columnas desde lg: a la izquierda la identidad y las cifras (fila 1) y, justo debajo, las pestañas (fila 2);
          a la derecha, fija al bajar y a lo alto de las dos filas, los datos del proceso, su línea de tiempo y lo de la
          entidad. La segunda fila es `1fr`: si la columna lateral es más alta que las cifras, el sobrante va abajo de
          las pestañas, nunca entre las cifras y las pestañas. En el celular, «quién ganó» y la línea de tiempo van justo
          después de las cifras (se dibujan dos veces, una por ancho, con ids distintos) y lo de la entidad, al final. */}
      <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-1">
          {/* 1. Identidad: qué se contrata, su código, quién compra y dónde; debajo, sus chips. */}
          <div className="space-y-3">
            <EncabezadoPagina titulo={<TituloContrato texto={c.titulo ? oracion(limpiarObjeto(c.titulo)) : "Contrato sin objeto registrado"} />} bajada={<LineaIdentidad c={c} mapaHref={mapaHref} />} />
            <ul className="flex flex-wrap items-center gap-1.5" aria-label="Tipo, etapa y estado de lectura">
              <li><span className="pill border-transparent bg-paperDeep text-ink">{tipoLabel(c.tipo) ?? "Tipo sin clasificar"}</span></li>
              <li><span className="pill border-line text-inkSoft">{etapaLabel(c.etapa) ?? "Etapa sin clasificar"}</span></li>
              {c.modalidad && <li><span className="pill border-line text-inkSoft">{c.modalidad}</span></li>}
              <li>{enRevision ? <EstadoPill estado="revision" /> : <EstadoContratoPill estado={c.estadoProcesamiento} operativo={c.estadoOperativo} />}</li>
              {motivoDudoso(c.datoDudoso?.motivo) && <li><BanderaDato motivo={motivoDudoso(c.datoDudoso?.motivo)!} fuente="oece_ocds" /></li>}
            </ul>
          </div>

          {/* 2. Lo que importa del objeto: cuánto y cuándo. Sólo las cifras que el registro trae son tarjeta; las que
              faltan van nombradas en una línea debajo (antes, sin leer, tres de las cuatro tarjetas decían «Sin dato»). */}
          <div className="space-y-2.5">
            {cifras.tarjetas.length > 0 && (
              <Indicadores
                items={cifras.tarjetas}
                apilado
                // Con tres, la tercera a todo el ancho, como ya pasa en el celular: en dos columnas quedaba media fila
                // vacía a su lado.
                className={cifras.tarjetas.length === 3 ? "[&_dl>div:last-child]:col-span-2" : undefined}
              />
            )}
            <LineaSinDato faltan={cifras.faltan} />
          </div>

          {/* 2'. El OECE publicó un valor que no se puede creer (migración 102): se muestra tal cual, con su aviso. */}
          <AvisoContrato dato={c.datoDudoso} />

          {/* 2a. La buena pro pasó a otro postor (OCDS + CONOSCE): lo que explica cifras que no cuadran. */}
          {cambio && <CambioGanador c={c} cambio={cambio} />}

          {/* 2b. En el celular: quién ganó y cuándo, antes de las pestañas. */}
          <div className="space-y-5 lg:hidden">
            <DatosProceso c={c} idTitulo="datos-proceso-celular" />
            <LineaTiempoProceso c={c} idTitulo="linea-tiempo-celular" />
          </div>
        </div>

        {/* 3. Resumen, antecedentes y evidencia oficial, una pestaña por sección (§14.3), justo después de las cifras. */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <Pestanas fija key={seccion ?? "resumen"} etiqueta="Secciones del contrato" activa={seccion} pestanas={pestanas} />
        </div>

        <aside className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="Datos del proceso y de la entidad">
          <div className="hidden space-y-5 lg:block">
            <DatosProceso c={c} idTitulo="datos-proceso" />
            <LineaTiempoProceso c={c} />
          </div>
          {entidadEnVigia && c.entidadRuc && (
            <Esperar p={entidadEnVigia}>{(e) => (e ? <EntidadEnVigia ruc={c.entidadRuc!} {...e} /> : null)}</Esperar>
          )}
          {otros}
          {/* Con procesamiento en vivo los carriles ya muestran qué agente aplica y cuál se omitió. Sin leer, las partes
              van en el Resumen («Qué se leerá»); aquí quedan sólo las de un contrato ya leído. */}
          {!c.procesamiento && leido && <ClasificacionCard c={c} />}
          {parecidos && (
            <Esperar p={parecidos}>
              {(pr) =>
                pr && pr.contratos.length > 0 && pr.provincia ? (
                  <OtrosContratosEntidad
                    entidadRuc={c.entidadRuc ?? ""}
                    contratos={pr.contratos}
                    total={pr.total}
                    titulo={`${tipoLabel(c.tipo) ?? "Contratos"} de otras entidades de la provincia`}
                    verHref={`/app/contratos?ubigeo=${pr.provincia}&tipo=${c.tipo ?? ""}`}
                    idSeccion="contratos-parecidos"
                  />
                ) : null
              }
            </Esperar>
          )}
        </aside>
      </div>
      {/* Al pie de todo (en el celular, también después de lo de la entidad). */}
      <NotaPrivacidad className="mt-6" />
    </DossierDrawerProvider>
  );
}

/** El objeto del contrato, completo; si es largo (los hay de 300 caracteres) baja de tamaño en vez de ocupar siete líneas. */
function TituloContrato({ texto }: { texto: string }) {
  const largo = texto.length;
  return (
    <span className={largo > 150 ? "block text-bloque leading-snug sm:text-seccion" : largo > 80 ? "block text-seccion leading-snug sm:text-cifra" : undefined}>
      {texto}
    </span>
  );
}

/** Código, entidad y zona en una línea: la bajada del encabezado. */
function LineaIdentidad({ c, mapaHref }: { c: Detalle; mapaHref: string }) {
  const enlace = "inline-flex min-h-6 items-center gap-1.5 text-ink underline-offset-2 hover:text-granate hover:underline";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <Hash size={14} className="shrink-0 text-mute" aria-hidden /> Código SEACE{" "}
        {/* El código abre el proceso en Contrataciones Abiertas del OECE (con el OCID completo: con el código solo, no abre). */}
        <EnlaceFuente href={c.ocid ? procesoOece(c.ocid) : busquedaOece(c.codigo)} className="font-mono text-ink decoration-ink/40 hover:decoration-ink">
          <span translate="no">{c.codigo}</span>
        </EnlaceFuente>
      </span>
      {c.entidadRuc ? (
        <Link href={`/entidad/${c.entidadRuc}`} className={enlace}>
          <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> {c.entidad ? tituloNatural(c.entidad) : c.entidadRuc}
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <Building2 size={14} className="shrink-0 text-mute" aria-hidden /> {c.entidad ? tituloNatural(c.entidad) : "Entidad no identificada"}
        </span>
      )}
      {c.zona && (
        <Link href={mapaHref} className={enlace}>
          <MapPin size={14} className="shrink-0 text-mute" aria-hidden /> {c.zona}
        </Link>
      )}
      <PartidoQueGobierna g={c.gobierno} completo />
    </span>
  );
}

/**
 * Las pestañas de evidencia con las del registro del proceso (ProcesoContrato.tsx) en su lugar: «Participantes» donde
 * irían «Postores y ofertas» (después de Ítems), «Adjudicación y contrato» enseguida, y «Cronograma» antes de los
 * documentos. Sin dictamen la ficha queda: Resumen, Ítems, Participantes, Adjudicación y contrato, Cronograma, Documentos.
 */
function conProceso(evidencia: Pestana[], proceso: ReturnType<typeof pestanasProceso>): Pestana[] {
  const conActas = evidencia.some((p) => p.clave === "postores");
  const out: Pestana[] = [];
  for (const p of evidencia) {
    if (p.clave === "documentos" && proceso.cronograma) out.push(proceso.cronograma);
    out.push(p);
    if (p.clave === (conActas ? "postores" : "items")) {
      if (!conActas && proceso.participantes) out.push(proceso.participantes);
      if (proceso.adjudicacion) out.push(proceso.adjudicacion);
    }
  }
  return out;
}

/**
 * Las cifras del contrato: número compacto → qué es → el monto exacto o la fecha que lo acompaña. Sólo las que tienen
 * valor son tarjeta; las que no, van por su nombre en `faltan` y se dicen juntas en una línea (`LineaSinDato`, la regla
 * de `LineasSinDato` del Inicio). Antes, en un contrato sin leer (casi todos), tres de las cuatro tarjetas decían «Sin
 * dato», «Sin adjudicar» y «Sin dato»: cajas del tamaño de las llenas, sin nada adentro.
 */
function indicadoresDe(c: Detalle, adjudicado: number | null): { tarjetas: Indicador[]; faltan: string[] } {
  const nItems = c.items.length;
  const nAdjudicaciones = adjudicacionesVigentes(c).length;
  const reemplazadas = (c.adjudicaciones ?? []).length - nAdjudicaciones;
  const conOferta = (c.postoresDetalle ?? []).filter((p) => p.montoOferta != null).length;
  const registrados = c.postores ?? ((c.participantes ?? []).filter((p) => p.registrado).length || null);
  const unir = (xs: (string | null | false)[]) => xs.filter(Boolean).join(" ") || undefined;
  const gano = fechaGano(c);
  const tarjetas: Indicador[] = [];
  const faltan: string[] = [];

  if (c.montoPen) {
    tarjetas.push({
      valor: cifra(c.montoPen, c.moneda),
      etiqueta: "valor referencial",
      ayuda: <AyudaTermino clave="valor-referencial" />,
      contexto: unir([exacto(c.montoPen, c.moneda), nItems > 1 && `en ${numero(nItems)} ítems`]),
    });
  } else faltan.push("valor referencial");

  if (adjudicado) {
    tarjetas.push({
      valor: cifra(adjudicado, c.moneda),
      etiqueta: "monto adjudicado",
      ayuda: <AyudaTermino clave="adjudicacion" />,
      contexto: unir([
        exacto(adjudicado, c.moneda),
        nAdjudicaciones > 1 && `en ${numero(nAdjudicaciones)} adjudicaciones`,
        reemplazadas > 0 && `(sin la${reemplazadas > 1 ? "s" : ""} buena${reemplazadas > 1 ? "s" : ""} pro reemplazada${reemplazadas > 1 ? "s" : ""})`,
      ]),
    });
  } else faltan.push("monto adjudicado");

  // Las fechas con el año, también las de este: un proceso convocado en diciembre se adjudica en enero, y «4 ene.» al
  // lado de «20 dic. 2025» no decía de qué año era.
  if (c.fecha) {
    tarjetas.push({
      valor: fechaConAnio(c.fecha),
      etiqueta: "convocatoria",
      ayuda: <AyudaTermino clave="convocatoria" />,
      // Sin fecha de buena pro en el registro, la de la adjudicación: la misma de la línea de tiempo y de «cuando ganó» en
      // los antecedentes (antes la cifra decía «sin fecha» al lado de una adjudicación con fecha).
      contexto: gano ? `${gano.deAdjudicacion ? "adjudicada el" : "buena pro:"} ${fechaConAnio(gano.fecha)}` : "buena pro: sin fecha",
    });
  } else if (gano) {
    // Sin fecha de convocatoria, la de la buena pro (o la de la adjudicación) es la cifra: es la única fecha que hay.
    tarjetas.push({
      valor: fechaConAnio(gano.fecha),
      etiqueta: gano.deAdjudicacion ? "adjudicación" : "buena pro",
      ayuda: gano.deAdjudicacion ? undefined : <AyudaTermino clave="buena-pro" />,
      contexto: "convocatoria: sin fecha",
    });
  } else faltan.push("fecha de convocatoria");

  if (registrados != null) {
    tarjetas.push({
      // Los que se REGISTRARON (el OCDS los llama «tenderers»); los que ofertaron van debajo. Antes decía «17 postores»
      // de un proceso en que ofertaron 3.
      valor: numero(registrados),
      etiqueta: registrados === 1 ? "participante" : "participantes",
      ayuda: <AyudaTermino clave="participante" />,
      contexto: c.ofertas != null
        ? plural(c.ofertas, "oferta", "ofertas")
        : conOferta > 0 ? `${numero(conOferta)} con oferta leída del expediente` : "ofertas: sin dato",
    });
  } else if (c.ofertas != null) {
    // Sin los registrados, los que presentaron oferta según CONOSCE (los postores): la cifra que hay.
    tarjetas.push({
      valor: numero(c.ofertas),
      etiqueta: c.ofertas === 1 ? "postor" : "postores",
      ayuda: <AyudaTermino clave="postor" />,
      contexto: "participantes: sin dato",
    });
  } else faltan.push("participantes");

  return { tarjetas, faltan };
}

/**
 * Las cifras que el registro todavía no trae, nombradas juntas en una línea debajo de las tarjetas (como `LineasSinDato`
 * en el Inicio de una ficha): un «Sin dato» no merece una tarjeta del tamaño de una cifra.
 */
function LineaSinDato({ faltan }: { faltan: string[] }) {
  if (!faltan.length) return null;
  return (
    <p className="flex items-start gap-2 text-meta leading-snug text-mute">
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="font-semibold text-inkSoft">Sin dato todavía:</span> {listaY(faltan)}.
      </span>
    </p>
  );
}

/** Datos del proceso (columna lateral, §14.2): quién ganó, la descripción y los códigos del registro. */
function DatosProceso({ c, idTitulo }: { c: Detalle; idTitulo: string }) {
  // Si la buena pro pasó a otro postor, "quién ganó" es con quien quedó (CONOSCE), no la primera adjudicación del OCDS.
  const queda = cambioDeGanador(c)?.queda[0];
  const proveedor = queda?.proveedor ?? c.proveedor;
  const proveedorRuc = queda?.proveedorRuc ?? c.proveedorRuc;
  const natural = esPersonaNatural(proveedorRuc);
  // Un consorcio sin RUC propio llega con el código del SEACE (1830304): se dice así, y quiénes lo forman (antes «RUC
  // 1830304», sin integrantes ni enlace).
  const codigoConsorcio = esCodigoConsorcio(proveedorRuc) ? proveedorRuc : null;
  const integrantes = codigoConsorcio ? (c.participantes ?? []).find((p) => p.ruc === codigoConsorcio)?.integrantes ?? [] : [];
  const descripcion = c.descripcion && c.descripcion !== c.titulo ? c.descripcion : null;
  return (
    <div className="rounded-2xl border border-line bg-paper">
      <h2 id={idTitulo} className="px-4 pt-3.5 font-display text-bloque font-bold text-ink">
        Datos del proceso
      </h2>
      <dl className="space-y-3 px-4 pb-3.5 pt-2.5 text-dato leading-5">
        <Dato k="Quién ganó">
          {proveedor ? (
            <>
              {/* El proveedor del OCDS viene en orden SUNAT (apellidos primero). */}
              <span className="font-semibold">{natural ? <PersonName name={proveedor} orden="sunat" /> : proveedor}</span>
              {codigoConsorcio ? (
                <span className="flex items-center gap-1 font-mono text-rotulo text-mute">
                  Código del consorcio {codigoConsorcio}
                  <Ayuda titulo="¿Por qué no tiene RUC?">
                    Un consorcio se forma para participar en un proceso y no tiene RUC propio: el SEACE le da este código. Sus
                    integrantes sí tienen RUC, y cada empresa su ficha en Vigía.
                  </Ayuda>
                </span>
              ) : (
                proveedorRuc && (
                  <span className="block font-mono text-rotulo text-mute">
                    RUC <Ruc value={proveedorRuc} />
                  </span>
                )
              )}
              {queda && <span className="block text-rotulo text-mute">Se le adjudicó después de otro postor (CONOSCE)</span>}
              {enlaceProveedor(proveedorRuc) && (
                <Link href={enlaceProveedor(proveedorRuc)!} className="mt-1 inline-block text-meta font-semibold text-granate underline-offset-2 hover:underline">
                  Ver la ficha de la empresa
                </Link>
              )}
            </>
          ) : (
            <span className="text-mute">Sin adjudicar todavía</span>
          )}
        </Dato>
        {codigoConsorcio && (
          <Dato k="Integrantes del consorcio">
            {integrantes.length ? (
              <ul className="space-y-1.5">
                {integrantes.map((x) => (
                  <li key={x.ruc}>
                    {/* Una empresa, con el enlace a su ficha; una persona natural, tapada y sin enlace. */}
                    {enlaceProveedor(x.ruc) ? (
                      <Link href={enlaceProveedor(x.ruc)!} className="font-semibold text-granate underline-offset-2 hover:underline">
                        {x.nombre ?? `RUC ${x.ruc}`}
                      </Link>
                    ) : (
                      <span className="font-semibold">{x.nombre ? (esPersonaNatural(x.ruc) ? <PersonName name={x.nombre} orden="sunat" /> : x.nombre) : "Sin razón social"}</span>
                    )}
                    <span className="block font-mono text-rotulo text-mute">
                      {esPersonaNatural(x.ruc) ? "Persona natural" : <>RUC <Ruc value={x.ruc} /></>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-mute">CONOSCE todavía no publica sus integrantes</span>
            )}
          </Dato>
        )}
        {descripcion && (
          <Dato k="Descripción">
            {/* div y no span: la descripción larga se pliega en un <details>. */}
            <div className="text-meta leading-relaxed">
              <Descripcion texto={descripcion} />
            </div>
          </Dato>
        )}
        {c.nomenclatura && (
          <Dato k="Nomenclatura">
            <span className="break-all font-mono text-meta">{c.nomenclatura}</span>
          </Dato>
        )}
        {c.ocid !== c.codigo && (
          <Dato k="OCID">
            <span className="break-all font-mono text-meta text-inkSoft">{c.ocid}</span>
          </Dato>
        )}
      </dl>
      <FuenteDato fuente={OCDS} enlaces={enlacesProceso(c.ocid, { codigo: c.codigo, json: true, conosce: true })} className="border-t border-line px-4 py-2" />
    </div>
  );
}

function Dato({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-rotulo text-mute">{k}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

// ─── Estado de la lectura ────────────────────────────────────────────────────

const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** "Hoy se analizan contratos de bienes en etapa adjudicada, contratada…" + la nota de la API. Null si la API no dijo nada. */
function alcanceTexto(a: AlcanceActivo | null): string | null {
  if (!a) return null;
  const tipos = (a.tipos_activos ?? []).map((t) => tipoLabel(t)?.toLowerCase() ?? t.replace(/_/g, " "));
  const etapas = (a.etapas_activas ?? []).map((e) => etapaLabel(e)?.toLowerCase() ?? e.replace(/_/g, " "));
  const partes: string[] = [];
  if (tipos.length) partes.push(`Hoy se analizan contratos de ${lista(tipos)}${etapas.length ? ` en etapa ${lista(etapas)}` : ""}.`);
  if (a.nota) partes.push(a.nota.trim().replace(/([^.])$/, "$1."));
  return partes.length ? partes.join(" ") : null;
}

/**
 * El estado de la lectura en una `Franja` del kit: el ícono en su placa, el título, una frase con su ⓘ (el porqué y el
 * cuándo, §10.7) y qué hacer (financiarla, o abrir lo que el registro ya trae). Antes era un título y una frase gris junto
 * a un filete, sin caja para no dibujar una tarjeta alta y vacía; la franja es la caja de dos líneas: da forma sin sumar
 * alto. El título de la franja no es un encabezado: el h2 oculto nombra la sección para el lector de pantalla.
 */
function FranjaEstado({
  icono,
  titulo,
  ayuda,
  nota,
  acciones = [],
  children,
}: {
  icono: ReactNode;
  titulo: string;
  ayuda?: ReactNode;
  /** Una línea más chica debajo de la frase: lo que le falta al registro, el pedido de descarga. */
  nota?: ReactNode;
  /** Botones ya armados (con `key`); los vacíos se descartan. */
  acciones?: ReactNode[];
  children: ReactNode;
}) {
  // La franja lleva uno o dos botones: el primero es el que importa (financiar, si se puede).
  const botones = acciones.filter(Boolean).slice(0, 2);
  return (
    <section aria-labelledby="estado-lectura">
      <h2 id="estado-lectura" className="sr-only">
        Estado de la lectura
      </h2>
      <Franja
        apilada
        // Ícono y texto en una fila y los botones debajo, a todo el ancho: la columna de la ficha es angosta (316 px a
        // 1024) y en una sola fila los botones apretaban el texto; `apilada` sola ponía el ícono en un renglón propio.
        className="sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4"
        icono={icono}
        titulo={titulo}
        accion={
          botones.length ? (
            // En el celular, uno debajo del otro y a todo el ancho; desde sm, en fila con su ancho y alineados a la
            // izquierda. La caja de afuera es de bloque: la franja centra a sus hijos (`[&>*]:justify-center`) y, si los
            // botones bajaban de renglón, quedaban centrados.
            <div className="max-w-full">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{botones}</div>
            </div>
          ) : undefined
        }
      >
        {children}
        {ayuda && <span className="ml-1 inline-flex align-middle">{ayuda}</span>}
        {nota && <span className="mt-1 block text-meta">{nota}</span>}
      </Franja>
    </section>
  );
}

/**
 * Lo que el registro ya trae mientras la lectura espera: los ítems y el cronograma, pestañas de esta misma ficha que se
 * abren sin recargar (`BotonPestana`). Sólo las que existen y tienen algo: un botón que no lleva a nada no va (§14.3).
 */
function accionesRegistro(c: Detalle, conCronograma: boolean): ReactNode[] {
  const clase = claseAccion("secundario");
  const out: ReactNode[] = [];
  if (c.items.length > 0) {
    out.push(
      <BotonPestana key="items" clave="items" className={clase}>
        <Package size={16} aria-hidden /> {c.items.length === 1 ? "Ver el ítem" : `Ver los ${numero(c.items.length)} ítems`}
      </BotonPestana>,
    );
  }
  if (conCronograma) {
    out.push(
      <BotonPestana key="cronograma" clave="cronograma" className={clase}>
        <CalendarRange size={16} aria-hidden /> Ver el cronograma
      </BotonPestana>,
    );
  }
  return out;
}

function AnalisisCard({ c, alcance, conCronograma }: { c: Detalle; alcance: AlcanceActivo | null; conCronograma: boolean }) {
  const estado = c.estadoProcesamiento;
  const registro = accionesRegistro(c, conCronograma);
  const falta = faltaParaLeer(c.clasificacion.validacionesPendientes);

  if (estado === "procesado" && c.alerta) {
    // Con procesamiento financiado, ContratoEnVivo (compacto) trae resultado + cómo se ejecutó (carriles + bitácora).
    if (c.procesamiento) {
      return <ContratoEnVivo ocid={c.ocid} initial={{ ...c.procesamiento, eventos: [], resultado: c.alerta }} compacto />;
    }
    // La tarjeta ocupa la columna principal: la versión ancha pone el puntaje junto al resumen.
    return (
      <div className="space-y-2">
        <ResultadoAnalisis resultado={c.alerta} ocid={c.ocid} sharePath={`/app/contratos/${encodeURIComponent(c.ocid)}`} />
        {c.alerta.analizadoEn && <p className="text-rotulo text-mute">Leído el {fecha(dia(c.alerta.analizadoEn))}</p>}
      </div>
    );
  }

  if (estado === "esperando_documentos") {
    return (
      <FranjaEstado
        icono={<Clock size={18} aria-hidden />}
        titulo="Esperando documentos"
        ayuda={
          <Ayuda titulo="¿Cuándo se lee?">
            El lote nocturno baja los documentos desde el SEACE y la lectura arranca al día siguiente.
          </Ayuda>
        }
        nota={
          c.pedidoDescarga
            ? `Pedido ${c.pedidoDescarga.estado === "descargando" ? "en descarga" : "en cola para esta noche"}, solicitado el ${fechaCorta(dia(c.pedidoDescarga.solicitadoAt))}.`
            : null
        }
        acciones={registro}
      >
        Ya financiado; sus documentos {c.documentosEnVigia?.n ? "expiraron en el almacén de Vigía" : "todavía no se descargaron"}.
      </FranjaEstado>
    );
  }

  if ((estado === "procesando" || estado === "encolado" || estado === "error") && c.procesamiento) {
    return <ContratoEnVivo ocid={c.ocid} initial={{ ...c.procesamiento, eventos: [] }} compacto />;
  }

  if (estado === "pendiente_de_procesamiento" || c.procesable === false) {
    const motivo = c.clasificacion.motivoNoProcesable;
    return (
      <FranjaEstado
        icono={<Clock size={18} aria-hidden />}
        titulo="Pendiente de procesamiento"
        ayuda={
          <Ayuda titulo="¿Qué pasa después?">
            Cuando el proceso avance de etapa o se pueda leer este tipo de contrato, entrará a la cola de lectura, donde
            lo más grave va primero.
          </Ayuda>
        }
        nota={falta}
        acciones={registro}
      >
        {/* Sin motivo, `motivoLabel` devolvía el mismo «Pendiente de procesamiento» del título. */}
        {motivo ? `${oracion(motivoLabel(motivo))}.` : "Todavía no se puede leer."}
      </FranjaEstado>
    );
  }

  // Migración 19: tipo/etapa fuera del alcance activo → decir qué hay, sin CTA de financiar.
  if (c.estadoOperativo && c.estadoOperativo !== "en_cola") {
    const listo = c.estadoOperativo === "documentos_listos";
    const tipo = tipoLabel(c.tipo)?.toLowerCase() ?? "este tipo de contratación";
    // El alcance de hoy sale de la API (`procesamientoActivo`), no de una frase escrita a mano.
    const hoy = alcanceTexto(alcance);
    return (
      <FranjaEstado
        icono={listo ? <FileCheck size={18} className="text-mossTexto" aria-hidden /> : <Clock size={18} aria-hidden />}
        titulo={listo ? "Documentos listos para leerse" : "Lectura en preparación"}
        nota={falta}
        acciones={registro}
        ayuda={
          <Ayuda titulo="¿Qué se analiza hoy?">
            {listo && (
              <span className="block">
                Sus documentos ya están descargados y clasificados: cuando se active la lectura de {tipo} en esta etapa,
                entrará a la cola de lectura, donde lo más grave va primero.
              </span>
            )}
            {hoy && <span className={cn("block", listo && "mt-2")}>{hoy}</span>}
            {!listo && !hoy && <span className="block">Cuando se active, entrará a la cola de lectura, donde lo más grave va primero.</span>}
          </Ayuda>
        }
      >
        La lectura de {tipo} en esta etapa todavía no está activa.
      </FranjaEstado>
    );
  }

  // sin_analizar (o procesado sin alerta legible). No es una advertencia: "sin leer" es el estado mayoritario (así se
  // pinta en la píldora de la lista y en la leyenda del mapa); por eso un reloj de arena y no el escudo de alerta.
  return (
    <FranjaEstado
      icono={<Hourglass size={18} aria-hidden />}
      titulo="Todavía sin leer"
      ayuda={
        <Ayuda titulo="¿Cuándo se lee?">
          Vigía lee la cola con el fondo común que sostienen sus aliados: lo más grave va primero (los contratos cuyo
          ganador tiene antecedentes graves), aporte quien aporte. Ningún aporte elige qué contrato se lee.
        </Ayuda>
      }
      nota={falta}
      acciones={[
        // El aporte va al fondo común (migración 206): la entidad sólo dice qué te trajo, no elige qué se lee.
        <EnlaceAccion
          key="apoyar"
          href={c.entidadRuc && c.entidad ? `/app/apoyar?para=${c.entidadRuc}&nombre=${encodeURIComponent(tituloNatural(c.entidad))}` : "/app/apoyar"}
          flecha
        >
          Ayúdanos a seguir vigilando
        </EnlaceAccion>,
        ...registro,
      ]}
    >
      Espera en la cola de lectura.
    </FranjaEstado>
  );
}

/**
 * Qué se leerá: las partes del análisis que aplican a este contrato, en el orden en que corren, con el dictamen al final
 * (lo que publica la lectura). Antes iban en la columna lateral como píldoras sueltas («Qué partes del análisis
 * aplican»); ahora van en el Resumen, bajo el estado, como una secuencia numerada unida por una línea (la misma forma de
 * la línea de tiempo del proceso). Sin ninguna no se dibuja: el estado ya dice por qué no se lee.
 */
function QueSeLeera({ c }: { c: Detalle }) {
  const aplican = c.clasificacion.agentesAplicables ?? [];
  // FASES ya viene en el orden del pipeline, con el dictamen (report_writer) al final.
  const fases = FASES.filter((f) => aplican.includes(f.key));
  if (!fases.length) return null;
  return (
    <section aria-labelledby="que-se-leera" className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex items-center gap-1.5">
        <h2 id="que-se-leera" className="font-display text-bloque font-bold text-ink">
          Qué se leerá
        </h2>
        <Ayuda titulo="¿Por qué estas partes?">
          Dependen del tipo de contrato y de su etapa. Las que no aparecen no aplican a este contrato.
        </Ayuda>
      </div>
      <ol className="mt-3">
        {fases.map((f, i) => {
          const ultimo = i === fases.length - 1;
          const dictamen = f.key === "report_writer";
          return (
            <li key={f.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
              {/* El número del paso y, hasta el siguiente, la línea que los une; el dictamen, con su ícono y en granate. */}
              <span aria-hidden className="relative flex justify-center">
                <span
                  className={cn(
                    "relative z-10 flex h-6 w-6 items-center justify-center rounded-full font-mono text-rotulo font-semibold tabular-nums",
                    dictamen ? "bg-granate text-paper" : "border border-line bg-paperSoft text-inkSoft",
                  )}
                >
                  {dictamen ? <FileText size={13} /> : i + 1}
                </span>
                {!ultimo && <span className="absolute bottom-0 top-6 w-px bg-line" />}
              </span>
              <span className={cn("min-w-0 pt-0.5 text-dato leading-5 text-ink", dictamen && "font-semibold", !ultimo && "pb-3")}>{f.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ClasificacionCard({ c }: { c: Detalle }) {
  const agentes = c.clasificacion.agentesAplicables;
  if (!agentes?.length && !c.clasificacion.clasificadoAt) return null;
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1">
        <h2 className="font-display text-bloque font-bold text-ink">Qué partes del análisis aplican</h2>
        <Ayuda titulo="¿Por qué estas partes?">
          Dependen del tipo de contrato y de su etapa. Las que no aparecen no aplican a este contrato.
        </Ayuda>
      </div>
      {agentes?.length ? (
        <ul className="flex flex-wrap gap-1">
          {FASES.filter((f) => agentes.includes(f.key)).map((f) => (
            <li key={f.key} className="pill border-line bg-paper text-ink">{f.label}</li>
          ))}
        </ul>
      ) : (
        <p className="text-rotulo text-mute">Ninguna para esta combinación de tipo y etapa.</p>
      )}
    </section>
  );
}

/**
 * Lo que le falta al registro para poder leerlo, en palabras del ciudadano. Las validaciones internas de la lectura
 * («proveedor_sin_ruc» de un consorcio, el avance de INFOBRAS, ítems sin precio de mercado) no se muestran: son la cocina
 * (DESIGN_SYSTEM.md §12) y nadie puede hacer nada con ellas. Antes la ficha decía «Validaciones pendientes: proveedor sin
 * ruc» debajo de un contrato ganado por un consorcio.
 */
const FALTA_PARA_LEER: Record<string, string> = {
  sin_documentos_descargables: "El SEACE todavía no publica documentos descargables de este proceso, y sin ellos no se puede leer.",
  document_parser: "El SEACE todavía no publica documentos descargables de este proceso, y sin ellos no se puede leer.",
};

/** Ese texto, o null: va como `nota` de la franja del estado (texto y no un `<p>`, porque la frase ya es un párrafo). */
function faltaParaLeer(v: string[] | null): string | null {
  const textos = [...new Set((v ?? []).map((x) => FALTA_PARA_LEER[x]).filter((x): x is string => !!x))];
  return textos.length ? textos.join(" ") : null;
}

/**
 * La descripción del registro, que a veces es un párrafo entero. Hasta ~2 líneas
 * se muestra tal cual; más larga, el comienzo y "Ver completa" (§10.7): el dato
 * sigue ahí, a un clic, sin empujar el resto hacia abajo.
 */
function Descripcion({ texto }: { texto: string }) {
  if (texto.length <= 180) return <>{texto}</>;
  return (
    // Grupo con nombre: un `group` sin nombre reaccionaría al [open] de cualquier ancestro.
    <details className="group/desc">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="group-open/desc:hidden">{recortar(texto, 150)} </span>
        <span className="text-rotulo font-medium text-granate underline-offset-2 hover:underline">
          <span className="group-open/desc:hidden">Ver completa</span>
          <span className="hidden group-open/desc:inline">Ocultar</span>
        </span>
      </summary>
      <span className="mt-1 block">{texto}</span>
    </details>
  );
}

/**
 * La buena pro pasó a otro postor sobre los mismos ítems: el OCDS guarda las dos adjudicaciones y CONOSCE registra a
 * quién se le adjudicó al final. Pasa cuando el ganador no firma o pierde la buena pro y se adjudica al siguiente en el
 * orden de prelación, con su propia oferta. Es un dato, no una conclusión.
 */
function CambioGanador({ c, cambio }: { c: Detalle; cambio: NonNullable<ReturnType<typeof cambioDeGanador>> }) {
  const { original, queda, diferencia, porcentaje } = cambio;
  // Una empresa (RUC 20) lleva a su ficha: ver quién era el primero y quién quedó sin tener que buscarlos. Una persona
  // natural va tapada y sin enlace (su RUC lleva el DNI); un consorcio sin RUC propio, sin enlace.
  const nombre = (a: { proveedor: string | null; proveedorRuc: string | null }) => {
    if (!a.proveedor) return "otro postor";
    if (esPersonaNatural(a.proveedorRuc)) return <PersonName name={a.proveedor} orden="sunat" />;
    const ficha = enlaceProveedor(a.proveedorRuc);
    return ficha ? (
      <Link href={ficha} prefetch={false} className="text-granate underline-offset-2 hover:underline">
        {a.proveedor}
      </Link>
    ) : (
      a.proveedor
    );
  };
  const sube = diferencia != null && diferencia > 0;
  return (
    <section aria-labelledby="cambio-ganador" className={cn("rounded-2xl border bg-paper px-4 py-3.5", sube ? "border-amber/40" : "border-line")}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="cambio-ganador" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
          <ShieldAlert size={16} className={sube ? "text-amberTexto" : "text-mute"} aria-hidden />
          La buena pro pasó a otro postor
        </h2>
        <Ayuda titulo="¿Por qué hay dos adjudicaciones?">
          El registro OCDS guarda la buena pro original y la que la reemplazó sobre los mismos ítems; CONOSCE registra a quién se
          le adjudicó al final. Suele pasar cuando el ganador no firma el contrato o pierde la buena pro y se adjudica al siguiente
          postor, con su propia oferta. El motivo está en el expediente.
        </Ayuda>
      </div>
      <p className="mt-2 text-dato leading-5 text-ink">
        La buena pro fue primero para <span className="font-semibold">{nombre(original)}</span>
        {original.montoPen != null && <> por {monto(original.montoPen, c.moneda)}</>}; según CONOSCE quedó con{" "}
        {queda.map((q, i) => (
          <span key={q.id ?? i}>
            {i > 0 && ", "}
            <span className="font-semibold">{nombre(q)}</span>
            {q.montoPen != null && <> por {monto(q.montoPen, c.moneda)}</>}
          </span>
        ))}
        {diferencia != null && diferencia !== 0 && (
          <>
            : <span className={cn("font-semibold", sube && "text-amberTexto")}>{sube ? "+" : "−"}{monto(Math.abs(diferencia), c.moneda)}</span>
            {porcentaje != null && <> ({sube ? "+" : "−"}{numero(Math.abs(Math.round(porcentaje)))} %)</>}
          </>
        )}
        .
      </p>
      <FuenteDato fuente="registro OCDS del OECE y las adjudicaciones de CONOSCE" enlaces={enlacesProceso(c.ocid, { codigo: c.codigo, conosce: true })} className="mt-1.5" />
    </section>
  );
}

/** Un dato que puede llegar ya resuelto o como promesa (se pinta por streaming cuando llega). */
type Llega<T> = T | Promise<T>;

/** Pinta `children(valor)` cuando la promesa se resuelve, dentro de su propio <Suspense> (sin esqueleto: es apoyo). */
function Esperar<T>({ p, children }: { p: Llega<T>; children: (v: T) => ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Resuelto p={p}>{children}</Resuelto>
    </Suspense>
  );
}

async function Resuelto<T>({ p, children }: { p: Llega<T>; children: (v: T) => ReactNode }) {
  return <>{children(await p)}</>;
}
