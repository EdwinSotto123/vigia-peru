/**
 * Datos personales en las respuestas PÚBLICAS de la API (docs/PRIVACIDAD.md). Lo que sale de acá es lo
 * único que llega al navegador: la pantalla ya no tapa nada que el servidor haya dejado pasar. El panel
 * admin (rutas /admin, con token) recibe los datos completos.
 *
 *   · DNI: nunca, ni parcial.
 *       - En un campo de documento (dni, numero_documento, *_dni…) va una referencia opaca `ref·7K2Q9A`:
 *         HMAC del documento con una clave secreta (PRIVACIDAD_CLAVE). La misma persona lleva la misma ref
 *         en todo Vigía (el grafo une registros por ahí) y sin la clave no se vuelve al DNI. El repo es
 *         público: con una clave conocida bastaría recorrer los 10⁸ DNI, por eso es un secreto.
 *       - En texto libre, todo número suelto de 8 dígitos → `••••••••` (lo que antes tapaba la pantalla).
 *   · RUC 10 (persona natural: sus dígitos 3 a 10 son el DNI): como valor de un campo, `10·ref·7K2Q9A`
 *     (la ref de su DNI: único, y une al proveedor con la misma persona como socio o firmante); en texto,
 *     `10•••••••••`. Los RUC 20 (empresas) no se tocan.
 *   · Nombres de personas naturales privadas (todas salvo las autoridades electas, que van completas: las reconoce su
 *     cargo de elección al lado del nombre o la marca `electo: true` que pone la ruta, lib/electos.ts): un apellido tapado,
 *     `•••`. El materno: la última palabra si el nombre va primero ("JOSE MANUEL SARA •••"), la segunda en
 *     orden SUNAT/RNP ("CARPIO ••• ABEL"). Se buscan en todo el JSON (valores, claves y prosa), en los dos
 *     órdenes, sin tildes y por palabras completas.
 *   · Familiares que deduce la IA (`pareja_o_familia`): el nombre entero → `•••`, salvo que la misma persona
 *     tenga otro papel en el contrato (proveedor, socio, firmante): ahí sigue la regla del apellido.
 *   · Correos `a***@dominio`; celulares `9••••••••`.
 *   · URLs: fuera las que llevan un DNI conocido o un RUC 10, los perfiles personales (LinkedIn) y las
 *     páginas de agregadores (DatosPerú y similares) con el nombre de una persona protegida. Las fuentes
 *     oficiales y la prensa se quedan: son donde se verifica el dato.
 *
 * Quién es quién sale de la forma del JSON, no de adivinar con NER: los papeles (firmantes, comité,
 * socios, familiares, autoridades…) y los pares RUC 10 + razón social. Un nombre que sólo aparece en prosa
 * no se reconoce, salvo pegado a un DNI ("PEREZ QUISPE JUAN (DNI 4…)") o a una firma digital ("… FIR 4…").
 */

import { createHmac, randomBytes } from "node:crypto";

export const TAPA_NOMBRE = "•••";
export const TAPA_DNI = "••••••••";
export const TAPA_RUC10 = "10•••••••••";
export const TAPA_CELULAR = "9••••••••";
const REF = "ref·";

// ─── Referencia opaca de un documento ────────────────────────────────────────

let secreto: Buffer | null = null;

function claveSecreta(): Buffer {
  if (secreto) return secreto;
  const env = process.env.PRIVACIDAD_CLAVE ?? "";
  if (env.length >= 32) {
    secreto = Buffer.from(env, "utf8");
  } else {
    // Sin secreto, una clave al azar por proceso: las refs siguen sin revelar nada y unen dentro de cada
    // respuesta, pero cambian entre instancias (una página no se cruza con otra).
    console.warn(JSON.stringify({ severity: "WARNING", message: "[privacidad] sin PRIVACIDAD_CLAVE: refs al azar por instancia" }));
    secreto = randomBytes(32);
  }
  return secreto;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** `ref·XXXXXX` de un documento (DNI, carné…): 30 bits del HMAC-SHA256, en base 32 de Crockford. */
export function refDocumento(doc: string): string {
  const h = createHmac("sha256", claveSecreta()).update(doc.trim().toUpperCase()).digest();
  let n = h.readUInt32BE(0) >>> 2;
  let s = "";
  for (let i = 0; i < 6; i++) {
    s = CROCKFORD[n & 31] + s;
    n >>>= 5;
  }
  return REF + s;
}

/** RUC 10 → `10·ref·XXXXXX`, con la ref del DNI que lleva adentro (dígitos 3 a 10). */
export const refRuc10 = (ruc: string) => `10·${refDocumento(ruc.slice(2, 10))}`;

/** ¿Es una ref de las que pone este módulo? (`ref·…` o `10·ref·…`) */
export const esRef = (v: unknown) => typeof v === "string" && /^(10·)?ref·[0-9A-Z]{6}$/.test(v);

// ─── Patrones ─────────────────────────────────────────────────────────────────

/** RUC 10 como valor entero de un campo (también el `PE-RUC-…` de los registros OCDS). */
const RUC10_SOLO = /^(PE-RUC-)?(10\d{9})$/;
const RUC10_EN_TEXTO = /(?<!\d)10\d{9}(?!\d)/g;
/** DNI con su etiqueta (también el sello de la firma digital: "… FIR 43960880 hard"). */
const DNI_CON_ETIQUETA = /(\b(?:d\.?\s?n\.?\s?i\.?|documento(?:\s+(?:nacional\s+)?de\s+identidad)?|c\.?\s?e\.?|fir|n[°º])\b[^\d\n]{0,14})(\d{8})(?!\d)/gi;
/**
 * Cualquier número de 8 dígitos que no sea parte de otro número (más dígitos, decimales) ni vaya detrás
 * de una moneda. Pegado a letras también ("DNI43960880", un sello escaneado "…43960880m"), salvo que la
 * tira de letras y dígitos sea larga como un hash o un código (`esCodigoLargo`).
 */
const DNI_SUELTO = /(?<!(?:S\/\.?|US\$|\$|€)\s{0,2})(?<![\d.,/])\d{8}(?!\d|[.,]\d)/gu;

/** ¿El número en `desde` es parte de una tira alfanumérica de 12 o más (sha256, id de documento)? */
function esCodigoLargo(s: string, desde: number, largo: number): boolean {
  let i = desde;
  let f = desde + largo;
  // Cruza letras, dígitos y los separadores de un código (guion y barra): así "O/C-01234567-2026-…" o
  // "AS-SM-3-2025-…" se ven como UN código público, no como un DNI suelto de 8 dígitos (que sí hay que tapar).
  while (i > 0 && /[\p{L}\d/-]/u.test(s[i - 1])) i--;
  while (f < s.length && /[\p{L}\d/-]/u.test(s[f])) f++;
  return f - i >= 12;
}
/** El formato viejo de este módulo ("43****80") y del saneado del agente: ya no se muestra ni eso. */
const MASCARA_VIEJA = /(?<![\d*])\d{2}\*{4}\d{2}(?![\d*])/g;
const CELULAR = /(?<![\p{L}\d.,/])9\d{2}[\s-]?\d{3}[\s-]?\d{3}(?![\p{L}\d]|[.,]\d)/gu;
const CORREO = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const URL_EN_TEXTO = /https?:\/\/[^\s<>"'`)\]]+/gi;
/** Una palabra: letras, con apóstrofo o guion por dentro ("D'ANGELO", "PEREZ-ROSAS"). */
const PALABRA = /\p{L}+(?:['’-]\p{L}+)*/gu;

/** Campos que guardan un número de documento de identidad. */
export function esClaveDocumento(k: string): boolean {
  const l = k.toLowerCase();
  return /(^|_)dnis?(_|$)/.test(l) || /^dni[A-Z]/.test(k) || /[a-z]Dnis?$/.test(k)
    || /^(numero|num|nro)_?(de_)?documento(_?identidad)?$/.test(l) || /^(documento|doc)_?(de_)?identidad$/.test(l)
    || /^(carne|carnet)_extranjeria$/.test(l);
}

/** Campos de identificadores técnicos: un valor de 8 dígitos ahí es un código, no un DNI. */
const esClaveId = (k: string) => /^(id|ocid|uuid|cui|snip|hash|codigo|cod)$|(_id|Id|_sha256|sha256|_codigo|_cod)$|^codigo_|^cod_/i.test(k);

// ─── Nombres ──────────────────────────────────────────────────────────────────

type Orden = "nombres-primero" | "sunat";
/** `apellido`: se tapa un apellido; `completo`: el nombre entero (familiares que deduce la IA). */
type Modo = "apellido" | "completo";

/** Sin tildes y en minúsculas: "ALARCÓN" y "alarcon" son la misma palabra. */
const normal = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Nombres de pila frecuentes: deciden el orden cuando el campo no lo garantiza ("JUAN PEREZ QUISPE" va
 * con el nombre primero; "PEREZ QUISPE JUAN", en orden SUNAT). Sólo afinan qué palabra se tapa.
 */
const PILA = new Set(`juan jose maria luis carlos jorge cesar victor miguel pedro manuel julio alberto ana rosa luz carmen
elizabeth martha marco mario raul ricardo roberto oscar edgar edwin wilber wilmer william walter fredy freddy hugo david
daniel javier fernando francisco antonio alejandro alex angel nancy gladys sonia silvia patricia milagros yolanda julia
flor elsa lourdes teresa isabel beatriz veronica karina katherine diana giovanna jesus segundo eduardo enrique ernesto
felix fidel german guillermo hector henry ivan jaime joel jhon john jonathan juana julian kevin leonardo lucia marcos
margarita marisol mercedes nelly nestor noemi norma olga pablo paola percy rafael ramon rene rocio ronald ruben ruth
samuel santiago sara sergio susana tania vicente wilfredo yesenia yeny zoila abel adrian alfredo alfonso armando arturo
augusto benjamin carla cristian cristina dante delia dina doris edith elmer elvis emilio erika esther eva fabiola gabriela
gerardo gilberto gloria grover gustavo herminio hilda humberto ines irma jacinto jenny jessica johan karen lidia liliana
lizbeth lorena magaly manuela marina marleny marta maximo melissa mirian monica nilda nora orlando pamela pilar raquel
reynaldo rolando rosario rossana saul simon sofia tomas ursula vanessa wendy alan andres andrea angela beto carolina
claudia consuelo cynthia denis dennis edson elena eliana estela evelyn fanny felipe flavio franklin gaby gisela gregorio
hernan hilario ingrid isaac isaias jacqueline jaqueline jhonny johnny josue juliana justo leoncio lily lisbeth lizeth
lucio luciano lucy magdalena marcelino marcial marcelo mariela marilyn maritza martin mateo mauricio maximiliano mayra
medardo melchor miriam moises nadia natalia nicolas noe olinda omar pascual paul paulina pedro rebeca reyna ricardina
rodolfo rodrigo romulo ronal rosa ruben sabina salomon santos sebastian severino silvio tito ulises valentin vilma
virginia walther wilson yanet yolanda yuri zenon florencio fortunato epifanio leandro leonor nazario teofilo eusebio`
  .split(/\s+/).filter(Boolean));

/** El orden más probable de `palabras` (normalizadas); `porDefecto` el del campo de donde salió. */
function ordenProbable(palabras: string[], porDefecto: Orden): Orden {
  if (palabras.length < 2) return porDefecto;
  const primera = PILA.has(palabras[0]);
  const ultima = PILA.has(palabras[palabras.length - 1]);
  const tercera = palabras.length >= 3 && PILA.has(palabras[2]);
  if (primera && !ultima) return "nombres-primero";
  if (!primera && (ultima || tercera)) return "sunat";
  return porDefecto;
}

/**
 * Apellidos y nombres de pila. Con coma ("PEREZ QUISPE, JUAN") los apellidos van antes de la coma; si no,
 * los dos últimos (nombre primero) o los dos primeros (orden SUNAT); con dos palabras, uno y uno. El que
 * se tapa es el último apellido: el materno.
 */
function partes(p: string[], orden: Orden, coma: number): { apellidos: string[]; nombres: string[] } {
  if (coma > 0 && coma < p.length) return { apellidos: p.slice(0, coma), nombres: p.slice(coma) };
  if (p.length === 2) return orden === "sunat" ? { apellidos: [p[0]], nombres: [p[1]] } : { apellidos: [p[1]], nombres: [p[0]] };
  return orden === "sunat" ? { apellidos: p.slice(0, 2), nombres: p.slice(2) } : { apellidos: p.slice(-2), nombres: p.slice(0, -2) };
}

/** Títulos que a veces van pegados delante del nombre ("Lic.Adm.", "Ing.", "C.P.C."): no son parte de él. */
const TITULOS = new Set(`lic adm ing abog dr dra mg mag msc cpc arq econ sr sra srta prof tec bach obs med cd ingeniero
ingeniera abogado abogada doctor doctora licenciado licenciada don dona`.split(/\s+/).filter(Boolean));

/** Cuántas palabras del comienzo son títulos (siempre deja al menos dos). */
function titulosAlInicio(claves: string[]): number {
  let i = 0;
  while (i < claves.length - 2) {
    if (TITULOS.has(claves[i])) {
      i++;
      continue;
    }
    // "C.P.C." llega como letras sueltas: juntas, "cpc".
    let j = i;
    let sigla = "";
    while (j < claves.length && claves[j].length === 1) sigla += claves[j++];
    if (j > i + 1 && TITULOS.has(sigla) && j <= claves.length - 2) {
      i = j;
      continue;
    }
    break;
  }
  return i;
}

/**
 * Siglas y palabras que sólo lleva una organización ("S.A.C.", "S. A. C." y "SAC" son la misma "sac").
 * Mismo criterio que `pareceEmpresa` de frontend/components/Redact.tsx, con algunas más.
 */
const MARCAS_EMPRESA = new Set([
  "sac", "saa", "sa", "sacs", "srl", "eirl", "ltda", "consorcio", "inversiones", "empresa", "corporacion",
  "asociacion", "sociedad", "compania", "cooperativa", "grupo", "contratistas", "constructora", "distribuidora",
  "servicios", "municipalidad", "gobierno", "ministerio", "hospital", "universidad", "banco", "instituto",
  "comercial", "industrial", "importaciones", "negociaciones", "ingenieros", "consultores", "consultora",
  "contratista", "transportes", "multiservicios", "proyecto", "programa", "unidad", "direccion", "gerencia",
  "oficina", "fundacion", "comunidad", "red", "centro", "laboratorios", "farmaceutica", "editora", "agencia",
]);

export function pareceEmpresa(nombre: string): boolean {
  const palabras = normal(nombre).split(/[^a-z0-9]+/).filter(Boolean);
  const juntas: string[] = [];
  let sigla = "";
  for (const p of palabras) {
    if (p.length === 1) {
      sigla += p; // "s", "a", "c" → "sac"
      continue;
    }
    if (sigla) juntas.push(sigla);
    sigla = "";
    juntas.push(p);
  }
  if (sigla) juntas.push(sigla);
  return juntas.some((p) => MARCAS_EMPRESA.has(p)) || /\d/.test(nombre);
}

/** Palabras que una captura de prosa arrastra por delante del nombre ("GERENTE JUAN PEREZ (DNI …)"). */
const ANTES_DEL_NOMBRE = new Set(`el la los las del de y e a al con por sr sra srta sres don dona senor senora ing ingeniero
ingeniera abog abogado abogada dr dra doctor doctora lic licenciado licenciada cpc arq mg mag msc bach tec obs med prof
gerente general jefe jefa director directora presidente presidenta miembro titular representante legal socio socia
firmante postor ganador proveedor alcalde alcaldesa regidor regidora subgerente secretario secretaria tesorero
administrador administradora apoderado apoderada accionista asesor asesora especialista responsable encargado encargada
coordinador coordinadora supervisor supervisora residente funcionario funcionaria servidor servidora contador contadora
firmado digitalmente`.split(/\s+/).filter(Boolean));

/**
 * Una persona: sus formas (cada orden de palabras en que aparece, más los dos órdenes canónicos), qué
 * palabra se tapa (`oculta`, normalizada) y por qué aparece: `familia` (la IA la dedujo pariente de
 * alguien) y `papel` (tiene uno en el contrato: proveedor, postor, socio, firmante, funcionario…). Un
 * familiar sin papel se tapa entero; las consultas (ONPE, JNE, visitas, la clave de
 * `datos_peru_por_persona`, la prosa) no cuentan como papel.
 */
interface Persona { id: string; formas: Map<string, string[]>; oculta: string; familia: boolean; papel: boolean }
type Tipo = "papel" | "consulta" | "familia";
const modoDe = (p: Persona): Modo => (p.familia && !p.papel ? "completo" : "apellido");
interface Variante { claves: string[]; oculta: number } // oculta = -1: el nombre entero

// ─── Pasada 1: quién es quién ────────────────────────────────────────────────

/**
 * Papeles con nombre de persona, por la clave del arreglo u objeto que los contiene. `tipo`: `papel` en
 * el contrato (por defecto), `consulta` (un registro donde se la buscó: ONPE, JNE, visitas, RNP de los
 * firmantes) o `familia` (pariente que deduce la IA).
 */
const PAPELES: Record<string, { campos: [campo: string, orden: Orden][]; tipo?: Tipo }> = {
  firmantes: { campos: [["nombre_completo", "nombres-primero"], ["nombre", "nombres-primero"]] },
  firmantes_consolidados: { campos: [["nombre_completo", "nombres-primero"], ["nombre", "nombres-primero"]] },
  firmantes_descartados_por_alucinacion: { campos: [["nombre_completo", "nombres-primero"], ["nombre", "nombres-primero"]], tipo: "consulta" },
  comite_evaluacion: { campos: [["nombre_completo", "nombres-primero"], ["nombre", "nombres-primero"]] },
  funcionarios_designados: { campos: [["nombre_completo", "nombres-primero"], ["nombre", "nombres-primero"]] },
  cruce_firmantes_ganador: { campos: [["firmante", "nombres-primero"], ["persona_proveedor", "nombres-primero"]] },
  rnp_firmantes_resultados: { campos: [["firmante", "nombres-primero"]] },
  empresas: { campos: [["nombre_visto", "sunat"], ["nombre_normalizado_rnp", "sunat"]], tipo: "consulta" },
  persona_principal: { campos: [["nombre_completo", "nombres-primero"], ["nombre", "nombres-primero"]] },
  pareja_o_familia: { campos: [["nombre", "nombres-primero"], ["nombre_completo", "nombres-primero"]], tipo: "familia" },
  socios: { campos: [["nombre", "sunat"]] },
  representantes_legales: { campos: [["nombre", "sunat"]] },
  organos_administracion: { campos: [["nombre", "sunat"]] },
  representantes: { campos: [["nombre", "nombres-primero"]] },
  gerente_general: { campos: [["nombre", "sunat"]] },
  visitas: { campos: [["visitante", "sunat"], ["funcionario", "sunat"]], tipo: "consulta" },
  visitas_relevantes: { campos: [["visitante", "sunat"], ["funcionario", "sunat"], ["funcionario_nombre", "sunat"]], tipo: "consulta" },
  visitas_inter_municipales: { campos: [["persona", "nombres-primero"], ["funcionario_anfitrion", "sunat"]], tipo: "consulta" },
  aportes: { campos: [["nombre", "sunat"]], tipo: "consulta" },
  candidaturas: { campos: [["nombre", "sunat"]], tipo: "consulta" },
};

/**
 * Cargos de elección popular, al comienzo del cargo ("Alcalde provincial de …", "Ex regidor"). "Asesor del
 * alcalde" o "Gerente municipal" no: son designados.
 */
const CARGO_ELECTO = /^\s*(?:ex\s*-?\s*)?(?:teniente\s+)?(?:alcalde|alcaldesa|gobernador|gobernadora|vicegobernador|vicegobernadora|regidor|regidora|consejero\s+regional|consejera\s+regional|congresista)\b/i;

/** Objetos con un RUC: si es un RUC 10, el nombre de al lado es el de una persona natural (orden SUNAT). */
const CLAVES_RUC = ["ruc", "rucProveedor", "proveedorRuc", "proveedor_ruc", "ruc_proveedor", "ganador_ruc", "ruc_postor", "ruc_empresa", "ruc_ocr", "rucContratista", "ruc_contratista", "id"];
const CLAVES_RAZON = ["razon_social", "razonSocial", "proveedor", "nombre", "name", "legalName", "proveedor_nombre", "proveedorNombre", "ganador_razon_social", "razon_social_ocds", "contratista"];

class Recolector {
  personas = new Map<string, Persona>();
  electos = new Set<string>();
  documentos = new Set<string>();

  /** Id de una persona sin importar el orden: las palabras normalizadas, ordenadas. */
  private static id(claves: string[]) {
    return [...claves].sort().join(" ");
  }

  /** Palabras normalizadas de un nombre, sin los títulos de adelante, y dónde empieza lo que va tras la coma. */
  private static palabras(nombre: string): { claves: string[]; coma: number } {
    const texto = nombre.normalize("NFC");
    const toks = [...texto.matchAll(PALABRA)];
    const claves = toks.map((m) => normal(m[0]));
    const iComa = texto.indexOf(",");
    let coma = iComa > 0 ? toks.findIndex((m) => m.index! > iComa) : -1;
    const t = titulosAlInicio(claves);
    if (coma >= 0) coma -= t;
    return { claves: claves.slice(t), coma };
  }

  persona(nombre: unknown, orden: Orden, tipo: Tipo = "papel") {
    if (typeof nombre !== "string") return;
    // "ROJAS PAZ ELENA (SUCESION DE …)": lo de afuera y lo de adentro del paréntesis, cada uno por su lado.
    const paren = /^([^()]+)\(([^()]+)\)\s*$/.exec(nombre);
    if (paren) {
      this.persona(paren[1], orden, tipo);
      this.persona(paren[2], orden, tipo);
      return;
    }
    if (pareceEmpresa(nombre)) return;
    const { claves, coma } = Recolector.palabras(nombre);
    if (claves.length < 2 || claves.length > 8) return;
    const id = Recolector.id(claves);
    let p = this.personas.get(id);
    if (p) {
      // La misma persona escrita en otro orden en otro campo: también esa forma.
      p.formas.set(claves.join(" "), claves);
    } else {
      const { apellidos, nombres } = partes(claves, coma > 0 ? "sunat" : ordenProbable(claves, orden), coma);
      const formas = new Map<string, string[]>();
      for (const f of [claves, [...nombres, ...apellidos], [...apellidos, ...nombres]]) formas.set(f.join(" "), f);
      p = { id, formas, oculta: apellidos[apellidos.length - 1], familia: false, papel: false };
      this.personas.set(id, p);
    }
    if (tipo === "familia") p.familia = true;
    if (tipo === "papel") p.papel = true;
  }

  electo(nombre: unknown) {
    if (typeof nombre !== "string") return;
    const { claves } = Recolector.palabras(nombre);
    if (claves.length >= 2) this.electos.add(Recolector.id(claves));
  }

  /** Nombres que se tapan aunque tengan cargo de elección (ver `parecido`): ganan a `electos`. */
  forzados = new Set<string>();

  /**
   * Alguien que COMPARTE los dos apellidos con la persona protegida (señales `apellidos_*`), o que es ella misma sin un
   * documento que lo confirme (autoridad por nombre): se tapa igual que ella, el mismo apellido, aunque sea autoridad.
   * Mostrar completo a "QUISPE ROJAS LISSETT" junto a "QUISPE ••• OVIDIO" destapaba justo el apellido escondido.
   */
  parecido(nombre: unknown) {
    if (typeof nombre !== "string" || pareceEmpresa(nombre)) return;
    this.persona(nombre, "sunat");
    const { claves, coma } = Recolector.palabras(nombre);
    const p = this.personas.get(Recolector.id(claves));
    if (!p) return;
    // El mismo cálculo que para la persona protegida (orden SUNAT/JNE, apellidos primero): se tapa la misma palabra,
    // también si esta persona ya se había registrado en otro campo con otro orden.
    const { apellidos } = partes(claves, coma > 0 ? "sunat" : ordenProbable(claves, "sunat"), coma);
    p.oculta = apellidos[apellidos.length - 1];
    p.papel = true;
    this.forzados.add(p.id);
  }

  documento(v: unknown) {
    const d = typeof v === "number" ? String(v) : typeof v === "string" ? v.replace(/[\s.-]/g, "") : "";
    if (/^\d{8}$/.test(d)) this.documentos.add(d);
    else if (/^10\d{9}$/.test(d)) this.documentos.add(d.slice(2, 10));
  }

  /** Prosa: nombres pegados a un DNI o a una firma digital (el DNI dice que es una persona natural). */
  texto(s: string) {
    if (s.length < 12 || !/\d{8}/.test(s)) return;
    for (const m of s.matchAll(NOMBRE_CON_DNI)) this.personaDeProsa(m[1], false);
    for (const m of s.matchAll(NOMBRE_CON_FIRMA)) this.personaDeProsa(m[1], true);
  }

  private personaDeProsa(captura: string, firma: boolean) {
    const palabras = [...(captura.match(PALABRA) ?? [])];
    while (palabras.length && ANTES_DEL_NOMBRE.has(normal(palabras[0]!))) palabras.shift();
    if (palabras.length < 2) return;
    const nombre = palabras.slice(-6).join(" ");
    // El sello de la firma digital va con los apellidos primero; pegado a "(DNI …)", con 2 o 3 palabras
    // casi siempre es el orden del RNP/SUNAT y con 4 o más, el hablado (frontend/lib/revision.ts).
    this.persona(nombre, firma || palabras.length <= 3 ? "sunat" : "nombres-primero", "consulta");
  }
}

/** Una palabra en mayúsculas ("QUISPE", "PEÑA", "D'ANGELO") y una con mayúscula inicial ("Maria"). */
const MAYUS = String.raw`\p{Lu}[\p{Lu}'’-]+`;
const INICIAL = String.raw`\p{Lu}[\p{L}'’-]+`;
/**
 * "PEREZ QUISPE JUAN (DNI 43960880)", "JUAN PEREZ (43960880)", "JUAN PEREZ, identificado con DNI N° 43960880".
 * Sólo palabras en mayúsculas, como `NOMBRE_CON_DNI` de frontend/lib/revision.ts: en minúsculas la captura
 * arrastraría el comienzo de la oración ("Según el gerente …").
 */
const NOMBRE_CON_DNI = new RegExp(
  String.raw`((?:${MAYUS}\s+){1,6}${MAYUS}),?\s*(?:\(\s*(?:D\.?\s?N\.?\s?I\.?\s*(?:N[°º.]?\s*)?:?\s*)?\d{8}\s*\)|,?\s+(?:identificad[oa]\s+con\s+)?D\.?\s?N\.?\s?I\.?\s*(?:N[°º.]?\s*)?:?\s*\d{8})`,
  "gu");
/**
 * Sello de la firma digital peruana: apellidos en mayúsculas y luego los nombres ("Firmado digitalmente
 * por: CHAVEZ RIOS Maria Elena FIR 41234567 hard").
 */
const NOMBRE_CON_FIRMA = new RegExp(String.raw`((?:${MAYUS}\s+){1,3}(?:${INICIAL}\s+){0,3}${INICIAL})\s+FIR\s+\d{8}`, "gu");

/**
 * `tapados`: dentro del detalle de una señal que nombra a la persona protegida o a quien comparte sus dos apellidos
 * (ver abajo): ahí ningún nombre sale completo por su cargo.
 */
function recolectar(v: unknown, r: Recolector, clavePadre = "", autoridades = false, profundidad = 0, tapados = false): void {
  if (profundidad > 60 || v == null) return;
  if (typeof v === "string") {
    r.texto(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) recolectar(x, r, clavePadre, autoridades, profundidad + 1, tapados);
    return;
  }
  if (typeof v !== "object") return;
  const o = v as Record<string, unknown>;

  // Una señal de persona (personas contratadas, planilla): su tipo decide cómo se leen los nombres de su detalle.
  //   apellidos_*            la autoridad, el funcionario o el directivo tiene sus MISMOS dos apellidos: completo,
  //                          destapa el de la persona.
  //   autoridad por nombre   (autoridad_contratada, es_autoridad sin `por: "dni"`): puede ser ella o un homónimo; sin
  //                          documento no se la trata como pública. La planilla nunca trae DNI.
  let tapar = tapados;
  if (typeof o.tipo === "string") {
    const det = o.detalle && typeof o.detalle === "object" ? (o.detalle as Record<string, unknown>) : undefined;
    if (o.tipo.startsWith("apellidos_")) tapar = true;
    else if ((o.tipo === "autoridad_contratada" || o.tipo === "es_autoridad") && (det?.por ?? o.por) !== "dni") tapar = true;
  }

  let conRuc10 = false;
  for (const [k, x] of Object.entries(o)) {
    if (esClaveDocumento(k)) r.documento(x);
    if (typeof x === "string") {
      const m = RUC10_SOLO.exec(x.trim());
      if (m) {
        r.documento(m[2]);
        if (CLAVES_RUC.includes(k)) conRuc10 = true;
      }
    }
  }
  // `identifier: {id: "10…", legalName}` y `{id: "PE-RUC-10…", name}` de los registros OCDS.
  if (conRuc10) for (const k of CLAVES_RAZON) r.persona(o[k], "sunat");

  if (tapar) {
    for (const n of [o.nombre, o.nombre_completo, o.autoridad]) r.parecido(n);
  } else if (autoridades) {
    r.electo(o.nombre);
    r.electo(o.nombre_completo);
  } else {
    const papel = PAPELES[clavePadre];
    if (papel) for (const [campo, orden] of papel.campos) r.persona(o[campo], orden, papel.tipo);
    // La ruta ya sabe por su DNI que es o fue autoridad electa (lib/electos.ts): su nombre va completo donde aparezca.
    if (o.electo === true) for (const n of [o.nombre, o.nombre_completo, o.visitante, o.persona, o.autoridad, o.firmante]) r.electo(n);
    // Quien ejerce un cargo de elección (el alcalde que firma, un regidor en el comité) es público
    // donde aparezca. `vinculo_autoridades` mezcla electos con designados (un gerente municipal): ahí
    // decide el cargo.
    const cargo = [o.cargo, o.cargo_actual, o.cargo_firmante, o.rol].find((c) => typeof c === "string") as string | undefined;
    const quien = [o.nombre_completo, o.nombre, o.autoridad, o.firmante];
    // Una candidatura (JNE) dice a qué cargo postuló, no que lo ganó: no la vuelve pública.
    if (cargo && CARGO_ELECTO.test(cargo) && clavePadre !== "candidaturas") for (const n of quien) r.electo(n);
    else if (clavePadre === "vinculo_autoridades") r.persona(o.autoridad, "nombres-primero");
  }

  for (const [k, x] of Object.entries(o)) {
    // {"JUAN PEREZ QUISPE": {onpe, jne, visitas}}: la clave es la persona.
    if (clavePadre === "datos_peru_por_persona") r.persona(k, "nombres-primero", "consulta");
    if (/^\d{8}$/.test(k)) r.documento(k);
    recolectar(x, r, k, autoridades || k === "autoridades_entidad", profundidad + 1, tapar);
  }
}

// ─── Pasada 2: tapar ─────────────────────────────────────────────────────────

interface Contexto {
  porPrimera: Map<string, Variante[]>;
  /** Slugs de las personas protegidas ("juan-perez-quispe") para las URLs de agregadores. */
  slugs: string[];
  documentos: Set<string>;
  /** Correos visibles (el perfil de un aliado publica el suyo a propósito). */
  correos: boolean;
}

const slug = (s: string) => normal(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function contexto(r: Recolector, opts: { correos?: boolean } = {}): Contexto {
  const porPrimera = new Map<string, Variante[]>();
  const slugs: string[] = [];
  for (const p of r.personas.values()) {
    if (r.electos.has(p.id) && !r.forzados.has(p.id)) continue;
    for (const claves of p.formas.values()) {
      const lista = porPrimera.get(claves[0]) ?? [];
      // El materno es la última aparición de esa palabra en la forma ("QUISPE QUISPE JUAN" → la segunda).
      lista.push({ claves, oculta: modoDe(p) === "completo" ? -1 : claves.lastIndexOf(p.oculta) });
      porPrimera.set(claves[0], lista);
      slugs.push(slug(claves.join(" ")));
    }
  }
  // La variante más larga primero: "JUAN CARLOS PEREZ QUISPE" antes que "JUAN CARLOS PEREZ".
  for (const lista of porPrimera.values()) lista.sort((a, b) => b.claves.length - a.claves.length);
  return { porPrimera, slugs: slugs.filter((s) => s.length >= 8), documentos: r.documentos, correos: !!opts.correos };
}

/** Tapa los nombres conocidos de `texto`, por palabras completas y sin mirar tildes ni mayúsculas. */
function taparNombres(texto: string, ctx: Contexto): string {
  if (!ctx.porPrimera.size || texto.length < 3) return texto;
  const toks: { i: number; f: number; c: string }[] = [];
  for (const m of texto.matchAll(PALABRA)) toks.push({ i: m.index!, f: m.index! + m[0].length, c: normal(m[0]) });
  let out = "";
  let ultimo = 0;
  let cambio = false;
  for (let t = 0; t < toks.length; t++) {
    const candidatas = ctx.porPrimera.get(toks[t].c);
    if (!candidatas) continue;
    for (const v of candidatas) {
      const n = v.claves.length;
      if (t + n > toks.length) continue;
      let calza = true;
      for (let j = 1; j < n && calza; j++) {
        const a = toks[t + j - 1];
        const b = toks[t + j];
        // Entre palabras: espacios, o un punto o una coma ("R.MENDOZA", "VDA. DE", "PEREZ QUISPE , JUAN").
        calza = b.c === v.claves[j] && /^\s*[.,]?\s*$/.test(texto.slice(a.f, b.i));
      }
      if (!calza) continue;
      const desde = v.oculta < 0 ? toks[t] : toks[t + v.oculta];
      const hasta = v.oculta < 0 ? toks[t + n - 1] : desde;
      out += texto.slice(ultimo, desde.i) + TAPA_NOMBRE;
      ultimo = hasta.f;
      cambio = true;
      t += n - 1;
      break;
    }
  }
  return cambio ? out + texto.slice(ultimo) : texto;
}

/** Agregadores de datos de personas y empresas: con el nombre de alguien protegido, el enlace no sale. */
const AGREGADORES = /(^|\.)(datosperu\.org|postor\.pe|todolicitaciones\.pe|universidadperu\.com|eldni\.com|dniperu\.com|dateas\.com|ruc\.com\.pe|consultaruc\.pe|sunat\.info|peruempresas\.net)$/i;

/** La URL si puede salir; null si lleva un DNI, un RUC 10 o es el perfil de una persona protegida. */
export function urlPublica(url: string, ctx: Contexto = SIN_NOMBRES): string | null {
  if (/(?<!\d)10\d{9}(?!\d)/.test(url)) return null;
  for (const m of url.matchAll(/(?<!\d)\d{8}(?!\d)/g)) if (ctx.documentos.has(m[0])) return null;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  if (/(^|\.)linkedin\.com$/i.test(host) && /\/in\//i.test(url)) return null;
  if (/(^|\.)facebook\.com$/i.test(host) && /profile\.php/i.test(url)) return null;
  if (AGREGADORES.test(host)) {
    const s = slug(decodeURIComponentSeguro(url));
    if (ctx.slugs.some((n) => s.includes(n))) return null;
  }
  return url;
}

function decodeURIComponentSeguro(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Raíz del sitio de una URL que no puede salir entera: el enlace sigue llevando a la fuente. */
function raizDe(url: string): string {
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return "";
  }
}

/**
 * Un DNI dentro de un texto: si es de alguien de la respuesta, su ref (la misma que en sus campos, para
 * poder cruzarlo); si no, tapado.
 */
const dniEnTexto = (d: string, ctx: Contexto) => (ctx.documentos.has(d) ? refDocumento(d) : TAPA_DNI);

/** Dígitos que identifican a una persona dentro de un texto (también dentro de una clave de objeto). */
function taparDigitos(t: string, ctx: Contexto): string {
  if (!/\d/.test(t)) return t;
  return t.replace(DNI_CON_ETIQUETA, (_m, pre: string, d: string) => `${pre}${dniEnTexto(d, ctx)}`)
    .replace(MASCARA_VIEJA, TAPA_DNI)
    // El RUC 10 va con su ref también en la prosa: único (dos RUC que terminan igual no se confunden)
    // y el mismo de los campos, así una clave "20…↔10…" sigue calzando con el `ruc` del postor.
    .replace(RUC10_EN_TEXTO, (r) => refRuc10(r))
    .replace(DNI_SUELTO, (d: string, desde: number, s: string) => (esCodigoLargo(s, desde, d.length) ? d : dniEnTexto(d, ctx)))
    .replace(CELULAR, TAPA_CELULAR);
}

function taparSegmento(s: string, ctx: Contexto): string {
  let t = taparDigitos(taparNombres(s, ctx), ctx);
  if (!ctx.correos && t.includes("@")) t = t.replace(CORREO, (_m, ini: string, dom: string) => `${ini}***@${dom}`);
  return t;
}

/** Texto libre: nombres, DNI, RUC 10, celulares y correos; las URLs de adentro, con la regla de URLs. */
export function taparTexto(s: string, ctx: Contexto = SIN_NOMBRES): string {
  if (!s) return s;
  if (!/https?:\/\//i.test(s)) return taparSegmento(s, ctx);
  let out = "";
  let i = 0;
  for (const m of s.matchAll(URL_EN_TEXTO)) {
    out += taparSegmento(s.slice(i, m.index), ctx) + (urlPublica(m[0], ctx) ?? raizDe(m[0]));
    i = m.index! + m[0].length;
  }
  return out + taparSegmento(s.slice(i), ctx);
}

/** Valor de un campo de documento: ref si es un documento, intacto si es el RUC de una empresa. */
function documentoPublico(v: string): string {
  const d = v.replace(/[\s.-]/g, "");
  if (!/\d/.test(d)) return v; // "", "N/A", "SIN DNI"
  if (/^20\d{9}$/.test(d)) return v;
  if (/^10\d{9}$/.test(d)) return refRuc10(d);
  if (/^\d{2}\*{4}\d{2}$/.test(d) || /^[•*]+$/.test(d)) return TAPA_DNI;
  // Un DNI guardado como número pierde el cero de adelante: la ref se calcula siempre sobre 8 dígitos.
  if (/^\d{7}$/.test(d)) return refDocumento(d.padStart(8, "0"));
  if (/^[0-9A-Za-z]{5,15}$/.test(d)) return refDocumento(d);
  return TAPA_DNI;
}

/** Marca de un elemento de arreglo que no puede salir (una URL protegida dentro de una lista de fuentes). */
const QUITAR = Symbol("quitar");

function valorTexto(s: string, clave: string, ctx: Contexto): string | null | typeof QUITAR {
  const t = s.trim();
  if (esClaveDocumento(clave)) return documentoPublico(t);
  const ruc = RUC10_SOLO.exec(t);
  if (ruc) return (ruc[1] ?? "") + refRuc10(ruc[2]);
  if (/^\d{8}$/.test(t)) return esClaveId(clave) ? s : ctx.documentos.has(t) ? refDocumento(t) : TAPA_DNI;
  if (/^https?:\/\/\S+$/i.test(t)) return urlPublica(t, ctx) ?? QUITAR;
  return taparTexto(s, ctx);
}

/** Una clave de objeto: un DNI o un nombre también pueden ser claves (datos_peru_por_persona). */
function clavePublica(k: string, ctx: Contexto): string {
  if (/^\d{8}$/.test(k)) return refDocumento(k);
  if (/^10\d{9}$/.test(k)) return refRuc10(k);
  if (/^\d{2}\*{4}\d{2}$/.test(k)) return TAPA_DNI;
  // "20131378972↔10439608801" (pares de postores): los RUC 10 de adentro, con su ref.
  const conDigitos = taparDigitos(k, ctx);
  if (!/\s/.test(conDigitos)) return conDigitos; // las claves de siempre (snake_case, camelCase) no son nombres
  return taparTexto(conDigitos, ctx);
}

function transformar(v: unknown, ctx: Contexto, clave = "", profundidad = 0): unknown {
  // Las fechas de pg (timestamptz) llegan como Date: recorrerlas como objeto las dejaba en `{}`.
  if (v == null || profundidad > 60 || v instanceof Date) return v;
  if (typeof v === "string") return valorTexto(v, clave, ctx);
  if (typeof v === "number") {
    return esClaveDocumento(clave) && Number.isInteger(v) && v >= 1e6 && v < 1e9 ? documentoPublico(String(v)) : v;
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const x of v) {
      const y = transformar(x, ctx, clave, profundidad + 1);
      if (y !== QUITAR) out.push(y);
    }
    return out;
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      let k2 = clavePublica(k, ctx);
      while (Object.prototype.hasOwnProperty.call(out, k2)) k2 += " ·"; // dos claves que quedaron iguales al taparlas
      const y = transformar(x, ctx, k, profundidad + 1);
      out[k2] = y === QUITAR ? null : y;
    }
    return out;
  }
  return v;
}

const SIN_NOMBRES: Contexto = { porPrimera: new Map(), slugs: [], documentos: new Set(), correos: false };

// ─── API del módulo ──────────────────────────────────────────────────────────

/**
 * Copia de `valor` lista para el público: reconoce a las personas en todo el JSON y las tapa en todo el
 * JSON. No muta la entrada. `extra`: más JSON del que salen nombres pero que no se devuelve (p. ej. el
 * dossier de la alerta para tapar su traza).
 */
/**
 * Nepotismo: el PRIMER apellido del funcionario que declaró al pariente, sólo si mostrarlo no puede destapar el apellido
 * tapado del pariente (el segundo, el materno). Con hijo(a) de una declarante, sobrino(a) o primo(a) por la rama de una
 * hermana o una tía, o nieto(a) por una hija, el segundo apellido del pariente ES el primero del funcionario: ahí no se
 * da ningún apellido (sólo el cargo). Un parentesco que no está en la lista, tampoco. El nombre completo del funcionario
 * nunca sale en estas respuestas: con "hermano(a)" (comparten los dos apellidos) destapaba el del pariente.
 */
const PARENTESCO_SEGURO = /^(CONYUGE|CONVIVIENTE|PADRE|MADRE|HERMANO\(A\) DEL|TIO|CUNADO|HIJASTRO|ABUELO|SUEGRO|YERNO|NUERA)/;
export function apellidoFuncionario(parentesco: unknown, declarante: unknown): string | null {
  if (typeof parentesco !== "string" || typeof declarante !== "string") return null;
  const p = parentesco.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().trim();
  if (!PARENTESCO_SEGURO.test(p)) return null;
  return declarante.trim().split(/\s+/)[0] || null;
}

export function publicar<T>(valor: T, opts: { correos?: boolean; extra?: unknown } = {}): T {
  const r = new Recolector();
  const v = conEnie(valor);
  recolectar(v, r);
  if (opts.extra !== undefined) recolectar(conEnie(opts.extra), r);
  return transformar(v, contexto(r, opts)) as T;
}

/**
 * La Ñ que el SEACE/CONOSCE escribe "¿" entre letras ("NURE¿A", 55 mil personas en las órdenes): sin reponerla, la
 * palabra se partía en dos y el apellido quedaba sin tapar. Recorre todo el JSON (sin tocar fechas ni números).
 */
const ENIE = /(?<=\p{L})¿(?=\p{L})/gu;
function conEnie<T>(v: T, profundidad = 0): T {
  if (v == null || profundidad > 60 || v instanceof Date) return v;
  if (typeof v === "string") return (v.includes("¿") ? v.replace(ENIE, "Ñ") : v) as T;
  if (Array.isArray(v)) return v.map((x) => conEnie(x, profundidad + 1)) as T;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = conEnie(x, profundidad + 1);
    return out as T;
  }
  return v;
}

/** Sólo texto, sin JSON alrededor (no hay papeles: tapa DNI, RUC 10, celulares, correos y nombres pegados a un DNI). */
export function limpiarTexto(s: string): string {
  const r = new Recolector();
  r.texto(s);
  return taparTexto(s, contexto(r));
}

/** Compatibilidad con las rutas que lo llamaban así. */
export const limpiarPersonales = <T>(valor: T): T => publicar(valor);

// ─── Traza del agente (pestaña "Cómo se hizo") ───────────────────────────────

type Evento = Record<string, unknown> & { kind?: unknown };

/** Lo que el público ve de cada evento con datos: qué agente, qué herramienta, a quién delegó. */
const CAMPOS_PUBLICOS: Record<string, string[]> = {
  tool_call: ["kind", "name", "agent", "ts", "t", "dur_ms"],
  tool_result: ["kind", "name", "agent", "ts", "t", "dur_ms"],
  thought: ["kind", "agent", "ts", "t"],
  transfer: ["kind", "agent", "from", "to", "msg", "ts", "t"],
};

/**
 * Textos de lo que entra y sale de una herramienta que sí pueden verse: reglas, estados, perfiles,
 * normas, la razón social del ganador (tapada si es una persona) y el error si falló. Las búsquedas,
 * los nombres, los DNI, la evidencia y las respuestas en prosa se quedan afuera.
 */
const TEXTO_SEGURO = new Set(["regla", "estado", "perfil", "severidad", "regimen", "estrategia", "ocid", "norma",
  "articulo_ley", "articulo_reglamento", "modalidad", "veredicto", "status", "nivel", "tipo", "etapa", "agente_origen",
  "metodo", "label", "razon_social", "error", "motivo", "fase", "moneda", "unidad", "categoria"]);
/** Listas de textos que pueden verse (prioridad de documentos, avisos del guardado, reglas). */
const LISTA_SEGURA = new Set(["prioridad", "warns", "faltantes", "reglas", "etapas", "agentes"]);

/**
 * Proyección de los argumentos o del resultado de una herramienta: números y booleanos siempre (las
 * cifras de la pestaña "Cómo se hizo": cuantía, ítems, documentos leídos, reglas que dispararon…);
 * textos, sólo los de `TEXTO_SEGURO`, tapados igual. Las listas conservan su largo (los conteos).
 */
function proyectarSeguro(v: unknown, ctx: Contexto, clave = "", profundidad = 0): unknown {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (profundidad > 6) return undefined;
  if (typeof v === "string") {
    if (clave === "id") return /^[a-z]+_\d+$/i.test(v) ? v : undefined; // ids internos ("func_3"), no documentos
    return TEXTO_SEGURO.has(clave) ? taparTexto(v.slice(0, 200), ctx) : undefined;
  }
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return LISTA_SEGURA.has(clave) ? v.map((x) => taparTexto(String(x).slice(0, 200), ctx)) : undefined;
    return v.map((x) => proyectarSeguro(x, ctx, clave === "" ? "" : "_", profundidad + 1)).filter((x) => x !== undefined);
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const y = proyectarSeguro(x, ctx, k, profundidad + 1);
      if (y === undefined) continue;
      // Una clave que no es un identificador es un dato: un DNI, un RUC o un nombre (datos_peru_por_persona,
      // oece_perfil por RUC…). Va tapada; si no se reconoce, entera.
      let k2 = k;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        k2 = clavePublica(k, ctx);
        if (k2 === k) k2 = TAPA_NOMBRE;
      }
      while (Object.prototype.hasOwnProperty.call(out, k2)) k2 += " ·";
      out[k2] = y;
    }
    return out;
  }
  return undefined;
}

function eventoPublico(e: unknown, ctx: Contexto): unknown {
  if (!e || typeof e !== "object" || Array.isArray(e)) return e;
  const ev = e as Evento;
  const campos = CAMPOS_PUBLICOS[String(ev.kind)];
  if (!campos) return transformar(ev, ctx); // metrics, eval, info, warn, error, phase: números y mensajes, tapados
  const out: Record<string, unknown> = {};
  for (const k of campos) if (k in ev) out[k] = transformar(ev[k], ctx, k);
  if (ev.kind === "tool_call") out.args = proyectarSeguro(ev.args, ctx) ?? {};
  if (ev.kind === "tool_result") out.result_preview = proyectarSeguro(ev.result_preview, ctx) ?? {};
  return out;
}

/**
 * Traza pública: los eventos sin entradas ni salidas de las herramientas ni el texto que piensa el agente,
 * y la autoevaluación con los nombres tapados. `dossier`: el análisis de la alerta, del que salen las
 * personas a tapar en los mensajes y en la autoevaluación.
 */
export function publicarTraza<T extends { agent_trace?: unknown; self_evals?: unknown }>(traza: T, dossier?: unknown): T {
  const r = new Recolector();
  if (dossier !== undefined) recolectar(dossier, r);
  recolectar(traza.self_evals, r);
  const ctx = contexto(r);
  const eventos = Array.isArray(traza.agent_trace) ? traza.agent_trace.map((e) => eventoPublico(e, ctx)) : traza.agent_trace;
  const resto = transformar({ ...traza, agent_trace: undefined }, ctx) as Record<string, unknown>;
  return { ...resto, agent_trace: eventos } as unknown as T;
}
