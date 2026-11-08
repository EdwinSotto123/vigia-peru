"use client";

import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowRight, Bell, BellOff, Building2, CalendarClock, Check, HardHat, KeyRound, Loader2, MapPin, Package, PencilLine, Plus, Sparkles, Tag, Wallet, Wrench,
} from "lucide-react";
import { MarcaGobserva } from "@/components/gobserva/MarcaGobserva";
import { Compositor, Conversacion, Escribiendo, MensajeBot, MensajeTuyo, Opcion, Respuestas, useEscribiendo, useMenosMovimiento, useRetrasado } from "@/components/gobserva/app/chat/Chat";
import { useMe, useSesion } from "@/components/gobserva/cuenta/comun";
import { API_PUBLICA } from "@/lib/api-client";
import { rutaEn } from "@/lib/gobserva";
import { ErrorCuenta, cargarLineas, crearAlerta, crearBusqueda, crearLinea } from "@/lib/gobserva-cuenta";
import { REGIONES_UBIGEO, limpiar, nombreRegion } from "@/lib/licitaciones";
import { numero } from "@/lib/formato";
import { TIPOS_PROCESO, type TipoProceso } from "@/lib/licitaciones-app/filtros";
import { vencimiento } from "@/lib/licitaciones-app/formato";
import { MAX_PALABRAS, PERFIL_VACIO, aAlerta, aQueryBandeja, agregarPalabras, type PerfilEmpresa } from "@/lib/licitaciones-app/onboarding";
import {
  LIMA_CALLAO, NOMBRE_TIPO, PREGUNTAS, RANGOS, RUBROS, alternarPalabra, candidatas, perfilDesdeRubro, perfilDesdeTexto, siguientePendiente, textoRespuesta,
  type Pregunta, type Rubro,
} from "@/lib/licitaciones-app/entrevista";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";

/** Lo que devuelve GET /licitaciones/bandeja/calce. */
interface Calce {
  total: number;
  porPalabra: { palabra: string; n: number }[];
  vistazo: { ocid: string; objeto: string | null; entidad: string | null; consultasHasta: string | null; valor: number | null }[];
}

/** Cuántas abiertas calzan hoy con el perfil (una sola consulta por respuesta, retrasada mientras tocas). */
function useCalce(p: PerfilEmpresa, otras: string[]) {
  const params = new URLSearchParams();
  if (p.palabras.length) params.set("palabras", p.palabras.join("|"));
  if (otras.length) params.set("otras", otras.join("|"));
  if (p.tipos.length) params.set("tipo", p.tipos.join(","));
  if (p.regiones.length) params.set("region", p.regiones.join(","));
  if (p.min != null) params.set("min", String(p.min));
  if (p.max != null) params.set("max", String(p.max));
  const clave = useRetrasado(params.toString(), 350);
  return useSWR<Calce>(
    clave.includes("palabras=") || clave.includes("otras=") ? ["onb-calce", clave] : null,
    async () => {
      const r = await fetch(`${API_PUBLICA}/licitaciones/bandeja/calce?${clave}`);
      if (!r.ok) throw new Error("sin calce");
      return r.json();
    },
    { keepPreviousData: true, revalidateOnFocus: false, shouldRetryOnError: false },
  );
}

const ICONO_TIPO: Record<TipoProceso, typeof Package> = { bienes: Package, servicios: Wrench, obras: HardHat, consultoria: Building2 };

const PREGUNTA_ICONO: Record<Pregunta, typeof Package> = { rubro: Tag, palabras: KeyRound, tipos: Package, lugar: MapPin, monto: Wallet, avisos: Bell };
const PREGUNTA_NOMBRE: Record<Pregunta, string> = { rubro: "Vendes", palabras: "Palabras clave", tipos: "Contratos", lugar: "Dónde", monto: "Tamaño", avisos: "Avisos" };

/**
 * El onboarding de la app como entrevista (2026-11-07): el asistente pregunta de a una (qué vendes, con qué palabras,
 * qué contratos, dónde, de qué tamaño y cómo avisarte), cada respuesta se toca (o se escribe), cada una se puede
 * cambiar y, al lado, el perfil se arma con cuántas convocatorias abiertas calzan hoy (GET /bandeja/calce). Al final
 * muestra las tres que cierran primero y crea la línea de negocio («Para ti»), la alerta y la búsqueda «Mi empresa».
 */
export function Entrevista({ base }: { base: string }) {
  const { user } = useSesion();
  const { me } = useMe("licitaciones");
  const lineas = useSWR(["gobserva-lineas"], () => cargarLineas(), { revalidateOnFocus: false });
  const menos = useMenosMovimiento();

  const [p, setP] = useState<PerfilEmpresa>(PERFIL_VACIO);
  const [rubro, setRubro] = useState<Rubro | null>(null);
  const [respondidas, setRespondidas] = useState<Set<Pregunta>>(new Set());
  const [actual, setActual] = useState<Pregunta | null>("rubro");
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [regionesAbiertas, setRegionesAbiertas] = useState(false);
  const [rangoPropio, setRangoPropio] = useState(false);
  const [rehacer, setRehacer] = useState(false);
  const [estado, setEstado] = useState<"entrevista" | "creando" | "listo">("entrevista");
  const [errorFinal, setErrorFinal] = useState<string | null>(null);
  const anclaActual = useRef<HTMLDivElement>(null);

  const conDiaria = !!me?.producto?.limites?.frecuencias.includes("diaria");
  const tiene = (lineas.data?.data.length ?? 0) > 0 && !rehacer;
  const primerNombre = user?.displayName?.split(" ")[0];
  const correo = me?.cuenta.email ?? user?.email ?? "tu correo";

  const fichas = actual === "palabras" ? candidatas(p, rubro) : [];
  const otras = fichas.filter((w) => !p.palabras.includes(w));
  const calce = useCalce(p, otras);
  const nPalabra = (w: string) => calce.data?.porPalabra.find((x) => x.palabra === w)?.n;

  // Los puntos de «escribiendo» antes de cada pregunta nueva (no al volver a una ya respondida).
  const vuelta = !!actual && respondidas.has(actual);
  const escribiendo = useEscribiendo(`${actual ?? "fin"}:${vuelta ? "cambio" : "nueva"}`, !vuelta);

  // La pregunta en curso, a la vista (arriba, para que se vean sus respuestas).
  useEffect(() => {
    if (escribiendo) return;
    anclaActual.current?.scrollIntoView({ behavior: menos ? "auto" : "smooth", block: "start" });
  }, [escribiendo, actual, menos]);

  const cambiar = (c: Partial<PerfilEmpresa>) => {
    setP((x) => ({ ...x, ...c }));
    setError(null);
  };

  function responder(q: Pregunta, cambios: Partial<PerfilEmpresa> = {}) {
    const nuevas = new Set(respondidas).add(q);
    setP((x) => ({ ...x, ...cambios }));
    setRespondidas(nuevas);
    setTexto("");
    setError(null);
    setRegionesAbiertas(false);
    setRangoPropio(false);
    setActual(siguientePendiente(nuevas, q));
  }

  function volverA(q: Pregunta) {
    setActual(q);
    setTexto("");
    setError(null);
    setErrorFinal(null);
    if (q === "lugar") setRegionesAbiertas(p.regiones.length > 0 && !(p.regiones.length === 2 && LIMA_CALLAO.every((u) => p.regiones.includes(u))));
    if (q === "monto") setRangoPropio(!RANGOS.some((r) => r.min === p.min && r.max === p.max));
  }

  function elegirRubro(r: Rubro) {
    const n = perfilDesdeRubro(p, r);
    setRubro(r);
    responder("rubro", n);
  }

  function enviarTexto() {
    const t = texto.trim();
    if (actual === "rubro") {
      if (t.length < 10 || t.split(/\s+/).length < 2) return setError("Cuéntame un poco más: qué vendes, en una frase.");
      const n = perfilDesdeTexto(p, t);
      setRubro(null);
      return responder("rubro", n);
    }
    if (actual === "palabras") {
      if (p.palabras.length >= MAX_PALABRAS) return setError(`Ya tienes ${MAX_PALABRAS} palabras: quita alguna para sumar otra.`);
      const n = agregarPalabras(p.palabras, t);
      if (n.length === p.palabras.length) return setError("Esa ya está o es muy corta.");
      cambiar({ palabras: n });
      setTexto("");
    }
  }

  async function crear() {
    setEstado("creando");
    setErrorFinal(null);
    try {
      await crearLinea({ nombre: p.nombre.trim() || "Mi empresa", descripcion: p.descripcion.trim(), palabras: p.palabras, regiones: p.regiones, tipos: p.tipos, montoMin: p.min, montoMax: p.max });
    } catch (e) {
      setEstado("entrevista");
      return setErrorFinal(e instanceof ErrorCuenta ? e.message : "No pude guardar tu perfil. Vuelve a intentarlo.");
    }
    if (p.alerta) {
      try {
        const a = aAlerta(p);
        await crearAlerta({ producto: "licitaciones", nombre: a.nombre, filtros: a.filtros, frecuencia: conDiaria ? p.frecuencia : "semanal" });
      } catch {
        // Sin cupo de alertas (el plan gratis tiene una): el perfil igual queda; la alerta se arma desde Alertas.
      }
    }
    try {
      await crearBusqueda({ producto: "licitaciones", nombre: "Mi empresa", query: aQueryBandeja(p) });
    } catch {
      // Ya había una búsqueda «Mi empresa»: se queda la que estaba.
    }
    setEstado("listo");
    void lineas.mutate();
    // Entrar de verdad a la app (el marco de la cuenta), no un cambio de ruta dentro de esta pantalla.
    window.setTimeout(() => window.location.assign(rutaEn(base, "/cuenta?tab=para-ti")), menos ? 0 : 900);
  }

  const region = (u: string) => nombreRegion(u);
  const textoDe = (q: Pregunta) => textoRespuesta(q, p, region, rubro);

  /** Lo que pregunta el asistente en cada paso. */
  function pregunta(q: Pregunta): ReactNode {
    switch (q) {
      case "rubro":
        return (
          <>
            <strong className="font-semibold">¿Qué vende tu empresa?</strong> Elige tu rubro o cuéntamelo con tus palabras abajo.
          </>
        );
      case "palabras":
        return rubro ? (
          <>
            Con estas palabras busco <strong className="font-semibold">{rubro.nombre.toLowerCase()}</strong> en las convocatorias abiertas. Toca para quitar o sumar; cada una dice cuántas hay hoy.
          </>
        ) : (
          <>De lo que me contaste saqué estas palabras. Toca para quitar o sumar, o escribe otras abajo; cada una dice cuántas hay abiertas hoy.</>
        );
      case "tipos":
        return (
          <>
            {calce.data && calce.data.total > 0 && respondidas.has("palabras") && (
              <span className="mb-1 block">Con esas palabras hoy hay <strong className="font-semibold tabular-nums">{numero(calce.data.total)}</strong> convocatorias abiertas.</span>
            )}
            <strong className="font-semibold">¿Qué contratos atiendes?</strong> Puedes marcar varios.
          </>
        );
      case "lugar":
        return (
          <>
            <strong className="font-semibold">¿A qué regiones llegas?</strong> Con tus entregas o tu servicio.
          </>
        );
      case "monto":
        return (
          <>
            <strong className="font-semibold">¿De qué tamaño son los contratos que puedes atender?</strong> Es el valor referencial que publica la entidad.
            <span className="mt-1 block text-dato text-inkSoft">Ojo: muchas entidades no lo publican. Con un rango, esas quedan fuera.</span>
          </>
        );
      case "avisos":
        return (
          <>
            <strong className="font-semibold">Última: ¿te aviso cuando salga algo que calce contigo?</strong> Te llega a {correo} y queda en tu cuenta.
          </>
        );
    }
  }

  /** Las respuestas para tocar de la pregunta en curso. */
  function respuestas(q: Pregunta): ReactNode {
    switch (q) {
      case "rubro":
        return (
          <Respuestas etiqueta="Rubros">
            <div className="flex flex-wrap gap-2">
              {RUBROS.map((r) => (
                <Opcion key={r.clave} activa={rubro?.clave === r.clave} onClick={() => elegirRubro(r)}>
                  {r.nombre}
                </Opcion>
              ))}
            </div>
          </Respuestas>
        );
      case "palabras":
        return (
          <Respuestas etiqueta="Palabras clave">
            <div className="flex flex-wrap gap-2">
              {fichas.map((w) => {
                const n = nPalabra(w);
                return (
                  <Opcion
                    key={w}
                    multiple
                    activa={p.palabras.includes(w)}
                    onClick={() => cambiar({ palabras: alternarPalabra(p.palabras, w) })}
                    detalle={n == null ? <Loader2 size={12} aria-label="Contando" className="animate-spin" /> : n === 0 ? "ninguna hoy" : `${numero(n)} hoy`}
                  >
                    {w}
                  </Opcion>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Opcion principal disabled={p.palabras.length === 0} onClick={() => responder("palabras")} icono={<Check size={15} aria-hidden />}>
                {p.palabras.length === 0 ? "Elige al menos una" : `Listo, sigo con ${p.palabras.length === 1 ? "esta" : `estas ${p.palabras.length}`}`}
              </Opcion>
              <span className="text-meta text-mute">{p.palabras.length} de {MAX_PALABRAS}</span>
            </div>
          </Respuestas>
        );
      case "tipos":
        return (
          <Respuestas etiqueta="Tipos de contrato">
            <div className="grid gap-2 sm:grid-cols-2">
              {TIPOS_PROCESO.map((t) => {
                const Icono = ICONO_TIPO[t];
                const si = p.tipos.includes(t);
                return (
                  <Opcion key={t} multiple activa={si} onClick={() => cambiar({ tipos: si ? p.tipos.filter((x) => x !== t) : [...p.tipos, t] })} icono={<Icono size={16} aria-hidden className="text-inkSoft" />} className="justify-start rounded-xl">
                    {NOMBRE_TIPO[t]}
                  </Opcion>
                );
              })}
            </div>
            <div className="mt-3">
              <Opcion principal onClick={() => responder("tipos")} icono={<Check size={15} aria-hidden />}>
                {p.tipos.length === 0 ? "Todos los tipos" : "Listo"}
              </Opcion>
            </div>
          </Respuestas>
        );
      case "lugar": {
        const limaCallao = p.regiones.length === 2 && LIMA_CALLAO.every((u) => p.regiones.includes(u));
        return (
          <Respuestas etiqueta="Regiones">
            <div className="flex flex-wrap gap-2">
              <Opcion activa={respondidas.has("lugar") && p.regiones.length === 0} onClick={() => responder("lugar", { regiones: [] })}>Todo el Perú</Opcion>
              <Opcion activa={respondidas.has("lugar") && limaCallao} onClick={() => responder("lugar", { regiones: LIMA_CALLAO })}>Lima y Callao</Opcion>
              <Opcion activa={regionesAbiertas} onClick={() => setRegionesAbiertas((x) => !x)} icono={<MapPin size={15} aria-hidden className="text-inkSoft" />}>
                Elijo mis regiones
              </Opcion>
            </div>
            {regionesAbiertas && (
              <div className="mt-3 rounded-2xl border border-line bg-caja p-3 shadow-caja motion-safe:animate-fadeIn">
                <div className="flex flex-wrap gap-1.5">
                  {REGIONES_UBIGEO.map((r) => {
                    const si = p.regiones.includes(r.ubigeo);
                    return (
                      <Opcion key={r.ubigeo} multiple activa={si} onClick={() => cambiar({ regiones: si ? p.regiones.filter((x) => x !== r.ubigeo) : [...p.regiones, r.ubigeo] })} className="min-h-9 px-3 text-meta">
                        {r.nombre}
                      </Opcion>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <Opcion principal disabled={p.regiones.length === 0} onClick={() => responder("lugar")} icono={<Check size={15} aria-hidden />}>
                    {p.regiones.length === 0 ? "Elige al menos una" : `Listo, ${p.regiones.length === 1 ? "1 región" : `${p.regiones.length} regiones`}`}
                  </Opcion>
                </div>
              </div>
            )}
          </Respuestas>
        );
      }
      case "monto":
        return (
          <Respuestas etiqueta="Tamaño del contrato">
            <div className="flex flex-wrap gap-2">
              {RANGOS.map((r) => (
                <Opcion key={r.clave} activa={respondidas.has("monto") && !rangoPropio && p.min === r.min && p.max === r.max} onClick={() => responder("monto", { min: r.min, max: r.max })}>
                  {r.etiqueta}
                </Opcion>
              ))}
              <Opcion activa={rangoPropio} onClick={() => setRangoPropio((x) => !x)} icono={<PencilLine size={15} aria-hidden className="text-inkSoft" />}>
                Otro rango
              </Opcion>
            </div>
            {rangoPropio && <RangoPropio p={p} onListo={(min, max) => responder("monto", { min, max })} />}
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

  const visibles = PREGUNTAS.filter((q) => respondidas.has(q) || q === actual);
  const textoActivo = actual === "rubro" || actual === "palabras";
  const progreso = respondidas.size;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-lienzo">
      <header className="sticky top-0 z-20 border-b border-line bg-caja/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <MarcaGobserva producto="licitaciones" tamano="sm" />
          <Link href={rutaEn(base, "/app/bandeja")} className="text-dato font-semibold text-inkSoft underline-offset-4 hover:text-ink hover:underline">
            Saltar por ahora
          </Link>
        </div>
        {!tiene && (
          <div className="mx-auto max-w-6xl px-4 pb-3 sm:px-6">
            <div className="flex items-center gap-3">
              <ol className="flex flex-1 gap-1.5" aria-label={`${progreso} de ${PREGUNTAS.length} respuestas`}>
                {PREGUNTAS.map((q) => (
                  <li key={q} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-normal", respondidas.has(q) ? "bg-granate" : q === actual ? "bg-granate/40" : "bg-ink/10")} />
                ))}
              </ol>
              <span className="shrink-0 text-meta font-semibold tabular-nums text-inkSoft">{progreso} de {PREGUNTAS.length}</span>
              {p.palabras.length > 0 && calce.data && (
                <span className="shrink-0 rounded-full bg-granate-50 px-2.5 py-0.5 text-meta font-semibold tabular-nums text-ink lg:hidden">
                  {numero(calce.data.total)} calzan
                </span>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-10">
        <div className="mx-auto flex min-h-[calc(100dvh-6rem)] w-full min-w-0 max-w-2xl flex-col">
          <div className="flex-1 pb-6 pt-8">
            {lineas.isLoading ? (
              <Escribiendo />
            ) : tiene ? (
              <Conversacion etiqueta="Conversación con Gobserva">
                <MensajeBot>
                  Hola{primerNombre ? `, ${primerNombre}` : ""}. Ya tienes tu perfil <strong className="font-semibold">«{lineas.data!.data[0].nombre}»</strong>: tus oportunidades están ordenadas de lo más parecido a lo menos.
                </MensajeBot>
                <Respuestas etiqueta="Qué quieres hacer">
                  <div className="flex flex-wrap gap-2">
                    <Link href={rutaEn(base, "/cuenta?tab=para-ti")} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-granate bg-granate px-4 text-dato font-semibold text-paper hover:bg-granate-deep">
                      Ver mis oportunidades <ArrowRight size={15} aria-hidden />
                    </Link>
                    <Opcion onClick={() => setRehacer(true)} icono={<Plus size={15} aria-hidden className="text-inkSoft" />}>Armar otra línea de negocio</Opcion>
                  </div>
                </Respuestas>
              </Conversacion>
            ) : (
              <Conversacion etiqueta="Entrevista para armar tu perfil">
                <MensajeBot>
                  Hola{primerNombre ? `, ${primerNombre}` : ""}. Soy el asistente de Gobserva Licitaciones. Te hago <strong className="font-semibold">seis preguntas</strong> y armo tu bandeja con lo que el Estado está comprando hoy.
                </MensajeBot>
                {visibles.map((q) => {
                  const enCurso = q === actual;
                  if (enCurso && escribiendo) return <Escribiendo key={q} />;
                  return (
                    <div key={q} className="space-y-3">
                      <MensajeBot ref={enCurso ? anclaActual : undefined} sinAvatar={q === "rubro"}>{pregunta(q)}</MensajeBot>
                      {enCurso ? respuestas(q) : <MensajeTuyo onCambiar={estado === "entrevista" ? () => volverA(q) : undefined} etiquetaCambiar={`Cambiar: ${PREGUNTA_NOMBRE[q]}`}>{textoDe(q)}</MensajeTuyo>}
                    </div>
                  );
                })}
                {actual === null && (escribiendo ? <Escribiendo /> : (
                  <Final
                    ref={anclaActual}
                    p={p}
                    calce={calce.data}
                    cargando={calce.isLoading || calce.isValidating}
                    estado={estado}
                    error={errorFinal}
                    onNombre={(nombre) => cambiar({ nombre })}
                    onCrear={crear}
                  />
                ))}
              </Conversacion>
            )}
          </div>

          {!tiene && estado === "entrevista" && actual !== null && (
            <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-lienzo via-lienzo to-lienzo/0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:-mx-6 sm:px-6">
              <Compositor
                valor={texto}
                onCambio={(v) => {
                  setTexto(v);
                  setError(null);
                }}
                onEnviar={textoActivo && !escribiendo ? enviarTexto : undefined}
                etiqueta={actual === "palabras" ? "Suma otra palabra clave" : "Qué vende tu empresa"}
                placeholder={
                  actual === "rubro"
                    ? "O escríbelo: vendemos uniformes y calzado de seguridad…"
                    : actual === "palabras"
                      ? "Suma otra palabra: tóner, papel bond…"
                      : actual === null
                        ? "Revisa tu perfil y créalo arriba"
                        : "Toca una de las respuestas de arriba"
                }
                error={error}
                maxLength={actual === "palabras" ? 120 : 1000}
              />
            </div>
          )}
        </div>

        {!tiene && (
          <aside aria-label="Tu perfil" className="hidden lg:block">
            <div className="sticky top-32 pt-8">
              <PerfilVivo p={p} respondidas={respondidas} actual={actual} textoDe={textoDe} calce={calce.data} cargando={calce.isValidating} onCambiar={estado === "entrevista" ? volverA : undefined} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/** «Otro rango»: desde y hasta en soles. */
function RangoPropio({ p, onListo }: { p: PerfilEmpresa; onListo: (min: number | null, max: number | null) => void }) {
  const [min, setMin] = useState(p.min != null ? String(p.min) : "");
  const [max, setMax] = useState(p.max != null ? String(p.max) : "");
  const [error, setError] = useState<string | null>(null);
  const num = (t: string) => (t.trim() ? Math.max(0, Number(t.replace(/\D/g, ""))) : null);
  const campo = "h-11 w-full rounded-lg border border-line bg-caja px-3 text-destacado tabular-nums text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";
  return (
    <div className="mt-3 rounded-2xl border border-line bg-caja p-3 shadow-caja motion-safe:animate-fadeIn">
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0">
          <span className="mb-1 block text-meta font-semibold text-inkSoft">Desde (S/)</span>
          <input inputMode="numeric" value={min} onChange={(e) => { setMin(e.target.value); setError(null); }} placeholder="0" className={campo} />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-meta font-semibold text-inkSoft">Hasta (S/)</span>
          <input inputMode="numeric" value={max} onChange={(e) => { setMax(e.target.value); setError(null); }} placeholder="Sin tope" className={campo} />
        </label>
      </div>
      {error && <p role="alert" className="mt-2 text-meta font-medium text-crimsonTexto">{error}</p>}
      <div className="mt-3">
        <Opcion
          principal
          icono={<Check size={15} aria-hidden />}
          onClick={() => {
            const a = num(min);
            const b = num(max);
            if (a != null && b != null && a > b) return setError("El «desde» no puede ser mayor que el «hasta».");
            onListo(a, b);
          }}
        >
          Listo
        </Opcion>
      </div>
    </div>
  );
}

/** El perfil que se arma con cada respuesta, con cuántas abiertas calzan hoy (desde lg, al lado de la conversación). */
function PerfilVivo({
  p, respondidas, actual, textoDe, calce, cargando, onCambiar,
}: {
  p: PerfilEmpresa;
  respondidas: Set<Pregunta>;
  actual: Pregunta | null;
  textoDe: (q: Pregunta) => string;
  calce: Calce | undefined;
  cargando: boolean;
  onCambiar?: (q: Pregunta) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-caja shadow-caja">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-bloque font-bold text-ink">Tu perfil</h2>
        <p className="mt-0.5 text-meta text-inkSoft">Se arma con tus respuestas</p>
      </div>
      <ul className="divide-y divide-line">
        {PREGUNTAS.map((q) => {
          const Icono = PREGUNTA_ICONO[q];
          const listo = respondidas.has(q);
          return (
            <li key={q} className={cn("flex items-start gap-3 px-5 py-3", q === actual && "bg-granate-50/60")}>
              <span aria-hidden className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", listo ? "bg-granate text-paper" : "bg-ink/[0.06] text-mute")}>
                {listo ? <Check size={14} strokeWidth={3} /> : <Icono size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-meta font-semibold text-mute">{PREGUNTA_NOMBRE[q]}</p>
                <p className={cn("text-dato [overflow-wrap:anywhere]", listo ? "font-medium text-ink" : "text-mute")}>
                  {listo ? (q === "rubro" ? p.nombre || textoDe(q) : textoDe(q)) : q === actual ? "Respondiendo…" : "Falta"}
                </p>
              </div>
              {listo && onCambiar && q !== actual && (
                <button type="button" onClick={() => onCambiar(q)} className="shrink-0 rounded-md px-1.5 py-1 text-meta font-semibold text-mute hover:bg-ink/[0.05] hover:text-ink" aria-label={`Cambiar: ${PREGUNTA_NOMBRE[q]}`}>
                  Cambiar
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="rounded-b-2xl border-t border-line bg-ink/[0.025] px-5 py-4">
        <p className="text-meta font-semibold text-inkSoft">Calzan hoy contigo</p>
        {p.palabras.length === 0 ? (
          <p className="mt-1 text-dato text-mute">Cuando elijas tus palabras, te digo cuántas convocatorias abiertas calzan.</p>
        ) : (
          <p className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-cifra font-bold tabular-nums text-ink">{calce ? numero(calce.total) : "…"}</span>
            <span className="text-dato text-inkSoft">convocatorias abiertas</span>
            {cargando && <Loader2 size={14} aria-label="Actualizando" className="animate-spin self-center text-mute" />}
          </p>
        )}
      </div>
    </section>
  );
}

/** El cierre: el perfil con su nombre, lo que ya calza (las tres que cierran consultas primero) y «Crear mi bandeja». */
const Final = forwardRef<HTMLDivElement, {
  p: PerfilEmpresa;
  calce: Calce | undefined;
  cargando: boolean;
  estado: "entrevista" | "creando" | "listo";
  error: string | null;
  onNombre: (n: string) => void;
  onCrear: () => void;
}>(function Final({ p, calce, cargando, estado, error, onNombre, onCrear }, ref) {
  const total = calce?.total ?? null;
  const vistazo = calce?.vistazo ?? [];
  return (
    <div className="space-y-3">
      <MensajeBot ref={ref} ancho>
        {total == null || cargando ? (
          <span className="inline-flex items-center gap-2 text-inkSoft"><Loader2 size={15} aria-hidden className="animate-spin" /> Buscando lo que calza contigo…</span>
        ) : total > 0 ? (
          <>
            <strong className="font-semibold">Listo.</strong> Con tu perfil hoy calzan <strong className="font-semibold tabular-nums">{numero(total)}</strong> convocatorias abiertas. Mira algunas:
          </>
        ) : (
          <>
            <strong className="font-semibold">Listo.</strong> Hoy no hay convocatorias abiertas con ese perfil. Igual lo guardo y te aviso cuando salga algo; también puedes sumar palabras arriba.
          </>
        )}
        {vistazo.length > 0 && !cargando && (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
            {vistazo.map((o) => {
              const v = vencimiento(o.consultasHasta);
              return (
                <li key={o.ocid} className="bg-lienzo/50 px-3.5 py-3">
                  <p className="line-clamp-2 text-dato font-semibold text-ink">{limpiar(o.objeto) || "Sin descripción"}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft">
                    <span className="min-w-0 truncate">{o.entidad ? tituloNatural(o.entidad) : "Entidad sin nombre"}</span>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 font-semibold", v.estado === "hoy" || v.estado === "pronto" ? "text-amberTexto" : "text-inkSoft")}>
                      <CalendarClock size={13} aria-hidden /> Consultas: {v.texto.toLowerCase()}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </MensajeBot>
      <MensajeBot sinAvatar ancho>
        <label htmlFor="onb-nombre-final" className="block font-semibold">¿Le pongo este nombre a tu perfil?</label>
        <input
          id="onb-nombre-final"
          value={p.nombre}
          maxLength={80}
          disabled={estado !== "entrevista"}
          onChange={(e) => onNombre(e.target.value)}
          placeholder="Útiles de oficina"
          className="mt-2 h-11 w-full rounded-lg border border-line bg-caja px-3.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
        />
        <p className="mt-1.5 text-meta text-mute">Así se llama tu línea de negocio en «Para ti». Puedes tener varias.</p>
        {error && <p role="alert" className="mt-3 rounded-lg border border-crimson/30 bg-crimson-soft px-3 py-2 text-dato font-medium text-crimsonTexto">{error}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCrear}
            disabled={estado !== "entrevista" || p.nombre.trim().length < 2}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-granate px-5 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:opacity-60"
          >
            {estado === "entrevista" ? <Sparkles size={16} aria-hidden /> : <Loader2 size={16} aria-hidden className="animate-spin" />}
            {estado === "listo" ? "Te llevo a tus oportunidades…" : estado === "creando" ? "Armando tu bandeja…" : "Crear mi bandeja"}
          </button>
          <span className="text-meta text-mute">Creo tu perfil{p.alerta ? ", tu alerta" : ""} y la búsqueda «Mi empresa».</span>
        </div>
      </MensajeBot>
    </div>
  );
});
