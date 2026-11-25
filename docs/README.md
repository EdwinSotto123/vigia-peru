# Documentación de Vigía

Qué hay en esta carpeta y qué está al día (revisado el 25 de noviembre de 2026). Para empezar: el
[README](../README.md), [ARQUITECTURA.md](../ARQUITECTURA.md) y [CONTRIBUTING.md](../CONTRIBUTING.md).

## Vigente

### Cómo está hecho

- [ARQUITECTURA.md](../ARQUITECTURA.md): qué hace cada pieza, dónde corre, cómo fluye un contrato y cómo se despliega.
- [OBSERVABILITY.md](../OBSERVABILITY.md): registros, cola en vivo, libros de costo, pruebas de calidad y la página `/metricas`.
- [DEV.md](DEV.md): el entorno DEV, con su propia base y sus propios Workers.
- [PROVEEDORES.md](PROVEEDORES.md): dónde corre cada componente y cómo volver a Google Cloud por componente.
- [design/RAG_NORMATIVO_V2.md](design/RAG_NORMATIVO_V2.md): el buscador de normas por fecha y jerarquía, en la propia base.
- [MAPA_INTERACTIVO.md](MAPA_INTERACTIVO.md): cómo está dibujado el mapa del Perú con d3-geo (guía de septiembre de 2026).

### Datos y señales

- [DATA.md](DATA.md): de dónde sale cada dato, con qué se carga y dónde queda.
- [DATOS_Y_SENALES.md](DATOS_Y_SENALES.md): el inventario de datos, banderas y cruces.
- [DATASET_MAP.md](DATASET_MAP.md): las tablas de los datos abiertos del OECE, una por una.
- [DOCUMENTOS_SEACE.md](DOCUMENTOS_SEACE.md): qué documentos publica el SEACE por proceso y qué trae cada uno.
- [EMPRESAS.md](EMPRESAS.md): la ficha de cada empresa que ganó, postuló o recibió órdenes del Estado.
- [PERSONAS.md](PERSONAS.md): personas contratadas, planillas y plazas CAS.
- [CORRUPCION.md](CORRUPCION.md): lo que la Contraloría y la Procuraduría ya investigaron o juzgaron.
- [PRIVACIDAD.md](PRIVACIDAD.md): qué datos personales salen al público y cuáles no.
- [MARCO_NORMATIVO.md](MARCO_NORMATIVO.md): el marco legal de las contrataciones públicas (al 14 de junio de 2026).

### Productos de Gobserva

- [SALUD.md](SALUD.md) y [salud/datos.md](salud/datos.md): Gobserva Salud y sus fuentes.
- [automatizacion_cas.md](automatizacion_cas.md) y [fuentes_bases_cas.md](fuentes_bases_cas.md): Gobserva Empleo, las bases CAS y de dónde salen.
- [PLAN.md](PLAN.md): el plan de la app de Gobserva Licitaciones.

### Proyecto y comunicación

- [business/vigia_proyecto.md](business/vigia_proyecto.md): el dossier del proyecto, con cifras fechadas.
- [campanas/](campanas/): textos y guiones para redes sociales.
- [img/](img/): las imágenes del README y de los documentos.

## Histórico

Registros fechados de versiones anteriores, casi todas en Google Cloud. No se reescriben: los que describen la
arquitectura vieja llevan una nota arriba que manda a lo vigente.

- [../SOLUCION.md](../SOLUCION.md): cómo funcionaba Vigía en el hackathon (junio de 2026).
- [../vigia_peru.md](../vigia_peru.md): Vigía contado en septiembre de 2026, con la lectura a S/ 3 por contrato.
- [../propuesta_flujo_trabajo.md](../propuesta_flujo_trabajo.md): la propuesta de ambientes y flujo de trabajo (23 de septiembre de 2026), con lo que se adoptó y lo que no.
- [hackathon/](hackathon/): el guion del video y la entrega al Google Cloud Rapid Agent Hackathon (junio de 2026).
- [superpowers/plans/](superpowers/plans/): los planes de trabajo del 14 al 16 de septiembre de 2026.
- [design/](design/): diseños y auditorías de septiembre de 2026 (orquestador, perfiles de agentes, RAG en Google Cloud, scrapers, volumen del SEACE, cuentas, financiamiento), con sus capturas en `design/capturas/` y la revisión manual de 10 contratos en `design/revision_contratos/`. La excepción vigente es `RAG_NORMATIVO_V2.md`.
- [ab-modelos/](ab-modelos/): la prueba A/B de modelos del 12 de octubre de 2026.
- [propuesta-agentes-adk.md](propuesta-agentes-adk.md): la propuesta de agentes más resistentes (11 de octubre de 2026).
- [PLAN_VISUAL.md](PLAN_VISUAL.md): el plan de mejora visual del frontend (22 de octubre de 2026).
- [auditoria-visual/2026-10-18/](auditoria-visual/2026-10-18/): la auditoría visual del 18 de octubre de 2026.
- [auditoria-ui/](auditoria-ui/): las auditorías de densidad y de UX de la interfaz (octubre de 2026).
- [auditoria-producto/](auditoria-producto/): la auditoría de producto y la visual completa (12 y 13 de noviembre de 2026).
