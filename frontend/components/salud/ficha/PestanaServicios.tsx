import { BadgeCheck, Ban, BookOpen, ClipboardList, Layers, ListChecks, Stethoscope, Video } from "lucide-react";
import Link from "next/link";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { ListaPaginada } from "@/components/listado/Paginado";
import { CabeceraPestana } from "@/components/patrones/Pestanas";
import { FuenteFecha } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { fechaCorta, nombrePropio, numero, rutaFicha, type FichaIpress, type Servicio } from "@/lib/gobserva-salud";
import { Bloque, DetallePendiente, detalleLeido, nombreServicio } from "./piezas";

/**
 * La pestaña «Servicios»: lo que RENIPRESS le registra a la IPRESS (UPSS con su estado, especialidades, cartera de
 * servicios, unidades, UPSS suspendidas y consultores de telesalud), cada lista entera y con buscador. Arriba, en tres
 * líneas, qué es cada cosa y que RENIPRESS no autoriza procedimientos uno por uno. Server-safe.
 */

const activo = (e: string | null | undefined) => !e || /^ACTIV/i.test(e);

function FilaServicio({ s, conEstado = true }: { s: Servicio; conEstado?: boolean }) {
  return (
    <div className="flex min-h-11 items-start justify-between gap-3 py-2.5">
      <span className="min-w-0 text-dato leading-snug text-ink">
        {nombreServicio(s.nombre)}
        {s.codigo && <span className="ml-2 font-mono text-rotulo tabular-nums text-mute">{s.codigo}</span>}
      </span>
      {conEstado && s.estado !== undefined && (
        <Insignia tono={activo(s.estado) ? "exito" : "aviso"} className="mt-0.5 shrink-0">
          {s.estado ? nombrePropio(s.estado) : "Activa"}
        </Insignia>
      )}
    </div>
  );
}

function Lista({ items, nombre, placeholder, conEstado = true, dosColumnas = false }: { items: Servicio[]; nombre: string; placeholder: string; conEstado?: boolean; dosColumnas?: boolean }) {
  return (
    <ListaPaginada
      nombre={nombre}
      tam={20}
      controles="abajo"
      buscar={{ placeholder, etiqueta: `Buscar en ${nombre}` }}
      // En dos columnas desde md (las unidades de un hospital son decenas): cada fila con su filete abajo.
      className={dosColumnas ? "grid gap-x-8 md:grid-cols-2 [&>li]:border-b [&>li]:border-line" : "divide-y divide-line"}
      items={items.map((s, i) => ({
        id: `${s.codigo ?? "s"}-${i}`,
        buscable: `${s.nombre ?? ""} ${s.codigo ?? ""}`,
        contenido: <FilaServicio s={s} conEstado={conEstado} />,
      }))}
    />
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
  const upssActivas = d.upss.filter((u) => activo(u.estado)).length;
  const fuente = <FuenteFecha nombre="Detalle de RENIPRESS (SUSALUD)" url={f.fuentes.detalle?.url ?? renipress} al={d.leidoAl} />;
  return (
    <div className="space-y-5">
      <CabeceraPestana acciones={fuente}>
        Lo que RENIPRESS le registra, como lo declaró la IPRESS. Cada lista está entera y se puede buscar.
      </CabeceraPestana>
      <Explica />

      <Bloque
        id="upss"
        titulo="Unidades de servicios (UPSS)"
        icono={Layers}
        cuenta={numero(d.upss.length)}
        descripcion={d.upss.length ? `${numero(upssActivas)} ${upssActivas === 1 ? "activa" : "activas"} de ${numero(d.upss.length)}, con su estado en RENIPRESS.` : undefined}
       
      >
        {d.upss.length ? (
          <Lista items={d.upss} nombre="las unidades (UPSS)" placeholder="Buscar una unidad: emergencia, centro quirúrgico…" dosColumnas />
        ) : (
          <p className="text-dato text-inkSoft">No figura ninguna UPSS en el detalle de RENIPRESS consultado el {fechaCorta(d.leidoAl)}.</p>
        )}
      </Bloque>

      <div className="grid gap-5 xl:grid-cols-2">
        <Bloque id="especialidades" titulo="Especialidades" icono={Stethoscope} cuenta={numero(d.especialidades.length)}>
          {d.especialidades.length ? (
            <Lista items={d.especialidades} nombre="las especialidades" placeholder="Buscar: cirugía plástica, pediatría…" conEstado={false} />
          ) : (
            <p className="text-dato text-inkSoft">No figura ninguna especialidad en RENIPRESS (consultado el {fechaCorta(d.leidoAl)}).</p>
          )}
        </Bloque>
        <Bloque id="cartera" titulo="Cartera de servicios" icono={ClipboardList} cuenta={numero(d.cartera.length)}>
          {d.cartera.length ? (
            <Lista items={d.cartera} nombre="la cartera de servicios" placeholder="Buscar un servicio: parto, ecografía…" conEstado={false} />
          ) : (
            <p className="text-dato text-inkSoft">No figura una cartera de servicios en RENIPRESS (consultado el {fechaCorta(d.leidoAl)}).</p>
          )}
        </Bloque>
      </div>

      {d.ups.length > 0 && (
        <Bloque
          id="ups"
          titulo="Servicios por unidad (UPS)"
          icono={ListChecks}
          cuenta={numero(d.ups.length)}
          descripcion="El desglose de cada unidad en sus servicios (por ejemplo, «Consulta externa-cirugía plástica»)."
         
        >
          <Lista items={d.ups} nombre="los servicios por unidad (UPS)" placeholder="Buscar un servicio de una unidad…" dosColumnas />
        </Bloque>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Bloque id="suspendidas" titulo="UPSS suspendidas" icono={Ban} cuenta={numero(d.upssSuspendidas.length)}>
          {d.upssSuspendidas.length ? (
            <Lista items={d.upssSuspendidas} nombre="las UPSS suspendidas" placeholder="Buscar una unidad suspendida…" />
          ) : (
            <p className="text-dato text-inkSoft">No figura ninguna UPSS suspendida en RENIPRESS (consultado el {fechaCorta(d.leidoAl)}).</p>
          )}
        </Bloque>
        <Bloque
          id="consultores"
          titulo="Consultores de telesalud"
          icono={Video}
          cuenta={numero(d.consultores.length)}
          descripcion="Los establecimientos que le dan teleconsulta o teleinterconsulta, según RENIPRESS."
         
        >
          {d.consultores.length ? (
            <ul className="divide-y divide-line">
              {d.consultores.map((c, i) => (
                <li key={`${c.codigo ?? "c"}-${i}`} className="flex min-h-11 items-center justify-between gap-3 py-2.5">
                  {c.codigo && /^\d{8}$/.test(c.codigo) ? (
                    <Link href={rutaEn(base, rutaFicha(c.codigo))} prefetch={false} className="min-w-0 text-dato font-medium text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
                      {nombrePropio(c.nombre)}
                    </Link>
                  ) : (
                    <span className="min-w-0 text-dato text-ink">{nombrePropio(c.nombre)}</span>
                  )}
                  {c.codigo && <span className="shrink-0 font-mono text-rotulo tabular-nums text-mute">{c.codigo}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-dato text-inkSoft">No figura ningún consultor de telesalud en RENIPRESS (consultado el {fechaCorta(d.leidoAl)}).</p>
          )}
        </Bloque>
      </div>
    </div>
  );
}


/** Qué es cada lista, en tres líneas con su ícono, y lo que RENIPRESS no dice. */
function Explica() {
  const items = [
    { Icono: Layers, t: "Unidad (UPSS)", d: "Un área completa del establecimiento: consulta externa, emergencia, centro quirúrgico, hospitalización." },
    { Icono: Stethoscope, t: "Especialidad", d: "Las ramas de la medicina que declara atender (cirugía plástica, pediatría…)." },
    { Icono: BookOpen, t: "Cartera de servicios", d: "Las prestaciones que declara ofrecer, en las palabras de RENIPRESS." },
  ];
  return (
    <div className="tarjeta rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5">
      <ul className="grid gap-3 md:grid-cols-3">
        {items.map(({ Icono, t, d }) => (
          <li key={t} className="flex min-w-0 items-start gap-2.5">
            <Icono size={17} aria-hidden className="mt-0.5 shrink-0 text-granate" />
            <span className="min-w-0 text-meta leading-snug text-inkSoft">
              <span className="block text-dato font-semibold text-ink">{t}</span>
              {d}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-start gap-2.5 border-t border-line pt-3 text-meta leading-snug text-inkSoft">
        <BadgeCheck size={17} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
        <span>
          <span className="font-semibold text-ink">RENIPRESS no autoriza procedimientos uno por uno.</span> Que una especialidad o un servicio figure aquí
          es lo que declaró la IPRESS; para una cirugía, pregunta también dónde se hará y verifica al médico.
        </span>
      </p>
    </div>
  );
}
