# Le service de données de Galaxy (lot 46) : l'ingestion GFS et l'archive ERA5, une seule image.
# ARM64 et AMD64 : eccodes publie ses roues pour les deux (`eccodeslib`), numcodecs aussi,
# mesuré sur la VM le 2026-10-12.
FROM python:3.12-slim
RUN pip install --no-cache-dir eccodes==2.* eccodeslib numpy numcodecs \
 && python -c "import eccodes; print(eccodes.codes_get_api_version())"
WORKDIR /app
COPY ingest.py era5.py ./
RUN python ingest.py --self-test && python era5.py --self-test
CMD ["python", "ingest.py", "--loop"]
