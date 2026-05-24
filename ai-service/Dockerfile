# =============================================================================
# Multi-Stage Dockerfile — AI Summarization Microservice (Python 3.11)
# =============================================================================
# Stage 1: Builder — install dependencies into a virtualenv.
# Using a virtualenv makes it trivial to copy only the installed packages
# into the final image, without pip cache or build tools bloat.
# =============================================================================

FROM python:3.11-slim AS builder

WORKDIR /app

# Install build tools needed for some Python packages with C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create a virtualenv so we can copy it cleanly into the final stage
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy and install requirements (cached separately from source changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# =============================================================================
# Stage 2: Final runtime image — no build tools, just the app and venv.
# =============================================================================

FROM python:3.11-slim AS final

WORKDIR /app

# Copy the pre-built virtualenv from the builder stage
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application source code
COPY . /app/ai-service

# Create a non-root user for security
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser /app
USER appuser

# === Environment Defaults (overridden by docker-compose) ===
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV OLLAMA_HOST=http://ollama:11434
ENV DEFAULT_MODEL=llama3.2:1b
ENV API_HOST=0.0.0.0
ENV API_PORT=8001

EXPOSE 8001

# Health check using the FastAPI /health endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')" || exit 1

CMD ["python", "-m", "ai-service.main"]
