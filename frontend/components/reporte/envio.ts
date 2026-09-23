// Subida de archivos y mensajes de error del formulario de denuncia, compartidos
// por FormObra y FormEntidad.
//
// Regla: el ciudadano nunca ve un JSON, un código de estado ni un "invalid_body".
// Cada código que devuelven /api/upload y POST /reportes se traduce aquí a una
// frase que dice qué pasó y qué hacer.

import { ApiError } from "@/lib/api-client";

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

/** Sube un archivo a /api/upload con progreso real (XHR). Rechaza con un código de `MENSAJE_SUBIDA`. */
export function subirArchivo(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; tipo: MediaSubido["tipo"]; filename?: string; size_bytes?: number; content_type?: string }> {
  return new Promise((resolve, reject) => {
    const invalido = validarArchivo(file);
    if (invalido) {
      reject(new ErrorSubida(invalido));
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
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
  descripcion: `La descripción debe tener entre ${DESCRIPCION_MIN} y ${DESCRIPCION_MAX.toLocaleString("es-PE")} caracteres.`,
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
  if (err instanceof ApiError) {
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
