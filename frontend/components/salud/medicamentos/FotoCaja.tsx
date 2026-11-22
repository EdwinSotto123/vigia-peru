"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, RotateCw, ScanSearch, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTurnstile, ErrorTurnstile } from "@/components/seguridad/Turnstile";
import { cabeceraTurnstile } from "@/components/seguridad/mensajes";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { Pixel } from "@/components/pixel/Pixel";
import { URL_FOTO_MEDICAMENTO, type LecturaCaja } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

type Estado =
  | { fase: "inicio" }
  | { fase: "leyendo"; foto: string }
  | { fase: "leido"; foto: string; leido: LecturaCaja }
  | { fase: "error"; foto: string | null; texto: string };

/** El lado mayor de la foto que se manda: con 1 600 px se lee la letra chica de una caja y pesa 200-500 KB. */
const LADO = 1600;
const MAX_BYTES = 950_000;

/** «Cefalogen 1G Polvo para solución…» → «Cefalogen»: la marca, sin la concentración ni la forma (hasta tres palabras). */
function marcaDe(nombre: string): string {
  const out: string[] = [];
  for (const w of nombre.trim().split(/\s+/)) {
    if (/\d/.test(w) || /^(polvo|tabletas?|c[aá]psulas?|jarabe|soluci[oó]n|suspensi[oó]n|crema|gel|gotas|inyectable|comprimidos?|ung[uü]ento|x)$/i.test(w)) break;
    out.push(w);
    if (out.length === 3) break;
  }
  return out.join(" ") || nombre;
}

/** La foto, derecha (EXIF) y achicada a JPEG. */
async function achicar(archivo: File): Promise<Blob> {
  let fuente: ImageBitmap | HTMLImageElement;
  try {
    fuente = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch {
    fuente = await new Promise<HTMLImageElement>((ok, mal) => {
      const img = new Image();
      const url = URL.createObjectURL(archivo);
      img.onload = () => {
        URL.revokeObjectURL(url);
        ok(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        mal(new Error("no_imagen"));
      };
      img.src = url;
    });
  }
  const w = fuente.width;
  const h = fuente.height;
  if (!w || !h) throw new Error("no_imagen");
  const k = Math.min(1, LADO / Math.max(w, h));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(w * k);
  lienzo.height = Math.round(h * k);
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("no_imagen");
  ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  if ("close" in fuente) fuente.close();
  for (const calidad of [0.85, 0.72, 0.6]) {
    const b = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", calidad));
    if (b && b.size <= MAX_BYTES) return b;
  }
  throw new Error("grande");
}

/**
 * «Toma una foto de la caja» (Gobserva Salud, 2026-11-22; el usuario: «ALGO TIPO: TOMA FOTO»). En el celular abre la
 * cámara de atrás; en la computadora, el selector de archivos. La foto se achica en el teléfono, va a la API (POST
 * /salud/medicamentos/foto, con Turnstile), un modelo abierto lee el registro sanitario, el lote, el vencimiento y el
 * nombre, y la foto se descarta. Lo leído se muestra para revisarlo y corregirlo antes de verificar: el modelo puede
 * leer mal. «Verificar» abre /medicamentos con el registro (o el nombre) y el lote.
 */
export function FotoCaja({
  accion,
  className,
  variante = "fila",
}: {
  accion: string;
  className?: string;
  /** «fila»: botón y nota en una línea (los resultados); «centrado»: bajo el buscador; «zona»: la pestaña de la foto. */
  variante?: "fila" | "centrado" | "zona";
}) {
  const router = useRouter();
  const verificacion = useTurnstile("foto_medicamento");
  const entrada = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<Estado>({ fase: "inicio" });
  const [registro, setRegistro] = useState("");
  const [lote, setLote] = useState("");
  const anuncio = useRef<HTMLHeadingElement>(null);

  // La vista previa vive en la memoria del teléfono: se suelta al cambiar de foto o salir.
  const foto = estado.fase === "inicio" ? null : estado.foto;
  useEffect(() => () => {
    if (foto) URL.revokeObjectURL(foto);
  }, [foto]);
  useEffect(() => {
    if (estado.fase === "leido" || estado.fase === "error") anuncio.current?.focus();
  }, [estado.fase]);

  const elegir = () => {
    if (entrada.current) {
      entrada.current.value = "";
      entrada.current.click();
    }
  };

  const leer = async (archivo: File) => {
    const vista = URL.createObjectURL(archivo);
    setEstado({ fase: "leyendo", foto: vista });
    try {
      const jpeg = await achicar(archivo);
      const token = await verificacion.obtenerToken();
      const r = await fetch(URL_FOTO_MEDICAMENTO, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg", ...cabeceraTurnstile(token) },
        body: jpeg,
        cache: "no-store",
      });
      const j = (await r.json().catch(() => null)) as { leido?: LecturaCaja; detail?: string } | null;
      if (!r.ok || !j?.leido) {
        setEstado({ fase: "error", foto: vista, texto: j?.detail ?? "No pudimos leer la foto ahora. Vuelve a intentarlo o escribe el registro y el lote." });
        return;
      }
      setRegistro(j.leido.registro ?? "");
      setLote(j.leido.lote ?? "");
      setEstado({ fase: "leido", foto: vista, leido: j.leido });
    } catch (e) {
      const texto =
        e instanceof ErrorTurnstile
          ? e.message
          : (e as Error).message === "grande"
            ? "La foto pesa demasiado. Vuelve a tomarla."
            : (e as Error).message === "no_imagen"
              ? "No pudimos abrir esa imagen. Toma la foto con la cámara o elige una JPG."
              : "No pudimos enviar la foto. Revisa tu conexión y vuelve a intentarlo.";
      setEstado({ fase: "error", foto: vista, texto });
    }
  };

  const verificar = () => {
    if (estado.fase !== "leido") return;
    const reg = registro.trim();
    const lot = lote.trim();
    // Sin registro, la marca sola («Cefalogen 1G Polvo para…» → «Cefalogen»): el nombre entero casi nunca coincide.
    const q = reg || (estado.leido.nombre ? marcaDe(estado.leido.nombre) : "") || lot;
    if (!q) return;
    const p = new URLSearchParams({ q });
    if (lot && lot !== q) p.set("lote", lot);
    router.push(`${accion}?${p}`);
    // El resultado ocupa su lugar: la tarjeta de lo leído se cierra (el botón queda para otra caja).
    setEstado({ fase: "inicio" });
  };

  const leyendo = estado.fase === "leyendo";

  return (
    <div className={cn("min-w-0", className)}>
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void leer(f);
        }}
      />

      {estado.fase === "inicio" && variante === "centrado" && (
        <div className="flex flex-col items-center gap-2 text-center">
          <button
            type="button"
            onClick={elegir}
            className="gs-hunde inline-flex min-h-12 items-center gap-2.5 rounded-full border border-granate/30 bg-granate-50 px-6 text-dato font-semibold text-granate transition-colors duration-rapido hover:border-granate/60 hover:bg-granate/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2"
          >
            <Camera size={18} aria-hidden />
            Toma una foto de la caja
          </button>
          <p className="max-w-[56ch] text-meta leading-snug text-inkSoft">Fotografía el envase: leemos su registro sanitario y su lote. La foto no se guarda.</p>
        </div>
      )}

      {estado.fase === "inicio" && variante === "zona" && (
        <button
          type="button"
          onClick={elegir}
          className="gs-hunde flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-granate/40 bg-granate-50/60 px-6 py-8 text-center transition-colors duration-rapido hover:border-granate/70 hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2"
        >
          <Pixel nombre="medCaja" escala={4} animado={false} acento="accion" />
          <span className="font-display text-bloque font-bold text-ink">Toma o sube una foto de la caja</span>
          <span className="max-w-[52ch] text-meta leading-relaxed text-inkSoft">
            Que se lean el registro sanitario (R.S.) y el lote. Te mostramos lo leído para que lo revises antes de verificar. La foto no se
            guarda; fotografía sólo la caja, no la receta.
          </span>
        </button>
      )}

      {estado.fase === "inicio" && variante === "fila" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <button type="button" onClick={elegir} className={claseAccion("secundario", "min-h-12 w-full justify-center border-granate/40 sm:w-auto")}>
            <Camera size={18} aria-hidden className="text-granate" />
            Toma una foto de la caja
          </button>
          <p className="flex gap-1.5 text-meta leading-snug text-inkSoft">
            <ShieldCheck size={14} aria-hidden className="mt-0.5 shrink-0 text-granate" />
            <span>Leemos el registro sanitario y el lote por ti. La foto no se guarda; fotografía sólo la caja, no la receta.</span>
          </p>
        </div>
      )}

      {estado.fase !== "inicio" && (
        <section aria-labelledby="foto-t" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <div className="flex gap-4">
            {estado.foto && (
              // La vista previa es la foto local (blob:), no una imagen del sitio: next/image no aplica.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={estado.foto} alt="Tu foto de la caja" className="h-24 w-20 shrink-0 rounded-lg border border-line object-cover sm:h-28 sm:w-24" />
            )}
            <div className="min-w-0 flex-1">
              {leyendo && (
                <h2 id="foto-t" className="sr-only">
                  Leyendo la caja
                </h2>
              )}
              {leyendo && (
                <p role="status" className="flex items-center gap-2 text-dato font-semibold text-ink">
                  <Loader2 size={17} aria-hidden className="text-granate motion-safe:animate-spin" />
                  Leyendo la caja…
                </p>
              )}
              {leyendo && <p className="mt-1 text-meta text-inkSoft">Toma unos segundos. Buscamos el registro sanitario, el lote y el vencimiento.</p>}

              {estado.fase === "error" && (
                <>
                  <h2 id="foto-t" ref={anuncio} tabIndex={-1} className="flex items-start gap-2 font-display text-bloque font-bold leading-snug text-ink focus:outline-none">
                    <TriangleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
                    No pudimos leer la caja
                  </h2>
                  <p className="mt-1 text-dato leading-relaxed text-inkSoft">{estado.texto}</p>
                  <button type="button" onClick={elegir} className={claseAccion("secundario", "mt-3 min-h-11")}>
                    <RotateCw size={15} aria-hidden /> Tomar otra foto
                  </button>
                </>
              )}

              {estado.fase === "leido" && (
                <>
                  <h2 id="foto-t" ref={anuncio} tabIndex={-1} className="font-display text-bloque font-bold leading-snug text-ink focus:outline-none">
                    Esto leímos de tu foto
                  </h2>
                  {(estado.leido.nombre || estado.leido.vencimiento) && (
                    <p className="mt-0.5 text-meta text-inkSoft">
                      {[estado.leido.nombre, estado.leido.concentracion, estado.leido.vencimiento ? `vence ${estado.leido.vencimiento}` : null].filter(Boolean).join(", ")}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {estado.fase === "leido" && (
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                verificar();
              }}
            >
              <p className="text-meta text-inkSoft">Revisa que coincidan con tu caja y corrige lo que haga falta.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Campo id="foto-registro" etiqueta="Registro sanitario" valor={registro} cambiar={setRegistro} vacio="No lo leímos: escríbelo" />
                <Campo id="foto-lote" etiqueta="Lote" valor={lote} cambiar={setLote} vacio="No lo leímos: escríbelo" />
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="submit"
                  disabled={!registro.trim() && !lote.trim() && !estado.leido.nombre}
                  className={claseAccion("primario", "min-h-12 justify-center disabled:opacity-60")}
                >
                  <ScanSearch size={17} aria-hidden /> Verificar esta caja
                </button>
                <button type="button" onClick={elegir} className={claseAccion("secundario", "min-h-12 justify-center")}>
                  <Camera size={16} aria-hidden /> Tomar otra foto
                </button>
              </div>
            </form>
          )}
          <div className="mt-2">{verificacion.widget}</div>
        </section>
      )}
      {estado.fase === "inicio" && <div className="mt-1">{verificacion.widget}</div>}
    </div>
  );
}

function Campo({ id, etiqueta, valor, cambiar, vacio }: { id: string; etiqueta: string; valor: string; cambiar: (v: string) => void; vacio: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-rotulo font-semibold text-mute">
        {etiqueta}
      </label>
      <input
        id={id}
        value={valor}
        onChange={(e) => cambiar(e.target.value.toUpperCase())}
        placeholder={vacio}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="mt-1 h-12 w-full rounded-xl border border-line bg-paper px-3 font-mono text-destacado text-ink placeholder:font-sans placeholder:text-meta placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
      />
    </div>
  );
}
