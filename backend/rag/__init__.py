"""RAG normativo de Vigía Perú (Frente R, plan 2026-09-16 §3).

Ingesta de normas, criterios vinculantes y documentos de control a Vertex AI RAG Engine (modo
serverless) y utilidades de consulta/evaluación. Ver docs/design/RAG_NORMATIVO.md.

Módulos: _comun (config), descargar, segmentar, opiniones, corpus, recuperar, consultar, evaluar.
Requiere el entorno de backend/rag/requirements.txt (no es parte de la imagen de los agentes).
"""
