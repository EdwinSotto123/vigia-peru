"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Banknote, Building2, CalendarCheck, CalendarX, Loader2, RotateCw, UsersRound } from "lucide-react";
import { ListaPaginada } from "@/components/listado";
import { CapitulosRelato, EnUnaFrase, EnlaceFuente, type CapituloRelato } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { baseApiNavegador } from "@/lib/api-client";
import { rutaEmpresa } from "@/lib/empresas";
import { fecha, listaY, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { SENAL, rutaPersona, type TipoSenal } from "@/lib/personas";
import type { DetallePolitico, SenalPolitico, SeveridadPolitico } from "@/lib/politicos";
import { rutaContrato } from "@/lib/rutas";

/**
 * La evidencia de los cruces de UNA persona del partido, pedida al abrir su panel (GET /partidos/:clave/politicos/:codigo):
 * la lista trae sólo los conteos, y una persona puede tener decenas de procesos y de aportes. El panel monta sólo la fila
 * abierta (DetalleFilas), así que se pide una a la vez.
 *
 * Se lee como un relato corto (pedido del 2026-11-05): una frase con lo esencial y, debajo, capítulos que se ven de a uno
 * (`CapitulosRelato en="panel"`): sus empresas y lo que le vendieron al Estado, sus órdenes de servicio, los funcionarios
 * que la declararon como familiar, sus aportes, sus sanciones, sus candidaturas y de dónde sale cada dato. Se abre el
 * capítulo de su cruce más grave.
 *
 * Privacidad: la API no da documentos ni el nombre del funcionario que la declaró (sólo su cargo y, si no destapa nada, su
 * primer apellido). Aquí no se arma ningún `title` ni `aria-label` con nombres de personas.
 */
export function CrucesDelPolitico({
  clave,
  codigo,
  partido,
  senales,
  conDocumento,
}: {
  clave: string;
  codigo: string;
  partido: string;
  senales: { tipo: SenalPolitico; severidad: SeveridadPolitico }[];
  conDocumento: boolean;
}) {
  const [estado, setEstado] = useState<{ datos: DetallePolitico | null; error: boolean }>({ datos: null, error: false });
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setEstado({ datos: null, error: false });
    fetch(`${baseApiNavegador()}/partidos/${encodeURIComponent(clave)}/politicos/${codigo}`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<DetallePolitico>) : Promise.reject(new Error(String(r.status)))))
      .then((datos) => setEstado({ datos, error: false }))
      .catch(() => {
        if (!ctl.signal.aborted) setEstado({ datos: null, error: true });
      });
    return () => ctl.abort();
  }, [clave, codigo, intento]);

  if (estado.error) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft" role="status">
        No pudimos traer sus registros ahora.
        <button
          type="button"
          onClick={() => setIntento((i) => i + 1)}
          className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          <RotateCw size={14} aria-hidden />
          Reintentar
        </button>
      </div>
    );
  }
  const d = estado.datos;
  if (!d) {
    return (
      <p className="flex items-center gap-2 text-meta text-mute" role="status">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Trayendo lo que dicen los otros registros…
      </p>
    );
  }

  const peor = (["alta", "media", "baja"] as const).find((s) => senales.some((x) => x.severidad === s)) ?? null;
  const tonoDe = (...tipos: SenalPolitico[]) => (["alta", "media", "baja"] as const).find((s) => senales.some((x) => tipos.includes(x.tipo) && x.severidad === s));
  const capitulos: CapituloRelato[] = [];
  if (d.empresas.length) {
    capitulos.push({
      id: "pol-empresas",
      titulo: d.tipo === "empresa" ? "Sus ventas" : "Sus empresas",
      tituloLargo: d.tipo === "empresa" ? "Lo que le vendió al Estado" : "Sus empresas y lo que le vendieron al Estado",
      conteo: d.tipo === "empresa" ? d.procesos.total || null : d.empresas.length,
      tono: tonoDe("empresas_gobierno", "empresa_inhabilitada", "empresas_estado"),
      contenido: <Empresas d={d} partido={partido} />,
    });
  }
  if (d.ordenes?.entidades.length) {
    capitulos.push({
      id: "pol-ordenes",
      titulo: "Órdenes",
      tituloLargo: "Las órdenes de servicio que recibió del Estado",
      conteo: d.ordenes.entidades.length,
      tono: tonoDe("ordenes_gobierno", "ordenes"),
      contenido: <Ordenes d={d} partido={partido} />,
    });
  }
  if (d.familia.length) {
    capitulos.push({
      id: "pol-familia",
      titulo: "Familia",
      tituloLargo: "Funcionarios que lo declararon como familiar",
      conteo: d.familia.length,
      tono: tonoDe("familia"),
      contenido: <Familia d={d} />,
    });
  }
  if (d.aportes?.filas.length) {
    capitulos.push({ id: "pol-aportes", titulo: "Aportes", tituloLargo: `Lo que aportó a ${partido}`, conteo: d.aportes.n, contenido: <Aportes d={d} /> });
  }
  if (d.sanciones.length) {
    capitulos.push({
      id: "pol-sanciones",
      titulo: "Sanciones",
      tituloLargo: "Sus sanciones del Tribunal de Contrataciones",
      conteo: d.sanciones.length,
      tono: tonoDe("inhabilitado", "sancion"),
      contenido: <Sanciones d={d} />,
    });
  }
  if (d.candidaturas.length || d.otrosPartidos.length) {
    capitulos.push({
      id: "pol-candidaturas",
      titulo: "Candidaturas",
      tituloLargo: `Sus candidaturas con ${partido}`,
      conteo: d.candidaturas.length || null,
      contenido: <Candidaturas d={d} />,
    });
  }
  capitulos.push({ id: "pol-fuentes", titulo: "Las fuentes", tituloLargo: "De dónde sale cada dato", contenido: <Fuentes conDocumento={conDocumento} /> });
  // Se abre el capítulo del cruce más grave (el primero con ese tono); si no hay cruces, el primero.
  const activa = capitulos.find((c) => peor && c.tono === peor)?.id;

  return (
    <div className="space-y-4">
      <EnUnaFrase tono={peor ?? "neutro"}>{frase(d, senales, partido, conDocumento)}</EnUnaFrase>
      <CapitulosRelato en="panel" etiqueta="Lo que dicen los otros registros" capitulos={capitulos} activa={activa} />
    </div>
  );
}

/** Lo esencial en una o dos oraciones, armado con los datos (no con texto de un modelo). */
function frase(d: DetallePolitico, senales: { tipo: SenalPolitico }[], partido: string, conDocumento: boolean): string {
  if (!conDocumento) return "Su fuente no publica su documento: se conoce su candidatura, pero no se le buscó en otros registros (cruzar por nombre lo confundiría con un homónimo).";
  const tiene = (t: SenalPolitico) => senales.some((s) => s.tipo === t);
  const partes: string[] = [];
  const enGob = d.empresas.reduce((s, e) => s + (e.enGobiernos?.despues ?? 0), 0);
  const montoGob = d.empresas.reduce((s, e) => s + (e.enGobiernos?.montoDespues ?? 0), 0);
  const vendido = d.empresas.reduce((s, e) => s + (e.vendido ?? 0), 0);
  const quien = d.tipo === "empresa" ? "Esta empresa" : plural(d.empresas.length, "empresa suya", "empresas suyas");
  if (tiene("empresas_gobierno") && enGob > 0) {
    partes.push(`${oracion(quien)} ${d.tipo === "empresa" || d.empresas.length === 1 ? "ganó" : "ganaron"} ${plural(enGob, "proceso", "procesos")} por ${solesCompacto(montoGob)} en gobiernos de ${partido}${d.vinculoDesde ? ` después del ${fecha(d.vinculoDesde)}, su primer vínculo con el partido` : ""}`);
  } else if (vendido > 0) {
    partes.push(`${oracion(quien)} le ${d.tipo === "empresa" || d.empresas.length === 1 ? "vendió" : "vendieron"} ${solesCompacto(vendido)} al Estado`);
  }
  const gob = d.ordenes?.entidades.filter((e) => e.gobernaba) ?? [];
  if (gob.length) partes.push(`recibió ${solesCompacto(gob.reduce((s, e) => s + e.monto, 0))} en órdenes de servicio de ${plural(gob.length, "entidad que gobernaba", "entidades que gobernaba")} el partido`);
  else if (d.ordenes?.entidades.length) partes.push(`recibió ${solesCompacto(d.ordenes.entidades.reduce((s, e) => s + e.monto, 0))} en órdenes de servicio de ${plural(d.ordenes.entidades.length, "entidad", "entidades")}`);
  if (d.familia.length) partes.push(`${plural(d.familia.length, "funcionario lo declaró", "funcionarios lo declararon")} como familiar`);
  if (tiene("inhabilitado")) partes.push("el Tribunal de Contrataciones lo inhabilitó");
  else if (tiene("sancion")) partes.push("tiene multas del Tribunal de Contrataciones");
  if (!partes.length) return "Se le buscó en los otros registros por su documento y no salió nada: ni empresas que le vendan al Estado, ni órdenes de servicio, ni sanciones.";
  return `${oracion(listaY(partes))}. Son hechos para revisar, no una acusación.`;
}

// ─── Piezas ─────────────────────────────────────────────────────────────────────────────────────

const TARJETA = "rounded-xl border border-line bg-paper px-3.5 py-3";
const ENLACE = "font-semibold text-granate underline-offset-2 hover:underline";

/** Un monto a la derecha de una tarjeta, con lo que es debajo. */
function Monto({ valor, que }: { valor: string; que: string }) {
  return (
    <span className="shrink-0 text-right">
      <span className="block font-mono text-dato font-semibold tabular-nums text-ink">{valor}</span>
      <span className="block text-rotulo text-mute">{que}</span>
    </span>
  );
}

/** Una marca chica con su ícono: «después de su primer vínculo», «la gobernaba el partido». */
function Marca({ tono, icono, children }: { tono: "alta" | "media" | "neutro"; icono: ReactNode; children: ReactNode }) {
  const cls = { alta: "border-crimson/45 text-ink", media: "border-amber/50 text-ink", neutro: "border-line text-inkSoft" }[tono];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border bg-paper px-2 py-0.5 text-rotulo font-semibold leading-tight ${cls}`}>
      {icono}
      {children}
    </span>
  );
}

const ROL: Record<string, string> = {
  SOCIO_ACCIONISTA_TITULAR: "socio o titular",
  REPRESENTANTE_LEGAL: "representante legal",
  ORGANO_ADMINISTRACION: "directivo",
};
const rolTexto = (rol: string | null) => (rol ? oracion(listaY(rol.split(/,\s*/).map((r) => ROL[r] ?? r.toLowerCase().replace(/_/g, " ")))) : null);

function Empresas({ d, partido }: { d: DetallePolitico; partido: string }) {
  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {d.empresas.map((e) => (
          <li key={e.ruc} className={TARJETA}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={rutaEmpresa(e.ruc)} prefetch={false} className={`${ENLACE} block text-dato leading-snug`}>
                  {e.nombre ? tituloNatural(e.nombre) : `RUC ${e.ruc}`}
                </Link>
                <p className="mt-1 text-meta text-inkSoft">
                  <Partes
                    partes={[
                      <Dato key="ruc" tipo="ruc" mono>{e.ruc}</Dato>,
                      rolTexto(e.rol) ? <Dato key="rol" tipo="cargo" nombre="Qué es en la empresa">{rolTexto(e.rol)}</Dato> : null,
                      e.desde ? <Dato key="desde" tipo="fecha" nombre="Desde">desde {fecha(e.desde)}</Dato> : null,
                    ]}
                  />
                </p>
              </div>
              <Monto valor={e.vendido ? solesCompacto(e.vendido) : "Nada"} que={e.vendido ? `le vendió al Estado${e.entidades ? `, a ${plural(e.entidades, "entidad", "entidades")}` : ""}` : "vendido al Estado"} />
            </div>
            {(e.inhabilitada || e.enGobiernos) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-2">
                {e.inhabilitada && (
                  <Marca tono="media" icono={<Ban size={12} className="shrink-0 text-amberTexto" aria-hidden />}>
                    Inhabilitada ({e.inhabilitada})
                  </Marca>
                )}
                {e.enGobiernos && (
                  <Marca tono={e.enGobiernos.despues > 0 ? "alta" : "neutro"} icono={<Building2 size={12} className={`shrink-0 ${e.enGobiernos.despues > 0 ? "text-crimsonTexto" : "text-mute"}`} aria-hidden />}>
                    {plural(e.enGobiernos.procesos, "proceso", "procesos")} por {solesCompacto(e.enGobiernos.monto)} en gobiernos de {partido}
                  </Marca>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {d.procesos.filas.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-dato font-semibold text-ink">Los procesos que {d.tipo === "empresa" ? "ganó" : "ganaron"} en gobiernos de {partido}</h4>
          <p className="text-rotulo leading-relaxed text-mute">
            {d.vinculoDesde ? `Cada uno dice si se convocó antes o después del ${fecha(d.vinculoDesde)}, su primer aporte o candidatura con el partido. ` : ""}
            {d.procesos.total > d.procesos.filas.length ? `Aquí van los ${numero(d.procesos.filas.length)} más recientes de ${numero(d.procesos.total)}: todos están en la ficha de cada empresa.` : ""}
          </p>
          <ListaPaginada
            nombre="procesos"
            tam={5}
            buscar={{ placeholder: "Buscar por entidad o por lo que se compró…", etiqueta: "Buscar en sus procesos" }}
            items={d.procesos.filas.map((p) => ({
              id: `${p.codigo}-${p.ruc}`,
              buscable: `${p.entidad ?? ""} ${p.descripcion ?? ""} ${p.codigo}`,
              contenido: (
                <div className={TARJETA}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {p.ocid ? (
                        <Link href={rutaContrato(p.ocid)} prefetch={false} className={`${ENLACE} block text-dato leading-snug`}>
                          {p.descripcion ? oracion(p.descripcion) : `Proceso ${p.codigo}`}
                        </Link>
                      ) : (
                        <span className="block text-dato font-semibold leading-snug text-ink">{p.descripcion ? oracion(p.descripcion) : `Proceso ${p.codigo}`}</span>
                      )}
                      <p className="mt-1 text-meta text-inkSoft">
                        <Partes
                          partes={[
                            p.entidad ? <Dato key="ent" tipo="entidad">{tituloNatural(p.entidad)}</Dato> : null,
                            p.fecha ? <Dato key="f" tipo="fecha" nombre="Convocado">{fecha(p.fecha)}</Dato> : null,
                            <Dato key="c" tipo="codigo" mono>{p.codigo}</Dato>,
                          ]}
                        />
                      </p>
                    </div>
                    <Monto valor={p.monto != null ? solesCompacto(p.monto) : "Sin dato"} que="adjudicado" />
                  </div>
                  {p.despues != null && (
                    <div className="mt-2">
                      {p.despues ? (
                        <Marca tono="alta" icono={<CalendarCheck size={12} className="shrink-0 text-crimsonTexto" aria-hidden />}>Después de su primer vínculo con el partido</Marca>
                      ) : (
                        <Marca tono="neutro" icono={<CalendarX size={12} className="shrink-0 text-mute" aria-hidden />}>Antes de su primer vínculo con el partido</Marca>
                      )}
                    </div>
                  )}
                </div>
              ),
            }))}
          />
        </section>
      )}
    </div>
  );
}

function Ordenes({ d, partido }: { d: DetallePolitico; partido: string }) {
  const o = d.ordenes!;
  return (
    <div className="space-y-3">
      <ListaPaginada
        nombre="entidades"
        tam={6}
        buscar={{ placeholder: "Buscar por entidad o servicio…", etiqueta: "Buscar en sus órdenes" }}
        items={o.entidades.map((e) => {
          const otras = (e.tipos ?? []).filter((t): t is TipoSenal => t in SENAL).map((t) => SENAL[t].corto);
          return {
            id: e.entidadRuc,
            buscable: `${e.entidad ?? ""} ${e.servicio ?? ""}`,
            contenido: (
              <div className={TARJETA}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/entidad/${e.entidadRuc}`} prefetch={false} className={`${ENLACE} block text-dato leading-snug`}>
                      {e.entidad ? tituloNatural(e.entidad) : `RUC ${e.entidadRuc}`}
                    </Link>
                    <p className="mt-1 text-meta text-inkSoft">
                      <Partes
                        partes={[
                          e.servicio ? <Dato key="s" tipo="servicio">{e.servicio}</Dato> : null,
                          e.primera ? <Dato key="f" tipo="fecha" nombre="Cuándo">{e.primera.slice(0, 4) === (e.ultima ?? e.primera).slice(0, 4) ? e.primera.slice(0, 4) : `${e.primera.slice(0, 4)} a ${(e.ultima ?? e.primera).slice(0, 4)}`}</Dato> : null,
                        ]}
                      />
                    </p>
                  </div>
                  <Monto valor={solesCompacto(e.monto)} que={plural(e.ordenes, "orden", "órdenes")} />
                </div>
                {(e.gobernaba || otras.length > 0) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-2">
                    {e.gobernaba && (
                      <Marca tono="alta" icono={<Building2 size={12} className="shrink-0 text-crimsonTexto" aria-hidden />}>La gobernaba {partido}</Marca>
                    )}
                    {otras.map((t) => (
                      <Marca key={t} tono="neutro" icono={null}>{t}</Marca>
                    ))}
                  </div>
                )}
              </div>
            ),
          };
        })}
      />
      {o.personaCodigo && (
        <p className="text-meta">
          <Link href={rutaPersona(o.personaCodigo, "ordenes")} prefetch={false} className={ENLACE}>
            Ver cada orden en su ficha de persona contratada
          </Link>
        </p>
      )}
    </div>
  );
}

function Familia({ d }: { d: DetallePolitico }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {d.familia.map((f, i) => (
          <li key={`${f.entidadRuc}-${i}`} className={`${TARJETA} flex items-start gap-3`}>
            <UsersRound size={16} className="mt-0.5 shrink-0 text-mute" aria-hidden />
            <div className="min-w-0">
              <p className="text-dato font-semibold leading-snug text-ink">
                {f.parentesco ? oracion(f.parentesco) : "Familiar"}
                {f.funcionarioApellido ? `: funcionario de apellido ${tituloNatural(f.funcionarioApellido)}` : ""}
              </p>
              <p className="mt-1 text-meta text-inkSoft">
                <Partes
                  partes={[
                    f.puesto ? <Dato key="c" tipo="cargo">{oracion(f.puesto)}</Dato> : null,
                    <Dato key="e" tipo="entidad">
                      <Link href={`/entidad/${f.entidadRuc}`} prefetch={false} className="text-granate underline-offset-2 hover:underline">
                        {f.entidad ? tituloNatural(f.entidad) : `RUC ${f.entidadRuc}`}
                      </Link>
                    </Dato>,
                  ]}
                />
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-rotulo leading-relaxed text-mute">
        Cada funcionario lo nombró como pariente en su Declaración Jurada de Intereses. Del funcionario se muestra su cargo y, sólo si no revela un
        apellido tapado, su primer apellido. Dice que un familiar tiene un puesto, no cómo lo consiguió.
      </p>
    </div>
  );
}

function Aportes({ d }: { d: DetallePolitico }) {
  const a = d.aportes!;
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-meta text-inkSoft">
        <Banknote size={14} className="shrink-0 self-center text-mute" aria-hidden />
        <span className="font-mono text-destacado font-semibold tabular-nums text-ink">{soles(a.monto)}</span>
        en {plural(a.n, "aporte declarado", "aportes declarados")} a la ONPE
      </p>
      <ListaPaginada
        nombre="aportes"
        tam={8}
        items={a.filas.map((x, i) => ({
          id: `${x.fecha ?? x.anio ?? "s"}-${i}`,
          contenido: (
            <div className={`${TARJETA} flex items-center justify-between gap-3`}>
              <p className="min-w-0 text-meta text-inkSoft">
                <Partes
                  partes={[
                    <Dato key="f" tipo="fecha">{x.fecha ? fecha(x.fecha) : x.anio ? String(x.anio) : "Sin fecha"}</Dato>,
                    x.tipo ? <Dato key="t" tipo="tipo">{oracion(x.tipo)}</Dato> : null,
                    x.proceso ? <Dato key="p" tipo="documento" nombre="Informe">{x.proceso}</Dato> : null,
                  ]}
                />
              </p>
              <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-ink">{soles(x.monto)}</span>
            </div>
          ),
        }))}
      />
    </div>
  );
}

const TIPO_SANCION: Record<string, string> = { temporal: "Inhabilitación temporal", definitivo: "Inhabilitación definitiva", multa: "Multa" };

function Sanciones({ d }: { d: DetallePolitico }) {
  return (
    <ul className="space-y-2">
      {d.sanciones.map((s, i) => (
        <li key={`${s.resolucion ?? "s"}-${i}`} className={TARJETA}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-dato font-semibold leading-snug text-ink">{TIPO_SANCION[s.tipo] ?? oracion(s.tipo)}</p>
            {s.multa ? <Monto valor={soles(s.multa)} que="de multa" /> : null}
          </div>
          <p className="mt-1 text-meta text-inkSoft">
            <Partes
              partes={[
                s.desde ? <Dato key="f" tipo="fecha" nombre="Vigencia">{s.hasta ? `del ${fecha(s.desde)} al ${fecha(s.hasta)}` : `desde el ${fecha(s.desde)}`}</Dato> : null,
                s.resolucion ? <Dato key="r" tipo="documento" nombre="Resolución" mono>{s.resolucion}</Dato> : null,
                s.estado ? <Dato key="e" tipo="tipo" nombre="Estado">{oracion(s.estado)}</Dato> : null,
              ]}
            />
          </p>
          {s.infraccion && <p className="mt-2 text-meta leading-relaxed text-inkSoft">{s.infraccion.replace(/^[\s-]+/, "")}</p>}
        </li>
      ))}
    </ul>
  );
}

const RESULTADO: Record<string, string> = { electo: "Ganó", no_electo: "No ganó" };

function Candidaturas({ d }: { d: DetallePolitico }) {
  return (
    <div className="space-y-4">
      {d.candidaturas.length > 0 ? (
        <ol className="space-y-2">
          {d.candidaturas.map((c, i) => (
            <li key={`${c.anio}-${i}`} className={`${TARJETA} flex items-start gap-3`}>
              <span className="shrink-0 rounded-lg bg-paperDeep px-2 py-1 font-mono text-meta font-semibold tabular-nums text-ink">{c.anio}</span>
              <div className="min-w-0 flex-1">
                <p className="text-dato font-semibold leading-snug text-ink">{c.cargo ? oracion(c.cargo) : "Candidatura con cuentas de campaña en la ONPE"}</p>
                <p className="mt-1 text-meta text-inkSoft">
                  <Partes
                    partes={[
                      c.lugar ? <Dato key="l" tipo="lugar">{tituloNatural(c.lugar)}</Dato> : null,
                      <Dato key="f" tipo="documento" nombre="Fuente">{c.fuente}</Dato>,
                    ]}
                  />
                </p>
              </div>
              <span className={`shrink-0 text-meta font-semibold ${c.resultado === "electo" ? "text-mossTexto" : "text-inkSoft"}`}>
                {c.resultado ? RESULTADO[c.resultado] : "Sin resultado"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <VacioEnLinea>No postuló con este partido: sólo aportó.</VacioEnLinea>
      )}
      {d.otrosPartidos.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-dato font-semibold text-ink">También figura en {plural(d.otrosPartidos.length, "otro partido", "otros partidos")}</h4>
          <ul className="space-y-2">
            {d.otrosPartidos.map((o) => (
              <li key={o.clave} className={`${TARJETA} flex items-center justify-between gap-3`}>
                <Link href={`/app/partidos/${encodeURIComponent(o.clave)}?seccion=politicos`} prefetch={false} className={`${ENLACE} min-w-0 text-dato leading-snug`}>
                  {o.partido ? tituloNatural(o.partido) : o.clave}
                </Link>
                <span className="shrink-0 text-right text-meta text-inkSoft">
                  {listaY([
                    ...(o.gano ? ["ganó"] : o.candidato ? ["postuló"] : []),
                    ...(o.aportante ? [`aportó ${solesCompacto(o.aportesMonto)}`] : []),
                  ]) || "figura"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Fuentes({ conDocumento }: { conDocumento: boolean }) {
  const fuentes: { que: string; href: string; texto: string }[] = [
    { que: "Candidaturas y autoridades", href: "https://plataformaelectoral.jne.gob.pe/", texto: "Plataforma Electoral del JNE" },
    { que: "Aportes y cuentas de campaña", href: "https://claridadportal.onpe.gob.pe/", texto: "Claridad, de la ONPE" },
    { que: "Socios, representantes y directivos", href: "https://apps.oece.gob.pe/perfilprov-ui/", texto: "Registro Nacional de Proveedores (OECE)" },
    { que: "Procesos y órdenes", href: "https://conosce.oece.gob.pe/buscador/", texto: "CONOSCE (OECE)" },
    { que: "Familiares declarados", href: "https://appdji.contraloria.gob.pe/DJIC/", texto: "Declaraciones juradas de intereses (Contraloría)" },
    { que: "Sanciones", href: "https://www.gob.pe/tce", texto: "Tribunal de Contrataciones del Estado" },
  ];
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-line/70 rounded-xl border border-line">
        {fuentes.map((f) => (
          <div key={f.que} className="grid gap-x-4 gap-y-0.5 px-3.5 py-2.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            <dt className="text-meta text-mute">{f.que}</dt>
            <dd className="min-w-0 text-meta">
              <EnlaceFuente href={f.href}>{f.texto}</EnlaceFuente>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-rotulo leading-relaxed text-mute">
        {conDocumento
          ? "Los registros se unen por el documento de la persona, que Vigía no muestra. "
          : "Su fuente no trae su documento, así que no se le buscó en los otros registros. "}
        Ninguno de estos datos dice que alguien ganó un contrato o un puesto por su vínculo con el partido. La Contraloría y la Procuraduría no publican
        nombres de personas: no hay cruce con sus informes ni sus casos.
      </p>
    </div>
  );
}
