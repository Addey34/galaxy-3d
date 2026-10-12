# L'ingestion GFS du service de données de Galaxy (lot 46). Image ARM64 et AMD64 : eccodes
# publie ses roues pour les deux (`eccodeslib`), mesuré sur la VM le 2026-10-12.
FROM python:3.12-slim
RUN pip install --no-cache-dir eccodes==2.* eccodeslib numpy \
 && python -c "import eccodes; print(eccodes.codes_get_api_version())"
WORKDIR /app
COPY ingest.py .
RUN python ingest.py --self-test
CMD ["python", "ingest.py", "--loop"]
