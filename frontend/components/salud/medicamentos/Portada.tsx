import Link from "next/link";
import { Bell, ChevronRight, Database, Landmark, Pill, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { rutaEn } from "@/lib/gobserva";
import { fechaCorta, numero, type AlertaDigemid, type FuenteMedicamentos } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { BuscadorMedicamento } from "./BuscadorMedicamento";
import { InsigniaAlerta } from "./piezas";

/**
 * La entrada de «Verifica un medicamento» (2026-11-22, la maqueta del usuario: «debe ser algo así»): el titular con
 * las cifras y una ilustración de píxeles (la caja, el blíster y el escudo con el visto), la tarjeta de búsqueda con sus
 * dos pestañas montada sobre el borde, «¿Qué puedes verificar?», las alertas recientes en una línea cada una y la franja
 * de las fuentes. Debajo va el catálogo. La insignia dice «con datos oficiales»: Gobserva no es DIGEMID. Server-safe
 * (la tarjeta de búsqueda es de cliente).
 */
export function PortadaMedicamentos({
  base,
  lista,
  fuente,
  alertas,
  modoInicial,
}: {
  base: string;
  lista: string;
  fuente: FuenteMedicamentos | null;
  alertas: AlertaDigemid[];
  modoInicial: "texto" | "foto";
}) {
  const QUE: { sprite: NombreSprite; escala: number; titulo: string; texto: string; href: string }[] = [
    { sprite: "escudoCheck", escala: 2, titulo: "El registro sanitario", texto: "Si tiene autorización y qué alertas lo nombran", href: "#buscar-medicamento" },
    { sprite: "medCaja", escala: 2, titulo: "El lote", texto: "Si DIGEMID lo retiró o lo observó", href: `${rutaEn(base, "/alertas")}?vista=productos` },
    { sprite: "iconoCalendario", escala: 3, titulo: "El vencimiento", texto: "Lo leemos de la foto de la caja", href: `${lista}?modo=foto#buscar` },
  ];
  return (
    <>
      <section aria-labelledby="verifica-t" className="mt-3 rounded-3xl border border-granate/15 bg-granate-50 px-5 pb-16 pt-6 sm:px-8 sm:pb-20 sm:pt-8">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full bg-paper px-3 py-1 text-meta font-semibold text-granate ring-1 ring-granate/20">
              <ShieldCheck size={15} aria-hidden />
              Con datos oficiales de DIGEMID
            </p>
            <h1 id="verifica-t" className="mt-4 text-balance font-display text-titulo font-bold leading-[1.05] tracking-[-0.025em] text-ink sm:text-vitrina">
              Verifica un <span className="text-granate">medicamento</span>
            </h1>
            <p className="mt-3 max-w-[54ch] text-pretty text-cuerpo leading-relaxed text-inkSoft sm:text-destacado">
              Consulta su registro sanitario, mira si DIGEMID emitió una alerta y comprueba si su lote fue retirado. Y compara su precio con el de los
              genéricos.
            </p>
            {fuente && (
              <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-dato text-inkSoft">
                <span className="inline-flex items-center gap-2">
                  <Pill size={16} aria-hidden className="text-granate" />
                  <b className="font-semibold tabular-nums text-ink">{numero(fuente.productos)}</b> medicamentos con precio
                </span>
                <span aria-hidden className="hidden h-4 w-px bg-granate/25 sm:block" />
                <span className="inline-flex items-center gap-2">
                  <TriangleAlert size={16} aria-hidden className="text-amberTexto" />
                  <b className="font-semibold tabular-nums text-ink">{numero(fuente.alertas)}</b> alertas de DIGEMID
                </span>
              </p>
            )}
          </div>
          <Ilustracion />
        </div>
      </section>

      {/* La tarjeta de búsqueda, montada sobre el borde de la portada. */}
      <div id="buscar" className="relative -mt-12 scroll-mt-24 sm:mx-6 sm:-mt-14 lg:mx-10">
        <BuscadorMedicamento accion={lista} modoInicial={modoInicial} />
      </div>

      <section aria-labelledby="que-t" className="mt-8">
        <h2 id="que-t" className="font-display text-seccion font-bold leading-tight text-ink">
          ¿Qué puedes verificar?
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {QUE.map((x) => (
            <li key={x.titulo}>
              <Link
                href={x.href}
                className="gs-hunde group flex h-full items-center gap-4 rounded-2xl border border-line bg-paper px-4 py-3.5 transition-colors duration-rapido hover:border-granate/50"
              >
                <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-granate-50">
                  <Pixel nombre={x.sprite} escala={x.escala} animado={false} acento="accion" />
                </span>
                <span className="min-w-0">
                  <span className="block text-cuerpo font-semibold text-ink group-hover:text-granate">{x.titulo}</span>
                  <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{x.texto}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {alertas.length > 0 && <AlertasRecientes base={base} alertas={alertas} fuente={fuente} />}

      {fuente && (
        <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-paperSoft px-5 py-3 text-meta text-inkSoft">
          <span className="inline-flex items-center gap-2">
            <Landmark size={16} aria-hidden className="text-mute" />
            DIGEMID, Ministerio de Salud
          </span>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <span className="inline-flex items-center gap-2">
            <Database size={16} aria-hidden className="text-mute" />
            Alertas y Observatorio de precios
          </span>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <span className="inline-flex items-center gap-2">
            <RefreshCw size={15} aria-hidden className="text-mute" />
            Revisado el {fechaCorta(fuente.avisos.al)}
          </span>
        </p>
      )}
    </>
  );
}

/** La caja, el blíster y el escudo con el visto, en píxeles (decorativo). */
function Ilustracion() {
  return (
    <div aria-hidden className={cn("relative hidden shrink-0 md:block")} style={{ width: 300, height: 200 }}>
      <span className="absolute" style={{ left: 0, top: 54 }}>
        <Pixel nombre="medCaja" escala={7} animado={false} acento="accion" />
      </span>
      <span className="absolute" style={{ left: 96, top: 120 }}>
        <Pixel nombre="medTableta" escala={5} animado={false} acento="accion" />
      </span>
      <span className="absolute" style={{ right: 0, top: 26 }}>
        <Pixel nombre="escudoCheck" escala={5} animado={false} acento="accion" />
      </span>
      {/* Tres destellos sobre el escudo (lo verificado), separados de su borde. */}
      <span className="absolute bg-granate" style={{ right: 70, top: 4, width: 6, height: 12 }} />
      <span className="absolute bg-granate" style={{ right: 42, top: 0, width: 6, height: 12 }} />
      <span className="absolute bg-granate" style={{ right: 14, top: 4, width: 6, height: 12 }} />
    </div>
  );
}

/** Las alertas recientes, una línea cada una: el tipo, el número y la fecha, y lo que dice. */
function AlertasRecientes({ base, alertas, fuente }: { base: string; alertas: AlertaDigemid[]; fuente: FuenteMedicamentos | null }) {
  const frase = (a: AlertaDigemid) => {
    const t = (a.motivo || a.titulo || "").replace(/\s*Descargar\s*$/i, "").trim();
    return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
  };
  return (
    <section aria-labelledby="recientes-t" className="mt-8 overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4">
        <h2 id="recientes-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
          <Bell size={19} aria-hidden className="text-crimsonTexto" />
          Alertas sanitarias recientes
        </h2>
        <p className="flex items-center gap-4 text-meta">
          {fuente && <span className="text-mute">Revisadas el {fechaCorta(fuente.avisos.al)}</span>}
          <Link href={rutaEn(base, "/alertas")} className="inline-flex min-h-11 items-center gap-0.5 font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
            Ver todas <ChevronRight size={15} aria-hidden />
          </Link>
        </p>
      </div>
      <ul className="divide-y divide-line">
        {/* recorte: tres, las más nuevas; «Ver todas» lleva a la lista entera. */}
        {alertas.slice(0, 3).map((a) => (
          <li key={a.id}>
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors duration-rapido hover:bg-ink/[0.02] sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]"
            >
              <span className="col-span-2 sm:col-span-1">
                <InsigniaAlerta tipo={a.tipo} />
              </span>
              <span className="min-w-0">
                <span className="block text-meta text-inkSoft">
                  {a.numero && <b className="font-semibold text-ink">Alerta N.° {a.numero}, </b>}
                  {fechaCorta(a.fecha)}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-dato font-semibold leading-snug text-ink group-hover:text-granate">{frase(a)}</span>
              </span>
              <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full border border-line text-inkSoft group-hover:border-granate/50 group-hover:text-granate">
                <ChevronRight size={17} />
              </span>
              <span className="sr-only"> (la alerta en la web de DIGEMID, se abre en otra pestaña)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
