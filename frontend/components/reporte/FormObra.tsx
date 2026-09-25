"use client";

// Formulario de denuncia de obra (extraído de page.tsx).
//
// Orden pensado para el teléfono, que es donde se usa: lo PRIMERO es la foto
// (el botón "Tomar foto" quedaba a 1.300 px del borde superior, detrás del
// encabezado y de la elección de categoría), después el lugar y el relato, y al
// final lo opcional.

import { useState } from "react";
import { Camera, MapPin, Lock, Check, Upload, Loader2, Send, AlertTriangle, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { cn } from "@/lib/utils";
import { createReporte } from "@/lib/api-client";
import { REGIONES } from "@/lib/peru-data";
import { numero, porcentaje } from "@/lib/formato";
import type { CategoriaDenuncia } from "@/lib/denuncias-meta";
import { Step } from "./Step";
import { CAMPO as campo, ETIQUETA as etiqueta, ErrorCampo, ErrorEnvio, OpcionesCategoria } from "./Campos";
import { ProgressTracker } from "./ProgressTracker";
import {
  ACEPTA_ARCHIVO,
  ACEPTA_FOTO,
  DESCRIPCION_MAX,
  DESCRIPCION_MIN,
  MAX_MB,
  codigoDeError,
  correoValido,
  enlacesInvalidos,
  mensajeEnvio,
  mensajeSubida,
  subirArchivo,
  type MediaSubido,
} from "./envio";

const CATEGORIAS_OBRA: { id: CategoriaDenuncia; label: string }[] = [
  { id: "obra_paralizada", label: "Obra paralizada" },
  { id: "obra_fantasma", label: "Obra fantasma o inaugurada de mentira" },
  { id: "funcionario_sospechoso", label: "Funcionario con bienes no declarados" },
  { id: "irregularidad_general", label: "Otra irregularidad" },
];

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

  const handleFilesPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const nuevos = Array.from(files);
    setErroresSubida([]);
    setSubiendo(true);
    try {
      for (const f of nuevos) {
        setProgreso((p) => ({ ...p, [f.name]: 0 }));
        try {
          const data = await subirArchivo(f, (pct) => setProgreso((p) => ({ ...p, [f.name]: pct })));
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
          setErroresSubida((prev) => [...prev, mensajeSubida(f.name, codigoDeError(e))]);
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
  const relatoOk = descripcion.trim().length >= DESCRIPCION_MIN;

  const validar = (): Errores => {
    const e: Errores = {};
    if (!hayFoto) e.foto = "Sube al menos una foto de lo que viste.";
    if (!hayLugar) e.lugar = "Marca tu ubicación o escribe una dirección o referencia.";
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
      setErrorEnvio("Revisa los campos marcados arriba antes de enviar.");
      return;
    }
    setErrorEnvio(null);
    setSubmitting(true);
    try {
      const enlaces = enlacesExternos.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
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
      });
      onDone(r.id, region || undefined);
    } catch (err) {
      setErrorEnvio(mensajeEnvio(err));
    } finally {
      setSubmitting(false);
    }
  };

  const milestones = [
    { label: "Foto", done: hayFoto },
    { label: "Lugar", done: hayLugar },
    { label: "Relato", done: relatoOk },
  ];
  const doneCount = milestones.filter((m) => m.done).length;
  const ready = doneCount === milestones.length;

  return (
    <form onSubmit={submit} noValidate className="space-y-6 rounded-2xl border border-line bg-paper p-4 sm:p-6">
      {/* En el teléfono, la barra de avance empujaba la foto hacia abajo: ahí el
          aviso "Faltan…" junto al botón de enviar cumple el mismo papel. */}
      <div className="hidden sm:block">
        <ProgressTracker milestones={milestones} />
      </div>

      <Step n={1} title="Foto de lo que viste">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
          {/* Cámara directa en el teléfono (capture) */}
          <label className="flex min-h-[64px] cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-granate/40 bg-granate-soft px-4 py-5 text-center transition-colors duration-rapido focus-within:border-granate hover:border-granate sm:hidden">
            <Camera size={22} className="text-granate" aria-hidden />
            <span className="text-sm">
              <span className="font-semibold text-ink">Tomar foto ahora</span>
              <br />
              <span className="text-xs text-inkSoft">Abre la cámara del teléfono</span>
            </span>
            <input
              type="file"
              accept={ACEPTA_FOTO}
              capture="environment"
              className="sr-only"
              disabled={subiendo || submitting}
              aria-describedby="foto-ayuda"
              onChange={(e) => {
                handleFilesPick(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className="flex min-h-[64px] cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-paperSoft px-4 py-5 text-center transition-colors duration-rapido focus-within:border-granate hover:border-granate/40 sm:col-span-2">
            <Upload size={20} className="text-mute" aria-hidden />
            <span className="text-sm">
              <span className="font-medium text-ink">Elegir fotos o documentos</span>
              <br />
              <span className="text-xs text-mute">Fotos JPG, PNG o WebP, o PDF. Hasta {MAX_MB} MB cada uno.</span>
            </span>
            <input
              type="file"
              accept={ACEPTA_ARCHIVO}
              multiple
              className="sr-only"
              disabled={subiendo || submitting}
              aria-describedby="foto-ayuda"
              onChange={(e) => {
                handleFilesPick(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {Object.entries(progreso).map(([nombre, pct]) => (
          <div key={nombre} className="mt-2">
            <div className="flex items-center justify-between text-[11px] text-mute">
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
          <ul className="mt-2 space-y-1 text-xs text-crimsonTexto" role="alert">
            {erroresSubida.map((m, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden /> {m}
              </li>
            ))}
          </ul>
        )}
        {errores.foto && <ErrorCampo>{errores.foto}</ErrorCampo>}
        {subidos.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {subidos.map((s, i) => (
              <li key={s.url} className="flex items-center gap-2 rounded-lg border border-line bg-paperSoft px-3 py-2 text-xs">
                <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[11px] font-semibold text-inkSoft">
                  {s.tipo === "foto" ? "Foto" : "Documento"}
                </span>
                <a href={s.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-ink hover:underline">
                  {s.filename}
                </a>
                <span className="font-mono text-[11px] tabular-nums text-mute">{(s.size_bytes / 1024 / 1024).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB</span>
                <button
                  type="button"
                  onClick={() => removeSubido(i)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
                  aria-label={`Quitar ${s.filename}`}
                >
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p id="foto-ayuda" className="mt-2 text-xs text-mute">
          La foto se publica con la denuncia. Antes de guardarla le quitamos los datos ocultos que traen las fotos de
          celular: la ubicación GPS, la hora y el modelo del teléfono.
        </p>
      </Step>

      <Step n={2} title="¿Dónde está?">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={usarMiUbicacion} disabled={geoEstado === "buscando"}>
            {geoEstado === "buscando" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <MapPin size={16} aria-hidden />}
            {geoEstado === "buscando" ? "Buscando tu ubicación…" : ubicacion ? "Actualizar mi ubicación" : "Usar mi ubicación actual"}
          </Button>
          {ubicacion && (
            <span className="pill border-moss/30 bg-moss/10 text-mossTexto">
              <Check size={12} aria-hidden /> {ubicacion.lat.toFixed(4)}, {ubicacion.lon.toFixed(4)}
            </span>
          )}
          {geoEstado === "error" && !ubicacion && (
            <span className="text-xs text-crimsonTexto" role="status">
              No pudimos obtener tu ubicación: escribe la dirección abajo.
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-mute">
          El punto que marques se publica en el mapa. Si prefieres no marcarlo, basta con una dirección o referencia.
        </p>
        <div className="mt-3">
          <label htmlFor="obra-direccion" className={etiqueta}>
            Dirección o referencia
          </label>
          <input
            id="obra-direccion"
            type="text"
            maxLength={500}
            placeholder="Ej: Av. Confraternidad 320, Huaraz"
            value={direccionTexto}
            onChange={(e) => {
              setDireccionTexto(e.target.value);
              if (e.target.value.trim()) setErrores((x) => ({ ...x, lugar: undefined }));
            }}
            aria-invalid={!!errores.lugar}
            aria-describedby={errores.lugar ? "obra-lugar-error" : undefined}
            className={campo}
          />
        </div>
        {errores.lugar && <ErrorCampo id="obra-lugar-error">{errores.lugar}</ErrorCampo>}
        <div className="mt-2">
          <label htmlFor="obra-region" className={etiqueta}>
            Región (departamento)
          </label>
          <select id="obra-region" value={region} onChange={(e) => setRegion(e.target.value)} className={cn(campo, "py-2 text-ink")}>
            <option value="">Elige una región</option>
            {REGIONES.map((r) => (
              <option key={r.id} value={r.nombre}>
                {r.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
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
      </Step>

      <Step n={3} title="Cuéntanos qué viste">
        <label htmlFor="obra-descripcion" className="sr-only">
          Qué viste
        </label>
        <textarea
          id="obra-descripcion"
          value={descripcion}
          onChange={(e) => {
            setDescripcion(e.target.value);
            if (e.target.value.trim().length >= DESCRIPCION_MIN) setErrores((x) => ({ ...x, descripcion: undefined }));
          }}
          rows={5}
          maxLength={DESCRIPCION_MAX}
          aria-invalid={!!errores.descripcion}
          aria-describedby="obra-descripcion-ayuda"
          placeholder="Ej: Esta obra dice ser un colegio terminado pero por dentro está vacío, sin ventanas. El alcalde la inauguró en agosto."
          className={cn(campo, "py-3 leading-relaxed")}
        />
        <p id="obra-descripcion-ayuda" className="mt-1 flex justify-between gap-2 text-[11px] text-mute">
          <span>Mínimo {DESCRIPCION_MIN} caracteres.</span>
          <span className="font-mono tabular-nums">
            {numero(descripcion.length)} / {numero(DESCRIPCION_MAX)}
          </span>
        </p>
        {errores.descripcion && <ErrorCampo>{errores.descripcion}</ErrorCampo>}
      </Step>

      <Step n={4} title="¿Qué tipo de problema es? (opcional)">
        <OpcionesCategoria opciones={CATEGORIAS_OBRA} elegida={categoria} onElegir={setCategoria} etiqueta="Tipo de problema" permiteQuitar />
      </Step>

      <Step n={5} title="Datos adicionales (opcional)">
        {/* Colapsado por defecto: la mayoría de denuncias rápidas no los llena, y
            foto + lugar + relato ya alcanzan para enviar. */}
        <details className="group rounded-xl border border-dashed border-line bg-paperSoft open:border-line open:bg-transparent" open={!!errores.enlaces || undefined}>
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-sm font-semibold text-granate marker:hidden [&::-webkit-details-marker]:hidden">
            <ChevronDown size={16} className="transition-transform duration-normal group-open:rotate-180" aria-hidden />
            Agregar monto, fechas, personas o enlaces
          </summary>
          <div className="space-y-3 px-4 pb-4 pt-1">
            <div className="grid gap-3 sm:grid-cols-2">
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
                className={cn(campo, "py-2 font-mono text-xs")}
              />
              {errores.enlaces && <ErrorCampo>{errores.enlaces}</ErrorCampo>}
            </div>
          </div>
        </details>
      </Step>

      <Step n={6} title="Contacto (opcional)">
        <div className="mb-3 flex items-center gap-2 text-sm">
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
          <div className="mb-2">
            <label htmlFor="obra-nombre" className={etiqueta}>
              Tu nombre
            </label>
            <input
              id="obra-nombre"
              type="text"
              maxLength={120}
              value={contactoNombre}
              onChange={(e) => setContactoNombre(e.target.value)}
              className={campo}
            />
          </div>
        )}
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
        <p className="mt-2 text-[11px] text-mute">
          No hace falta cuenta. Si marcas «sin mi nombre», tu nombre no se envía. El correo es opcional: si lo dejas,
          queda guardado junto a la denuncia.
        </p>
      </Step>

      <DisclaimerBanner />

      <div className="space-y-2">
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
        <p className="text-center text-xs text-mute" aria-live="polite">
          {ready
            ? "Todo listo para enviar."
            : `Faltan ${milestones.length - doneCount} de ${milestones.length}: ${milestones
                .filter((m) => !m.done)
                .map((m) => m.label.toLowerCase())
                .join(", ")}.`}
        </p>
      </div>
    </form>
  );
}

