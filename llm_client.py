"""
llm_client.py — AWS Bedrock LLM wrapper
Exposes a simple .generate(prompt) interface used by all routers.
"""

import os
import requests

REGION        = os.environ.get("BEDROCK_REGION", "ap-south-1")
MODEL         = os.environ.get("BEDROCK_MODEL", "anthropic.claude-3-5-sonnet-20241022-v2:0")
API_URL       = f"https://bedrock-runtime.{REGION}.amazonaws.com/model/{MODEL}/invoke"
BEDROCK_KEY   = os.environ.get("BEDROCK_API_KEY", "")

SYSTEM_PROMPT = """You are an expert DFMEA engineer specializing in automotive electronic
control unit (ECU) systems on heavy-duty trucks, following the AIAG-VDA DFMEA methodology.
Return only what is asked. No preamble, no markdown fences unless explicitly requested."""


class LLMClient:
    def __init__(self):
        self.url    = API_URL
        self.key    = BEDROCK_KEY
        self.system = SYSTEM_PROMPT

    def generate(self, prompt: str, max_tokens: int = 800) -> str:
        headers = {
            "Authorization": f"Bearer {self.key}",
            "Content-Type":  "application/json",
        }
        payload = {
            "anthropic_version": "bedrock-2023-05-31",
            "system":            self.system,
            "messages":          [{"role": "user", "content": prompt}],
            "max_tokens":        max_tokens,
            "temperature":       0.7,
        }
        resp = requests.post(self.url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        # Bedrock returns content array
        return data["content"][0]["text"].strip()


# Singleton — imported by routers
llm = LLMClient()
