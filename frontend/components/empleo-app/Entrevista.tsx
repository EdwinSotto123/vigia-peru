"use client";

import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowRight, Bell, BellOff, BriefcaseBusiness, CalendarClock, Check, GraduationCap, KeyRound, Loader2, MapPin, RotateCcw, Sparkles, Timer, Wallet,
} from "lucide-react";
import { MarcaGobserva } from "@/components/gobserva/MarcaGobserva";
import { Compositor, Conversacion, Escribiendo, MensajeBot, MensajeTuyo, Opcion, Respuestas, useEscribiendo, useMenosMovimiento, useRetrasado } from "@/components/gobserva/app/chat/Chat";
import { useMe, useSesion } from "@/components/gobserva/cuenta/comun";
import { rutaEn } from "@/lib/gobserva";
import { ErrorCuenta, borrarBusqueda, crearAlerta, crearBusqueda } from "@/lib/gobserva-cuenta";
import { REGIONES_EMPLEO, diasParaCierre, entidadNombre, nombreRegion, puesto as puestoLegible, slugRegion, textoCierre } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import {
  ESTUDIOS, EXPERIENCIAS, MAX_PALABRAS_EMPLEO, NOMBRE_PERFIL, PERFIL_EMPLEO_VACIO, PREGUNTAS_EMPLEO, PUESTOS, SUELDOS, aAlertaEmpleo, aQueryPerfil, agregarPalabrasEmpleo,
  candidatasEmpleo, paramsCalce, perfilDesdePuesto, perfilDesdeTextoEmpleo, siguienteEmpleo, textoRespuestaEmpleo, type PerfilEmpleo, type PreguntaEmpleo, type Puesto,
} from "@/lib/empleo-app/entrevista";
import { cn } from "@/lib/utils";
import { pedirCalce, usePerfilEmpleo, type CalceEmpleo } from "./usePerfilEmpleo";

const ICONO: Record<PreguntaEmpleo, typeof Bell> = {
  puesto: BriefcaseBusiness, palabras: KeyRound, estudios: GraduationCap, experiencia: Timer, lugar: MapPin, sueldo: Wallet, avisos: Bell,
};
const NOMBRE: Record<PreguntaEmpleo, string> = {
  puesto: "Buscas", palabras: "Palabras clave", estudios: "Estudios", experiencia: "Experiencia", lugar: "Dónde", sueldo: "Sueldo", avisos: "Avisos",
};
const regionDeSlug = (slug: string) => nombreRegion(slug.replace(/-/g, " ").toUpperCase());

/**
 * El onboarding de la app de Gobserva Empleo (2026-11-07): una entrevista en forma de chat, como la de Licitaciones.
 * El asistente pregunta de a una (qué trabajo buscas, con qué palabras, hasta dónde estudiaste, cuánta experiencia,
 * dónde y desde qué sueldo, y cómo avisarte); cada respuesta se toca o se escribe y se puede cambiar. Al lado, el perfil
 * con cuántas plazas abiertas calzan hoy (GET /empleo/calce, una consulta por respuesta). Al final, las tres que cierran
 * primero; «Crear mi perfil» guarda la búsqueda «Mi perfil» y la alerta, y lleva a «Para ti».
 */
export function EntrevistaEmpleo({ base }: { base: string }) {
  const { user } = useSesion();
  const { me } = useMe("empleo");
  const perfilGuardado = usePerfilEmpleo();
  const menos = useMenosMovimiento();

  const [p, setP] = useState<PerfilEmpleo>(PERFIL_EMPLEO_VACIO);
  const [puesto, setPuesto] = useState<Puesto | null>(null);
  const [escrito, setEscrito] = useState("");
  const [respondidas, setRespondidas] = useState<Set<PreguntaEmpleo>>(new Set());
  const [actual, setActual] = useState<PreguntaEmpleo | null>("puesto");
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [otraRegion, setOtraRegion] = useState(false);
  const [rehacer, setRehacer] = useState(false);
  const [estado, setEstado] = useState<"entrevista" | "creando" | "listo">("entrevista");
  const [errorFinal, setErrorFinal] = useState<string | null>(null);
  const ancla = useRef<HTMLDivElement>(null);

  const conDiaria = !!me?.producto?.limites?.frecuencias.includes("diaria");
  const tiene = !!perfilGuardado.perfil && !rehacer;
  const primerNombre = user?.displayName?.split(" ")[0];
  const correo = me?.cuenta.email ?? user?.email ?? "tu correo";

  const fichas = actual === "palabras" ? candidatasEmpleo(p, puesto, escrito) : [];
  const otras = fichas.filter((w) => !p.palabras.includes(w));
  const clave = useRetrasado(paramsCalce(p, otras, { size: 3 }).toString(), 350);
  const calce = useSWR<CalceEmpleo>(clave.includes("palabras=") || clave.includes("otras=") ? ["onb-calce-empleo", clave] : null, () => pedirCalce(clave), {
    keepPreviousData: true,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const nPalabra = (w: string) => calce.data?.porPalabra.find((x) => x.palabra === w)?.n;

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

  function enviarTexto() {
    const t = texto.trim();
    if (actual === "puesto") {
      if (t.length < 4) return setError("Cuéntame qué trabajo buscas: el puesto o tu profesión.");
      const n = perfilDesdeTextoEmpleo(p, t);
      if (!n.palabras.length) return setError("No entendí el puesto. Prueba con tu profesión: «contador», «enfermera», «chofer».");
      setPuesto(null);
      setEscrito(t);
      return responder("puesto", n);
    }
    if (actual === "palabras") {
      if (p.palabras.length >= MAX_PALABRAS_EMPLEO) return setError(`Ya tienes ${MAX_PALABRAS_EMPLEO} palabras: quita alguna para sumar otra.`);
      const n = agregarPalabrasEmpleo(p.palabras, t);
      if (n.length === p.palabras.length) return setError("Esa ya está o es muy corta.");
      cambiar({ palabras: n });
      setTexto("");
    }
  }

  async function crear() {
    setEstado("creando");
    setErrorFinal(null);
    const perfil = { ...p, puesto: p.puesto.trim() || "Mi perfil" };
    try {
      // Una sola «Mi perfil» por cuenta: la de antes se reemplaza.
      if (perfilGuardado.id != null) await borrarBusqueda(perfilGuardado.id);
      await crearBusqueda({ producto: "empleo", nombre: NOMBRE_PERFIL, query: aQueryPerfil(perfil) });
    } catch (e) {
      setEstado("entrevista");
      return setErrorFinal(e instanceof ErrorCuenta ? e.message : "No pude guardar tu perfil. Vuelve a intentarlo.");
    }
    if (perfil.alerta && perfil.palabras.length) {
      try {
        const a = aAlertaEmpleo(perfil);
        await crearAlerta({ producto: "empleo", nombre: a.nombre, filtros: a.filtros, frecuencia: conDiaria ? perfil.frecuencia : "semanal" });
      } catch {
        // Sin cupo de alertas (el plan gratis tiene una): el perfil igual queda; la alerta se arma desde Alertas.
      }
    }
    setEstado("listo");
    void perfilGuardado.mutate();
    window.setTimeout(() => window.location.assign(rutaEn(base, "/app/para-ti")), menos ? 0 : 900);
  }

  const textoDe = (q: PreguntaEmpleo) => textoRespuestaEmpleo(q, p, regionDeSlug, puesto, escrito);

  function pregunta(q: PreguntaEmpleo): ReactNode {
    switch (q) {
      case "puesto":
        return (
          <>
            <strong className="font-semibold">¿Qué trabajo buscas?</strong> Elige un área o escribe abajo tu puesto o tu profesión.
          </>
        );
      case "palabras":
        return puesto ? (
          <>
            Con estas palabras busco <strong className="font-semibold">{puesto.nombre.toLowerCase()}</strong> en las plazas abiertas. Toca para quitar o sumar; cada una dice cuántas hay hoy.
          </>
        ) : (
          <>De lo que me contaste saqué estas palabras. Toca para quitar o sumar, o escribe otras abajo; cada una dice cuántas plazas hay hoy.</>
        );
      case "estudios":
        return (
          <>
            {calce.data && calce.data.total > 0 && respondidas.has("palabras") && (
              <span className="mb-1 block">Con esas palabras hoy hay <strong className="font-semibold tabular-nums">{numero(calce.data.total)}</strong> plazas abiertas.</span>
            )}
            <strong className="font-semibold">¿Hasta dónde estudiaste?</strong> Te muestro las plazas que piden eso o menos.
          </>
        );
      case "experiencia":
        return (
          <>
            <strong className="font-semibold">¿Cuántos años de experiencia tienes?</strong> En el trabajo que sea: casi todas las plazas piden experiencia general.
          </>
        );
      case "lugar":
        return (
          <>
            <strong className="font-semibold">¿Dónde quieres trabajar?</strong>
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
      case "puesto":
        return (
          <Respuestas etiqueta="Áreas de trabajo">
            <div className="flex flex-wrap gap-2">
              {PUESTOS.map((x) => (
                <Opcion
                  key={x.clave}
                  activa={puesto?.clave === x.clave}
                  onClick={() => {
                    setPuesto(x);
                    setEscrito("");
                    responder("puesto", perfilDesdePuesto(p, x));
                  }}
                >
                  {x.nombre}
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
                const si = p.palabras.includes(w);
                return (
                  <Opcion
                    key={w}
                    multiple
                    activa={si}
                    onClick={() => cambiar({ palabras: si ? p.palabras.filter((x) => x !== w) : p.palabras.length >= MAX_PALABRAS_EMPLEO ? p.palabras : [...p.palabras, w] })}
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
              <span className="text-meta text-mute">{p.palabras.length} de {MAX_PALABRAS_EMPLEO}</span>
            </div>
          </Respuestas>
        );
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
      case "lugar":
        return (
          <Respuestas etiqueta="Dónde">
            <div className="flex flex-wrap gap-2">
              <Opcion activa={respondidas.has("lugar") && !p.region} onClick={() => responder("lugar", { region: null })}>Todo el Perú</Opcion>
              <Opcion activa={respondidas.has("lugar") && p.region === "lima"} onClick={() => responder("lugar", { region: "lima" })}>Lima</Opcion>
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
  const textoActivo = actual === "puesto" || actual === "palabras";
  const progreso = respondidas.size;
  const total = PREGUNTAS_EMPLEO.length;

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
              {p.palabras.length > 0 && calce.data && (
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
                  Hola{primerNombre ? `, ${primerNombre}` : ""}. Ya tienes tu perfil <strong className="font-semibold">«{perfilGuardado.perfil!.puesto || "Mi perfil"}»</strong>: tus plazas están en «Para ti», de las que cierran primero a las últimas.
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
                  Hola{primerNombre ? `, ${primerNombre}` : ""}. Soy el asistente de Gobserva Empleo. Te hago <strong className="font-semibold">siete preguntas rápidas</strong> y te muestro las plazas del Estado a las que puedes postular hoy.
                </MensajeBot>
                {visibles.map((q) => {
                  const enCurso = q === actual;
                  if (enCurso && escribiendo) return <Escribiendo key={q} />;
                  return (
                    <div key={q} className="space-y-3">
                      <MensajeBot ref={enCurso ? ancla : undefined} sinAvatar={q === "puesto"}>{pregunta(q)}</MensajeBot>
                      {enCurso ? respuestas(q) : <MensajeTuyo onCambiar={estado === "entrevista" ? () => volverA(q) : undefined} etiquetaCambiar={`Cambiar: ${NOMBRE[q]}`}>{textoDe(q)}</MensajeTuyo>}
                    </div>
                  );
                })}
                {actual === null &&
                  (escribiendo ? (
                    <Escribiendo />
                  ) : (
                    <Final ref={ancla} p={p} calce={calce.data} cargando={calce.isLoading || calce.isValidating} estado={estado} error={errorFinal} onPuesto={(x) => cambiar({ puesto: x })} onCrear={crear} />
                  ))}
              </Conversacion>
            )}
          </div>

          {!tiene && estado === "entrevista" && actual !== null && !perfilGuardado.cargando && (
            <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-lienzo via-lienzo to-lienzo/0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:-mx-6 sm:px-6">
              <Compositor
                valor={texto}
                onCambio={(v) => {
                  setTexto(v);
                  setError(null);
                }}
                onEnviar={textoActivo && !escribiendo ? enviarTexto : undefined}
                etiqueta={actual === "palabras" ? "Suma otra palabra clave" : "Qué trabajo buscas"}
                placeholder={
                  actual === "puesto" ? "O escríbelo: asistente de archivo, nutricionista…" : actual === "palabras" ? "Suma otra palabra: archivo, trámite…" : "Toca una de las respuestas de arriba"
                }
                error={error}
                maxLength={actual === "palabras" ? 120 : 300}
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
                  <p className="mt-0.5 text-meta text-inkSoft">Se arma con tus respuestas</p>
                </div>
                <ul className="divide-y divide-line">
                  {PREGUNTAS_EMPLEO.map((q) => {
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
                            {listo ? (q === "puesto" ? p.puesto || textoDe(q) : textoDe(q)) : q === actual ? "Respondiendo…" : "Falta"}
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
                  {p.palabras.length === 0 ? (
                    <p className="mt-1 text-dato text-mute">Cuando elijas tus palabras, te digo cuántas plazas abiertas calzan.</p>
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

/** El cierre: cuántas calzan y las tres que cierran primero; el nombre del perfil y «Crear mi perfil». */
const Final = forwardRef<HTMLDivElement, {
  p: PerfilEmpleo;
  calce: CalceEmpleo | undefined;
  cargando: boolean;
  estado: "entrevista" | "creando" | "listo";
  error: string | null;
  onPuesto: (x: string) => void;
  onCrear: () => void;
}>(function Final({ p, calce, cargando, estado, error, onPuesto, onCrear }, ref) {
  const total = calce?.total ?? null;
  const vistazo = calce?.data ?? [];
  return (
    <div className="space-y-3">
      <MensajeBot ref={ref} ancho>
        {total == null || cargando ? (
          <span className="inline-flex items-center gap-2 text-inkSoft"><Loader2 size={15} aria-hidden className="animate-spin" /> Buscando las plazas que calzan contigo…</span>
        ) : total > 0 ? (
          <>
            <strong className="font-semibold">Listo.</strong> Con tu perfil hoy calzan <strong className="font-semibold tabular-nums">{numero(total)}</strong> plazas abiertas. Estas cierran primero:
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
          value={p.puesto}
          maxLength={60}
          disabled={estado !== "entrevista"}
          onChange={(e) => onPuesto(e.target.value)}
          placeholder="Asistente administrativo"
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
