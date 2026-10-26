"use client";

// Formulario de denuncia de obra, en TRES COLUMNAS que se habilitan una tras otra (PasosEnColumnas):
//   1. Foto   : siempre abierta. Con una foto válida se habilita la 2.
//   2. Lugar  : con un punto o una dirección MÁS la región se habilita la 3.
//   3. Relato : qué viste, tipo de problema, datos y contacto opcionales (plegados) y el envío.
//
// Contra bots: cada archivo que se sube y el envío final llevan su propio token de Turnstile. Hay dos
// widgets (sólo se ven si Cloudflare pide marcar la casilla): uno en la columna de la foto y otro junto
// al botón de enviar.

import { useState } from "react";
import { AlertTriangle, Camera, Check, ChevronDown, FileText, ImagePlus, Loader2, Lock, MapPin, Pencil, Send, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { Ayuda } from "@/components/patrones/Ayuda";
import { cn } from "@/lib/utils";
import { createReporte } from "@/lib/api-client";
import { useTurnstile } from "@/components/seguridad/Turnstile";
import { cabeceraTurnstile } from "@/components/seguridad/mensajes";
import { REGIONES } from "@/lib/peru-data";
import { numero, porcentaje } from "@/lib/formato";
import type { CategoriaDenuncia } from "@/lib/denuncias-meta";
import { CAMPO as campo, ETIQUETA as etiqueta, ErrorCampo, ErrorEnvio, OpcionesCategoria } from "./Campos";
import { PasosEnColumnas, type Paso } from "./PasosEnColumnas";
import { ProgressTracker } from "./ProgressTracker";
import {
  ACEPTA_ARCHIVO,
  ACEPTA_FOTO,
  DESCRIPCION_MAX,
  DESCRIPCION_MIN,
  MAX_MB,
  correoValido,
  detieneLasSubidas,
  enlacesInvalidos,
  mensajeEnvio,
  mensajeErrorSubida,
  subirArchivo,
  type MediaSubido,
} from "./envio";

const CATEGORIAS_OBRA: { id: CategoriaDenuncia; label: string }[] = [
  { id: "obra_paralizada", label: "Obra paralizada" },
  { id: "obra_fantasma", label: "Obra fantasma o inaugurada de mentira" },
  // El mismo nombre que la lista pública (lib/denuncias-meta): una palabra, una definición (§10.1).
  { id: "funcionario_sospechoso", label: "Bienes de un funcionario" },
  { id: "irregularidad_general", label: "Otra irregularidad" },
];

/** Qué fotos ayudan: se ve en la zona de subida mientras no hay ninguna. */
const FOTOS_QUE_AYUDAN = ["La obra completa, de frente", "Un detalle: el estado, el material, la falta", "El cartel de obra, si lo tiene"];

type Errores = Partial<Record<"foto" | "lugar" | "descripcion" | "enlaces" | "correo", string>>;

export function FormObra({
  submitting,
  setSubmitting,
  onDone,
  initialRegion = "",
}: {
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  onDone: (id: string, region?: string) => void;
  initialRegion?: string;
}) {
  const [categoria, setCategoria] = useState<string>("");
  const [progreso, setProgreso] = useState<Record<string, number>>({}); // nombre → % subido
  const [geoEstado, setGeoEstado] = useState<"idle" | "buscando" | "ok" | "error">("idle");
  const [region, setRegion] = useState(initialRegion);
  const [descripcion, setDescripcion] = useState("");
  const [subidos, setSubidos] = useState<MediaSubido[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [erroresSubida, setErroresSubida] = useState<string[]>([]);
  const [errores, setErrores] = useState<Errores>({});
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [ubicacion, setUbicacion] = useState<{ lat: number; lon: number } | null>(null);
  const [direccionTexto, setDireccionTexto] = useState("");
  const [provincia, setProvincia] = useState("");
  const [distrito, setDistrito] = useState("");
  const [montoEstimado, setMontoEstimado] = useState("");
  const [periodoDesde, setPeriodoDesde] = useState("");
  const [periodoHasta, setPeriodoHasta] = useState("");
  const [personasInvolucradas, setPersonasInvolucradas] = useState("");
  const [enlacesExternos, setEnlacesExternos] = useState("");
  const [contactoOpcional, setContactoOpcional] = useState("");
  const [contactoNombre, setContactoNombre] = useState("");
  const [anonimo, setAnonimo] = useState(true);
  const verificacionSubida = useTurnstile("denuncia-adjuntos");
  const verificacionEnvio = useTurnstile("denuncia");

  const usarMiUbicacion = () => {
    if (!navigator.geolocation) {
      setGeoEstado("error");
      return;
    }
    setGeoEstado("buscando");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUbicacion({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoEstado("ok");
        setErrores((e) => ({ ...e, lugar: undefined }));
      },
      () => setGeoEstado("error"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const handleFilesPick = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const nuevos = Array.from(files);
    setErroresSubida([]);
    setSubiendo(true);
    try {
      for (const [i, f] of nuevos.entries()) {
        setProgreso((p) => ({ ...p, [f.name]: 0 }));
        try {
          const data = await subirArchivo(f, (pct) => setProgreso((p) => ({ ...p, [f.name]: pct })), {
            verificar: verificacionSubida.obtenerToken,
          });
          setSubidos((prev) => [
            ...prev,
            {
              url: data.url,
              tipo: data.tipo,
              filename: data.filename || f.name,
              size_bytes: data.size_bytes || f.size,
              content_type: data.content_type,
            },
          ]);
          if (data.tipo === "foto") setErrores((e) => ({ ...e, foto: undefined }));
        } catch (e) {
          setErroresSubida((prev) => [...prev, mensajeErrorSubida(f.name, e)]);
          // Sin verificación o con el límite de subidas alcanzado, los que siguen fallarían igual.
          if (detieneLasSubidas(e)) {
            const resto = nuevos.slice(i + 1).map((x) => `«${x.name}»`);
            if (resto.length) setErroresSubida((prev) => [...prev, `No se subieron ${resto.join(", ")}: vuelve a elegirlos.`]);
            break;
          }
        } finally {
          setProgreso((p) => {
            const { [f.name]: _x, ...rest } = p;
            return rest;
          });
        }
      }
    } finally {
      setSubiendo(false);
    }
  };

  const removeSubido = (i: number) => setSubidos((prev) => prev.filter((_, idx) => idx !== i));

  const hayFoto = subidos.some((s) => s.tipo === "foto");
  const hayLugar = !!(ubicacion || direccionTexto.trim());
  // El mínimo del paso 2: un punto o una dirección, y la región (departamento).
  const lugarOk = hayLugar && !!region;
  const relatoOk = descripcion.trim().length >= DESCRIPCION_MIN;

  const validar = (): Errores => {
    const e: Errores = {};
    if (!hayFoto) e.foto = "Sube al menos una foto de lo que viste.";
    if (!hayLugar) e.lugar = "Marca tu ubicación o escribe una dirección o referencia.";
    else if (!region) e.lugar = "Elige la región (departamento) donde está.";
    if (!relatoOk) e.descripcion = `Cuéntanos qué viste con al menos ${DESCRIPCION_MIN} caracteres.`;
    const malos = enlacesInvalidos(enlacesExternos);
    if (malos.length) e.enlaces = `Estos enlaces no son direcciones web completas (deben empezar con https://): ${malos.join(", ")}.`;
    if (!correoValido(contactoOpcional)) e.correo = "El correo no parece válido. Revísalo o déjalo vacío.";
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (subiendo) return;
    const e = validar();
    setErrores(e);
    if (Object.keys(e).length) {
      setErrorEnvio("Revisa los campos marcados antes de enviar.");
      return;
    }
    setErrorEnvio(null);
    setSubmitting(true);
    try {
      const enlaces = enlacesExternos.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const verificado = await verificacionEnvio.obtenerToken();
      const r = await createReporte({
        modo: "obra",
        categoria: categoria || "irregularidad_general",
        descripcion: descripcion.trim(),
        fotoUrl: subidos.find((s) => s.tipo === "foto")?.url ?? null,
        // Sin el nombre original del archivo: puede decir de quién es la foto
        // ("IMG_casa_de_juan.jpg") y la ficha de la denuncia es pública.
        media: subidos.map(({ url, tipo, size_bytes, content_type }) => ({ url, tipo, size_bytes, content_type: content_type ?? null })),
        lat: ubicacion?.lat ?? null,
        lon: ubicacion?.lon ?? null,
        direccionTexto: direccionTexto.trim() || null,
        region: region || null,
        provincia: provincia.trim() || null,
        distrito: distrito.trim() || null,
        montoEstimado: montoEstimado ? Number(montoEstimado) : null,
        periodoDesde: periodoDesde || null,
        periodoHasta: periodoHasta || null,
        personasInvolucradas: personasInvolucradas.trim() || null,
        enlacesExternos: enlaces.length ? enlaces : undefined,
        contactoEmail: contactoOpcional.trim() || null,
        contactoNombre: anonimo ? null : contactoNombre.trim() || null,
        anonimo,
      }, cabeceraTurnstile(verificado));
      onDone(r.id, region || undefined);
    } catch (err) {
      setErrorEnvio(mensajeEnvio(err));
    } finally {
      setSubmitting(false);
    }
  };

  const milestones = [
    { label: "Foto", done: hayFoto },
    { label: "Lugar", done: lugarOk },
    { label: "Relato", done: relatoOk },
  ];
  const doneCount = milestones.filter((m) => m.done).length;
  const ready = doneCount === milestones.length;
  const nFotos = subidos.filter((s) => s.tipo === "foto").length;

  const alSoltar = (ev: React.DragEvent) => {
    ev.preventDefault();
    setArrastrando(false);
    if (!subiendo && !submitting) void handleFilesPick(ev.dataTransfer.files);
  };

  // ── Columna 1: la foto ──────────────────────────────────────────────────────
  const zonaSubida = (vacia: boolean) => (
    <label
      onDragOver={(ev) => {
        ev.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={alSoltar}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 transition-colors duration-rapido focus-within:border-granate hover:border-granate/50",
        vacia ? "min-h-[96px] py-5" : "min-h-[64px] py-3",
        arrastrando ? "border-granate bg-granate-soft" : "border-line bg-paperSoft",
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-granate-soft text-granate" aria-hidden>
        <ImagePlus size={vacia ? 24 : 20} />
      </span>
      <span className="min-w-0 text-dato leading-5">
        <span className="block font-semibold text-ink">{vacia ? "Arrastra tus fotos aquí o elígelas" : "Agregar más fotos o documentos"}</span>
        <span className="block text-rotulo leading-4 text-mute">JPG, PNG o WebP, o PDF. Hasta {MAX_MB} MB cada uno.</span>
      </span>
      <input
        type="file"
        accept={ACEPTA_ARCHIVO}
        multiple
        className="sr-only"
        disabled={subiendo || submitting}
        aria-describedby="foto-ayuda"
        onChange={(e) => {
          void handleFilesPick(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );

  const columnaFoto = (
    <>
      {/* Cámara directa en el teléfono (capture) */}
      <label className="flex min-h-[56px] cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-granate/40 bg-granate-soft px-4 py-3 text-center transition-colors duration-rapido focus-within:border-granate hover:border-granate sm:hidden">
        <Camera size={22} className="text-granate" aria-hidden />
        <span className="text-dato leading-5">
          <span className="font-semibold text-ink">Tomar foto ahora</span>
          <span className="block text-rotulo leading-4 text-inkSoft">Abre la cámara del teléfono</span>
        </span>
        <input
          type="file"
          accept={ACEPTA_FOTO}
          capture="environment"
          className="sr-only"
          disabled={subiendo || submitting}
          aria-describedby="foto-ayuda"
          onChange={(e) => {
            void handleFilesPick(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {subidos.length === 0 ? (
        <>
          {zonaSubida(true)}
          <div className="rounded-xl bg-paperSoft px-3 py-3">
            <p className="text-rotulo leading-4 font-semibold text-ink">Qué fotos ayudan</p>
            <ul className="mt-1.5 space-y-1 text-rotulo leading-4 text-inkSoft">
              {FOTOS_QUE_AYUDAN.map((t) => (
                <li key={t} className="flex items-start gap-1.5">
                  <Check size={12} className="mt-0.5 shrink-0 text-moss" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {subidos.map((s, i) => (
              <li key={s.url} className="relative overflow-hidden rounded-xl border border-line bg-paperDeep">
                {s.tipo === "foto" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt={`Vista previa de la foto ${i + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 p-2 text-center">
                    <FileText size={22} className="text-mute" aria-hidden />
                    <span className="line-clamp-2 break-all text-micro text-inkSoft">{s.filename}</span>
                  </div>
                )}
                <span className="absolute bottom-1 left-1 rounded-full bg-ink/70 px-1.5 py-0.5 font-mono text-micro tabular-nums text-paper">
                  {(s.size_bytes / 1024 / 1024).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB
                </span>
                <button
                  type="button"
                  onClick={() => removeSubido(i)}
                  className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center"
                  aria-label={`Quitar ${s.tipo === "foto" ? `la foto ${i + 1}` : s.filename}`}
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink/70 text-paper transition-colors duration-rapido hover:bg-ink">
                    <X size={14} aria-hidden />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {zonaSubida(false)}
        </>
      )}

      {Object.entries(progreso).map(([nombre, pct]) => (
        <div key={nombre}>
          <div className="flex items-center justify-between text-micro text-mute">
            <span className="inline-flex items-center gap-1.5 truncate">
              <Loader2 size={11} className="animate-spin" aria-hidden /> Subiendo {nombre}
            </span>
            <span className="font-mono tabular-nums">{porcentaje(pct)}</span>
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-paperDeep"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Subida de ${nombre}`}
          >
            <div className="h-full rounded-full bg-granate transition-[width] duration-normal" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ))}
      {erroresSubida.length > 0 && (
        <ul className="space-y-1 text-rotulo leading-4 text-crimsonTexto" role="alert">
          {erroresSubida.map((m, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden /> {m}
            </li>
          ))}
        </ul>
      )}
      {verificacionSubida.widget}
      {errores.foto && <ErrorCampo>{errores.foto}</ErrorCampo>}
      {/* Lo que decide si subirla va a la vista (se publica); el detalle técnico, a un clic (§10.7). */}
      <p id="foto-ayuda" className="flex flex-wrap items-center gap-x-1 text-rotulo leading-4 text-mute">
        {nFotos > 0 ? `${nFotos} ${nFotos === 1 ? "foto lista" : "fotos listas"}. ` : "Hace falta al menos una foto. "}
        Se publica con la denuncia, sin los datos ocultos del celular.
        <Ayuda titulo="¿Qué datos ocultos le quitamos?">
          Antes de guardarla le quitamos los datos ocultos que traen las fotos de celular: la ubicación GPS, la hora y el
          modelo del teléfono.
        </Ayuda>
      </p>
    </>
  );

  // ── Columna 2: el lugar ─────────────────────────────────────────────────────
  const columnaLugar = (
    <>
      <div className="rounded-xl border border-line bg-paperSoft p-3">
        <Button type="button" variant="secondary" full onClick={usarMiUbicacion} disabled={geoEstado === "buscando"}>
          {geoEstado === "buscando" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <MapPin size={16} aria-hidden />}
          {geoEstado === "buscando" ? "Buscando tu ubicación…" : ubicacion ? "Actualizar mi ubicación" : "Usar mi ubicación actual"}
        </Button>
        {ubicacion && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-moss/30 bg-moss/10 px-2.5 py-1 text-rotulo leading-4 font-medium text-mossTexto">
            <Check size={12} aria-hidden /> Punto marcado: {ubicacion.lat.toFixed(4)}, {ubicacion.lon.toFixed(4)}
          </p>
        )}
        {geoEstado === "error" && !ubicacion && (
          <p className="mt-2 text-rotulo leading-4 text-crimsonTexto" role="status">
            No pudimos obtener tu ubicación: escribe la dirección abajo.
          </p>
        )}
        <p className="mt-2 text-rotulo leading-4 text-mute">El punto que marques se publica en el mapa. Si prefieres no marcarlo, basta con una dirección o referencia.</p>
      </div>

      <div className="flex min-h-[96px] flex-1 flex-col">
        <label htmlFor="obra-direccion" className={etiqueta}>
          Dirección o referencia
        </label>
        <textarea
          id="obra-direccion"
          maxLength={500}
          rows={3}
          placeholder="Ej: Av. Confraternidad 320, Huaraz, frente al colegio"
          value={direccionTexto}
          onChange={(e) => {
            setDireccionTexto(e.target.value);
            if (e.target.value.trim()) setErrores((x) => ({ ...x, lugar: undefined }));
          }}
          aria-invalid={!!errores.lugar}
          aria-describedby={errores.lugar ? "obra-lugar-error" : undefined}
          className={cn(campo, "min-h-[72px] flex-1 resize-none py-2 leading-relaxed")}
        />
      </div>
      {errores.lugar && <ErrorCampo id="obra-lugar-error">{errores.lugar}</ErrorCampo>}
      <div>
        <label htmlFor="obra-region" className={etiqueta}>
          Región (departamento)
        </label>
        <select
          id="obra-region"
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            if (e.target.value) setErrores((x) => ({ ...x, lugar: undefined }));
          }}
          className={cn(campo, "py-2 text-ink")}
        >
          <option value="">Elige una región</option>
          {REGIONES.map((r) => (
            <option key={r.id} value={r.nombre}>
              {r.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="obra-provincia" className={etiqueta}>
            Provincia (opcional)
          </label>
          <input id="obra-provincia" type="text" maxLength={80} value={provincia} onChange={(e) => setProvincia(e.target.value)} className={cn(campo, "py-2")} />
        </div>
        <div>
          <label htmlFor="obra-distrito" className={etiqueta}>
            Distrito (opcional)
          </label>
          <input id="obra-distrito" type="text" maxLength={80} value={distrito} onChange={(e) => setDistrito(e.target.value)} className={cn(campo, "py-2")} />
        </div>
      </div>
    </>
  );

  // ── Columna 3: el relato y el envío ─────────────────────────────────────────
  const columnaRelato = (
    <>
      <div>
        <label htmlFor="obra-descripcion" className={etiqueta}>
          Qué viste
        </label>
        <textarea
          id="obra-descripcion"
          value={descripcion}
          onChange={(e) => {
            setDescripcion(e.target.value);
            if (e.target.value.trim().length >= DESCRIPCION_MIN) setErrores((x) => ({ ...x, descripcion: undefined }));
          }}
          rows={3}
          maxLength={DESCRIPCION_MAX}
          aria-invalid={!!errores.descripcion}
          aria-describedby="obra-descripcion-ayuda"
          placeholder="Ej: Esta obra dice ser un colegio terminado pero por dentro está vacío, sin ventanas. El alcalde la inauguró en agosto."
          className={cn(campo, "py-3 leading-relaxed")}
        />
        <p id="obra-descripcion-ayuda" className="mt-1 flex justify-between gap-2 text-micro text-mute">
          <span>Mínimo {DESCRIPCION_MIN} caracteres.</span>
          <span className="font-mono tabular-nums">
            {numero(descripcion.length)} / {numero(DESCRIPCION_MAX)}
          </span>
        </p>
        {errores.descripcion && <ErrorCampo>{errores.descripcion}</ErrorCampo>}
      </div>

      <div>
        <span className={etiqueta}>Tipo de problema (opcional)</span>
        <OpcionesCategoria opciones={CATEGORIAS_OBRA} elegida={categoria} onElegir={setCategoria} etiqueta="Tipo de problema" permiteQuitar compacta />
      </div>

      {/* Colapsado: la mayoría de denuncias rápidas no los llena, y foto + lugar + relato ya alcanzan para enviar. */}
      <details className="group rounded-xl border border-dashed border-line bg-paperSoft open:border-line open:bg-transparent" open={!!errores.enlaces || !!errores.correo || undefined}>
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-dato leading-5 font-semibold text-granate marker:hidden [&::-webkit-details-marker]:hidden">
          <ChevronDown size={16} className="transition-transform duration-normal group-open:rotate-180" aria-hidden />
          Más datos y contacto (opcional)
        </summary>
        <div className="space-y-3 px-3 pb-3 pt-1">
          <div>
            <label htmlFor="obra-monto" className={etiqueta}>
              Monto estimado en soles
            </label>
            <input
              id="obra-monto"
              type="number"
              min="0"
              inputMode="decimal"
              value={montoEstimado}
              onChange={(e) => setMontoEstimado(e.target.value)}
              placeholder="Ej: 250000"
              className={cn(campo, "py-2")}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="obra-desde" className={etiqueta}>
                Desde
              </label>
              <input id="obra-desde" type="date" value={periodoDesde} onChange={(e) => setPeriodoDesde(e.target.value)} className={cn(campo, "px-3 py-2")} />
            </div>
            <div>
              <label htmlFor="obra-hasta" className={etiqueta}>
                Hasta
              </label>
              <input id="obra-hasta" type="date" value={periodoHasta} onChange={(e) => setPeriodoHasta(e.target.value)} className={cn(campo, "px-3 py-2")} />
            </div>
          </div>
          <div>
            <label htmlFor="obra-personas" className={etiqueta}>
              Personas involucradas (nombres y cargos)
            </label>
            <textarea
              id="obra-personas"
              rows={2}
              maxLength={1000}
              value={personasInvolucradas}
              onChange={(e) => setPersonasInvolucradas(e.target.value)}
              placeholder="Ej: el gerente municipal, la subgerente de logística"
              className={cn(campo, "py-2")}
            />
          </div>
          <div>
            <label htmlFor="obra-enlaces" className={etiqueta}>
              Enlaces externos (uno por línea)
            </label>
            <textarea
              id="obra-enlaces"
              rows={2}
              value={enlacesExternos}
              onChange={(e) => {
                setEnlacesExternos(e.target.value);
                setErrores((x) => ({ ...x, enlaces: undefined }));
              }}
              aria-invalid={!!errores.enlaces}
              placeholder={"https://facebook.com/post/123\nhttps://noticia.pe/articulo"}
              className={cn(campo, "py-2 font-mono text-rotulo leading-4")}
            />
            {errores.enlaces && <ErrorCampo>{errores.enlaces}</ErrorCampo>}
          </div>
        </div>
        <hr className="mx-3 border-line" />
        <div className="space-y-2 px-3 pb-3 pt-1">
          <div className="flex items-center gap-2 text-dato leading-5">
            <input
              id="obra-anonimo"
              type="checkbox"
              checked={anonimo}
              onChange={(e) => setAnonimo(e.target.checked)}
              className="h-4 w-4 rounded border-line accent-granate"
            />
            <label htmlFor="obra-anonimo" className="cursor-pointer text-ink">
              Enviar sin mi nombre
            </label>
            <Lock size={13} className="text-mute" aria-hidden />
          </div>
          {!anonimo && (
            <div>
              <label htmlFor="obra-nombre" className={etiqueta}>
                Tu nombre
              </label>
              <input id="obra-nombre" type="text" maxLength={120} value={contactoNombre} onChange={(e) => setContactoNombre(e.target.value)} className={campo} />
            </div>
          )}
          <div>
            <label htmlFor="obra-correo" className={etiqueta}>
              Correo (opcional)
            </label>
            <input
              id="obra-correo"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={contactoOpcional}
              onChange={(e) => {
                setContactoOpcional(e.target.value);
                setErrores((x) => ({ ...x, correo: undefined }));
              }}
              aria-invalid={!!errores.correo}
              placeholder="tu@correo.com"
              className={campo}
            />
            {errores.correo && <ErrorCampo>{errores.correo}</ErrorCampo>}
          </div>
          <p className="flex flex-wrap items-center gap-x-1 text-micro text-mute">
            Si lo dejas, el correo queda guardado junto a la denuncia.
            <Ayuda titulo="¿Qué se envía de mí?">
              No hace falta cuenta. Si marcas «sin mi nombre», tu nombre no se envía. El correo es opcional.
            </Ayuda>
          </p>
        </div>
      </details>

      <div className="mt-auto space-y-2 pt-1">
        <DisclaimerBanner />
        {verificacionEnvio.widget}
        {errorEnvio && <ErrorEnvio>{errorEnvio}</ErrorEnvio>}
        <Button type="submit" disabled={submitting || subiendo} full variant="primary">
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden /> Enviando tu denuncia…
            </>
          ) : subiendo ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden /> Esperando que termine la subida…
            </>
          ) : (
            <>
              <Send size={16} aria-hidden /> Enviar mi denuncia
            </>
          )}
        </Button>
        <p className="text-center text-rotulo leading-4 text-mute" aria-live="polite">
          {ready
            ? "Todo listo para enviar."
            : `Faltan ${milestones.length - doneCount} de ${milestones.length}: ${milestones
                .filter((m) => !m.done)
                .map((m) => m.label.toLowerCase())
                .join(", ")}.`}
        </p>
      </div>
    </>
  );

  const resumenLugar = [direccionTexto.trim() || (ubicacion ? "Punto marcado" : ""), region].filter(Boolean).join(", ");
  const pasos: Paso[] = [
    {
      id: "foto",
      titulo: "Foto",
      icono: <Camera size={14} />,
      completa: hayFoto,
      bloqueado: false,
      motivo: "",
      resumen: nFotos === 1 ? "1 foto lista" : `${nFotos} fotos listas`,
      children: columnaFoto,
    },
    {
      id: "lugar",
      titulo: "Lugar",
      icono: <MapPin size={14} />,
      completa: lugarOk,
      bloqueado: !hayFoto,
      motivo: "Completa la foto para seguir",
      resumen: resumenLugar,
      children: columnaLugar,
    },
    {
      id: "relato",
      titulo: "Relato",
      icono: <Pencil size={14} />,
      completa: relatoOk,
      // Los pasos van en orden: si se quita la foto, el relato también se vuelve a bloquear (lo escrito se conserva).
      bloqueado: !hayFoto || !lugarOk,
      motivo: !hayFoto ? "Completa la foto para seguir" : hayLugar ? "Elige la región para seguir" : "Marca el lugar para seguir",
      resumen: `${numero(descripcion.trim().length)} caracteres`,
      children: columnaRelato,
    },
  ];

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <ProgressTracker milestones={milestones} />
      <PasosEnColumnas pasos={pasos} etiqueta="Pasos de la denuncia de una obra" />
    </form>
  );
}
