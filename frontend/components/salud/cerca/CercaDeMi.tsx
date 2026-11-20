"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, LocateFixed, Navigation, RotateCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { direccionLegible } from "@/components/salud/ficha/piezas";
import { FilaEstablecimiento } from "@/components/salud/lista/FilaEstablecimiento";
import { BuscadorSalud } from "@/components/salud/portada/BuscadorSalud";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { Dato } from "@/components/ui/Dato";
import { rutaEn } from "@/lib/gobserva";
import { URL_CERCA_SALUD, distanciaMetros, numero, redondearCoordenada, textoDistancia, type Cercanos, type FilaCercana } from "@/lib/gobserva-salud";

type Motivo = "denegado" | "no_disponible" | "tiempo" | "sin_soporte" | "fuera" | "limite" | "red";
type Estado =
  | { fase: "inicio" }
  | { fase: "ubicando" }
  | { fase: "buscando" }
  | { fase: "listo"; filas: (FilaCercana & { metros: number })[]; margen: number }
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
 * «Estoy en un establecimiento» (Gobserva Salud): para quien ya está adentro de una clínica y quiere verificarla sin saber
 * su nombre exacto. Pide la ubicación al tocar el botón (o al abrir la página desde el botón de la portada, `auto`), manda
 * a la API sólo la ubicación redondeada a unos 110 m (POST /salud/cerca, en el cuerpo) y con la ubicación exacta, que no
 * sale del teléfono, calcula la distancia y ordena. Muestra las más cercanas con la fila de siempre (estado, categoría,
 * sanciones) y su distancia; también las que tienen baja o ya no figuran en RENIPRESS. Nunca dice «estás en tal clínica»:
 * el GPS se equivoca adentro de un edificio y la ubicación de cada IPRESS la declaró ella misma.
 */
export function CercaDeMi({
  base,
  auto = false,
  conUbicacion,
  total,
}: {
  base: string;
  auto?: boolean;
  /** Cuántas IPRESS tienen ubicación en RENIPRESS y cuántas hay (GET /salud/resumen), para decir cuántas no se pueden encontrar así. */
  conUbicacion: number | null;
  total: number | null;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "inicio" });
  const [todas, setTodas] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const pedido = useRef(0);

  const buscar = useCallback(async (lat: number, lon: number, margen: number, n: number) => {
    setEstado({ fase: "buscando" });
    try {
      const r = await fetch(URL_CERCA_SALUD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: redondearCoordenada(lat), lon: redondearCoordenada(lon) }),
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
      setEstado({ fase: "listo", filas, margen });
    } catch {
      if (n === pedido.current) setEstado({ fase: "error", motivo: "red" });
    }
  }, []);

  const ubicar = useCallback(() => {
    const n = ++pedido.current;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return setEstado({ fase: "error", motivo: "sin_soporte" });
    setEstado({ fase: "ubicando" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (n !== pedido.current) return;
        void buscar(p.coords.latitude, p.coords.longitude, p.coords.accuracy, n);
      },
      (e) => {
        if (n !== pedido.current) return;
        setEstado({ fase: "error", motivo: e.code === e.PERMISSION_DENIED ? "denegado" : e.code === e.TIMEOUT ? "tiempo" : "no_disponible" });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  }, [buscar]);

  // Desde el botón de la portada («Estoy en un establecimiento»): esa fue la intención, se pide la ubicación al llegar.
  const yaPidio = useRef(false);
  useEffect(() => {
    if (auto && !yaPidio.current) {
      yaPidio.current = true;
      ubicar();
    }
  }, [auto, ubicar]);

  // Con los resultados, el foco va a su título (el lector de pantalla lo anuncia y el teclado sigue desde ahí).
  useEffect(() => {
    if (estado.fase === "listo" || estado.fase === "error") titulo.current?.focus();
  }, [estado.fase]);

  const ocupado = estado.fase === "ubicando" || estado.fase === "buscando";
  const sinUbicacion = conUbicacion != null && total != null && total > conUbicacion ? total - conUbicacion : null;

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={ubicar}
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

      <div aria-live="polite" className="sr-only">
        {estado.fase === "ubicando" ? "Ubicándote." : estado.fase === "buscando" ? "Buscando establecimientos cerca de ti." : ""}
      </div>

      {estado.fase === "error" && (
        <section aria-labelledby="cerca-error-t" className="mt-6 rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
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
              {estado.filas.length ? "Lo más cercano a ti" : "No hay establecimientos registrados cerca"}
            </h2>
            {estado.filas.length > 0 && (
              <p className="flex items-center gap-1.5 text-meta text-inkSoft">
                <Crosshair size={14} aria-hidden className="shrink-0" />
                Tu ubicación tiene un margen de unos {numero(Math.max(5, Math.round(estado.margen / 5) * 5))} m
              </p>
            )}
          </div>
          {estado.margen > 100 && estado.filas.length > 0 && (
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
          ) : (
            <p className="mt-2 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
              En unos 170 km a la redonda ningún establecimiento declaró su ubicación en RENIPRESS. Búscalo por su nombre.
            </p>
          )}

          <div className="mt-6 rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
            <h3 className="font-display text-bloque font-bold leading-snug text-ink">¿No está el tuyo?</h3>
            <p className="mt-1 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
              La ubicación de cada establecimiento la declara él mismo en RENIPRESS
              {sinUbicacion ? <>, y {numero(sinUbicacion)} de {numero(total)} no la declararon</> : null}. Búscalo por su nombre, o pregunta en recepción con qué
              nombre o RUC está registrado.
            </p>
            <BuscadorSalud accion={rutaEn(base, "/buscar")} id="cerca-buscar" className="mt-4" />
          </div>
        </section>
      )}
    </div>
  );
}
