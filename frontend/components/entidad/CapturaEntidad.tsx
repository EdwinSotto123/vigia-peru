import Link from "next/link";
import { Network } from "lucide-react";
import { tituloNatural } from "@/lib/landing";
import { numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { clavePartido, type GrafoCaptura, type PoderEntidad } from "@/lib/poder";
import { esLazoFuerte } from "@/lib/grafo";
import { TIPO_CRUCE } from "@/lib/cruces";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, CuerpoDetalle, DatosClave, PieDetalle } from "@/components/patrones/Detalle";
import { CeldaNumero, CeldaPrincipal, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { BloqueInicio, Fichas, type FilaConteo } from "@/components/inicio/BloquesInicio";
import { GrafoCapturaViz } from "./GrafoCapturaViz";

/**
 * La «captura» de una entidad (mapa de poder, migración 125) dentro del sistema de banderas, no en carteles aparte.
 *
 * Antes eran cuatro bloques que se repetían (quién decide, la red radial, "quién la gobierna y a quién le compra", la
 * cadena de captura): el partido y el alcalde tres veces, «37 contratos con indicio» sin enlace y «no es una
 * acusación» cinco veces. Ahora, con los mismos datos:
 *   · `filaCaptura`: UNA fila de las Banderas del Inicio, que abre la lista de esos contratos ya filtrada;
 *   · `EmpresasLigadas`: las empresas en una tabla (lazo, contratos, monto); cada fila abre el panel lateral. La red,
 *     como "Ver como red", sólo en pantallas anchas y con 4 empresas o más;
 *   · `QuienGobierna`: el partido, su autoridad y el período, en la columna lateral.
 *
 * La captura junta tres lazos de casos_cruce: la empresa financió al partido que gobierna (partido_gobernante), le
 * vendió a su campaña (vendio_gobernante) o tiene un socio que trabaja en la entidad (socio_en_entidad). El tercero
 * no es del partido: por eso la fila dice "ligada a la gestión" y no "al partido" (en Lima, 36 de los 37).
 */

export const TIPOS_CAPTURA = ["partido_gobernante", "vendio_gobernante", "socio_en_entidad"];

/**
 * El filtro de la lista de contratos con los tres lazos: `cruce=` toma CUALQUIERA de los tipos (backend
 * routes/contratos.ts, `k.tipos && $n`), y `cruces=` uno solo. Con `desde`/`hasta` del periodo de gobierno es la misma
 * cuenta que `n_captura` (refrescar_poder, migración 140: lo convocado en el gobierno vigente): Lima, 12 y 12.
 */
export const CRUCE_CAPTURA = TIPOS_CAPTURA.join(",");

/** Cómo se ligan, en palabras y sólo con lo que hay: "Le vendió a la campaña de Renovación Popular o un socio…". */
function comoSeLigan(p: PoderEntidad): string | undefined {
  const partido = tituloNatural(p.partido);
  const financio = (p.n_financiaron ?? 0) > 0;
  const vendio = (p.n_vendieron ?? 0) > 0;
  const partes = [
    financio && vendio ? `financió o le vendió a la campaña de ${partido}` : financio ? `financió a ${partido}` : vendio ? `le vendió a la campaña de ${partido}` : null,
    (p.n_socio ?? 0) > 0 ? "un socio de la empresa trabaja en la entidad" : null,
  ].filter((x): x is string => !!x);
  const texto = partes.join(" o ");
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : undefined;
}

/**
 * La fila de las Banderas: cuántos contratos ganó una empresa ligada a la gestión, con la lista que los muestra. Con
 * gobierno electo y ninguno, la fila queda en 0 (es un dato: con los registros de hoy, ninguno).
 */
export function filaCaptura(p: PoderEntidad, href: (filtro: Record<string, string>) => string): FilaConteo {
  return {
    etiqueta: "Ganó una empresa ligada a la gestión",
    n: p.n_captura ?? 0,
    // El periodo del gobierno vigente: la lista cuenta lo mismo que la cifra (no lo de gestiones anteriores).
    href: href({ cruce: CRUCE_CAPTURA, ...(p.periodoInicio ? { desde: p.periodoInicio } : {}), ...(p.periodoFin ? { hasta: p.periodoFin } : {}) }),
    detalle: comoSeLigan(p) ?? `Ninguna ligada a ${tituloNatural(p.partido)}, que la gobierna, ni a la entidad`,
    grave: (p.n_captura ?? 0) > 0,
  };
}

const severidadLazo = (l: string) => (esLazoFuerte([l]) ? ("alta" as const) : ("media" as const));
const crucesDe = (lazos: string[]) => lazos.map((tipo) => ({ tipo, severidad: severidadLazo(tipo) }));

// En un ancho angosto (el celular, o la columna principal a 1280 px) el nombre de la empresa va entero y lo demás
// debajo, con su rótulo: lazo, contratos y monto en una línea.
const COLUMNAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1.5fr)" },
  { clave: "lazo", titulo: "Lazo", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
  { clave: "contratos", titulo: "Contratos", ancho: "84px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "monto", titulo: "Adjudicado", ancho: "104px", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

/**
 * Las empresas ligadas a la gestión que ganaron contratos de la entidad. `grafo` trae hasta 18 (las de más contratos);
 * si `poder` cuenta más, se dice cuántas faltan y la lista filtrada de contratos las tiene todas.
 */
export function EmpresasLigadas({
  poder,
  grafo,
  entidadRuc,
  href,
}: {
  poder: PoderEntidad;
  grafo: GrafoCaptura | null;
  entidadRuc: string;
  href: (filtro: Record<string, string>) => string;
}) {
  const empresas = grafo?.empresas ?? [];
  if (!poder.n_captura || !empresas.length) return null;
  const faltan = Math.max(0, (poder.n_empresas ?? 0) - empresas.length);

  const filas: Fila[] = empresas.map((e) => {
    const nombre = tituloNatural(e.nombre ?? `RUC ${e.ruc}`);
    return {
      id: e.ruc,
      buscable: `${nombre} ${e.ruc}`,
      celdas: {
        empresa: <CeldaPrincipal titulo={nombre} meta={[<Dato key="r" tipo="ruc" mono>{e.ruc}</Dato>]} enLinea />,
        lazo: <CrucesCelda cruces={crucesDe(e.lazos)} />,
        contratos: <CeldaNumero>{numero(e.contratos)}</CeldaNumero>,
        monto: <CeldaNumero>{solesCompacto(e.monto)}</CeldaNumero>,
      },
      detalle: {
        titulo: nombre,
        descripcion: "Empresa ligada a la gestión que gobierna esta entidad",
        contenido: (
          <CuerpoDetalle>
            <CrucesCelda cruces={crucesDe(e.lazos)} />
            <DatosClave
              items={[
                { etiqueta: "RUC", valor: e.ruc, mono: true },
                { etiqueta: "Contratos con el lazo", valor: plural(e.contratos, "contrato de esta entidad", "contratos de esta entidad") },
                { etiqueta: "Adjudicado en ellos", valor: soles(e.monto), mono: true },
              ]}
            />
            <BloqueDetalle titulo="Cómo se liga">
              <ul className="space-y-2">
                {e.lazos.map((l) => (
                  <li key={l} className="text-dato leading-relaxed text-inkSoft">
                    <span className="font-semibold text-ink">{TIPO_CRUCE[l]?.corto ?? l}.</span> {TIPO_CRUCE[l]?.explica}
                  </li>
                ))}
              </ul>
            </BloqueDetalle>
          </CuerpoDetalle>
        ),
        pie: (
          <PieDetalle
            principal={
              <EnlaceAccion href={`/empresa/${e.ruc}?seccion=contratos&cent=${entidadRuc}`} flecha>
                Sus contratos con la entidad
              </EnlaceAccion>
            }
            secundarias={
              <EnlaceAccion href={`/empresa/${e.ruc}`} variante="secundario">
                Ver la empresa
              </EnlaceAccion>
            }
          />
        ),
      },
    };
  });

  return (
    <BloqueInicio
      nivel={3}
      titulo="Empresas ligadas a la gestión"
      ayuda={
        <Ayuda titulo="¿Qué empresas son?">
          <span className="block">
            Las que ganaron contratos de esta entidad y financiaron o le vendieron a la campaña del partido que la gobierna
            (ONPE × JNE), o tienen un socio o representante que trabaja en la misma entidad (RNP × registro de
            contratados).
          </span>
          <span className="mt-2 block">Sólo empresas (RUC 20): de las personas naturales no se publica el lazo.</span>
        </Ayuda>
      }
      enlace={{ href: href({ cruce: CRUCE_CAPTURA }), texto: `Ver sus ${numero(poder.n_captura)} contratos` }}
    >
      <div className="space-y-4">
        <DatosClave
          items={[
            { etiqueta: "Empresas", valor: faltan > 0 ? `${numero(poder.n_empresas)} (abajo, las ${numero(empresas.length)} con más contratos)` : numero(poder.n_empresas) },
            { etiqueta: "Adjudicado en esos contratos", valor: solesCompacto(poder.monto_captura), mono: true },
            {
              // Contratos (no empresas) por cada lazo: cada uno abre su lista filtrada.
              etiqueta: "Contratos por lazo",
              valor: (
                <Fichas
                  items={TIPOS_CAPTURA.map((t) => ({
                    etiqueta: TIPO_CRUCE[t]?.corto ?? t,
                    n: t === "partido_gobernante" ? poder.n_financiaron : t === "vendio_gobernante" ? poder.n_vendieron : poder.n_socio,
                    href: href({ cruces: t }),
                  }))}
                />
              ),
            },
          ]}
        />
        <TablaPaginada
          columnas={COLUMNAS}
          filas={filas}
          etiqueta="Empresas ligadas a la gestión"
          nombre="empresas"
          tam={8}
          densidad="compacta"
          medida="contenedor"
          buscar={{ placeholder: "Buscar una empresa por nombre o RUC…", etiqueta: "Buscar entre las empresas ligadas" }}
        />
        {/* La red repite la tabla como dibujo: sólo donde se lee (desde lg; con la barra lateral, a md quedaba en letra
            de 9 px) y con 4 empresas o más (con menos es una lista dibujada). */}
        {empresas.length >= 4 && grafo && (
          <details className="group/red hidden lg:block">
            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full border border-line px-3.5 text-meta font-semibold text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-ink [&::-webkit-details-marker]:hidden">
              <Network size={14} aria-hidden />
              <span className="group-open/red:hidden">Ver como red</span>
              <span className="hidden group-open/red:inline">Ocultar la red</span>
            </summary>
            <div className="pt-4">
              <GrafoCapturaViz data={grafo} />
            </div>
          </details>
        )}
      </div>
    </BloqueInicio>
  );
}

/** "oct. 2025": el mes y el año de una fecha ISO, en Lima. */
function mesAnio(iso: string | null): string | null {
  if (!iso) return null;
  const f = new Date(`${iso.slice(0, 10)}T12:00:00-05:00`);
  return Number.isNaN(f.getTime()) ? null : new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", month: "short", year: "numeric" }).format(f);
}

/**
 * Quién gobierna la entidad hoy (JNE): el partido, su autoridad electa (nombre completo: es una autoridad) y el
 * período. Va en la columna lateral del Inicio. Sin gobierno electo (ministerios, organismos), no se muestra.
 */
export function QuienGobierna({ poder }: { poder: PoderEntidad | null }) {
  if (!poder?.partido) return null;
  const desde = mesAnio(poder.periodoInicio);
  const hasta = mesAnio(poder.periodoFin);
  const cargo = poder.cargo_gob ? oracion(poder.cargo_gob) : "Autoridad electa";
  return (
    <BloqueInicio
      titulo="Quién la gobierna"
      ayuda={
        <Ayuda titulo="¿De dónde sale?">
          Del JNE: la autoridad electa que hoy está en el cargo y la organización política por la que postuló.
        </Ayuda>
      }
    >
      <DatosClave
        items={[
          {
            etiqueta: "Partido",
            valor: (
              <Link href={`/app/poder/${clavePartido(poder.partido)}`} prefetch={false} className="font-semibold text-granate underline-offset-2 hover:underline">
                {tituloNatural(poder.partido)}
              </Link>
            ),
          },
          { etiqueta: cargo, valor: poder.autoridad ? tituloNatural(poder.autoridad) : null },
          { etiqueta: "Período", valor: desde && hasta ? `${desde} a ${hasta}` : (hasta ? `Hasta ${hasta}` : null) },
        ]}
      />
    </BloqueInicio>
  );
}
