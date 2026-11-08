"use client";

import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowRight, BadgeCheck, Bell, BellOff, BriefcaseBusiness, CalendarClock, Check, FileUp, GraduationCap, Loader2, MapPin, MessageSquareText, RotateCcw, School, ShieldCheck, Sparkles, Timer, Wallet,
} from "lucide-react";
import { MarcaGobserva } from "@/components/gobserva/MarcaGobserva";
import { Compositor, Conversacion, Escribiendo, MensajeBot, MensajeTuyo, Opcion, Respuestas, useEscribiendo, useMenosMovimiento, useRetrasado } from "@/components/gobserva/app/chat/Chat";
import { useMe, useSesion } from "@/components/gobserva/cuenta/comun";
import { rutaEn } from "@/lib/gobserva";
import { ErrorCuenta, borrarBusqueda, cambiarAlerta, cargarAlertas, crearAlerta, crearBusqueda, leerCvEmpleo } from "@/lib/gobserva-cuenta";
import { REGIONES_EMPLEO, diasParaCierre, entidadNombre, nombreRegion, puesto as puestoLegible, slugRegion, textoCierre } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import {
  CARRERAS, ESTUDIOS, EXPERIENCIAS, MAX_CARRERAS, MAX_PALABRAS_EMPLEO, NOMBRE_PERFIL, PERFIL_EMPLEO_VACIO, PREGUNTAS_EMPLEO, SUELDOS, aAlertaEmpleo, aQueryPerfil,
  agregarCarrera, agregarPalabrasEmpleo, carrerasParaContar, conQueBuscar, esAlertaDePerfil, igualEmpleo, nombrePerfilEmpleo, paramsCalce, perfilDesdeCv, puestosSugeridos, respondidasPorCv,
  siguienteEmpleo, textoRespuestaEmpleo, textosMotivo, variantesDe, type PerfilEmpleo, type PreguntaEmpleo,
} from "@/lib/empleo-app/entrevista";
import { cn } from "@/lib/utils";
import { pedirCalce, usePerfilEmpleo, type CalceEmpleo } from "./usePerfilEmpleo";

const ICONO: Record<PreguntaEmpleo, typeof Bell> = {
  cv: FileUp, carrera: GraduationCap, estudios: School, experiencia: Timer, puestos: BriefcaseBusiness, lugar: MapPin, sueldo: Wallet, avisos: Bell,
};
const NOMBRE: Record<PreguntaEmpleo, string> = {
  cv: "Tu CV", carrera: "Carrera", estudios: "Estudios", experiencia: "Experiencia", puestos: "Puestos", lugar: "Dónde", sueldo: "Sueldo", avisos: "Avisos",
};
const regionDeSlug = (slug: string) => nombreRegion(slug.replace(/-/g, " ").toUpperCase());

const TIPOS_CV = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_CV = 4_000_000;

/** El archivo en base64. Una foto grande se achica (2000 px, JPG) para que pese menos de 4 MB y se lea más rápido. */
async function prepararCv(f: File): Promise<{ archivo: string; tipo: string }> {
  if (!TIPOS_CV.includes(f.type)) throw new Error("Sube tu CV en PDF o como foto (JPG o PNG).");
  let blob: Blob = f;
  let tipo = f.type;
  if (f.type.startsWith("image/") && f.size > 1_500_000) {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(img.width * k);
    lienzo.height = Math.round(img.height * k);
    lienzo.getContext("2d")?.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    blob = await new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No pude abrir la foto."))), "image/jpeg", 0.85));
    tipo = "image/jpeg";
  }
  if (blob.size > MAX_CV) throw new Error("Tu CV pesa más de 4 MB. Prueba con un PDF más liviano o con una foto.");
  const url = await new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(new Error("No pude abrir el archivo."));
    r.readAsDataURL(blob);
  });
  return { archivo: url.slice(url.indexOf(",") + 1), tipo };
}

/**
 * El onboarding de la app de Gobserva Empleo: una entrevista en forma de chat (2026-11-07; versión 2 el 2026-11-08,
 * cuando el usuario pidió «que pida su CV, su profesión…» porque «arquitecto» le recomendaba «Analista en arquitectura
 * Java»). Empieza ofreciendo leer el CV (Haiku propone las respuestas; no se guarda) y pregunta de a una: tu carrera (se
 * busca en la FORMACIÓN que pide cada plaza), tus estudios, tu experiencia, los puestos que te interesan (en el título, como
 * palabra entera), dónde, desde qué sueldo y cómo avisarte. Cada respuesta se toca o se escribe y se puede cambiar. Al lado,
 * el perfil con cuántas plazas abiertas calzan hoy (GET /empleo/calce, una consulta por respuesta). Al final, las tres más
 * afines; «Crear mi perfil» guarda la búsqueda «Mi perfil» y la alerta, y lleva a «Para ti».
 */
export function EntrevistaEmpleo({ base }: { base: string }) {
  const { user } = useSesion();
  const { me } = useMe("empleo");
  const perfilGuardado = usePerfilEmpleo();
  const menos = useMenosMovimiento();

  const [p, setP] = useState<PerfilEmpleo>(PERFIL_EMPLEO_VACIO);
  const [nombreTocado, setNombreTocado] = useState(false);
  const [conCv, setConCv] = useState(false);
  const [regionCv, setRegionCv] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [respondidas, setRespondidas] = useState<Set<PreguntaEmpleo>>(new Set());
  const [actual, setActual] = useState<PreguntaEmpleo | null>("cv");
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [otraRegion, setOtraRegion] = useState(false);
  const [rehacer, setRehacer] = useState(false);
  const [estado, setEstado] = useState<"entrevista" | "creando" | "listo">("entrevista");
  const [errorFinal, setErrorFinal] = useState<string | null>(null);
  const ancla = useRef<HTMLDivElement>(null);
  const archivo = useRef<HTMLInputElement>(null);

  const conDiaria = !!me?.producto?.limites?.frecuencias.includes("diaria");
  const tiene = !!perfilGuardado.perfil && !rehacer;
  const primerNombre = user?.displayName?.split(" ")[0];
  const correo = me?.cuenta.email ?? user?.email ?? "tu correo";
  const nombre = nombreTocado ? p.puesto : nombrePerfilEmpleo(p);

  // Una consulta por respuesta: el calce del perfil y, según la pregunta, cuántas hay de cada carrera o de cada puesto.
  // En los puestos, también cómo se llaman hoy las plazas de tu carrera (sugerir=1): la primera respuesta los trae y la
  // siguiente los cuenta con la misma regla que tus puestos.
  const extra: Record<string, string | number> = { size: 3 };
  if (actual === "carrera") extra.contar = carrerasParaContar(p.carreras);
  if (actual === "puestos") extra.sugerir = "1";
  const [reales, setReales] = useState<string[]>([]);
  const sugeridos = actual === "puestos" ? puestosSugeridos(p.carreras, p.palabras, reales) : [];
  const otras = sugeridos.filter((w) => !p.palabras.includes(w));
  const clave = useRetrasado(paramsCalce(p, otras, extra).toString(), 350);
  const calce = useSWR<CalceEmpleo>(/(^|&)(carreras|palabras|otras|contar|sugerir)=/.test(clave) ? ["onb-calce-empleo", clave] : null, () => pedirCalce(clave), {
    keepPreviousData: true,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const nuevosReales = calce.data?.sugeridos?.map((x) => x.puesto).join("|") ?? "";
  useEffect(() => {
    // Se suman (no se reemplazan): elegir uno lo saca de los sugeridos de la API, pero queda en la lista.
    if (actual === "puestos" && nuevosReales) setReales((xs) => [...new Set([...xs, ...nuevosReales.split("|")])]);
  }, [actual, nuevosReales]);
  useEffect(() => {
    // Otra carrera, otros puestos reales.
    setReales([]);
  }, [p.carreras.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const nPuesto = (w: string) => calce.data?.porPalabra.find((x) => x.palabra === w)?.n;
  const nCarrera = (c: string) => {
    const v = variantesDe(c)[0];
    return [...(calce.data?.porCarrera ?? []), ...(calce.data?.otrasCarreras ?? [])].find((x) => igualEmpleo(x.variantes[0] ?? "", v))?.n;
  };
  const cuenta = (n: number | undefined) =>
    n == null ? (calce.isValidating ? <Loader2 size={12} aria-label="Contando" className="animate-spin" /> : undefined) : n === 0 ? "ninguna hoy" : `${numero(n)} hoy`;

  const vuelta = !!actual && respondidas.has(actual);
  const escribiendo = useEscribiendo(`${actual ?? "fin"}:${vuelta ? "cambio" : "nueva"}`, !vuelta);

  useEffect(() => {
    if (escribiendo) return;
    ancla.current?.scrollIntoView({ behavior: menos ? "auto" : "smooth", block: "start" });
  }, [escribiendo, actual, menos]);

  const cambiar = (c: Partial<PerfilEmpleo>) => {
    setP((x) => ({ ...x, ...c }));
    setError(null);
  };

  function responder(q: PreguntaEmpleo, cambios: Partial<PerfilEmpleo> = {}) {
    const nuevas = new Set(respondidas).add(q);
    setP((x) => ({ ...x, ...cambios }));
    setRespondidas(nuevas);
    setTexto("");
    setError(null);
    setOtraRegion(false);
    setActual(siguienteEmpleo(nuevas, q));
  }

  function volverA(q: PreguntaEmpleo) {
    setActual(q);
    setTexto("");
    setError(null);
    setErrorFinal(null);
    if (q === "lugar") setOtraRegion(!!p.region && p.region !== "lima");
  }

  async function subirCv(f: File | undefined) {
    if (!f) return;
    setError(null);
    setLeyendo(true);
    try {
      const r = await leerCvEmpleo(await prepararCv(f));
      const n = perfilDesdeCv(p, r.cv);
      const nuevas = new Set<PreguntaEmpleo>([...respondidas, ...respondidasPorCv(r.cv)]);
      setP(n);
      setConCv(true);
      setRegionCv(r.cv.region);
      setRespondidas(nuevas);
      setOtraRegion(false);
      setActual(siguienteEmpleo(nuevas, "cv"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude leer tu CV. Prueba con otro archivo o responde tú las preguntas.");
    } finally {
      setLeyendo(false);
      if (archivo.current) archivo.current.value = "";
    }
  }

  function enviarTexto() {
    const t = texto.trim();
    if (actual === "carrera") {
      if (p.carreras.length >= MAX_CARRERAS) return setError(`Ya tienes ${MAX_CARRERAS} carreras: quita alguna para sumar otra.`);
      const n = agregarCarrera(p.carreras, t);
      if (n.length === p.carreras.length) return setError("Esa ya está o es muy corta.");
      cambiar({ carreras: n });
      setTexto("");
    }
    if (actual === "puestos") {
      if (p.palabras.length >= MAX_PALABRAS_EMPLEO) return setError(`Ya tienes ${MAX_PALABRAS_EMPLEO} puestos: quita alguno para sumar otro.`);
      const n = agregarPalabrasEmpleo(p.palabras, t);
      if (n.length === p.palabras.length) return setError("Ese ya está o es muy corto.");
      cambiar({ palabras: n });
      setTexto("");
    }
  }

  async function crear() {
    setEstado("creando");
    setErrorFinal(null);
    const perfil = { ...p, puesto: nombre.trim() || "Mi perfil" };
    try {
      // Una sola «Mi perfil» por cuenta: la de antes se reemplaza.
      if (perfilGuardado.id != null) await borrarBusqueda(perfilGuardado.id);
      await crearBusqueda({ producto: "empleo", nombre: NOMBRE_PERFIL, query: aQueryPerfil(perfil) });
    } catch (e) {
      setEstado("entrevista");
      return setErrorFinal(e instanceof ErrorCuenta ? e.message : "No pude guardar tu perfil. Vuelve a intentarlo.");
    }
    if (perfil.alerta && conQueBuscar(perfil)) {
      try {
        const a = aAlertaEmpleo(perfil);
        const frecuencia = conDiaria ? perfil.frecuencia : "semanal";
        // Al rehacer el perfil, su alerta se pone al día (no queda la de antes ni se crea otra que no entra en el plan).
        const previa = (await cargarAlertas("empleo").catch(() => ({ data: [] }))).data.find(esAlertaDePerfil);
        if (previa) await cambiarAlerta(previa.id, { nombre: a.nombre, filtros: a.filtros, frecuencia, activa: true });
        else await crearAlerta({ producto: "empleo", nombre: a.nombre, filtros: a.filtros, frecuencia });
      } catch {
        // Sin cupo de alertas (el plan gratis tiene una): el perfil igual queda; la alerta se arma desde Alertas.
      }
    }
    setEstado("listo");
    void perfilGuardado.mutate();
    window.setTimeout(() => window.location.assign(rutaEn(base, "/app/para-ti")), menos ? 0 : 900);
  }

  const textoDe = (q: PreguntaEmpleo) => textoRespuestaEmpleo(q, p, regionDeSlug, conCv);

  function pregunta(q: PreguntaEmpleo): ReactNode {
    switch (q) {
      case "cv":
        return (
          <>
            <strong className="font-semibold">¿Me pasas tu CV?</strong> Lo leo y te propongo las respuestas: tu carrera, tus estudios, tu experiencia y los puestos que te calzan. Tú las revisas. Si prefieres, respondes tú.
          </>
        );
      case "carrera":
        return (
          <>
            {conCv && (
              <span className="mb-1 block">
                {respondidas.has("carrera") ? "Leí tu CV y te propongo estas respuestas. Si alguna no está bien, toca «Cambiar»." : "Leí tu CV, pero no encontré tu carrera."}
              </span>
            )}
            <strong className="font-semibold">¿Cuál es tu profesión o carrera?</strong> Cada plaza pide una formación: con tu carrera te muestro sólo a las que puedes postular. Elige hasta {MAX_CARRERAS} o escríbela abajo.
          </>
        );
      case "estudios":
        return (
          <>
            {calce.data && calce.data.total > 0 && respondidas.has("carrera") && p.carreras.length > 0 && !conCv && (
              <span className="mb-1 block">Hoy hay <strong className="font-semibold tabular-nums">{numero(calce.data.total)}</strong> plazas abiertas que piden tu carrera.</span>
            )}
            <strong className="font-semibold">¿Cuál es tu grado más alto?</strong> El que ya tienes. Te muestro las plazas que piden eso o menos.
          </>
        );
      case "experiencia":
        return (
          <>
            <strong className="font-semibold">¿Cuántos años de experiencia tienes?</strong> En el trabajo que sea: casi todas las plazas piden experiencia general.
          </>
        );
      case "puestos":
        return p.carreras.length ? (
          <>
            <strong className="font-semibold">¿Qué puestos te interesan?</strong> Así se llaman hoy las plazas que piden tu carrera; los que elijas van primero.
            {conCv && p.palabras.length > 0 && " Marqué los de tu CV."} Es opcional: si no eliges, te muestro todas las de tu carrera.
          </>
        ) : (
          <>
            <strong className="font-semibold">¿Qué puestos buscas?</strong> Sin una carrera, busco por el nombre del puesto. Elige al menos uno o escríbelo abajo.
          </>
        );
      case "lugar":
        return (
          <>
            <strong className="font-semibold">¿Dónde quieres trabajar?</strong>
            {conCv && regionCv && <> Tu CV dice que vives en {regionDeSlug(regionCv)}.</>}
          </>
        );
      case "sueldo":
        return (
          <>
            <strong className="font-semibold">¿Cuánto es lo mínimo que aceptarías al mes?</strong> Las plazas CAS publican su sueldo.
          </>
        );
      case "avisos":
        return (
          <>
            <strong className="font-semibold">Última: ¿te aviso cuando salga una plaza que calce contigo?</strong> Te llega a {correo} y queda en tu cuenta.
          </>
        );
    }
  }

  function respuestas(q: PreguntaEmpleo): ReactNode {
    switch (q) {
      case "cv":
        return (
          <Respuestas etiqueta="Tu CV">
            <input ref={archivo} type="file" accept={TIPOS_CV.join(",")} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void subirCv(e.target.files?.[0])} />
            <div className="flex flex-wrap gap-2">
              <Opcion principal disabled={leyendo} onClick={() => archivo.current?.click()} icono={leyendo ? <Loader2 size={15} aria-hidden className="animate-spin" /> : <FileUp size={15} aria-hidden />}>
                {leyendo ? "Leyendo tu CV…" : "Subir mi CV"}
              </Opcion>
              <Opcion disabled={leyendo} onClick={() => responder("cv")} icono={<MessageSquareText size={15} aria-hidden className="text-inkSoft" />}>
                Prefiero responder yo
              </Opcion>
            </div>
            {error && <p role="alert" className="mt-3 rounded-lg border border-crimson/30 bg-crimson-soft px-3 py-2 text-dato font-medium text-crimsonTexto">{error}</p>}
            <p className="mt-3 flex items-start gap-2 text-meta text-mute">
              <ShieldCheck size={14} aria-hidden className="mt-0.5 shrink-0" />
              <span>PDF o foto, hasta 4 MB. No lo guardo: lo leo una vez, tomo tu carrera, estudios, experiencia, puestos y región, y lo descarto. Ni tu nombre ni tus datos de contacto.</span>
            </p>
          </Respuestas>
        );
      case "carrera": {
        const propias = p.carreras.filter((c) => !CARRERAS.some((x) => igualEmpleo(x.nombre, c)));
        const fichas = [...propias, ...CARRERAS.map((c) => c.nombre)];
        return (
          <Respuestas etiqueta="Tu carrera">
            <div className="flex flex-wrap gap-2">
              {fichas.map((c) => {
                const si = p.carreras.some((x) => igualEmpleo(x, c));
                return (
                  <Opcion
                    key={c}
                    multiple
                    activa={si}
                    onClick={() => cambiar({ carreras: si ? p.carreras.filter((x) => !igualEmpleo(x, c)) : p.carreras.length >= MAX_CARRERAS ? p.carreras : [...p.carreras, c] })}
                    detalle={cuenta(nCarrera(c))}
                  >
                    {c}
                  </Opcion>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Opcion principal disabled={p.carreras.length === 0} onClick={() => responder("carrera")} icono={<Check size={15} aria-hidden />}>
                {p.carreras.length === 0 ? "Elige tu carrera" : `Listo, sigo con ${p.carreras.length === 1 ? "esta" : `estas ${p.carreras.length}`}`}
              </Opcion>
              <Opcion onClick={() => responder("carrera", { carreras: [] })}>No tengo una carrera</Opcion>
              <span className="text-meta text-mute">{p.carreras.length} de {MAX_CARRERAS}</span>
            </div>
          </Respuestas>
        );
      }
      case "estudios":
        return (
          <Respuestas etiqueta="Tus estudios">
            <div className="flex flex-wrap gap-2">
              {ESTUDIOS.map((e) => (
                <Opcion key={e.valor} activa={respondidas.has("estudios") && p.tengo === e.valor} onClick={() => responder("estudios", { tengo: e.valor })}>
                  {e.etiqueta}
                </Opcion>
              ))}
            </div>
          </Respuestas>
        );
      case "experiencia":
        return (
          <Respuestas etiqueta="Tu experiencia">
            <div className="flex flex-wrap gap-2">
              {EXPERIENCIAS.map((e) => (
                <Opcion key={e.etiqueta} activa={respondidas.has("experiencia") && p.exp === e.valor} onClick={() => responder("experiencia", { exp: e.valor })}>
                  {e.etiqueta}
                </Opcion>
              ))}
            </div>
          </Respuestas>
        );
      case "puestos": {
        const sinCarrera = p.carreras.length === 0;
        return (
          <Respuestas etiqueta="Puestos que te interesan">
            <div className="flex flex-wrap gap-2">
              {sugeridos.map((w) => {
                const si = p.palabras.includes(w);
                return (
                  <Opcion
                    key={w}
                    multiple
                    activa={si}
                    onClick={() => cambiar({ palabras: si ? p.palabras.filter((x) => x !== w) : p.palabras.length >= MAX_PALABRAS_EMPLEO ? p.palabras : [...p.palabras, w] })}
                    detalle={cuenta(nPuesto(w))}
                  >
                    {w}
                  </Opcion>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Opcion principal disabled={sinCarrera && p.palabras.length === 0} onClick={() => responder("puestos")} icono={<Check size={15} aria-hidden />}>
                {p.palabras.length === 0 ? (sinCarrera ? "Elige al menos uno" : "Cualquiera de mi carrera") : `Listo, sigo con ${p.palabras.length === 1 ? "este" : `estos ${p.palabras.length}`}`}
              </Opcion>
              <span className="text-meta text-mute">{p.palabras.length} de {MAX_PALABRAS_EMPLEO}</span>
            </div>
          </Respuestas>
        );
      }
      case "lugar":
        return (
          <Respuestas etiqueta="Dónde">
            <div className="flex flex-wrap gap-2">
              <Opcion activa={respondidas.has("lugar") && !p.region} onClick={() => responder("lugar", { region: null })}>Todo el Perú</Opcion>
              <Opcion activa={(respondidas.has("lugar") || regionCv === "lima") && p.region === "lima"} onClick={() => responder("lugar", { region: "lima" })}>Lima</Opcion>
              {regionCv && regionCv !== "lima" && (
                <Opcion activa={p.region === regionCv} onClick={() => responder("lugar", { region: regionCv })}>{regionDeSlug(regionCv)}</Opcion>
              )}
              <Opcion activa={otraRegion} onClick={() => setOtraRegion((x) => !x)} icono={<MapPin size={15} aria-hidden className="text-inkSoft" />}>
                Otra región
              </Opcion>
            </div>
            {otraRegion && (
              <div className="mt-3 rounded-2xl border border-line bg-caja p-3 shadow-caja motion-safe:animate-fadeIn">
                <div className="flex flex-wrap gap-1.5">
                  {REGIONES_EMPLEO.filter((r) => r !== "LIMA").map((r) => (
                    <Opcion key={r} activa={p.region === slugRegion(r)} onClick={() => responder("lugar", { region: slugRegion(r) })} className="min-h-9 px-3 text-meta">
                      {nombreRegion(r)}
                    </Opcion>
                  ))}
                </div>
              </div>
            )}
          </Respuestas>
        );
      case "sueldo":
        return (
          <Respuestas etiqueta="Sueldo mínimo">
            <div className="flex flex-wrap gap-2">
              {SUELDOS.map((s) => (
                <Opcion key={s.etiqueta} activa={respondidas.has("sueldo") && p.sueldo === s.valor} onClick={() => responder("sueldo", { sueldo: s.valor })}>
                  {s.etiqueta}
                </Opcion>
              ))}
            </div>
          </Respuestas>
        );
      case "avisos":
        return (
          <Respuestas etiqueta="Avisos">
            <div className="flex flex-wrap gap-2">
              <Opcion disabled={!conDiaria} onClick={() => responder("avisos", { alerta: true, frecuencia: "diaria" })} icono={<CalendarClock size={15} aria-hidden className="text-inkSoft" />} detalle={!conDiaria ? "con un plan" : undefined}>
                Sí, cada mañana
              </Opcion>
              <Opcion onClick={() => responder("avisos", { alerta: true, frecuencia: "semanal" })} icono={<Bell size={15} aria-hidden className="text-inkSoft" />}>
                Sí, cada semana
              </Opcion>
              <Opcion onClick={() => responder("avisos", { alerta: false })} icono={<BellOff size={15} aria-hidden className="text-inkSoft" />}>
                No, yo entro a mirar
              </Opcion>
            </div>
          </Respuestas>
        );
    }
  }

  const visibles = PREGUNTAS_EMPLEO.filter((q) => respondidas.has(q) || q === actual);
  const textoActivo = actual === "carrera" || actual === "puestos";
  const progreso = respondidas.size;
  const total = PREGUNTAS_EMPLEO.length;
  const hayPerfil = conQueBuscar(p);

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-lienzo">
      <header className="sticky top-0 z-20 border-b border-line bg-caja/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <MarcaGobserva producto="empleo" tamano="sm" />
          <Link href={rutaEn(base, "/app/plazas")} className="text-dato font-semibold text-inkSoft underline-offset-4 hover:text-ink hover:underline">
            Saltar por ahora
          </Link>
        </div>
        {!tiene && !perfilGuardado.cargando && (
          <div className="mx-auto max-w-6xl px-4 pb-3 sm:px-6">
            <div className="flex items-center gap-3">
              <ol className="flex flex-1 gap-1.5" aria-label={`${progreso} de ${total} respuestas`}>
                {PREGUNTAS_EMPLEO.map((q) => (
                  <li key={q} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-normal", respondidas.has(q) ? "bg-granate" : q === actual ? "bg-granate/40" : "bg-ink/10")} />
                ))}
              </ol>
              <span className="shrink-0 text-meta font-semibold tabular-nums text-inkSoft">{progreso} de {total}</span>
              {hayPerfil && calce.data && (
                <span className="shrink-0 rounded-full bg-granate-50 px-2.5 py-0.5 text-meta font-semibold tabular-nums text-ink lg:hidden">{numero(calce.data.total)} calzan</span>
              )}
            </div>
          </div>
        )}
      </header>

      <div className={cn("mx-auto max-w-6xl px-4 sm:px-6", !tiene && "lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-10")}>
        <div className="mx-auto flex min-h-[calc(100dvh-6rem)] w-full min-w-0 max-w-2xl flex-col">
          <div className="flex-1 pb-6 pt-8">
            {perfilGuardado.cargando ? (
              <Escribiendo />
            ) : tiene ? (
              <Conversacion etiqueta="Conversación con Gobserva">
                <MensajeBot>
                  Hola{primerNombre ? `, ${primerNombre}` : ""}. Ya tienes tu perfil <strong className="font-semibold">«{perfilGuardado.perfil!.puesto || "Mi perfil"}»</strong>: tus plazas están en «Para ti», primero las más afines a tu carrera.
                  {perfilGuardado.perfil!.carreras.length === 0 && (
                    <span className="mt-1 block">Tu perfil es de antes y no tiene tu carrera: rehazlo para ver sólo las plazas a las que puedes postular.</span>
                  )}
                </MensajeBot>
                <Respuestas etiqueta="Qué quieres hacer">
                  <div className="flex flex-wrap gap-2">
                    <Link href={rutaEn(base, "/app/para-ti")} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-granate bg-granate px-4 text-dato font-semibold text-paper hover:bg-granate-deep">
                      Ver mis plazas <ArrowRight size={15} aria-hidden />
                    </Link>
                    <Opcion onClick={() => setRehacer(true)} icono={<RotateCcw size={15} aria-hidden className="text-inkSoft" />}>Rehacer mi perfil</Opcion>
                  </div>
                </Respuestas>
              </Conversacion>
            ) : (
              <Conversacion etiqueta="Entrevista para armar tu perfil">
                <MensajeBot>
                  Hola{primerNombre ? `, ${primerNombre}` : ""}. Soy el asistente de Gobserva Empleo. Con tu CV o con <strong className="font-semibold">unas preguntas rápidas</strong> te muestro las plazas del Estado a las que puedes postular hoy.
                </MensajeBot>
                {visibles.map((q) => {
                  const enCurso = q === actual;
                  if (enCurso && escribiendo) return <Escribiendo key={q} />;
                  return (
                    <div key={q} className="space-y-3">
                      <MensajeBot ref={enCurso ? ancla : undefined} sinAvatar={q === "cv"}>{pregunta(q)}</MensajeBot>
                      {enCurso ? respuestas(q) : <MensajeTuyo onCambiar={estado === "entrevista" ? () => volverA(q) : undefined} etiquetaCambiar={`Cambiar: ${NOMBRE[q]}`}>{textoDe(q)}</MensajeTuyo>}
                    </div>
                  );
                })}
                {actual === null &&
                  (escribiendo ? (
                    <Escribiendo />
                  ) : (
                    <Final
                      ref={ancla}
                      p={p}
                      nombre={nombre}
                      calce={calce.data}
                      cargando={calce.isLoading || calce.isValidating}
                      estado={estado}
                      error={errorFinal}
                      onNombre={(x) => {
                        setNombreTocado(true);
                        cambiar({ puesto: x });
                      }}
                      onCrear={crear}
                    />
                  ))}
              </Conversacion>
            )}
          </div>

          {!tiene && estado === "entrevista" && actual !== null && actual !== "cv" && !perfilGuardado.cargando && (
            <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-lienzo via-lienzo to-lienzo/0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:-mx-6 sm:px-6">
              <Compositor
                valor={texto}
                onCambio={(v) => {
                  setTexto(v);
                  setError(null);
                }}
                onEnviar={textoActivo && !escribiendo ? enviarTexto : undefined}
                etiqueta={actual === "puestos" ? "Suma otro puesto" : "Escribe tu carrera"}
                placeholder={
                  actual === "carrera" ? "O escríbela: ingeniería pesquera, nutrición…" : actual === "puestos" ? "Suma otro puesto: asistente de archivo, cajero…" : "Toca una de las respuestas de arriba"
                }
                error={error}
                maxLength={120}
              />
            </div>
          )}
        </div>

        {!tiene && !perfilGuardado.cargando && (
          <aside aria-label="Tu perfil" className="hidden lg:block">
            <div className="sticky top-32 pt-8">
              <section className="rounded-2xl border border-line bg-caja shadow-caja">
                <div className="border-b border-line px-5 py-4">
                  <h2 className="font-display text-bloque font-bold text-ink">Tu perfil</h2>
                  <p className="mt-0.5 text-meta text-inkSoft">{conCv ? "Lo propuse con tu CV; cambia lo que quieras" : "Se arma con tus respuestas"}</p>
                </div>
                <ul className="divide-y divide-line">
                  {PREGUNTAS_EMPLEO.filter((q) => q !== "cv").map((q) => {
                    const Icono = ICONO[q];
                    const listo = respondidas.has(q);
                    return (
                      <li key={q} className={cn("flex items-start gap-3 px-5 py-3", q === actual && "bg-granate-50/60")}>
                        <span aria-hidden className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", listo ? "bg-granate text-paper" : "bg-ink/[0.06] text-mute")}>
                          {listo ? <Check size={14} strokeWidth={3} /> : <Icono size={14} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-meta font-semibold text-mute">{NOMBRE[q]}</p>
                          <p className={cn("text-dato [overflow-wrap:anywhere]", listo ? "font-medium text-ink" : "text-mute")}>
                            {listo ? textoDe(q) : q === actual ? "Respondiendo…" : "Falta"}
                          </p>
                        </div>
                        {listo && estado === "entrevista" && q !== actual && (
                          <button type="button" onClick={() => volverA(q)} className="shrink-0 rounded-md px-1.5 py-1 text-meta font-semibold text-mute hover:bg-ink/[0.05] hover:text-ink" aria-label={`Cambiar: ${NOMBRE[q]}`}>
                            Cambiar
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="rounded-b-2xl border-t border-line bg-ink/[0.025] px-5 py-4">
                  <p className="text-meta font-semibold text-inkSoft">Calzan hoy contigo</p>
                  {!hayPerfil ? (
                    <p className="mt-1 text-dato text-mute">Cuando me digas tu carrera, te digo cuántas plazas abiertas la piden.</p>
                  ) : (
                    <p className="mt-1 flex items-baseline gap-2">
                      <span className="font-display text-cifra font-bold tabular-nums text-ink">{calce.data ? numero(calce.data.total) : "…"}</span>
                      <span className="text-dato text-inkSoft">plazas abiertas</span>
                      {calce.isValidating && <Loader2 size={14} aria-label="Actualizando" className="animate-spin self-center text-mute" />}
                    </p>
                  )}
                </div>
              </section>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/** El cierre: cuántas calzan y las tres más afines; el nombre del perfil y «Crear mi perfil». */
const Final = forwardRef<HTMLDivElement, {
  p: PerfilEmpleo;
  nombre: string;
  calce: CalceEmpleo | undefined;
  cargando: boolean;
  estado: "entrevista" | "creando" | "listo";
  error: string | null;
  onNombre: (x: string) => void;
  onCrear: () => void;
}>(function Final({ p, nombre, calce, cargando, estado, error, onNombre, onCrear }, ref) {
  const total = calce?.total ?? null;
  const vistazo = calce?.data ?? [];
  return (
    <div className="space-y-3">
      <MensajeBot ref={ref} ancho>
        {total == null || cargando ? (
          <span className="inline-flex items-center gap-2 text-inkSoft"><Loader2 size={15} aria-hidden className="animate-spin" /> Buscando las plazas que calzan contigo…</span>
        ) : total > 0 ? (
          <>
            <strong className="font-semibold">Listo.</strong> Con tu perfil hoy calzan <strong className="font-semibold tabular-nums">{numero(total)}</strong> plazas abiertas. Estas son las más afines:
          </>
        ) : (
          <>
            <strong className="font-semibold">Listo.</strong> Hoy no hay plazas abiertas con ese perfil. Igual lo guardo y te aviso cuando salga una; también puedes cambiar tus respuestas arriba.
          </>
        )}
        {vistazo.length > 0 && !cargando && (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
            {vistazo.map((x) => (
              <li key={x.aviso} className="flex items-start justify-between gap-3 bg-lienzo/50 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-dato font-semibold text-ink">{puestoLegible(x.titulo)}</p>
                  <p className="mt-1 truncate text-meta text-inkSoft">{entidadNombre(x.entidad)}</p>
                  {textosMotivo(x.motivo, p.carreras).length > 0 && (
                    <p className="mt-1 inline-flex max-w-full items-center gap-1 text-meta font-medium text-granate">
                      <BadgeCheck size={13} aria-hidden className="shrink-0" />
                      <span className="min-w-0 truncate">{textosMotivo(x.motivo, p.carreras).join(". ")}</span>
                    </p>
                  )}
                  <p className="mt-1 inline-flex items-center gap-1 text-meta font-semibold text-amberTexto">
                    <Timer size={13} aria-hidden /> {textoCierre(diasParaCierre(x.fechaFin))}
                  </p>
                </div>
                <p className="shrink-0 text-right text-dato font-bold tabular-nums text-ink">
                  {x.remuneracion ? soles(x.remuneracion) : <span className="text-meta font-medium text-mute">Sin dato</span>}
                  {x.remuneracion ? <span className="block text-rotulo font-medium text-mute">al mes</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </MensajeBot>
      <MensajeBot sinAvatar ancho>
        <p className="font-semibold">Así quedó tu perfil.</p>
        <label htmlFor="onb-puesto-final" className="mt-2 block text-dato text-inkSoft">¿Cómo lo llamo?</label>
        <input
          id="onb-puesto-final"
          value={nombre}
          maxLength={60}
          disabled={estado !== "entrevista"}
          onChange={(e) => onNombre(e.target.value)}
          placeholder={p.carreras[0] ?? "Asistente administrativo"}
          className="mt-1.5 h-11 w-full rounded-lg border border-line bg-caja px-3.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
        />
        {error && <p role="alert" className="mt-3 rounded-lg border border-crimson/30 bg-crimson-soft px-3 py-2 text-dato font-medium text-crimsonTexto">{error}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCrear}
            disabled={estado !== "entrevista"}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-granate px-5 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:opacity-60"
          >
            {estado === "entrevista" ? <Sparkles size={16} aria-hidden /> : <Loader2 size={16} aria-hidden className="animate-spin" />}
            {estado === "listo" ? "Te llevo a tus plazas…" : estado === "creando" ? "Guardando tu perfil…" : "Crear mi perfil"}
          </button>
          <span className="text-meta text-mute">Guardo tu perfil{p.alerta ? " y tu alerta" : ""}, y te muestro tus plazas.</span>
        </div>
      </MensajeBot>
    </div>
  );
});
