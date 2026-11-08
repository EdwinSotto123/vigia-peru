"use client";

import Link from "next/link";
import { BriefcaseBusiness, CalendarClock, KanbanSquare, Loader2, Send, Sparkles, Target, UserRoundSearch } from "lucide-react";
import { CLASE_ENLACE_PIE, Caja, ESPACIO_CAJAS, VacioCaja } from "@/components/gobserva/app/Caja";
import { CajaAvisos, CajaPlan, PagosPorConfirmar, ParaEmpezar } from "@/components/gobserva/cuenta/PanelResumen";
import { ABIERTOS, cuando, eventos, fechaHora } from "@/components/gobserva/cuenta/plazos";
import type { Seccion } from "@/components/gobserva/cuenta/Cuenta";
import { ESTADOS } from "@/components/gobserva/cuenta/PanelGuardados";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { diasParaCierre, entidadNombre, puesto, textoCierre } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import type { Me } from "@/lib/gobserva-cuenta";
import { useSeguimiento } from "@/lib/licitaciones-app/useSeguimiento";
import { cn } from "@/lib/utils";
import { useCalceEmpleo, usePerfilEmpleo } from "./usePerfilEmpleo";

/**
 * El inicio de la app de Gobserva Empleo (2026-11-07), como el de Licitaciones: lo que falta para empezar, cuatro cifras
 * del día (cuántas plazas calzan con tu perfil, cuántas guardaste, en cuántas postulaste y cuál cierra primero), las
 * plazas para ti que cierran primero, tus postulaciones por etapa con sus próximos cierres, tu plan y tus avisos.
 */
export function InicioEmpleo({ base, me, onCambio, irA }: { base: string; me: Me; onCambio: () => void; irA: (t: Seccion) => void }) {
  const { perfil, cargando } = usePerfilEmpleo();
  const calce = useCalceEmpleo(perfil, { size: 5 });
  const seg = useSeguimiento("empleo");
  const items = seg.data?.data ?? [];
  const abiertas = items.filter((i) => ABIERTOS.has(i.estado));
  const proximos = eventos(abiertas).filter((e) => e.plazo.clave === "postulacion" && !cuando(e.plazo.fecha).paso).slice(0, 5);
  const postulaste = items.filter((i) => i.estado === "postule" || i.estado === "entrevista").length;
  const entrevistas = items.filter((i) => i.estado === "entrevista").length;
  const primero = proximos[0] ?? null;

  return (
    <div className={cn("grid", ESPACIO_CAJAS)}>
      <ParaEmpezar producto="empleo" base={base} me={me} onCambio={onCambio} irA={irA} />
      <PagosPorConfirmar producto="empleo" me={me} onCambio={onCambio} />

      {cargando ? (
        <div className="h-44 animate-pulse rounded-2xl bg-ink/[0.06]" />
      ) : !perfil ? (
        <Caja id="hoy" titulo="Hoy, para ti">
          <VacioCaja
            Icono={UserRoundSearch}
            titulo="Cuéntanos qué trabajo buscas"
            texto="Sube tu CV o responde unas preguntas rápidas en un chat. Con eso te mostramos aquí cuántas plazas piden tu carrera y cuáles te calzan mejor."
            accion={
              <Link href={rutaEn(base, "/app/bienvenida")} className={claseAccion("primario")}>
                <Sparkles size={15} aria-hidden /> Armar mi perfil (2 minutos)
              </Link>
            }
          />
        </Caja>
      ) : (
        <Caja
          id="hoy"
          titulo="Hoy, para ti"
          descripcion={`Según tu perfil «${perfil.puesto || "Mi perfil"}»`}
          accion={<Link href={rutaEn(base, "/app/bienvenida")} className={CLASE_ENLACE_PIE}>Editar tu perfil</Link>}
          relleno={false}
        >
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-2xl bg-line lg:grid-cols-4">
            <Cifra Icono={Target} etiqueta="Calzan contigo" valor={calce.data ? numero(calce.data.total) : null} detalle="Plazas abiertas hoy" href={rutaEn(base, "/app/para-ti")} />
            <Cifra Icono={BriefcaseBusiness} etiqueta="Guardadas" valor={seg.data ? numero(items.length) : null} detalle={`${numero(items.filter((i) => i.etapa === "abierta").length)} siguen abiertas`} onClick={() => irA("seguimiento")} />
            <Cifra Icono={Send} etiqueta="Postulaste" valor={seg.data ? numero(postulaste) : null} detalle={entrevistas ? `${numero(entrevistas)} con entrevista` : "Muévelas en tu tablero"} onClick={() => irA("seguimiento")} />
            <Cifra
              Icono={CalendarClock}
              etiqueta="Próximo cierre"
              valor={seg.data ? (primero ? cuando(primero.plazo.fecha).texto : "Ninguno") : null}
              detalle={primero ? primero.item.titulo ?? "Plaza guardada" : "Guarda plazas para verlas aquí"}
              urgente={!!primero && cuando(primero.plazo.fecha).urgente}
              onClick={() => irA("calendario")}
            />
          </div>
        </Caja>
      )}

      <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]", ESPACIO_CAJAS)}>
        <Caja
          id="para-ti"
          titulo="Para ti, las que cierran primero"
          relleno={false}
          pie={perfil ? <Link href={rutaEn(base, "/app/para-ti")} className={CLASE_ENLACE_PIE}>Ver todas{calce.data ? ` (${numero(calce.data.total)})` : ""}</Link> : undefined}
        >
          {!perfil ? (
            <VacioCaja Icono={Sparkles} titulo="Aquí van tus plazas" texto="Arma tu perfil y aquí verás las plazas que calzan contigo, de las que cierran primero a las últimas." />
          ) : !calce.data ? (
            <div className="grid place-items-center py-12"><Loader2 size={22} aria-label="Cargando" className="animate-spin text-mute" /></div>
          ) : calce.data.data.length === 0 ? (
            <VacioCaja Icono={Target} titulo="Hoy no hay plazas que calcen" texto="Tu alerta te avisa cuando salga una. Mientras, prueba con otras palabras en tu perfil." />
          ) : (
            <ul className="divide-y divide-line">
              {calce.data.data.map((p) => {
                const dias = diasParaCierre(p.fechaFin);
                return (
                  <li key={p.aviso}>
                    <Link href={rutaEn(base, `/app/plaza/${p.aviso}`)} className="flex items-start justify-between gap-3 px-4 py-3.5 transition-colors duration-rapido hover:bg-ink/[0.03] sm:px-5">
                      <span className="min-w-0">
                        <span className="line-clamp-2 block text-dato font-semibold leading-snug text-ink">{puesto(p.titulo)}</span>
                        <span className="mt-0.5 block truncate text-meta text-inkSoft">{entidadNombre(p.entidad)}</span>
                        <span className={cn("mt-1 inline-flex items-center gap-1 text-meta font-semibold", dias != null && dias <= 2 ? "text-crimsonTexto" : "text-inkSoft")}>
                          <CalendarClock size={13} aria-hidden /> {textoCierre(dias)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-dato font-bold tabular-nums text-ink">
                        {p.remuneracion ? soles(p.remuneracion) : <span className="text-meta font-medium text-mute">Sin dato</span>}
                        {p.remuneracion ? <span className="block text-rotulo font-medium text-mute">al mes</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Caja>

        <div className={cn("grid grid-cols-[minmax(0,1fr)]", ESPACIO_CAJAS)}>
          <Caja
            id="postulaciones"
            titulo="Tus postulaciones"
            pie={<button type="button" onClick={() => irA("seguimiento")} className={CLASE_ENLACE_PIE}><KanbanSquare size={14} aria-hidden /> Abrir mi tablero</button>}
          >
            {items.length === 0 ? (
              <p className="text-dato text-inkSoft">Guarda una plaza con la estrella y llévala aquí de etapa en etapa: postulaste, te llamaron a entrevista, te eligieron.</p>
            ) : (
              <>
                <ul className="grid grid-cols-2 gap-2">
                  {ESTADOS.empleo.map((e) => (
                    <li key={e.valor} className="rounded-lg bg-ink/[0.035] px-3 py-2">
                      <p className="text-meta text-inkSoft">{e.etiqueta}</p>
                      <p className="font-display text-bloque font-bold tabular-nums text-ink">{numero(items.filter((i) => i.estado === e.valor).length)}</p>
                    </li>
                  ))}
                </ul>
                {proximos.length > 0 && (
                  <>
                    <p className="mt-4 text-meta font-semibold text-inkSoft">Cierran pronto</p>
                    <ul className="mt-1.5 divide-y divide-line">
                      {proximos.map((e) => {
                        const c = cuando(e.plazo.fecha);
                        return (
                          <li key={e.item.ref} className="flex items-baseline justify-between gap-3 py-2">
                            <Link href={rutaEn(base, `/app/plaza/${e.item.ref}`)} className="min-w-0 truncate text-dato font-medium text-ink hover:text-granate hover:underline">
                              {e.item.titulo ?? "Plaza guardada"}
                            </Link>
                            <span className={cn("shrink-0 text-meta font-semibold tabular-nums", c.urgente ? "text-crimsonTexto" : "text-inkSoft")} title={fechaHora(e.plazo.fecha)}>
                              {c.texto}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </>
            )}
          </Caja>
          <CajaPlan producto="empleo" base={base} me={me} irA={irA} angosta />
          <CajaAvisos producto="empleo" me={me} irA={irA} />
        </div>
      </div>
    </div>
  );
}

function Cifra({
  Icono, etiqueta, valor, detalle, href, onClick, urgente = false,
}: {
  Icono: typeof Target;
  etiqueta: string;
  valor: string | null;
  detalle: string;
  href?: string;
  onClick?: () => void;
  urgente?: boolean;
}) {
  const cuerpo = (
    <>
      <span className="flex items-center gap-1.5 text-meta font-semibold text-inkSoft">
        <Icono size={15} aria-hidden className="text-mute" /> {etiqueta}
      </span>
      <span className={cn("mt-2 block truncate font-display text-seccion font-bold leading-none tabular-nums sm:text-cifra", urgente ? "text-crimsonTexto" : "text-ink")}>
        {valor ?? <Loader2 size={20} aria-label="Cargando" className="animate-spin text-mute" />}
      </span>
      <span className="mt-1.5 block truncate text-meta text-mute">{detalle}</span>
    </>
  );
  const clase = "min-w-0 bg-caja p-4 text-left transition-colors duration-rapido hover:bg-ink/[0.025] sm:p-5";
  return href ? (
    <Link href={href} className={clase}>{cuerpo}</Link>
  ) : (
    <button type="button" onClick={onClick} className={clase}>{cuerpo}</button>
  );
}
