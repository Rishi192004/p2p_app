FROM python:3.10-slim

WORKDIR /app

# Install system dependencies if any
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt /app/ai-service/requirements.txt
RUN pip install --no-cache-dir -r /app/ai-service/requirements.txt

# Copy the rest of the application
COPY . /app/ai-service

# Expose port
EXPOSE 8001

# Set python path and command
ENV PYTHONPATH=/app
CMD ["python", "-m", "ai-service.main"]
