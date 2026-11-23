"use client";

/**
 * Las piezas de una señal que comparten el informe (/app/convocatoria/[id]) y el índice de
 * señales (/app/hallazgos): la evidencia de la fila en texto plano y sin datos personales
 * (`resumenSinDatosPersonales` / `ResumenEvidencia`), la ficha completa del panel lateral
 * (`DetalleSenal`) y las dos reglas que dicen el mismo hecho en una fila (`sinRepetidas`, sólo
 * desde el cliente). La lista en sí es la `Tabla` del kit (components/listado): la arma
 * AuditoriaDeAgentes en el informe y components/alertas/ListaSenales en el índice.
 */

import { ExternalLink, FileText } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, ChipsDetalle, CitaDetalle, CuerpoDetalle, DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { Severidad } from "@/components/ui/Severidad";
import { maskDnis, pareceEmpresa, redactDnis, type NombreConocido } from "@/components/Redact";
import { fechaConAnio, plural } from "@/lib/formato";
import { normaLegible } from "@/lib/modelos";
import { nombreDeAgente, pasoDeClave } from "./catalogo";
import { SelloVerificada } from "./SelloVerificada";
import { ORDEN_SEVERIDAD, type SenalAgente } from "./senales";

/** Lo que cabe en una línea de la fila: el resto de la evidencia está en el panel. */
const MAX_RESUMEN = 160;

/**
 * El análisis guarda hasta 500 caracteres por hallazgo (backend/agent/tools/persistence/shared.py). Uno de ese largo que
 * no termina en un cierre quedó cortado al guardarlo, a media palabra («…que no habría acreditado los»; 2026-11-23,
 * contrato 1238560). Se muestra hasta su última palabra entera, con «…», y se dice dónde leer el resto.
 */
const TOPE_GUARDADO = 500;
export function cortadaAlGuardar(bruto: string | null | undefined): boolean {
  const t = (bruto ?? "").trimEnd();
  return t.length >= TOPE_GUARDADO - 6 && !/[.!?»"”)\]]$/.test(t);
}
function hastaPalabraEntera(t: string): string {
  const sinFin = t.trimEnd().replace(/[\s,;:(«"“-]+$/, "");
  const esp = sinFin.lastIndexOf(" ");
  return `${esp > sinFin.length * 0.7 ? sinFin.slice(0, esp).replace(/[\s,;:(«"“-]+$/, "") : sinFin}…`;
}

/** ¿La fuente es un registro del Estado? Una nota de prensa o una web no es una «fuente oficial». */
function esFuenteOficial(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    // Todo registro del Estado peruano vive bajo gob.pe (OECE, SEACE, SUNAT, Contraloría, MEF, JNE, ONPE…).
    return /(^|\.)gob\.pe$/i.test(h);
  } catch {
    return false;
  }
}
/** El sitio de una URL, sin «www.»: «rcrperu.com». */
function sitioDe(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * La palabra que `PersonName` tapa de cada persona privada: en orden SUNAT el materno (2.ª
 * palabra), con el nombre primero la última. Es la misma en los dos órdenes, salvo con dos
 * palabras, donde cada orden tapa una distinta: van las dos. Las de una o dos letras ("DE",
 * "LA") no se tapan sueltas: taparían media oración.
 */
function apellidosPrivados(nombres: NombreConocido[]): Set<string> {
  const out = new Set<string>();
  for (const n of nombres) {
    const nombre = String((n && typeof n === "object" ? n.nombre : n) || "").normalize("NFC").trim();
    const partes = nombre.split(/\s+/).filter(Boolean);
    // Ya tapado por la API: su apellido no está en la evidencia (también llega tapado ahí).
    if (nombre.includes("•")) continue;
    if (partes.length < 2 || pareceEmpresa(nombre, n && typeof n === "object" ? n.ruc : null)) continue;
    const sunat = !!n && typeof n === "object" && n.orden === "sunat";
    const tapadas = partes.length === 2 ? partes : [sunat ? partes[1] : partes[partes.length - 1]];
    for (const p of tapadas) if (p.length > 2) out.add(sinTildes(p));
  }
  return out;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ─── La evidencia sin formas de máquina ─────────────────────────────────────────

/**
 * El campo del registro de donde salió un dato, entre paréntesis: «(ocds: numberOfTenderers/tenderers)», «(ofertas_bd:
 * …)», «(acta (ofertas presentadas): …)», sólo si lo que sigue a los dos puntos son nombres de campo (sin cifras: un
 * «(ocds: 3 postores)» es un dato y se queda). De otra fuente, si son nombres de campo de verdad (camelCase, guion bajo
 * o «a/b»): una nota común («(nota: importante)») no se toca.
 */
const CAMPO_ORIGEN = /\s*\((?:ocds|ofertas_bd|bd|acta(?:\s*\([^()]*\))?)\s*:[A-Za-z_/\s]*\)/gi;
const CAMPO_GENERICO = /\s*\([a-z_]+\s*:\s*(?=[A-Za-z_/]*(?:[a-z][A-Z]|_|\/))[A-Za-z_]+(?:\/[A-Za-z_]+)*\)/g;
/** Una palabra con su plural a medias: «sanción(es)», «vigente(s)», «VIGENTE(S)». */
const PLURAL_A_MEDIAS = /(\p{L}+)\(([eE]?[sS])\)/gu;
/** Un número seguido de una o más palabras con su plural a medias: «2 sanción(es) vigente(s)». */
const CUENTA_A_MEDIAS = /(\d[\d,.]*)((?:\s+\p{L}+\([eE]?[sS]\))+)/gu;
/** Una fecha ISO, con su hora si la trae: «2026-07-31», «2026-07-31T00:00:00Z». */
const FECHA_ISO = /\b(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const SIN_TILDE: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };

/** «sanción» + «es» → «sanciones» (la tilde de la última sílaba se va); «vigente» + «s» → «vigentes». */
function enPlural(palabra: string, sufijo: string): string {
  const mayus = palabra === palabra.toUpperCase();
  if (sufijo.toLowerCase() === "s") return palabra + (mayus ? "S" : "s");
  return palabra.replace(/([áéíóú])([ns])$/, (_, v: string, c: string) => SIN_TILDE[v] + c) + (mayus ? "ES" : "es");
}

/**
 * La evidencia como la escribe el análisis, sin sus formas de máquina (pedido del usuario del 2026-11-05: «Un solo postor
 * registrado (ocds: numberOfTenderers/tenderers)», «2 sanción(es) VIGENTE(S) … (2026-07-31)»): sin el campo de origen,
 * con el plural según el número («1 sanción vigente», «2 sanciones vigentes»; sin número, en plural), las mayúsculas de
 * énfasis en minúsculas, las fechas como «31 jul. 2026» y sin el «·» de separador. Cambia la forma, nunca el dato.
 */
export function limpiarEvidencia(texto: string): string {
  return (
    texto
      // Los análisis anteriores al 2026-11-16 llamaban «persona» a un socio que es una empresa («Persona con documento
      // 20100027292 figura como representante…»): un documento de 11 cifras que empieza en 20 es un RUC de empresa.
      .replace(/Persona con documento (20\d{9})(?!\d)/g, "La empresa con RUC $1")
      .replace(/persona con documento (20\d{9})(?!\d)/g, "la empresa con RUC $1")
      .replace(CAMPO_ORIGEN, "")
      .replace(CAMPO_GENERICO, "")
      // «VIGENTE(S)» → «vigente(s)»: una palabra entera en mayúsculas con su plural a medias es énfasis, no una sigla.
      .replace(/(?<!\p{L})(\p{Lu}{2,})\(([eE]?[sS])\)/gu, (_, w: string, s: string) => `${w.toLocaleLowerCase("es")}(${s.toLowerCase()})`)
      // «2 sanción(es) vigente(s)» → «2 sanciones vigentes»; «1 sanción(es)» → «1 sanción».
      .replace(CUENTA_A_MEDIAS, (_, n: string, palabras: string) =>
        n + palabras.replace(PLURAL_A_MEDIAS, (__: string, w: string, s: string) => (Number(n.replace(/[,.]/g, "")) === 1 ? w : enPlural(w, s))),
      )
      // Sin número delante: en plural («sanción(es)» → «sanciones»).
      .replace(PLURAL_A_MEDIAS, (_, w: string, s: string) => enPlural(w, s))
      .replace(FECHA_ISO, (m: string, d: string) => {
        const f = fechaConAnio(d);
        return f === "Sin fecha" ? m : f;
      })
      .replace(/\s+·\s+/g, "; ")
      .replace(/\s+([.,;:])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/**
 * La evidencia de la fila, en texto plano y corta: sin formas de máquina (`limpiarEvidencia`), DNI/RUC 10 enmascarados
 * y el apellido de cada persona privada del dossier tapado donde aparezca (de más, nunca de menos). El texto completo,
 * con el vidrio revelable, está en el panel.
 */
export function resumenSinDatosPersonales(texto: string, nombres: NombreConocido[] = [], max: number = MAX_RESUMEN): string {
  const t = maskDnis(limpiarEvidencia(texto.normalize("NFC")));
  const tapar = apellidosPrivados(nombres);
  const limpio = tapar.size ? t.replace(/\p{L}+/gu, (w) => (tapar.has(sinTildes(w)) ? "•".repeat(Math.min(Math.max(w.length, 3), 8)) : w)) : t;
  // Cortada al guardarla: hasta su última palabra entera y «…», nunca «…acreditado los».
  if (limpio.length <= max) return cortadaAlGuardar(texto) ? hastaPalabraEntera(limpio) : limpio;
  const corte = limpio.slice(0, max);
  // Con más lugar (las filas del dictamen), se corta en el final de una oración si lo hay: nunca a media frase.
  if (max > MAX_RESUMEN) {
    const fin = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("; "), corte.lastIndexOf(": "));
    if (fin > max * 0.35) return `${corte.slice(0, fin + 1).replace(/[;:]$/, ".")} …`;
  }
  const esp = corte.lastIndexOf(" ");
  return `${esp > max * 0.6 ? corte.slice(0, esp) : corte}…`;
}

/** ¿El resumen de la fila dejó parte de la evidencia afuera? (para decir «sigue en el panel» sólo cuando es cierto). */
export function evidenciaRecortada(texto: string, max: number = MAX_RESUMEN): boolean {
  return maskDnis(limpiarEvidencia(texto.normalize("NFC"))).length > max || cortadaAlGuardar(texto);
}

/**
 * El mismo resumen como componente: la función vive en este módulo cliente, así que un
 * server component (la tabla de /app/hallazgos) la usa a través de aquí, pasando sólo datos.
 */
export function ResumenEvidencia({ texto, nombres, max }: { texto: string; nombres?: NombreConocido[]; max?: number }) {
  return <>{resumenSinDatosPersonales(texto, nombres, max)}</>;
}

// ─── Dos reglas, un mismo hecho ─────────────────────────────────────────────────

/**
 * Reglas que, sobre el mismo contrato y el mismo proveedor, dicen el mismo hecho: «Sanción vigente en el OECE» (la del
 * análisis, a la fecha de la buena pro) y «Proveedor con sanción OSCE/OECE» (la del cruce con el registro de sancionados).
 * La primera de cada par es la más precisa: gana a igual severidad. Las mismas que `sinRepetidas` del índice de señales
 * (components/alertas/ListaSenales.tsx, un componente de servidor: no puede llamar a una función de este módulo cliente).
 */
const MISMO_HECHO: readonly (readonly [string, string])[] = [["sancion_vigente_oece", "proveedor_sancionado_osce"]];
/** El RUC del que habla la evidencia («… para el RUC 20…»): dos reglas sobre RUC distintos no son el mismo hecho. */
const rucDeEvidencia = (evidencia: string | null | undefined) => evidencia?.match(/RUC\s*(\d{11})/)?.[1] ?? null;

/**
 * Las señales de un contrato sin la que repite el hecho de otra (pedido del usuario del 2026-11-05: la misma sanción salía
 * dos veces seguidas con dos nombres, en el índice y en el informe): queda la más grave, y `tambien` es la otra, para que
 * su fila diga que otra regla marca lo mismo. El orden de las que quedan no cambia.
 */
export function sinRepetidas<T extends { regla: string; severidad: SenalAgente["severidad"]; evidencia?: string | null }>(
  senales: T[],
): { s: T; tambien: T | null }[] {
  const fuera = new Set<T>();
  const tambien = new Map<T, T>();
  for (const [precisa, otra] of MISMO_HECHO) {
    for (const a of senales.filter((x) => x.regla === precisa)) {
      const ra = rucDeEvidencia(a.evidencia);
      const b = senales.find((x) => {
        const rx = rucDeEvidencia(x.evidencia);
        return x.regla === otra && !fuera.has(x) && (!ra || !rx || ra === rx);
      });
      if (!b) continue;
      const [queda, sale] = ORDEN_SEVERIDAD[b.severidad] < ORDEN_SEVERIDAD[a.severidad] ? [b, a] : [a, b];
      fuera.add(sale);
      tambien.set(queda, sale);
    }
  }
  return senales.filter((s) => !fuera.has(s)).map((s) => ({ s, tambien: tambien.get(s) ?? null }));
}

/**
 * El panel de una señal del informe, con el formato de todo panel (DESIGN_SYSTEM.md §14.4):
 * chips → quién la encontró, en filas → qué mira la regla, qué se encontró, la norma y las
 * páginas del expediente. La fuente oficial va como fila: el pie del panel lo arma
 * AuditoriaDeAgentes.
 *
 * `contexto`: sobre quién es la señal (el ganador, la entidad y las empresas que nombra la evidencia, con su ficha): lo
 * arma el dictamen (convocatoria/senal/SobreQuien), que es quien sabe quién es cada RUC. `sinGenerales`: sin «Qué mira
 * esta regla» ni «Qué no prueba esto», para cuando un panel junta varias señales de la misma regla y los dice una vez.
 */
export function DetalleSenal({
  senal,
  etiqueta,
  descripcion,
  contexto,
  sinGenerales = false,
}: {
  senal: SenalAgente;
  etiqueta: string;
  descripcion: string | null;
  contexto?: React.ReactNode;
  sinGenerales?: boolean;
}) {
  const agente = pasoDeClave(senal.agente);
  // «Heurística — …» no es una norma sino un criterio de Vigía, y la URL cruda que algunas reglas pegan a la norma se quita.
  const norma = normaLegible(senal.norma);
  const oficial = !!senal.fuenteUrl && esFuenteOficial(senal.fuenteUrl);
  const cortada = cortadaAlGuardar(senal.evidencia);
  const datos: DatoClave[] = [
    {
      etiqueta: "La encontró",
      valor: <strong className="font-semibold">{nombreDeAgente(senal.agenteBruto ?? senal.agente)}</strong>,
      ayuda: agente ? <Ayuda titulo="¿Qué hace este agente?">{agente.que}</Ayuda> : undefined,
    },
    ...(agente ? [{ etiqueta: "Carril", valor: agente.carrilLabel }] : []),
    ...(agente && agente.fuentes.length > 0 ? [{ etiqueta: "Coteja contra", valor: agente.fuentes.join(", ") }] : []),
    ...(!agente && senal.agenteBruto ? [{ etiqueta: "Identificador del agente", valor: senal.agenteBruto, mono: true }] : []),
    // Una nota de prensa o una web no es «fuente oficial» (la señal de prensa enlazaba a rcrperu.com con ese nombre).
    ...(senal.fuenteUrl
      ? [
          {
            etiqueta: oficial ? "Fuente oficial" : "Fuente",
            valor: (
              <a href={senal.fuenteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
                {oficial ? "Ver la fuente oficial" : `Ver la nota en ${sitioDe(senal.fuenteUrl) ?? "su sitio"}`} <ExternalLink size={12} aria-hidden />
              </a>
            ),
          },
        ]
      : []),
  ];

  return (
    <CuerpoDetalle>
      {/* La gravedad ya está en la cabecera del panel («Señal media, la encontró Prensa»): aquí iba otra vez. Sólo
          dentro de un panel con varios hallazgos, donde cada uno puede tener la suya. */}
      <ChipsDetalle>
        {sinGenerales && <Severidad bandera={senal.severidad} />}
        <SelloVerificada verificada={senal.verificada} />
      </ChipsDetalle>

      {contexto}

      <BloqueDetalle titulo="Qué se encontró">
        {/* Sin las formas de máquina de la regla (el campo de origen, «sanción(es)», fechas ISO), como en la fila. */}
        {senal.evidencia ? (
          <p>{redactDnis(cortada ? hastaPalabraEntera(limpiarEvidencia(senal.evidencia)) : limpiarEvidencia(senal.evidencia))}</p>
        ) : (
          <p className="text-mute">El análisis no guardó el texto de esta señal.</p>
        )}
        {cortada && (
          <p className="mt-1.5 text-meta text-mute">
            El análisis guardó sólo el comienzo de este hallazgo.{" "}
            {senal.fuenteUrl ? (
              <a href={senal.fuenteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-granate hover:underline">
                Leer el resto en {oficial ? "la fuente oficial" : sitioDe(senal.fuenteUrl) ?? "la fuente"} <ExternalLink size={11} aria-hidden />
              </a>
            ) : (
              "El resto está en la fuente."
            )}
          </p>
        )}
        {senal.item && <p className="mt-1 text-meta text-mute">Sobre el ítem {senal.item}.</p>}
        {senal.evidenciaTextual && (
          <div className="mt-2">
            <CitaDetalle fuente="Texto del documento">{redactDnis(senal.evidenciaTextual)}</CitaDetalle>
          </div>
        )}
      </BloqueDetalle>

      <BloqueDetalle titulo="La norma que cita">
        {norma ? (
          <p>{norma.criterio ? <>Criterio de Vigía: {norma.texto}</> : norma.texto}</p>
        ) : (
          <p className="text-mute">Esta señal no cita una norma: se sostiene solo en la evidencia de arriba.</p>
        )}
        {senal.opinion?.num && <OpinionOece opinion={senal.opinion} />}
      </BloqueDetalle>

      <BloqueDetalle titulo="Quién la encontró y cómo se cotejó">
        <DatosClave items={datos} />
      </BloqueDetalle>

      {descripcion && !sinGenerales && (
        <BloqueDetalle titulo="Qué mira esta regla">
          <p>{descripcion}</p>
        </BloqueDetalle>
      )}

      {senal.citas.length > 0 && (
        <BloqueDetalle
          titulo="Evidencia en el expediente"
          acciones={<span className="shrink-0 text-rotulo tabular-nums text-mute">{plural(senal.citas.length, "página", "páginas")}</span>}
        >
          <ul className="space-y-2">
            {senal.citas.map((c, i) => {
              const fuente = (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-rotulo text-mute">
                  <FileText size={12} aria-hidden />
                  <span className="font-medium text-inkSoft">{c.documentoTitulo ?? "Documento del expediente"}</span>
                  {c.pagina != null && <span className="font-mono tabular-nums text-ink">pág. {c.pagina}</span>}
                  {c.documentoUrl &&
                    // Un documento del SEACE: la copia que guarda Vigía primero (el SEACE falla a menudo) y el SEACE al lado.
                    (/^https?:\/\/[a-z0-9.-]*seace\.gob\.pe(?::\d+)?\//i.test(c.documentoUrl) ? (
                      <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
                        <a href={`/v1/documentos/copia?u=${encodeURIComponent(c.documentoUrl)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
                          Ver el documento <ExternalLink size={11} aria-hidden />
                        </a>
                        <span>
                          (copia de Vigía; también{" "}
                          <a href={c.documentoUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-granate hover:underline">
                            en el SEACE
                          </a>
                          )
                        </span>
                      </span>
                    ) : (
                      <a href={c.documentoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
                        Abrir el documento <ExternalLink size={11} aria-hidden />
                      </a>
                    ))}
                </span>
              );
              // Sin texto de la página no hay cita que mostrar: sólo el documento y su enlace.
              return <li key={i}>{c.cita ? <CitaDetalle fuente={fuente}>{redactDnis(c.cita)}</CitaDetalle> : fuente}</li>;
            })}
          </ul>
        </BloqueDetalle>
      )}

      {!sinGenerales && (
        <BloqueDetalle titulo="Qué no prueba esto">
          <p className="text-inkSoft">
            Es una señal de riesgo, no una acusación: {etiqueta.toLowerCase()} es un indicio que hay que verificar contra la
            fuente oficial antes de publicarlo o denunciarlo.
          </p>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}

/** La opinión del OECE que respalda la norma: el extracto como cita, si se guardó; si no, sólo su número y enlace. */
function OpinionOece({ opinion }: { opinion: NonNullable<SenalAgente["opinion"]> }) {
  const fuente = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-rotulo text-mute">
      <span>
        Opinión del OECE <span className="font-mono">{opinion.num}</span>
      </span>
      {opinion.url && (
        <a href={opinion.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
          Abrir la opinión <ExternalLink size={11} aria-hidden />
        </a>
      )}
    </span>
  );
  return <div className="mt-2">{opinion.snippet ? <CitaDetalle fuente={fuente}>{opinion.snippet}</CitaDetalle> : fuente}</div>;
}
