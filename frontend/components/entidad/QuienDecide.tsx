import { Ayuda } from "@/components/patrones/Ayuda";
import { AyudaTermino } from "@/components/patrones/AyudaTermino";
import { DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { ListaPaginada } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { BloqueInicio } from "@/components/inicio/BloquesInicio";
import { paraBuscar } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import type { EstructuraEntidad } from "@/lib/api-client";

/**
 * «Quién aprueba sus contratos», del grafo del Estado (migración 126): la autoridad que por ley aprueba las
 * contrataciones de la entidad (la AGA, Ley 32069, art. 25.1.b) y los altos funcionarios que hoy ocupan sus cargos, con
 * cargo y nombre completo (son funcionarios públicos). Va en la columna lateral del Inicio.
 *
 * Antes era un grafo radial de 720 × 560 con la entidad al centro: 770 px de alto para dos nodos en Lima (la AGA y la
 * entidad), 520 px de ancho mínimo con scroll lateral en el celular y los nombres cortados a 24 letras. Todas sus
 * líneas iban de la entidad a una persona: no había relación que dibujar, sólo una lista. Ahora es la lista, en todos
 * los anchos; con más de 10 funcionarios, con buscador y paginada (la lista completa).
 */

const MAX_SIN_BUSCADOR = 10;

type Funcionario = NonNullable<EstructuraEntidad["funcionarios"]>[number];

function Persona({ f }: { f: Funcionario }) {
  return (
    <span className="block min-w-0">
      <span className="block text-dato font-semibold leading-snug text-ink">{tituloNatural(f.persona)}</span>
      <span className="mt-0.5 block text-meta leading-snug text-mute">
        <Dato tipo="cargo">{f.cargo}</Dato>
      </span>
    </span>
  );
}

function Lista({ lista }: { lista: Funcionario[] }) {
  if (lista.length > MAX_SIN_BUSCADOR) {
    return (
      <ListaPaginada
        nombre="funcionarios"
        tam={MAX_SIN_BUSCADOR}
        className="divide-y divide-line/70"
        buscar={{ placeholder: "Buscar un cargo o un nombre…", etiqueta: "Buscar entre los altos funcionarios" }}
        items={lista.map((f, i) => ({
          id: `${f.persona}-${f.cargo}-${i}`,
          buscable: `${f.persona} ${f.cargo} ${f.organo}`,
          contenido: (
            <span className="block py-2">
              <Persona f={f} />
            </span>
          ),
        }))}
      />
    );
  }
  return (
    <ul className="divide-y divide-line/70">
      {lista.map((f, i) => (
        <li key={`${f.persona}-${f.cargo}-${i}`} className="py-2 first:pt-0 last:pb-0">
          <Persona f={f} />
        </li>
      ))}
    </ul>
  );
}

export function QuienDecide({ estructura }: { estructura: EstructuraEntidad | null }) {
  if (!estructura?.disponible) return null;
  const aga = estructura.apruebaContratos ?? "Autoridad de la gestión administrativa";
  const todos = estructura.funcionarios ?? [];
  // Quien ocupa el órgano que aprueba (la Secretaría General de un ministerio, la Gerencia Municipal): primero y aparte.
  const esAga = (f: Funcionario) => paraBuscar(f.organo) === paraBuscar(aga);
  const ocupan = todos.filter(esAga);
  const resto = todos.filter((f) => !esAga(f));

  const items: DatoClave[] = [
    { etiqueta: "Los aprueba", valor: <span className="font-semibold">{aga}</span>, ayuda: <AyudaTermino clave="aga" /> },
    ...(ocupan.length ? [{ etiqueta: ocupan.length === 1 ? "La ocupa" : "La ocupan", valor: <Lista lista={ocupan} /> }] : []),
    ...(resto.length ? [{ etiqueta: "Altos funcionarios", valor: <Lista lista={resto} /> }] : []),
    ...(!todos.length ? [{ etiqueta: "Quién la ocupa", valor: <span className="text-mute">El organigrama oficial no lo trae</span> }] : []),
  ];

  return (
    <BloqueInicio
      titulo="Quién aprueba sus contratos"
      ayuda={
        <Ayuda titulo="¿De dónde sale?">
          <span className="block">
            Por ley, las contrataciones de una entidad las aprueba su autoridad de la gestión administrativa: la Gerencia
            Municipal en una municipalidad, la Gerencia General Regional en un gobierno regional y la Secretaría General
            en un ministerio.
          </span>
          <span className="mt-2 block">
            Los nombres salen del organigrama oficial (grafo del Estado, corte {estructura.corte ?? "2026"}): es un corte en
            el tiempo y puede no estar al día.
          </span>
        </Ayuda>
      }
    >
      <DatosClave items={items} />
    </BloqueInicio>
  );
}
