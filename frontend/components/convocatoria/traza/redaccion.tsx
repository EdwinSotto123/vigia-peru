"use client";

/**
 * Redacción de datos personales dentro de la traza (DESIGN_SYSTEM.md §10.6).
 *
 * El informe registra sus personas privadas con `setRedactNames` (ResultadoView) y `redactDnis`
 * tapa esas personas y todo DNI o RUC de persona natural que aparezca en un texto. La traza trae
 * además gente que el resto del informe no nombra: socios de los postores rivales en el RNP,
 * personas cruzadas en lote, firmantes con carné de extranjería (9 dígitos, que el patrón de DNI
 * no ve). Esas se juntan acá, recorriendo la traza, y se tapan igual: el apellido en vidrio
 * revelable y el documento entero. Los correos también van en vidrio: suelen llevar un nombre.
 *
 * Las autoridades electas no se juntan (son públicas, como en `nombresPrivadosDe`); las
 * empresas tampoco (`pareceEmpresa`).
 */

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { Glass, maskDnis, pareceEmpresa, redactDnis, type OrdenNombre } from "@/components/Redact";

interface Sensibles {
  re: RegExp | null;
  /**
   * Clave normalizada del nombre → posiciones de las palabras que se tapan. Si la traza trae a la
   * misma persona en dos contextos con órdenes distintos (un "nombre" suelto que puede venir con
   * los apellidos primero o al final), se tapan las dos posiciones: ante la duda, se tapa de más.
   */
  tapar: Map<string, Set<number>>;
  ids: Set<string>;
}

const VACIO: Sensibles = { re: null, tapar: new Map(), ids: new Set() };
const Contexto = createContext<Sensibles>(VACIO);

const clave = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patron = (nombre: string) =>
  escapar(clave(nombre))
    .replace(/a/g, "[aáàäâ]")
    .replace(/e/g, "[eéèëê]")
    .replace(/i/g, "[iíìïî]")
    .replace(/o/g, "[oóòöô]")
    .replace(/u/g, "[uúùüû]")
    .replace(/n/g, "[nñ]")
    .replace(/ /g, "\\s+");

/** Claves que traen el nombre con los nombres de pila primero (actas, búsquedas). */
const CLAVE_NOMBRES_PRIMERO = /^(nombre_completo|firmante|query|input_usado|persona|miembro)$/i;
/** Claves que lo traen en orden de registro (RNP, visitas): apellidos primero. */
const CLAVE_APELLIDOS_PRIMERO = /^(nombre_visto|nombre_normalizado_rnp|visitante)$/i;
const CLAVE_DOCUMENTO = /^(dni|dni_\w+|\w+_dni|numero_documento|nro_documento|documento_identidad)$/i;
/** Listas cuyas filas son registros en orden de apellidos (RNP, aportes ONPE, visitas). */
const LISTA_REGISTRO = /^(socios|representantes_legales|organos_administracion|socios_postores_rivales|aportes|visitas|gerente_general|gerente|representante_legal)$/i;
/** Ramas con personas públicas (autoridades electas, candidatos, PEP, el funcionario visitado): no se tapan. */
const RAMA_PUBLICA = /autoridad|alcalde|candidat|electo|regidor|^pep$|^funcionario$/i;
const CARGO_ELECTO = /alcalde|regidor|congresista|gobernador|consejero regional/i;

/** Palabras que sólo lleva una institución o un cargo, no una persona. */
const INSTITUCION = /\b(gobierno|municipalidad|ministerio|regional|universidad|hospital|instituto|direcci[oó]n|programa|proyecto|entidad|oficina|gerencia|subgerencia|partido|per[uú]|nacional|provincial|distrital|alcald[ií]a|gerente|jefe|subgerente)\b/i;

const pareceNombre = (s: string) => {
  const p = s.trim().split(/\s+/);
  return p.length >= 2 && p.length <= 7 && /^[\p{L}\s.'-]+$/u.test(s) && !pareceEmpresa(s) && !INSTITUCION.test(s);
};

/**
 * Recorre la traza y junta las personas privadas y sus documentos. Cada nombre se registra en
 * los dos órdenes (nombres primero y apellidos primero), cada uno tapando el mismo apellido.
 */
export function sensiblesDeTraza(trace: unknown[]): Sensibles {
  const nombres = new Map<string, { texto: string; tapar: Set<number> }>();
  const ids = new Set<string>();
  const poner = (texto: string, orden: OrdenNombre) => {
    const k = clave(texto);
    const n = texto.trim().split(/\s+/).length;
    // La palabra que tapa `PersonName` según el orden (el apellido materno).
    const i = orden === "sunat" ? (n >= 3 ? 1 : 0) : n - 1;
    const previo = nombres.get(k);
    if (previo) previo.tapar.add(i);
    else nombres.set(k, { texto, tapar: new Set([i]) });
  };
  const agregar = (texto: string, orden: OrdenNombre) => {
    const p = texto.trim().split(/\s+/);
    poner(texto, orden);
    if (p.length < 3) return;
    // "ANA MARÍA PÉREZ ROJAS" ↔ "PÉREZ ROJAS ANA MARÍA": en los dos se tapa ROJAS.
    if (orden === "sunat") poner([...p.slice(2), p[0], p[1]].join(" "), "nombres-primero");
    else poner([p[p.length - 2], p[p.length - 1], ...p.slice(0, -2)].join(" "), "sunat");
    // Los dos apellidos solos, como los escribe una búsqueda ("PEREZ BALBUENA"): se tapa el segundo.
    const apellidos = orden === "sunat" ? [p[0], p[1]] : [p[p.length - 2], p[p.length - 1]];
    poner(apellidos.join(" "), "nombres-primero");
  };
  const visitar = (v: unknown, llave: string | null, publica: boolean, depth: number) => {
    if (depth > 14 || v == null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) visitar(x, llave, publica, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    // Un objeto con RUC de empresa es una empresa: su "nombre" no es una persona.
    const esEmpresa = typeof o.ruc === "string" && /^20\d{9}$/.test(o.ruc) && !("socios" in o);
    const pub = publica || (typeof o.cargo === "string" && CARGO_ELECTO.test(o.cargo));
    const rol = String(o.rol ?? o.rol_en_postor ?? "");
    const deRegistro = "tipo_documento" in o || /socio|representante|organo/i.test(rol) || (!!llave && LISTA_REGISTRO.test(llave));
    for (const [k, x] of Object.entries(o)) {
      if (k === "queries" && Array.isArray(x)) {
        // Las búsquedas las escribe el modelo con el nombre entre comillas ("CARLOS DANIEL PEREZ
        // BALBUENA"), a veces antes de que llegue a la traza el dato del registro que lo nombra
        // (en vivo, siempre). Un texto entre comillas, en mayúsculas, que parece una persona, se
        // tapa sin saber su orden: las dos posiciones posibles del apellido.
        for (const q of x) {
          for (const m of String(q).matchAll(/"([^"]{3,80})"/g)) {
            const s = m[1].trim();
            const n = s.split(/\s+/).length;
            if (n < 2 || n > 6 || s !== s.toUpperCase() || !pareceNombre(s)) continue;
            poner(s, "sunat");
            agregar(s, "nombres-primero");
          }
        }
        continue;
      }
      if (typeof x === "string" && /^\s*(```|\{|\[)/.test(x) && x.length > 20) {
        // El orquestador viejo guardaba la respuesta de cada agente como texto con JSON adentro.
        const cuerpo = x.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        try {
          visitar(JSON.parse(cuerpo), k, pub || RAMA_PUBLICA.test(k), depth + 1);
        } catch {
          // Recortado o mal formado: se buscan los pares "nombre": "…" y "dni": "…" a mano. Sin
          // contexto no se sabe el orden del nombre, así que se tapan las dos posiciones posibles.
          if (!pub && !RAMA_PUBLICA.test(k)) {
            for (const m of cuerpo.matchAll(/"(?:nombre|nombre_completo|firmante)"\s*:\s*"([^"]{3,80})"/g)) {
              if (!pareceNombre(m[1])) continue;
              poner(m[1], "sunat");
              agregar(m[1], "nombres-primero");
            }
          }
          for (const m of cuerpo.matchAll(/"(?:dni|numero_documento|dni_\w+)"\s*:\s*"(\d{6,})"/g)) ids.add(m[1]);
        }
      }
      if (typeof x === "string" || typeof x === "number") {
        const s = String(x).trim();
        if (CLAVE_DOCUMENTO.test(k) && /\d{6,}/.test(s)) ids.add(s);
        if (typeof x !== "string" || pub || esEmpresa || RAMA_PUBLICA.test(k) || !pareceNombre(s)) continue;
        if (CLAVE_NOMBRES_PRIMERO.test(k)) agregar(s, "nombres-primero");
        else if (CLAVE_APELLIDOS_PRIMERO.test(k)) agregar(s, "sunat");
        else if (k === "nombre" || k === "nombres") agregar(s, deRegistro ? "sunat" : "nombres-primero");
        continue;
      }
      visitar(x, k, pub || RAMA_PUBLICA.test(k), depth + 1);
    }
  };
  for (const ev of trace) visitar(ev, null, false, 0);

  const lista = [...nombres.values()].sort((a, b) => b.texto.length - a.texto.length);
  const tapar = new Map<string, Set<number>>(lista.map((n) => [clave(n.texto), n.tapar]));
  const partes = [
    String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`,
    ...[...ids].sort((a, b) => b.length - a.length).map((id) => String.raw`\b${escapar(id)}\b`),
    ...lista.map((n) => String.raw`${patron(n.texto)}(?!\p{L})`),
  ];
  return { re: new RegExp(`(${partes.join("|")})`, "giu"), tapar, ids };
}

export function ProveedorSensibles({ valor, children }: { valor: Sensibles; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

const esLetra = (c: string | undefined) => !!c && /\p{L}/u.test(c);

/** Tapa, sin vidrio, las palabras del nombre que corresponden (como `PersonName`, pero en texto). */
function taparNombre(nombre: string, posiciones: Set<number>): string {
  return nombre
    .split(/\s+/)
    .map((w, i) => (posiciones.has(i) ? "•".repeat(Math.min(Math.max(w.length, 3), 8)) : w))
    .join(" ");
}

/** El nombre con sus apellidos en vidrio revelable (el mismo vidrio de `PersonName`). */
function NombreTapado({ nombre, posiciones }: { nombre: string; posiciones: Set<number> }) {
  const p = nombre.split(/\s+/);
  return (
    <>
      {p.map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          {posiciones.has(i) ? <Glass label="Apellido, clic para revelar">{w}</Glass> : w}
        </span>
      ))}
    </>
  );
}

const POR_DEFECTO = (n: string) => new Set([n.split(/\s+/).length - 1]);

/** El texto con todo lo sensible tapado con puntos, sin vidrio (no se puede revelar). */
function taparTexto({ re, tapar, ids }: Sensibles, texto: string): string {
  const t = maskDnis(texto.normalize("NFC"));
  if (!re) return t;
  re.lastIndex = 0;
  return t.replace(re, (tok: string, _g: string, idx: number) => {
    if (/^\p{L}/u.test(tok) && !tok.includes("@") && esLetra(t[idx - 1])) return tok;
    if (tok.includes("@")) return "•••@•••";
    if (ids.has(tok)) return "•".repeat(tok.length);
    return taparNombre(tok, tapar.get(clave(tok)) ?? POR_DEFECTO(tok));
  });
}

/**
 * La misma redacción, como función: para lo que sale de la pantalla (copiar al portapapeles) o
 * va en un atributo. Lo copiado lleva todo tapado: copiar no es revelar.
 */
export function useTaparTexto(): (texto: string) => string {
  const sensibles = useContext(Contexto);
  return useCallback((texto: string) => taparTexto(sensibles, texto), [sensibles]);
}

/**
 * Un texto de la traza, con las personas privadas y sus documentos en vidrio.
 * `plano`: sin vidrio revelable, tapado con puntos. Para textos que van DENTRO de un botón (la
 * tarjeta del grafo), donde un vidrio clicable sería un control dentro de otro.
 */
export function TextoSeguro({ texto, plano = false }: { texto: string; plano?: boolean }) {
  const sensibles = useContext(Contexto);
  const { re, tapar, ids } = sensibles;
  if (!texto) return null;
  if (plano) return <>{taparTexto(sensibles, texto)}</>;
  if (!re) return <>{redactDnis(texto)}</>;
  const t = texto.normalize("NFC");
  const out: ReactNode[] = [];
  let ultimo = 0;
  let i = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const tok = m[0];
    if (m.index === re.lastIndex) re.lastIndex++; // anti-bucle
    // Un nombre pegado a una letra por delante es parte de otra palabra.
    if (/^\p{L}/u.test(tok) && !tok.includes("@") && esLetra(t[m.index - 1])) continue;
    if (m.index > ultimo) out.push(<span key={`t${i++}`}>{redactDnis(t.slice(ultimo, m.index))}</span>);
    if (tok.includes("@")) out.push(<Glass key={`g${i++}`} label="Correo, clic para revelar">{tok}</Glass>);
    else if (ids.has(tok)) out.push(<Glass key={`g${i++}`} label="Documento de identidad, clic para revelar">{tok}</Glass>);
    else
      out.push(
        <span key={`n${i++}`}>
          <NombreTapado nombre={tok} posiciones={tapar.get(clave(tok)) ?? POR_DEFECTO(tok)} />
        </span>,
      );
    ultimo = m.index + tok.length;
  }
  if (!out.length) return <>{redactDnis(texto)}</>;
  if (ultimo < t.length) out.push(<span key={`t${i++}`}>{redactDnis(t.slice(ultimo))}</span>);
  return <>{out}</>;
}

const TOPE_CRUDO = 30_000;

/** El dato crudo de una llamada (argumentos o respuesta), redactado y con tope de largo. */
export function JsonSeguro({ valor }: { valor: unknown }) {
  let s: string;
  try {
    s = typeof valor === "string" ? valor : JSON.stringify(valor, null, 2);
  } catch {
    s = String(valor);
  }
  const recortado = s.length > TOPE_CRUDO;
  return (
    <>
      <pre className="scrollbar-warm max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-paperSoft p-3 font-mono text-[11px] leading-relaxed text-ink">
        <TextoSeguro texto={recortado ? s.slice(0, TOPE_CRUDO) : s} />
      </pre>
      {recortado && (
        <span className="mt-1 block text-[11px] text-mute">
          Se muestran los primeros {TOPE_CRUDO.toLocaleString("es-PE")} caracteres de {s.length.toLocaleString("es-PE")}.
        </span>
      )}
    </>
  );
}
