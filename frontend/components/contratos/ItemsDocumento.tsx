/**
 * Lo que se compró, renglón por renglón, según los documentos (pedido del usuario del 2026-11-17: «el ÍTEM es sólo 1 cuando
 * el documento de BASES lo desglosa por varios ítems»). El SEACE registra a veces un paquete como un solo ítem; las bases
 * traen cada producto con su cantidad y el contrato, su marca y su precio. Sale de las fichas leídas por pieza
 * (backend/lector: «bases» y «contrato»), con la comprobación sin modelo del contrato (cantidad × unitario = total).
 */
import { ListOrdered, Package, Tag } from "lucide-react";
import { Ayuda, DatosClave, EnUnaFrase, FuenteDato } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { enlacesProceso } from "@/lib/fuentes";
import { numero, plural, soles } from "@/lib/formato";
import type { ContratoDetalle as Detalle } from "@/lib/contratos";
import { CitaPagina } from "./CitaPagina";

/** «ACEITE DE MOTOR 15W40» → «Aceite de motor 15W40»: sin gritar, sin tocar códigos con números. */
function oracionCorta(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const bajo = s.toLowerCase().replace(/\b([a-z]*\d[a-z\d-]*)\b/g, (m) => m.toUpperCase());
  return bajo.charAt(0).toUpperCase() + bajo.slice(1);
}

export function DesgloseItems({ c }: { c: Detalle }) {
  const d = c.itemsDocumento!;
  const conPrecio = d.filas.some((f) => f.contratado?.precioUnitario != null);
  const columnas: Columna[] = [
    { clave: "item", titulo: "Renglón", ancho: "minmax(0,1fr)" },
    { clave: "cantidad", titulo: "Cantidad", ancho: "120px", alinear: "der", desde: "lg" },
    ...(conPrecio
      ? [
          { clave: "unitario", titulo: "Precio unitario", ancho: "128px", alinear: "der" } satisfies Columna,
          { clave: "total", titulo: "Total", ancho: "128px", alinear: "der", desde: "md" } satisfies Columna,
        ]
      : []),
    {
      clave: "fuente", titulo: "Fuente", ancho: "96px", desde: "md",
      ayuda: <Ayuda titulo="¿Qué abre la fuente?">La página del contrato con el precio y, si no, la de las bases con lo que se pedía.</Ayuda>,
    },
  ];
  const filas: Fila[] = d.filas.map((f, i) => {
    const k = f.contratado;
    const cantidad = (f.cantidad ?? k?.cantidad) != null ? `${numero((f.cantidad ?? k?.cantidad)!)}${(f.unidad ?? k?.unidad) ? ` ${(f.unidad ?? k?.unidad)!.toLowerCase()}` : ""}` : null;
    const cita = k?.cita ?? f.cita;
    // El nombre corto del producto: lo del contrato antes de los dos puntos («ACEITE DE MOTOR 15W40 : MOBIL DELVAC…»), o el
    // comienzo de lo que piden las bases. La especificación entera va en el panel.
    const corto = (k?.descripcion?.split(":")[0]?.trim() || f.descripcion?.split(",")[0]?.trim() || "Sin descripción");
    const producto = k?.descripcion?.includes(":") ? k.descripcion.split(":").slice(1).join(":").trim() : null;
    return {
      id: `renglon-${i}`,
      enlaces: true,
      etiqueta: "Ver el detalle de este renglón",
      detalle: {
        titulo: oracionCorta(corto),
        etiqueta: "Ver el detalle de este renglón",
        descripcion: <span className="line-clamp-2">{k?.marca ? `Marca ${k.marca}` : `Renglón ${f.numero}`}</span>,
        contenido: (
          <div className="space-y-5">
            <EnUnaFrase>
              {cantidad ? <>Se compraron <b>{cantidad}</b></> : "Se compró"}
              {k?.precioUnitario != null ? <> a <b>{soles(k.precioUnitario)}</b> cada uno</> : ""}
              {k?.precioTotal != null ? <>, <b>{soles(k.precioTotal)}</b> en total</> : ""}
              {k?.marca ? <> (marca {k.marca}{producto ? `, ${producto}` : ""})</> : ""}.
            </EnUnaFrase>
            <DatosClave
              items={[
                { etiqueta: "Renglón", valor: f.numero, mono: true },
                { etiqueta: "Cantidad", valor: cantidad },
                { etiqueta: "Precio unitario", valor: k?.precioUnitario != null ? soles(k.precioUnitario) : null, mono: true },
                { etiqueta: "Total", valor: k?.precioTotal != null ? soles(k.precioTotal) : null, mono: true },
                { etiqueta: "¿Cuadra?", valor: k?.cuadra == null ? null : k.cuadra ? "Sí: cantidad por precio unitario da el total" : "No: revisa el contrato" },
              ]}
            />
            {f.descripcion && (
              <section className="space-y-1.5">
                <h3 className="font-display text-bloque font-bold text-ink">Lo que pedían las bases</h3>
                <p className="text-dato leading-relaxed text-inkSoft">{f.descripcion}</p>
                {f.cita && <CitaPagina ocid={c.ocid} cita={f.cita} />}
              </section>
            )}
            {k?.descripcion && (
              <section className="space-y-1.5">
                <h3 className="font-display text-bloque font-bold text-ink">Lo que se firmó en el contrato</h3>
                <p className="text-dato leading-relaxed text-inkSoft">{k.descripcion}</p>
                {k.cita && <CitaPagina ocid={c.ocid} cita={k.cita} />}
              </section>
            )}
          </div>
        ),
      },
      celdas: {
        item: (
          <CeldaPrincipal
            dosLineas
            titulo={oracionCorta(corto)}
            meta={
              <Partes
                partes={[
                  <Dato key="n" icono={ListOrdered} nombre="Renglón">Renglón {f.numero}</Dato>,
                  k?.marca && <Dato key="m" icono={Tag} nombre="Marca ofertada">Marca {k.marca}</Dato>,
                  cantidad && <Dato key="c" icono={Package} nombre="Cantidad" className="lg:hidden">{cantidad}</Dato>,
                  k?.precioTotal != null && <span key="t" className="md:hidden">Total {soles(k.precioTotal)}</span>,
                ]}
              />
            }
          />
        ),
        cantidad: cantidad ? <CeldaNumero>{cantidad}</CeldaNumero> : undefined,
        unitario: k?.precioUnitario != null
          ? <CeldaNumero sub={k.cuadra === false ? "no cuadra con el total" : undefined}>{soles(k.precioUnitario)}</CeldaNumero>
          : undefined,
        total: k?.precioTotal != null ? <CeldaNumero>{soles(k.precioTotal)}</CeldaNumero> : undefined,
        fuente: cita ? <CitaPagina ocid={c.ocid} cita={cita} corto /> : <span className="text-rotulo text-mute">Sin cita</span>,
      },
      buscable: [f.descripcion, k?.descripcion, k?.marca, `renglon ${f.numero}`].filter(Boolean).join(" "),
    };
  });
  const ck = d.contrato;
  const comprobado = ck && ck.renglones ? `${numero(ck.renglonesQueCuadran ?? 0)} de ${plural(ck.renglones, "renglón cuadra", "renglones cuadran")} (cantidad por precio unitario = total)${ck.sumaCuadra ? " y la suma da el monto del contrato" : ck.sumaCuadra === false ? "; la suma no da el monto del contrato" : ""}` : null;
  return (
    <div className="space-y-2">
      <p className="text-dato leading-relaxed text-inkSoft">
        {d.bases && d.contrato
          ? `Las bases piden ${plural(d.filas.length, "renglón", "renglones")} y el contrato${ck?.numero ? ` ${ck.numero}` : ""} los trae con su marca y su precio.`
          : d.contrato
            ? `El contrato${ck?.numero ? ` ${ck.numero}` : ""} trae ${plural(d.filas.length, "renglón", "renglones")} con su marca y su precio.`
            : `Las bases piden ${plural(d.filas.length, "renglón", "renglones")}.`}
        {c.items.length < d.filas.length ? ` El registro del SEACE los junta en ${plural(c.items.length, "ítem", "ítems")}.` : ""}
        {comprobado ? ` Comprobado sin modelo: ${comprobado}.` : ""}
      </p>
      <TablaPaginada
        columnas={columnas}
        filas={filas}
        etiqueta="Renglones de lo que se compró según las bases y el contrato"
        nombre="renglones"
        tam={20}
        buscar={{ placeholder: "Buscar en los renglones por producto o marca…", etiqueta: "Buscar en los renglones" }}
      />
      <FuenteDato
        fuente={[d.bases && (d.bases.documento ?? "Bases"), d.contrato && (d.contrato.documento ?? "Contrato")].filter(Boolean).join(" y ") + " del SEACE, leídos por pieza"}
        enlaces={enlacesProceso(c.ocid, { codigo: c.codigo })}
      />
    </div>
  );
}
