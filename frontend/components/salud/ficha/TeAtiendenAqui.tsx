"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { CircleCheck, CircleHelp, LocateFixed, Phone, Search, X } from "lucide-react";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { DoctoraSaluda, VecinaPregunta } from "@/components/salud/pixel/Personajes";
import { rutaEn } from "@/lib/gobserva";
import { NECESIDADES_RAPIDAS, coincide, necesidadDe, terminosDe, type Necesidad } from "@/lib/salud-necesidades";
import { cn } from "@/lib/utils";
import type { ItemDeclarado } from "./atencion";

const PRIMEROS = 6;

/**
 * «¿Te pueden atender aquí?»: la persona escribe lo que necesita con sus palabras («dientes», «ecografía», «mi hijo tiene
 * fiebre») o toca un botón, y se busca en lo que el establecimiento declaró en RENIPRESS (especialidades, servicios,
 * cartera y unidades). Si está, se dice cómo lo declaró; si no, que eso no prueba que no lo atiendan y dónde buscar
 * otro cerca que sí lo declaró. Todo en el navegador, sin pedidos.
 */
export function TeAtiendenAqui({
  items,
  leido,
  telefono,
  base,
  renipressUrl,
}: {
  items: ItemDeclarado[];
  leido: boolean;
  telefono: string | null;
  base: string;
  renipressUrl: string;
}) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [boton, setBoton] = useState<string | null>(null);
  const [todos, setTodos] = useState(false);

  const consulta = useMemo(() => {
    const n = necesidadDe(boton);
    if (n) return { necesidades: [n], terminos: n.terminos, texto: n.etiqueta };
    const t = terminosDe(texto);
    return { ...t, texto: texto.trim() };
  }, [boton, texto]);

  // Lo más directo primero: el nombre más corto («Pediatría» antes que «Cirugía pediátrica») y, a igual largo, la
  // especialidad antes que el servicio, la atención y la unidad.
  const hallados = useMemo(() => {
    if (!consulta.terminos.length) return [];
    const orden = { Especialidad: 0, Servicio: 1, Atención: 2, Unidad: 3 } as const;
    return items.filter((x) => coincide(x.n, consulta.terminos)).sort((a, b) => a.n.length - b.n.length || orden[a.tipo] - orden[b.tipo]);
  }, [items, consulta]);
  const hay = consulta.terminos.length > 0;
  const necesidad: Necesidad | null = consulta.necesidades[0] ?? null;
  const tel = telefono && !telefono.includes("•") ? telefono : null;

  // Sin el detalle no hay en qué buscar: se dice, con la consulta oficial y los cercanos que ya lo declararon.
  if (!leido) {
    return (
      <div className="text-dato leading-relaxed text-inkSoft">
        <p className="max-w-[70ch]">
          Cuando leamos sus servicios podrás buscar aquí. Mientras,{" "}
          <a href={renipressUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-4 hover:underline">
            míralos en la consulta oficial de SUSALUD
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>{" "}
          o busca cerca de ti los que ya declararon lo que necesitas.
        </p>
        <Link href={rutaEn(base, "/cerca")} className="mt-1 flex min-h-11 items-center gap-1.5 font-semibold text-granate underline-offset-4 hover:underline">
          <LocateFixed size={15} aria-hidden /> Buscar cerca de ti por lo que necesitas
        </Link>
      </div>
    );
  }

  const elegir = (clave: string) => {
    setTodos(false);
    setTexto("");
    setBoton((b) => (b === clave ? null : clave));
  };

  return (
    <div className="min-w-0">
      <form role="search" onSubmit={(e) => e.preventDefault()} aria-label="Buscar si te pueden atender aquí" className="relative">
        <label htmlFor={`${id}-q`} className="sr-only">
          Qué necesitas: una especialidad, un examen o lo que te pasa
        </label>
        <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
        <input
          id={`${id}-q`}
          type="search"
          value={texto}
          onChange={(e) => {
            setBoton(null);
            setTodos(false);
            setTexto(e.target.value);
          }}
          maxLength={80}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Ej.: dientes, ecografía"
          className="h-12 w-full rounded-2xl border border-line bg-caja pl-11 pr-11 text-cuerpo text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 [&::-webkit-search-cancel-button]:hidden"
        />
        {texto && (
          <button
            type="button"
            onClick={() => setTexto("")}
            aria-label="Borrar"
            className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-mute hover:bg-ink/[0.06] hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </form>

      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Lo que más se busca">
        {NECESIDADES_RAPIDAS.map((n) => (
          <li key={n.clave}>
            <button
              type="button"
              aria-pressed={boton === n.clave}
              onClick={() => elegir(n.clave)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido sm:min-h-9",
                boton === n.clave ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-granate/50 hover:bg-granate-50",
              )}
            >
              {n.etiqueta}
            </button>
          </li>
        ))}
      </ul>

      <div aria-live="polite" className="mt-4 empty:hidden">
        {hay && hallados.length > 0 && (
          <Respuesta
            Icono={CircleCheck}
            tono="exito"
            titulo={`Sí: declaró ${necesidad ? necesidad.tecnico : `«${consulta.texto}»`} en RENIPRESS`}
            personaje={<DoctoraSaluda clave={consulta.texto} escala={2.5} />}
          >
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-paper">
              {(todos ? hallados : hallados.slice(0, PRIMEROS)).map((x) => (
                <li key={`${x.tipo}-${x.n}`} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 text-dato leading-snug text-ink">{x.nombre}</span>
                  <span className="flex shrink-0 gap-1.5">
                    {x.suspendida && <Insignia tono="aviso">Suspendido</Insignia>}
                    <Insignia tono="neutro">{x.tipo}</Insignia>
                  </span>
                </li>
              ))}
            </ul>
            {!todos && hallados.length > PRIMEROS && (
              <button type="button" onClick={() => setTodos(true)} className="mt-2 inline-flex min-h-11 items-center text-meta font-semibold text-granate underline-offset-4 hover:underline">
                Ver las {hallados.length} coincidencias
              </button>
            )}
            <p className="mt-3 text-meta leading-relaxed text-inkSoft">
              Que lo haya declarado no asegura que hoy haya cupo ni un especialista de turno: llama antes de ir
              {tel ? (
                <>
                  {" "}al{" "}
                  <a href={`tel:${tel.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 font-mono font-semibold text-ink underline decoration-line underline-offset-2">
                    <Phone size={12} aria-hidden />
                    {tel}
                  </a>
                </>
              ) : null}
              .
            </p>
          </Respuesta>
        )}

        {hay && hallados.length === 0 && (
          <Respuesta Icono={CircleHelp} tono="neutro" personaje={<VecinaPregunta escala={2.5} />} titulo={`No encontramos ${necesidad ? necesidad.tecnico : `«${consulta.texto}»`} en lo que declaró`}>
            Eso no prueba que no te atiendan: pregunta antes de ir. Buscamos en sus especialidades, servicios y cartera de RENIPRESS.
            {necesidad && (
              <Link
                href={`${rutaEn(base, "/cerca")}?ubicar=1&necesidad=${necesidad.clave}`}
                className="mt-2 flex min-h-11 items-center gap-1.5 font-semibold text-granate underline-offset-4 hover:underline"
              >
                <LocateFixed size={15} aria-hidden /> Ver los cercanos a ti que declararon {necesidad.tecnico}
              </Link>
            )}
          </Respuesta>
        )}
      </div>
    </div>
  );
}

function Respuesta({
  Icono,
  tono,
  titulo,
  personaje,
  children,
}: {
  Icono: typeof CircleCheck;
  tono: "exito" | "neutro";
  titulo: string;
  /** Un personaje de píxeles que reacciona (decorativo): la doctora saluda, la vecina pregunta. */
  personaje?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex gap-4 rounded-2xl border p-4", tono === "exito" ? "border-moss/30 bg-moss/[0.07]" : "border-line bg-paperSoft")}>
      <div className="min-w-0 flex-1">
        <p className="flex items-start gap-2 text-cuerpo font-semibold leading-snug text-ink">
          <Icono size={19} aria-hidden className={cn("mt-0.5 shrink-0", tono === "exito" ? "text-mossTexto" : "text-mute")} />
          {titulo}
        </p>
        <div className="mt-1.5 text-dato leading-relaxed text-inkSoft">{children}</div>
      </div>
      {personaje && <div className="hidden shrink-0 self-end sm:block">{personaje}</div>}
    </div>
  );
}
