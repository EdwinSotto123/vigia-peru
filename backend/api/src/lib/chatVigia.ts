/**
 * El asistente de investigación de Vigía para quien tiene cuenta (2026-11-12, auditoría de producto, decisión D5). Es el
 * motor del chat del panel (lib/chatInvestigacion.ts) con las mismas herramientas del MCP, así que la privacidad y la
 * forma de cada dato son las del MCP. Cambian tres cosas:
 *
 *   · las instrucciones: le habla a un ciudadano o a un periodista, no al equipo; cierra con fuentes, límites y qué mirar
 *     después, y nunca concluye que hubo un delito;
 *   · los topes: pocas vueltas y un número de preguntas por día por cuenta y en total (el modelo lo pagamos nosotros y
 *     la cuenta es gratis); el modo «profundo» gasta más preguntas (`COSTO_MODO`) y tiene su propio techo;
 *   · lo que sale al navegador: ni el nombre interno del modelo ni el costo de la respuesta (`eventoPublico`).
 */

import { createHash, createHmac } from "node:crypto";

/** Preguntas por cuenta en 24 horas. */
export const TOPE_CUENTA_DIA = 10;
/** Preguntas de todas las cuentas en 24 horas: el techo de gasto del día (unos US$ 0,006 por pregunta en el panel). */
export const TOPE_TOTAL_DIA = 400;
/** Preguntas por cuenta en un minuto. */
export const TOPE_CUENTA_MINUTO = 3;
/** Largo de la conversación que se manda (caracteres, todos los mensajes). */
export const LARGO_CONVERSACION = 24_000;

// ─── Abuso (2026-11-13) ──────────────────────────────────────────────────────────────────────────────
// La cuenta es gratis: quien quiera gastar el modelo abre cuentas desechables. Por eso, además del tope por cuenta, hay
// topes por IP (una IPv6 por su /64) que suman todas las cuentas de esa conexión, un tope menor para la cuenta sin correo
// verificado, un bloqueo automático de 24 horas para quien choca contra los topes una y otra vez, y una lista fija
// (`CHAT_BLOQUEO`, variable del Worker: se cambia sin desplegar). La IP nunca se guarda en claro: el limitador la ve
// como una huella SHA-256 corta.

/** Preguntas por IP en 24 horas, de todas sus cuentas (una oficina o una universidad comparten IP: holgado). */
export const TOPE_IP_DIA = 40;
/** Preguntas por IP en un minuto, de todas sus cuentas. */
export const TOPE_IP_MINUTO = 6;
/** Preguntas por día de una cuenta cuyo correo no está verificado. */
export const TOPE_SIN_VERIFICAR_DIA = 3;
/** Rechazos por tope en una hora que bloquean la IP o la cuenta. */
export const FALTAS_PARA_BLOQUEO = 12;
/** Cuánto dura el bloqueo automático. */
export const BLOQUEO_S = 24 * 60 * 60;

/**
 * La huella de una IP (ya pasada por `claveIp`): HMAC-SHA256 con la clave de privacidad, 20 letras. Con la clave, nadie
 * recupera la IP probando las 4 mil millones de IPv4; sin ella (desarrollo), un SHA-256 fijo, que sirve igual de clave.
 */
export function huellaIp(claveIp: string): string {
  const clave = process.env.PRIVACIDAD_CLAVE ?? "";
  const h = clave.length >= 32 ? createHmac("sha256", clave) : createHash("sha256").update("vigia-chat|");
  return h.update(claveIp).digest("hex").slice(0, 20);
}

/**
 * Las preguntas por día que le tocan a una cuenta. La cuenta de usuario y contraseña de la web lleva un correo interno
 * (`usuario@vigia.local`) que no se puede verificar: cuenta como verificada (si no, casi toda cuenta real tendría 3). El
 * tope menor queda para un correo real que nunca se confirmó, que sí puede confirmarse. Las cuentas desechables las
 * frena el tope por IP.
 */
export const topeDiaCuenta = (correoVerificado: boolean, correo?: string | null) =>
  correoVerificado || !!correo?.toLowerCase().endsWith("@vigia.local") ? TOPE_CUENTA_DIA : TOPE_SIN_VERIFICAR_DIA;

/**
 * ¿Está en la lista fija? `lista` es la variable `CHAT_BLOQUEO`: IPs (la IPv6 como su /64, «2001:db8:1:2::/64»), uid de
 * cuentas o huellas de IP («h:» y las 20 letras que da `huellaIp`, las que salen en el registro), separadas por comas,
 * espacios o saltos de línea. `claveIp` es la IP ya pasada por `claveIp` de lib/antibots.ts.
 */
export function enListaFija(lista: string | undefined, claveIp: string | null, huella: string | null, uid: string): boolean {
  if (!lista) return false;
  const items = new Set(lista.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
  return items.has(uid.toLowerCase()) || (!!claveIp && items.has(claveIp.toLowerCase())) || (!!huella && items.has(`h:${huella}`));
}

function hoy(): string {
  return new Date().toLocaleDateString("es-PE", { timeZone: "America/Lima", day: "numeric", month: "long", year: "numeric" });
}

export function sistemaVigia(): string {
  return `Eres el asistente de investigación de Vigía (Vigía by Gobserva). Ayudas a ciudadanos, periodistas e investigadores a revisar la contratación pública del Perú. Hoy es ${hoy()}.

Qué puedes hacer:
- Buscar contratos, entidades, empresas proveedoras, partidos y obras, y traer su ficha.
- Decir qué señales tiene un contrato y qué evidencia las sostiene: la norma, el documento y la página.
- Comparar proveedores o entidades, y ver quién le vende a quién y cuánto.
- Buscar dentro de los documentos leídos (bases, actas, contratos, dictámenes).

Cómo investigar:
- Usa SOLO lo que devuelven tus herramientas. No inventes datos, relaciones ni conclusiones, y no completes con lo que creas saber. Si algo no está, dilo.
- Con solo un nombre, primero búscalo para obtener su código (RUC, OCID, CUI o clave). Si hay varias coincidencias, di cuál elegiste y por qué.
- Encadena los códigos que devuelve cada herramienta. Si una búsqueda da poco, reintenta con otras palabras antes de decir que no hay.
- Haz las consultas necesarias y no repitas la misma.

Cómo responder:
- En español del Perú, de tú, claro y directo. Primero la respuesta en una o dos frases; después el detalle.
- Tablas cuando haya varias filas: una fila por registro y el nombre enlazado. Las cifras, con S/ y coma de miles (S/ 4,500.00), nunca con punto de miles.
- Enlaza cada cosa que nombres con el enlace de Vigía que trae la herramienta, y el oficial cuando venga.
- Di de qué fuente y de qué periodo sale cada cifra.
- Distingue lo que es un dato oficial, lo que es un cruce de registros y lo que es una lectura o un dictamen hecho con IA.
- Termina con dos líneas cortas: «Lo que no pude verificar» y «Qué mirar después» (una o dos consultas o fichas concretas).
- Separa con comas, puntos o listas, nunca con «·». No nombres las herramientas ni sus parámetros.

Límites que no se negocian:
- Una señal o un puntaje es un indicio para revisar, no una acusación. Nunca digas que alguien cometió un delito, que es corrupto o que un contrato es ilegal: describe el hecho y su fuente. Determinar responsabilidades le toca a la Contraloría, al Ministerio Público y al Poder Judicial.
- El puntaje de un dictamen suma el peso de sus señales, con tope de 100. No es una probabilidad.
- Nunca pidas ni muestres un DNI. Las personas naturales salen con un apellido tapado: respétalo y no intentes completarlo. No busques a una persona particular por su nombre.
- Si te piden algo fuera de la contratación pública del Perú, dilo en una línea y ofrece lo que sí puedes revisar.`;
}

// ─── Modos (2026-11-25, el usuario: «selección de modelo, créditos restantes por día, historial») ─────────────────
// Los dos son modelos abiertos (vigia-llm los sirve con Workers AI: NATIVO_MODELOS en backend/llm-worker/wrangler.jsonc).
// «Rápido» es el de siempre; «Profundo» usa el modelo grande del motor, con más vueltas y el método de verificación, y
// gasta más preguntas del día porque cuesta más.

export type ModoVigia = "rapido" | "profundo";
/** Cuántas preguntas del día gasta cada modo. */
export const COSTO_MODO: Record<ModoVigia, number> = { rapido: 1, profundo: 3 };
/** Preguntas en modo profundo de todas las cuentas en 24 horas: su propio techo de gasto, aparte del total. */
export const TOPE_PROFUNDO_TOTAL_DIA = 60;
/** El modelo del motor (lib/chatInvestigacion.ts) de cada modo. */
export const MODELO_MODO = { rapido: "rapido", profundo: "fino" } as const satisfies Record<ModoVigia, "rapido" | "fino">;

const METODO_PROFUNDO = `

Modo profundo (quien pregunta lo eligió y le cuesta más preguntas: que se note):
- Antes de la primera consulta escribe un plan breve, de 3 a 5 pasos, con lo que vas a revisar.
- Cruza todas las fuentes que apliquen: gasto, compras, proveedores, señales, informes de control, obras e historia.
- Verifica cada cifra principal con una segunda consulta cuando se pueda y di si coinciden.
- Si dices que algo es «alto» o «raro», compáralo con entidades o proveedores parecidos.
- Antes de responder, revisa que cada afirmación tenga su cifra y su enlace; lo que no, va a «Lo que no pude verificar».`;

/** Con qué se llama al motor: todas las herramientas del MCP (ruta «») y topes cortos; el modo profundo, más holgados. */
export function pedidoVigia(modo: ModoVigia = "rapido"): { ruta: string; sistema: string; vueltas: number; max: number; sin: string[] } {
  // El chat de las cuentas entra al MCP como equipo interno (sin créditos): por eso lo que no debe hacer se quita aquí, en
  // el servidor, y no sólo en el texto del sistema. `rastro_persona` busca a cualquier persona por su nombre COMPLETO (con
  // el apellido que Vigía tapa) y devuelve el código de su ficha: desde una cuenta gratuita ataba un nombre entero a una
  // ficha tapada (auditoría del 2026-11-17). La búsqueda pública de personas sólo usa las palabras visibles.
  const sin = ["rastro_persona"];
  if (modo === "profundo") return { ruta: "", sistema: sistemaVigia() + METODO_PROFUNDO, vueltas: 16, max: 9000, sin };
  return { ruta: "", sistema: sistemaVigia(), vueltas: 10, max: 6000, sin };
}

/**
 * Lo que de cada evento del motor sale al navegador. Fuera el identificador interno del modelo (el motor nombra el que
 * pide, no el que contesta), los tokens y el costo: son del panel. Lo demás pasa igual.
 */
export function eventoPublico(e: Record<string, unknown>): Record<string, unknown> {
  if (e.tipo === "inicio") return { tipo: "inicio" };
  if (e.tipo === "fin") return { tipo: "fin", ms: e.ms, herramientas: e.herramientas };
  // El modelo a veces separa con «·» aunque se le pide que no: en la respuesta final va una coma.
  if (e.tipo === "respuesta" && typeof e.texto === "string") return { ...e, texto: e.texto.replace(/[ \t]+·[ \t]+/g, ", ") };
  return e;
}
