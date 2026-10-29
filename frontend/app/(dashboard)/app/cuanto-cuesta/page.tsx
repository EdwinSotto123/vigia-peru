import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Calculator, CalendarClock, CircleDollarSign, Info, Receipt } from "lucide-react";
import { EncabezadoPagina, FuenteDato, Migas, Nota, Pagina, Seccion } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, type Columna, type Fila } from "@/components/listado";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { MetaDelMes } from "@/components/financiar/MetaDelMes";
import { fechaCorta, numero, plural, porcentaje, soles } from "@/lib/formato";
import { dolares, getVigilancia, mesConMayuscula, nombreMes, type ResumenVigilancia, type RubroCosto } from "@/lib/financiamiento";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Cuánto cuesta Vigía",
  description: "Lo que cuesta mantener Vigía cada mes, rubro por rubro y con la fuente de cada cifra, y en qué se usa lo que aportas.",
};

export const revalidate = 300;

/**
 * /app/cuanto-cuesta — las cuentas abiertas de Vigía (migración 206; GET /financiamiento/vigilancia): lo que cuesta
 * cada mes por rubro (la factura de AWS por Cost Explorer, la tarifa de Cloudflare), lo que costó la IA en cada lectura,
 * la meta del mes, lo recaudado y la historia mes a mes. Cada cifra dice de dónde sale; lo que no está, se dice.
 *
 * Rehecha el 2026-10-29 («texto y ya, nada de jerarquía»): las dos tablas de ancho fijo (34rem y 30rem) cortaban «Al
 * mes», «De dónde sale», «IA» y «Recaudado» en el celular, y ahora son la `Tabla` de todo listado; las cuatro tarjetas
 * iguales de la lectura con IA escondían una multiplicación, y ahora son la cuenta, renglón por renglón.
 */
export default async function CuantoCuestaPage() {
  const v = await getVigilancia();
  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Ayúdanos a seguir vigilando", href: "/app/apoyar" },
          { etiqueta: "Cuánto cuesta Vigía", href: "/app/cuanto-cuesta" },
        ]}
      />
      <EncabezadoPagina
        titulo="Cuánto cuesta Vigía"
        bajada="Lo que cuesta mantenerla cada mes, de dónde sale cada cifra y en qué se usa lo que aportas."
        acciones={
          <EnlaceAccion href="/app/apoyar" flecha prefetch={false}>
            Aportar
          </EnlaceAccion>
        }
      />
      {!v ? (
        <EstadoVacio variante="compacta" tono="error">No pudimos leer los costos ahora. Vuelve a intentarlo en un momento.</EstadoVacio>
      ) : (
        <div className="space-y-8">
          <MetaDelMes v={v} conEnlace={false} />
          <Costos v={v} />
          <LecturaIA v={v} />
          <MesAMes v={v} />
          <Seccion titulo="Lo que no está en estas cifras">
            <ul className="space-y-2 text-dato leading-relaxed text-inkSoft">
              <li className="flex gap-2">
                <Info size={16} aria-hidden className="mt-1 shrink-0 text-inkSoft" />
                Hoy AWS lo cubren créditos promocionales: las cifras de AWS son lo que costará cuando se acaben, no lo que se paga hoy.
              </li>
              <li className="flex gap-2">
                <Info size={16} aria-hidden className="mt-1 shrink-0 text-inkSoft" />
                La base de datos incluye una copia de pruebas, donde se revisa cada cambio antes de publicarlo.
              </li>
              <li className="flex gap-2">
                <Info size={16} aria-hidden className="mt-1 shrink-0 text-inkSoft" />
                No están el trabajo de quienes mantienen Vigía ni la IA de otras tareas (leer declaraciones juradas), que todavía no medimos.
              </li>
            </ul>
          </Seccion>
          <FuenteDato
            fuente={`Factura de AWS (Cost Explorer), tarifa de Cloudflare, costo medido en cada lectura y ${v.tipoCambio.fuente}`}
          />
        </div>
      )}
    </Pagina>
  );
}

/**
 * La nota de un rubro sin la frase de los créditos de AWS, que costos_mes.py pone en cada rubro de AWS: ya la dice, con
 * más detalle, «Lo que no está en estas cifras». Queda lo demás (cómo se facturó o se proyectó el mes). Se parte por
 * oraciones (punto, espacio y mayúscula): un monto como «US$ 0.01» no se corta.
 */
function sinCreditos(nota: string | null): string | null {
  if (!nota) return null;
  const resto = nota
    .split(/(?<=\.)\s+(?=\p{Lu})/u)
    .filter((frase) => !/créditos promocionales/i.test(frase))
    .join(" ")
    .trim();
  return resto || null;
}

/** Cuánto pesa un rubro en el total: «60 %»; uno chico, «<1 %» (un «0 %» diría que no cuesta nada). */
const parteDelTotal = (p: number) => (p > 0 && p < 0.01 ? "<1 %" : porcentaje(p * 100));

/**
 * Las columnas de lo que cuesta cada rubro. Se miden por el ancho de la TABLA (`medida="contenedor"`): con la barra
 * lateral, una pantalla `md` deja una tabla de ~460 px. En el celular quedan el rubro y lo que cuesta al mes (lo que no se
 * puede perder); el proveedor y de dónde sale van bajo el rubro hasta que su columna entra, y cuánto pesa cada rubro en
 * el total aparece cuando hay lugar para la barra.
 */
const COLUMNAS_COSTOS: Columna[] = [
  { clave: "rubro", titulo: "Rubro", ancho: "minmax(0,1.2fr)" },
  { clave: "proveedor", titulo: "Proveedor", ancho: "88px", desde: "md", apilar: true },
  { clave: "fuente", titulo: "De dónde sale", ancho: "minmax(0,1fr)", desde: "xl", apilar: true },
  { clave: "parte", titulo: "Del total", ancho: "136px", desde: "lg" },
  { clave: "monto", titulo: "Al mes", ancho: "108px", alinear: "der" },
];

function Costos({ v }: { v: ResumenVigilancia }) {
  const costos = v.costos;
  if (!costos || !v.mesCostos) {
    return (
      <Seccion titulo="Lo que cuesta cada mes">
        <Nota>Todavía no cargamos los costos de este mes.</Nota>
      </Seccion>
    );
  }
  const tc = v.tipoCambio.penPorUsd;
  const parcial = costos.rubros.some((r) => r.parcial);
  const proyeccion = costos.rubros.every((r) => r.fuente === "estimado");
  const al = costos.rubros.find((r) => r.al)?.al ?? null;
  const notaDe = (r: RubroCosto) => sinCreditos(r.nota);
  const notas = costos.rubros.map(notaDe).filter((n): n is string => !!n);
  // La nota de la factura (la misma en todos los rubros de AWS) va una vez, bajo la tabla.
  const comun = notas.find((n) => notas.filter((m) => m === n).length > 1) ?? null;

  const filas: Fila[] = costos.rubros.map((r) => {
    const nota = notaDe(r);
    const parte = costos.totalUsd > 0 ? r.montoUsd / costos.totalUsd : 0;
    return {
      id: r.rubro,
      celdas: {
        rubro: <CeldaPrincipal titulo={r.titulo} meta={r.detalle ?? undefined} metaEnVarias />,
        proveedor: <CeldaTexto>{r.proveedor}</CeldaTexto>,
        fuente: (
          <span className="block min-w-0">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-rotulo font-semibold",
                r.fuente === "factura" ? "bg-moss/10 text-mossTexto" : "bg-paperDeep text-inkSoft",
              )}
            >
              {r.fuente === "factura" ? <Receipt size={12} aria-hidden /> : <CalendarClock size={12} aria-hidden />}
              {r.fuente === "factura" ? "Factura" : "Estimado"}
            </span>
            {nota && nota !== comun && <span className="mt-1 block text-rotulo leading-snug text-mute">{nota}</span>}
          </span>
        ),
        parte: (
          <span className="flex w-full min-w-0 items-center gap-2">
            <CeldaBarra parte={parte} resumen={`${parteDelTotal(parte)} del total del mes`} className="min-w-0 flex-1" />
            <span aria-hidden className="w-10 shrink-0 text-right font-mono text-rotulo tabular-nums text-mute">
              {parteDelTotal(parte)}
            </span>
          </span>
        ),
        monto: <CeldaNumero sub={soles(Math.round(r.montoUsd * tc))}>{dolares(r.montoUsd)}</CeldaNumero>,
      },
    };
  });

  return (
    <Seccion
      titulo={`Lo que cuesta ${nombreMes(v.mesCostos)}`}
      descripcion={
        proyeccion
          ? "Proyección con el ritmo de los últimos días, hasta que llegue la factura del mes."
          : parcial
            ? `Facturado hasta el ${al ? fechaCorta(al) : "último día"} y proyectado al mes entero.`
            : "El mes cerrado, según la factura."
      }
    >
      {/* La tabla y su total en una tarjeta: el total es el pie de la cuenta, no otra caja. Dentro de `.tarjeta` la Tabla
          deja su marco; sin su filete de arriba, la cabecera de columnas es el borde de la tarjeta. */}
      <div className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
        <Tabla
          columnas={COLUMNAS_COSTOS}
          filas={filas}
          etiqueta={`Lo que cuesta ${nombreMes(v.mesCostos)}, rubro por rubro`}
          medida="contenedor"
          className="border-t-0"
        />
        <div className="flex items-start justify-between gap-4 border-t border-line bg-paperSoft px-4 py-3">
          <div className="min-w-0">
            <p className="text-dato font-semibold text-ink">Total del mes</p>
            <p className="text-rotulo text-mute">
              {v.tipoCambio.referencial ? "Tipo de cambio referencial" : `A ${v.tipoCambio.penPorUsd.toFixed(3)} soles por dólar (BCRP)`}
            </p>
          </div>
          <p className="shrink-0 text-right">
            <span className="block font-mono text-dato font-semibold tabular-nums text-ink">{dolares(costos.totalUsd)}</span>
            <span className="block font-mono text-meta tabular-nums text-inkSoft">{soles(costos.totalPen)}</span>
          </p>
        </div>
      </div>
      {comun && (
        <Nota icono={proyeccion ? <CalendarClock size={15} aria-hidden /> : <Receipt size={15} aria-hidden />} className="mt-3">
          {comun}
        </Nota>
      )}
      {/* Por qué la meta no es este total: estas facturas son sólo AWS y Cloudflare; mantener Vigía cuesta más, según el
          equipo (backend/api/src/lib/vigilancia.ts, MANTENERLA_EQUIPO_PEN). */}
      {v.meta.equipoPen != null && v.meta.medidoPen != null && v.meta.equipoPen > v.meta.medidoPen && (
        <Nota icono={<Calculator size={15} aria-hidden />} className="mt-3">
          Estas son sólo las facturas de AWS (hoy cubierto por créditos) y Cloudflare. Con lo que no aparece en ellas, mantener
          Vigía cuesta cerca de {soles(v.meta.equipoPen)} al mes, según el equipo: esa es la meta para seguir encendidos.
        </Nota>
      )}
    </Seccion>
  );
}

/**
 * La lectura a fondo, como la cuenta que es: lo que cuesta leer un contrato por los contratos con banderas graves de un
 * mes. Antes eran cuatro tarjetas iguales (costo, lecturas del mes, graves y total) que escondían la multiplicación; ahora
 * son renglones con la línea de puntos del comprobante de /app/apoyar. «≈» y no «=»: el costo de una lectura es un
 * promedio (y se muestra redondeado) y los graves, el de tres meses. Lo de este mes va aparte, en la línea de arriba.
 */
function LecturaIA({ v }: { v: ResumenVigilancia }) {
  const tc = v.tipoCambio.penPorUsd;
  const { costoMedioUsd, lecturasMes, costoMesUsd, lecturasTotal, desde } = v.ia;
  const total = v.graves.costoLeerlosUsd;
  return (
    <Seccion
      titulo="La lectura a fondo con IA"
      descripcion="Leer el expediente de un contrato contra la norma, los precios de mercado y sus antecedentes. Se mide en cada lectura."
    >
      <div className="max-w-xl space-y-3">
        <figure className="rounded-2xl border border-line bg-paper">
          <figcaption className="border-b border-dashed border-line px-4 pb-3 pt-4">
            <span className="block font-display text-bloque font-bold text-ink">Leer a fondo lo más grave</span>
            <span className="block text-meta text-mute">
              Este mes: {plural(lecturasMes, "lectura", "lecturas")}, {dolares(costoMesUsd)}
            </span>
          </figcaption>
          <dl className="text-meta">
            <Renglon
              className="px-4 pt-3.5"
              texto="Leer un contrato con IA"
              valor={costoMedioUsd != null ? dolares(costoMedioUsd) : null}
              origen={
                costoMedioUsd != null
                  ? `${soles(costoMedioUsd * tc)}: el promedio de ${plural(lecturasTotal, "lectura", "lecturas")}${desde ? ` desde el ${fechaCorta(desde)}` : ""}`
                  : undefined
              }
            />
            <Renglon
              className="px-4 pt-3"
              signo="×"
              leer="por"
              texto="contratos con banderas graves al mes"
              valor={`~${numero(v.graves.porMes)}`}
              origen="El promedio de los tres últimos meses"
            />
            <Renglon
              className="mt-3.5 border-t border-dashed border-line px-4 pb-4 pt-3 text-dato"
              signo="≈"
              leer="da aproximadamente"
              texto="al mes"
              total
              valor={
                total != null ? (
                  <>
                    {dolares(total)} <span className="font-normal text-inkSoft">({soles(Math.round(total * tc))})</span>
                  </>
                ) : null
              }
            />
          </dl>
        </figure>
        <Nota icono={<CircleDollarSign size={15} aria-hidden />}>
          Por eso ya no pedimos «S/ 3 por contrato»: la lectura cuesta menos, y lo que sostiene a Vigía es lo de arriba, que se paga
          igual lea uno o mil.
        </Nota>
      </div>
    </Seccion>
  );
}

/**
 * Un renglón de la cuenta: el signo en su propia columna (los textos quedan alineados), qué es, la línea de puntos y el
 * valor; debajo, de dónde sale. Rejilla y no flex: un texto largo se parte en dos líneas en vez de empujar la cifra al
 * renglón de abajo (a 390 px «contratos con banderas graves al mes» no entra entero). `leer` es el signo dicho en
 * palabras, para el lector de pantalla.
 */
function Renglon({
  signo,
  leer,
  texto,
  valor,
  origen,
  total = false,
  className,
}: {
  signo?: string;
  leer?: string;
  texto: string;
  /** `null`: sin dato (se dice, no se inventa un 0). */
  valor: ReactNode | null;
  origen?: string;
  /** El resultado: en negrita y el valor en granate. */
  total?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[minmax(0,max-content)_minmax(1rem,1fr)_max-content] items-end gap-x-2", className)}>
      <dt className={cn("flex min-w-0 gap-1.5", total ? "font-semibold text-ink" : "text-inkSoft")}>
        <span aria-hidden className="w-3 shrink-0 text-center font-mono text-mute">
          {signo}
        </span>
        {leer && <span className="sr-only">{leer} </span>}
        <span className="min-w-0">{texto}</span>
      </dt>
      <span aria-hidden className="mb-1 border-b border-dotted border-line" />
      <dd className={cn("font-mono font-semibold tabular-nums", total ? "text-granate" : "text-ink")}>
        {valor ?? <span className="font-sans font-normal text-mute">Sin dato</span>}
      </dd>
      {origen && <dd className="col-span-3 mt-0.5 pl-[1.125rem] text-rotulo leading-snug text-mute">{origen}</dd>}
    </div>
  );
}

/**
 * Mes a mes, con la `Tabla` de todo listado (medida por su propio ancho, como la de los rubros). En el celular: el mes, la
 * infraestructura y lo recaudado; la IA va bajo el mes, con su rótulo, hasta que su columna entra.
 */
const COLUMNAS_MESES: Columna[] = [
  { clave: "mes", titulo: "Mes", ancho: "minmax(0,1fr)" },
  { clave: "infra", titulo: "Infraestructura", ancho: "112px", alinear: "der" },
  { clave: "ia", titulo: "IA (lecturas)", ancho: "112px", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "IA" },
  { clave: "recaudado", titulo: "Recaudado", ancho: "84px", alinear: "der" },
];

function MesAMes({ v }: { v: ResumenVigilancia }) {
  if (!v.historial.length) return null;
  const tc = v.tipoCambio.penPorUsd;
  const filas: Fila[] = [...v.historial].reverse().map((m) => ({
    id: m.mes,
    celdas: {
      mes: <CeldaPrincipal titulo={mesConMayuscula(m.mes)} />,
      // Sin factura cargada, la Tabla dice «Sin dato»: nunca un 0.
      infra: m.costoUsd != null ? <CeldaNumero sub={soles(Math.round(m.costoUsd * tc))}>{dolares(m.costoUsd)}</CeldaNumero> : null,
      ia: <CeldaNumero sub={plural(m.lecturas, "lectura", "lecturas")}>{dolares(m.iaUsd)}</CeldaNumero>,
      recaudado: <CeldaNumero>{soles(m.recaudadoPen)}</CeldaNumero>,
    },
  }));
  return (
    <Seccion titulo="Mes a mes" descripcion="Desde que Vigía corre en AWS (octubre de 2026).">
      <Tabla columnas={COLUMNAS_MESES} filas={filas} etiqueta="Lo que costó y lo que se recaudó, mes a mes" medida="contenedor" />
    </Seccion>
  );
}
