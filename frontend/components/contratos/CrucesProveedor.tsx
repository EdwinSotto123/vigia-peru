/**
 * Lo que dicen otros registros públicos de quien ganó: aportes, gastos de campaña y candidaturas (ONPE),
 * autoridades electas y el partido que gobierna la entidad (JNE), visitas a entidades, penalidades y sanciones
 * del Tribunal (OSCE), socios compartidos con otro postor (RNP), y su historial con la entidad y los adicionales
 * del contrato (CONOSCE). Cruces automáticos por DNI y RUC (migración 48); los nombres llegan tapados de la API.
 * Son datos de registros oficiales, no conclusiones: cada uno dice de dónde sale.
 */

import type { GobiernoContrato } from "@/lib/contratos";
import type { ReactNode } from "react";
import { Ayuda } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { CuentaGrupo, ListaPaginada } from "@/components/listado";
import { Partes } from "@/components/ui/Partes";
import { Dato } from "@/components/ui/Dato";
import { ArrowUpRight, ChevronDown, CircleDot, Coins, Receipt } from "lucide-react";
import { TablaEvidencia } from "./TablaEvidencia";
import { AbrirDetalle } from "./AbrirDetalle";
import type { CruceProveedor, DiaFraccionado, EvidenciaCruce } from "@/lib/contratos";
import { fecha, fechaCorta, numero, oracion, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { recortar } from "./recortar";
import { RANGO_SEVERIDAD, peorSeveridad } from "@/lib/severidad";
import { txt } from "@/lib/utils";

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
const SEVERIDAD = { alta: "Alta", media: "Media", baja: "Baja" } as const;
/** El nombre de cada fuente, en palabras (antes "ONPE · Claridad": el punto medio no va en la interfaz). */
const FUENTE: Record<string, string> = {
  onpe_aportantes: "Claridad de la ONPE",
  onpe_candidatos: "Claridad de la ONPE",
  jne_autoridades: "Autoridades electas del JNE",
  penalidades: "Penalidades del OECE",
  osce_sancionados: "Sancionados del Tribunal de Contrataciones",
  visitas_entidades: "Registro de visitas",
  rnp_conformacion_juridica: "Conformación jurídica del RNP",
  onpe_gastos_proveedores: "Gastos de campaña de la ONPE",
  conosce_adjudicaciones: "Adjudicaciones de CONOSCE",
  conosce_contratos: "Contratos de CONOSCE",
  conosce_ordenes: "Órdenes de compra y de servicio de CONOSCE",
  precio_item: "Ítems del OCDS (OECE) y CONOSCE",
};
/**
 * Una sanción frente a la buena pro de este proceso (pedido del usuario, 2026-10-22: «Sancionado» no decía si lo estaba
 * cuando contrató o antes): si ya había terminado o si seguía vigente al ganar. Una multa no tiene esa vigencia.
 */
const vigenteEl = (tipo: string | null, desde: string | null, hasta: string | null, fecha: string) =>
  tipo !== "multa" && !!desde && desde <= fecha && (!hasta || hasta >= fecha);

function AlGanar({ tipo, desde, hasta, buenaPro }: { tipo: string | null; desde: string | null; hasta: string | null; buenaPro: string | null }) {
  if (!buenaPro || tipo === "multa" || !desde) return null;
  if (vigenteEl(tipo, desde, hasta, buenaPro)) return <b className="text-crimsonTexto"> Seguía vigente cuando ganó este proceso.</b>;
  if (hasta && hasta < buenaPro) return <span className="text-inkSoft"> Ya había terminado cuando ganó este proceso.</span>;
  return null;
}

/** El resumen del grupo de sanciones: al ganar este proceso, ¿alguna inhabilitación seguía vigente? Si no, cuándo terminó la última. */
function SancionesAlGanar({ grupo }: { grupo: CruceProveedor[] }) {
  const fecha = grupo.find((c) => c.buenaPro?.fecha)?.buenaPro?.fecha ?? null;
  if (!fecha) return null;
  const vigentes = grupo.filter((c) => vigenteEl(txt(c.detalle.tipo), txt(c.detalle.desde), txt(c.detalle.hasta), fecha)).length;
  const hastas = grupo.map((c) => txt(c.detalle.hasta)).filter((h): h is string => !!h && h < fecha).sort();
  return vigentes > 0 ? (
    <p className="mb-2 rounded-lg bg-crimson-soft/60 px-2.5 py-1.5 text-meta text-crimsonTexto">
      Cuando ganó este proceso ({fechaCorta(fecha)}) seguía inhabilitado: {vigentes === 1 ? "una de estas sanciones cubría" : `${numero(vigentes)} de estas sanciones cubrían`} esa fecha.
    </p>
  ) : (
    <p className="mb-2 rounded-lg bg-paperSoft px-2.5 py-1.5 text-meta text-ink">
      Cuando ganó este proceso ({fechaCorta(fecha)}) ninguna inhabilitación estaba vigente
      {hastas.length ? <>: la última había terminado el <b>{fechaCorta(hastas[hastas.length - 1])}</b></> : ""}. Son antecedentes, no un impedimento.
    </p>
  );
}

/** Cuántas filas de un mismo tipo se ven antes de "ver más". */
const VISIBLES = 3;

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v ? Number(v) : null);
const rango = (a: unknown, b: unknown) => {
  const x = txt(String(a ?? "")), y = txt(String(b ?? ""));
  if (!x && !y) return null;
  const f = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? fechaCorta(s) : s);
  return x === y || !y ? f(x) : `${f(x) ?? "?"} – ${f(y)}`;
};
/** La empresa ganadora de la que habla el cruce, en negrita. */
function Emp({ c }: { c: CruceProveedor }) {
  const emp = c.proveedor ? <b>{c.proveedor}</b> : <>la empresa ganadora</>;
  if (!c.consorcio) return emp;
  return (
    <>
      {emp} (integrante de <b>{c.consorcio.nombre ?? "un consorcio"}</b>)
    </>
  );
}

/** Quién ganó la buena pro: el consorcio, si el cruce es de uno de sus integrantes. */
function Ganador({ c }: { c: CruceProveedor }) {
  return c.consorcio ? <>el <b>{c.consorcio.nombre ?? "consorcio"}</b></> : <Emp c={c} />;
}

/** "NOMBRE (socio y representante legal de EMPRESA)": quién es la persona respecto del ganador. */
function quien(c: CruceProveedor, rol = c.socios[0]?.rol, nombre = c.socios[0]?.nombre): ReactNode {
  if (!nombre) return <Emp c={c} />;
  return (
    <>
      <span className="font-semibold">{nombre}</span>
      {rol === "titular" ? (
        <span className="text-inkSoft"> (titular del RUC ganador)</span>
      ) : (
        <span className="text-inkSoft">
          {" "}
          ({rol ?? "vinculado"} de <Emp c={c} />)
        </span>
      )}
    </>
  );
}

/** " Después, EMPRESA ganó este proceso el 31 ago. por S/ 217 mil." */
function Gano({ c, dias }: { c: CruceProveedor; dias?: number | null }) {
  const bp = c.buenaPro;
  if (!bp?.fecha && bp?.montoSoles == null) return null;
  return (
    <>
      {" "}
      {dias != null && dias > 0 ? <><b>{numero(dias)} días después</b>, </> : "Después, "}
      <Ganador c={c} /> ganó la buena pro de este proceso
      {bp.fecha ? ` el ${fechaCorta(bp.fecha)}` : ""}
      {bp.montoSoles != null ? <> por <b>{solesCompacto(bp.montoSoles)}</b></> : ""}.
    </>
  );
}

const RECIEN_FUNDADA_POR_QUE =
  "Una empresa que gana contratos del Estado a los pocos meses de existir puede haberse creado para eso. No prueba nada por sí solo —hay empresas nuevas legítimas—, pero vale mirar quién está detrás y cómo fue la adjudicación, sobre todo si el monto es alto.";

/** Por qué mirar cada tipo de cruce: una línea bajo el título del grupo. */
const POR_QUE: Record<string, string> = {
  aporte: "Quien financia una campaña y después contrata con el Estado puede tener un acceso que otros no tienen. No está prohibido, pero es un posible conflicto de interés.",
  aporte_empresa: "Quien financia una campaña y después contrata con el Estado puede tener un acceso que otros no tienen. No está prohibido, pero es un posible conflicto de interés.",
  candidato: "Las autoridades electas y sus parientes tienen impedimentos para contratar con el Estado, sobre todo en su jurisdicción. Una candidatura muestra el vínculo político de la empresa.",
  autoridad: "Las autoridades electas y sus parientes tienen impedimentos para contratar con el Estado, sobre todo en su jurisdicción.",
  penalidad: "Las penalidades se cobran por retrasos o incumplimientos: muestran cómo cumplió en contratos anteriores.",
  sancion: "El Tribunal sanciona faltas graves ante el Estado (documentos falsos, incumplimientos). Mientras una inhabilitación está vigente, la empresa no puede contratar.",
  sancion_vigente: "Con una inhabilitación vigente la empresa no podía contratar con el Estado: la entidad debía verificarlo en el RNP antes de dar la buena pro.",
  visita_previa: "Reunirse con funcionarios antes de la buena pro no es ilegal, pero el registro de visitas existe para transparentarlo. Una reunión con quien decide, o una visita «personal», merece revisión.",
  socio_comun: "Si dos postores que compiten comparten dueños o representantes, la competencia puede ser solo aparente (ofertas concertadas). Es una de las señales clásicas de colusión.",
  partido_gobernante: "La empresa, o una persona detrás de ella, aportó dinero al partido que gobierna la entidad que le dio el contrato: un posible conflicto de interés, el más directo de estos cruces.",
  vendio_gobernante: "La empresa, o una persona detrás de ella, le vendió a la campaña del partido que gobierna la entidad. Es una relación comercial, no un aporte: pesa según el monto.",
  proveedor_campana: "Es una relación comercial con un partido político. Pesa más cuando es el partido que gobierna la entidad, y menos en cadenas grandes que le venden a todos.",
  recurrente: "Ganarle muchas veces a la misma entidad puede ser buena competencia o un proveedor cautivo. Vale mirar cuántos postores hubo en cada proceso.",
  sobreprecio: "Comparado con lo que pagaron otras entidades del Estado por el mismo código CUBSO y la misma unidad, ese año y el anterior, desde 5 entidades. Puede tener explicación (poca cantidad, transporte a zonas lejanas, otra calidad): no prueba por sí solo un sobreprecio.",
  adicional: "Los adicionales tienen topes legales: 25 % en bienes y servicios, y 15 % en obras sin autorización de la Contraloría. Cerca del tope merece revisión.",
  otro_postor: "Cuando el ganador no firma o pierde la buena pro, se adjudica al siguiente postor con su propia oferta: el Estado paga más. Vale ver en el expediente por qué no firmó el primero.",
  fraccionamiento: "Partir una compra en órdenes pequeñas para no hacer un proceso de selección está prohibido. Varias órdenes el mismo día, al mismo proveedor y por encima del tope, son el patrón que se busca.",
  unico_postor: "Un proceso con un solo postor no tuvo competencia: puede ser un rubro muy chico o un requerimiento hecho a la medida de un proveedor. Vale ver si las bases eran restrictivas, sobre todo si el monto es alto o se adjudicó al tope del valor referencial.",
  socio_en_entidad: "Que un dueño o representante del proveedor esté en la planilla o la lista de locadores de la MISMA entidad que lo contrata es un conflicto de interés directo: quien decide y quien vende pueden ser la misma red. Merece revisar el expediente.",
  domicilio_compartido: "Dos postores que comparten la dirección fiscal pueden ser la misma mano detrás de las dos: la competencia sería solo aparente. No prueba vínculo por sí solo —puede ser un centro de oficinas—, por eso se excluyen las direcciones con muchas empresas.",
  proveedor_cautivo: "Una empresa que vive casi por completo de una sola entidad es muy dependiente de ella: vale ver si se creó para servirla o si hay una relación demasiado estrecha. No es una irregularidad por sí misma.",
  recien_fundada: RECIEN_FUNDADA_POR_QUE,
  recien_fundada_medio_ano: RECIEN_FUNDADA_POR_QUE,
  recien_fundada_un_ano: RECIEN_FUNDADA_POR_QUE,
  recien_fundada_dos_anos: RECIEN_FUNDADA_POR_QUE,
};
// Las bandas de un cruce comparten el "por qué" de su tipo padre (migración 121).
POR_QUE.recurrente_dominante = POR_QUE.recurrente_frecuente = POR_QUE.recurrente;
POR_QUE.sancion_definitiva = POR_QUE.sancion_temporal = POR_QUE.sancion_multa = POR_QUE.sancion;
POR_QUE.adicional_sobre_tope = POR_QUE.adicional_alto = POR_QUE.adicional;
POR_QUE.sobreprecio_extremo = POR_QUE.sobreprecio_alto = POR_QUE.sobreprecio;

/** Una línea de texto por cruce, con los datos del registro: quién, de qué empresa, qué hizo y qué ganó después. */
/** Lo que la empresa sumó después de que se convocó este proceso (no cuenta como antecedente): sólo se menciona. */
function Despues({ n: k, uno, varios }: { n: number | null; uno: string; varios: string }) {
  if (!k) return null;
  return <span className="text-mute"> Después de este proceso, {numero(k)} {k === 1 ? uno : varios} más (marcadas en la evidencia).</span>;
}

/** Si el aporte fue al partido que gobernaba la entidad o a otro (con mayúsculas y tildes distintas en cada fuente). */
const normal = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
function AQuien({ partido, gobierna }: { partido: string | null; gobierna?: GobiernoContrato | null }) {
  if (!partido || !gobierna) return null;
  return normal(partido) === normal(gobierna.nombre) ? (
    <b> Es el partido que gobernaba la entidad cuando se convocó.</b>
  ) : (
    <span> No es el partido que gobernaba la entidad: la gobernaba <b>{gobierna.nombre}</b>.</span>
  );
}

function Texto({ c, gobierna }: { c: CruceProveedor; gobierna?: GobiernoContrato | null }) {
  const d = c.detalle;
  switch (c.tipo) {
    case "aporte":
    case "aporte_empresa": {
      const veces = n(d.aportes);
      return (
        <>
          {c.tipo === "aporte" ? quien(c) : <Emp c={c} />} aportó <b>{solesCompacto(c.montoSoles)}</b> a{" "}
          <b>{txt(d.partido) ?? "una organización política"}</b>
          {veces && veces > 1 ? ` en ${numero(veces)} aportes` : ""}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""}.
          <AQuien partido={txt(d.partido)} gobierna={gobierna} />
          <Despues n={n(d.posteriores)} uno="aporte" varios="aportes" />
          <Gano c={c} />
        </>
      );
    }
    case "candidato":
      return (
        <>
          {quien(c)} postuló{txt(d.cargo) ? ` a ${txt(d.cargo)!.toLowerCase()}` : ""} por <b>{txt(d.organizacion) ?? "una organización política"}</b>
          {txt(d.proceso) ? ` en ${d.proceso}` : ""}
          {txt(d.departamento) ? ` (${d.departamento})` : ""}.
          <Gano c={c} />
        </>
      );
    case "autoridad": {
      const lugar = [d.distrito, d.provincia, d.departamento].map(txt).filter(Boolean)[0];
      return (
        <>
          {quien(c)} es <b>{txt(d.cargo)?.toLowerCase() ?? "autoridad"}</b>
          {lugar ? ` de ${lugar}` : ""}
          {txt(d.organizacion) ? ` por ${d.organizacion}` : ""}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""}.
          <Gano c={c} />
        </>
      );
    }
    case "penalidad":
      return (
        <>
          {c.posterior ? <><Emp c={c} /> recibió</> : <>Antes de este proceso, <Emp c={c} /> ya había recibido</>}{" "}
          <b>{numero(n(d.penalidades) ?? 0)} {n(d.penalidades) === 1 ? "penalidad" : "penalidades"}</b> por <b>{solesCompacto(c.montoSoles)}</b> en{" "}
          {numero(n(d.entidades) ?? 0)} {n(d.entidades) === 1 ? "entidad" : "entidades"}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""}.
          <Despues n={n(d.posteriores)} uno="penalidad" varios="penalidades" />
        </>
      );
    case "sancion":
    case "sancion_definitiva":
    case "sancion_temporal":
    case "sancion_multa":
    case "sancion_vigente": {
      const tipo = txt(d.tipo);
      const que = tipo === "multa" ? "una multa" : tipo === "definitivo" ? "una inhabilitación definitiva" : "una inhabilitación temporal";
      return (
        <>
          {c.tipo === "sancion_vigente" ? (
            <>
              <Emp c={c} /> ganó la buena pro el <b>{fechaCorta(c.buenaPro?.fecha ?? c.fecha)}</b>
              {c.buenaPro?.montoSoles != null ? <> por <b>{solesCompacto(c.buenaPro.montoSoles)}</b></> : ""} mientras tenía <b>{que}</b> vigente
            </>
          ) : (
            <>
              El Tribunal de Contrataciones le impuso a <Emp c={c} /> <b>{que}</b>
            </>
          )}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""}
          {tipo === "multa" && c.montoSoles ? ` de ${solesCompacto(c.montoSoles)}` : ""}
          {txt(d.infraccion) ? `, por ${recortar(txt(d.infraccion)!.replace(/^[-\s]*(i+\)\s*)?/i, ""), 260).toLowerCase()}` : ""}
          {txt(d.resolucion) ? ` (Res. ${d.resolucion})` : ""}.
          {c.tipo !== "sancion_vigente" && <AlGanar tipo={tipo} desde={txt(d.desde)} hasta={txt(d.hasta)} buenaPro={c.buenaPro?.fecha ?? null} />}
        </>
      );
    }
    case "visita_previa": {
      const v = c.visitas[0];
      const dias = n(d.dias_antes);
      return (
        <>
          {quien(c, v?.rol ?? null, v?.visitante ?? undefined)} visitó <b>{v?.entidad ?? "una entidad"}</b>
          {d.misma_entidad === true ? <b> (la misma entidad que contrató)</b> : ""} el {fechaCorta(v?.fecha ?? c.fecha)}
          {v?.funcionario ? (
            <>
              {" "}
              y lo recibió <span className="font-semibold">{v.funcionario}</span>
              {v.cargoFuncionario ? ` (${v.cargoFuncionario.toLowerCase()})` : ""}
            </>
          ) : (
            ""
          )}
          .{v?.motivo ? <> Motivo declarado: «{v.motivo.slice(0, 120)}».</> : ""}
          <Gano c={c} dias={dias} />
        </>
      );
    }
    case "socio_comun": {
      const otros = c.otrosPostores ?? (Array.isArray(d.otros_postores) ? (d.otros_postores as string[]).map((ruc) => ({ ruc, nombre: null })) : []);
      const rolOtro = Array.isArray(d.rol_en_otros) ? (d.rol_en_otros as string[]).map((r) => r.toLowerCase().replace(/_/g, " ").replace("socio accionista titular", "socio")).join(", ") : null;
      return (
        <>
          {quien(c)} también figura{rolOtro ? ` como ${rolOtro}` : ""} en {otros.length === 1 ? "otra empresa que compitió" : `${numero(otros.length)} empresas que compitieron`} en este
          mismo proceso:{" "}
          {otros.map((o, i) => (
            <span key={o.ruc}>
              {i > 0 && ", "}
              {o.nombre ? <b>{o.nombre}</b> : null} <span className="font-mono text-rotulo">(RUC {o.ruc})</span>
            </span>
          ))}
          .<Gano c={c} />
        </>
      );
    }
    case "proveedor_campana":
      return (
        <>
          {c.socios.length ? quien(c) : <Emp c={c} />} le vendió <b>{solesCompacto(c.montoSoles)}</b> a la campaña de{" "}
          <b>{txt(d.organizacion) ?? "una organización política"}</b>
          {txt(d.proceso) ? ` (${d.proceso})` : ""}.
        </>
      );
    case "vendio_gobernante":
    case "partido_gobernante": {
      const via = c.tipo === "vendio_gobernante" ? "proveedor_campana" : txt(d.via);
      const partido = txt(d.partido) ?? txt(d.organizacion);
      const accion = via === "proveedor_campana" ? "le vendió a la campaña de" : "aportó a";
      return (
        <>
          {c.socios.length ? quien(c) : <Emp c={c} />} {accion} <b>{partido ?? "una organización política"}</b>
          {c.montoSoles ? ` (${solesCompacto(c.montoSoles)})` : ""}
          {txt(d.proceso) ? ` en ${d.proceso}` : ""}. Es el partido del {txt(d.cargo_gobernante)?.toLowerCase() ?? "alcalde"} que gobernaba la
          entidad cuando dio la buena pro.
          <Gano c={c} />
        </>
      );
    }
    case "recurrente_dominante":
    case "recurrente_frecuente":
    case "recurrente": {
      const part = n(d.participacion);
      return (
        <>
          Antes de este proceso, <Emp c={c} /> ya le había ganado <b>{numero(n(d.procesos) ?? 0)} procesos</b> a esta entidad
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""} por {solesCompacto(c.montoSoles)}
          {part != null ? (
            <>
              {/* 0,03 % no es "0 %": la entidad adjudicó algo y le tocó una parte mínima. */}
              : {part > 0 && part < 0.001 ? "menos del " : "el "}
              <b>{part > 0 && part < 0.001 ? "0.1" : (part * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })} %</b> de lo que la entidad había
              adjudicado hasta entonces
            </>
          ) : ""}
          {n(d.procesos_entidad) ? ` en ${numero(n(d.procesos_entidad)!)} procesos` : ""}.
        </>
      );
    }
    case "sobreprecio_extremo":
    case "sobreprecio_alto":
    case "sobreprecio": {
      const p = (d.peor ?? {}) as Record<string, unknown>;
      const items = n(d.items) ?? 1;
      const razon = n(p.razon);
      return (
        <>
          {items > 1 ? <>En <b>{numero(items)} ítems</b>, el precio por unidad</> : "El precio por unidad"} pasa lo que pagaron otras entidades
          {txt(p.descripcion) ? <>: el de <b>{oracion(String(p.descripcion)).slice(0, 90)}</b></> : ""} fue de{" "}
          <b>{soles(n(p.unitario))}</b>{txt(p.unidad) ? ` por ${String(p.unidad).toLowerCase()}` : ""}, frente a una mediana de {soles(n(p.mediana))}
          {n(p.entidades) ? ` en ${numero(n(p.entidades)!)} entidades` : ""}
          {razon ? <> (<b>{razon.toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces</b>)</> : ""}. Por encima del rango habitual suma{" "}
          <b>{solesCompacto(c.montoSoles)}</b>.
          <Gano c={c} />
        </>
      );
    }
    case "adicional_sobre_tope":
    case "adicional_alto":
    case "adicional": {
      const pct = n(d.porcentaje);
      const prorroga = n(d.prorroga);
      return (
        <>
          El contrato {txt(d.contrato) ? `${d.contrato} ` : ""}de <Emp c={c} />
          {n(d.adicional) ? (
            <>
              {" "}sumó adicionales por <b>{solesCompacto(n(d.adicional))}</b>
              {pct != null ? <>: el <b>{pct.toLocaleString("es-PE")} %</b> de los {solesCompacto(n(d.contratado))} contratados</> : ""}
            </>
          ) : (
            " no tuvo adicionales"
          )}
          {prorroga ? `; prórrogas por ${solesCompacto(prorroga)}` : ""}.
          {txt(d.url_contrato) && (
            <>
              {" "}
              <a href={txt(d.url_contrato)!} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2">
                Ver contrato
              </a>
            </>
          )}
        </>
      );
    }
    case "fraccionamiento": {
      const dias = n(d.dias) ?? 1;
      return (
        <>
          Antes de este proceso, en <b>{numero(dias)}</b> {dias === 1 ? "día" : "días distintos"}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""}, esta entidad le emitió a <Emp c={c} /> varias órdenes de hasta 8 UIT
          (sin proceso de selección) que ese mismo día juntas pasaron el tope: <b>{numero(n(d.ordenes) ?? 0)} órdenes</b> por{" "}
          <b>{solesCompacto(c.montoSoles)}</b>
          {n(d.misma_descripcion) ? <>; en {numero(n(d.misma_descripcion)!)} de esos días, todas con <b>la misma descripción</b></> : ""}.
          {c.buenaPro && <> Además, en este proceso le dieron la buena pro{c.buenaPro.montoSoles != null ? ` por ${solesCompacto(c.buenaPro.montoSoles)}` : ""}.</>}
        </>
      );
    }
    case "otro_postor": {
      const pct = n(d.porcentaje);
      const original = txt(d.proveedor_original);
      return (
        <>
          La buena pro fue primero para {original ? <b>{original}</b> : "otro postor"} por <b>{solesCompacto(n(d.monto_original))}</b>; se
          adjudicó después a <Emp c={c} /> por <b>{solesCompacto(n(d.monto_contratado))}</b>
          {pct != null && pct !== 0 && (
            <>
              {" "}
              (<b>{pct > 0 ? "+" : "−"}{numero(Math.abs(pct))} %</b>)
            </>
          )}
          .
        </>
      );
    }
    case "recien_fundada":
    case "recien_fundada_medio_ano":
    case "recien_fundada_un_ano":
    case "recien_fundada_dos_anos": {
      // El texto lo escribe el dato: "con solo 6 meses de fundación", "con menos de 1 año", y "millonario" si pasa S/ 1 M.
      const meses = Math.max(0, Math.round(n(d.meses) ?? 0));
      const fund = txt(d.fundada);
      const tiempo =
        meses < 1 ? "menos de un mes" : meses === 1 ? "solo 1 mes" : meses < 12 ? `solo ${meses} meses` : meses < 24 ? "menos de 2 años" : `${Math.round(meses / 12)} años`;
      return (
        <>
          <Emp c={c} /> ganó este proceso con <b>{tiempo} de fundada</b>
          {fund ? ` (figura de alta en la SUNAT desde el ${fechaCorta(fund)})` : ""}
          {d.millonario && c.montoSoles != null ? (
            <>, y por <b>{solesCompacto(c.montoSoles)}</b>: un contrato millonario para una empresa tan nueva</>
          ) : c.montoSoles != null ? (
            <>, por <b>{solesCompacto(c.montoSoles)}</b></>
          ) : (
            ""
          )}
          .
        </>
      );
    }
    case "unico_postor": {
      const razon = n(d.razon);
      return (
        <>
          <Emp c={c} /> fue el <b>único postor</b> de este proceso: no hubo competencia. Ganó
          {c.montoSoles != null ? <> por <b>{solesCompacto(c.montoSoles)}</b></> : ""}
          {d.al_tope && razon != null ? (
            <>, al <b>{(razon * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })}%</b> del valor referencial</>
          ) : (
            ""
          )}
          .
        </>
      );
    }
    case "socio_en_entidad": {
      const ent = txt(d.entidad);
      return (
        <>
          {quien(c)} es, además, <b>persona contratada por {ent ? tituloNatural(ent) : "esta entidad"}</b>
          {txt(d.servicio) ? <> ({oracion(txt(d.servicio)!).slice(0, 90)})</> : ""}
          {n(d.monto_persona) ? <>, por <b>{solesCompacto(n(d.monto_persona))}</b></> : ""}: la misma entidad que le dio el contrato a <Emp c={c} />.
        </>
      );
    }
    case "domicilio_compartido": {
      const nEmp = n(d.empresas_en_domicilio);
      const otros = n(d.otros_postores) ?? 1;
      return (
        <>
          <Emp c={c} /> comparte su <b>domicilio fiscal en la SUNAT</b> con {otros === 1 ? "otro postor" : <><b>{numero(otros)}</b> postores</>} de este proceso
          {nEmp ? <> (en esa dirección hay <b>{numero(nEmp)}</b> empresas)</> : ""}: la competencia pudo ser solo aparente.
        </>
      );
    }
    case "proveedor_cautivo": {
      const parte = n(d.parte);
      const ent = txt(d.entidad);
      return (
        <>
          <Emp c={c} /> recibe {parte != null ? <>el <b>{(parte * 100).toLocaleString("es-PE", { maximumFractionDigits: 0 })}%</b></> : "casi todo"} de lo que le compra el Estado de <b>{ent ? tituloNatural(ent) : "esta entidad"}</b>
          {n(d.total_empresa) ? <> (<b>{solesCompacto(n(d.total_empresa))}</b> en {numero(n(d.procesos) ?? 0)} procesos)</> : ""}: depende casi por completo de ella.
        </>
      );
    }
    default:
      return <>{c.etiqueta}.</>;
  }
}

function Fila({ c, gobierna }: { c: CruceProveedor; gobierna?: GobiernoContrato | null }) {
  return (
    <li className="text-meta leading-relaxed text-ink">
      <FilaContenido c={c} gobierna={gobierna} />
    </li>
  );
}

function FilaContenido({ c, gobierna }: { c: CruceProveedor; gobierna?: GobiernoContrato | null }) {
  return (
    <>
      <Texto c={c} gobierna={gobierna} />{" "}
      <span className="text-rotulo text-mute">
        Fuente:{" "}
        {c.fuenteUrl ? (
          <a href={c.fuenteUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
            {FUENTE[c.fuente] ?? c.fuente}
          </a>
        ) : (
          FUENTE[c.fuente] ?? c.fuente
        )}
      </span>
      {c.tipo === "fraccionamiento" && c.ordenesDias && c.ordenesDias.length > 0 && <OrdenesFraccionadas dias={c.ordenesDias} />}
      {c.evidencia && c.evidencia.length > 0 && <EvidenciaDelCruce evidencia={c.evidencia} />}
    </>
  );
}

/**
 * La evidencia de un cruce, plegada debajo de él: cada registro de la fuente en una tabla (en el teléfono, una tarjeta
 * por registro), cómo verificarlo y el enlace a la fuente. Sin DNI ni nombres de personas: los trae así la API.
 */
function EvidenciaDelCruce({ evidencia }: { evidencia: EvidenciaCruce[] }) {
  const n = evidencia.reduce((s, e) => s + (e.total ?? e.filas.length), 0);
  const despues = evidencia.reduce((s, e) => s + e.filas.filter((f) => f.posterior).length, 0);
  return (
    <details className="group mt-2 rounded-xl border border-line bg-paperSoft">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-meta font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-center gap-1.5">
          Ver la evidencia
          <CuentaGrupo>{n === 1 ? "1 registro" : `${numero(n)} registros`}</CuentaGrupo>
          {despues > 0 && <span className="text-rotulo font-normal text-mute">{numero(despues)} después de este proceso</span>}
        </span>
        <ChevronDown size={14} aria-hidden className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-line px-3 py-3">
        {evidencia.map((e) => (
          <section key={e.titulo} className="space-y-2">
            <h4 className="flex flex-wrap items-center gap-1.5 text-meta font-semibold text-ink">
              {e.titulo}
              <CuentaGrupo>{numero(e.total ?? e.filas.length)}</CuentaGrupo>
            </h4>
            {e.total != null && e.total > e.filas.length && (
              <p className="text-rotulo text-mute">
                Aquí van los {numero(e.filas.length)} más recientes; la fuente tiene los {numero(e.total)}.
              </p>
            )}
            <TablaEvidencia columnas={e.columnas} filas={e.filas} />
            {(e.verificar || e.enlace) && (
              <p className="text-rotulo leading-relaxed text-mute">
                {e.verificar}{" "}
                {e.enlace && (
                  <a href={e.enlace.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
                    {e.enlace.texto} <ArrowUpRight size={11} aria-hidden className="inline align-baseline" />
                  </a>
                )}
              </p>
            )}
          </section>
        ))}
      </div>
    </details>
  );
}

/**
 * Fraccionamiento: las órdenes de cada día, que el texto sólo cuenta. Plegado debajo del cruce; cada día con lo que
 * suman contra el tope (una barra con la marca del tope) y sus órdenes: descripción, número, estado y monto. Con más
 * de cuatro días, paginado.
 */
function OrdenesFraccionadas({ dias }: { dias: DiaFraccionado[] }) {
  const total = dias.reduce((s, d) => s + d.ordenes, 0);
  const bloques = dias.map((d, i) => ({
    id: `${d.fecha}-${i}`,
    contenido: <DiaOrdenes d={d} />,
    buscable: [fecha(d.fecha), ...d.detalle.map((o) => `${o.orden} ${o.descripcion ?? ""}`)].join(" "),
  }));
  return (
    <details className="group mt-2 rounded-xl border border-line bg-paperSoft">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-meta font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
        <span>
          Ver {total === 1 ? "la orden" : `las ${numero(total)} órdenes`}
          {dias.length === 1 ? ` del ${fechaCorta(dias[0].fecha)}` : ` de los ${numero(dias.length)} días`}
        </span>
        <ChevronDown size={14} aria-hidden className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">
        <p className="text-rotulo text-mute">
          Cada barra es lo que suman las órdenes de ese día; la marca, el tope de 8 UIT de ese año.
        </p>
        {bloques.length > 4 ? (
          <ListaPaginada items={bloques} tam={4} nombre="días" className="space-y-4" buscar={{ placeholder: "Buscar por descripción u orden…", etiqueta: "Buscar en las órdenes de esos días" }} />
        ) : (
          <ul className="space-y-4">
            {bloques.map((b) => (
              <li key={b.id}>{b.contenido}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function DiaOrdenes({ d }: { d: DiaFraccionado }) {
  // La barra es lo que suman; la marca, dónde queda el tope (siempre adentro: suman más que el tope).
  const marca = d.totalSoles > 0 ? Math.min(100, (d.topeSoles / d.totalSoles) * 100) : 100;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-meta">
        <span className="font-semibold text-ink">{fecha(d.fecha)}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-inkSoft">
          <Dato icono={Receipt} nombre="Órdenes">{numero(d.ordenes)} órdenes</Dato>
          <Dato icono={Coins} nombre="Suman">
            Suman <b className="font-mono tabular-nums text-ink">{soles(d.totalSoles)}</b>
          </Dato>
          <span className="text-mute">Tope {solesCompacto(d.topeSoles)}</span>
          {d.mismaDescripcion && <Badge variant="amber">Misma descripción</Badge>}
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-granate/70" role="img" aria-label={`Suman ${soles(d.totalSoles)}; el tope es ${soles(d.topeSoles)}`}>
        <span aria-hidden className="absolute -top-1 bottom-[-4px] w-0.5 bg-ink" style={{ left: `${marca}%` }} />
      </div>
      <ol className="divide-y divide-line rounded-lg border border-line bg-paper">
        {d.detalle.map((o, i) => (
          <li key={`${o.orden}-${i}`}>
            {/* La orden no tiene ficha propia, pero al hacer clic se abre el drawer con su detalle en la misma pestaña. */}
            <AbrirDetalle
              etiqueta={`Ver la orden ${o.orden}`}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 text-left text-meta transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
              detalle={{
                titulo: `Orden ${o.orden}`,
                descripcion: o.estado ? o.estado.charAt(0) + o.estado.slice(1).toLowerCase() : undefined,
                filas: [
                  { k: "Descripción", v: o.descripcion ? oracion(o.descripcion) : "Sin descripción" },
                  ...(d.entidad ? [{ k: "Entidad", v: tituloNatural(d.entidad) }] : []),
                  ...(d.objeto ? [{ k: "Rubro", v: d.objeto }] : []),
                  { k: "Monto", v: soles(o.montoSoles) },
                  { k: "Fecha", v: fecha(d.fecha) },
                ],
              }}
            >
              <span className="min-w-0">
                <span className="block text-ink">{o.descripcion ? oracion(o.descripcion) : "Sin descripción"}</span>
                <span className="mt-0.5 block text-rotulo text-mute">
                  <Partes
                    partes={[
                      <Dato key="orden" tipo="codigo" nombre="Orden" mono>
                        <span translate="no">{o.orden}</span>
                      </Dato>,
                      o.estado && <Dato key="estado" icono={CircleDot} nombre="Estado">{o.estado.charAt(0) + o.estado.slice(1).toLowerCase()}</Dato>,
                    ]}
                  />
                </span>
              </span>
              <span className="self-start font-mono tabular-nums text-ink">{soles(o.montoSoles)}</span>
            </AbrirDetalle>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Los tipos que son DATOS DEL PROVEEDOR (hechos de quien ganó), no antecedentes de ESTA contratación: una candidatura,
 * un aporte o una venta a una campaña, o ser autoridad electa (en cualquier jurisdicción). Desde la migración 115 no
 * cuentan para el riesgo del contrato y se muestran en una sección aparte, no mezclados con lo de esta entidad. Las
 * versiones LIGADAS a la entidad (partido_gobernante, vendio_gobernante) NO están aquí: son antecedentes de verdad.
 */
const DATOS_PROVEEDOR = new Set(["candidato", "aporte", "aporte_empresa", "proveedor_campana", "autoridad"]);

/** Un bloque de cruces agrupados por tipo, en orden de severidad: se reutiliza para los antecedentes y para los datos del proveedor. */
function GruposCruces({ lista, gobierna }: { lista: CruceProveedor[]; gobierna?: GobiernoContrato | null }) {
  const grupos = new Map<string, CruceProveedor[]>();
  // Dedup de seguridad: la base puede traer cruces idénticos (mismo tipo, persona, aporte y detalle) por un JOIN que
  // multiplica; se muestran una sola vez. El arreglo de raíz está en dedup_cruces_proveedor (migración 120).
  const vistos = new Set<string>();
  for (const c of lista) {
    const clave = `${c.tipo}|${c.ocid ?? ""}|${c.severidad}|${c.fecha ?? ""}|${c.montoSoles ?? ""}|${JSON.stringify(c.socios ?? [])}|${JSON.stringify(c.detalle ?? {})}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    grupos.set(c.tipo, [...(grupos.get(c.tipo) ?? []), c]);
  }
  const orden = [...grupos.values()].sort((a, b) =>
    RANGO_SEVERIDAD[peorSeveridad(a) ?? "baja"] - RANGO_SEVERIDAD[peorSeveridad(b) ?? "baja"] || b.length - a.length);
  return (
    <ul className="divide-y divide-line px-4 pb-1">
      {orden.map((grupo) => {
        const sev = peorSeveridad(grupo) ?? grupo[0].severidad;
        const filas = [...grupo].sort((a, b) => RANGO_SEVERIDAD[a.severidad] - RANGO_SEVERIDAD[b.severidad] || (b.fecha ?? "").localeCompare(a.fecha ?? ""));
        return (
          <li key={grupo[0].tipo} className="py-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Badge variant={VARIANTE[sev]}>{SEVERIDAD[sev]}</Badge>
              <h3 className="flex flex-wrap items-center gap-1.5 text-cuerpo font-semibold text-ink">
                {grupo[0].etiqueta}
                {grupo.length > 1 && <CuentaGrupo>{grupo.length}</CuentaGrupo>}
              </h3>
            </div>
            {POR_QUE[grupo[0].tipo] && <p className="mb-2 text-meta leading-relaxed text-inkSoft">{POR_QUE[grupo[0].tipo]}</p>}
            {["sancion", "sancion_definitiva", "sancion_temporal", "sancion_multa"].includes(grupo[0].tipo) && <SancionesAlGanar grupo={grupo} />}
            <ul className="list-disc space-y-1.5 pl-5">
              {filas.slice(0, VISIBLES).map((c, i) => <Fila key={i} c={c} gobierna={gobierna} />)}
            </ul>
            {filas.length > VISIBLES && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-meta text-inkSoft hover:text-ink">Ver {filas.length - VISIBLES} más</summary>
                <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
                  {filas.slice(VISIBLES).map((c, i) => <Fila key={i} c={c} gobierna={gobierna} />)}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CrucesProveedor({ cruces: todos, varios, gobierna }: { cruces: CruceProveedor[]; varios?: boolean; gobierna?: GobiernoContrato | null }) {
  if (!todos.length) return null;
  // Un antecedente es lo que ya había pasado cuando se convocó (migración 83) Y está ligado a esta entidad/proceso. Los
  // datos del proveedor (candidatura, aporte, venta a campaña, autoridad) van aparte: hechos de quien ganó, no de esta
  // contratación (migración 115). Lo posterior a la convocatoria, también aparte.
  const antecedentes = todos.filter((c) => !c.posterior && !DATOS_PROVEEDOR.has(c.tipo));
  const datosProv = todos.filter((c) => !c.posterior && DATOS_PROVEEDOR.has(c.tipo));
  const posteriores = todos.filter((c) => c.posterior);

  return (
    <section aria-labelledby="cruces-proveedor" className="rounded-2xl border border-line bg-paper">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <h2 id="cruces-proveedor" className="font-display text-bloque font-bold text-ink">
          {varios ? "Antecedentes de quienes ganaron" : "Antecedentes de quien ganó"}
        </h2>
        <Ayuda titulo="¿De dónde salen estos cruces?">
          Cruces automáticos por DNI y RUC entre el ganador (y sus socios y representantes del RNP) y los registros de la ONPE, el JNE,
          las visitas a entidades, CONOSCE, las penalidades y las sanciones del Tribunal. Son datos oficiales verificables en cada fuente: no prueban
          por sí solos una irregularidad. Sólo cuenta como antecedente lo que ya había pasado cuando se convocó el proceso; lo
          posterior se muestra aparte.
        </Ayuda>
      </div>
      {!antecedentes.length && (
        <p className="px-4 pb-3 pt-2 text-meta leading-relaxed text-inkSoft">
          Cuando se convocó este proceso, {varios ? "quienes ganaron no tenían" : "quien ganó no tenía"} antecedentes ligados a esta entidad.
        </p>
      )}
      {antecedentes.length > 0 && <GruposCruces lista={antecedentes} gobierna={gobierna} />}
      {datosProv.length > 0 && (
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
            <span className="text-meta text-inkSoft">
              <span className="font-semibold text-ink">Datos del proveedor</span> <CuentaGrupo>{numero(datosProv.length)}</CuentaGrupo> — no relacionados con esta entidad
            </span>
            <ChevronDown size={14} aria-hidden className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div>
            <p className="px-4 pb-1 pt-1 text-meta leading-relaxed text-inkSoft">
              Hechos de quien ganó (una candidatura, un aporte o una venta a una campaña, un cargo de autoridad electa), no de
              esta contratación: contexto del proveedor, no cuentan para el riesgo de este contrato.
            </p>
            <GruposCruces lista={datosProv} gobierna={gobierna} />
          </div>
        </details>
      )}
      {posteriores.length > 0 && (
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
            <span className="text-meta text-inkSoft">
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                Después de este proceso <CuentaGrupo>{numero(posteriores.length)}</CuentaGrupo>
              </span>{" "}
              No eran antecedentes cuando se convocó.
            </span>
            <ChevronDown size={14} aria-hidden className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-3">
            <p className="mb-2 text-meta leading-relaxed text-inkSoft">
              Pasó después de la convocatoria: quien adjudicó no podía saberlo. Se muestra como contexto de la empresa, no como señal sobre
              este proceso.
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              {[...posteriores].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "")).map((c, i) => (
                <li key={i} className="text-meta leading-relaxed text-inkSoft">
                  <span className="font-medium text-ink">{c.etiqueta}:</span> <FilaContenido c={c} gobierna={gobierna} />
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}
