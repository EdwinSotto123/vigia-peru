/**
 * POST /api/upload
 *
 * Recibe multipart con un campo "file" (foto o documento de un reporte
 * ciudadano, comprobante de un aporte, QR de pago o logo de un aliado), lo sube
 * a GCS y devuelve la URL.
 *
 * Tres reglas que antes no existían:
 *
 *  1. SÓLO fotos JPG/PNG/WebP y PDF, reconocidos por sus primeros bytes y no por
 *     el `type` que declara el navegador (que es texto libre).
 *  2. UN límite: 12 MB por archivo, el mismo que dicen los formularios. Antes el
 *     código aceptaba 50 MB, el formulario de entidad prometía 12 y Cloud Run
 *     corta cualquier petición por encima de 32 MiB con un error sin JSON.
 *  3. A las FOTOS se les quitan los metadatos antes de guardarlas. Una foto de
 *     celular trae en su EXIF las coordenadas GPS de donde se tomó, la hora
 *     exacta y el modelo y número de serie del teléfono; el bucket de reportes
 *     es público. Para quien denuncia una obra de su propio municipio, eso puede
 *     ser la diferencia entre anónimo e identificable. `sharp` no está instalado
 *     en este proyecto (ni como dependencia de Next), así que la limpieza se hace
 *     a nivel de bytes: se reescribe el archivo sin los bloques de metadatos, sin
 *     recomprimir la imagen. De la EXIF sólo se conserva la orientación, para
 *     que la foto no aparezca girada. Los PDF se guardan tal cual: sus metadatos
 *     (autor, programa) no se limpian aquí.
 *
 * Los errores vuelven con un `error` en castellano estable (los formularios lo
 * traducen a un mensaje) y un `mensaje` ya legible.
 *
 * Dónde se guarda (fase 0 de la auditoría técnica, C3):
 *  - Bucket PRIVADO (`GCS_BUCKET_PRIVADO`, por defecto `vigia-peru-privado`; acceso uniforme y
 *    prevención de acceso público forzada): los comprobantes de aportes (`kind=comprobante`,
 *    datos de pago) y la evidencia de las denuncias a entidades (`modo=entidad`, que nunca se
 *    publican). La URL que se devuelve es sólo una REFERENCIA interna: la API y el panel la leen
 *    con su cuenta de servicio; en un navegador no abre, y así tiene que ser.
 *  - Bucket público (`REPORTES_BUCKET`, se lee por URL, sin listado): fotos de denuncias de
 *    obras, QR de pago y logos de aliados, que se muestran en el sitio.
 */
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ADMIN, cookieAdmin, leerSesion } from "@/lib/admin-sesion";
import { guardarObjeto } from "@/lib/gcs";
import { puede } from "@/lib/permisos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = process.env.REPORTES_BUCKET || "vigia-peru-reportes";
/** Lo que tiene datos personales y nunca se publica. Ver la cabecera. */
const BUCKET_PRIVADO = process.env.GCS_BUCKET_PRIVADO || "vigia-peru-privado";

/** 12 MB: holgado para una foto de celular o un PDF escaneado, lejos del tope de 32 MiB de Cloud Run. */
const MAX_BYTES = 12 * 1024 * 1024;

type Formato = { mime: string; ext: string; tipo: "foto" | "documento" };

const JPEG: Formato = { mime: "image/jpeg", ext: "jpg", tipo: "foto" };
const PNG: Formato = { mime: "image/png", ext: "png", tipo: "foto" };
const WEBP: Formato = { mime: "image/webp", ext: "webp", tipo: "foto" };
const PDF: Formato = { mime: "application/pdf", ext: "pdf", tipo: "documento" };

type CodigoError =
  | "archivo_faltante"
  | "archivo_muy_grande"
  | "tipo_no_permitido"
  | "heic_no_soportado"
  | "archivo_danado"
  | "no_autorizado"
  | "error_al_guardar";

const MENSAJE: Record<CodigoError, string> = {
  archivo_faltante: "No llegó ningún archivo.",
  archivo_muy_grande: "El archivo pesa más de 12 MB.",
  tipo_no_permitido: "Sólo se aceptan fotos JPG, PNG o WebP y documentos PDF.",
  heic_no_soportado: "La foto está en formato HEIC. Conviértela a JPG y vuelve a subirla.",
  archivo_danado: "No pudimos leer el archivo. Puede estar dañado.",
  no_autorizado: "Necesitas iniciar sesión para subir este archivo.",
  error_al_guardar: "No pudimos guardar el archivo. Inténtalo otra vez en un momento.",
};

const ESTADO: Record<CodigoError, number> = {
  archivo_faltante: 400,
  archivo_muy_grande: 413,
  tipo_no_permitido: 415,
  heic_no_soportado: 415,
  archivo_danado: 422,
  no_autorizado: 401,
  error_al_guardar: 500,
};

const fallar = (error: CodigoError) =>
  NextResponse.json({ ok: false, error, mensaje: MENSAJE[error] }, { status: ESTADO[error] });

/** Qué es el archivo según sus primeros bytes. `null` = algo que no aceptamos. */
function reconocer(b: Buffer): Formato | "heic" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return JPEG;
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return PNG;
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return WEBP;
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return PDF;
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(b.toString("latin1", 8, 12))) {
    return "heic";
  }
  return null;
}

// ─── JPEG ────────────────────────────────────────────────────────────────

/** Lee la orientación (tag 0x0112) de un bloque APP1 Exif. 1 = normal. */
function orientacionExif(app1: Buffer): number {
  // app1 = contenido del segmento, sin marcador ni largo: "Exif\0\0" + TIFF
  if (app1.length < 14 || app1.toString("latin1", 0, 6) !== "Exif\u0000\u0000") return 1;
  const t = app1.subarray(6);
  const le = t.toString("latin1", 0, 2) === "II";
  if (!le && t.toString("latin1", 0, 2) !== "MM") return 1;
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** Un APP1 Exif mínimo con UNA sola etiqueta: la orientación. Nada de GPS, fecha ni teléfono. */
function app1SoloOrientacion(o: number): Buffer {
  const cuerpo = Buffer.alloc(32);
  cuerpo.write("Exif\u0000\u0000", 0, "latin1");
  cuerpo.write("MM", 6, "latin1"); // big-endian
  cuerpo.writeUInt16BE(42, 8);
  cuerpo.writeUInt32BE(8, 10); // IFD0 justo después de la cabecera TIFF
  cuerpo.writeUInt16BE(1, 14); // una entrada
  cuerpo.writeUInt16BE(0x0112, 16); // Orientation
  cuerpo.writeUInt16BE(3, 18); // SHORT
  cuerpo.writeUInt32BE(1, 20); // count
  cuerpo.writeUInt16BE(o, 24); // valor (+2 bytes de relleno en 26)
  cuerpo.writeUInt32BE(0, 28); // no hay IFD siguiente
  const cab = Buffer.alloc(4);
  cab.writeUInt16BE(0xffe1, 0);
  cab.writeUInt16BE(cuerpo.length + 2, 2);
  return Buffer.concat([cab, cuerpo]);
}

/**
 * Qué segmentos se quedan. Todo lo que no es imagen se va: APP1 (Exif con GPS,
 * XMP), APP13 (IPTC/Photoshop), APP12, COM (comentarios), APP2 salvo el perfil
 * de color (el resto de APP2 es MPF, el índice de las imágenes secundarias que
 * los celulares pegan al final, con su propia EXIF). Se conservan APP0 (JFIF) y
 * APP14 (Adobe: sin él un JPEG CMYK sale con los colores invertidos).
 */
function conservarSegmento(marcador: number, cuerpo: Buffer): boolean {
  if (marcador === 0xfe) return false; // COM
  if (marcador >= 0xe0 && marcador <= 0xef) {
    if (marcador === 0xe0) return true; // JFIF / JFXX
    if (marcador === 0xee) return true; // Adobe
    if (marcador === 0xe2) return cuerpo.toString("latin1", 0, 12) === "ICC_PROFILE\u0000";
    return false;
  }
  return true; // DQT, DHT, SOFn, DRI, SOS…: la imagen en sí
}

function limpiarJpeg(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)]; // SOI
  let orientacion = 1;
  let vistoExif = false;
  let insertarTras = 1; // índice en `out` tras el que va el APP1 nuevo
  let i = 2;
  let dentroDeScan = false;

  while (i < b.length) {
    if (dentroDeScan) {
      // Datos comprimidos: termina en el primer marcador que no sea relleno (FF00) ni RST.
      const inicio = i;
      while (i < b.length) {
        if (b[i] === 0xff && i + 1 < b.length) {
          const s = b[i + 1];
          if (s === 0x00 || (s >= 0xd0 && s <= 0xd7) || s === 0xff) {
            i += s === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        i++;
      }
      out.push(b.subarray(inicio, i));
      dentroDeScan = false;
      continue;
    }

    if (b[i] !== 0xff) throw new Error("jpeg: se esperaba un marcador");
    while (i < b.length && b[i] === 0xff) i++; // bytes de relleno entre marcadores
    if (i >= b.length) break;
    const marcador = b[i];
    i++;

    if (marcador === 0xd9) {
      // EOI: fin de la imagen. Lo que venga después (imágenes secundarias MPF,
      // bloques propietarios del fabricante) se descarta entero.
      out.push(Buffer.from([0xff, 0xd9]));
      break;
    }
    if ((marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0x01) {
      out.push(Buffer.from([0xff, marcador]));
      continue;
    }
    if (i + 2 > b.length) throw new Error("jpeg: segmento truncado");
    const largo = b.readUInt16BE(i);
    if (largo < 2 || i + largo > b.length) throw new Error("jpeg: largo inválido");
    const cuerpo = b.subarray(i + 2, i + largo);
    const segmento = b.subarray(i - 2, i + largo);
    i += largo;

    // Sólo el primer APP1 Exif manda (los demás APP1 son XMP y no traen orientación).
    if (marcador === 0xe1 && !vistoExif && cuerpo.toString("latin1", 0, 6) === "Exif\u0000\u0000") {
      orientacion = orientacionExif(cuerpo);
      vistoExif = true;
    }
    if (conservarSegmento(marcador, cuerpo)) {
      out.push(segmento);
      if (marcador === 0xe0 && out.length === 2) insertarTras = 2; // el Exif nuevo va después de JFIF
    }
    if (marcador === 0xda) dentroDeScan = true; // SOS: empiezan los datos comprimidos
  }

  if (orientacion !== 1) out.splice(insertarTras, 0, app1SoloOrientacion(orientacion));
  return Buffer.concat(out);
}

// ─── PNG ─────────────────────────────────────────────────────────────────

/** Fragmentos de texto y metadatos de un PNG: EXIF, comentarios, fecha de modificación. */
const PNG_FUERA = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function limpiarPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const largo = b.readUInt32BE(i);
    const tipo = b.toString("latin1", i + 4, i + 8);
    const fin = i + 12 + largo;
    if (fin > b.length) throw new Error("png: fragmento truncado");
    if (!PNG_FUERA.has(tipo)) out.push(b.subarray(i, fin));
    i = fin;
    if (tipo === "IEND") break;
  }
  return Buffer.concat(out);
}

// ─── WebP ────────────────────────────────────────────────────────────────

function limpiarWebp(b: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const tipo = b.toString("latin1", i, i + 4);
    const largo = b.readUInt32LE(i + 4);
    const fin = i + 8 + largo + (largo % 2);
    if (i + 8 + largo > b.length) throw new Error("webp: fragmento truncado");
    if (tipo === "EXIF" || tipo === "XMP ") {
      i = fin;
      continue;
    }
    const trozo = Buffer.from(b.subarray(i, Math.min(fin, b.length)));
    // VP8X declara en sus banderas qué fragmentos hay: se apagan EXIF (0x08) y XMP (0x04).
    if (tipo === "VP8X" && trozo.length > 8) trozo[8] &= ~0x0c;
    out.push(trozo);
    i = fin;
  }
  const cuerpo = Buffer.concat(out);
  const cab = Buffer.alloc(12);
  cab.write("RIFF", 0, "latin1");
  cab.writeUInt32LE(cuerpo.length + 4, 4);
  cab.write("WEBP", 8, "latin1");
  return Buffer.concat([cab, cuerpo]);
}

function sinMetadatos(b: Buffer, f: Formato): Buffer {
  if (f === JPEG) return limpiarJpeg(b);
  if (f === PNG) return limpiarPng(b);
  if (f === WEBP) return limpiarWebp(b);
  return b;
}

// ─── Quién puede subir qué ───────────────────────────────────────────────

/**
 * Las denuncias ciudadanas y los comprobantes de aporte se suben sin sesión (se
 * puede denunciar sin cuenta). Lo que se publica como parte del SITIO sí la pide:
 *  - `pago` (QR de Yape/Plin que ve cualquier financiador): sólo el panel admin,
 *    con su sesión firmada (lib/admin-sesion.ts). Antes bastaba con que existiera
 *    una cookie con ese nombre, cualquiera fuera su valor.
 *  - `logo` (logo de un aliado en el muro público): una sesión de Firebase,
 *    enviada como `Authorization: Bearer <idToken>` (igual que lib/cuentas.ts), o
 *    el admin.
 * Es un control de presencia, no de validez: la firma del token la comprueba el
 * backend en cada acción real. Alcanza para que el bucket público deje de ser
 * un hosting anónimo con la marca del sitio.
 */
async function autorizado(req: NextRequest, kind: string): Promise<boolean> {
  const sesion = await leerSesion(cookieAdmin(req));
  // Los QR de los medios de pago son plata: sólo el perfil admin (lib/permisos.ts).
  if (kind === "pago") return !!sesion && puede(sesion.rol, "subir_medios_pago");
  if (kind === "logo") {
    const bearer = /^Bearer\s+(\S+)/i.exec(req.headers.get("authorization") ?? "")?.[1];
    return !!sesion || !!bearer;
  }
  return true;
}

export async function POST(req: NextRequest) {
  // Corte temprano por Content-Length: no hace falta leer 30 MB para rechazarlos.
  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > MAX_BYTES + 512 * 1024) return fallar("archivo_muy_grande");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fallar("archivo_faltante");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fallar("archivo_faltante");
  if (file.size > MAX_BYTES) return fallar("archivo_muy_grande");

  const kindRaw = form.get("kind");
  const kind = typeof kindRaw === "string" ? kindRaw : "";
  // `modo=entidad`: evidencia de una denuncia a una entidad (nunca pública). Sólo cuenta para
  // los adjuntos de denuncias (sin `kind` o `kind=reporte`), no para QR ni logos.
  const modoEntidad = form.get("modo") === "entidad" && (kind === "" || kind === "reporte");
  if (!(await autorizado(req, kind))) return fallar("no_autorizado");

  const original = Buffer.from(await file.arrayBuffer());
  const formato = reconocer(original);
  if (formato === "heic") return fallar("heic_no_soportado");
  if (!formato) return fallar("tipo_no_permitido");

  let buf: Buffer;
  try {
    buf = sinMetadatos(original, formato);
  } catch {
    // Una foto que no se puede recorrer no se puede limpiar, y sin limpiar no se publica.
    return fallar("archivo_danado");
  }

  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // Comprobantes de pago (datos de quien aporta) y evidencia de denuncias a entidades → bucket
  // PRIVADO. `comprobantes/` es el prefijo que valida la API (contribuciones.ts).
  const esComprobante = kind === "comprobante";
  const privado = esComprobante || modoEntidad;
  const bucketName = privado ? BUCKET_PRIVADO : BUCKET;
  // pagos/ = QR de Yape/Plin (público por diseño, lo sube el admin); logos/ = logo de aliado (público en el muro)
  const prefix = esComprobante
    ? "comprobantes"
    : modoEntidad
      ? "denuncias-entidad"
      : kind === "pago"
        ? "pagos"
        : kind === "logo"
          ? "logos"
          : "reportes";
  const path = `${prefix}/${stamp}.${formato.ext}`;

  try {
    await guardarObjeto(bucketName, path, buf, {
      contentType: formato.mime,
      // Lo privado no se cachea en ningún lado; lo público es inmutable (nombre único).
      cacheControl: privado ? "private, no-store" : "public, max-age=31536000",
    });
  } catch (e) {
    console.error("[upload] GCS:", (e as Error).message);
    return fallar("error_al_guardar");
  }

  return NextResponse.json({
    ok: true,
    // En el bucket privado es una referencia interna (la lee la API con su cuenta de servicio), no un enlace.
    url: `https://storage.googleapis.com/${bucketName}/${path}`,
    privado,
    path,
    tipo: formato.tipo,
    filename: file.name,
    size_bytes: buf.length,
    content_type: formato.mime,
  });
}
