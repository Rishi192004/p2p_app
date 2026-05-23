import os

# Ollama connection settings
# In docker-compose, this might be "http://ollama:11434"
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# Small fast models suitable for local deployment: llama3.2:1b, phi3:mini, gemma2:2b
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "llama3.2:1b")

# AI service API hosting settings
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8001"))
