/**
 * La vista «Ficha» de la página de un contrato (DESIGN_SYSTEM.md §14.2), bajo su cabecera única (CabeceraContrato: el
 * objeto, quién compra y quién ganó, el estado, las banderas y las cifras, igual en la ficha, el dictamen y cómo se
 * leyó). Aquí sólo lo que es de la ficha, en dos columnas desde lg:
 *   pestañas (§14.3): Resumen (el estado de su lectura en una franja con qué hacer y, sin leer, qué se leerá en una fila
 *   de pasos dentro de la misma franja; los antecedentes del ganador en un renglón por tipo, si la cabecera no los lleva
 *   como banderas) | Antecedentes | Historia | Ítems | Participantes (sin dictamen) o Postores y ofertas (las actas
 *   leídas) | Adjudicación y contrato | Precio contratado | Dónde dice cada señal | Cronograma | Documentos oficiales,
 *   cada una con su conteo y su fuente al pie;
 *   columna lateral: Datos del proceso (el objeto entero, el RUC o el consorcio ganador, los códigos), la entidad en
 *   Vigía y contratos parecidos de la provincia. La línea de tiempo va en el Resumen.
 *
 * Antes la ficha tenía su propia cabecera (otra que la del dictamen) y, en el celular, «Datos del proceso» y la línea de
 * tiempo iban ANTES de las pestañas: 4.4 pantallas hasta el pie (auditoría del 2026-11-13). Ahora van después, en la
 * columna lateral, y quién ganó está en la cabecera.
 *
 * Server component; `ContratoEnVivo` y `Redact` son islas de cliente.
 */

import Link from "next/link";
import { rutaApoyar, rutaContrato } from "@/lib/rutas";
import { Suspense, type ReactNode } from "react";
import { CalendarRange, Clock, FileCheck, FileText, History, Hourglass, Package, Workflow } from "lucide-react";
import { ContratoEnVivo } from "@/components/auditoria/ContratoEnVivo";
import { ResultadoAnalisis } from "@/components/auditoria/ResultadoAnalisis";
import { PersonName, Ruc } from "@/components/Redact";
import { Ayuda, Cargando, Franja, FuenteDato, Pestanas, type Pestana } from "@/components/patrones";
import { HistoriaFicha } from "@/components/historia/HistoriaFicha";
import { enlacesProceso } from "@/lib/fuentes";
import { EnlaceAccion, claseAccion } from "@/components/ui/EnlaceAccion";
import { BotonPestana } from "./BotonPestana";
import { OCDS, dia, pestanasEvidencia } from "./EvidenciaContrato";
import { pestanasProceso } from "./ProcesoContrato";
import { recortar } from "./recortar";
import { OtrosContratosEntidad } from "./OtrosContratosEntidad";
import { LineaTiempoProceso } from "./LineaTiempoProceso";
import { EntidadEnVigia } from "./EntidadEnVigia";
import { CrucesProveedor, ResumenAntecedentes, clasificarCruces } from "./CrucesProveedor";
import { DossierDrawerProvider } from "./DossierDrawer";
import { objetoLargo } from "./CabeceraContrato";
import type { LecturaContrato } from "./lecturaContrato";
import type { ContratoResumen } from "@/lib/contratos";
import { FASES } from "@/lib/auditoria";
import type { CatalogoReglas } from "@/lib/revision";
import { fecha, fechaCorta, numero, oracion } from "@/lib/formato";
import {
  cambioDeGanador, esCodigoConsorcio, esPersonaNatural, etapaLabel, motivoLabel, tipoLabel,
  type ContratoDetalle as Detalle,
} from "@/lib/contratos";
import { cn } from "@/lib/utils";
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

/** Las pestañas de la ficha con su nombre (la ruta de navegación de la cabecera dice la abierta). */
export const ETIQUETAS_FICHA: Record<string, string> = {
  resumen: "Resumen",
  antecedentes: "Antecedentes",
  historia: "Historia",
  items: "Ítems",
  participantes: "Participantes",
  perfil: "Perfil del contratista",
  postores: "Postores y ofertas",
  adjudicacion: "Adjudicación y contrato",
  precios: "Precio contratado",
  citas: "Dónde dice cada señal",
  cronograma: "Cronograma",
  documentos: "Documentos oficiales",
};

// ─── Ficha ───────────────────────────────────────────────────────────────────

export function ContratoDetalle({
  c,
  lectura = null,
  antecedentesArriba = false,
  alcance = null,
  catalogo = {},
  seccion,
  relacionados = null,
  entidadEnVigia = null,
  parecidos = null,
}: {
  c: Detalle;
  /** Lo que encontró la lectura, contado una vez para toda la página (lecturaContrato.ts). */
  lectura?: LecturaContrato | null;
  /** La cabecera ya lleva los antecedentes de quien ganó como banderas: el Resumen no los repite. */
  antecedentesArriba?: boolean;
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
  // En revisión humana se dice "En revisión" y nada más (DESIGN_SYSTEM.md §10.4): ni señales ni
  // comparaciones de precio del análisis, que son los montos que la lectura cuestionaría.
  const enRevision = c.alerta?.estado === "revision";
  const cambio = cambioDeGanador(c);
  // El cruce "otro_postor" dice lo mismo que el aviso de cambio de ganador: en la ficha va una sola vez, en el aviso.
  const cruces = (c.cruces ?? []).filter((x) => !(cambio && x.tipo === "otro_postor"));

  const varios = new Set(cruces.map((x) => x.rucProveedor)).size > 1;

  // Lo de la entidad y la provincia llega después (streaming): no frena la ficha. «Mira más contratos de esta entidad»
  // sólo se dibuja si «Esta entidad en Vigía» no llega: esa placa ya lleva el mismo enlace, con cuántos son.
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

  // El Resumen: en qué va su lectura (una franja con qué hacer), la línea de tiempo del proceso y los antecedentes de
  // quien ganó en un renglón por tipo (cada uno abre su grupo en la pestaña Antecedentes), si la cabecera no los lleva ya
  // como banderas. La línea de tiempo iba en la columna lateral, que quedaba el doble de alta que el Resumen.
  const resumen = (
    <div className="space-y-6">
      <AnalisisCard c={c} lectura={lectura} alcance={alcance} conCronograma={!!proceso.cronograma} />
      <LineaTiempoProceso c={c} />
      {cruces.length > 0 && !antecedentesArriba && <ResumenAntecedentes cruces={cruces} varios={varios} />}
    </div>
  );

  const pestanas: Pestana[] = [
    { clave: "resumen", etiqueta: ETIQUETAS_FICHA.resumen, contenido: resumen },
    // El ganador en otros registros (ONPE, JNE, visitas, penalidades, sanciones): datos, no lectura. Su pestaña, con
    // cuántos antecedentes hay (lo que ya había pasado cuando se convocó y es de esta entidad, y lo del proceso).
    ...(cruces.length > 0
      ? [{ clave: "antecedentes", etiqueta: ETIQUETAS_FICHA.antecedentes, conteo: conteoAntecedentes(cruces), contenido: <CrucesProveedor cruces={cruces} varios={varios} gobierna={c.gobierno} /> }]
      : []),
    // Todo en una línea de tiempo: el proceso, las visitas del ganador a la entidad, sus antecedentes en la fecha de cada
    // hecho, sus sanciones y la obra. GET /historia/contrato/:ocid, sólo cuando se abre (?seccion=historia): armarla en
    // cada ficha eran ocho consultas más por visita. Con la pestaña cerrada, el enlace que la abre.
    {
      clave: "historia",
      etiqueta: ETIQUETAS_FICHA.historia,
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
    // Envuelve la ficha con el drawer lateral: cualquier componente cliente de adentro (p. ej. una orden del
    // fraccionamiento) puede abrir el detalle a la derecha con useDossierDrawer(), sin salir de la pestaña.
    <DossierDrawerProvider>
      {/* Dos columnas desde lg: las pestañas a la izquierda y, a la derecha, fija al bajar, los datos del proceso, su
          línea de tiempo y lo de la entidad. En el celular, la columna lateral va después de las pestañas. */}
      <div className="grid items-start gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Pestanas fija key={seccion ?? "resumen"} etiqueta="Secciones del contrato" activa={seccion} pestanas={pestanas} />
        </div>

        <aside className="min-w-0 space-y-5 lg:sticky lg:top-4" aria-label="Datos del proceso y de la entidad">
          <DatosProceso c={c} idTitulo="datos-proceso" />
          {/* «Esta entidad en Vigía» ya lleva el enlace a sus contratos: «Mira más contratos de esta entidad» va sólo si
              esa placa no llega (pedido del usuario del 2026-11-05). */}
          {entidadEnVigia && c.entidadRuc ? (
            <Esperar p={entidadEnVigia}>{(e) => (e ? <EntidadEnVigia ruc={c.entidadRuc!} {...e} /> : otros)}</Esperar>
          ) : (
            otros
          )}
          {/* «Qué partes del análisis aplican» ya no va aquí: lo dice la vista «Trazabilidad», con cada parte en su orden y
              lo que hizo. */}
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
    </DossierDrawerProvider>
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
 * Datos del proceso (columna lateral, §14.2): el objeto entero (la cabecera lo recorta), el RUC de quien ganó o los
 * integrantes del consorcio, la descripción y los códigos del registro. El nombre de quien ganó ya está en la cabecera
 * (antes iba aquí y en la cabecera del dictamen, cada uno a su manera).
 */
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
  const objeto = objetoLargo(c);
  return (
    <div className="rounded-2xl border border-line bg-paper">
      <h2 id={idTitulo} className="px-4 pt-3.5 font-display text-bloque font-bold text-ink">
        Datos del proceso
      </h2>
      <dl className="space-y-3 px-4 pb-3.5 pt-2.5 text-dato leading-5">
        {objeto && (
          <Dato k="Objeto, completo">
            <span className="text-meta leading-relaxed">{objeto}</span>
          </Dato>
        )}
        {/* Una empresa: su RUC (el nombre, con su ficha, va en la cabecera). Una persona natural: nada (su RUC lleva el
            DNI). */}
        {proveedor && !natural && !codigoConsorcio && proveedorRuc && (
          <Dato k="RUC de quien ganó">
            <span className="font-mono text-meta">
              <Ruc value={proveedorRuc} />
            </span>
            {queda && <span className="block text-rotulo text-mute">Se le adjudicó después de otro postor (CONOSCE)</span>}
          </Dato>
        )}
        {codigoConsorcio && (
          <Dato k="Integrantes del consorcio">
            <span className="mb-1.5 flex items-center gap-1 font-mono text-rotulo text-mute">
              Código del consorcio {codigoConsorcio}
              <Ayuda titulo="¿Por qué no tiene RUC?">
                Un consorcio se forma para participar en un proceso y no tiene RUC propio: el SEACE le da este código. Sus
                integrantes sí tienen RUC, y cada empresa su ficha en Vigía.
              </Ayuda>
            </span>
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
  pasos,
  acciones = [],
  children,
}: {
  icono: ReactNode;
  titulo: string;
  ayuda?: ReactNode;
  /** Una línea más chica debajo de la frase: lo que le falta al registro, el pedido de descarga. */
  nota?: ReactNode;
  /** Qué se leerá (`PasosLectura`), debajo de la nota: sólo `<span>`, porque va dentro del párrafo de la franja. */
  pasos?: ReactNode;
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
        // Con los pasos de la lectura el texto mide 3 o 4 renglones: el ícono va arriba, junto al título, no al medio.
        className={cn("sm:flex-row sm:flex-wrap sm:gap-x-4", pasos ? "sm:items-start" : "sm:items-center")}
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
        {pasos}
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

function AnalisisCard({ c, lectura, alcance, conCronograma }: { c: Detalle; lectura: LecturaContrato | null; alcance: AlcanceActivo | null; conCronograma: boolean }) {
  const estado = c.estadoProcesamiento;
  const registro = accionesRegistro(c, conCronograma);
  const falta = faltaParaLeer(c.clasificacion.validacionesPendientes);
  // Qué se leerá, dentro de la franja de cada estado sin leer. Con procesamiento en vivo, los carriles de ContratoEnVivo ya
  // muestran qué parte aplica y cuál se omitió.
  const conPasos = !c.procesamiento && FASES.some((f) => (c.clasificacion.agentesAplicables ?? []).includes(f.key));
  const pasos = conPasos ? <PasosLectura c={c} /> : null;

  if (estado === "procesado" && c.alerta) {
    // En revisión humana: «En revisión» y nada más (§10.4); la tarjeta del resultado ya sabe decirlo.
    if (c.alerta.estado === "revision") return <ResultadoAnalisis resultado={c.alerta} ocid={c.ocid} revision />;
    // Leído: una franja con la fecha y las dos salidas (el dictamen y cómo se leyó). Antes iba aquí la tarjeta entera del
    // resultado (medidor, «5 señales de riesgo», las reglas evaluadas y cada señal): la cabecera ya dice el puntaje y
    // cada señal, y el dictamen las explica; con la tarjeta, la ficha contaba las señales a su manera (5 contra 4).
    const n = lectura?.conteo.total ?? c.alerta.banderas.length;
    return (
      <FranjaEstado
        icono={<FileCheck size={18} className="text-mossTexto" aria-hidden />}
        titulo={c.alerta.analizadoEn ? `Leído el ${fecha(dia(c.alerta.analizadoEn))}` : "Leído por Vigía"}
        acciones={[
          <EnlaceAccion key="dictamen" href={rutaContrato(c.ocid, "dictamen")} flecha>
            Leer el dictamen
          </EnlaceAccion>,
          <Link key="como" href={rutaContrato(c.ocid, "vivo")} prefetch={false} className={claseAccion("secundario")}>
            <Workflow size={16} aria-hidden /> Trazabilidad
          </Link>,
        ]}
      >
        {n > 0
          ? `El dictamen explica ${n === 1 ? "su señal" : `sus ${numero(n)} señales`}, cada una con su norma y su evidencia, y cuenta la historia del proceso.`
          : "La lectura terminó sin señales: el dictamen dice qué se cotejó."}
      </FranjaEstado>
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
        pasos={pasos}
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
        pasos={pasos}
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
        pasos={pasos}
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
      pasos={pasos}
      acciones={[
        // El aporte va al fondo común (migración 206): la entidad es su destino sugerido, no elige qué se lee.
        <EnlaceAccion
          key="apoyar"
          href={rutaApoyar(c.entidadRuc)}
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
 * Qué se leerá: las partes del análisis que aplican a este contrato, en el orden en que corren y con el dictamen al
 * final (lo que publica la lectura), como fichas numeradas en UNA fila unidas por una raya, dentro de la franja del
 * estado; en el celular (o con muchas partes) bajan de renglón, y la raya queda al final del renglón, apuntando al
 * siguiente. Pedido del usuario del 2026-11-05: era una tarjeta aparte con ocho pasos en vertical (~340 px) debajo de
 * «Lectura en preparación»; antes aún, píldoras sueltas en la columna lateral. Todo en `<span>` (con sus roles de lista):
 * va dentro del párrafo de la franja. Sin ninguna parte no se dibuja: el estado ya dice por qué no se lee.
 */
function PasosLectura({ c }: { c: Detalle }) {
  const aplican = c.clasificacion.agentesAplicables ?? [];
  // FASES ya viene en el orden del pipeline, con el dictamen (report_writer) al final.
  const fases = FASES.filter((f) => aplican.includes(f.key));
  if (!fases.length) return null;
  return (
    <span className="mt-2.5 block">
      <span className="flex items-center gap-1 text-meta font-semibold text-ink">
        Qué se leerá
        <Ayuda titulo="¿Por qué estas partes?">
          Dependen del tipo de contrato y de su etapa. Las que no aparecen no aplican a este contrato.
        </Ayuda>
      </span>
      <span role="list" aria-label="Las partes de la lectura, en orden" className="mt-1 flex flex-wrap items-center gap-y-1.5">
        {fases.map((f, i) => {
          const ultimo = i === fases.length - 1;
          const dictamen = f.key === "report_writer";
          return (
            <span role="listitem" key={f.key} className="inline-flex items-center">
              {/* El número del paso en su círculo y el nombre; el dictamen, lleno y con su ícono. */}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-rotulo leading-5",
                  dictamen ? "border-granate bg-granate font-semibold text-paper" : "border-line bg-paper text-ink",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-micro font-semibold tabular-nums",
                    dictamen ? "text-paper" : "bg-paperDeep text-inkSoft",
                  )}
                >
                  {dictamen ? <FileText size={12} /> : i + 1}
                </span>
                {f.label}
              </span>
              {!ultimo && <span aria-hidden className="mx-1 h-px w-3 shrink-0 bg-line" />}
            </span>
          );
        })}
      </span>
    </span>
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
