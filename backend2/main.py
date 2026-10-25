import base64
import io
import json
import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from pypdf import PdfReader
from langchain_core.messages import HumanMessage

from graph import (
    graph,
    get_role_fundamentals,
    TOTAL_PROJECT_QUESTIONS,
    TOTAL_FUNDAMENTAL_QUESTIONS,
)

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_WHISPER_MODEL = "whisper-large-v3-turbo"

CARTESIA_TTS_URL = "https://api.cartesia.ai/tts/bytes"
CARTESIA_VERSION = "2026-08-14"
CARTESIA_MODEL = "sonic-latest"
CARTESIA_VOICE_ID = os.getenv(
    "CARTESIA_VOICE_ID", "47c38ca4-5f35-497b-b1a3-415245fb35e1"
)

# MP3 is used for plain playback, raw PCM16 @16kHz drives the Simli avatar.
CARTESIA_MP3_FORMAT = {
    "container": "mp3",
    "sample_rate": 44100,
    "bit_rate": 128000,
}
CARTESIA_PCM_FORMAT = {
    "container": "raw",
    "encoding": "pcm_s16le",
    "sample_rate": 16000,
}

SIMLI_TOKEN_URL = "https://api.simli.ai/compose/token"

TOTAL_QUESTIONS = TOTAL_PROJECT_QUESTIONS + TOTAL_FUNDAMENTAL_QUESTIONS


class SpeakRequest(BaseModel):
    text: str
    format: str = "mp3"


@app.post("/speak")
async def speak(payload: SpeakRequest):
    """Convert the interviewer's text into speech with Cartesia Sonic.

    The browser sends the question text and receives audio. With
    ``format="pcm"`` it gets raw PCM16 @16kHz (for the Simli avatar);
    otherwise it gets MP3. The Cartesia API key stays on the server and is
    never exposed to the client.
    """
    text = (payload.text or "").strip()

    if not text:
        return JSONResponse({"error": "No text provided"}, status_code=400)

    api_key = os.getenv("CARTESIA_API_KEY")
    if not api_key:
        return JSONResponse({"error": "CARTESIA_API_KEY is not set"}, status_code=500)

    wants_pcm = payload.format == "pcm"
    output_format = CARTESIA_PCM_FORMAT if wants_pcm else CARTESIA_MP3_FORMAT
    media_type = "application/octet-stream" if wants_pcm else "audio/mpeg"

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            CARTESIA_TTS_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Cartesia-Version": CARTESIA_VERSION,
                "Content-Type": "application/json",
            },
            json={
                "model_id": CARTESIA_MODEL,
                "transcript": text,
                "voice": CARTESIA_VOICE_ID,
                "output_format": output_format,
                "language": "en",
            },
        )

    if response.status_code != 200:
        return JSONResponse(
            {"error": response.text}, status_code=response.status_code
        )

    return Response(content=response.content, media_type=media_type)


@app.get("/simli/token")
async def simli_token():
    """Create a short-lived Simli session token for the avatar.

    Keeps SIMLI_API_KEY on the server; the browser only receives the token.
    """
    api_key = os.getenv("SIMLI_API_KEY")
    face_id = os.getenv("SIMLI_FACE_ID")

    if not api_key or not face_id:
        return JSONResponse(
            {"error": "SIMLI_API_KEY or SIMLI_FACE_ID is not set"},
            status_code=500,
        )

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            SIMLI_TOKEN_URL,
            headers={
                "x-simli-api-key": api_key,
                "Content-Type": "application/json",
            },
            json={
                "faceId": face_id,
                "handleSilence": True,
                "maxSessionLength": 3600,
                "maxIdleTime": 600,
            },
        )

    if response.status_code != 200:
        return JSONResponse(
            {"error": response.text}, status_code=response.status_code
        )

    return response.json()


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """Receive recorded audio from the browser and return its transcript."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return JSONResponse({"error": "GROQ_API_KEY is not set"}, status_code=500)

    audio = await file.read()
    if not audio:
        return JSONResponse({"error": "Empty audio file"}, status_code=400)

    form = {
        "model": GROQ_WHISPER_MODEL,
        "response_format": "json",
    }
    files = {
        "file": (
            file.filename or "answer.webm",
            audio,
            file.content_type or "audio/webm",
        ),
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            GROQ_TRANSCRIBE_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            data=form,
            files=files,
        )

    if response.status_code != 200:
        return JSONResponse(
            {"error": response.text}, status_code=response.status_code
        )

    return {"text": response.json().get("text", "").strip()}


def build_message(state):
    stage = state["stage"]

    return json.dumps(
        {
            "type": "closing" if stage == "done" else "message",
            "content": state["messages"][-1].content,
            "stage": stage,
            "asked": state["project_count"] + state["fundamental_count"],
            "total": TOTAL_QUESTIONS,
        }
    )


@app.websocket("/ws")
async def interview_socket(websocket: WebSocket):
    await websocket.accept()

    try:
        # 1. Receive role and resume from the frontend
        data = await websocket.receive_json()

        role = data["role"]
        resume_base64 = data["resume"]

        # 2. Decode the PDF and extract the resume text
        resume_bytes = base64.b64decode(resume_base64)
        reader = PdfReader(io.BytesIO(resume_bytes))

        resume_text = ""
        for page in reader.pages:
            resume_text += page.extract_text() or ""

        # 3. Build the starting state for the interview graph
        state = {
            "role": role,
            "resume_text": resume_text,
            "role_fundamentals": get_role_fundamentals(role),
            "messages": [],
            "stage": "readiness",
            "project_count": 0,
            "fundamental_count": 0,
        }

        # 4. Run the graph once to get the opening message
        state = graph.invoke(state)
        await websocket.send_text(build_message(state))

        # 5. Interview loop: receive an answer, reply with the next question
        while True:
            answer = await websocket.receive_text()

            state["messages"].append(HumanMessage(content=answer))

            state = graph.invoke(state)
            await websocket.send_text(build_message(state))

            # 6. The closing message has been sent, so end the interview
            if state["stage"] == "done":
                break

        await websocket.close()

    except WebSocketDisconnect:
        print("Client disconnected")
