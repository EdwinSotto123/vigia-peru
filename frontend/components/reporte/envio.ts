// Subida de archivos y mensajes de error del formulario de denuncia, compartidos
// por FormObra y FormEntidad.
//
// Regla: el ciudadano nunca ve un JSON, un código de estado ni un "invalid_body".
// Cada código que devuelven /api/upload y POST /reportes se traduce aquí a una
// frase que dice qué pasó y qué hacer.
//
// Contra bots: cada subida y el envío final llevan su propio token de Turnstile
// (`cf-turnstile-response`); los 403/429 de esa protección también se traducen aquí.

import { ApiError } from "@/lib/api-client";
import { numero } from "@/lib/formato";
import { ErrorTurnstile } from "@/components/seguridad/turnstile-api";
import { CABECERA_TURNSTILE, mensajeBots } from "@/components/seguridad/mensajes";

/** El mismo límite que aplica /api/upload. */
export const MAX_MB = 12;
export const MAX_BYTES = MAX_MB * 1024 * 1024;

/** Lo que acepta /api/upload. Sin HEIC a propósito: así el iPhone convierte la foto a JPG al elegirla. */
export const ACEPTA_FOTO = "image/jpeg,image/png,image/webp";
export const ACEPTA_ARCHIVO = `${ACEPTA_FOTO},application/pdf`;

const TIPOS_OK = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/** Descripción: mismo mínimo y máximo que valida el backend (zod: min 10, max 4000). */
export const DESCRIPCION_MIN = 10;
export const DESCRIPCION_MAX = 4000;

export type MediaSubido = {
  url: string;
  tipo: "foto" | "video" | "documento" | "audio";
  filename: string;
  size_bytes: number;
  content_type?: string;
};

const MENSAJE_SUBIDA: Record<string, string> = {
  archivo_faltante: "No llegó ningún archivo. Vuelve a elegirlo.",
  archivo_muy_grande: `pesa más de ${MAX_MB} MB. Prueba con una foto de menor resolución o un PDF más liviano.`,
  tipo_no_permitido: "no es una foto JPG, PNG o WebP ni un PDF.",
  heic_no_soportado: "está en formato HEIC. Conviértela a JPG, o elígela desde el teléfono, que la convierte sola.",
  archivo_danado: "no se pudo leer: puede estar dañado. Prueba con otra copia.",
  no_autorizado: "no se pudo subir: hace falta iniciar sesión.",
  captcha_requerido: "no se pudo subir: falta la verificación contra robots. Recarga la página y vuelve a intentarlo.",
  captcha_invalido: "no se pudo subir: la verificación contra robots venció. Vuelve a elegirlo.",
  demasiados_pedidos: "no se pudo subir: subiste muchos archivos seguidos. Espera un minuto y vuelve a elegirlo.",
  error_al_guardar: "no se pudo guardar por un problema de nuestro lado. Inténtalo otra vez en un momento.",
  sin_conexion: "no se pudo subir: no hay conexión. Revisa tu internet e inténtalo otra vez.",
};

/** Mensaje completo para un archivo que no se pudo subir: "La foto casa.jpg pesa más de 12 MB…". */
export function mensajeSubida(nombre: string, codigo: string): string {
  const cola = MENSAJE_SUBIDA[codigo] ?? "no se pudo subir. Inténtalo otra vez.";
  return `El archivo «${nombre}» ${cola}`;
}

/** Valida en el navegador lo que el servidor rechazaría igual, para no gastar la subida. */
export function validarArchivo(f: File): string | null {
  if (f.size > MAX_BYTES) return "archivo_muy_grande";
  const tipo = (f.type || "").toLowerCase();
  if (/hei[cf]/.test(tipo) || /\.hei[cf]$/i.test(f.name)) return "heic_no_soportado";
  // Algunos navegadores dejan `type` vacío: ahí decide el servidor, que mira los bytes.
  if (tipo && !TIPOS_OK.has(tipo)) return "tipo_no_permitido";
  return null;
}

class ErrorSubida extends Error {
  constructor(public codigo: string) {
    super(codigo);
  }
}

export const codigoDeError = (e: unknown) => (e instanceof ErrorSubida ? e.codigo : "error_al_guardar");

/** El mensaje de una subida fallida: el de la verificación contra robots tal cual, o el del archivo. */
export const mensajeErrorSubida = (nombre: string, e: unknown) =>
  e instanceof ErrorTurnstile ? e.message : mensajeSubida(nombre, codigoDeError(e));

/**
 * Si después de este error no tiene sentido seguir subiendo los demás archivos elegidos:
 * la verificación no se pudo hacer o el servidor pidió esperar.
 */
export const detieneLasSubidas = (e: unknown) =>
  e instanceof ErrorTurnstile || (e instanceof ErrorSubida && (e.codigo === "demasiados_pedidos" || e.codigo === "captcha_requerido"));

/**
 * Sube un archivo a /api/upload con progreso real (XHR). Rechaza con un código de `MENSAJE_SUBIDA`,
 * o con `ErrorTurnstile` si no se pudo hacer la verificación contra robots.
 * `modo: "entidad"`: evidencia de una denuncia a una entidad, que va al bucket privado (nunca
 * se publica); la URL que vuelve es sólo una referencia para la API.
 * `verificar`: da el token de Turnstile de ESTA subida (`obtenerToken` de `useTurnstile`). Se
 * pide recién después de validar el archivo, para no gastar una verificación en un archivo que
 * se rechazaría igual.
 */
export async function subirArchivo(
  file: File,
  onProgress?: (pct: number) => void,
  opciones: { modo?: "obra" | "entidad"; verificar?: () => Promise<string | null> } = {},
): Promise<{ url: string; tipo: MediaSubido["tipo"]; filename?: string; size_bytes?: number; content_type?: string }> {
  const invalido = validarArchivo(file);
  if (invalido) throw new ErrorSubida(invalido);
  const verificado = opciones.verificar ? await opciones.verificar() : null;
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    if (opciones.modo) fd.append("modo", opciones.modo);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    if (verificado) xhr.setRequestHeader(CABECERA_TURNSTILE, verificado);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: { ok?: boolean; error?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // Cloud Run corta las peticiones grandes con una página HTML, no con JSON.
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.ok) resolve(data as never);
      else if (xhr.status === 413) reject(new ErrorSubida("archivo_muy_grande"));
      else reject(new ErrorSubida(data?.error && MENSAJE_SUBIDA[data.error] ? data.error : "error_al_guardar"));
    };
    xhr.onerror = () => reject(new ErrorSubida("sin_conexion"));
    xhr.send(fd);
  });
}

/** Qué campo rechazó el backend → qué decirle a quien denuncia. */
const MENSAJE_CAMPO: Record<string, string> = {
  descripcion: `La descripción debe tener entre ${DESCRIPCION_MIN} y ${numero(DESCRIPCION_MAX)} caracteres.`,
  categoria: "Elige una categoría.",
  contactoEmail: "El correo no parece válido. Revísalo o déjalo vacío.",
  enlacesExternos: "Alguno de los enlaces no es una dirección web completa (debe empezar con https://). Hasta 10 enlaces.",
  rucEntidad: "El RUC de la entidad debe tener 11 dígitos.",
  lat: "La ubicación marcada no es válida. Vuelve a marcarla o escribe la dirección.",
  lon: "La ubicación marcada no es válida. Vuelve a marcarla o escribe la dirección.",
  media: "Hay demasiados archivos adjuntos (hasta 20).",
  montoEstimado: "El monto estimado debe ser un número.",
  periodoDesde: "La fecha «desde» no es válida.",
  periodoHasta: "La fecha «hasta» no es válida.",
  personasInvolucradas: "El texto de personas involucradas es demasiado largo (hasta 1.000 caracteres).",
  direccionTexto: "La dirección es demasiado larga (hasta 500 caracteres).",
  contactoNombre: "El nombre es demasiado largo (hasta 120 caracteres).",
};

/** Traduce un error de `createReporte` a una frase. Nunca devuelve el JSON crudo. */
export function mensajeEnvio(err: unknown): string {
  if (err instanceof ErrorTurnstile) return `${err.message} Lo que escribiste sigue aquí.`;
  if (err instanceof ApiError) {
    if (err.status === 403 || err.status === 429) {
      // Protección contra bots. El detalle es el JSON recortado: se leen sus dos campos a mano.
      const error = /"error":"(\w+)"/.exec(err.detail)?.[1];
      const reintentarEn = Number(/"reintentarEn":(\d+)/.exec(err.detail)?.[1]);
      const bots = mensajeBots({ error, reintentarEn: Number.isFinite(reintentarEn) ? reintentarEn : undefined });
      if (bots) return `${bots} Lo que escribiste sigue aquí.`;
    }
    if (err.status === 400) {
      // El detalle es el JSON de zod, recortado a 200 caracteres: puede no parsear,
      // así que se buscan los nombres de campo con una expresión regular.
      const campos = Array.from(err.detail.matchAll(/"path":\["(\w+)"/g), (m) => m[1]);
      const mensajes = Array.from(new Set(campos.map((c) => MENSAJE_CAMPO[c]).filter(Boolean)));
      return mensajes.length ? mensajes.join(" ") : "Revisa los datos del formulario e inténtalo otra vez.";
    }
    if (err.status >= 500) {
      return "No pudimos guardar tu denuncia por un problema de nuestro lado. Inténtalo otra vez en unos minutos: lo que escribiste sigue aquí.";
    }
    return "No pudimos enviar tu denuncia. Inténtalo otra vez en un momento: lo que escribiste sigue aquí.";
  }
  return "No hay conexión con Vigía. Revisa tu internet e inténtalo otra vez: lo que escribiste sigue aquí.";
}

/** Enlaces válidos según el backend (zod `url()`): se validan antes de enviar. */
export function enlacesInvalidos(texto: string): string[] {
  return texto
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => {
      try {
        const u = new URL(s);
        return !/^https?:$/.test(u.protocol);
      } catch {
        return true;
      }
    });
}

export const correoValido = (s: string) => !s.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
