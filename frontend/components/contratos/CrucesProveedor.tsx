/**
 * Lo que dicen otros registros públicos de quien ganó: aportes, gastos de campaña y candidaturas (ONPE),
 * autoridades electas y el partido que gobierna la entidad (JNE), visitas a entidades, penalidades y sanciones
 * del Tribunal (OSCE), socios compartidos con otro postor (RNP), y su historial con la entidad y los adicionales
 * del contrato (CONOSCE). Cruces automáticos por DNI y RUC (migración 48); los nombres llegan tapados de la API.
 * Son datos de registros oficiales, no conclusiones: cada uno dice de dónde sale.
 */

import type { ReactNode } from "react";
import { Ayuda } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { ListaPaginada } from "@/components/listado";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { CruceProveedor, DiaFraccionado, EvidenciaCruce } from "@/lib/contratos";
import { tituloNatural } from "@/lib/landing";
import { fecha, fechaCorta, numero, oracion, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { recortar } from "./recortar";

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
const SEVERIDAD = { alta: "Alta", media: "Media", baja: "Baja" } as const;
const ORDEN = { alta: 0, media: 1, baja: 2 } as const;
const FUENTE: Record<string, string> = {
  onpe_aportantes: "ONPE · Claridad",
  onpe_candidatos: "ONPE · Claridad",
  jne_autoridades: "JNE · autoridades electas",
  penalidades: "OECE · penalidades",
  osce_sancionados: "Tribunal de Contrataciones · sancionados",
  visitas_entidades: "Registro de visitas",
  rnp_conformacion_juridica: "RNP · conformación jurídica",
  onpe_gastos_proveedores: "ONPE · gastos de campaña",
  conosce_adjudicaciones: "CONOSCE · adjudicaciones",
  conosce_contratos: "CONOSCE · contratos",
  conosce_ordenes: "CONOSCE · órdenes de compra y servicio",
};
/** Cuántas filas de un mismo tipo se ven antes de "ver más". */
const VISIBLES = 3;

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
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
  partido_gobernante: "La empresa, o una persona detrás de ella, financió o atendió la campaña del partido que gobierna la entidad que le dio el contrato: posible conflicto de interés.",
  proveedor_campana: "Es una relación comercial con un partido político. Pesa más cuando es el partido que gobierna la entidad, y menos en cadenas grandes que le venden a todos.",
  recurrente: "Ganarle muchas veces a la misma entidad puede ser buena competencia o un proveedor cautivo. Vale mirar cuántos postores hubo en cada proceso.",
  adicional: "Los adicionales tienen topes legales: 25 % en bienes y servicios, y 15 % en obras sin autorización de la Contraloría. Cerca del tope merece revisión.",
  otro_postor: "Cuando el ganador no firma o pierde la buena pro, se adjudica al siguiente postor con su propia oferta: el Estado paga más. Vale ver en el expediente por qué no firmó el primero.",
  fraccionamiento: "Partir una compra en órdenes pequeñas para no hacer un proceso de selección está prohibido. Varias órdenes el mismo día, al mismo proveedor y por encima del tope, son el patrón que se busca.",
};

/** Una línea de texto por cruce, con los datos del registro: quién, de qué empresa, qué hizo y qué ganó después. */
/** Lo que la empresa sumó después de que se convocó este proceso (no cuenta como antecedente): sólo se menciona. */
function Despues({ n: k, uno, varios }: { n: number | null; uno: string; varios: string }) {
  if (!k) return null;
  return <span className="text-mute"> Después de este proceso, {numero(k)} {k === 1 ? uno : varios} más (marcadas en la evidencia).</span>;
}

function Texto({ c }: { c: CruceProveedor }) {
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
              {o.nombre ? <b>{o.nombre}</b> : null} <span className="font-mono text-[12px]">(RUC {o.ruc})</span>
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
    case "partido_gobernante": {
      const via = txt(d.via);
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
    default:
      return <>{c.etiqueta}.</>;
  }
}

function Fila({ c }: { c: CruceProveedor }) {
  return (
    <li className="text-[13px] leading-relaxed text-ink">
      <FilaContenido c={c} />
    </li>
  );
}

function FilaContenido({ c }: { c: CruceProveedor }) {
  return (
    <>
      <Texto c={c} />{" "}
      <span className="text-[12px] text-mute">
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
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[13px] font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
        <span>
          Ver la evidencia · {n === 1 ? "1 registro" : `${numero(n)} registros`}
          {despues > 0 && <span className="font-normal text-mute"> · {numero(despues)} después de este proceso</span>}
        </span>
        <ChevronDown size={14} aria-hidden className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-line px-3 py-3">
        {evidencia.map((e) => (
          <section key={e.titulo} className="space-y-2">
            <h4 className="text-[13px] font-semibold text-ink">
              {e.titulo}
              {e.total != null && e.total > e.filas.length && (
                <span className="font-normal text-mute"> · los {numero(e.filas.length)} más recientes de {numero(e.total)}</span>
              )}
            </h4>
            {/* Escritorio: tabla. */}
            <div className="hidden overflow-x-auto rounded-lg border border-line bg-paper sm:block">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-paperDeep/60 text-[11.5px] text-mute">
                  <tr>
                    {e.columnas.map((col) => (
                      <th key={col.clave} scope="col" className={`px-3 py-1.5 font-medium ${col.tipo === "soles" || col.tipo === "pct" ? "text-right" : ""}`}>
                        {col.titulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {e.filas.map((f, i) => (
                    <tr key={i} className={`align-top ${f.posterior ? "opacity-55" : ""}`}>
                      {e.columnas.map((col) => (
                        <td key={col.clave} className={`px-3 py-1.5 text-ink ${col.tipo === "soles" || col.tipo === "pct" ? "whitespace-nowrap text-right font-mono tabular-nums" : ""} ${col.tipo === "fecha" ? "whitespace-nowrap" : ""}`}>
                          <Celda tipo={col.tipo} valor={f[col.clave]} />
                          {col.tipo === "fecha" && f.posterior === true && <MarcaDespues />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Teléfono: un registro por tarjeta. */}
            <ul className="space-y-2 sm:hidden">
              {e.filas.map((f, i) => (
                <li key={i} className={`rounded-lg border border-line bg-paper px-3 py-2 ${f.posterior ? "opacity-55" : ""}`}>
                  <dl className="space-y-1 text-[12.5px]">
                    {e.columnas.map((col) => (
                      <div key={col.clave} className="flex items-baseline justify-between gap-3">
                        <dt className="shrink-0 text-mute">{col.titulo}</dt>
                        <dd className="min-w-0 text-right text-ink">
                          <Celda tipo={col.tipo} valor={f[col.clave]} />
                          {col.tipo === "fecha" && f.posterior === true && <MarcaDespues />}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
            {(e.verificar || e.enlace) && (
              <p className="text-[12px] leading-relaxed text-mute">
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

/** Junto a la fecha de un registro posterior a la convocatoria: no era un antecedente cuando se adjudicó. */
function MarcaDespues() {
  return <span className="ml-1.5 whitespace-nowrap rounded bg-paperDeep px-1.5 py-px text-[10.5px] font-medium text-inkSoft">después</span>;
}

/** Un valor de la evidencia según su columna: fecha, soles, porcentaje, enlace (interno o a la fuente) o texto. */
function Celda({ tipo, valor }: { tipo?: EvidenciaCruce["columnas"][number]["tipo"]; valor: unknown }) {
  if (valor == null || valor === "") return <span className="text-mute">—</span>;
  if (tipo === "fecha") return <>{fechaCorta(String(valor))}</>;
  if (tipo === "soles") return <>{soles(Number(valor))}</>;
  if (tipo === "pct") {
    const v = Number(valor);
    // S/ 4 mil de una campaña de S/ 127 M es 0,0035 %: decir "0 %" haría pensar que no hubo nada.
    if (v > 0 && v < 0.01) return <>menos de 0.01 %</>;
    return <>{porcentaje(v, { decimales: v < 1 ? 2 : 1 })}</>;
  }
  if (tipo === "enlace" && typeof valor === "object") {
    const { texto, url } = valor as { texto: string; url: string };
    const etiqueta = texto.length > 30 ? oracion(texto) : texto;
    // Las descripciones del SEACE llegan a 600 caracteres: tres líneas y el resto en el title.
    return url.startsWith("/") ? (
      <Link href={url} title={etiqueta} className="line-clamp-3 text-ink underline decoration-line underline-offset-2 hover:decoration-ink">{etiqueta}</Link>
    ) : (
      <a href={url} target="_blank" rel="noopener noreferrer" title={etiqueta} className="line-clamp-3 text-ink underline decoration-line underline-offset-2 hover:decoration-ink">{etiqueta} <ArrowUpRight size={11} aria-hidden className="inline align-baseline" /></a>
    );
  }
  const t = String(valor);
  // Los textos de las fuentes vienen en mayúsculas: nombres cortos a título, descripciones como oración.
  return <>{t === t.toUpperCase() ? (t.length > 60 ? oracion(t) : tituloNatural(t)) : t}</>;
}

/**
 * Fraccionamiento: las órdenes de cada día, que el texto sólo cuenta. Plegado debajo del cruce; cada día con lo que
 * suman contra el tope (una barra con la marca del tope) y sus órdenes: descripción, número, estado y monto. Con más
 * de cuatro días, paginado.
 */
function OrdenesFraccionadas({ dias }: { dias: DiaFraccionado[] }) {
  const total = dias.reduce((s, d) => s + d.ordenes, 0);
  const bloques = dias.map((d, i) => ({ id: `${d.fecha}-${i}`, contenido: <DiaOrdenes d={d} /> }));
  return (
    <details className="group mt-2 rounded-xl border border-line bg-paperSoft">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[13px] font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
        <span>
          Ver {total === 1 ? "la orden" : `las ${numero(total)} órdenes`}
          {dias.length === 1 ? ` del ${fechaCorta(dias[0].fecha)}` : ` de los ${numero(dias.length)} días`}
        </span>
        <ChevronDown size={14} aria-hidden className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">
        <p className="text-[12px] text-mute">
          Cada barra es lo que suman las órdenes de ese día; la marca, el tope de 8 UIT de ese año.
        </p>
        {bloques.length > 4 ? (
          <ListaPaginada items={bloques} tam={4} nombre="días" className="space-y-4" />
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
        <span className="font-semibold text-ink">{fecha(d.fecha)}</span>
        <span className="text-inkSoft">
          {numero(d.ordenes)} órdenes · <b className="font-mono tabular-nums text-ink">{soles(d.totalSoles)}</b>
          <span className="text-mute"> · tope {solesCompacto(d.topeSoles)}</span>
          {d.mismaDescripcion && <span className="text-amberTexto"> · misma descripción</span>}
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-granate/70" role="img" aria-label={`Suman ${soles(d.totalSoles)}; el tope es ${soles(d.topeSoles)}`}>
        <span aria-hidden className="absolute -top-1 bottom-[-4px] w-0.5 bg-ink" style={{ left: `${marca}%` }} />
      </div>
      <ol className="divide-y divide-line rounded-lg border border-line bg-paper">
        {d.detalle.map((o, i) => (
          <li key={`${o.orden}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 text-[13px]">
            <div className="min-w-0">
              <p className="text-ink">{o.descripcion ? oracion(o.descripcion) : "Sin descripción"}</p>
              <p className="mt-0.5 font-mono text-[11px] text-mute" translate="no">
                {o.orden}
                {o.estado ? <span className="font-sans"> · {o.estado.charAt(0) + o.estado.slice(1).toLowerCase()}</span> : null}
              </p>
            </div>
            <span className="font-mono tabular-nums text-ink">{soles(o.montoSoles)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CrucesProveedor({ cruces: todos, varios }: { cruces: CruceProveedor[]; varios?: boolean }) {
  if (!todos.length) return null;
  // Un antecedente es lo que ya había pasado cuando se convocó el proceso (migración 83); lo de después va aparte.
  const cruces = todos.filter((c) => !c.posterior);
  const posteriores = todos.filter((c) => c.posterior);
  // Un grupo por tipo, en orden de severidad (la más alta del grupo) y luego por cuántas filas tiene.
  const grupos = new Map<string, CruceProveedor[]>();
  for (const c of cruces) grupos.set(c.tipo, [...(grupos.get(c.tipo) ?? []), c]);
  const orden = [...grupos.values()].sort((a, b) =>
    Math.min(...a.map((x) => ORDEN[x.severidad])) - Math.min(...b.map((x) => ORDEN[x.severidad])) || b.length - a.length);

  return (
    <section aria-labelledby="cruces-proveedor" className="rounded-2xl border border-line bg-paper">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <h2 id="cruces-proveedor" className="text-[15px] font-semibold text-ink">
          {varios ? "Antecedentes de quienes ganaron" : "Antecedentes de quien ganó"}
        </h2>
        <Ayuda titulo="¿De dónde salen estos cruces?">
          Cruces automáticos por DNI y RUC entre el ganador (y sus socios y representantes del RNP) y los registros de la ONPE, el JNE,
          las visitas a entidades, CONOSCE, las penalidades y las sanciones del Tribunal. Son datos oficiales verificables en cada fuente: no prueban
          por sí solos una irregularidad. Sólo cuenta como antecedente lo que ya había pasado cuando se convocó el proceso; lo
          posterior se muestra aparte.
        </Ayuda>
      </div>
      {!cruces.length && (
        <p className="px-4 pb-3 pt-2 text-[13px] leading-relaxed text-inkSoft">
          Cuando se convocó este proceso, {varios ? "quienes ganaron no tenían" : "quien ganó no tenía"} antecedentes en estos registros.
        </p>
      )}
      <ul className="divide-y divide-line px-4 pb-1">
        {orden.map((grupo) => {
          const sev = grupo.reduce((m, x) => (ORDEN[x.severidad] < ORDEN[m] ? x.severidad : m), grupo[0].severidad);
          const filas = [...grupo].sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad] || (b.fecha ?? "").localeCompare(a.fecha ?? ""));
          return (
            <li key={grupo[0].tipo} className="py-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge variant={VARIANTE[sev]}>{SEVERIDAD[sev]}</Badge>
                <h3 className="text-[14px] font-semibold text-ink">
                  {grupo[0].etiqueta}
                  {grupo.length > 1 && <span className="font-normal text-mute"> · {grupo.length}</span>}
                </h3>
              </div>
              {POR_QUE[grupo[0].tipo] && <p className="mb-2 text-[12.5px] leading-relaxed text-inkSoft">{POR_QUE[grupo[0].tipo]}</p>}
              <ul className="list-disc space-y-1.5 pl-5">
                {filas.slice(0, VISIBLES).map((c, i) => <Fila key={i} c={c} />)}
              </ul>
              {filas.length > VISIBLES && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[13px] text-inkSoft hover:text-ink">Ver {filas.length - VISIBLES} más</summary>
                  <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
                    {filas.slice(VISIBLES).map((c, i) => <Fila key={i} c={c} />)}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {posteriores.length > 0 && (
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
            <span className="text-[13px] text-inkSoft">
              <span className="font-semibold text-ink">Después de este proceso · {numero(posteriores.length)}</span> — no eran antecedentes
              cuando se convocó
            </span>
            <ChevronDown size={14} aria-hidden className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-3">
            <p className="mb-2 text-[12.5px] leading-relaxed text-inkSoft">
              Pasó después de la convocatoria: quien adjudicó no podía saberlo. Se muestra como contexto de la empresa, no como señal sobre
              este proceso.
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              {[...posteriores].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "")).map((c, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-inkSoft">
                  <span className="font-medium text-ink">{c.etiqueta}:</span> <FilaContenido c={c} />
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}
