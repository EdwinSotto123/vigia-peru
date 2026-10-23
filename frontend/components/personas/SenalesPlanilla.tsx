import { DatosClave, type DatoClave } from "@/components/patrones";
import { CeldaNumero, Tabla, type Columna, type Fila } from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { numero, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { SENAL_PLANILLA, type SenalConDetalle, type TipoPlanilla } from "@/lib/planilla";
import { SEVERIDAD_TEXTO } from "@/lib/personas";
import { VARIANTE_SEVERIDAD } from "./SenalesPersona";

/**
 * Las señales de una persona de la planilla, enteras y numeradas (1, 2, 3…): qué registro coincide, con su detalle en
 * tablas y pares rótulo/valor (nunca datos pegados con comas) y la fuente. La usan la ficha de planilla
 * (/app/personas/planilla/<codigo>) y el panel de la lista. Server-safe.
 */
export function SenalesPlanillaLista({ senales }: { senales: SenalConDetalle<TipoPlanilla>[] }) {
  return (
    <ol className="space-y-3">
      {senales.map((s, i) => (
        <li key={s.tipo} className="flex gap-3 rounded-xl border border-line/80 bg-paperSoft p-3.5">
          <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-paperDeep px-1.5 font-mono text-rotulo font-semibold tabular-nums text-ink" aria-hidden>
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={VARIANTE_SEVERIDAD[s.severidad]}>{SEVERIDAD_TEXTO[s.severidad]}</Badge>
              <h4 className="text-cuerpo font-semibold text-ink">{SENAL_PLANILLA[s.tipo]?.titulo ?? s.tipo}</h4>
            </div>
            <p className="max-w-prose text-dato leading-relaxed text-inkSoft">{SENAL_PLANILLA[s.tipo]?.explica}</p>
            <DetalleSenalPlanilla tipo={s.tipo} d={s.detalle} />
            <p className="text-rotulo text-mute">
              Fuente: {s.tipo === "candidato_gobierna" ? "JNE, candidaturas" : s.tipo === "apellidos_autoridad" || s.tipo === "es_autoridad" ? "JNE, autoridades electas" : s.tipo === "tambien_ordenes" || s.tipo === "antes_locador" ? "OECE, CONOSCE (órdenes) y Portal de Transparencia (planilla)" : "Portal de Transparencia Estándar, personal"}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);
const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
/** "no electo" → "No electo". */
const oracionSimple = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();

function TablaChica({ columnas, filas, etiqueta }: { columnas: Columna[]; filas: Fila[]; etiqueta: string }) {
  if (!filas.length) return null;
  return <Tabla columnas={columnas} filas={filas} etiqueta={etiqueta} medida="contenedor" densidad="compacta" />;
}

const texto = (v: string | null) => <span className="text-meta text-ink">{v ?? "Sin dato"}</span>;

export function DetalleSenalPlanilla({ tipo, d }: { tipo: TipoPlanilla; d: Record<string, unknown> }) {
  let items: DatoClave[] = [];
  if (tipo === "pago_extraordinario") {
    items = [
      { etiqueta: "Su sueldo", valor: n(d.base) != null ? soles(n(d.base)) : null, mono: true },
      { etiqueta: "Fuera del sueldo", valor: n(d.extra) != null ? soles(n(d.extra)) : null, mono: true },
      { etiqueta: "Total del mes", valor: n(d.total) != null ? soles(n(d.total)) : null, mono: true },
    ];
  } else if (tipo === "brecha_cargo") {
    items = [
      { etiqueta: "Su sueldo", valor: n(d.total) != null ? soles(n(d.total)) : null, mono: true },
      { etiqueta: "Mediana de su cargo", valor: n(d.mediana) != null ? `${soles(n(d.mediana))} (${numero(n(d.personas) ?? 0)} personas)` : null },
      { etiqueta: "Diferencia", valor: n(d.veces) != null ? `${String(n(d.veces)).replace(".", ",")} veces` : null },
      ...(n(d.ganan_tanto) != null
        ? [{ etiqueta: "Con su cargo ganan tanto", valor: n(d.ganan_tanto) === 1 ? "Sólo esta persona" : `${numero(n(d.ganan_tanto) ?? 0)} personas` }]
        : []),
      // Tanta diferencia suele ser un pago acumulado (devengados de varios meses) cargado como sueldo.
      ...((n(d.veces) ?? 0) >= 5
        ? [{ etiqueta: "Ojo", valor: "Una diferencia así suele ser un pago acumulado de varios meses registrado como sueldo: mira su sueldo mes a mes." }]
        : []),
    ];
  } else if (tipo === "tambien_ordenes") {
    items = [
      { etiqueta: "Meses con las dos cosas", valor: lista(d.meses).map(String).sort().join(", ") || null, mono: true },
      { etiqueta: "Órdenes esos meses", valor: n(d.ordenes) != null ? numero(n(d.ordenes) ?? 0) : null },
      { etiqueta: "Pagado por esas órdenes", valor: n(d.monto) != null ? soles(n(d.monto) ?? 0) : null, mono: true },
    ];
  } else if (tipo === "antes_locador") {
    items = [
      { etiqueta: "Primera orden", valor: t(d.primera_orden)?.slice(0, 10) ?? null, mono: true },
      { etiqueta: "Entró a la planilla", valor: t(d.primer_mes_planilla)?.slice(0, 7) ?? null, mono: true },
      ...(n(d.monto) != null ? [{ etiqueta: "Cobrado por órdenes", valor: soles(n(d.monto) ?? 0), mono: true }] : []),
    ];
  } else if (tipo === "apellidos_autoridad") {
    return (
      <div className="space-y-1.5">
        <TablaChica
          etiqueta="Autoridades con sus dos apellidos"
          columnas={[
            { clave: "nombre", titulo: "Autoridad", ancho: "minmax(0,1.3fr)" },
            { clave: "cargo", titulo: "Cargo", ancho: "minmax(0,1fr)" },
            { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md" },
          ]}
          filas={lista(d.autoridades).map((a, i) => ({
            id: String(i),
            celdas: { nombre: texto(t(a.nombre)), cargo: texto(t(a.cargo) ? tituloNatural(t(a.cargo)!) : null), partido: texto(t(a.partido)) },
          }))}
        />
        {n(d.frecuencia) != null && (
          <p className="text-meta text-mute">
            {n(d.frecuencia) === 1
              ? "Es la única persona de las planillas cargadas con estos dos apellidos."
              : `${numero(n(d.frecuencia) ?? 0)} personas de las planillas cargadas llevan estos dos apellidos.`}
          </p>
        )}
      </div>
    );
  } else if (tipo === "es_autoridad") {
    return (
      <TablaChica
        etiqueta="Su cargo de autoridad"
        columnas={[
          { clave: "cargo", titulo: "Cargo", ancho: "minmax(0,1fr)" },
          { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md" },
          { clave: "mandato", titulo: "Mandato", ancho: "110px" },
        ]}
        filas={lista(d.autoridades).map((a, i) => ({
          id: String(i),
          celdas: {
            cargo: texto(t(a.cargo) ? tituloNatural(t(a.cargo)!) : null),
            partido: texto(t(a.partido)),
            mandato: texto([t(a.desde)?.slice(0, 4), t(a.hasta)?.slice(0, 4)].filter(Boolean).join(" a ") || null),
          },
        }))}
      />
    );
  } else if (tipo === "apellidos_directivo") {
    return (
      <TablaChica
        etiqueta="Directivos con sus dos apellidos"
        columnas={[
          { clave: "nombre", titulo: "Directivo", ancho: "minmax(0,1.3fr)" },
          { clave: "cargo", titulo: "Cargo", ancho: "minmax(0,1fr)" },
        ]}
        filas={lista(d.funcionarios_designados).map((f, i) => ({
          id: String(i),
          celdas: { nombre: texto(t(f.nombre)), cargo: texto(t(f.cargo) ? tituloNatural(t(f.cargo)!) : null) },
        }))}
      />
    );
  } else if (tipo === "candidato_gobierna") {
    return (
      <div className="space-y-2">
        <DatosClave items={[{ etiqueta: "Partido que gobierna la entidad", valor: t(d.partido) }]} />
        <TablaChica
          etiqueta="Sus candidaturas"
          columnas={[
            { clave: "anio", titulo: "Elección", ancho: "80px" },
            { clave: "cargo", titulo: "Cargo", ancho: "minmax(0,1fr)" },
            { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)", desde: "md" },
            { clave: "resultado", titulo: "Resultado", ancho: "110px", desde: "md" },
          ]}
          filas={lista(d.candidaturas).map((c, i) => ({
            id: String(i),
            celdas: {
              anio: <CeldaNumero>{t(c.anio) ?? "Sin año"}</CeldaNumero>,
              cargo: texto(t(c.cargo) ? tituloNatural(t(c.cargo)!) : null),
              partido: texto(t(c.partido)),
              resultado: texto(t(c.resultado) ? oracionSimple(t(c.resultado)!.replace(/_/g, " ")) : null),
            },
          }))}
        />
      </div>
    );
  }
  return items.length ? <DatosClave items={items} /> : null;
}
