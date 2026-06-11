import { Database, Users, GitMerge } from "lucide-react";

export function HowItWorks() {
  const steps = [
    {
      icon: <Database size={22} />,
      title: "Las máquinas leen lo que nadie lee",
      body: "Cada noche jalamos millones de filas de OECE, MEF, SUNAT, INFOBRAS, ONPE y JNE. Aplicamos 8 reglas duras del modelo Funes. Empresas creadas dos semanas antes de la licitación, únicos postores al 99%, aportantes que se vuelven ganadores — todo sale en el mapa como pin amarillo.",
      pin: "bg-amber",
    },
    {
      icon: <Users size={22} />,
      title: "Los ciudadanos aportan lo que ven",
      body: "Una foto, una geolocalización, una descripción. La obra que lleva un año parada, el colegio inaugurado pero vacío, el funcionario con la camioneta nueva. Cosas que ningún dataset captura — pero que la vecina vio. Pin rojo en el mapa.",
      pin: "bg-crimson",
    },
    {
      icon: <GitMerge size={22} />,
      title: "Cuando coinciden, la verdad pesa",
      body: "Una alerta automática + un reporte ciudadano sobre el mismo punto = caso convergente. Pin negro. Dossier completo armado: red de socios, banderas con artículos de ley citados, hallazgos en prensa, línea de tiempo. Listo para fiscal, periodista o Contraloría.",
      pin: "bg-coal",
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-3">
      {steps.map((s, i) => (
        <div key={i} className="surface p-6">
          <div className="flex items-center gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.pin} text-white`}>
              {s.icon}
            </span>
            <span className="font-mono text-xs uppercase tracking-wider text-ash">
              Paso {i + 1}
            </span>
          </div>
          <h3 className="mt-4 font-serif text-lg font-bold text-ink">{s.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ash">{s.body}</p>
        </div>
      ))}
    </section>
  );
}
