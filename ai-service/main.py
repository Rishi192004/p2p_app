import uvicorn
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from .summarizer import Summarizer
from .config import API_HOST, API_PORT

app = FastAPI(
    title="P2P Gossip Mesh Local AI Summarization Service",
    description="Python microservice communicating with Ollama to summarize chat histories.",
    version="1.0.0"
)

# Instantiate our summarizer core
summarizer = Summarizer()

class MessageSchema(BaseModel):
    id: Optional[str] = None
    sender: str
    topic: Optional[str] = None
    payload: str
    createdAt: Optional[str] = None

class SummarizeRequest(BaseModel):
    topic: str
    mode: str = Field(default="summary", description="Mode: 'summary' (3-4 sentences) or 'keypoints' (bullets)")
    messages: List[MessageSchema]

class SummarizeResponse(BaseModel):
    topic: str
    mode: str
    summary: str

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok", "model": summarizer.model, "ollama_host": summarizer.ollama_host}

@app.post("/summarize", response_model=SummarizeResponse, status_code=status.HTTP_200_OK)
async def summarize_endpoint(request: SummarizeRequest):
    """Summarizes a list of messages for a given topic."""
    if not request.messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message list cannot be empty."
        )
    
    if request.mode not in ("summary", "keypoints"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mode must be either 'summary' or 'keypoints'."
        )

    try:
        # Convert Pydantic schemas to standard dictionaries for the summarizer
        msg_dicts = [m.model_dump() for m in request.messages]
        summary_text = await summarizer.summarize(
            topic=request.topic,
            mode=request.mode,
            messages=msg_dicts
        )
        return SummarizeResponse(
            topic=request.topic,
            mode=request.mode,
            summary=summary_text
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc)
        )

if __name__ == "__main__":
    uvicorn.run("ai-service.main:app", host=API_HOST, port=API_PORT, reload=False)
