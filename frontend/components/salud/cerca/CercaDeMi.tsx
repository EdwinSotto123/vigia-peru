"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Clock3, Crosshair, ExternalLink, Info, Loader2, LocateFixed, Navigation, RotateCw, ShieldCheck, Siren, TriangleAlert } from "lucide-react";
import { direccionLegible, nombreServicio } from "@/components/salud/ficha/piezas";
import { FilaEstablecimiento, PLACA_LISTA } from "@/components/salud/lista/FilaEstablecimiento";
import { VecinaPregunta, VecinaUbicando } from "@/components/salud/pixel/Personajes";
import { BuscadorSalud } from "@/components/salud/portada/BuscadorSalud";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { Dato } from "@/components/ui/Dato";
import { rutaEn } from "@/lib/gobserva";
import { URL_CERCA_SALUD, distanciaMetros, numero, redondearCoordenada, textoDistancia, type Cercanos, type FilaCercana } from "@/lib/gobserva-salud";
import { NECESIDADES_RAPIDAS, necesidadDe, type Necesidad } from "@/lib/salud-necesidades";
import { SEGUROS_PERSONA, URL_LEY_SALUD, seguroPersonaDe, type SeguroPersona } from "@/lib/salud-seguros";
import { cn } from "@/lib/utils";

type Motivo = "denegado" | "no_disponible" | "tiempo" | "sin_soporte" | "fuera" | "limite" | "red";
/** Lo que se pide: qué necesita, con qué seguro y si sólo los de 24 horas. */
interface Consulta {
  necesidad: Necesidad | null;
  seguro: SeguroPersona | null;
  h24: boolean;
}
type Estado =
  | { fase: "inicio" }
  | { fase: "ubicando" }
  | { fase: "buscando" }
  | {
      fase: "listo";
      filas: (FilaCercana & { metros: number })[];
      margen: number;
      necesidad: Necesidad | null;
      seguro: SeguroPersona | null;
      h24: boolean;
      radioKm: number;
      cobertura: Cercanos["cobertura"];
    }
  | { fase: "error"; motivo: Motivo };

const PRIMERAS = 8;
/** En el celular, las necesidades que se ven antes de «Ver más» (la lista entera eran seis renglones de botones). */
const VISIBLES_CELULAR = 6;

const MENSAJE: Record<Motivo, { titulo: string; texto: string }> = {
  denegado: {
    titulo: "No diste permiso para usar tu ubicación",
    texto: "Puedes permitirlo en la configuración del navegador para este sitio y volver a intentarlo, o buscar el establecimiento por su nombre.",
  },
  no_disponible: {
    titulo: "Tu teléfono no pudo saber dónde estás",
    texto: "Revisa que la ubicación del teléfono esté activada. Dentro de un edificio ayuda acercarse a una ventana.",
  },
  tiempo: { titulo: "Tardó demasiado en ubicarte", texto: "Vuelve a intentarlo. Dentro de un edificio ayuda acercarse a una ventana." },
  sin_soporte: { titulo: "Este navegador no puede usar tu ubicación", texto: "Busca el establecimiento por su nombre, su código IPRESS o su RUC." },
  fuera: { titulo: "Tu ubicación está fuera del Perú", texto: "Aquí sólo hay establecimientos de salud peruanos. Puedes buscar uno por su nombre." },
  limite: { titulo: "Demasiadas consultas seguidas", texto: "Espera un minuto y vuelve a intentarlo." },
  red: { titulo: "No pudimos consultar los establecimientos cercanos", texto: "Revisa tu conexión y vuelve a intentarlo." },
};

/**
 * «Cerca de ti» (Gobserva Salud): para quien ya está adentro de una clínica y quiere verificarla sin saber su nombre
 * exacto, y para quien busca dónde atenderse de algo («dientes», «embarazo y parto»). Pide la ubicación al tocar el botón
 * (o al abrir la página desde el botón de la portada, `auto`), manda a la API sólo la ubicación redondeada a unos 110 m
 * (POST /salud/cerca, en el cuerpo) y, con la ubicación exacta, que no sale del teléfono, calcula la distancia y ordena.
 * Sin necesidad: las más cercanas, también las de baja o que ya no figuran en RENIPRESS. Con una: sólo las activas que la
 * declararon, con lo que declararon y cuántas de la zona ya tienen sus servicios leídos. Nunca dice «estás en tal
 * clínica» (el GPS se desvía adentro de un edificio) ni «aquí no te atienden» (sólo «no lo declaró»).
 */
export function CercaDeMi({
  base,
  auto = false,
  necesidadInicial = null,
  seguroInicial = null,
  h24Inicial = false,
  conUbicacion,
  total,
}: {
  base: string;
  auto?: boolean;
  /** La clave de una necesidad (lib/salud-necesidades.ts) que llega en la URL: ?necesidad=dientes. */
  necesidadInicial?: string | null;
  /** ?seguro=sis|essalud|privado|ninguno: el seguro de la persona (lib/salud-seguros.ts). */
  seguroInicial?: string | null;
  /** ?h24=1: sólo los que declararon atender las 24 horas. */
  h24Inicial?: boolean;
  /** Cuántas IPRESS tienen ubicación en RENIPRESS y cuántas hay (GET /salud/resumen), para decir cuántas no se pueden encontrar así. */
  conUbicacion: number | null;
  total: number | null;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "inicio" });
  const [necesidad, setNecesidad] = useState<Necesidad | null>(necesidadDe(necesidadInicial));
  const [seguro, setSeguro] = useState<SeguroPersona | null>(seguroPersonaDe(seguroInicial));
  const [h24, setH24] = useState(h24Inicial);
  const [masNecesidades, setMasNecesidades] = useState(false);
  const [todas, setTodas] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const pedido = useRef(0);
  const posicion = useRef<{ lat: number; lon: number; margen: number } | null>(null);

  const buscar = useCallback(async (lat: number, lon: number, margen: number, n: number, c: Consulta) => {
    setEstado({ fase: "buscando" });
    try {
      const r = await fetch(URL_CERCA_SALUD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: redondearCoordenada(lat),
          lon: redondearCoordenada(lon),
          ...(c.necesidad ? { terminos: c.necesidad.terminos } : {}),
          ...(c.seguro ? { seguro: c.seguro.filtro } : {}),
          ...(c.h24 ? { h24: true } : {}),
        }),
        cache: "no-store",
      });
      if (n !== pedido.current) return;
      if (r.status === 429) return setEstado({ fase: "error", motivo: "limite" });
      if (!r.ok) {
        const e = (await r.json().catch(() => null)) as { error?: string } | null;
        return setEstado({ fase: "error", motivo: e?.error === "fuera_del_peru" ? "fuera" : "red" });
      }
      const d = (await r.json()) as Cercanos;
      if (n !== pedido.current) return;
      // La distancia exacta, con la ubicación real (la de la API es al punto redondeado).
      const filas = d.filas
        .filter((x) => x.lat != null && x.lon != null)
        .map((x) => ({ ...x, metros: distanciaMetros({ lat, lon }, { lat: x.lat as number, lon: x.lon as number }) }))
        .sort((a, b) => a.metros - b.metros || Number(b.activo) - Number(a.activo));
      setTodas(false);
      setEstado({ fase: "listo", filas, margen, necesidad: c.necesidad, seguro: c.seguro, h24: c.h24, radioKm: d.radioKm, cobertura: d.cobertura ?? null });
    } catch {
      if (n === pedido.current) setEstado({ fase: "error", motivo: "red" });
    }
  }, []);

  const ubicar = useCallback(
    (c: Consulta) => {
      const n = ++pedido.current;
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) return setEstado({ fase: "error", motivo: "sin_soporte" });
      setEstado({ fase: "ubicando" });
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (n !== pedido.current) return;
          posicion.current = { lat: p.coords.latitude, lon: p.coords.longitude, margen: p.coords.accuracy };
          void buscar(p.coords.latitude, p.coords.longitude, p.coords.accuracy, n, c);
        },
        (e) => {
          if (n !== pedido.current) return;
          setEstado({ fase: "error", motivo: e.code === e.PERMISSION_DENIED ? "denegado" : e.code === e.TIMEOUT ? "tiempo" : "no_disponible" });
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
      );
    },
    [buscar],
  );

  // Cambiar lo que se necesita, el seguro o las 24 horas: con la ubicación ya tomada se vuelve a buscar sin pedirla de
  // nuevo, y la dirección guarda la elección (se puede compartir o volver).
  const cambiar = (c: Consulta) => {
    setNecesidad(c.necesidad);
    setSeguro(c.seguro);
    setH24(c.h24);
    const p = posicion.current;
    if (p) void buscar(p.lat, p.lon, p.margen, ++pedido.current, c);
    try {
      const u = new URL(window.location.href);
      if (c.necesidad) u.searchParams.set("necesidad", c.necesidad.clave);
      else u.searchParams.delete("necesidad");
      if (c.seguro) u.searchParams.set("seguro", c.seguro.clave);
      else u.searchParams.delete("seguro");
      if (c.h24) u.searchParams.set("h24", "1");
      else u.searchParams.delete("h24");
      u.searchParams.delete("ubicar");
      window.history.replaceState(window.history.state, "", u.toString());
    } catch {
      /* la URL no se pudo cambiar: no importa */
    }
  };

  // Desde el botón de la portada o de una ficha: esa fue la intención, se pide la ubicación al llegar.
  const yaPidio = useRef(false);
  useEffect(() => {
    if (auto && !yaPidio.current) {
      yaPidio.current = true;
      ubicar({ necesidad, seguro, h24 });
    }
  }, [auto, ubicar, necesidad, seguro, h24]);

  // Con los resultados, el foco va a su título (el lector de pantalla lo anuncia y el teclado sigue desde ahí).
  useEffect(() => {
    if (estado.fase === "listo" || estado.fase === "error") titulo.current?.focus();
  }, [estado.fase]);

  const ocupado = estado.fase === "ubicando" || estado.fase === "buscando";
  const sinUbicacion = conUbicacion != null && total != null && total > conUbicacion ? total - conUbicacion : null;
  const opciones = necesidad && !NECESIDADES_RAPIDAS.includes(necesidad) ? [necesidad, ...NECESIDADES_RAPIDAS] : NECESIDADES_RAPIDAS;

  return (
    <div className="min-w-0">
      <fieldset className="min-w-0">
        <legend className="text-dato font-semibold text-ink">¿Qué necesitas? Opcional</legend>
        <ul className="mt-2 flex flex-wrap gap-2">
          <li>
            <Opcion activa={!necesidad} onClick={() => cambiar({ necesidad: null, seguro, h24 })} deshabilitada={ocupado}>
              Ver todos
            </Opcion>
          </li>
          {opciones.map((n, i) => (
            <li key={n.clave} className={cn(!masNecesidades && i >= VISIBLES_CELULAR && necesidad?.clave !== n.clave && "max-sm:hidden")}>
              <Opcion
                activa={necesidad?.clave === n.clave}
                onClick={() => cambiar({ necesidad: necesidad?.clave === n.clave ? null : n, seguro, h24 })}
                deshabilitada={ocupado}
              >
                {n.etiqueta}
              </Opcion>
            </li>
          ))}
          {!masNecesidades && opciones.length > VISIBLES_CELULAR && (
            <li className="sm:hidden">
              <button
                type="button"
                onClick={() => setMasNecesidades(true)}
                className="inline-flex min-h-11 items-center rounded-full px-3 text-meta font-semibold text-granate underline-offset-4 hover:underline"
              >
                Ver {opciones.length - VISIBLES_CELULAR} más
              </button>
            </li>
          )}
        </ul>
      </fieldset>

      {/* Con qué seguro y a qué hora (2026-11-22, «útil para una persona de a pie que quiera atenderse»). */}
      <fieldset className="mt-5 min-w-0">
        <legend className="text-dato font-semibold text-ink">¿Qué seguro tienes? Opcional</legend>
        <ul className="mt-2 flex flex-wrap gap-2">
          <li>
            <Opcion activa={!seguro} onClick={() => cambiar({ necesidad, seguro: null, h24 })} deshabilitada={ocupado}>
              Cualquiera
            </Opcion>
          </li>
          {SEGUROS_PERSONA.map((s) => (
            <li key={s.clave}>
              <Opcion activa={seguro?.clave === s.clave} onClick={() => cambiar({ necesidad, seguro: seguro?.clave === s.clave ? null : s, h24 })} deshabilitada={ocupado}>
                {s.etiqueta}
              </Opcion>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Opcion activa={h24} onClick={() => cambiar({ necesidad, seguro, h24: !h24 })} deshabilitada={ocupado}>
            <Clock3 size={15} aria-hidden className="mr-1.5" />
            Sólo los que atienden 24 horas
          </Opcion>
        </div>
      </fieldset>

      {seguro && (
        <div className="mt-4 flex gap-2.5 rounded-xl border border-line bg-paperSoft px-3.5 py-3 text-meta leading-relaxed text-inkSoft">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
          <p className="max-w-[72ch]">
            {seguro.guia}
            {seguro.enlace && (
              <>
                {" "}
                <a href={seguro.enlace.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
                  {seguro.enlace.texto}
                  <ExternalLink size={12} aria-hidden />
                  <span className="sr-only"> (gob.pe, se abre en otra pestaña)</span>
                </a>
              </>
            )}
          </p>
        </div>
      )}
      {necesidad?.clave === "emergencia" && <DerechoEmergencia className="mt-4" />}

      <div className="mt-5 flex items-end gap-4">
        <VecinaUbicando buscando={ocupado} className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 pb-1 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => ubicar({ necesidad, seguro, h24 })}
            disabled={ocupado}
            aria-describedby="cerca-privacidad"
            className={claseAccion("primario", "min-h-14 w-full px-7 text-cuerpo disabled:cursor-wait disabled:opacity-80 sm:w-auto", "md")}
          >
            {ocupado ? <Loader2 size={19} aria-hidden className="motion-safe:animate-spin" /> : estado.fase === "inicio" ? <LocateFixed size={19} aria-hidden /> : <RotateCw size={18} aria-hidden />}
            {estado.fase === "ubicando" ? "Ubicándote…" : estado.fase === "buscando" ? "Buscando cerca de ti…" : estado.fase === "inicio" ? "Usar mi ubicación" : "Volver a ubicarme"}
          </button>
          <p id="cerca-privacidad" className="flex max-w-[52ch] gap-2 text-meta leading-relaxed text-inkSoft">
            <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
            <span>
              Tu ubicación no se guarda. A nuestro servidor llega redondeada a unos 100 metros; la distancia exacta se calcula en tu teléfono.
            </span>
          </p>
        </div>
      </div>

      <div aria-live="polite" className="sr-only">
        {estado.fase === "ubicando" ? "Ubicándote." : estado.fase === "buscando" ? "Buscando establecimientos cerca de ti." : ""}
      </div>

      {estado.fase === "error" && (
        <section aria-labelledby="cerca-error-t" className="relative mt-6 rounded-2xl border border-line bg-paperSoft p-4 sm:p-5 sm:pr-28">
          <VecinaPregunta className="absolute right-5 top-5 hidden sm:inline-flex" />
          <h2 id="cerca-error-t" ref={titulo} tabIndex={-1} className="flex items-start gap-2.5 font-display text-bloque font-bold leading-snug text-ink focus:outline-none">
            <TriangleAlert size={19} aria-hidden className="mt-0.5 shrink-0 text-crimsonTexto" />
            {MENSAJE[estado.motivo].titulo}
          </h2>
          <p className="mt-1.5 max-w-[64ch] text-dato leading-relaxed text-inkSoft">{MENSAJE[estado.motivo].texto}</p>
          <BuscadorSalud accion={rutaEn(base, "/buscar")} id="cerca-buscar-error" className="mt-4" />
        </section>
      )}

      {estado.fase === "listo" && (
        <section aria-labelledby="cerca-t" className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <h2 id="cerca-t" ref={titulo} tabIndex={-1} className="font-display text-seccion font-bold leading-tight text-ink focus:outline-none">
              {estado.necesidad
                ? estado.filas.length
                  ? `Lo más cercano que declaró ${estado.necesidad.tecnico}`
                  : `Ninguno cerca declaró ${estado.necesidad.tecnico}`
                : estado.filas.length
                  ? "Lo más cercano a ti"
                  : "No hay establecimientos registrados cerca"}
            </h2>
            {estado.filas.length > 0 && (
              <p className="flex items-center gap-1.5 text-meta text-inkSoft">
                <Crosshair size={14} aria-hidden className="shrink-0" />
                Tu ubicación tiene un margen de unos {numero(Math.max(5, Math.round(estado.margen / 5) * 5))} m
              </p>
            )}
          </div>

          {(estado.seguro || estado.h24) && (
            <p className="mt-1 text-dato font-medium text-ink">
              {estado.seguro ? estado.seguro.lista.charAt(0).toUpperCase() + estado.seguro.lista.slice(1) : "Activos"}
              {estado.h24 ? ", que declararon atender las 24 horas" : ""}.
            </p>
          )}
          {estado.necesidad && estado.cobertura && (
            <p className="mt-2 max-w-[72ch] text-dato leading-relaxed text-inkSoft">
              Sólo aparecen los activos que lo declararon en RENIPRESS y cuyos servicios ya leímos: {numero(estado.cobertura.revisados)} de{" "}
              {numero(estado.cobertura.total)} en unos {estado.radioKm} km a la redonda. Que lo hayan declarado no asegura cupo hoy: llama antes de ir.
            </p>
          )}
          {!estado.necesidad && estado.margen > 100 && estado.filas.length > 0 && (
            <p className="mt-2 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
              Dentro de un edificio la ubicación se desvía: si el tuyo no es el primero, revisa los que siguen.
            </p>
          )}

          {estado.filas.length > 0 ? (
            <>
              <ol className={cn("mt-4", PLACA_LISTA)} aria-label="Establecimientos de salud, del más cercano al más lejano">
                {(todas ? estado.filas : estado.filas.slice(0, PRIMERAS)).map((x) => {
                  const fila = x.enRegistro ? x : { ...x, activo: false, estado: "Ya no figura en RENIPRESS" };
                  return (
                    <li key={x.codigo}>
                      <FilaEstablecimiento x={fila} base={base}>
                        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta">
                          <Dato icono={Navigation} nombre="Distancia" className="font-semibold text-ink">
                            {textoDistancia(x.metros)}
                          </Dato>
                          {x.direccion && <span className="min-w-0 text-inkSoft">{direccionLegible(x.direccion)}</span>}
                        </p>
                        {x.coincide && (
                          <p className="mt-1.5 text-meta">
                            <Dato icono={CircleCheck} nombre="Declaró en RENIPRESS" className="font-semibold text-mossTexto">
                              Declaró: {nombreServicio(x.coincide)}
                            </Dato>
                          </p>
                        )}
                      </FilaEstablecimiento>
                    </li>
                  );
                })}
              </ol>
              {!todas && estado.filas.length > PRIMERAS && (
                <button type="button" onClick={() => setTodas(true)} className={claseAccion("secundario", "mt-4 min-h-12 w-full sm:w-auto")}>
                  Ver las {estado.filas.length} más cercanas
                </button>
              )}
            </>
          ) : estado.necesidad ? (
            <p className="mt-2 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
              Eso no prueba que no lo atiendan: de muchos todavía no leemos sus servicios. Mira todos los cercanos y llama para preguntar.
            </p>
          ) : estado.seguro || estado.h24 ? (
            <p className="mt-2 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
              Ninguno cerca con eso. Elige «Cualquiera» o quita las 24 horas para ver todos los cercanos.
            </p>
          ) : (
            <p className="mt-2 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
              En unos 170 km a la redonda ningún establecimiento declaró su ubicación en RENIPRESS. Búscalo por su nombre.
            </p>
          )}

          {!estado.necesidad && !estado.seguro && !estado.h24 && (
            <div className="mt-6 rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
              <h3 className="font-display text-bloque font-bold leading-snug text-ink">¿No está el tuyo?</h3>
              <p className="mt-1 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
                La ubicación de cada establecimiento la declara él mismo en RENIPRESS
                {sinUbicacion ? <>, y {numero(sinUbicacion)} de {numero(total)} no la declararon</> : null}. Búscalo por su nombre, o pregunta en recepción con qué
                nombre o RUC está registrado.
              </p>
              <BuscadorSalud accion={rutaEn(base, "/buscar")} id="cerca-buscar" className="mt-4" />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Opcion({ activa, onClick, deshabilitada, children }: { activa: boolean; onClick: () => void; deshabilitada: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      disabled={deshabilitada}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido disabled:cursor-wait sm:min-h-9 [&_svg]:shrink-0",
        activa ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-granate/50 hover:bg-granate-50",
      )}
    >
      {children}
    </button>
  );
}

/** Lo que dice la ley de una emergencia o un parto: en cualquier establecimiento, con o sin seguro. */
function DerechoEmergencia({ className }: { className?: string }) {
  return (
    <div role="note" className={cn("flex gap-2.5 rounded-xl border border-crimson/30 bg-crimson-soft/50 px-3.5 py-3 text-meta leading-relaxed text-ink", className)}>
      <Siren size={16} aria-hidden className="mt-0.5 shrink-0 text-crimsonTexto" />
      <p className="max-w-[72ch]">
        <b className="font-semibold">En una emergencia o un parto, cualquier establecimiento, público o privado, tiene que atenderte</b>, con o sin seguro,
        mientras tu vida o tu salud estén en riesgo; el pago se ve después.{" "}
        <a href={URL_LEY_SALUD} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-4 hover:underline">
          Ley General de Salud, artículos 3 y 39<span className="sr-only"> (gob.pe, se abre en otra pestaña)</span>
        </a>
        . Si es grave, llama al <a href="tel:106" className="font-semibold text-ink underline underline-offset-2">106</a>.
      </p>
    </div>
  );
}
