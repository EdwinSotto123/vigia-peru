import { Clock, Hash, Hospital, Landmark, MapPin, Phone, ShieldAlert, ShieldCheck, CircleAlert } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Insignia, type Tono } from "@/components/gobserva/ui/Insignia";
import { Dato } from "@/components/ui/Dato";
import { InsigniaCategoria, InsigniaSector } from "@/components/salud/comun";
import { nombrePropio, type FichaIpress } from "@/lib/gobserva-salud";
import { direccionLegible } from "./piezas";

/** El estado de la IPRESS en RENIPRESS, en una insignia (siempre con su palabra). */
export function estadoRegistro(f: Pick<FichaIpress, "enRegistro" | "activo" | "estado">): { texto: string; tono: Tono; Icono: typeof ShieldCheck } {
  if (!f.enRegistro) return { texto: "Ya no figura en RENIPRESS", tono: "urgente", Icono: ShieldAlert };
  if (f.activo) return { texto: "Activa en RENIPRESS", tono: "exito", Icono: ShieldCheck };
  const e = (f.estado ?? "sin estado").toLowerCase();
  return { texto: `En RENIPRESS: ${e}`, tono: /baja|cierre|cancel/i.test(e) ? "urgente" : "aviso", Icono: /baja|cierre/i.test(e) ? ShieldAlert : CircleAlert };
}

/** «Calle Alfredo Salazar N° 350, San Isidro, Lima»: la dirección y su lugar, sin repetir provincia y región iguales. */
export function lugarCompleto(f: Pick<FichaIpress, "direccion" | "distrito" | "provincia" | "departamento">): string {
  const partes: string[] = [];
  for (const p of [direccionLegible(f.direccion), nombrePropio(f.distrito), nombrePropio(f.provincia), nombrePropio(f.departamento)]) {
    if (p && partes[partes.length - 1] !== p) partes.push(p);
  }
  return partes.join(", ");
}

/** «ESTABLECIMIENTO DE SALUD CON INTERNAMIENTO» → «Establecimiento de salud con internamiento». */
const oracion = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

/** Un teléfono que la privacidad tapó (un celular): se muestra tapado, sin enlace. */
const tapado = (t: string) => t.includes("•");
const marcable = (t: string) => t.replace(/[^\d+]/g, "");

/**
 * La identidad de la IPRESS (DESIGN_SYSTEM.md §14.2): el nombre, su categoría con lo que quiere decir, el sector y el
 * estado; abajo, cada dato con su ícono (tipo, institución, dirección, teléfono, horario y código) tal como lo da
 * RENIPRESS. Server-safe.
 */
export function CabeceraFicha({ f }: { f: FichaIpress }) {
  const nombre = nombrePropio(f.nombre);
  const estado = estadoRegistro(f);
  const lugar = lugarCompleto(f);
  const cat = f.categoriaInfo;
  return (
    <header className="min-w-0">
      <h1 className="text-balance font-display text-cifra font-bold leading-tight tracking-tight text-ink [overflow-wrap:anywhere] sm:text-titulo">{nombre}</h1>

      <ul aria-label="Categoría, sector y estado" className="mt-3 flex flex-wrap items-center gap-2">
        <li className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
          <InsigniaCategoria categoria={f.categoria} className="text-meta" />
          {cat ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-dato text-inkSoft">
              <span className="min-w-0">
                <span className="font-semibold text-ink">{cat.nombre}</span>
                <span className="text-mute">, {cat.nivel.toLowerCase()}</span>
              </span>
              <Ayuda titulo={`¿Qué es la categoría ${f.categoria}?`} etiqueta={`Qué es la categoría ${f.categoria}`}>
                {cat.detalle}
                <span className="mt-1.5 block text-rotulo text-mute">
                  Según la NTS N.° 021-MINSA/DGSP-V.03 (Categorías de Establecimientos del Sector Salud). La categoría la registra RENIPRESS.
                </span>
              </Ayuda>
            </span>
          ) : (
            <span className="text-dato text-mute">RENIPRESS no registra una categoría</span>
          )}
        </li>
        <li>
          <InsigniaSector sector={f.sector} />
        </li>
        <li>
          <Insignia tono={estado.tono} Icono={estado.Icono}>
            {estado.texto}
          </Insignia>
        </li>
      </ul>

      <ul aria-label="Datos del establecimiento" className="mt-4 grid gap-x-6 gap-y-2 text-dato text-inkSoft sm:grid-cols-2 [&_svg]:text-mute">
        {f.tipo && (
          <li className="min-w-0">
            <Dato icono={Hospital} nombre="Tipo">
              {oracion(f.tipo)}
              {f.clasificacion ? <span className="text-mute"> ({f.clasificacion.toLowerCase()})</span> : null}
            </Dato>
          </li>
        )}
        {/* «PRIVADO» ya lo dice la insignia del sector: la institución sólo si dice algo más (MINSA, EsSalud, un gobierno regional). */}
        {f.institucion && f.institucion !== "PRIVADO" && (
          <li className="min-w-0">
            <Dato icono={Landmark} nombre="Institución">
              {f.institucion.length <= 8 ? f.institucion : nombrePropio(f.institucion)}
            </Dato>
          </li>
        )}
        {lugar && (
          <li className="min-w-0 sm:col-span-2">
            <Dato icono={MapPin} nombre="Dirección">
              {lugar}
            </Dato>
          </li>
        )}
        {f.telefono && (
          <li className="min-w-0">
            <Dato icono={Phone} nombre="Teléfono">
              {tapado(f.telefono) ? (
                <span className="font-mono text-mute" title="Número de celular: lo tapamos por privacidad">
                  {f.telefono}
                </span>
              ) : (
                <a href={`tel:${marcable(f.telefono)}`} className="font-mono text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
                  {f.telefono}
                </a>
              )}
            </Dato>
          </li>
        )}
        {f.horario && (
          <li className="min-w-0">
            <Dato icono={Clock} nombre="Horario">
              {f.horario}
            </Dato>
          </li>
        )}
        <li className="min-w-0">
          <Dato icono={Hash} nombre="Código único de IPRESS" mono>
            {f.codigo}
          </Dato>
          <span className="ml-1.5 text-meta text-mute">código en RENIPRESS</span>
        </li>
      </ul>
    </header>
  );
}
