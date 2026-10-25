import Link from "next/link";
import { ExternalLink, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { DatosClave, type DatoClave } from "@/components/patrones";
import { Tabla, CeldaNumero, type Columna, type Fila } from "@/components/listado";
import { fecha, listaY, numero, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { REGIMEN } from "@/lib/planilla";
import { FUENTE_TEXTO, SENAL, SEVERIDAD_TEXTO, type EntidadDePersona, type SenalDetalle } from "@/lib/personas";
import { VARIANTE_SEVERIDAD } from "./SenalesPersona";
import { txtONumero } from "@/lib/utils";

/**
 * Las señales de una persona en cada entidad, enteras: qué registro coincide, con sus datos (la candidatura, el aporte,
 * la autoridad, los meses, lo que cobra frente a la mediana…) y la fuente para verificarlo. Cada tipo trae su detalle
 * de la migración 91; los nombres llegan tapados por la API salvo los de autoridades electas. Server-safe.
 */
export function SenalesPorEntidad({ entidades }: { entidades: EntidadDePersona[] }) {
  const con = entidades.filter((e) => e.senalesDetalle.length > 0);
  // Lo que es de la persona y no de una entidad (un aporte, una candidatura, ser autoridad de otro gobierno) llega
  // igual en cada entidad: va una vez, arriba, con las entidades en que aplica. Lo demás, en su entidad, numerado.
  const clave = (s: SenalDetalle) => `${s.tipo}|${s.severidad}|${JSON.stringify(s.detalle ?? {})}`;
  const veces = new Map<string, number>();
  for (const e of con) for (const k of new Set(e.senalesDetalle.map(clave))) veces.set(k, (veces.get(k) ?? 0) + 1);
  const repetida = (s: SenalDetalle) => con.length > 1 && (veces.get(clave(s)) ?? 0) > 1;
  const comunes: { s: SenalDetalle; en: string[] }[] = [];
  const vistas = new Set<string>();
  for (const e of con) {
    for (const s of e.senalesDetalle) {
      if (!repetida(s) || vistas.has(clave(s))) continue;
      vistas.add(clave(s));
      comunes.push({ s, en: con.filter((x) => x.senalesDetalle.some((y) => clave(y) === clave(s))).map((x) => (x.entidad ? tituloNatural(x.entidad) : x.entidadRuc)) });
    }
  }
  const propias = (e: EntidadDePersona) => e.senalesDetalle.filter((s) => !repetida(s));
  return (
    <div className="space-y-5">
      {con.length > 1 && (
        <nav aria-label="Entidades con señales" className="rounded-2xl border border-line bg-paper p-4">
          <p className="mb-2 text-dato font-semibold text-ink">Tiene señales en {numero(con.length)} entidades</p>
          <ol className="space-y-1.5">
            {con.map((e, i) => {
              const graves = e.senalesDetalle.filter((s) => s.severidad === "alta").length;
              return (
                <li key={e.entidadRuc} className="flex items-baseline gap-2 text-dato">
                  <Numero n={i + 1} />
                  <a href={`#entidad-${i + 1}`} className="min-w-0 font-medium text-ink underline-offset-2 hover:text-granate hover:underline">
                    {e.entidad ? tituloNatural(e.entidad) : e.entidadRuc}
                  </a>
                  <span className="shrink-0 text-meta text-mute">
                    {plural(e.senalesDetalle.length, "señal", "señales")}
                    {graves > 0 ? `, ${plural(graves, "grave", "graves")}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      {comunes.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <header className="space-y-0.5">
            <h3 className="font-display text-bloque font-bold text-ink">Sobre la persona</h3>
            <p className="text-meta text-mute">Lo que otros registros dicen de ella y vale igual en varias de las entidades que la contrataron: va una sola vez.</p>
          </header>
          <ol className="space-y-3">
            {comunes.map(({ s, en }, i) => (
              <Senal key={clave(s)} s={s} numero={String(i + 1)} en={en} />
            ))}
          </ol>
        </section>
      )}
      {con.map((e, i) => {
        const lista = propias(e);
        return (
          <section key={e.entidadRuc} id={`entidad-${i + 1}`} className="scroll-mt-24 space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 items-start gap-2.5">
                {con.length > 1 && <Numero n={i + 1} grande />}
                <div className="min-w-0">
                  {con.length > 1 && <p className="text-rotulo font-medium text-mute">Entidad {i + 1} de {con.length}</p>}
                  <h3 className="font-display text-bloque font-bold text-ink">
                    <Link href={`/entidad/${e.entidadRuc}`} className="underline-offset-2 hover:text-granate hover:underline">
                      {e.entidad ? tituloNatural(e.entidad) : "Entidad"}
                    </Link>
                  </h3>
                </div>
              </div>
              <GobiernosLinea e={e} />
            </header>
            {lista.length ? (
              <ol className="space-y-3">
                {lista.map((s, k) => (
                  <Senal key={s.tipo} s={s} numero={con.length > 1 ? `${i + 1}.${k + 1}` : String(k + 1)} />
                ))}
              </ol>
            ) : (
              <p className="text-meta text-mute">Ninguna señal propia de esta entidad: las suyas son las de la persona, arriba.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Numero({ n, grande = false }: { n: number; grande?: boolean }) {
  return (
    <span
      className={
        "inline-flex shrink-0 items-center justify-center rounded-full bg-granate font-mono font-semibold tabular-nums text-paper " +
        (grande ? "mt-0.5 h-7 min-w-7 px-2 text-meta" : "h-5 min-w-5 px-1.5 text-rotulo")
      }
      aria-hidden
    >
      {n}
    </span>
  );
}

function Senal({ s, numero: num, en }: { s: SenalDetalle; numero: string; en?: string[] }) {
  return (
    <li className="flex gap-3 rounded-xl border border-line/80 bg-paperSoft p-3.5">
      <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-paperDeep px-1.5 font-mono text-rotulo font-semibold tabular-nums text-ink" aria-hidden>
        {num}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={VARIANTE_SEVERIDAD[s.severidad]}>{SEVERIDAD_TEXTO[s.severidad]}</Badge>
          <h4 className="text-cuerpo font-semibold text-ink">{SENAL[s.tipo]?.titulo ?? s.tipo}</h4>
        </div>
        <p className="max-w-prose text-dato leading-relaxed text-inkSoft">{SENAL[s.tipo]?.explica}</p>
        {en && en.length > 0 && (
          <p className="text-meta text-inkSoft">
            <span className="text-mute">Vale en: </span>
            {listaY(en)}
          </p>
        )}
        <Detalle s={s} />
        <Fuente s={s} />
      </div>
    </li>
  );
}

function GobiernosLinea({ e }: { e: EntidadDePersona }) {
  const g = [...(e.gobiernos ?? [])].sort((a, b) => b.anio - a.anio);
  if (!g.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft">
      <Landmark size={13} className="shrink-0 text-mute" aria-hidden />
      <span className="text-mute">Gobernaba</span>
      {g.map((x) => (
        <Link key={`${x.clave}-${x.anio}`} href={`/app/partidos/${x.clave}?anio=${x.anio}`} className="font-semibold text-ink underline-offset-2 hover:text-granate hover:underline">
          {x.nombre}
        </Link>
      ))}
    </span>
  );
}

function Fuente({ s }: { s: SenalDetalle }) {
  const texto = (s.fuente && FUENTE_TEXTO[s.fuente]) ?? s.fuente ?? "Fuente oficial";
  return (
    <p className="text-rotulo text-mute">
      Fuente:{" "}
      {s.fuenteUrl ? (
        <a href={s.fuenteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-granate underline-offset-2 hover:underline">
          {texto} <ExternalLink size={11} aria-hidden />
        </a>
      ) : (
        texto
      )}
    </p>
  );
}

type Obj = Record<string, unknown>;
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Obj[]) : []);
const txt = txtONumero;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? fecha(v.slice(0, 10)) : null);
const porQue = (por: unknown) =>
  por === "dni" ? "Coincide por el documento de identidad." : por === "nombre" ? "Coincide por el nombre completo y el departamento (la fuente no trae documento)." : null;

/** Una tabla chica: la lista de un detalle (candidaturas, aportes, autoridades…). */
function Lista({ columnas, filas, etiqueta }: { columnas: Columna[]; filas: Fila[]; etiqueta: string }) {
  if (!filas.length) return null;
  return <Tabla columnas={columnas} filas={filas} etiqueta={etiqueta} medida="contenedor" densidad="compacta" />;
}

function Detalle({ s }: { s: SenalDetalle }) {
  const d = s.detalle ?? {};
  switch (s.tipo) {
    case "candidato_gobierna":
    case "candidato": {
      const filas = lista(d.candidaturas)
        .sort((a, b) => (num(b.anio) ?? 0) - (num(a.anio) ?? 0))
        .map((c, i) => ({
          id: String(i),
          celdas: {
            anio: <span className="font-mono text-meta tabular-nums">{txt(c.anio) ?? "Sin año"}</span>,
            cargo: <span className="text-meta text-ink">{txt(c.cargo) ? tituloNatural(txt(c.cargo)!) : "Sin cargo en la fuente"}</span>,
            partido: <span className="text-meta text-inkSoft">{txt(c.partido) ?? "Sin dato"}</span>,
            resultado: <span className="text-meta text-inkSoft">{c.resultado === "electo" ? "Electo" : c.resultado === "no_electo" ? "No electo" : "Sin dato"}</span>,
          },
        }));
      return (
        <div className="space-y-2">
          {s.tipo === "candidato_gobierna" && txt(d.partido) && (
            <DatosClave items={[{ etiqueta: "Partido que gobernaba", valor: txt(d.partido) }]} />
          )}
          <Lista
            etiqueta="Candidaturas"
            columnas={[
              { clave: "anio", titulo: "Elección", ancho: "80px" },
              { clave: "cargo", titulo: "Cargo", ancho: "minmax(0,1fr)" },
              { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md" },
              { clave: "resultado", titulo: "Resultado", ancho: "96px", desde: "md" },
            ]}
            filas={filas}
          />
          <Nota>{porQue(d.por)}</Nota>
        </div>
      );
    }
    case "aporte_gobierna":
    case "aporte": {
      const filas = lista(d.aportes).map((a, i) => ({
        id: String(i),
        celdas: {
          fecha: <span className="text-meta tabular-nums text-mute">{dia(a.fecha) ?? txt(a.anio) ?? "Sin fecha"}</span>,
          partido: <span className="text-meta text-ink">{txt(a.partido) ?? "Sin dato"}</span>,
          monto: <CeldaNumero>{num(a.monto) != null ? soles(num(a.monto)) : "Sin dato"}</CeldaNumero>,
        },
      }));
      return (
        <div className="space-y-2">
          <DatosClave
            items={[
              ...(s.tipo === "aporte_gobierna" && txt(d.partido) ? [{ etiqueta: "Partido que gobernaba", valor: txt(d.partido) }] : []),
              ...(num(d.monto) != null ? [{ etiqueta: "Total aportado", valor: soles(num(d.monto)), mono: true }] : []),
            ]}
          />
          <Lista
            etiqueta="Aportes"
            columnas={[
              { clave: "fecha", titulo: "Fecha", ancho: "110px" },
              { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)" },
              { clave: "monto", titulo: "Monto", ancho: "110px", alinear: "der" },
            ]}
            filas={filas}
          />
        </div>
      );
    }
    case "autoridad_contratada":
    case "apellidos_autoridad": {
      const filas = lista(d.autoridades).map((a, i) => ({
        id: String(i),
        celdas: {
          nombre: <span className="text-meta font-medium text-ink">{txt(a.nombre) ?? "Sin nombre"}</span>,
          cargo: <span className="text-meta text-inkSoft">{txt(a.cargo) ? tituloNatural(txt(a.cargo)!) : "Sin cargo"}</span>,
          partido: <span className="text-meta text-inkSoft">{txt(a.partido) ?? "Sin dato"}</span>,
          periodo: <span className="text-meta tabular-nums text-mute">{[txt(a.desde)?.slice(0, 4), txt(a.hasta)?.slice(0, 4)].filter(Boolean).join(" a ") || "Sin dato"}</span>,
        },
      }));
      const frec = num(d.frecuencia);
      return (
        <div className="space-y-2">
          <Lista
            etiqueta="Autoridades"
            columnas={[
              { clave: "nombre", titulo: s.tipo === "apellidos_autoridad" ? "Autoridad" : "Como", ancho: "minmax(0,1.2fr)" },
              { clave: "cargo", titulo: "Cargo", ancho: "minmax(0,1fr)" },
              { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md" },
              { clave: "periodo", titulo: "Mandato", ancho: "96px", desde: "md" },
            ]}
            filas={filas}
          />
          {s.tipo === "autoridad_contratada" && <Nota>{d.mismo_gobierno ? "Es autoridad del mismo gobierno que le dio las órdenes." : "Es autoridad de otro gobierno, no del que le dio las órdenes."}</Nota>}
          {s.tipo === "autoridad_contratada" && <Nota>{porQue(d.por)}</Nota>}
          {s.tipo === "apellidos_autoridad" && frec != null && (
            <Nota>{`${plural(frec, "persona contratada lleva", "personas contratadas llevan")} estos dos apellidos en todo el país.`}</Nota>
          )}
        </div>
      );
    }
    case "apellidos_funcionario": {
      const filas = lista(d.funcionarios_designados).map((f, i) => ({
        id: String(i),
        celdas: {
          nombre: <span className="text-meta font-medium text-ink">{txt(f.nombre) ?? "Sin nombre"}</span>,
          cargo: <span className="text-meta text-inkSoft">{txt(f.cargo) ? tituloNatural(txt(f.cargo)!) : "Sin cargo"}</span>,
          anio: <span className="font-mono text-meta tabular-nums text-mute">{txt(f.anio) ?? "Sin año"}</span>,
        },
      }));
      const frec = num(d.frecuencia);
      return (
        <div className="space-y-2">
          <Lista
            etiqueta="Funcionarios con los mismos apellidos"
            columnas={[
              { clave: "nombre", titulo: "Funcionario", ancho: "minmax(0,1.2fr)" },
              { clave: "cargo", titulo: "Cargo declarado", ancho: "minmax(0,1fr)" },
              { clave: "anio", titulo: "Declaración", ancho: "96px", desde: "md" },
            ]}
            filas={filas}
          />
          {frec != null && <Nota>{`${plural(frec, "persona contratada lleva", "personas contratadas llevan")} estos dos apellidos en todo el país.`}</Nota>}
        </div>
      );
    }
    case "funcionario_contratado": {
      const filas = lista(d.cargos).map((c, i) => ({
        id: String(i),
        celdas: {
          cargo: <span className="text-meta text-ink">{txt(c.cargo) ? tituloNatural(txt(c.cargo)!) : "Sin cargo"}</span>,
          anio: <span className="font-mono text-meta tabular-nums text-mute">{txt(c.anio) ?? "Sin año"}</span>,
          desde: <span className="text-meta tabular-nums text-mute">{dia(c.inicio) ?? "Sin dato"}</span>,
        },
      }));
      return (
        <Lista
          etiqueta="Cargos declarados"
          columnas={[
            { clave: "cargo", titulo: "Cargo declarado", ancho: "minmax(0,1fr)" },
            { clave: "anio", titulo: "Declaración", ancho: "96px" },
            { clave: "desde", titulo: "Desde", ancho: "110px", desde: "md" },
          ]}
          filas={filas}
        />
      );
    }
    case "inhabilitado": {
      const filas = lista(d.sanciones).map((x, i) => ({
        id: String(i),
        celdas: {
          tipo: <span className="text-meta text-ink">{x.tipo === "definitivo" ? "Definitiva" : "Temporal"}</span>,
          periodo: <span className="text-meta tabular-nums text-mute">{[dia(x.desde), dia(x.hasta)].filter(Boolean).join(" a ") || "Sin dato"}</span>,
          resolucion: <span className="font-mono text-meta text-inkSoft">{txt(x.resolucion) ?? "Sin dato"}</span>,
        },
      }));
      // Las órdenes concretas que recibió dentro de la inhabilitación: la cita a la evidencia, una por una.
      const ordenes = lista(d.ordenes_detalle).map((o, i) => ({
        id: `ord-${i}`,
        celdas: {
          fecha: <span className="text-meta tabular-nums text-mute">{dia(o.fecha) ?? "Sin dato"}</span>,
          servicio: <span className="text-meta text-inkSoft">{txt(o.servicio) ?? txt(o.descripcion) ?? "Sin dato"}</span>,
          numero: <span className="font-mono text-meta text-inkSoft">{txt(o.numero) ?? txt(o.orden) ?? "Sin dato"}</span>,
          monto: <CeldaNumero>{soles(num(o.monto) ?? 0)}</CeldaNumero>,
        },
      }));
      return (
        <div className="space-y-2">
          <DatosClave
            items={[
              { etiqueta: "Órdenes durante la inhabilitación", valor: numero(num(d.ordenes) ?? 0), mono: true },
              { etiqueta: "Monto de esas órdenes", valor: soles(num(d.monto) ?? 0), mono: true },
            ]}
          />
          <Lista
            etiqueta="Inhabilitaciones"
            columnas={[
              { clave: "tipo", titulo: "Inhabilitación", ancho: "110px" },
              { clave: "periodo", titulo: "Vigencia", ancho: "minmax(0,1fr)" },
              { clave: "resolucion", titulo: "Resolución", ancho: "minmax(0,1fr)", desde: "md" },
            ]}
            filas={filas}
          />
          {ordenes.length > 0 && (
            <Lista
              etiqueta="Cada orden recibida durante la inhabilitación"
              columnas={[
                { clave: "fecha", titulo: "Fecha", ancho: "110px" },
                { clave: "servicio", titulo: "Servicio", ancho: "minmax(0,1fr)" },
                { clave: "numero", titulo: "N° de orden", ancho: "minmax(0,170px)", desde: "md" },
                { clave: "monto", titulo: "Monto", ancho: "120px", alinear: "der" },
              ]}
              filas={ordenes}
            />
          )}
        </div>
      );
    }
    case "meses_seguidos": {
      const filas = lista(d.anios).map((a, i) => ({
        id: String(i),
        celdas: {
          anio: <span className="font-mono text-meta tabular-nums">{txt(a.anio)}</span>,
          meses: <CeldaNumero>{`${txt(a.meses)} de 12`}</CeldaNumero>,
          ordenes: <CeldaNumero>{numero(num(a.ordenes) ?? 0)}</CeldaNumero>,
          monto: <CeldaNumero>{soles(num(a.monto) ?? 0)}</CeldaNumero>,
        },
      }));
      return (
        <Lista
          etiqueta="Años con órdenes casi todos los meses"
          columnas={[
            { clave: "anio", titulo: "Año", ancho: "72px" },
            { clave: "meses", titulo: "Meses con orden", ancho: "minmax(0,1fr)", alinear: "der" },
            { clave: "ordenes", titulo: "Órdenes", ancho: "84px", alinear: "der" },
            { clave: "monto", titulo: "Monto", ancho: "120px", alinear: "der" },
          ]}
          filas={filas}
        />
      );
    }
    case "pago_alto": {
      const filas = lista(d.anios).map((a, i) => ({
        id: String(i),
        celdas: {
          anio: <span className="font-mono text-meta tabular-nums">{txt(a.anio)}</span>,
          servicio: <span className="text-meta text-inkSoft">{txt(a.servicio) ?? "Sin dato"}</span>,
          suyo: <CeldaNumero>{soles(num(a.por_mes) ?? 0)}</CeldaNumero>,
          mediana: <CeldaNumero sub={`de ${numero(num(a.personas) ?? 0)} personas`}>{soles(num(a.mediana_mes) ?? 0)}</CeldaNumero>,
          veces: <CeldaNumero>{`${String(num(a.veces) ?? "").replace(".", ",")} veces`}</CeldaNumero>,
        },
      }));
      return (
        <Lista
          etiqueta="Lo que cobra por mes frente a la mediana de la entidad"
          columnas={[
            { clave: "anio", titulo: "Año", ancho: "64px" },
            { clave: "servicio", titulo: "Servicio", ancho: "minmax(0,1fr)", desde: "md" },
            { clave: "suyo", titulo: "Cobra por mes", ancho: "112px", alinear: "der" },
            { clave: "mediana", titulo: "Mediana de la entidad", ancho: "140px", alinear: "der" },
            { clave: "veces", titulo: "Diferencia", ancho: "92px", alinear: "der" },
          ]}
          filas={filas}
        />
      );
    }
    case "tambien_planilla": {
      const meses = Array.isArray(d.meses) ? (d.meses as unknown[]).map((m) => txt(m)).filter((m): m is string => !!m).sort() : [];
      const regimen = num(d.regimen);
      return (
        <DatosClave
          items={[
            { etiqueta: "Meses con órdenes y planilla", valor: meses.length ? meses.join(", ") : null, mono: true },
            { etiqueta: "Cargo en la planilla", valor: txt(d.cargo) ? tituloNatural(txt(d.cargo)!) : null },
            { etiqueta: "Régimen", valor: regimen != null ? REGIMEN[regimen] ?? `Régimen ${regimen}` : null },
            { etiqueta: "Lo que cobró en planilla", valor: num(d.sueldo) != null ? soles(num(d.sueldo)!) : null, mono: true },
          ]}
        />
      );
    }
    case "paso_a_planilla": {
      const regimen = num(d.regimen);
      const mes = txt(d.primer_mes_planilla);
      return (
        <DatosClave
          items={[
            { etiqueta: "Primera orden", valor: dia(d.primera_orden), mono: true },
            { etiqueta: "Entró a la planilla", valor: mes ? mes.slice(0, 7) : null, mono: true },
            { etiqueta: "Cargo en la planilla", valor: txt(d.cargo) ? tituloNatural(txt(d.cargo)!) : null },
            { etiqueta: "Régimen", valor: regimen != null ? REGIMEN[regimen] ?? `Régimen ${regimen}` : null },
          ]}
        />
      );
    }
    case "visita_previa": {
      const filas = lista(d.visitas).map((v, i) => ({
        id: String(i),
        celdas: {
          fecha: <span className="text-meta tabular-nums text-mute">{dia(v.fecha) ?? "Sin fecha"}</span>,
          visitado: <span className="text-meta text-ink">{txt(v.cargo_visitado) ? tituloNatural(txt(v.cargo_visitado)!) : "Sin dato"}</span>,
          motivo: <span className="text-meta text-inkSoft">{txt(v.motivo) ?? "Sin dato"}</span>,
        },
      }));
      return (
        <Lista
          etiqueta="Visitas"
          columnas={[
            { clave: "fecha", titulo: "Fecha", ancho: "110px" },
            { clave: "visitado", titulo: "A quién (cargo)", ancho: "minmax(0,1fr)" },
            { clave: "motivo", titulo: "Motivo", ancho: "minmax(0,1fr)", desde: "md" },
          ]}
          filas={filas}
        />
      );
    }
    default:
      return null;
  }
}

function Nota({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return <p className="text-meta text-mute">{children}</p>;
}

export type { DatoClave };
