"""Lógica de dominio compartida entre ingesta (scrapers/batch), dispatcher y orquestador.

Sin dependencias de red ni de Google: solo Python estándar, para poder importarse
desde cualquier proceso (laptop, Cloud Run Job, tests).
"""
