import httpx
from typing import List, Dict, Any
from .config import OLLAMA_HOST, DEFAULT_MODEL

class Summarizer:
    def __init__(self, ollama_host: str = OLLAMA_HOST, model: str = DEFAULT_MODEL):
        self.ollama_host = ollama_host.rstrip('/')
        self.model = model

    def _format_conversation(self, messages: List[Dict[str, Any]]) -> str:
        """Formats list of message objects into a single string for LLM input."""
        formatted_lines = []
        for msg in messages:
            sender = msg.get("sender", "unknown")
            payload = msg.get("payload", "")
            formatted_lines.append(f"[{sender}]: {payload}")
        return "\n".join(formatted_lines)

    async def summarize(self, topic: str, mode: str, messages: List[Dict[str, Any]]) -> str:
        """Sends chat messages to Ollama model for summarization."""
        conversation_history = self._format_conversation(messages)
        
        if not conversation_history.strip():
            return "No conversation history available to summarize."

        if mode == "keypoints":
            system_prompt = (
                f"You are a helpful assistant. Extract the main key points and action items "
                f"from the following chat conversation on topic '{topic}'. "
                f"Format the output clearly as bullet points, followed by a list of action items. "
                f"Be direct, precise, and concise. Do not write introductory or concluding statements."
            )
        else:  # default to "summary"
            system_prompt = (
                f"You are a helpful assistant. Summarize the following chat conversation "
                f"on topic '{topic}' in exactly 3 to 4 concise sentences. "
                f"Be direct and precise. Do not write introductory or concluding statements."
            )

        prompt = f"{system_prompt}\n\nChat Conversation:\n{conversation_history}\n\nAssistant Response:"

        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{self.ollama_host}/api/generate"
            payload = {
                "model": self.model,
                "prompt": prompt,
                "stream": False
            }
            
            try:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                result = response.json()
                summary_text = result.get("response", "").strip()
                if not summary_text:
                    raise ValueError("Empty response received from Ollama model.")
                return summary_text
            except httpx.HTTPError as exc:
                raise RuntimeError(f"Ollama API request failed: {exc}")
