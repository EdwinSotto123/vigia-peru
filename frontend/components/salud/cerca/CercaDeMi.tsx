"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Crosshair, Loader2, LocateFixed, Navigation, RotateCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { direccionLegible, nombreServicio } from "@/components/salud/ficha/piezas";
import { FilaEstablecimiento } from "@/components/salud/lista/FilaEstablecimiento";
import { VecinaPregunta, VecinaUbicando } from "@/components/salud/pixel/Personajes";
import { BuscadorSalud } from "@/components/salud/portada/BuscadorSalud";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { Dato } from "@/components/ui/Dato";
import { rutaEn } from "@/lib/gobserva";
import { URL_CERCA_SALUD, distanciaMetros, numero, redondearCoordenada, textoDistancia, type Cercanos, type FilaCercana } from "@/lib/gobserva-salud";
import { NECESIDADES_RAPIDAS, necesidadDe, type Necesidad } from "@/lib/salud-necesidades";
import { cn } from "@/lib/utils";

type Motivo = "denegado" | "no_disponible" | "tiempo" | "sin_soporte" | "fuera" | "limite" | "red";
type Estado =
  | { fase: "inicio" }
  | { fase: "ubicando" }
  | { fase: "buscando" }
  | {
      fase: "listo";
      filas: (FilaCercana & { metros: number })[];
      margen: number;
      necesidad: Necesidad | null;
      radioKm: number;
      cobertura: Cercanos["cobertura"];
    }
  | { fase: "error"; motivo: Motivo };

const PRIMERAS = 8;

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
  conUbicacion,
  total,
}: {
  base: string;
  auto?: boolean;
  /** La clave de una necesidad (lib/salud-necesidades.ts) que llega en la URL: ?necesidad=dientes. */
  necesidadInicial?: string | null;
  /** Cuántas IPRESS tienen ubicación en RENIPRESS y cuántas hay (GET /salud/resumen), para decir cuántas no se pueden encontrar así. */
  conUbicacion: number | null;
  total: number | null;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "inicio" });
  const [necesidad, setNecesidad] = useState<Necesidad | null>(necesidadDe(necesidadInicial));
  const [todas, setTodas] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const pedido = useRef(0);
  const posicion = useRef<{ lat: number; lon: number; margen: number } | null>(null);

  const buscar = useCallback(async (lat: number, lon: number, margen: number, n: number, nec: Necesidad | null) => {
    setEstado({ fase: "buscando" });
    try {
      const r = await fetch(URL_CERCA_SALUD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: redondearCoordenada(lat), lon: redondearCoordenada(lon), ...(nec ? { terminos: nec.terminos } : {}) }),
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
      setEstado({ fase: "listo", filas, margen, necesidad: nec, radioKm: d.radioKm, cobertura: d.cobertura ?? null });
    } catch {
      if (n === pedido.current) setEstado({ fase: "error", motivo: "red" });
    }
  }, []);

  const ubicar = useCallback(
    (nec: Necesidad | null) => {
      const n = ++pedido.current;
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) return setEstado({ fase: "error", motivo: "sin_soporte" });
      setEstado({ fase: "ubicando" });
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (n !== pedido.current) return;
          posicion.current = { lat: p.coords.latitude, lon: p.coords.longitude, margen: p.coords.accuracy };
          void buscar(p.coords.latitude, p.coords.longitude, p.coords.accuracy, n, nec);
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

  // Cambiar lo que se necesita: con la ubicación ya tomada se vuelve a buscar sin pedirla de nuevo.
  const elegir = (nec: Necesidad | null) => {
    setNecesidad(nec);
    const p = posicion.current;
    if (p) void buscar(p.lat, p.lon, p.margen, ++pedido.current, nec);
    try {
      const u = new URL(window.location.href);
      if (nec) u.searchParams.set("necesidad", nec.clave);
      else u.searchParams.delete("necesidad");
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
      ubicar(necesidad);
    }
  }, [auto, ubicar, necesidad]);

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
            <Opcion activa={!necesidad} onClick={() => elegir(null)} deshabilitada={ocupado}>
              Ver todos
            </Opcion>
          </li>
          {opciones.map((n) => (
            <li key={n.clave}>
              <Opcion activa={necesidad?.clave === n.clave} onClick={() => elegir(necesidad?.clave === n.clave ? null : n)} deshabilitada={ocupado}>
                {n.etiqueta}
              </Opcion>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="mt-5 flex items-end gap-4">
        <VecinaUbicando buscando={ocupado} className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 pb-1 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => ubicar(necesidad)}
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
              <ol className="mt-4 space-y-3" aria-label="Establecimientos de salud, del más cercano al más lejano">
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
          ) : (
            <p className="mt-2 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
              En unos 170 km a la redonda ningún establecimiento declaró su ubicación en RENIPRESS. Búscalo por su nombre.
            </p>
          )}

          {!estado.necesidad && (
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
        "inline-flex min-h-11 items-center rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido disabled:cursor-wait sm:min-h-9",
        activa ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-granate/50 hover:bg-granate-50",
      )}
    >
      {children}
    </button>
  );
}
