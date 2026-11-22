import Link from "next/link";
import { cn } from "@/lib/utils";
import { Ban, Building2, ClipboardCheck, FileText, Hash, Landmark, MapPin, Receipt } from "lucide-react";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { ListaPaginada } from "@/components/listado/Paginado";
import { InsigniaCategoria } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { fechaCorta, nombrePropio, numero, rutaFicha, type FichaIpress } from "@/lib/gobserva-salud";
import { soles } from "@/lib/formato";
import { Bloque, EnlaceOficial } from "./piezas";

/**
 * Debajo de las pestañas: lo que Vigía (el proyecto cívico de Gobserva) sabe del RUC del propietario (SUNAT, contratos
 * con el Estado, informes de control) y las otras sedes con el mismo RUC en RENIPRESS. Server-safe.
 */

type EmpresaVigia = NonNullable<NonNullable<FichaIpress["vigia"]>["empresa"]>;

/** «13 órdenes por S/ 213,860 con 8 entidades.» Sólo lo que trae Vigía; sin nada, lo dice. */
function contratos(e: EmpresaVigia): string {
  const partes: string[] = [];
  if (e.procesos) partes.push(`${numero(e.procesos)} ${e.procesos === 1 ? "proceso ganado" : "procesos ganados"}${e.monto ? ` por ${soles(e.monto)}` : ""}`);
  if (e.ordenes) partes.push(`${numero(e.ordenes)} ${e.ordenes === 1 ? "orden de compra o de servicio" : "órdenes de compra o de servicio"}${e.ordenesMonto ? ` por ${soles(e.ordenesMonto)}` : ""}`);
  if (!partes.length) return "Vigía no le registra procesos ganados ni órdenes.";
  const con = e.entidades ? `, con ${numero(e.entidades)} ${e.entidades === 1 ? "entidad" : "entidades"}` : "";
  return `${partes.join(" y ")}${con}.`.replace(/^./, (c) => c.toUpperCase());
}

function Vigia({ v }: { v: NonNullable<FichaIpress["vigia"]> }) {
  const e = v.empresa;
  return (
    <Bloque
      titulo="Su empresa ante SUNAT y el Estado"
      icono={Landmark}
      descripcion="Del RUC del propietario: su estado en SUNAT y sus contratos con el Estado, con datos de Vigía (el proyecto de Gobserva que sigue las compras públicas)."
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-dato text-ink">
          <Hash size={14} aria-hidden className="text-mute" />
          <span className="text-meta text-mute">RUC</span>
          <span className="font-mono tabular-nums">{v.ruc}</span>
        </span>
        {v.sunat?.estado && <Insignia tono={/^ACTIVO/i.test(v.sunat.estado) ? "exito" : "aviso"}>{`SUNAT: ${v.sunat.estado.toLowerCase()}`}</Insignia>}
        {v.sunat?.condicion && <Insignia tono={/^HABIDO/i.test(v.sunat.condicion) ? "neutro" : "aviso"}>{`Condición: ${v.sunat.condicion.toLowerCase()}`}</Insignia>}
      </div>

      <ul className="mt-4 space-y-3">
        {e && (
          <li className="flex items-start gap-2.5">
            <Receipt size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            <span className="min-w-0 text-dato leading-snug text-inkSoft">
              <span className="block font-semibold text-ink">Contratos con el Estado</span>
              {contratos(e)} <EnlaceOficial href={e.url}>Ver la empresa en Vigía</EnlaceOficial>
            </span>
          </li>
        )}
        {e?.inhabilitada && (
          <li className="flex items-start gap-2.5">
            <Ban size={16} aria-hidden className="mt-0.5 shrink-0 text-crimsonTexto" />
            <span className="min-w-0 text-dato leading-snug text-ink">
              Inhabilitada para contratar con el Estado{e.inhabilitadaHasta ? ` hasta el ${fechaCorta(e.inhabilitadaHasta)}` : ""}, según Vigía.
            </span>
          </li>
        )}
        {v.entidad && (
          <li className="flex items-start gap-2.5">
            <Building2 size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            <span className="min-w-0 text-dato leading-snug text-inkSoft">
              <span className="block font-semibold text-ink">Es una entidad pública</span>
              {nombrePropio(v.entidad.nombre)}. <EnlaceOficial href={v.entidad.url}>Ver la entidad en Vigía</EnlaceOficial>
            </span>
          </li>
        )}
        {v.informesControl && (
          <li className="flex items-start gap-2.5">
            <ClipboardCheck size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            <span className="min-w-0 text-dato leading-snug text-inkSoft">
              <span className="block font-semibold text-ink">Informes de control de la Contraloría</span>
              {numero(v.informesControl.total)} {v.informesControl.total === 1 ? "informe" : "informes"}
              {v.informesControl.ultimo ? `, el último del ${fechaCorta(v.informesControl.ultimo)}` : ""}.{" "}
              <EnlaceOficial href={v.informesControl.url}>Verlos en Vigía</EnlaceOficial>
            </span>
          </li>
        )}
        {!e && !v.entidad && !v.informesControl && (
          <li className="flex items-start gap-2.5 text-dato text-inkSoft">
            <FileText size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            Vigía no le registra contratos con el Estado ni informes de control.
          </li>
        )}
      </ul>
    </Bloque>
  );
}

function OtrasSedes({ sedes, total, base }: { sedes: FichaIpress["mismaEmpresa"]; total: number; base: string }) {
  const n = Math.max(total, sedes.length);
  return (
    <Bloque
      titulo="Otras sedes de la misma empresa"
      icono={Building2}
      cuenta={numero(n)}
      descripcion={n > sedes.length ? `Con el mismo RUC de propietario en RENIPRESS. Aquí van ${numero(sedes.length)}: las activas primero.` : "Con el mismo RUC de propietario en RENIPRESS."}
    >
      <ListaPaginada
        nombre="las otras sedes"
        tam={10}
        controles="abajo"
        buscar={{ placeholder: "Buscar una sede por nombre o distrito…", etiqueta: "Buscar en las otras sedes" }}
        className="divide-y divide-line"
        items={sedes.map((s) => ({
          id: s.codigo,
          buscable: `${s.nombre} ${s.distrito ?? ""} ${s.departamento ?? ""} ${s.codigo}`,
          contenido: (
            <Link
              href={rutaEn(base, rutaFicha(s.codigo))}
              prefetch={false}
              className="group flex min-h-12 items-start justify-between gap-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
            >
              <span className="min-w-0">
                <span className="block text-dato font-semibold text-ink group-hover:text-granate">{nombrePropio(s.nombre)}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-meta text-mute">
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={12} aria-hidden />
                    {[nombrePropio(s.distrito), nombrePropio(s.departamento)].filter(Boolean).join(", ") || "Sin lugar"}
                  </span>
                  <span className="font-mono">{s.codigo}</span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <InsigniaCategoria categoria={s.categoria} />
                {!s.activo && <Insignia tono="aviso">{(s.estado ?? "Inactiva").toLowerCase()}</Insignia>}
              </span>
            </Link>
          ),
        }))}
      />
    </Bloque>
  );
}

export function RelacionadosFicha({ f, base }: { f: FichaIpress; base: string }) {
  if (!f.vigia && !f.mismaEmpresa.length) return null;
  return (
    // Dos columnas sólo si hay las dos cosas: una sola tarjeta a media página dejaba la otra mitad vacía (2026-11-22).
    <section
      aria-label="La empresa detrás del establecimiento"
      className={cn("grid gap-5 lg:items-start", f.vigia && f.mismaEmpresa.length > 0 && "lg:grid-cols-2")}
    >
      {f.vigia && <Vigia v={f.vigia} />}
      {f.mismaEmpresa.length > 0 && <OtrasSedes sedes={f.mismaEmpresa} total={f.mismaEmpresaTotal ?? 0} base={base} />}
    </section>
  );
}
