import Link from "next/link";
import { ChevronRight, Info } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import type { Tono } from "@/components/gobserva/ui/Insignia";
import { FuenteFecha, iconoEstado, tonoEstado } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { ESTADOS_CHEQUEO, fechaCorta, rutaFicha, rutaMedico, type Chequeo, type FichaIpress } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { DetallePendiente, URL_RENIPRESS_CONSULTA, detalleLeido, esColegioMedico } from "./piezas";

/** El color del ícono y del nombre del estado de un chequeo. */
const TEXTO_TONO: Record<Tono, string> = {
  exito: "text-mossTexto",
  neutro: "text-mute",
  acento: "text-granate",
  aviso: "text-amberTexto",
  urgente: "text-crimsonTexto",
};

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
  if (c.clave === "denuncias") return enlace(`${ficha}?seccion=sanciones&ver=denuncias#secciones`, "Ver las denuncias por año");
  if (c.clave === "licencia") return enlace(`${ficha}?seccion=documentos#secciones`, "Ver los documentos declarados");
  if (c.clave === "quirurgico") return enlace(`${ficha}?seccion=servicios#secciones`, "Ver los servicios registrados");
  // /medico busca en el CMP: sólo se enlaza si el responsable es del Colegio Médico (piezas.tsx).
  if (c.clave === "responsable" && detalleLeido(f) && f.detalle.responsableColegiatura && esColegioMedico(f.detalle.responsableColegio)) {
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

/** El fondo y el color del disco y de la etiqueta de cada estado. */
const FONDO_TONO: Record<Tono, string> = {
  exito: "bg-moss/10 text-mossTexto",
  neutro: "bg-paperSoft text-inkSoft",
  acento: "bg-granate-50 text-granate",
  aviso: "bg-amber-soft text-amberTexto",
  urgente: "bg-crimson-soft text-crimsonTexto",
};
const PLURAL_ESTADO: Record<string, [string, string]> = {
  ok: ["conforme", "conformes"],
  atencion: ["para revisar", "para revisar"],
  alerta: ["alerta", "alertas"],
  sin_dato: ["sin dato", "sin dato"],
  externo: ["se verifica fuera", "se verifican fuera"],
};

/**
 * La pestaña «Verificación» (2026-11-22, el usuario: «está horrible»; antes una lista de párrafos con su fuente): arriba,
 * cuántos chequeos hay de cada estado, con su color; debajo, una casilla por chequeo con el ícono del estado, el nombre,
 * la etiqueta del estado, lo que dice la fuente, su acción y, al pie, la fuente con su fecha. Las frases son las de la API.
 */
export function VerificacionFicha({ f, base }: { f: FichaIpress; base: string }) {
  const leido = detalleLeido(f);
  const orden: Chequeo["estado"][] = ["alerta", "atencion", "externo", "ok", "sin_dato"];
  const cuenta = orden.map((e) => ({ e, n: f.verificacion.filter((c) => c.estado === e).length })).filter((x) => x.n > 0);
  return (
    <section aria-labelledby="verificacion-t" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {/* El título lo pone la pestaña («Verificación»): aquí, una línea que dice qué es. */}
          <p id="verificacion-t" className="text-dato font-semibold leading-snug text-inkSoft">
            Lo que dice cada fuente oficial, con su fecha
          </p>
          <Ayuda titulo="¿Cómo se lee la verificación?" etiqueta="Cómo se lee la verificación">
            Cada casilla es lo que afirma una fuente oficial, con su fecha. El color dice si conviene revisar algo. Una sanción firme no
            es una denuncia, y lo que dice RENIPRESS lo declaró la propia IPRESS.
            <span className="mt-1.5 block">Nada de esto califica a un establecimiento como seguro o peligroso.</span>
          </Ayuda>
        </div>
        <ul className="flex flex-wrap gap-1.5" aria-label="Chequeos por estado">
          {cuenta.map(({ e, n }) => {
            const Icono = iconoEstado(e);
            return (
              <li key={e} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-semibold", FONDO_TONO[tonoEstado(e)])}>
                <Icono size={14} aria-hidden />
                <span className="tabular-nums">{n}</span> {PLURAL_ESTADO[e][n === 1 ? 0 : 1]}
              </li>
            );
          })}
        </ul>
      </div>

      <ol aria-label="Chequeos de verificación" className="grid gap-3 md:grid-cols-2">
        {f.verificacion.map((c) => {
          const Icono = iconoEstado(c.estado);
          const tono = tonoEstado(c.estado);
          return (
            <li key={c.clave} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-paper">
              <div className="flex items-start gap-3 px-4 pt-4">
                <span aria-hidden className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", FONDO_TONO[tono])}>
                  <Icono size={21} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-cuerpo font-bold leading-snug text-ink">{c.titulo}</h3>
                  <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-rotulo font-semibold", FONDO_TONO[tono])}>{ESTADOS_CHEQUEO[c.estado].rotulo}</span>
                </div>
              </div>
              <p className="mt-2.5 px-4 text-pretty text-dato leading-relaxed text-ink">{c.detalle}</p>
              <div className="px-4 pb-1 pt-1">
                <Extra c={c} f={f} base={base} />
              </div>
              <div className="mt-auto border-t border-line bg-paperSoft/50 px-4 py-2">
                <FuenteFecha nombre={c.fuente} url={c.url} al={c.al} className="text-rotulo" />
              </div>
            </li>
          );
        })}
      </ol>
      {!leido && (
        <div className="rounded-2xl border border-line bg-paper px-4 py-4 sm:px-6">
          <DetallePendiente url={f.fuentes.renipress?.url ?? URL_RENIPRESS_CONSULTA} />
          <p className="mt-2 text-meta text-mute">Con el detalle se suman los chequeos de centro quirúrgico, licencia municipal y responsable de la atención.</p>
        </div>
      )}
    </section>
  );
}
