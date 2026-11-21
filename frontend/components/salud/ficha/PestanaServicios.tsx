import { Ban, ChevronDown, Layers, Stethoscope, Video } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ListaPaginada } from "@/components/listado/Paginado";
import { Ayuda } from "@/components/patrones/Ayuda";
import { CabeceraPestana } from "@/components/patrones/Pestanas";
import { FuenteFecha } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { fechaCorta, nombrePropio, numero, rutaFicha, type FichaIpress, type Servicio } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { Bloque, DetallePendiente, detalleLeido, nombreServicio } from "./piezas";

/**
 * La pestaña «Servicios»: lo que RENIPRESS le registra a la IPRESS.
 *
 * 2026-11-21 (el usuario: «demasiado atosigante, sin jerarquías»): antes eran seis listas paginadas con sus códigos
 * (220000, 1-0005…) y el mismo peso para «Emergencia» que para «Servicio administrativo: logística-patrimonio». Ahora:
 *  1. Las unidades que atienden pacientes, como fichas cortas y sin códigos (el código queda en el título, para quien lo
 *     busque); las administrativas y las «actividades», plegadas debajo.
 *  2. Especialidades como fichas que se buscan, y la cartera de servicios en una lista corta.
 *  3. El desglose por unidad (UPS), plegado: en un hospital son cientos de filas, casi todas administrativas.
 *  4. Suspendidas y telesalud sólo como bloque si hay algo; si no, una línea.
 * Lo que es cada cosa y que RENIPRESS no autoriza procedimientos uno por uno, en una línea con su ⓘ. Server-safe.
 */

const activo = (e: string | null | undefined) => !e || /^ACTIV/i.test(e);
/** Las unidades que no atienden pacientes: servicios administrativos y «actividades» (urgencias, referencias, esterilización). */
const deApoyo = (s: Servicio) => /^actividad|administrativ|^del establecimiento/i.test(s.nombre ?? "");

/** Una unidad o especialidad como ficha corta: su nombre y, si no está activa, su estado. */
function Ficha({ s }: { s: Servicio }) {
  const ok = activo(s.estado);
  return (
    <span
      title={s.codigo ? `Código en RENIPRESS: ${s.codigo}` : undefined}
      className={cn(
        "inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-dato leading-snug",
        ok ? "border-line bg-paper text-ink" : "border-amber/45 bg-amber-soft/40 text-ink",
      )}
    >
      {s.estado !== undefined && <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", ok ? "bg-moss" : "bg-amber")} />}
      <span className="min-w-0">{nombreServicio(s.nombre)}</span>
      {!ok && s.estado && <span className="shrink-0 text-meta font-semibold text-amberTexto">{nombrePropio(s.estado)}</span>}
    </span>
  );
}

/** Fichas que se buscan y se paginan (las especialidades de un hospital pasan de cien). */
function Fichas({ items, nombre, placeholder, tam = 36 }: { items: Servicio[]; nombre: string; placeholder: string; tam?: number }) {
  return (
    <ListaPaginada
      nombre={nombre}
      tam={tam}
      controles="abajo"
      buscar={{ placeholder, etiqueta: `Buscar en ${nombre}` }}
      className="flex flex-wrap gap-2"
      items={items.map((s, i) => ({ id: `${s.codigo ?? "s"}-${i}`, buscable: `${s.nombre ?? ""} ${s.codigo ?? ""}`, contenido: <Ficha s={s} /> }))}
    />
  );
}

/** Una lista de frases largas (la cartera, el desglose por unidad): una por fila, sin códigos. */
function Filas({ items, nombre, placeholder, tam = 12, dos = false }: { items: Servicio[]; nombre: string; placeholder: string; tam?: number; dos?: boolean }) {
  return (
    <ListaPaginada
      nombre={nombre}
      tam={tam}
      controles="abajo"
      buscar={{ placeholder, etiqueta: `Buscar en ${nombre}` }}
      className={cn("grid gap-x-8 [&>li]:border-b [&>li]:border-line", dos && "md:grid-cols-2")}
      items={items.map((s, i) => ({
        id: `${s.codigo ?? "s"}-${i}`,
        buscable: `${s.nombre ?? ""} ${s.codigo ?? ""}`,
        contenido: (
          <p className="py-2.5 text-dato leading-snug text-ink" title={s.codigo ? `Código en RENIPRESS: ${s.codigo}` : undefined}>
            {nombreServicio(s.nombre)}
            {s.estado !== undefined && !activo(s.estado) && <span className="ml-2 text-meta font-semibold text-amberTexto">{nombrePropio(s.estado ?? "")}</span>}
          </p>
        ),
      }))}
    />
  );
}

/** Lo plegado: un resumen que se abre. */
function Plegado({ resumen, children }: { resumen: string; children: ReactNode }) {
  return (
    <details className="group mt-4 rounded-xl border border-line bg-paperSoft/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-dato font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {resumen}
        <ChevronDown size={16} aria-hidden className="shrink-0 text-mute transition-transform duration-rapido group-open:rotate-180" />
      </summary>
      <div className="border-t border-line px-4 py-3">{children}</div>
    </details>
  );
}

export function PestanaServicios({ f, base }: { f: FichaIpress; base: string }) {
  const renipress = f.fuentes.renipress?.url ?? "";
  if (!detalleLeido(f)) {
    return (
      <div className="space-y-4">
        <CabeceraPestana>Lo que RENIPRESS le registra: unidades, especialidades y cartera de servicios.</CabeceraPestana>
        <DetallePendiente url={renipress} />
        <Explica />
      </div>
    );
  }
  const d = f.detalle;
  const clinicas = d.upss.filter((u) => !deApoyo(u));
  const apoyo = d.upss.filter(deApoyo);
  const activas = d.upss.filter((u) => activo(u.estado)).length;
  const fuente = <FuenteFecha nombre="Detalle de RENIPRESS (SUSALUD)" url={f.fuentes.detalle?.url ?? renipress} al={d.leidoAl} />;
  const vacias = [
    !d.upssSuspendidas.length ? "ninguna unidad suspendida" : null,
    !d.consultores.length ? "ningún consultor de telesalud" : null,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <CabeceraPestana acciones={fuente} ayuda={<Explica />}>
        Lo que RENIPRESS le registra, como lo declaró la IPRESS.
      </CabeceraPestana>

      <Bloque
        id="upss"
        titulo="Unidades que atienden"
        icono={Layers}
        cuenta={numero(clinicas.length)}
        descripcion={
          d.upss.length
            ? `${activas === d.upss.length ? "Todas activas" : `${numero(activas)} de ${numero(d.upss.length)} activas`} en RENIPRESS${apoyo.length ? `, más ${numero(apoyo.length)} de apoyo` : ""}.`
            : undefined
        }
      >
        {clinicas.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="Unidades que atienden pacientes">
            {clinicas.map((s, i) => (
              <li key={`${s.codigo ?? "u"}-${i}`} className="min-w-0 max-w-full">
                <Ficha s={s} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-dato text-inkSoft">No figura ninguna unidad asistencial en el detalle de RENIPRESS consultado el {fechaCorta(d.leidoAl)}.</p>
        )}
        {apoyo.length > 0 && (
          <Plegado resumen={`Y ${numero(apoyo.length)} ${apoyo.length === 1 ? "unidad administrativa o de apoyo" : "unidades administrativas o de apoyo"}`}>
            <ul className="flex flex-wrap gap-2">
              {apoyo.map((s, i) => (
                <li key={`${s.codigo ?? "a"}-${i}`} className="min-w-0 max-w-full">
                  <Ficha s={s} />
                </li>
              ))}
            </ul>
          </Plegado>
        )}
      </Bloque>

      <Bloque id="especialidades" titulo="Especialidades" icono={Stethoscope} cuenta={numero(d.especialidades.length)}>
        {d.especialidades.length ? (
          <Fichas items={d.especialidades} nombre="las especialidades" placeholder="Buscar: cirugía plástica, pediatría…" tam={24} />
        ) : (
          <p className="text-dato text-inkSoft">No figura ninguna especialidad en RENIPRESS (consultado el {fechaCorta(d.leidoAl)}).</p>
        )}
      </Bloque>

      {/* La cartera y el desglose son frases largas y, en un hospital, cientos: plegados, se abren si se buscan. */}
      {d.cartera.length > 0 && (
        <Plegado resumen={`La cartera de servicios, en las palabras de RENIPRESS (${numero(d.cartera.length)})`}>
          <Filas items={d.cartera} nombre="la cartera de servicios" placeholder="Buscar un servicio: parto, ecografía…" dos />
        </Plegado>
      )}
      {d.ups.length > 0 && (
        <Plegado resumen={`El desglose de cada unidad en sus servicios (${numero(d.ups.length)})`}>
          <Filas items={d.ups} nombre="los servicios por unidad (UPS)" placeholder="Buscar un servicio de una unidad…" dos />
        </Plegado>
      )}

      {(d.upssSuspendidas.length > 0 || d.consultores.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {d.upssSuspendidas.length > 0 && (
            <Bloque id="suspendidas" titulo="Unidades suspendidas" icono={Ban} cuenta={numero(d.upssSuspendidas.length)}>
              <ul className="flex flex-wrap gap-2">
                {d.upssSuspendidas.map((s, i) => (
                  <li key={`${s.codigo ?? "x"}-${i}`} className="min-w-0 max-w-full">
                    <Ficha s={{ ...s, estado: s.estado ?? "Suspendida" }} />
                  </li>
                ))}
              </ul>
            </Bloque>
          )}
          {d.consultores.length > 0 && (
            <Bloque
              id="consultores"
              titulo="Consultores de telesalud"
              icono={Video}
              cuenta={numero(d.consultores.length)}
              descripcion="Los establecimientos que le dan teleconsulta o teleinterconsulta, según RENIPRESS."
            >
              <ul className="divide-y divide-line">
                {d.consultores.map((c, i) => (
                  <li key={`${c.codigo ?? "c"}-${i}`} className="flex min-h-11 items-center py-2.5">
                    {c.codigo && /^\d{8}$/.test(c.codigo) ? (
                      <Link href={rutaEn(base, rutaFicha(c.codigo))} prefetch={false} className="min-w-0 text-dato font-medium text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
                        {nombrePropio(c.nombre)}
                      </Link>
                    ) : (
                      <span className="min-w-0 text-dato text-ink">{nombrePropio(c.nombre)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Bloque>
          )}
        </div>
      )}
      {vacias.length > 0 && (
        <p className="text-meta text-mute">
          RENIPRESS no le registra {vacias.join(" ni ")} (consultado el {fechaCorta(d.leidoAl)}).
        </p>
      )}
    </div>
  );
}

/** Qué es cada lista y lo que RENIPRESS no dice, detrás de un ⓘ (antes era una tarjeta de tres columnas). */
function Explica() {
  return (
    <Ayuda titulo="¿Qué es cada lista?" etiqueta="Qué es cada lista de servicios">
      <span className="block">
        <b className="font-semibold">Unidad (UPSS):</b> un área completa del establecimiento: consulta externa, emergencia,
        centro quirúrgico, hospitalización.
      </span>
      <span className="mt-1 block">
        <b className="font-semibold">Especialidad:</b> las ramas de la medicina que declara atender.
      </span>
      <span className="mt-1 block">
        <b className="font-semibold">Cartera de servicios:</b> las prestaciones que declara ofrecer, en las palabras de RENIPRESS.
      </span>
      <span className="mt-1.5 block">
        RENIPRESS no autoriza procedimientos uno por uno: que algo figure aquí es lo que declaró la IPRESS. Para una cirugía,
        pregunta también dónde se hará y verifica al médico.
      </span>
    </Ayuda>
  );
}
