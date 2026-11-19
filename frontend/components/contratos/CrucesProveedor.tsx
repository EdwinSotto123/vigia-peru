/**
 * Lo que dicen otros registros públicos de quien ganó: aportes, gastos de campaña y candidaturas (ONPE),
 * autoridades electas y el partido que gobierna la entidad (JNE), visitas a entidades, penalidades y sanciones
 * del Tribunal (OSCE), socios compartidos con otro postor (RNP), y su historial con la entidad y los adicionales
 * del contrato (CONOSCE). Cruces automáticos por DNI y RUC (migración 48); los nombres llegan tapados de la API.
 * Son datos de registros oficiales, no conclusiones: cada uno dice de dónde sale.
 *
 * Va en su pestaña «Antecedentes» de la ficha del contrato (`CrucesProveedor`), y su resumen, un renglón por tipo con
 * su severidad y cuántos, en el Resumen (`ResumenAntecedentes`). Antes era un bloque largo ENTRE las cifras y las
 * pestañas: las empujaba hasta 1,100 px abajo. Las sanciones van en tabla (SancionesCruce.tsx); la explicación de cada
 * tipo, una vez (la segunda vez que se repite el mismo texto, en el ⓘ).
 */

import type { GobiernoContrato } from "@/lib/contratos";
import type { ReactNode } from "react";
import Link from "next/link";
import { Ayuda, CabeceraPestana } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { CuentaGrupo } from "@/components/listado";
import { ChevronDown, ChevronRight, CircleAlert, Scale, Target } from "lucide-react";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import type { CruceProveedor } from "@/lib/contratos";
import { fechaConAnio, fechaCorta, numero, oracion, soles, solesCompacto } from "@/lib/formato";
import { inversionSsi, obraInfobras } from "@/lib/fuentes";
import { rutaPartido } from "@/lib/partidos";
import { tituloNatural } from "@/lib/landing";
import { recortar } from "./recortar";
import { RANGO_SEVERIDAD, peorSeveridad } from "@/lib/severidad";
import { txt } from "@/lib/utils";
import { EvidenciaDelCruce, OrdenesFraccionadas } from "./EvidenciaCruce";
import { GrupoSanciones, TIPOS_SANCION } from "./SancionesCruce";
import { BotonPestana } from "./BotonPestana";
import { ETAPA_VISITA, TEMA_OBSERVACION_CONTROL, TIPO_CRUCE, esEnObservacion, esTipoLeido, esTipoObra, responsabilidadesEnPalabras } from "@/lib/cruces";
import { InformeEnPanel } from "@/components/control/InformeEnPanel";
import { informeDeDetalle } from "@/lib/corrupcion";
import { rutaContrato } from "@/lib/rutas";
import { fraseBandera, type BanderaObra } from "@/lib/obras";

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
const SEVERIDAD = { alta: "Alta", media: "Media", baja: "Baja" } as const;
// La severidad también con ícono (no sólo el color), el mismo de `Severidad` y `CrucesCelda`.
const ICONO = ICONO_NIVEL;

/** La severidad de un grupo de antecedentes: color, ícono y palabra. */
function SeveridadCruce({ s }: { s: "alta" | "media" | "baja" }) {
  const Icono = ICONO[s];
  return (
    <Badge variant={VARIANTE[s]} className="gap-1">
      <Icono size={12} className="shrink-0" aria-hidden />
      {SEVERIDAD[s]}
    </Badge>
  );
}
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
  sunat: "Consulta RUC de la SUNAT",
  oece_ocds: "Contrataciones Abiertas del OECE",
  persona_entidad: "Órdenes de servicio de CONOSCE",
  // La obra del contrato y su inversión (migración 160).
  infobras: "INFOBRAS (Contraloría)",
  invierte_pe: "Invierte.pe (MEF)",
  // Las personas de los informes de control (migraciones 302 y 303).
  informes_control: "Informes de control de la Contraloría",
  // Los documentos del SEACE leídos con Claude (migración 246).
  acta_buena_pro: "Acta de buena pro del SEACE, leída con IA",
  consultas_bases: "Pliego de consultas del SEACE, leído con IA",
  bases_seace: "Bases del procedimiento en el SEACE, leídas con IA",
  // Los reportes que genera el propio SEACE, leídos sin modelo (migraciones 326, 384 y 390).
  reporte_evaluacion: "Reporte de evaluación del SEACE",
  // El comité de cada acta, leído por los agentes con la cita comprobada (migración 396).
  comite_dictamen: "Actas leídas por los agentes de Vigía",
};
/** Cuántas filas de un mismo tipo se ven antes de "ver más". */
const VISIBLES = 3;

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v ? Number(v) : null);
const rango = (a: unknown, b: unknown) => {
  const x = txt(String(a ?? "")), y = txt(String(b ?? ""));
  if (!x && !y) return null;
  const f = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? fechaConAnio(s) : s);
  return x === y || !y ? f(x) : `${f(x) ?? "?"} – ${f(y)}`;
};
/** Otra empresa del cruce, con enlace a su ficha (RUC 20); una persona natural (RUC 10), sin nombre ni código. */
function OtraEmpresa({ ruc, nombre, conRuc = false }: { ruc: string; nombre: string | null; conRuc?: boolean }) {
  if (!ruc.startsWith("20")) return <>una persona natural</>;
  return (
    <>
      <Link href={`/empresa/${ruc}`} className="font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
        {nombre ?? `RUC ${ruc}`}
      </Link>
      {conRuc && nombre ? <span className="font-mono text-rotulo"> (RUC {ruc})</span> : null}
    </>
  );
}

const ENLACE_TXT = "font-semibold underline decoration-line underline-offset-2 hover:decoration-ink";

/** Un partido con enlace a su ficha, del gobierno del año del dato («ERM2022» también sirve). */
function Partido({ nombre, anio }: { nombre: string | null | undefined; anio?: unknown }) {
  if (!nombre) return <b>una organización política</b>;
  const a = String(anio ?? "").match(/\d{4}/)?.[0];
  return (
    <Link href={rutaPartido(nombre, a)} prefetch={false} className={ENLACE_TXT}>
      {nombre}
    </Link>
  );
}

/** Una entidad con enlace a su ficha, si se conoce su RUC (la visitada se reconoce por su nombre: puede no tenerlo). */
function Entidad({ nombre, ruc }: { nombre: string; ruc?: string | null }) {
  return ruc ? (
    <Link href={`/entidad/${ruc}`} prefetch={false} className={ENLACE_TXT}>
      {nombre}
    </Link>
  ) : (
    <b>{nombre}</b>
  );
}

/** La empresa ganadora de la que habla el cruce, con enlace a su ficha (sólo una empresa: un RUC 10 no se enlaza). */
function Emp({ c }: { c: CruceProveedor }) {
  const emp = c.proveedor ? (
    /^20\d{9}$/.test(c.rucProveedor) ? (
      <Link href={`/empresa/${c.rucProveedor}`} prefetch={false} className={ENLACE_TXT}>
        {c.proveedor}
      </Link>
    ) : (
      <b>{c.proveedor}</b>
    )
  ) : (
    <>la empresa ganadora</>
  );
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
      {/* A «Su gente» de la empresa (su nombre con un apellido tapado; nunca su documento). */}
      {/^20\d{9}$/.test(c.rucProveedor) ? (
        <Link href={`/empresa/${c.rucProveedor}?seccion=gente`} prefetch={false} className={ENLACE_TXT}>
          {nombre}
        </Link>
      ) : (
        <span className="font-semibold">{nombre}</span>
      )}
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

const DIA_SEMANA = new Intl.DateTimeFormat("es-PE", { weekday: "long", timeZone: "UTC" });
const POR_VISITA: Record<string, string> = { fin_de_semana: "fin de semana", temprano: "antes de las 7", noche: "desde las 19" };

/** «el sábado 4 ago. a las 20:15 (3 h 10 min)»: una visita en palabras (la hora, si la hay). */
function unaVisita(v: CruceProveedor["visitas"][number], conPorque = false, conMotivo = false): string {
  const f = v.fecha ? `el ${DIA_SEMANA.format(new Date(`${v.fecha}T12:00:00Z`))} ${fechaConAnio(v.fecha)}` : "un día sin fecha";
  const h = v.hora ? ` a las ${v.hora}` : "";
  const m = v.minutos != null && v.minutos > 0 ? ` (${v.minutos >= 60 ? `${Math.floor(v.minutos / 60)} h${v.minutos % 60 ? ` ${v.minutos % 60} min` : ""}` : `${v.minutos} min`})` : "";
  const por = conPorque && v.por && POR_VISITA[v.por] ? `, ${POR_VISITA[v.por]}` : "";
  // El motivo es la categoría del registro o su clase (la API nunca manda el texto libre).
  const motivo = conMotivo && v.motivo ? `, por «${v.motivo.toLowerCase()}»` : "";
  return `${f}${h}${m}${por}${motivo}`;
}

/** Las visitas de un patrón: las seis primeras en la línea y, si hay más, todas en una lista que se abre. */
function VisitasEnLinea({ visitas, conPorque = false, conMotivo = false }: { visitas: CruceProveedor["visitas"]; conPorque?: boolean; conMotivo?: boolean }) {
  if (!visitas.length) return null;
  const vistas = visitas.slice(0, 6);
  return (
    <>
      {" "}Las visitas: {vistas.map((v) => unaVisita(v, conPorque, conMotivo)).join("; ")}
      {visitas.length > vistas.length ? `; y ${numero(visitas.length - vistas.length)} más.` : "."}
      {visitas.length > vistas.length && (
        <details className="group/vis mt-1">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-meta font-semibold text-granate underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
            Ver las {numero(visitas.length)} visitas
            <ChevronDown size={14} aria-hidden className="shrink-0 transition-transform duration-rapido group-open/vis:rotate-180" />
          </summary>
          <ol className="mt-1 space-y-0.5 text-meta text-inkSoft">
            {visitas.map((v, i) => (
              <li key={i} className="tabular-nums">{unaVisita(v, conPorque, conMotivo)}</li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

/** «lo recibió quien tiene el cargo de gerente en logística (decide las compras de la entidad)». */
function Recibio({ v }: { v?: CruceProveedor["visitas"][number] }) {
  if (!v?.cargoFuncionario && !v?.areaFuncionario) return null;
  return (
    <>
      {" "}y lo recibió quien tiene el cargo de {(v.cargoFuncionario ?? "funcionario").toLowerCase()}
      {v.areaFuncionario ? <> en {v.areaFuncionario.toLowerCase()}</> : ""}
      {v.decisor ? <b> (decide las compras de la entidad)</b> : ""}
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
  dada_de_baja: "Una empresa de baja ya no puede emitir comprobantes. Es su estado de hoy: la SUNAT no publica desde cuándo, así que no se afirma que lo estuviera cuando ganó.",
  suspendida: "La suspensión temporal es una pausa que la empresa declaró en sus actividades. Es su estado de hoy: la SUNAT no publica desde cuándo.",
  no_habida: "«No habido» quiere decir que la SUNAT no la encuentra en el domicilio fiscal que declaró. Es su estado de hoy: la SUNAT no publica desde cuándo.",
  aporte: "Quien financia una campaña y después contrata con el Estado puede tener un acceso que otros no tienen. No está prohibido, pero es un posible conflicto de interés.",
  aporte_empresa: "Quien financia una campaña y después contrata con el Estado puede tener un acceso que otros no tienen. No está prohibido, pero es un posible conflicto de interés.",
  candidato: "Las autoridades electas y sus parientes tienen impedimentos para contratar con el Estado, sobre todo en su jurisdicción. Una candidatura muestra el vínculo político de la empresa.",
  autoridad: "Las autoridades electas y sus parientes tienen impedimentos para contratar con el Estado, sobre todo en su jurisdicción.",
  penalidad: "Las penalidades se cobran por retrasos o incumplimientos: muestran cómo cumplió en contratos anteriores.",
  sancion: "El Tribunal sanciona faltas graves ante el Estado (documentos falsos, incumplimientos). Mientras una inhabilitación está vigente, la empresa no puede contratar.",
  sancion_vigente: "Con una inhabilitación vigente la empresa no podía contratar con el Estado: la entidad debía verificarlo en el RNP antes de dar la buena pro.",
  visita_previa: "Reunirse con funcionarios antes de la buena pro no es ilegal, pero el registro de visitas existe para transparentarlo. Una reunión con quien decide, o una visita «personal», merece revisión.",
  socio_comun: "Si dos postores que compiten comparten dueños o representantes, la competencia puede ser solo aparente (ofertas concertadas). Es una de las señales clásicas de colusión.",
  visita_repetida: "Ir varias veces donde el mismo funcionario puede ser seguir un trámite, pero también la forma de influir en una decisión. Pesa más si ese funcionario decide la compra; el registro de visitas existe para que se vea.",
  visita_fuera_horario: "Las visitas se registran en horario de atención: una de noche, de madrugada o en fin de semana es poco común y vale revisarla junto con el proceso que después ganó.",
  visita_antes_convocatoria: "La semana antes de convocar es cuando la entidad cierra las bases y los requisitos. Una reunión del futuro ganador en esos días merece revisar si las bases quedaron a su medida.",
  reunion_en_evaluacion: "Con las ofertas ya presentadas, lo que falta es evaluarlas, y el trato con los postores va por el SEACE. Una reunión del futuro ganador con quien decide las compras en esos días merece ver quién integró el comité y cómo se calificó a los demás postores.",
  visita_personal_decisor: "Una relación personal entre quien vende y quien decide la compra es un posible conflicto de intereses: al funcionario le toca declararlo y apartarse. El registro sólo dice que la visita se anotó como personal; puede ser un familiar o un error al llenar el motivo.",
  ofertas_a_la_vez: "Dos empresas que compiten y comparten un dueño o representante ya son una señal de competencia aparente. Que además registren sus ofertas una tras otra sugiere que las preparó la misma mano.",
  firma_en_plazo_de_apelacion: "Mientras corre el plazo para apelar, los otros postores pueden pedir que se revise la buena pro. Firmar antes deja el contrato hecho antes de que nadie pueda reclamar: la norma manda esperar el consentimiento. Vale mirar si alguien apeló y qué pasó con esa apelación.",
  comite_mismo_ganador: "Quien integra el comité decide quién cumple los requisitos y cómo se puntúa. Que la misma persona esté una y otra vez donde gana la misma empresa, y que esa empresa gane mucho menos cuando ella no está, es el patrón del evaluador que favorece a un proveedor. Vale ver los otros procesos de esa persona, cómo se calificó a los demás postores y si declaró algún vínculo con la empresa.",
  solo_admitido_el_ganador: "La admisión sólo revisa que cada oferta traiga los documentos obligatorios. Que con cuatro o más ofertas pase sólo la del ganador sugiere un requisito formal que sólo él podía cumplir, o postores puestos para aparentar competencia. Vale leer en el reporte el motivo de cada no admisión y comparar con las bases: si el requisito que dejó fuera a todos era razonable, si alguien lo consultó y si se repite en esa entidad.",
  trabajo_en_el_ganador: "Quien trabajó en una empresa, o todavía trabaja ahí, tiene un vínculo con ella que debe declarar y que lo obliga a apartarse de lo que la toque. Vale ver si el funcionario intervino en esta contratación: su área, si firmó el requerimiento o si integró el comité.",
  partido_gobernante: "La empresa, o una persona detrás de ella, aportó dinero al partido que gobierna la entidad que le dio el contrato: un posible conflicto de interés, el más directo de estos cruces.",
  vendio_gobernante: "La empresa, o una persona detrás de ella, le vendió a la campaña del partido que gobierna la entidad. Es una relación comercial, no un aporte: pesa según el monto.",
  proveedor_campana: "Es una relación comercial con un partido político. Pesa más cuando es el partido que gobierna la entidad, y menos en cadenas grandes que le venden a todos.",
  recurrente: "Ganarle muchas veces a la misma entidad puede ser buena competencia o un proveedor cautivo. Vale mirar cuántos postores hubo en cada proceso.",
  sobreprecio: "Comparado con lo que pagaron otras entidades del Estado por el mismo código CUBSO y la misma unidad, ese año y el anterior, desde 5 entidades. Puede tener explicación (poca cantidad, transporte a zonas lejanas, otra calidad): no prueba por sí solo un sobreprecio.",
  adicional: "Los adicionales tienen topes legales: 25 % en bienes y servicios, y 15 % en obras sin autorización de la Contraloría. Cerca del tope merece revisión.",
  otro_postor: "Cuando el ganador no firma o pierde la buena pro, se adjudica al siguiente postor con su propia oferta: el Estado paga más. Vale ver en el expediente por qué no firmó el primero.",
  fraccionamiento: "Partir una compra en órdenes pequeñas para no hacer un proceso de selección está prohibido. Varias órdenes el mismo día, al mismo proveedor y por encima del tope, son el patrón que se busca.",
  unico_postor: "Un proceso con un solo postor no tuvo competencia: puede ser un rubro muy chico o un requerimiento hecho a la medida de un proveedor. Vale ver si las bases eran restrictivas, sobre todo si el monto es alto o se adjudicó al tope del valor referencial.",
  tribunal_sancionador: "Presentar documentos falsos o información inexacta es la infracción más grave de la ley de contrataciones: se sanciona con inhabilitación de hasta diez años. Vale ver qué documento cuestionó el Tribunal, si la empresa ya fue sancionada (Historial) y si sigue ganando contratos mientras se investiga.",
  tribunal_revoco_buena_pro: "Que el Tribunal revoque una buena pro dice que el comité calificó mal: dejó pasar una oferta que no cumplía o descalificó mal a otra. Vale leer la resolución para ver qué no cumplía y mirar si a la misma empresa le pasó en otras entidades.",
  gana_con_sancionador_abierto: "La entidad no puede rechazar una oferta por un sancionador en trámite, pero sí debe verificar los documentos de la oferta. Si la empresa ya estaba bajo investigación por documentos falsos, vale revisar con lupa la experiencia y los certificados que presentó en este proceso.",
  comite_competencia_restringida: "Quien integra el comité decide quién cumple los requisitos. Si en los procesos de una misma persona la competencia queda restringida (un solo postor, descalificaciones, sólo el ganador admitido) mucho más que en el resto de la entidad, y eso no se explica por azar, es el patrón del evaluador que filtra a los postores. Vale leer en las actas por qué quedaron fuera los demás y si los requisitos se pidieron igual en todos los procesos.",
  comite_socio_proveedor: "Quien integra el comité decide quién cumple y cómo se puntúa. Si además es socio, gerente o representante de una empresa que le vende a su entidad, está en el impedimento de la ley de contrataciones: el funcionario y sus empresas no pueden contratar con su entidad mientras ejerce y hasta doce meses después. Vale confirmar que sea la misma persona, ver si se apartó del comité y revisar cómo se evaluó a los demás postores.",
  socio_en_entidad: "Que un dueño o representante del proveedor esté en la planilla o la lista de locadores de la MISMA entidad que lo contrata es un conflicto de interés directo: quien decide y quien vende pueden ser la misma red. Merece revisar el expediente.",
  pariente_funcionario: "La Ley 32069 impide contratar con la entidad a los parientes de ciertos funcionarios (los que deciden o influyen en la compra). Que un familiar declarado de un funcionario de la misma entidad sea dueño o representante del ganador merece ver en el expediente quién intervino y si se apartó.",
  turno_postores: "Cuando dos empresas con los mismos dueños o la misma dirección compiten una y otra vez y se reparten las buenas pro, la competencia puede ser sólo aparente: es el patrón de la rotación de ofertas. Vale ver quién más se presentó y a qué precios.",
  postor_de_relleno: "Una oferta de cobertura es la que se presenta para perder: da la apariencia de competencia y deja ganar a otra. Una empresa que casi nunca gana y aparece una y otra vez junto al mismo ganador encaja en ese patrón. Vale comparar los precios que ofertó y si sus propuestas llegaron completas.",
  consorcio_rival: "Dos empresas que postularon juntas en un consorcio conocen sus costos y sus precios. Si después compiten por separado en procesos de pocos postores y gana siempre una de las dos, la competencia puede ser sólo aparente. No lo prueba: en mercados de pocos proveedores es común asociarse a veces y competir otras.",
  mismo_dueno: "La concentración de un proveedor se mide por su RUC. Si una persona vende lo mismo a la misma entidad con dos empresas, ninguna parece dominante, cada compra queda bajo el tope que obligaría a un procedimiento con más competencia, y si una es sancionada sigue la otra. Vale revisar si las compras debieron agruparse en un solo proceso (fraccionamiento) y si las dos empresas se presentaron como competidoras entre sí.",
  socio_de_inhabilitada: "Inhabilitar a una empresa no sirve si sus dueños siguen vendiendo con otra razón social. Por eso la ley extiende el impedimento a las empresas del mismo rubro de esos mismos socios mientras dure la sanción, y contratar con un impedido es causa de nulidad del contrato y de una nueva sanción. Corresponde ver el porcentaje del socio en las dos empresas, si venden lo mismo y si la ganadora declaró bajo juramento no tener impedimento.",
  gano_tras_observacion: "Cuando la Contraloría observa un proceso, la entidad recibe el informe y sus recomendaciones. Que después le vuelva a adjudicar al mismo proveedor no está prohibido: el informe señala a funcionarios, no sanciona a la empresa. Pero es el momento de ver si lo observado se corrigió: si las bases, la evaluación o la conformidad repiten lo que el informe encontró.",
  observado_por_contraloria: "Un informe de control es el resultado de una auditoría o de un servicio de control: los auditores de la Contraloría revisaron este proceso y dejaron por escrito lo que encontraron. La responsabilidad que identifican es presunta y es de funcionarios y servidores, no del proveedor; la derivan al Ministerio Público, a la procuraduría o a un procedimiento sancionador. Vale leer la observación completa y ver en qué quedó.",
  socio_con_informe_control: "Un informe de control señala responsabilidad cuando los auditores de la Contraloría encuentran que un funcionario incumplió sus funciones o causó un perjuicio, y la deriva: la penal, al Ministerio Público; la civil, a la procuraduría; la administrativa, a la entidad o al procedimiento sancionador de la Contraloría. Es presunta: no es una condena ni impide contratar con el Estado. Que una persona comprendida en un informe sea dueña o representante de la empresa que después gana merece leer qué le señaló el informe, ver si se parece a lo que se contrató y, si es la misma entidad, si esa persona intervino en la compra.",
  contrato_sobre_adjudicado: "La buena pro fija cuánto paga el Estado: el contrato sólo puede subir después por adicionales aprobados, con su tope. Si el contrato nace con un monto mayor al de la oferta ganadora, alguien cambió el precio fuera de la competencia. Cuando el monto firmado coincide con el valor referencial, vale preguntar por qué no se respetó la rebaja que ofreció el ganador.",
  retencion_sobre_tope: "Una carta fianza obliga a un banco a pagar si el contratista incumple. Con la retención de pagos el Estado sólo tiene lo que le fue descontando al propio contratista, y nada al inicio del contrato. Por eso el Reglamento la limita a contratos chicos o a micro y pequeñas empresas. Si una empresa grande garantiza así un contrato grande, la entidad aceptó menos protección de la que la norma exige: corresponde pedir la constancia de MYPE del contratista y ver quién aceptó la garantía.",
  renovacion_mas_cara: "Un servicio que se renueva debería costar parecido por mes, salvo que cambie su alcance. Una subida grande de un contrato al siguiente merece comparar los términos de referencia de los dos: sedes, personal, horarios y equipos. Si el alcance es el mismo, la entidad tendría que explicar por qué paga más. Pesa más cuando el proveedor es el mismo.",
  puerta_giratoria: "Quien trabajó en una entidad conoce sus necesidades, sus presupuestos y a quienes deciden. La Ley 32069 impide contratar con la entidad a ciertos ex funcionarios durante un tiempo tras dejar el cargo. Que la empresa de alguien que acaba de salir gane ahí merece ver en el expediente qué cargo tenía y si intervino en el requerimiento. El empate es por nombre completo: hay que confirmarlo.",
  empresa_espejo: "Una empresa inhabilitada no puede contratar con el Estado. Si la misma gente sigue ganando con otra razón social mientras dura la sanción, la sanción pierde efecto: vale revisar si la empresa nueva tiene los mismos dueños, el mismo local o el mismo personal clave que la sancionada.",
  interes_declarado: "La Ley 31227 obliga a los funcionarios a declarar sus intereses para que se aparten de las decisiones sobre las empresas en las que los tienen. Que una de ellas le gane un contrato a su propia entidad merece ver en el expediente si se apartó.",
  empleo_declarado: "Haber trabajado para una empresa no impide comprarle, pero quien decide debe apartarse si el vínculo es reciente. Pesa más si la buena pro llegó mientras todavía trabajaba para ella.",
  domicilio_compartido: "Dos empresas con la misma dirección fiscal que se presentan al mismo proceso pueden ser la misma mano detrás de las dos: la competencia sería solo aparente. No prueba un vínculo por sí solo (puede ser un estudio contable o un edificio de oficinas); por eso no cuentan las direcciones con más de 5 empresas.",
  proveedor_cautivo: "Una empresa que vive casi por completo de una sola entidad es muy dependiente de ella: vale ver si se creó para servirla o si hay una relación demasiado estrecha. No es una irregularidad por sí misma.",
  recien_fundada: RECIEN_FUNDADA_POR_QUE,
  recien_fundada_medio_ano: RECIEN_FUNDADA_POR_QUE,
  recien_fundada_un_ano: RECIEN_FUNDADA_POR_QUE,
  recien_fundada_dos_anos: RECIEN_FUNDADA_POR_QUE,
};
// La obra del contrato en INFOBRAS y su inversión en Invierte.pe (migración 160): por qué mirar cada banda.
const POR_QUE_OBRA: Record<string, string> = {
  obra_paralizada: "Una obra paralizada deja a la gente sin lo que se pagó y suele encarecerse al retomarse. La causa puede ser de la entidad (falta de pago o de presupuesto, un expediente técnico deficiente) o del contratista: INFOBRAS dice la que registró la entidad.",
  obra_atraso: "El avance físico se compara con lo que la obra debía llevar a esa fecha según su calendario. Un atraso grande anticipa ampliaciones de plazo, penalidades o una paralización.",
  obra_pago: "Si lo pagado va muy por encima de lo construido, el Estado adelantó dinero por obra que todavía no existe: el riesgo es quedarse con la plata entregada y la obra a medias. Puede haber un adelanto contractual; vale revisarlo.",
  obra_adicionales: "Los adicionales de obra (trabajos extra que se pagan aparte) tienen un tope: hasta el 15 % del contrato, restando los deductivos, con la sola aprobación de la entidad; por encima, hace falta la autorización previa de la Contraloría.",
  obra_plazo: "Las ampliaciones de plazo son normales en una obra, pero cuando suman tanto como el plazo original suelen traer más costos (mayores gastos generales) y retrasan el servicio.",
  obra_controversia: "Una controversia que llega a un arbitraje o una conciliación suele terminar en pagos extra o en una obra detenida mientras se resuelve.",
  obra_informe_control: "La Contraloría revisa obras durante su ejecución y señala riesgos o problemas. Que haya un informe no es una condena: dice que vale leerlo.",
  inversion_sobrecosto: "Comparar el monto con que se aprobó una inversión con lo que cuesta hoy muestra cuánto se encareció. Puede tener explicación (un expediente técnico más completo, precios nuevos), pero un sobrecosto grande merece revisarse.",
  inversion_laudo: "Un laudo arbitral es la decisión de los árbitros en una controversia entre la entidad y el contratista: suele significar pagos que no estaban en el contrato.",
};
POR_QUE.obra_paralizada = POR_QUE.obra_paralizada_larga = POR_QUE.obra_paralizacion = POR_QUE_OBRA.obra_paralizada;
POR_QUE.obra_atraso = POR_QUE.obra_atraso_grave = POR_QUE_OBRA.obra_atraso;
POR_QUE.obra_pago_adelantado = POR_QUE.obra_pagado_sin_avance = POR_QUE_OBRA.obra_pago;
POR_QUE.obra_adicionales = POR_QUE.obra_adicionales_altos = POR_QUE.obra_adicionales_sobre_tope = POR_QUE_OBRA.obra_adicionales;
POR_QUE.obra_plazo_ampliado = POR_QUE.obra_plazo_duplicado = POR_QUE_OBRA.obra_plazo;
POR_QUE.obra_controversia = POR_QUE_OBRA.obra_controversia;
POR_QUE.obra_informe_control = POR_QUE_OBRA.obra_informe_control;
POR_QUE.inversion_sobrecosto = POR_QUE.inversion_sobrecosto_extremo = POR_QUE_OBRA.inversion_sobrecosto;
POR_QUE.inversion_laudo = POR_QUE_OBRA.inversion_laudo;

// El acta y las consultas, leídos con Claude (migración 246): por qué mirar cada una.
POR_QUE.acta_solo_queda_el_ganador = "Que todos los demás postores queden fuera puede ser legítimo (no cumplían), pero si pasa seguido en una entidad o por requisitos muy específicos, la competencia fue sólo de nombre. Vale leer los motivos en el acta.";
POR_QUE.acta_descalificados_por_formalidad = "La norma pide subsanar los errores formales en vez de descalificar por ellos. Sacar a un postor por una firma, el foliado o un formato, sobre todo si su oferta era mejor, merece revisarse.";
POR_QUE.acta_oferta_mas_baja_descartada = "Cuando la oferta más baja queda fuera, el Estado paga más. Puede ser correcto si no cumplía lo pedido; el motivo está en el acta y vale leerlo.";
POR_QUE.consultas_denuncia_direccionamiento = "En las consultas y observaciones los participantes pueden reclamar que un requisito favorece a alguien. Que alguien lo diga por escrito no prueba nada, pero es una pista para revisar las bases y quién ganó.";
POR_QUE.bases_marca_sin_equivalente = "Exigir una marca deja fuera a quien ofrece lo mismo de otro fabricante: la norma pide describir lo que se necesita y, si se nombra una marca, admitir «o equivalente». Puede justificarse (repuestos, compatibilidad), pero merece revisarse.";
POR_QUE.bases_experiencia_alta = "Pedir mucha experiencia previa reduce la competencia a las empresas más grandes o a una sola. Que lo exigido triplique el valor de la compra merece ver si se justificó.";
POR_QUE.consultas_observaciones_a_requisitos_rechazadas = "Si varios participantes piden flexibilizar los requisitos y la entidad no acoge ninguno, los requisitos pueden estar dejando fuera a la competencia.";

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
          <Partido nombre={txt(d.partido)} anio={d.hasta ?? d.desde ?? c.fecha} />
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
          {quien(c)} postuló{txt(d.cargo) ? ` a ${txt(d.cargo)!.toLowerCase()}` : ""} por <Partido nombre={txt(d.organizacion)} anio={d.proceso} />
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
          {txt(d.organizacion) ? <> por <Partido nombre={txt(d.organizacion)} anio={d.desde ?? c.fecha} /></> : ""}
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
    // Las sanciones de cada tipo van en tabla (GrupoSanciones); aquí, la que seguía vigente al ganar ESTE proceso, que es
    // una sola frase, y la forma de siempre si alguna llega sola por otro camino.
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
          {/* Migración 337: la ficha del proveedor en el OECE dice hoy que el Tribunal la sustituyó o la dio por terminada. */}
          {txt(d.segun_ficha) && (
            <span className="mt-1 flex items-start gap-1.5 text-mossTexto">
              <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {txt(d.estado) === "sustituida o levantada" ? "Sustituida o levantada" : "Terminada"}: {txt(d.segun_ficha)}
                {txt(d.ficha_consultada) ? ` (consultada el ${fechaCorta(txt(d.ficha_consultada)!)})` : ""}.
              </span>
            </span>
          )}
        </>
      );
    }
    case "visita_previa": {
      const v = c.visitas[0];
      const dias = n(d.dias_antes);
      return (
        <>
          {quien(c, v?.rol ?? null, v?.visitante ?? undefined)} visitó <Entidad nombre={v?.entidad ?? "una entidad"} ruc={c.referencias?.entidadVisitadaRuc} />
          {d.misma_entidad === true ? <b> (la misma entidad que contrató)</b> : ""} el {fechaConAnio(v?.fecha ?? c.fecha)}
          {/* En qué etapa del procedimiento cayó (migración 329). */}
          {v?.etapa && ETAPA_VISITA[v.etapa] ? <>, <b>{ETAPA_VISITA[v.etapa]}</b>,</> : ""}
          {/* De quien recibió, sólo su cargo y su área: su nombre no se publica. */}
          {v?.cargoFuncionario || v?.areaFuncionario ? (
            <>
              {" "}y lo recibió quien tiene el cargo de {(v.cargoFuncionario ?? "funcionario").toLowerCase()}
              {v.areaFuncionario ? <> en {v.areaFuncionario.toLowerCase()}</> : ""}
              {v.decisor ? <b> (decide las compras de la entidad)</b> : ""}
            </>
          ) : ""}
          .{v?.motivo ? <> Motivo declarado: «{v.motivo.slice(0, 120)}».</> : ""}
          <Gano c={c} dias={dias} />
        </>
      );
    }
    case "visita_repetida": {
      const v = c.visitas[0];
      const dias = n(d.dias) ?? c.visitas.length;
      const total = n(d.visitas_n);
      return (
        <>
          {quien(c, v?.rol ?? null, v?.visitante ?? undefined)} visitó en <b>{numero(dias)} días distintos</b> a quien tiene el cargo de{" "}
          {(v?.cargoFuncionario ?? "funcionario").toLowerCase()}
          {v?.areaFuncionario ? <> en {v.areaFuncionario.toLowerCase()}</> : ""} de <Entidad nombre={txt(d.entidad_visitada) ?? "la entidad"} ruc={c.referencias?.entidadVisitadaRuc} />
          {d.misma_entidad === true ? <b> (la misma entidad que contrató)</b> : ""}
          {v?.decisor ? <b>, que decide las compras de la entidad</b> : ""}, en los 180 días antes de la buena pro
          {total != null && total > dias ? ` (${numero(total)} visitas en total)` : ""}.
          <VisitasEnLinea visitas={c.visitas} />
          <Gano c={c} dias={n(d.dias_antes)} />
        </>
      );
    }
    case "visita_fuera_horario": {
      const v = c.visitas[0];
      return (
        <>
          {quien(c, v?.rol ?? null, v?.visitante ?? undefined)} visitó <Entidad nombre={txt(d.entidad_visitada) ?? "la entidad"} ruc={c.referencias?.entidadVisitadaRuc} />
          {d.misma_entidad === true ? <b> (la misma entidad que contrató)</b> : ""} fuera del horario de atención (de noche, de madrugada
          o en fin de semana), en los 180 días antes de la buena pro.
          <VisitasEnLinea visitas={c.visitas} conPorque />
          <Gano c={c} dias={n(d.dias_antes)} />
        </>
      );
    }
    case "visita_antes_convocatoria": {
      const v = c.visitas[c.visitas.length - 1];
      const antes = n(d.dias_antes_convocatoria);
      const conv = txt(d.convocatoria);
      return (
        <>
          {quien(c, v?.rol ?? null, v?.visitante ?? undefined)} visitó <Entidad nombre={txt(d.entidad_visitada) ?? "la entidad"} ruc={c.referencias?.entidadVisitadaRuc} />{" "}
          {antes === 0 ? "el mismo día" : <b>{numero(antes ?? 0)} {antes === 1 ? "día" : "días"} antes</b>} de que se convocara este proceso
          {conv ? ` (convocatoria del ${fechaCorta(conv)})` : ""}
          <Recibio v={v} />.
          {c.visitas.length > 1 && <VisitasEnLinea visitas={c.visitas} />}
          <Gano c={c} />
        </>
      );
    }
    case "reunion_en_evaluacion": {
      const v = c.visitas[c.visitas.length - 1];
      const dura = n(d.dias_evaluacion);
      const oferta = txt(d.oferta);
      return (
        <>
          {quien(c, v?.rol ?? null, v?.visitante ?? undefined)} visitó <Entidad nombre={txt(d.entidad_visitada) ?? "la entidad"} ruc={c.referencias?.entidadVisitadaRuc} />{" "}
          <b>después de presentar su oferta</b>{oferta ? ` (el ${fechaCorta(oferta)})` : ""} y antes de la buena pro
          {dura != null && dura > 0 ? `, en los ${numero(dura)} días que duró la evaluación` : ""}
          <Recibio v={v} />.{" "}
          {d.ya_proveedor === true
            ? "La empresa ya le vendía a la entidad: la visita puede ser por lo que ya tenía contratado."
            : <>La empresa <b>no le había vendido</b> a la entidad ese año ni el anterior.</>}
          <VisitasEnLinea visitas={c.visitas} conMotivo />
          <Gano c={c} />
        </>
      );
    }
    case "visita_personal_decisor": {
      const v = c.visitas[0];
      const dias = n(d.dias) ?? c.visitas.length;
      const meses = n(d.meses);
      return (
        <>
          {quien(c, v?.rol ?? null, v?.visitante ?? undefined)} visitó en <b>{numero(dias)} días distintos</b>
          {meses != null && meses > 1 ? ` de ${numero(meses)} meses` : ""}, declarando «visita personal», a quien tiene el cargo de{" "}
          {(v?.cargoFuncionario ?? "funcionario").toLowerCase()}
          {v?.areaFuncionario ? <> en {v.areaFuncionario.toLowerCase()}</> : ""} de <Entidad nombre={txt(d.entidad_visitada) ?? "la entidad"} ruc={c.referencias?.entidadVisitadaRuc} />
          <b>, que decide las compras de la entidad</b>, en el año anterior a la buena pro.
          <VisitasEnLinea visitas={c.visitas} />
          <Gano c={c} dias={n(d.dias_antes)} />
        </>
      );
    }
    case "ofertas_a_la_vez": {
      const otros = c.otrosPostores ?? (Array.isArray(d.otros_postores) ? (d.otros_postores as string[]).map((ruc) => ({ ruc, nombre: null })) : []);
      const rolOtro = Array.isArray(d.rol_en_otros) ? (d.rol_en_otros as string[]).map((r) => r.toLowerCase().replace(/_/g, " ").replace("socio accionista titular", "socio")).join(", ") : null;
      const min = n(d.minutos);
      return (
        <>
          {quien(c)} también figura{rolOtro ? ` como ${rolOtro}` : ""} en{" "}
          {otros.map((o, i) => (
            <span key={o.ruc}>
              {i > 0 && ", "}
              <OtraEmpresa ruc={o.ruc} nombre={o.nombre} conRuc />
            </span>
          ))}
          , que compitió en este mismo proceso{n(d.item) != null ? ` (ítem ${numero(n(d.item)!)})` : ""}. Las dos ofertas se registraron en el SEACE con{" "}
          <b>{min == null ? "pocos minutos" : min < 1 ? "menos de un minuto" : `${numero(Math.round(min))} ${Math.round(min) === 1 ? "minuto" : "minutos"}`} de diferencia</b>
          {txt(d.hora_ganador) && txt(d.hora_otro) ? ` (a las ${txt(d.hora_ganador)} y a las ${txt(d.hora_otro)})` : ""}.
          <Gano c={c} />
        </>
      );
    }
    case "firma_en_plazo_de_apelacion": {
      const dias = n(d.dias_habiles);
      const ofertas = n(d.ofertas);
      const firma = txt(d.firma);
      const bp = txt(d.buena_pro);
      const cons = txt(d.consentimiento_registrado);
      return (
        <>
          La entidad firmó el contrato con <Emp c={c} />
          {firma ? <> el <b>{fechaConAnio(firma)}</b></> : ""},{" "}
          <b>{dias == null ? "pocos días" : dias === 0 ? "el mismo día de la buena pro" : `${numero(dias)} ${dias === 1 ? "día hábil" : "días hábiles"} después de la buena pro`}</b>
          {bp && dias !== 0 ? ` (del ${fechaConAnio(bp)})` : ""}. En {n(d.item) != null ? `el ítem ${numero(n(d.item)!)}` : "ese ítem"} hubo{" "}
          {ofertas != null ? `${numero(ofertas)} ofertas` : "más de una oferta"}: los otros postores tenían al menos 5 días hábiles para apelar, y el
          contrato se firma recién después del consentimiento{txt(d.norma) ? ` (${txt(d.norma)})` : ""}.
          {cons ? ` CONOSCE registra el consentimiento el ${fechaConAnio(cons)}.` : ""}
        </>
      );
    }
    case "comite_mismo_ganador": {
      // Del integrante, sólo su papel en el comité: nunca su nombre (como los demás indicadores en observación).
      const k = n(d.veces);
      const total = n(d.procesos_de_la_persona);
      const con = typeof d.parte_con_la_persona === "number" ? Math.round(d.parte_con_la_persona * 100) : null;
      const sin = typeof d.parte_sin_la_persona === "number" ? Math.round(d.parte_sin_la_persona * 100) : null;
      const rol = txt(d.rol)?.toLowerCase();
      return (
        <>
          Una misma persona del comité de selección{rol ? ` (${rol})` : ""} estuvo en <b>{k != null ? `${numero(k)} procesos` : "varios procesos"}</b> de
          esta entidad que ganó <Emp c={c} />
          {total != null ? <>: {numero(k ?? 0)} de sus {numero(total)} procesos{con != null ? ` (${con} %)` : ""}</> : ""}.{" "}
          {sin != null ? (
            <>En los procesos de la entidad sin esa persona, la empresa gana el <b>{sin} %</b>.</>
          ) : (
            <>La entidad no tiene otros procesos leídos sin esa persona para comparar: pesa poco.</>
          )}{" "}
          Sale de las actas que leyeron los agentes, con cada nombre comprobado en el documento
          {n(d.pagina) != null ? ` (página ${numero(n(d.pagina)!)} del acta)` : ""}.
        </>
      );
    }
    case "comite_competencia_restringida": {
      // Migración 415. Del integrante, sólo su papel en el comité: nunca su nombre.
      const rol = txt(d.rol)?.toLowerCase();
      const m = n(d.restringidos);
      const total = n(d.procesos_de_la_persona);
      const base = typeof d.tasa_entidad === "number" ? Math.round(d.tasa_entidad * 100) : null;
      const pv = typeof d.p_valor === "number" ? d.p_valor : null;
      const nombres: Record<string, string> = { unico_postor: "un solo postor", acta_solo_queda_el_ganador: "el acta deja sólo al ganador", acta_descalificados_por_formalidad: "descalificaciones por formalidad", acta_oferta_mas_baja_descartada: "la oferta más baja descartada", solo_admitido_el_ganador: "sólo se admitió al ganador" };
      const marcas = Array.isArray(d.marcas) ? (d.marcas as string[]).map((x) => nombres[x] ?? x) : [];
      return (
        <>
          Una misma persona del comité de selección{rol ? ` (${rol})` : ""} estuvo en {total != null ? `${numero(total)} procesos` : "varios procesos"} de esta
          entidad y en <b>{m != null ? numero(m) : "muchos"}</b> la competencia quedó restringida{base != null ? <>; en los demás procesos de la entidad pasa en el <b>{base} %</b></> : ""}.{" "}
          {pv != null ? `Que sea azar tiene una probabilidad de ${pv < 0.001 ? "menos de 1 en 1 000" : `1 en ${numero(Math.round(1 / pv))}`}. ` : ""}
          {marcas.length ? `En este proceso: ${marcas.join(", ")}; lo ganó ` : "Este proceso lo ganó "}<Emp c={c} />.{" "}
          Sale de las actas que leyeron Vigía y sus agentes, con cada nombre comprobado en el documento.
        </>
      );
    }
    case "comite_socio_proveedor": {
      // Migración 407. Del integrante, sólo su papel en el comité y en la empresa: nunca su nombre ni su DNI.
      const rol = txt(d.rol)?.toLowerCase();
      const roles = Array.isArray(d.rol_en_empresa) ? (d.rol_en_empresa as string[]) : [];
      const papel = roles.includes("REPRESENTANTE_LEGAL") ? "representante legal"
        : roles.includes("ORGANO_ADMINISTRACION") ? "gerente o directivo" : "socio";
      const total = n(d.procesos_de_la_persona);
      const desde = txt(d.socio_desde);
      const identidad: Record<string, string> = {
        documento: "Su DNI del registro aparece entre las personas con órdenes de esta entidad: es la misma persona.",
        nombre_completo: "Coincide su nombre completo, de cuatro palabras o más: muy probablemente es la misma persona.",
        nombre: "Coincide un nombre de tres palabras: hay que confirmar que no sea un homónimo.",
      };
      const cuando: Record<string, string> = {
        a_la_vez: "La buena pro cayó mientras esa persona integraba comités en la entidad.",
        cerca: "La buena pro cayó a un año o menos de sus procesos en el comité.",
        lejos: "La buena pro queda a más de un año de sus procesos en el comité: no se sabe si entonces trabajaba en la entidad, pesa poco.",
      };
      return (
        <>
          {d.en_su_comite ? (
            <><b>Esta empresa ganó un proceso en cuyo comité estuvo esa persona.</b>{" "}</>
          ) : null}
          Una persona que integró el comité de selección de esta entidad{rol ? ` (${rol})` : ""}
          {total != null ? ` en ${numero(total)} ${total === 1 ? "proceso" : "procesos"}` : ""} figura en el Registro Nacional de
          Proveedores como <b>{papel}</b> de <Emp c={c} />{desde ? ` desde ${fechaConAnio(desde)}` : ""}.{" "}
          {cuando[txt(d.cuando) ?? ""] ?? ""}{" "}
          {d.socio_al_ganar === false ? "El vínculo con la empresa no regía el día de la buena pro. " : ""}
          {identidad[txt(d.identidad) ?? ""] ?? ""}{" "}
          Sale de las actas que leyeron los agentes, con el nombre comprobado en el documento
          {n(d.pagina) != null ? ` (página ${numero(n(d.pagina)!)} del acta)` : ""}.
        </>
      );
    }
    case "tribunal_sancionador":
    case "tribunal_revoco_buena_pro":
    case "gana_con_sancionador_abierto": {
      // Migración 424: las partes de una apelación que leyó Vigía. La resolución va como fuente (fuenteUrl).
      const res = txt(d.resolucion);
      const inf = Array.isArray(d.infraccion) ? (d.infraccion as string[]) : [];
      const infraccion = inf.includes("documentacion_falsa") && inf.includes("informacion_inexacta")
        ? "documentación falsa o información inexacta"
        : inf.includes("documentacion_falsa") ? "documentación falsa"
          : inf.includes("informacion_inexacta") ? "información inexacta" : null;
      const laResolucion = res ? <>la <b>{res}</b></> : "una resolución";
      if (c.tipo === "tribunal_revoco_buena_pro") {
        const ef = Array.isArray(d.efectos) ? (d.efectos as string[]) : [];
        return (
          <>
            El comité le dio la buena pro a <Emp c={c} /> y el Tribunal de Contrataciones, al resolver la apelación de otro postor
            en {laResolucion}{c.fecha ? <> del {fechaConAnio(c.fecha)}</> : ""}, {ef.includes("revoca_buena_pro") ? "la revocó" : "descalificó su oferta"}.
            Lo leyó Vigía en la resolución, con el nombre comprobado en el texto.
          </>
        );
      }
      if (c.tipo === "tribunal_sancionador") {
        return (
          <>
            Al resolver una apelación en este proceso, el Tribunal de Contrataciones ordenó en {laResolucion}
            {c.fecha ? <> del {fechaConAnio(c.fecha)}</> : ""} abrir un procedimiento administrativo sancionador contra <Emp c={c} />
            {infraccion ? <> por presunta <b>{infraccion}</b> en su oferta</> : " por lo que presentó en su oferta"}. Es la orden de
            investigar, no la sanción.
          </>
        );
      }
      const dias = n(d.dias_despues);
      const origen = txt(d.ocid_origen);
      return (
        <>
          <Emp c={c} /> ganó este proceso{dias != null ? <> <b>{numero(dias)} días</b> después</> : " después"} de que el Tribunal de
          Contrataciones ordenara abrirle un procedimiento sancionador{infraccion ? <> por presunta <b>{infraccion}</b></> : ""} en{" "}
          {origen ? (
            <Link href={rutaContrato(origen, "ficha")} prefetch={false} className={ENLACE_TXT}>otro proceso</Link>
          ) : "otro proceso"}
          {res ? <> ({res})</> : ""}, y sin una sanción registrada antes de la buena pro.
        </>
      );
    }
    case "solo_admitido_el_ganador": {
      const ofertas = n(d.ofertas);
      const fuera = n(d.no_admitidas);
      const item = n(d.item);
      const empresas = Array.isArray(d.fuera_empresas) ? (d.fuera_empresas as { ruc: string; nombre: string | null }[]) : [];
      // La descripción del ítem viene cortada a 200 caracteres: se corta antes, en un espacio, y se dice que sigue.
      const largo = txt(d.descripcion_item);
      const desc = largo && largo.length > 110 ? `${largo.slice(0, 110).replace(/\s+\S*$/, "")}…` : largo;
      return (
        <>
          En {item != null ? `el ítem ${numero(item)}` : "este ítem"}
          {desc ? <> («{desc}»)</> : null} se presentaron <b>{ofertas != null ? `${numero(ofertas)} ofertas` : "cuatro o más ofertas"}</b> y el
          comité admitió <b>sólo la oferta</b> de <Emp c={c} />, que ganó
          {fuera != null ? `: ${numero(fuera)} ${fuera === 1 ? "quedó fuera" : "quedaron fuera"} antes de comparar precios` : ""}, según el
          reporte de evaluación que genera el SEACE.
          {empresas.length > 0 ? (
            <>
              {" "}No se admitió a{" "}
              {empresas.map((o, i) => (
                <span key={o.ruc}>
                  {i > 0 ? (i === empresas.length - 1 ? " ni a " : ", ") : ""}
                  <OtraEmpresa ruc={o.ruc} nombre={o.nombre} />
                </span>
              ))}
              {fuera != null && fuera > empresas.length ? `, ni a ${numero(fuera - empresas.length)} ${fuera - empresas.length === 1 ? "persona natural" : "personas naturales"}` : ""}.
            </>
          ) : null}
        </>
      );
    }
    case "trabajo_en_el_ganador": {
      const p = c.socios[0];
      const desde = txt(d.empleo_desde);
      const hasta = txt(d.empleo_hasta);
      const puesto = txt(d.cargo_en_la_empresa);
      const cuando: Record<string, string> = {
        a_la_vez: "Según su declaración, todavía trabajaba en la empresa el día de la buena pro.",
        despues: "Empezó a trabajar en la empresa después de la buena pro, cuando seguía en su cargo.",
        hasta_2_anios: "Había dejado ese empleo menos de dos años antes de la buena pro.",
        antes: "Había dejado ese empleo más de dos años antes de la buena pro.",
        sin_fechas: "Su declaración no dice desde cuándo ni hasta cuándo trabajó ahí.",
      };
      return (
        <>
          {p?.nombre ? <span className="font-semibold">{p.nombre}</span> : "Un funcionario"}
          <span className="text-inkSoft"> ({p?.rol ? oracion(p.rol) : "funcionario"} de la entidad)</span> declaró en su Declaración Jurada
          de Intereses haber trabajado en <Emp c={c} />
          {puesto ? <> como {puesto.toLowerCase()}</> : ""}
          {desde ? <>, desde el {fechaConAnio(desde)}{hasta ? <> hasta el {fechaConAnio(hasta)}</> : " sin fecha de salida"}</> : ""}. La entidad
          le dio esta buena pro mientras él ocupaba ese cargo. {cuando[txt(d.cuando) ?? ""] ?? ""}
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
              <OtraEmpresa ruc={o.ruc} nombre={o.nombre} conRuc />
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
          <Partido nombre={txt(d.organizacion)} anio={d.proceso} />
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
          {c.socios.length ? quien(c) : <Emp c={c} />} {accion} <Partido nombre={partido} anio={d.proceso ?? d.hasta ?? c.fecha} />
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
          {d.posible_paquete === true && (
            <span className="mt-1 flex items-start gap-1.5 text-amberTexto">
              <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>Dato dudoso: {txt(d.nota_paquete) ?? "el ítem parece agrupar varios productos"}. Revisa los renglones de la ficha antes de concluir.</span>
            </span>
          )}
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
      const rucOriginal = txt(d.ruc_original);
      return (
        <>
          La buena pro fue primero para{" "}
          {rucOriginal ? <OtraEmpresa ruc={rucOriginal} nombre={original} /> : original ? <b>{original}</b> : "otro postor"} por{" "}
          <b>{solesCompacto(n(d.monto_original))}</b>; se
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
          {fund ? ` (figura de alta en la SUNAT desde el ${fechaConAnio(fund)})` : ""}
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
          {quien(c)} es, además, <b>persona contratada por</b> <Entidad nombre={ent ? tituloNatural(ent) : "esta entidad"} ruc={c.entidadRuc} />
          {txt(d.servicio) ? <> ({oracion(txt(d.servicio)!).slice(0, 90)})</> : ""}
          {n(d.monto_persona) ? <>, por <b>{solesCompacto(n(d.monto_persona))}</b></> : ""}: la misma entidad que le dio el contrato a <Emp c={c} />.
          {/* Migración 395: cuán cerca estuvieron sus órdenes de la buena pro. */}
          {d.cuando === "a_la_vez" ? (
            <> <b>Tenía órdenes de la entidad cuando se dio la buena pro</b>{rango(d.primera_orden, d.ultima_orden) ? ` (sus órdenes: ${rango(d.primera_orden, d.ultima_orden)})` : ""}.</>
          ) : d.cuando === "cerca" ? (
            <> Sus órdenes ({rango(d.primera_orden, d.ultima_orden)}) quedan a menos de dos años de la buena pro.</>
          ) : d.cuando === "lejos" ? (
            <> Sus órdenes ({rango(d.primera_orden, d.ultima_orden)}) quedan a más de dos años de la buena pro: pesa poco.</>
          ) : null}
        </>
      );
    }
    case "pariente_funcionario": {
      // Ni el pariente ni el funcionario se identifican: el parentesco, el cargo y el papel en la empresa.
      const par = (txt(d.parentesco) ?? "familiar").toLowerCase().replace(/\((a|o)\)/g, "").replace(/ del declarante$/, "").trim();
      const cargo = txt(d.cargo_funcionario);
      const rol = txt(d.rol_en_empresa)?.toLowerCase().replace(/_/g, " ").replace("socio accionista titular", "socio").replace("organo administracion", "directivo") ?? null;
      return (
        <>
          Un <b>{par}</b> de un funcionario de esta entidad{cargo ? <> (cargo declarado: {cargo.toLowerCase()})</> : ""} figura en el RNP como{" "}
          <b>{rol ?? "parte"}</b> de <Emp c={c} />{txt(d.desde_en_empresa) ? ` desde el ${fechaConAnio(txt(d.desde_en_empresa)!)}` : ""}. Lo declaró el funcionario
          en su DJI ante la Contraloría. No se dice quiénes son.
          <Gano c={c} />
        </>
      );
    }
    case "turno_postores": {
      const otra = txt(d.otra_ruc);
      const via = txt(d.vinculo) ?? "";
      return (
        <>
          <Emp c={c} /> y {otra ? <OtraEmpresa ruc={otra} nombre={txt(d.otra)} conRuc /> : <b>otra empresa</b>}, que comparten{" "}
          {via.includes("persona") ? "un socio, representante o directivo (RNP)" : ""}
          {via.includes("persona") && via.includes("domicilio") ? " y " : ""}
          {via.includes("domicilio") ? "el domicilio fiscal (SUNAT)" : ""}, compitieron juntas en <b>{n(d.juntos) ?? "varios"} procesos</b> con pocos
          postores: esta ganó {n(d.gano_esta) ?? "algunos"} y la otra {n(d.gano_otra) ?? "otros"}. Este contrato es uno de los que ganó.
          <Gano c={c} />
        </>
      );
    }
    case "postor_de_relleno": {
      const otra = txt(d.ruc_acompanante);
      return (
        <>
          {otra ? <OtraEmpresa ruc={otra} nombre={txt(d.acompanante)} conRuc /> : <b>Otra empresa</b>} se presentó en{" "}
          <b>{n(d.juntos) ?? "varios"} procesos</b> que ganó <Emp c={c} /> y ganó sólo {n(d.ganadas_del_acompanante) ?? 0} de sus{" "}
          {n(d.postulaciones_del_acompanante) ?? "varias"} postulaciones{txt(d.vinculo) ? ". Además comparten un socio o representante (RNP)" : ""}. Este
          contrato es uno de esos procesos.
          <Gano c={c} />
        </>
      );
    }
    case "consorcio_rival": {
      const otra = txt(d.ruc_rival);
      return (
        <>
          <Emp c={c} /> y {otra ? <OtraEmpresa ruc={otra} nombre={txt(d.rival)} conRuc /> : <b>otro postor</b>} postularon juntas en{" "}
          <b>{n(d.consorcios_juntas) === 1 ? "un consorcio" : `${n(d.consorcios_juntas) ?? "varios"} consorcios`}</b> y, por separado, se enfrentaron en{" "}
          <b>{n(d.veces_rivales) ?? "varios"} procesos</b> de pocos postores: esta ganó {n(d.gano_esta) ?? "algunos"} y la otra {n(d.gano_la_rival) ?? 0}.
          {d.solas_las_dos === true ? " En este proceso fueron las únicas dos postoras." : ""}
          <Gano c={c} />
        </>
      );
    }
    case "mismo_dueno": {
      const otras = Array.isArray(d.otras_empresas) ? (d.otras_empresas as { ruc?: string; nombre?: string; procesos?: number }[]) : [];
      const par = txt(d.ocid_parecido);
      const dias = n(d.dias_de_diferencia);
      return (
        <>
          {quien(c)} es socio de <Emp c={c} /> y también de{" "}
          {/* recorte: tres nombres caben en la frase; las demás se cuentan a continuación («y N más») */}
          {otras.slice(0, 3).map((o, i) => (
            <span key={o.ruc ?? i}>
              {i > 0 ? (i === Math.min(otras.length, 3) - 1 ? " y " : ", ") : ""}
              {o.ruc && /^20\d{9}$/.test(o.ruc) ? (
                <a className="underline" href={`/empresa/${o.ruc}`}>
                  {o.nombre ?? o.ruc}
                </a>
              ) : (
                o.nombre ?? "otra empresa"
              )}
            </span>
          ))}
          {otras.length > 3 ? ` y ${otras.length - 3} más` : ""}, que en esta misma entidad{" "}
          {otras.length === 1 ? "ganó" : "ganaron"} <b>{n(d.procesos_de_las_otras) ?? "otros"} {n(d.procesos_de_las_otras) === 1 ? "proceso" : "procesos"}</b> por{" "}
          <b>{solesCompacto(n(d.monto_de_las_otras))}</b> en dos años. Uno es de objeto parecido a este
          {dias != null ? <>, con <b>{dias === 0 ? "la misma fecha de buena pro" : `${dias} ${dias === 1 ? "día" : "días"} de diferencia`}</b></> : ""}.{" "}
          {par ? (
            <a className="underline" href={`/app/contratos/${encodeURIComponent(par)}`}>
              Ver el otro proceso
            </a>
          ) : null}
          <Gano c={c} />
        </>
      );
    }
    case "socio_de_inhabilitada": {
      const sr = txt(d.sancionada_ruc);
      const hasta = txt(d.sancion_hasta);
      return (
        <>
          {quien(c)} es socio de <Emp c={c} /> y también de{" "}
          {sr && /^20\d{9}$/.test(sr) ? (
            <a className="underline" href={`/empresa/${sr}`}>
              {txt(d.sancionada) ?? sr}
            </a>
          ) : (
            txt(d.sancionada) ?? "otra empresa"
          )}
          , que tiene una <b>inhabilitación {txt(d.sancion) === "definitivo" ? "definitiva" : "temporal"}</b> para contratar con el Estado
          {txt(d.sancion_desde) ? <> desde el {fechaConAnio(txt(d.sancion_desde)!)}</> : ""}
          {hasta ? <> hasta el {fechaConAnio(hasta)}</> : ""}. Esta buena pro cae dentro de la sanción.
          {d.hecha_para_seguir === true
            ? txt(d.fundada) && txt(d.sancion_desde) && txt(d.fundada)! >= txt(d.sancion_desde)!
              ? <> La empresa ganadora se fundó el <b>{fechaConAnio(txt(d.fundada)!)}</b>, con la sanción ya en curso.</>
              : " La empresa ganadora se fundó, o el socio entró a ella, cerca del inicio de la sanción."
            : ""}
          {txt(d.consorcio) ? ` El proceso lo ganó ${tituloNatural(txt(d.consorcio)!)}, que esta empresa integra.` : ""} Falta confirmar el porcentaje del socio
          y que las dos empresas sean del mismo rubro.
          <Gano c={c} />
        </>
      );
    }
    case "gano_tras_observacion": {
      // Migración 315: antes de esta buena pro, un informe de control observó otro proceso que el proveedor ganó aquí.
      const numeroInf = txt(d.informe_numero) ?? txt(d.informe_codigo) ?? "sin número";
      const informe = informeDeDetalle(d);
      const resp = responsabilidadesEnPalabras(d.responsabilidades);
      const tema = TEMA_OBSERVACION_CONTROL[txt(d.tema) ?? ""];
      const perj = n(d.perjuicio);
      const dias = n(d.dias_despues);
      const nObs = n(d.n_procesos_observados);
      const observado = txt(d.proceso_observado);
      const nombreObservado = txt(d.proceso_observado_nomenclatura) ?? (txt(d.via_observado) === "cui" ? "una obra" : "otro proceso");
      return (
        <>
          Antes de esta buena pro, la Contraloría ya había observado{" "}
          {observado ? (
            <Link href={rutaContrato(observado, "ficha", { seccion: "antecedentes" })} prefetch={false} className={ENLACE_TXT}>
              {nombreObservado}
            </Link>
          ) : (
            nombreObservado
          )}
          , que <Emp c={c} /> ganó en esta misma entidad: lo hizo en el informe de control{" "}
          {informe ? <InformeEnPanel informe={informe} className={ENLACE_TXT} /> : <b>{numeroInf}</b>}
          {txt(d.emision) ? <>, emitido el {fechaConAnio(txt(d.emision)!)}</> : ""}
          {dias != null && dias > 0 ? <>, <b>{numero(dias)} días antes</b> de esta buena pro</> : ""}.
          {tema ? <> Esa observación trata de <b>{tema}</b>{perj != null && perj > 0 ? <> y cuantifica un perjuicio de <b>{txt(d.moneda) === "USD" ? `US$ ${numero(perj)}` : solesCompacto(perj)}</b></> : ""}.</> : ""}
          {resp ? <> El informe identifica <b>presunta responsabilidad {resp}</b> de funcionarios y servidores.</> : ""}
          {nObs != null && nObs > 1 ? <> Son <b>{numero(nObs)} procesos</b> suyos en esta entidad los que la Contraloría observó antes.</> : ""}
          {txt(d.consorcio) ? ` Este proceso lo ganó ${tituloNatural(txt(d.consorcio)!)}, que esta empresa integra.` : ""} El informe no sanciona al
          proveedor ni le impide contratar: vale ver si lo observado se corrigió.
        </>
      );
    }
    case "observado_por_contraloria": {
      // Migración 313: una observación de un informe de control nombra este proceso (o la obra del contrato, por su CUI).
      const numeroInf = txt(d.informe_numero) ?? txt(d.informe_codigo) ?? "sin número";
      const informe = informeDeDetalle(d);
      const resp = responsabilidadesEnPalabras(d.responsabilidades);
      const tema = TEMA_OBSERVACION_CONTROL[txt(d.tema) ?? ""];
      const perj = n(d.perjuicio);
      const nObs = n(d.n_observaciones);
      const nInf = n(d.n_informes);
      const via = txt(d.via);
      return (
        <>
          La Contraloría observó{" "}
          {via === "cui" ? (
            <>
              la obra de este contrato{txt(d.cui) ? <> (inversión <span className="font-mono tabular-nums">{txt(d.cui)}</span>)</> : ""}
            </>
          ) : (
            "este proceso"
          )}{" "}
          en el informe de control {informe ? <InformeEnPanel informe={informe} className={ENLACE_TXT} /> : <b>{numeroInf}</b>}
          {txt(d.emision) ? <>, emitido el {fechaConAnio(txt(d.emision)!)}</> : ""}
          {n(d.observacion_n) != null ? (
            <>
              : su observación {n(d.observacion_n)}
              {tema ? <> trata de <b>{tema}</b></> : " lo nombra"}
            </>
          ) : (
            ""
          )}
          {perj != null && perj > 0 ? <> y cuantifica un perjuicio de <b>{txt(d.moneda) === "USD" ? `US$ ${numero(perj)}` : solesCompacto(perj)}</b></> : ""}.
          {resp ? <> El informe identifica <b>presunta responsabilidad {resp}</b> de funcionarios y servidores.</> : ""}
          {nObs != null && nObs > 1 ? <> En total, <b>{numero(nObs)} observaciones</b>{nInf != null && nInf > 1 ? ` de ${numero(nInf)} informes` : ""} nombran este contrato.</> : ""}
          {via === "unico" ? " El informe no da la sigla del proceso: se empató por su tipo, número y año, que en esta entidad son de un solo proceso." : ""}
          {via === "cui" ? " Se empató por el código de la inversión, que en esta entidad tiene un solo contrato de obra." : ""}
          {txt(d.consorcio) ? ` El proceso lo ganó ${tituloNatural(txt(d.consorcio)!)}, que esta empresa integra.` : ""} El informe no sanciona al
          proveedor: dice lo que los auditores encontraron.
        </>
      );
    }
    case "socio_con_informe_control": {
      // Migración 303: la persona (por su DNI) está entre los funcionarios comprendidos de un informe de control anterior.
      const numeroInf = txt(d.informe_numero) ?? txt(d.informe_codigo) ?? "sin número";
      const url = txt(d.url_resumen);
      const informe = informeDeDetalle(d);
      const ent = txt(d.informe_entidad);
      const resp = responsabilidadesEnPalabras(d.responsabilidades);
      const nInf = n(d.n_informes);
      const nPer = n(d.n_personas);
      return (
        <>
          {quien(c)} figura en el informe de control{" "}
          {informe ? (
            <InformeEnPanel informe={informe} className={ENLACE_TXT} />
          ) : url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE_TXT}>
              {numeroInf}
            </a>
          ) : (
            <b>{numeroInf}</b>
          )}{" "}
          de la Contraloría{txt(d.emision) ? <>, emitido el {fechaConAnio(txt(d.emision)!)}</> : ""}
          {ent ? <> sobre <Entidad nombre={tituloNatural(ent)} ruc={txt(d.informe_entidad_ruc)} /></> : ""}
          {d.misma_entidad === true ? <b> (la misma entidad que contrató)</b> : ""}, con <b>presunta responsabilidad{resp ? ` ${resp}` : ""}</b>.
          {txt(d.informe_titulo) ? <> El informe trata de «{recortar(oracion(txt(d.informe_titulo)!), 220)}».</> : ""}
          {nInf != null && nInf > 1 ? <> Figura en <b>{numero(nInf)} informes</b> anteriores a esta buena pro.</> : ""}
          {d.misma_entidad_en_otro === true ? " Uno de los otros informes es de la misma entidad que contrató." : ""}
          {nPer != null && nPer > 1 ? <> Además, {nPer === 2 ? "otra persona" : `otras ${numero(nPer - 1)} personas`} de esta empresa {nPer === 2 ? "figura" : "figuran"} en informes de control anteriores.</> : ""}
          {txt(d.consorcio) ? ` El proceso lo ganó ${tituloNatural(txt(d.consorcio)!)}, que esta empresa integra.` : ""} Es una responsabilidad
          que la Contraloría identifica y deriva: no es una condena.
          <Gano c={c} />
        </>
      );
    }
    case "contrato_sobre_adjudicado": {
      return (
        <>
          El contrato dice <b>{solesCompacto(n(d.monto_contrato))}</b>, pero la buena pro fue por <b>{solesCompacto(n(d.adjudicado))}</b> según los dos
          registros oficiales: <b>{n(d.diff_pct) != null ? `${Math.round(n(d.diff_pct)!)} % más` : "más"}</b>
          {n(d.de_mas) ? <>, unos {solesCompacto(n(d.de_mas))} de diferencia</> : ""}.
          {d.igual_al_referencial === true ? " El monto firmado coincide con el valor referencial del proceso." : ""}
          {txt(d.consorcio) ? ` Lo ganó ${tituloNatural(txt(d.consorcio)!)}, que esta empresa integra.` : ""} El monto del contrato sale de una
          lectura automática: conviene abrir el documento.
          <Gano c={c} />
        </>
      );
    }
    case "retencion_sobre_tope": {
      return (
        <>
          Este contrato de <b>{solesCompacto(n(d.monto_contrato))}</b> se garantizó con <b>retención de pagos</b>, que sólo vale hasta{" "}
          <b>{solesCompacto(n(d.tope))}</b> en {txt(d.categoria) === "works" ? "obras" : "bienes y servicios"}, salvo para micro y pequeñas empresas. A{" "}
          <Emp c={c} /> el Estado le adjudicó <b>{solesCompacto(n(d.adjudicado_anio_1))}</b> en {n(d.anio_1) ?? "el año anterior"} y{" "}
          <b>{solesCompacto(n(d.adjudicado_anio_2))}</b> en {n(d.anio_2) ?? "el año previo"}: más de lo que vende una pequeña empresa en un año (
          {solesCompacto(n(d.techo_pequena_anio_1))}).{txt(d.consorcio) ? ` El contrato lo ganó ${tituloNatural(txt(d.consorcio)!)}, que esta empresa integra.` : ""} Falta
          ver su constancia de MYPE.
          <Gano c={c} />
        </>
      );
    }
    case "renovacion_mas_cara": {
      const ant = txt(d.ocid_anterior);
      return (
        <>
          Este servicio cuesta <b>{solesCompacto(n(d.costo_mensual))} al mes</b>; en el contrato anterior del mismo servicio en esta entidad
          {txt(d.fecha_anterior) ? ` (${fechaConAnio(txt(d.fecha_anterior)!)})` : ""} costaba <b>{solesCompacto(n(d.costo_mensual_anterior))} al mes</b>:{" "}
          <b>{n(d.diff_pct) != null ? `${Math.round(n(d.diff_pct)!)} % más` : "más"}</b>
          {n(d.exceso) ? <>, unos {solesCompacto(n(d.exceso))} de más en todo el plazo</> : ""}.
          {d.mismo_proveedor === true ? " El proveedor es el mismo." : d.mismo_proveedor === false ? " El proveedor cambió." : ""}{" "}
          {ant ? (
            <a className="underline" href={`/app/contratos/${encodeURIComponent(ant)}`}>
              Ver el contrato anterior
            </a>
          ) : null}
          <Gano c={c} />
        </>
      );
    }
    case "puerta_giratoria": {
      const dias = n(d.dias_despues);
      const cargo = txt(d.cargo);
      return (
        <>
          {quien(c)} salió de la planilla de esta entidad{txt(d.salio) ? ` en ${txt(d.salio)}` : ""}
          {cargo ? <> (cargo: {cargo.toLowerCase()})</> : ""}, y <Emp c={c} /> ganó aquí{" "}
          <b>{dias != null ? (dias <= 45 ? `${dias} días después` : `${Math.round(dias / 30)} meses después`) : "después"}</b>
          {d.entro_a_la_empresa_tras_salir === true ? ". Entró a la empresa después de salir de la entidad" : ""}. El empate es por nombre completo: hay
          que confirmarlo.
          <Gano c={c} />
        </>
      );
    }
    case "empresa_espejo": {
      // La empresa hermana (comparten una persona en el RNP) y su sanción: el contrato cae dentro de ese periodo.
      const ruc = txt(d.sancionada_ruc);
      const rolAlla = txt(d.rol_alla)?.toLowerCase().replace(/_/g, " ").replace("socio accionista titular", "socio") ?? null;
      const fundada = txt(d.fundada);
      return (
        <>
          {quien(c)} también figura{rolAlla ? ` como ${rolAlla}` : ""} en{" "}
          {ruc ? <OtraEmpresa ruc={ruc} nombre={txt(d.sancionada)} conRuc /> : <b>{txt(d.sancionada) ?? "otra empresa"}</b>}, que el Tribunal de
          Contrataciones inhabilitó {d.definitiva === true ? <b>de forma definitiva</b> : <b>temporalmente</b>}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : txt(d.desde) ? ` (desde el ${fechaConAnio(txt(d.desde)!)})` : ""}
          {txt(d.resolucion) ? `, Res. ${d.resolucion}` : ""}. <Emp c={c} /> ganó este contrato el <b>{fechaCorta(c.buenaPro?.fecha ?? c.fecha)}</b>, dentro de
          esa inhabilitación{fundada ? <>; se fundó el {fechaConAnio(fundada)}</> : ""}.
        </>
      );
    }
    case "domicilio_compartido": {
      const nEmp = n(d.empresas_en_domicilio);
      const dir = txt(d.domicilio);
      const juntas = n(d.procesos_juntas);
      // Migración 141: los otros participantes con nombre, y si presentaron oferta (CONOSCE) o sólo se registraron.
      const postores = (Array.isArray(d.postores) ? (d.postores as { ruc?: unknown; nombre?: unknown; oferta?: unknown }[]) : [])
        .filter((o) => typeof o.ruc === "string")
        .map((o) => ({ ruc: o.ruc as string, nombre: txt(o.nombre), oferta: typeof o.oferta === "boolean" ? o.oferta : null }));
      if (!postores.length) {
        const otros = n(d.otros_postores) ?? 1;
        return (
          <>
            <Emp c={c} /> comparte su <b>domicilio fiscal en la SUNAT</b> con {otros === 1 ? "otro participante" : <><b>{numero(otros)}</b> participantes</>} de este proceso
            {nEmp ? <> (en esa dirección hay <b>{numero(nEmp)}</b> empresas)</> : ""}: la competencia pudo ser solo aparente.
          </>
        );
      }
      const compitieron = postores.some((o) => o.oferta === true);
      const ninguna = postores.every((o) => o.oferta === false);
      return (
        <>
          <Emp c={c} /> declara en la SUNAT el <b>mismo domicilio fiscal</b>
          {dir ? <> ({tituloNatural(dir)})</> : ""} que{" "}
          {postores.map((o, i) => (
            <span key={o.ruc}>
              {i > 0 && (i === postores.length - 1 ? " y " : ", ")}
              <OtraEmpresa ruc={o.ruc} nombre={o.nombre} />
              {o.oferta === true ? " (también presentó oferta)" : o.oferta === false ? " (se registró, pero no presentó oferta)" : ""}
            </span>
          ))}
          , {postores.length === 1 ? "otra empresa que participó" : "otras empresas que participaron"} en este proceso.
          {nEmp ? <> En esa dirección hay <b>{numero(nEmp)}</b> empresas en total.</> : ""}
          {juntas ? <> Ya se habían presentado juntas a <b>{numero(juntas)}</b> {juntas === 1 ? "proceso" : "procesos"} más.</> : ""}{" "}
          {compitieron
            ? "Compitieron entre ellas: la competencia pudo ser solo aparente."
            : ninguna && juntas != null && juntas >= 3
              ? "No ofertó en este proceso; lo que pesa es la historia de presentarse juntas."
              : ninguna
                ? "No llegó a ofertar; aun así, que dos empresas de la misma dirección se registren en el mismo proceso merece una revisión."
              : "Si las dos ofertaron, la competencia pudo ser solo aparente."}
        </>
      );
    }
    case "proveedor_cautivo": {
      const parte = n(d.parte);
      const ent = txt(d.entidad);
      return (
        <>
          <Emp c={c} /> recibe {parte != null ? <>el <b>{(parte * 100).toLocaleString("es-PE", { maximumFractionDigits: 0 })}%</b></> : "casi todo"} de lo que le compra el Estado de <Entidad nombre={ent ? tituloNatural(ent) : "esta entidad"} ruc={c.entidadRuc} />
          {n(d.total_empresa) ? <> (<b>{solesCompacto(n(d.total_empresa))}</b> en {numero(n(d.procesos) ?? 0)} procesos)</> : ""}: depende casi por completo de ella.
        </>
      );
    }
    case "dada_de_baja":
    case "suspendida":
    case "no_habida": {
      // El detalle sólo dice algo en la baja («baja de oficio»); en las otras repetía la palabra («no habida (No habido)»).
      const estado = c.tipo === "dada_de_baja" ? txt(d.estado) ?? txt(d.condicion) : null;
      return (
        <>
          <Emp c={c} /> figura hoy{" "}
          {c.tipo === "no_habida" ? <>como <b>no habida</b></> : c.tipo === "suspendida" ? <>con <b>suspensión temporal de actividades</b></> : <><b>dada de baja</b></>} en
          la SUNAT{estado ? <> ({oracion(estado)})</> : ""}. Es su estado actual, no el de cuando ganó.
        </>
      );
    }
    case "interes_declarado":
    case "empleo_declarado": {
      // La DJI de un funcionario de la entidad (migración 170): quién (cargo y un apellido tapado), qué declaró y si la buena
      // pro cae dentro del periodo de ese vínculo.
      const p = c.socios[0];
      const sec = n(d.seccion);
      const desde = txt(d.desde);
      const hasta = txt(d.hasta);
      const empleo = c.tipo === "empleo_declarado";
      const que = empleo
        ? "haber trabajado o asesorado a"
        : sec === 1
          ? "tener participación (acciones o similares) en"
          : sec === 2
            ? "tener un poder o la representación de"
            : "tener un asiento en el directorio de";
      return (
        <>
          {p?.nombre ? <span className="font-semibold">{p.nombre}</span> : "Un funcionario"}
          <span className="text-inkSoft"> ({p?.rol ? oracion(p.rol) : "funcionario"} de la entidad)</span> declaró en su Declaración
          Jurada de Intereses {que} <Emp c={c} />
          {txt(d.detalle) ? <> ({oracion(txt(d.detalle)!).slice(0, 80)})</> : ""}
          {desde ? <>, desde el {fechaConAnio(desde)}{hasta ? <> hasta el {fechaConAnio(hasta)}</> : " hasta hoy"}</> : ""}.{" "}
          {d.dentro === true
            ? empleo
              ? "La buena pro llegó mientras trabajaba para esa empresa."
              : "La buena pro llegó mientras declaraba ese vínculo."
            : d.dentro === false
              ? empleo
                ? "La buena pro llegó después, cuando ya estaba en la entidad."
                : "La buena pro cae fuera del periodo que declaró."
              : ""}
        </>
      );
    }
    default:
      // La obra de este contrato (INFOBRAS) y su inversión (Invierte.pe), migración 160: la frase sale de su evidencia.
      if (esTipoObra(c.tipo)) return <TextoObra c={c} />;
      // El acta de buena pro y el pliego de consultas, leídos con Claude (migración 246).
      if (esTipoLeido(c.tipo)) return <TextoLeido c={c} />;
      return <>{c.etiqueta}.</>;
  }
}

/** Quien quedó fuera, como lo nombra el acta: una persona natural no se nombra (su RUC lleva el DNI). */
// Componente de servidor: no puede usar pareceEmpresa de components/Redact.tsx (es de cliente: llega como referencia, no
// como función). El RUC decide; sin RUC, una forma societaria o «consorcio» en el nombre.
const MARCA_EMPRESA = /\b(consorcio|s\.?\s?a\.?\s?c|s\.?\s?r\.?\s?l|e\.?\s?i\.?\s?r\.?\s?l|s\.?\s?a\.?\s?a|sociedad|empresa|corporaci[oó]n|inversiones|constructora|servicios|ingenier[ií]a|contratistas|asociaci[oó]n)\b/i;
function nombreFuera(f: { nombre?: unknown; ruc?: unknown }): string {
  const nombre = typeof f.nombre === "string" ? f.nombre.trim() : "";
  const ruc = typeof f.ruc === "string" ? f.ruc.replace(/\D/g, "") : "";
  const empresa = ruc.startsWith("20") || (!ruc.startsWith("10") && MARCA_EMPRESA.test(nombre));
  return nombre && empresa ? tituloNatural(nombre) : "un postor (persona natural)";
}

/** Una bandera del acta de buena pro o del pliego de consultas: lo que dice el documento y el enlace al SEACE. */
function TextoLeido({ c }: { c: CruceProveedor }) {
  const d = c.detalle;
  const fuera = (Array.isArray(d.fuera) ? d.fuera : []) as { nombre?: unknown; ruc?: unknown; motivo?: unknown }[];
  const fuente = c.fuenteUrl ? (
    <>
      {" "}
      {/* La copia que guarda Vigía (el SEACE falla a menudo con error 502); si no la hay, la ruta lleva al SEACE. */}
      <a href={`/v1/documentos/copia?u=${encodeURIComponent(c.fuenteUrl)}`} target="_blank" rel="noopener noreferrer" className={ENLACE_TXT}>
        Ver el documento
      </a>{" "}
      <span className="text-mute">
        (copia de Vigía; también{" "}
        <a href={c.fuenteUrl} target="_blank" rel="noopener noreferrer" className={ENLACE_TXT}>
          en el SEACE
        </a>
        ).
      </span>
    </>
  ) : null;
  const leido = <span className="text-mute"> Leído del documento con IA.</span>;
  if (c.tipo.startsWith("bases_")) {
    if (c.tipo === "bases_marca_sin_equivalente") {
      const marcas = (Array.isArray(d.marcas) ? d.marcas : []) as { marca?: unknown; cita?: unknown }[];
      const m = marcas[0];
      return (
        <>Las bases exigen {txt(String(m?.marca ?? "")) ? <>la marca <b>{String(m!.marca)}</b></> : "una marca"} sin admitir «o equivalente»
          {txt(String(m?.cita ?? "")) ? <>: <i>«{recortar(String(m!.cita), 240)}»</i></> : ""}
          {marcas.length > 1 ? <> (y {numero(marcas.length - 1)} {marcas.length === 2 ? "marca más" : "marcas más"})</> : null}.{fuente}{leido}</>
      );
    }
    const e = (d.experiencia ?? {}) as { monto_minimo?: unknown; cita?: unknown };
    const vr = n(d.valor_referencial);
    const exige = n(e.monto_minimo);
    return (
      <>Las bases exigen al postor experiencia por <b>{exige != null ? soles(exige) : "un monto"}</b>
        {exige != null && vr ? <>, <b>{(exige / vr).toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces</b> el valor referencial ({soles(vr)})</> : ""}
        {txt(String(e.cita ?? "")) ? <>: <i>«{recortar(String(e.cita), 240)}»</i></> : ""}.{fuente}{leido}</>
    );
  }
  if (c.tipo.startsWith("consultas_")) {
    const denuncias = (Array.isArray(d.denuncias) ? d.denuncias : []) as { cita?: unknown }[];
    const cita = txt(String(denuncias[0]?.cita ?? ""));
    // Migración 394: qué pasó después con la competencia, según el reporte de evaluación del SEACE.
    const ofertas = n(d.ofertas);
    const despues =
      d.competencia === "desaparecio" ? (
        <> Después, la competencia desapareció: {ofertas === 1 ? "se presentó una sola oferta" : "se admitió una sola oferta"}.</>
      ) : d.competencia === "se_mantuvo" ? (
        <> Después hubo competencia: se admitieron al menos {numero(n(d.admitidas) ?? 2)} ofertas, así que pesa poco.</>
      ) : null;
    return c.tipo === "consultas_denuncia_direccionamiento" ? (
      <>En el pliego de consultas, un participante escribió{cita ? <>: <i>«{recortar(cita, 260)}»</i></> : " que las bases favorecen a alguien"}. Es su denuncia, no una prueba.{despues}{fuente}{leido}</>
    ) : (
      <>Los participantes observaron {numero(n(d.observaciones) ?? 0)} veces las bases y la entidad no acogió ninguna observación a los requisitos.{fuente}{leido}</>
    );
  }
  const lista = fuera.slice(0, 3).map((f, i) => (
    <span key={i}>{i ? "; " : ""}<b>{nombreFuera(f)}</b>{txt(String(f.motivo ?? "")) ? <> ({recortar(oracion(String(f.motivo)), 180)})</> : ""}</span>
  ));
  const mas = fuera.length > 3 ? <> y {numero(fuera.length - 3)} más</> : null;
  if (c.tipo === "acta_oferta_mas_baja_descartada") {
    return (
      <>Según el acta de buena pro, la oferta más baja{n(d.menor_monto) != null ? <> (<b>{soles(n(d.menor_monto)!)}</b>)</> : ""} quedó fuera
        {n(d.ganador_monto) != null ? <> y <Emp c={c} /> ganó con <b>{soles(n(d.ganador_monto)!)}</b>{c.montoSoles != null ? <>: <b>{solesCompacto(c.montoSoles)}</b> más</> : ""}</> : ""}.
        {lista.length ? <> Quedaron fuera: {lista}{mas}.</> : null}{fuente}{leido}</>
    );
  }
  return (
    <>{c.tipo === "acta_solo_queda_el_ganador"
      ? <>Según el acta de buena pro, de {numero(n(d.postores) ?? 0)} postores quedaron fuera todos menos <Emp c={c} />: </>
      : <>Según el acta de buena pro, quedó fuera por una formalidad: </>}
      {lista}{mas}.{fuente}{leido}</>
  );
}

/** Una bandera de la obra o de la inversión de este contrato: de qué obra se habla y lo que registra la fuente. */
function TextoObra({ c }: { c: CruceProveedor }) {
  const d = c.detalle;
  const b = { ...d, tipo: c.tipo, severidad: c.severidad } as BanderaObra;
  const supervisa = d.rol === "supervision";
  const nombre = txt(String(d.nombre_obra ?? ""));
  const nombreInv = txt(String(d.nombre_inversion ?? ""));
  if (c.tipo.startsWith("inversion_")) {
    return (
      <>
        {nombreInv ? <>La inversión <b>{oracion(nombreInv)}</b>{txt(String(d.cui ?? "")) ? <> (<a href={inversionSsi(String(d.cui))} target="_blank" rel="noopener noreferrer" className={ENLACE_TXT}>CUI {String(d.cui)}</a>)</> : ""}: </> : null}
        {fraseBandera(b, "La inversión")}
      </>
    );
  }
  return (
    <>
      {nombre ? (
        <>
          {supervisa ? "Este contrato supervisa la obra" : "Este contrato ejecuta la obra"} <b>{oracion(nombre)}</b>
          {n(d.obra) ? <> (<a href={obraInfobras(String(d.obra))} target="_blank" rel="noopener noreferrer" className={ENLACE_TXT}>INFOBRAS {String(d.obra)}</a>)</> : ""}.{" "}
        </>
      ) : null}
      {fraseBandera(b, "La obra")}
    </>
  );
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
 * Los tipos que son DATOS DEL PROVEEDOR (hechos de quien ganó), no antecedentes de ESTA contratación: una candidatura,
 * un aporte o una venta a una campaña, o ser autoridad electa (en cualquier jurisdicción). Desde la migración 115 no
 * cuentan para el riesgo del contrato y se muestran en una sección aparte, no mezclados con lo de esta entidad. Las
 * versiones LIGADAS a la entidad (partido_gobernante, vendio_gobernante) NO están aquí: son antecedentes de verdad.
 */
const DATOS_PROVEEDOR = new Set(["candidato", "aporte", "aporte_empresa", "proveedor_campana", "autoridad"]);

/**
 * Los hechos de ESTE proceso y no de quien ganó: que haya tenido un solo postor. Van aparte, «En este proceso», con su
 * evidencia (2026-10-27: «Único postor» salía como un antecedente del ganador, que no es: no dice nada de la empresa).
 */
const HECHOS_DEL_PROCESO = new Set(["unico_postor"]);
/** La obra y la inversión de ESTE contrato (INFOBRAS, Invierte.pe; migración 160) también son del proceso, no de quien ganó. */
const esDelProceso = (tipo: string) => HECHOS_DEL_PROCESO.has(tipo) || esTipoObra(tipo);

/** Los cruces, una sola vez cada uno y en sus partes: antecedentes, hechos del proceso, datos del proveedor y lo posterior. */
export function clasificarCruces(todos: CruceProveedor[]) {
  // Dedup de seguridad: la base puede traer cruces idénticos (mismo tipo, persona, aporte y detalle) por un JOIN que
  // multiplica; se muestran una sola vez. El arreglo de raíz está en dedup_cruces_proveedor (migración 120).
  const vistos = new Set<string>();
  const unicos = todos.filter((c) => {
    // Una bandera de la obra es del contrato, no de cada integrante del consorcio que lo ganó: va una vez (sin el RUC).
    const quien = esTipoObra(c.tipo) ? "" : c.rucProveedor;
    const clave = `${c.tipo}|${c.ocid ?? ""}|${c.severidad}|${c.fecha ?? ""}|${c.montoSoles ?? ""}|${quien}|${JSON.stringify(c.socios ?? [])}|${JSON.stringify(c.detalle ?? {})}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
  // Un antecedente es lo que ya había pasado cuando se convocó (migración 83) Y está ligado a esta entidad/proceso. Los
  // datos del proveedor (candidatura, aporte, venta a campaña, autoridad) van aparte: hechos de quien ganó, no de esta
  // contratación (migración 115). Lo posterior a la convocatoria, también aparte.
  // Un indicador en observación (migración 329) no es todavía un antecedente: va en su propio bloque, con su evidencia,
  // y no entra a la cuenta de antecedentes ni a las banderas de la cabecera.
  const obs = (c: CruceProveedor) => c.observacion === true || esEnObservacion(c.tipo);
  return {
    antecedentes: unicos.filter((c) => !c.posterior && !obs(c) && !DATOS_PROVEEDOR.has(c.tipo) && !esDelProceso(c.tipo)),
    delProceso: unicos.filter((c) => !c.posterior && !obs(c) && esDelProceso(c.tipo)),
    datosProv: unicos.filter((c) => !c.posterior && !obs(c) && DATOS_PROVEEDOR.has(c.tipo)),
    posteriores: unicos.filter((c) => c.posterior),
    enObservacion: unicos.filter((c) => !c.posterior && obs(c)),
  };
}

/** Los cruces por tipo, el grupo más grave primero (y, a igual severidad, el que tiene más). */
function agrupar(lista: CruceProveedor[]): CruceProveedor[][] {
  const grupos = new Map<string, CruceProveedor[]>();
  for (const c of lista) grupos.set(c.tipo, [...(grupos.get(c.tipo) ?? []), c]);
  return [...grupos.values()].sort((a, b) =>
    RANGO_SEVERIDAD[peorSeveridad(a) ?? "baja"] - RANGO_SEVERIDAD[peorSeveridad(b) ?? "baja"] || b.length - a.length);
}

/** El ancla de un grupo de antecedentes en su pestaña (el Resumen baja hasta él). */
const anclaDe = (tipo: string) => `antecedente-${tipo}`;

/**
 * Los antecedentes de quien ganó como banderas de la cabecera (`BanderasFicha`): un renglón por tipo, con su severidad,
 * cuántos casos y el enlace a su grupo en la pestaña «Antecedentes». Los mismos renglones (y la misma cuenta) que el
 * resumen de antecedentes y que el conteo de esa pestaña: lo de quien ganó y lo del proceso, sin los datos del proveedor
 * ni lo posterior a la convocatoria.
 */
export function banderasAntecedentes(cruces: CruceProveedor[], href: string): { tipo: string; severidad: "alta" | "media" | "baja"; nombre: string; n: number; href: string; observacion?: boolean }[] {
  const { antecedentes, delProceso, enObservacion } = clasificarCruces(cruces);
  return [
    ...[...agrupar(antecedentes), ...agrupar(delProceso)].map((g) => ({
      tipo: g[0].tipo,
      severidad: peorSeveridad(g) ?? g[0].severidad,
      nombre: g[0].etiqueta,
      n: g.length,
      href: `${href}#${anclaDe(g[0].tipo)}`,
    })),
    // Los indicadores en observación (migración 329) también van a la cabecera, al final y sin gravedad (el gris de lo
    // leve): se ven en todas las pestañas y llevan a su evidencia, pero todavía no cuentan para el riesgo.
    ...agrupar(enObservacion).map((g) => ({
      tipo: g[0].tipo,
      severidad: "baja" as const,
      observacion: true,
      nombre: `En observación: ${g[0].etiqueta}`,
      n: g.length,
      href: `${href}#${anclaDe(g[0].tipo)}`,
    })),
  ];
}

/**
 * Un bloque de cruces agrupados por tipo, en orden de severidad: los antecedentes, los datos del proveedor y lo
 * posterior. Las sanciones van en tabla con su resumen (GrupoSanciones); el resto, una línea por cruce. El «por qué
 * mirarlo» de un tipo va abierto la primera vez que aparece y en el ⓘ las siguientes (las bandas de un mismo tipo
 * —definitiva, temporal, multa— comparten el texto: antes se leía tres veces seguidas).
 */
function GruposCruces({ lista, gobierna, conAnclas = false }: { lista: CruceProveedor[]; gobierna?: GobiernoContrato | null; conAnclas?: boolean }) {
  const explicados = new Set<string>();
  return (
    <ul className="divide-y divide-line px-4 pb-1">
      {agrupar(lista).map((grupo) => {
        const tipo = grupo[0].tipo;
        const sev = peorSeveridad(grupo) ?? grupo[0].severidad;
        const porQue = POR_QUE[tipo];
        const primera = !!porQue && !explicados.has(porQue);
        if (porQue) explicados.add(porQue);
        const filas = [...grupo].sort((a, b) => RANGO_SEVERIDAD[a.severidad] - RANGO_SEVERIDAD[b.severidad] || (b.fecha ?? "").localeCompare(a.fecha ?? ""));
        return (
          // Bajo la barra de pestañas fija (y, en el celular, la del sitio) al llegar desde el Resumen.
          <li key={tipo} id={conAnclas ? anclaDe(tipo) : undefined} className="scroll-mt-32 py-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <SeveridadCruce s={sev} />
              <h3 className="flex flex-wrap items-center gap-1.5 text-cuerpo font-semibold text-ink">
                <IconoBandera tipo={tipo} size={15} className="text-inkSoft" />
                {grupo[0].etiqueta}
                {grupo.length > 1 && <CuentaGrupo>{numero(grupo.length)}</CuentaGrupo>}
              </h3>
              {porQue && !primera && <Ayuda titulo="¿Por qué mirarlo?">{porQue}</Ayuda>}
            </div>
            {primera && <p className="mb-2 text-meta leading-relaxed text-inkSoft">{porQue}</p>}
            <TasaBase t={grupo[0].tasaBase} />
            <Confiabilidad c={grupo[0].confiabilidad} />
            {TIPOS_SANCION.has(tipo) ? (
              <GrupoSanciones grupo={filas} fuente={FUENTE[grupo[0].fuente] ?? grupo[0].fuente} />
            ) : (
              <>
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
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** «0,3 %», «12 %», «menos del 0,1 %»: una proporción chica sin perder el orden de magnitud. */
function proporcion(casos: number, universo: number): string {
  const p = (100 * casos) / universo;
  if (p < 0.1) return "menos del 0,1 %";
  return `${p < 10 ? p.toFixed(1).replace(".", ",") : String(Math.round(p))} %`;
}

/** Cuán frecuente es una señal: en cuántos procesos aparece, sobre los que se puede medir (migración 329). */
function TasaBase({ t }: { t?: CruceProveedor["tasaBase"] }) {
  if (!t || !t.universo || t.casos > t.universo) return null;
  return (
    <p className="mb-2 flex items-start gap-1.5 text-meta leading-snug text-mute">
      <Scale size={14} aria-hidden className="mt-0.5 shrink-0" />
      <span>
        Cuán frecuente es: aparece en <b className="font-semibold text-inkSoft">{proporcion(t.casos, t.universo)}</b> de los {t.que}{" "}
        <span className="tabular-nums">({numero(t.casos)} de {numero(t.universo)})</span>.
      </span>
    </p>
  );
}

/**
 * Cuánto acierta este tipo de bandera (validación externa): frente a lo que observó la Contraloría y a lo que el Tribunal
 * declaró fundado o anuló, si aparece más, menos o igual que lo esperado. Dice en qué banderas apoyarse; sin medida, nada.
 */
function Confiabilidad({ c }: { c?: CruceProveedor["confiabilidad"] }) {
  const partes = (c ?? []).filter((x) => x.lectura !== "pocos_casos");
  if (!partes.length) return null;
  const f = (n: number) => n.toFixed(2).replace(".", ",");
  const quien = { contraloria: "lo que encontró la Contraloría", tribunal: "lo que anuló el Tribunal de Contrataciones" } as const;
  const que = (x: (typeof partes)[number]) =>
    x.lectura === "mas_de_lo_esperado" ? <>aparece <b className="font-semibold text-inkSoft">{f(x.oe)} veces</b> lo esperado</>
      : x.lectura === "menos_de_lo_esperado" ? <>aparece menos de lo esperado ({f(x.oe)} veces)</>
        : <>no se distingue del azar</>;
  return (
    <p className="mb-2 flex items-start gap-1.5 text-meta leading-snug text-mute">
      <Target size={14} aria-hidden className="mt-0.5 shrink-0" />
      <span>
        Cuánto acierta:{" "}
        {partes.map((x, i) => (
          <span key={x.verdad}>
            {i > 0 ? "; " : ""}frente a {quien[x.verdad]}, {que(x)}
          </span>
        ))}
        .
      </span>
    </p>
  );
}

/** Lo de quien ganó que no es antecedente de este proceso, plegado al pie: datos del proveedor o lo que pasó después. */
function Plegado({ titulo, n, aclaracion, children }: { titulo: string; n: number; aclaracion: string; children: ReactNode }) {
  return (
    // Grupo con nombre: adentro van otros plegables y tablas, que no deben reaccionar a éste.
    <details className="group/pleg border-t border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            {titulo} <CuentaGrupo>{numero(n)}</CuentaGrupo>
          </span>
          <span className="text-inkSoft">{aclaracion}</span>
        </span>
        <ChevronDown size={14} aria-hidden className="shrink-0 text-mute transition-transform duration-200 group-open/pleg:rotate-180" />
      </summary>
      {children}
    </details>
  );
}

/**
 * La pestaña «Antecedentes» de la ficha: los antecedentes de quien ganó por tipo, y plegados al pie los datos del
 * proveedor que no son de esta entidad y lo que pasó después de la convocatoria. Server-safe.
 */
export function CrucesProveedor({ cruces: todos, varios, gobierna }: { cruces: CruceProveedor[]; varios?: boolean; gobierna?: GobiernoContrato | null }) {
  if (!todos.length) return null;
  const { antecedentes, delProceso, datosProv, posteriores, enObservacion } = clasificarCruces(todos);
  const titulo = varios ? "Antecedentes de quienes ganaron" : "Antecedentes de quien ganó";

  return (
    <div>
      <CabeceraPestana
        titulo={titulo}
        ayuda={
          <Ayuda titulo="¿De dónde salen estos cruces?">
            Cruces automáticos por DNI y RUC entre el ganador (y sus socios y representantes del RNP) y los registros de la ONPE, el JNE,
            las visitas a entidades, CONOSCE, las penalidades y las sanciones del Tribunal. Son datos oficiales verificables en cada fuente: no prueban
            por sí solos una irregularidad. Sólo cuenta como antecedente lo que ya había pasado cuando se convocó el proceso; lo
            posterior se muestra aparte.
          </Ayuda>
        }
      >
        Lo que los registros públicos ya decían de {varios ? "quienes ganaron" : "quien ganó"} cuando se convocó este proceso: datos para revisar, no pruebas.
      </CabeceraPestana>
      <section aria-label={titulo} className="tarjeta rounded-2xl border border-line bg-paper">
        {!antecedentes.length && (
          <p className="px-4 py-3 text-meta leading-relaxed text-inkSoft">
            Cuando se convocó este proceso, {varios ? "quienes ganaron no tenían" : "quien ganó no tenía"} antecedentes ligados a esta entidad.
          </p>
        )}
        {antecedentes.length > 0 && <GruposCruces lista={antecedentes} gobierna={gobierna} conAnclas />}
        {delProceso.some((c) => !esTipoObra(c.tipo)) && (
          <div className="border-t border-line">
            <h3 className="px-4 pt-3 text-cuerpo font-semibold text-ink">En este proceso</h3>
            <GruposCruces lista={delProceso.filter((c) => !esTipoObra(c.tipo))} gobierna={gobierna} conAnclas />
          </div>
        )}
        {delProceso.some((c) => esTipoObra(c.tipo)) && (
          <div className="border-t border-line">
            <h3 className="px-4 pt-3 text-cuerpo font-semibold text-ink">En la obra de este contrato</h3>
            <p className="px-4 pt-1 text-meta leading-relaxed text-inkSoft">
              Lo que registra la entidad en INFOBRAS (Contraloría) y en Invierte.pe (MEF) sobre la obra que ejecuta o supervisa este contrato: no
              son antecedentes de quien ganó, son hechos de la ejecución. Su detalle completo está en «Adjudicación y contrato».
            </p>
            <GruposCruces lista={delProceso.filter((c) => esTipoObra(c.tipo))} gobierna={gobierna} conAnclas />
          </div>
        )}
        {enObservacion.length > 0 && (
          <div className="border-t border-line">
            <h3 className="px-4 pt-3 text-cuerpo font-semibold text-ink">Indicadores en observación</h3>
            <p className="px-4 pt-1 text-meta leading-relaxed text-inkSoft">
              Cruces nuevos que Vigía todavía está midiendo. Van con su evidencia para que los revises, pero no cuentan para el
              riesgo de este contrato hasta saber, con una muestra revisada, cuántas veces aciertan.
            </p>
            <GruposCruces lista={enObservacion} gobierna={gobierna} conAnclas />
          </div>
        )}
        {datosProv.length > 0 && (
          <Plegado titulo="Datos del proveedor" n={datosProv.length} aclaracion="No relacionados con esta entidad.">
            <p className="px-4 pb-1 pt-1 text-meta leading-relaxed text-inkSoft">
              Hechos de quien ganó (una candidatura, un aporte o una venta a una campaña, un cargo de autoridad electa), no de
              esta contratación: contexto del proveedor, no cuentan para el riesgo de este contrato.
            </p>
            <GruposCruces lista={datosProv} gobierna={gobierna} />
          </Plegado>
        )}
        {posteriores.length > 0 && (
          <Plegado titulo="Después de este proceso" n={posteriores.length} aclaracion="No eran antecedentes cuando se convocó.">
            <p className="px-4 pb-1 pt-1 text-meta leading-relaxed text-inkSoft">
              Pasó después de la convocatoria: quien adjudicó no podía saberlo. Se muestra como contexto de la empresa, no como señal sobre
              este proceso.
            </p>
            <GruposCruces lista={posteriores} gobierna={gobierna} />
          </Plegado>
        )}
      </section>
    </div>
  );
}

/** Un renglón por tipo con su severidad y cuántos; cada uno abre la pestaña «Antecedentes» en ese grupo. */
function RenglonesGrupos({ grupos }: { grupos: CruceProveedor[][] }) {
  return (
    <ul className="divide-y divide-line/70 rounded-xl border border-line">
      {grupos.map((g) => (
        <li key={g[0].tipo}>
          <BotonPestana
            clave="antecedentes"
            ancla={anclaDe(g[0].tipo)}
            className="flex min-h-11 w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
          >
            <span className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 shrink-0"><SeveridadCruce s={peorSeveridad(g) ?? g[0].severidad} /></span>
              <IconoBandera tipo={g[0].tipo} size={14} className="mt-1 shrink-0 text-inkSoft" />
              <span className="min-w-0">
                <span className="block text-dato font-medium leading-snug text-ink">{g[0].etiqueta}</span>
                {/* Qué significa, a la vista (antes sólo al pasar el mouse): «no se explica qué es cada una» (2026-11-13). */}
                {TIPO_CRUCE[g[0].tipo]?.explica && <span className="mt-0.5 block text-meta leading-snug text-mute">{TIPO_CRUCE[g[0].tipo].explica}</span>}
              </span>
            </span>
            <span className="shrink-0 font-mono text-dato tabular-nums text-ink">{numero(g.length)}</span>
          </BotonPestana>
        </li>
      ))}
    </ul>
  );
}

/**
 * Los antecedentes en el Resumen de la ficha: un renglón por tipo con su severidad (color, ícono y palabra) y cuántos;
 * cada renglón abre la pestaña «Antecedentes» en ese grupo, con la evidencia. Sin antecedentes ligados a esta entidad,
 * se dice en una línea (y si hay datos del proveedor o algo posterior, cuántos y dónde verlos).
 */
export function ResumenAntecedentes({ cruces, varios }: { cruces: CruceProveedor[]; varios?: boolean }) {
  const { antecedentes, delProceso, datosProv, posteriores, enObservacion } = clasificarCruces(cruces);
  const grupos = agrupar(antecedentes);
  const gruposObservacion = agrupar(enObservacion);
  const gruposProceso = agrupar(delProceso.filter((c) => !esTipoObra(c.tipo)));
  const gruposObra = agrupar(delProceso.filter((c) => esTipoObra(c.tipo)));
  const titulo = varios ? "Antecedentes de quienes ganaron" : "Antecedentes de quien ganó";
  return (
    <section aria-labelledby="resumen-antecedentes" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="resumen-antecedentes" className="font-display text-bloque font-bold text-ink">
          {titulo}
        </h2>
        <BotonPestana clave="antecedentes" className="inline-flex min-h-8 items-center gap-0.5 rounded text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate">
          Ver la evidencia <ChevronRight size={14} aria-hidden />
        </BotonPestana>
      </div>
      <p className="text-meta leading-snug text-inkSoft">
        Datos de otros registros del Estado sobre {varios ? "quienes ganaron" : "quien ganó"}. <strong className="font-semibold text-ink">Alta</strong>,{" "}
        <strong className="font-semibold text-ink">media</strong> o <strong className="font-semibold text-ink">baja</strong> dice cuánto pesa cada uno; el número, cuántas veces aparece. Toca uno para ver su evidencia.
      </p>
      {grupos.length > 0 ? (
        <RenglonesGrupos grupos={grupos} />
      ) : (
        <p className="text-meta leading-relaxed text-inkSoft">
          Cuando se convocó este proceso, {varios ? "quienes ganaron no tenían" : "quien ganó no tenía"} antecedentes ligados a esta entidad.
        </p>
      )}
      {/* Los indicadores en observación (migración 329), aparte: todavía no cuentan para el riesgo. */}
      {gruposObservacion.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <h3 className="text-cuerpo font-semibold text-ink">En observación</h3>
          <p className="text-meta leading-snug text-inkSoft">Cruces nuevos que todavía se están midiendo: no cuentan para el riesgo de este contrato.</p>
          <RenglonesGrupos grupos={gruposObservacion} />
        </div>
      )}
      {/* Lo que es del proceso y no de quien ganó (un solo postor), aparte: no es un antecedente de la empresa. */}
      {gruposProceso.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <h3 className="text-cuerpo font-semibold text-ink">En este proceso</h3>
          <RenglonesGrupos grupos={gruposProceso} />
        </div>
      )}
      {/* La obra de este contrato en INFOBRAS y su inversión en Invierte.pe (migración 160). */}
      {gruposObra.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <h3 className="text-cuerpo font-semibold text-ink">En la obra de este contrato</h3>
          <RenglonesGrupos grupos={gruposObra} />
        </div>
      )}
      {datosProv.length + posteriores.length > 0 && (
        <p className="text-rotulo text-mute">
          En la pestaña también van{" "}
          {datosProv.length > 0 && <>{numero(datosProv.length)} {datosProv.length === 1 ? "dato" : "datos"} del proveedor que no son de esta entidad</>}
          {datosProv.length > 0 && posteriores.length > 0 && " y "}
          {posteriores.length > 0 && <>{numero(posteriores.length)} {posteriores.length === 1 ? "registro posterior" : "registros posteriores"} a la convocatoria</>}
          .
        </p>
      )}
    </section>
  );
}
