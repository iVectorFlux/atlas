"""
Zawvee Backend — TTS Service
Real-time text-to-speech for the AI Whiteboard Tutor.
Uses Deepgram Aura-2 with automatic fallback to OpenAI TTS.
"""

import os
import re
import hashlib
import httpx
from pathlib import Path
from dotenv import load_dotenv
from typing import AsyncIterator, Optional

_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY")
CARTESIA_VOICE_ID = os.getenv("CARTESIA_VOICE_ID", "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4")
CARTESIA_MODEL = os.getenv("CARTESIA_MODEL", "sonic-3.5")
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
DEEPGRAM_TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-thalia-en")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# Preferred provider: "deepgram" (default, streaming), "cartesia", or "openai"
TTS_PROVIDER = (os.getenv("TTS_PROVIDER") or "deepgram").strip().lower()

# Simple in-memory cache for audio snippets (keyed by text hash)
_AUDIO_CACHE: dict[str, bytes] = {}
_MAX_CACHE_ITEMS = 200

# Shared keep-alive HTTP client (avoids a fresh TLS handshake on every sentence)
_HTTP_CLIENT: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _HTTP_CLIENT
    if _HTTP_CLIENT is None or _HTTP_CLIENT.is_closed:
        _HTTP_CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(12.0, connect=5.0),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
        )
    return _HTTP_CLIENT


def _cache_put(key: str, audio: bytes) -> None:
    if len(_AUDIO_CACHE) >= _MAX_CACHE_ITEMS:
        _AUDIO_CACHE.pop(next(iter(_AUDIO_CACHE)))
    _AUDIO_CACHE[key] = audio

def clean_text_for_speech(text: str) -> str:
    """Prepare text for natural speech synthesis by removing markdown and code blocks."""
    if not text:
        return ""
    
    # Strip any code blocks completely (including unclosed blocks)
    if "```" in text:
        text = text.split("```")[0]
    
    text = re.sub(r'```draw\s*\n.*?```', '', text, flags=re.DOTALL)
    text = re.sub(r'```canvas\s*\n.*?```', '', text, flags=re.DOTALL)
    text = re.sub(r'```highlight\s*\n.*?```', '', text, flags=re.DOTALL)
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
    text = re.sub(r'`.*?`', '', text)
    
    # Strip anchor / XML tags, keeping inner spoken phrase
    text = re.sub(r'<anchor\b[^>]*>(.*?)</anchor>', r'\1', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'</?[^>]+>', '', text)

    # Replace math expressions with readable speech
    text = re.sub(r'\$\$(.*?)\$\$', r' \1 ', text)
    text = re.sub(r'\$(.*?)\$', r' \1 ', text)
    # Inline/display LaTeX delimiters: \( ... \) and \[ ... \]
    text = re.sub(r'\\[\(\)\[\]]', ' ', text)
    text = re.sub(r'\\text\{([^}]*)\}', r'\1', text)
    text = text.replace(r'\frac{1}{2}', 'one half')
    text = text.replace(r'\frac{1}{4}', 'one quarter')
    text = text.replace(r'\frac{3}{4}', 'three quarters')
    text = re.sub(r'\\frac\{([^}]*)\}\{([^}]*)\}', r'\1 over \2', text)
    text = text.replace('\\times', ' times ').replace('\\cdot', ' times ')
    text = text.replace('^2', ' squared')
    text = text.replace('^3', ' cubed')
    text = text.replace('+', ' plus ')
    text = text.replace('=', ' equals ')
    
    # Strip markdown headers, bold, italics, links, bullet points
    text = re.sub(r'#{1,6}\s*', '', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'\*(.*?)\*', r'\1', text)
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)
    
    # Normalize spaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _provider_order() -> list[str]:
    """Preferred provider first, then fallbacks. Cartesia is only used when explicitly selected."""
    fallbacks = [p for p in ("deepgram", "openai") if p != TTS_PROVIDER]
    return [TTS_PROVIDER] + fallbacks


def _build_request(provider: str, cleaned: str) -> Optional[dict]:
    if provider == "deepgram" and DEEPGRAM_API_KEY:
        return {
            "method": "POST",
            "url": f"https://api.deepgram.com/v1/speak?model={DEEPGRAM_TTS_MODEL}",
            "headers": {"Authorization": f"Token {DEEPGRAM_API_KEY}", "Content-Type": "application/json"},
            "json": {"text": cleaned[:1200]},
        }
    if provider == "cartesia" and CARTESIA_API_KEY:
        return {
            "method": "POST",
            "url": "https://api.cartesia.ai/tts/bytes",
            "headers": {
                "X-API-Key": CARTESIA_API_KEY,
                "Cartesia-Version": "2024-06-10",
                "Content-Type": "application/json",
            },
            "json": {
                "model_id": CARTESIA_MODEL,
                "transcript": cleaned[:1200],
                "voice": {"mode": "id", "id": CARTESIA_VOICE_ID},
                "output_format": {"container": "mp3", "encoding": "mp3", "sample_rate": 44100},
            },
        }
    if provider == "openai" and OPENAI_API_KEY:
        return {
            "method": "POST",
            "url": "https://api.openai.com/v1/audio/speech",
            "headers": {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            "json": {"model": "tts-1", "voice": "nova", "input": cleaned[:1200], "response_format": "mp3"},
        }
    return None


async def open_speech_stream(text: str) -> Optional[AsyncIterator[bytes]]:
    """
    Open a low-latency MP3 stream for `text`.

    Returns an async iterator that yields audio bytes as soon as the provider
    produces them (Deepgram first byte ~0.4s vs ~2.4s for the full file), or
    None if every provider failed. The first chunk is read before returning so
    callers can still fall back / return an error status cleanly.
    """
    cleaned = clean_text_for_speech(text)
    if not cleaned:
        return None

    cache_key = hashlib.md5(cleaned.encode("utf-8")).hexdigest()
    cached_audio = _AUDIO_CACHE.get(cache_key)
    if cached_audio:
        async def _cached() -> AsyncIterator[bytes]:
            yield cached_audio
        return _cached()

    client = _client()
    for provider in _provider_order():
        req = _build_request(provider, cleaned)
        if req is None:
            continue
        try:
            resp = await client.send(client.build_request(**req), stream=True)
        except Exception as e:
            print(f"[TTS] {provider} connection error: {e}")
            continue

        if resp.status_code != 200:
            body = await resp.aread()
            await resp.aclose()
            print(f"[TTS] {provider} returned {resp.status_code}: {body[:120]!r}")
            continue

        iterator = resp.aiter_bytes()
        try:
            first = await iterator.__anext__()
        except StopAsyncIteration:
            await resp.aclose()
            continue
        except Exception as e:
            await resp.aclose()
            print(f"[TTS] {provider} stream error: {e}")
            continue

        async def _relay(resp=resp, iterator=iterator, first=first) -> AsyncIterator[bytes]:
            chunks = [first]
            complete = False
            try:
                yield first
                async for chunk in iterator:
                    chunks.append(chunk)
                    yield chunk
                complete = True
            finally:
                await resp.aclose()
                if complete:
                    audio = b"".join(chunks)
                    if len(audio) > 100:
                        _cache_put(cache_key, audio)

        return _relay()

    return None


async def synthesize_speech(text: str) -> Optional[bytes]:
    """Synthesize the full MP3 for `text` (buffered). Prefer open_speech_stream for playback."""
    stream = await open_speech_stream(text)
    if stream is None:
        return None
    audio = b"".join([chunk async for chunk in stream])
    return audio if len(audio) > 100 else None

