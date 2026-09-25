"use client";

/**
 * Adjuntar el comprobante de pago (captura de Yape/Plin o constancia de transferencia)
 * a un aporte en `pendiente_pago`. Lo usan el paso de pago del formulario y Mi impacto,
 * para que "lo envío después" tenga un lugar real al que volver.
 *
 * El código del aporte es correlativo y público: la API exige probar que el aporte es tuyo
 * (POST /contribuciones/:codigo/comprobante). Se mandan las dos pruebas que haya a mano:
 *   · la sesión (Firebase ID token), si la cuenta es la dueña del aporte (Mi impacto);
 *   · el correo con el que se registró el aporte (el formulario lo pasa por `email`; si no se
 *     conoce y no hay sesión, se le pide a la persona).
 */

import { useEffect, useId, useState } from "react";
import { Camera, CheckCircle2, Loader2, Upload } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { idToken } from "@/lib/cuentas";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";

const ERRORES: Record<string, string> = {
  invalid_body: "El archivo subió, pero no pudimos asociarlo al aporte. Inténtalo de nuevo.",
  not_found_or_not_pending: "Este aporte ya no espera comprobante: se validó o se anuló.",
  titularidad_requerida:
    "Para adjuntar el comprobante, escribe el correo con el que registraste el aporte o inicia sesión con la cuenta del aporte.",
  titularidad_no_coincide:
    "Ese correo no coincide con el del aporte. Usa el mismo correo que ingresaste al registrarlo, o inicia sesión con la cuenta del aporte.",
};

const CORREO_VALIDO = /^\S+@\S+\.\S+$/;

const ANILLO_ETIQUETA =
  "focus-within:outline-none focus-within:ring-2 focus-within:ring-granate focus-within:ring-offset-2 focus-within:ring-offset-paper";

/** Selector de archivo con forma de botón secundario (píldora, borde, 40 px). */
const ELEGIR =
  "inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-granate/40 hover:bg-granate-50";

export function SubirComprobante({
  codigo,
  email,
  onSubido,
  compacto = false,
}: {
  codigo: string;
  /** Correo con el que se registró el aporte, si ya se conoce (formulario de aporte). */
  email?: string | null;
  onSubido?: () => void;
  compacto?: boolean;
}) {
  const { user, loading: authLoading } = useAuth();
  const idCorreo = useId();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subido, setSubido] = useState(false);
  const [correo, setCorreo] = useState(email?.trim() ?? "");
  // true tras un 403: la sesión o el correo no alcanzaron y hay que (re)escribir el correo.
  const [pedirCorreo, setPedirCorreo] = useState(false);
  // URL del archivo ya subido: si la API rechaza la titularidad, reintentar no vuelve a subirlo.
  const [urlSubida, setUrlSubida] = useState<string | null>(null);

  useEffect(() => { if (email?.trim()) setCorreo(email.trim()); }, [email]);

  const sinSesion = !authLoading && !user;
  const mostrarCorreo = pedirCorreo || (sinSesion && !email?.trim());

  function elegir(f: File | null) {
    setArchivo(f);
    setUrlSubida(null);
  }

  async function enviar() {
    if (!archivo) return;
    setError(null);
    const token = await idToken();
    const correoLimpio = correo.trim();
    if (!token && !CORREO_VALIDO.test(correoLimpio)) {
      setPedirCorreo(true);
      setError("Escribe el correo con el que registraste el aporte: con él comprobamos que es tuyo.");
      return;
    }
    setCargando(true);
    try {
      let url = urlSubida;
      if (!url) {
        setProgreso(0);
        url = await subirConProgreso(archivo, setProgreso);
        setUrlSubida(url);
      }
      const r = await fetch(`${PUBLIC_API_BASE}/contribuciones/${encodeURIComponent(codigo)}/comprobante`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ url, email: CORREO_VALIDO.test(correoLimpio) ? correoLimpio : undefined }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const codigoError = (j as { error?: string }).error ?? "";
        if (r.status === 403) setPedirCorreo(true);
        throw new Error(
          ERRORES[codigoError]
            ?? (r.status === 403 ? ERRORES.titularidad_no_coincide : "No se pudo adjuntar el comprobante. Inténtalo de nuevo."),
        );
      }
      setSubido(true);
      onSubido?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
      setProgreso(null);
    }
  }

  if (subido) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mossTexto" role="status">
        <CheckCircle2 size={14} aria-hidden /> Comprobante recibido para {codigo}.
      </p>
    );
  }

  return (
    <div className={compacto ? "" : "rounded-2xl border border-line p-4"}>
      {!compacto && (
        <>
          <p className="text-sm font-semibold text-ink">
            Envía tu comprobante de pago <span className="font-normal text-mute">(opcional: acelera la validación)</span>
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-inkSoft">Captura de Yape o Plin, o constancia de transferencia. Se guarda en privado; solo lo ve quien valida.</p>
        </>
      )}
      {mostrarCorreo && (
        <div className={compacto ? "mb-2" : "mt-3"}>
          <label htmlFor={idCorreo} className="block text-sm font-medium text-ink">Correo con el que registraste el aporte</label>
          <input
            id={idCorreo}
            type="email"
            required
            autoComplete="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            aria-describedby={`${idCorreo}-ayuda`}
            className="mt-1 w-full max-w-sm rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-mute"
            placeholder="tu@correo.pe"
          />
          <p id={`${idCorreo}-ayuda`} className="mt-1 text-[12px] text-mute">
            Solo lo usamos para comprobar que el aporte {codigo} es tuyo; no se publica.
          </p>
        </div>
      )}
      <div className={`${compacto ? "" : "mt-3 "}flex flex-wrap items-center gap-2`}>
        <label className={`${ELEGIR} sm:hidden ${ANILLO_ETIQUETA}`}>
          <Camera size={14} aria-hidden /> Tomar foto
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(e) => elegir(e.target.files?.[0] ?? null)} />
        </label>
        <label className={`${ELEGIR} ${ANILLO_ETIQUETA}`}>
          <Upload size={14} aria-hidden /> Elegir archivo
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => elegir(e.target.files?.[0] ?? null)} />
        </label>
        {archivo && <span className="max-w-[16rem] truncate text-[12px] text-inkSoft">{archivo.name}</span>}
        <Button type="button" onClick={enviar} disabled={!archivo || cargando}>
          {cargando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />} Enviar comprobante
        </Button>
      </div>
      {progreso != null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuenow={progreso} aria-valuemin={0} aria-valuemax={100} aria-label="Subiendo comprobante">
          <div className="h-full rounded-full bg-moss" style={{ width: `${progreso}%` }} />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-crimsonTexto" role="alert">{error}</p>}
    </div>
  );
}

/** Sube a /api/upload con progreso real (XHR). Devuelve la URL pública/firmada del archivo. */
function subirConProgreso(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "comprobante");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && j.url) resolve(j.url);
        else reject(new Error("No se pudo subir el comprobante. Revisa que sea una imagen o un PDF."));
      } catch { reject(new Error("No se pudo subir el comprobante.")); }
    };
    xhr.onerror = () => reject(new Error("Sin conexión al subir el comprobante."));
    xhr.send(fd);
  });
}
