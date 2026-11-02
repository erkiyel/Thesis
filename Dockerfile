FROM php:8.3-cli-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ONCOPHIL_PYTHON=/opt/venv/bin/python

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        gosu \
        libcurl4-openssl-dev \
        libonig-dev \
        python3 \
        python3-pip \
        python3-venv \
    && docker-php-ext-install -j"$(nproc)" curl fileinfo mbstring \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --no-cache-dir --upgrade pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Backend/ /app/Backend/

RUN /opt/venv/bin/python -m pip install --no-cache-dir -r /app/Backend/python/requirements.txt \
    && mkdir -p /app/Backend/runtime \
    && chown -R www-data:www-data /app/Backend/runtime

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD php -r '$port = getenv("PORT") ?: "10000"; exit(@file_get_contents("http://127.0.0.1:" . $port . "/api/healthz") === false ? 1 : 0);'

CMD ["sh", "-c", "mkdir -p /app/Backend/runtime && chown www-data:www-data /app/Backend/runtime && exec gosu www-data php -d upload_max_filesize=12M -d post_max_size=14M -d max_execution_time=120 -S 0.0.0.0:${PORT:-10000} -t /app/Backend /app/Backend/index.php"]
