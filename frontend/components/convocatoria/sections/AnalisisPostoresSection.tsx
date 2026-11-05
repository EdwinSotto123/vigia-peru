"use client";

/**
 * «Contra quién compitió» el proveedor: cada postor en una fila con qué pasó con su oferta (ganó, quedó fuera y por qué,
 * se registró y no ofertó), cuánto ofertó y sus patrones de competencia (coincidir con los mismos postores en otros
 * procesos, compartir domicilio). Une el acta leída, el registro OCDS y el análisis de patrones (`filasCompetencia`).
 * Debajo, los pares de postores que se repiten juntos, con los procesos a su ficha. Son patrones para investigar, no
 * una prueba de cartel, y así se dice.
 */

import Link from "next/link";
import { CircleSlash, MapPin, Repeat, Users } from "lucide-react";
import { AyudaTermino, Nota } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { porcentaje } from "@/lib/formato";
import { rutaContrato } from "@/lib/rutas";
import { cn } from "@/lib/utils";
import { PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import { montoDossier } from "../dossier";
import { filasCompetencia, normOcid, patronLegible, type EstadoPostor, type FilaPostor } from "./red/proveedor";

const COLUMNAS: Columna[] = [
  { clave: "postor", titulo: "Postor", ancho: "minmax(0,1.3fr)" },
  { clave: "estado", titulo: "Qué pasó con su oferta", ancho: "minmax(10rem,1fr)", desde: "md", apilar: true },
  { clave: "oferta", titulo: "Oferta", ancho: "9.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  {
    clave: "patrones", titulo: "Patrones", ancho: "minmax(0,1fr)", desde: "lg", apilar: true,
    igual: { vacia: "Ningún postor con patrones de competencia" },
  },
];

const CHIP: Record<EstadoPostor, string> = {
  "Ganó": "border-granate/30 bg-granate-50 font-semibold text-granate",
  "Oferta válida": "border-line bg-paperDeep text-ink",
  "Quedó fuera": "border-line bg-paperDeep text-ink",
  "Descalificado": "border-line bg-paperDeep text-ink",
  "No admitido": "border-line bg-paperDeep text-ink",
  "Se registró": "border-line bg-paperSoft text-mute",
  "Participó": "border-line bg-paperSoft text-mute",
};
const QUEDO_FUERA = new Set<EstadoPostor>(["Quedó fuera", "Descalificado", "No admitido"]);

function NombrePostor({ f }: { f: FilaPostor }) {
  return esPersonaNatural(f.ruc) ? <PersonName name={f.nombre} orden="sunat" /> : <>{f.nombre}</>;
}

export function AnalisisPostoresSection({
  data,
  ocidActual,
  filas: filasDadas,
  conActa = false,
  valorReferencial = null,
}: {
  data: any;
  ocidActual?: string | null;
  /** Las filas ya unidas (acta + OCDS + patrones). Sin ellas, sólo las del análisis de patrones (`data`). */
  filas?: FilaPostor[];
  conActa?: boolean;
  valorReferencial?: number | null;
}) {
  const filas = filasDadas ?? filasCompetencia({ analisis_postores: data }, ocidActual).filas;
  const patrones = data?.patrones_red && typeof data.patrones_red === "object" ? data.patrones_red : {};
  const actual = ocidActual ? normOcid(ocidActual) : null;

  if (!filas.length) return <p className="text-meta text-mute">No se identificaron postores en el OCDS ni en el acta.</p>;

  const ofertaron = filas.filter((f) => f.estado !== "Se registró" && f.estado !== "Participó").length;
  const fuera = filas.filter((f) => QUEDO_FUERA.has(f.estado)).length;
  const coinciden = filas.filter((f) => f.coOcurrencias.length > 0 || f.sospechas.some((s) => s.startsWith("co_ocurrencia"))).length;
  const domicilio = filas.filter((f) => f.sospechas.includes("direccion_compartida_con_otro_postor")).length || Number(patrones.n_con_direccion_compartida || 0);

  // Los pares que aparecen juntos en otros procesos (sin el que se está leyendo), con sus nombres.
  const porRuc = new Map(filas.filter((f) => f.ruc).map((f) => [String(f.ruc), f]));
  const pares = Object.entries(patrones.pares_co_ocurrentes || {})
    .map(([par, ocids]: [string, any]) => {
      const lista = Array.isArray(ocids) ? Array.from(new Set(ocids.map(normOcid).filter((o: string) => o && o !== actual))) : [];
      return { par, lista: lista as string[], n: Array.isArray(ocids) ? lista.length : Number(ocids) || 0 };
    })
    .filter((x) => x.n > 0);
  const nombreDe = (ruc: string) => {
    const f = porRuc.get(ruc.trim());
    if (!f) return <span className="font-mono">RUC <Ruc value={ruc.trim()} /></span>;
    return <NombrePostor f={f} />;
  };

  const tabla: Fila[] = filas.map((f, i) => {
    const ruc20 = !!f.ruc && /^20\d{9}$/.test(f.ruc);
    const monto = f.oferta ?? f.adjudicado;
    const pctVr = f.oferta != null && valorReferencial ? (f.oferta / valorReferencial) * 100 : null;
    const sub = [f.puntaje != null ? `${f.puntaje} puntos` : null, pctVr != null ? `${porcentaje(pctVr)} del referencial` : null].filter(Boolean).join(", ");
    const sospechas = f.sospechas.map(patronLegible);
    return {
      // Un índice y no la clave: la clave lleva el RUC, y el de una persona natural (en el panel admin) no va al DOM.
      id: `p-${i}`,
      resaltada: f.gano,
      // A su ficha de empresa (sólo RUC 20: el de una persona natural lleva su DNI).
      href: ruc20 ? `/empresa/${f.ruc}` : undefined,
      celdas: {
        postor: (
          <CeldaPrincipal
            titulo={<NombrePostor f={f} />}
            textoCompleto={esPersonaNatural(f.ruc) ? undefined : f.nombre}
            dosLineas
            meta={[
              f.ruc && (
                <Dato key="ruc" tipo="ruc" mono>
                  <Ruc value={f.ruc} />
                </Dato>
              ),
              f.consorcio && <Dato key="cons" tipo="personas">Consorcio</Dato>,
              f.direccion && <Dato key="dir" tipo="lugar">{f.direccion}</Dato>,
            ]}
          />
        ),
        estado: (
          <span className="block min-w-0">
            <span className={cn("pill max-w-full", CHIP[f.estado])}>
              <span className="truncate">{f.estado}</span>
            </span>
            {f.motivo && <span className="mt-1 line-clamp-2 block text-meta leading-snug text-inkSoft" title={f.motivo}>{redactDnis(f.motivo)}</span>}
          </span>
        ),
        oferta: <CeldaNumero sub={sub || (f.oferta == null && f.adjudicado != null ? "adjudicado" : undefined)}>{monto != null ? montoDossier(monto) : "Sin dato"}</CeldaNumero>,
        patrones: sospechas.length ? (
          <span className="flex min-w-0 flex-wrap gap-1">
            {sospechas.map((s, j) => (
              <span key={j} className="pill max-w-full border-line bg-paperDeep text-ink">
                <span className="truncate">{s}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-meta text-mute">Sin patrones</span>
        ),
      },
      textos: { patrones: sospechas.length ? sospechas.join(", ") : null, oferta: monto != null ? montoDossier(monto) : null },
      buscable: esPersonaNatural(f.ruc) ? undefined : [f.nombre, f.ruc].filter(Boolean).join(" "),
    };
  });

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-meta text-inkSoft">
        <Dato icono={Users} nombre="Postores">
          {conActa ? `${ofertaron} ${ofertaron === 1 ? "ofertó" : "ofertaron"}` : `${filas.length} ${filas.length === 1 ? "postor" : "postores"}`}
          {conActa && filas.length > ofertaron ? `, ${filas.length - ofertaron} sólo ${filas.length - ofertaron === 1 ? "se registró" : "se registraron"}` : ""}
        </Dato>
        <AyudaTermino clave="postor" />
        {conActa && (
          <Dato icono={CircleSlash} nombre="Quedaron fuera">
            {fuera === 0 ? "ninguno quedó fuera" : `${fuera} ${fuera === 1 ? "quedó fuera" : "quedaron fuera"}`}
          </Dato>
        )}
        {coinciden > 0 && (
          <Dato icono={Repeat} nombre="Coinciden en otros procesos">
            {coinciden} {coinciden === 1 ? "coincide" : "coinciden"} con estos mismos postores en otros procesos
          </Dato>
        )}
        {domicilio > 0 && (
          <Dato icono={MapPin} nombre="Comparten domicilio">
            {domicilio} {domicilio === 1 ? "comparte" : "comparten"} domicilio
          </Dato>
        )}
      </p>

      <TablaPaginada
        columnas={COLUMNAS}
        filas={tabla}
        etiqueta="Los postores de este proceso y qué pasó con cada oferta"
        nombre="postores"
        tam={10}
        controles="abajo"
        medida="contenedor"
        colapsarIguales
        buscar={{ placeholder: "Buscar un postor por razón social o RUC…", etiqueta: "Buscar en los postores" }}
      />

      {pares.length > 0 && (
        <div className="rounded-2xl border border-line bg-paper px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-cuerpo font-semibold text-ink">
            <Repeat size={15} className="text-mute" aria-hidden />
            Postores que se repiten juntos
          </h3>
          <p className="mt-0.5 text-meta text-inkSoft">
            En otros procesos ya leídos por Vigía (no en todo el SEACE). Cada código lleva a su ficha.
          </p>
          <ul className="mt-2 divide-y divide-line">
            {pares.map(({ par, lista, n }, i) => {
              const [a, b] = par.split("↔");
              return (
                <li key={i} className="py-2 text-meta leading-snug">
                  <span className="font-semibold text-ink">{nombreDe(a ?? par)}</span>
                  {b && (
                    <>
                      {" "}y <span className="font-semibold text-ink">{nombreDe(b)}</span>
                    </>
                  )}
                  <span className="text-inkSoft">: {n} {n === 1 ? "proceso compartido" : "procesos compartidos"}</span>
                  {lista.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {lista.slice(0, 8).map((oc) => (
                        <Link key={oc} href={rutaContrato(oc)} prefetch={false} className="pill border-line bg-paperDeep font-mono tabular-nums text-granate hover:border-paperEdge">
                          {oc}
                        </Link>
                      ))}
                      {lista.length > 8 && <span className="self-center text-rotulo text-mute">+{lista.length - 8} más</span>}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Nota>
        Son patrones de competencia para investigar, no una prueba de cartel: coincidir en otros procesos o compartir domicilio
        puede tener explicaciones legítimas.
      </Nota>
    </div>
  );
}
