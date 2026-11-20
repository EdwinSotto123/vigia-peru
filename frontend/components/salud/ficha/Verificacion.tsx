import Link from "next/link";
import { ChevronRight, Info } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { FuenteFecha, InsigniaEstado, InsigniaHecho, iconoEstado, tonoEstado } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { fechaCorta, rutaFicha, rutaMedico, type Chequeo, type FichaIpress } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { DISCO_TONO, DetallePendiente, URL_RENIPRESS_CONSULTA, detalleLeido } from "./piezas";

/**
 * Lo primero de la ficha: la verificación (decidir). Arriba, una frase hecha SÓLO con lo que dicen los chequeos; abajo,
 * cada chequeo tal como lo redactó la API (estado, clase de hecho, la frase con su fuente y su fecha). No se reescriben:
 * la API es la que decide qué se puede afirmar. Server-safe.
 */

/** La frase de arriba: estado, categoría, centro quirúrgico y sanciones firmes, con la fecha de la última. */
export function resumenVerificacion(f: FichaIpress): string {
  const c = (k: string) => f.verificacion.find((x) => x.clave === k);
  const partes: string[] = [];
  const reg = c("registro");
  if (reg) {
    if (!f.enRegistro) partes.push("Ya no figura en RENIPRESS");
    else if (reg.estado === "ok") partes.push("Activa en RENIPRESS");
    else partes.push(`En estado «${(f.estado ?? "sin estado").toLowerCase()}» en RENIPRESS`);
  }
  const cat = c("categoria");
  if (cat) {
    const categoria = (detalleLeido(f) ? f.detalle.categoria : null) ?? f.categoria;
    partes.push(cat.estado === "ok" && categoria ? `categoría ${categoria}` : "sin categoría en RENIPRESS");
  }
  const qx = c("quirurgico");
  if (qx) partes.push(qx.estado === "ok" ? "con centro quirúrgico registrado" : "sin centro quirúrgico activo registrado");
  const n = f.registroSanciones.length;
  const ultima = f.ultimaSancion ?? f.registroSanciones[0]?.fechaEmision ?? null;
  const cuerpo = partes.join(", ");
  if (n > 0) {
    const s = `con ${n === 1 ? "una sanción firme" : `${n} sanciones firmes`} de SUSALUD${ultima ? ` (${n === 1 ? "del" : "la última,"} ${fechaCorta(ultima)})` : ""}`;
    return `${cuerpo ? `${cuerpo}, ` : ""}${s}.`.replace(/^c/, "C");
  }
  const al = f.fuentes.sanciones?.al;
  const sin = `no figura en el Registro de Sanciones de SUSALUD${al ? ` revisado el ${fechaCorta(String(al))}` : ""}`;
  return cuerpo ? `${cuerpo}; ${sin}.` : `${sin.charAt(0).toUpperCase()}${sin.slice(1)}.`;
}

/** Lo que acompaña a un chequeo: el enlace a su pestaña o a su página, y la aclaración que corresponda. */
function Extra({ c, f, base }: { c: Chequeo; f: FichaIpress; base: string }) {
  const ficha = rutaEn(base, rutaFicha(f.codigo));
  const enlace = (href: string, texto: string) => (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:min-h-8"
    >
      {texto}
      <ChevronRight size={14} aria-hidden />
    </Link>
  );
  if (c.clave === "sanciones" && f.registroSanciones.length > 0)
    return enlace(`${ficha}?seccion=sanciones#secciones`, f.registroSanciones.length === 1 ? "Ver la sanción" : `Ver las ${f.registroSanciones.length} sanciones`);
  if (c.clave === "denuncias") return enlace(`${ficha}?seccion=denuncias#secciones`, "Ver las denuncias por año");
  if (c.clave === "licencia") return enlace(`${ficha}?seccion=documentos#secciones`, "Ver los documentos declarados");
  if (c.clave === "quirurgico") return enlace(`${ficha}?seccion=servicios#secciones`, "Ver los servicios registrados");
  if (c.clave === "responsable" && detalleLeido(f) && f.detalle.responsableColegiatura) {
    const conSanciones = f.registroSanciones.length > 0;
    return (
      <div className="space-y-1">
        {enlace(rutaEn(base, rutaMedico(f.detalle.responsableColegiatura)), `Qué dicen las fuentes de la colegiatura N.° ${f.detalle.responsableColegiatura}`)}
        {conSanciones && (
          <p className="flex items-start gap-1.5 text-meta leading-snug text-inkSoft">
            <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            Las sanciones firmes de este establecimiento son de la IPRESS, no del profesional responsable de la atención.
          </p>
        )}
      </div>
    );
  }
  return null;
}

export function VerificacionFicha({ f, base }: { f: FichaIpress; base: string }) {
  const leido = detalleLeido(f);
  return (
    <section aria-labelledby="verificacion-t" className="tarjeta min-w-0 rounded-2xl border border-line bg-paper">
      <header className="border-b border-line px-4 pb-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex items-center gap-1.5">
          <h2 id="verificacion-t" className="font-display text-seccion font-bold leading-tight text-ink">
            Verificación
          </h2>
          <Ayuda titulo="¿Cómo se lee la verificación?" etiqueta="Cómo se lee la verificación">
            Cada fila es lo que afirma una fuente oficial, con su fecha. El color dice si conviene revisar algo; la etiqueta dice
            qué clase de hecho es: una sanción firme no es una denuncia, y lo que dice RENIPRESS lo declaró la propia IPRESS.
            <span className="mt-1.5 block">Nada de esto califica a un establecimiento como seguro o peligroso.</span>
          </Ayuda>
        </div>
        <p className="mt-2 max-w-[68ch] text-pretty text-destacado font-semibold leading-snug text-ink">{resumenVerificacion(f)}</p>
      </header>
      <ol aria-label="Chequeos de verificación" className="divide-y divide-line">
        {f.verificacion.map((c) => {
          const Icono = iconoEstado(c.estado);
          return (
            <li key={c.clave} className="grid grid-cols-1 gap-x-4 px-4 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:px-6">
              {/* En el celular el disco se va (la insignia de estado ya lleva su ícono y su color) y el texto gana ancho. */}
              <span aria-hidden className={cn("mt-0.5 hidden h-10 w-10 place-items-center rounded-full sm:grid", DISCO_TONO[tonoEstado(c.estado)])}>
                <Icono size={18} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <h3 className="mr-1 text-cuerpo font-semibold leading-snug text-ink">{c.titulo}</h3>
                  <InsigniaEstado estado={c.estado} />
                  <InsigniaHecho tipo={c.tipo} />
                </div>
                <p className="mt-1.5 max-w-[72ch] text-pretty text-dato leading-relaxed text-inkSoft">{c.detalle}</p>
                <FuenteFecha nombre={c.fuente} url={c.url} al={c.al} className="mt-1.5" />
                <div className="mt-1">
                  <Extra c={c} f={f} base={base} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {!leido && (
        <div className="border-t border-line px-4 py-4 sm:px-6">
          <DetallePendiente url={f.fuentes.renipress?.url ?? URL_RENIPRESS_CONSULTA} />
          <p className="mt-2 text-meta text-mute">Con el detalle se suman los chequeos de centro quirúrgico, licencia municipal y responsable de la atención.</p>
        </div>
      )}
    </section>
  );
}
