import os
import asyncio
from datetime import datetime
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# LlamaIndex & Gemini Imports
from llama_index.llms.gemini import Gemini
from llama_index.embeddings.gemini import GeminiEmbedding
from llama_index.core import Settings

# ---------------------------------------------------------
# 1. AI Configuration (Gemini Free Tier setup via LlamaIndex)
# ---------------------------------------------------------
# Load this from a .env file in production
os.environ["GOOGLE_API_KEY"] = "your_google_ai_studio_api_key_here"

# Configure LlamaIndex globally to use Gemini
Settings.llm = Gemini(model="models/gemini-1.5-flash")
Settings.embed_model = GeminiEmbedding(model_name="models/text-embedding-004")

# Note: Your ChromaDB initialization and VectorStoreIndex creation 
# would normally happen right here so it loads once on startup.
# index = VectorStoreIndex.from_vector_store(...)

# ---------------------------------------------------------
# 2. FastAPI Application Setup
# ---------------------------------------------------------
app = FastAPI(title="Car Rental Booking & AI API")

# Enable CORS (crucial for local development when React is on a different port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# 3. Dynamic Business Logic (Seasonal Pricing)
# ---------------------------------------------------------
def get_dynamic_system_prompt() -> str:
    """Injects current date, location, and seasonal pricing rules before querying the AI."""
    now = datetime.now()
    current_month = now.month
    
    # Example: Apply winter markup for Lahore from November to February
    markup = 0
    if current_month in [11, 12, 1, 2]:
        markup = 2000
    
    formatted_date = now.strftime("%B %d, %Y")
    
    prompt = (
        f"You are the customer service assistant for a car rental company in Lahore.\n"
        f"Today's date is {formatted_date}.\n"
        f"CRITICAL RULE: You must add a seasonal markup of {markup} PKR to ALL base daily "
        f"rates retrieved from the database before showing the price to the customer. "
        f"Do not mention the base rate or the markup to the customer, only provide the final total."
    )
    return prompt

# ---------------------------------------------------------
# 4. Chat Endpoint (Deep Chat Format)
# ---------------------------------------------------------
# Deep Chat sends messages in this structure by default
class Message(BaseModel):
    text: str
    role: str

class ChatRequest(BaseModel):
    messages: list[Message]

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    # Extract the user's latest message
    user_message = request.messages[-1].text
    
    # Generate the dynamic system prompt
    system_instruction = get_dynamic_system_prompt()
    
    # Combine system prompt with user query (In a full RAG app, you'd pass this to the query_engine)
    full_query = f"{system_instruction}\n\nUser Question: {user_message}"

    # Asynchronous generator for Server-Sent Events (SSE)
    async def event_stream():
        try:
            # Placeholder: In production, use your LlamaIndex Query Engine:
            # response = index.as_query_engine(streaming=True).query(full_query)
            # for token in response.response_gen:
            
            # Using raw LLM for boilerplate demonstration
            response = Settings.llm.stream_complete(full_query)
            
            for chunk in response:
                # Deep Chat expects standard plain-text SSE tokens, separated by newlines
                yield f"data: {chunk.text}\n\n"
                await asyncio.sleep(0.01) # Small yield to event loop
                
        except Exception as e:
            yield f"data: Error processing request: {str(e)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

# ---------------------------------------------------------
# 5. Serve React Frontend (Static SPA)
# ---------------------------------------------------------
# Ensure you build your React app (e.g., `npm run build`) and place the 
# output in a folder named 'frontend_build' in the same directory as this file.

# Mount the static assets (CSS, JS, images)
# app.mount("/assets", StaticFiles(directory="frontend_build/assets"), name="assets")

# Catch-all route to serve the React index.html for all other paths.
# This ensures React Router handles page navigation without hitting a 404 on the backend.
# @app.get("/{catchall:path}")
# async def serve_react_app(request: Request):
#     return FileResponse("frontend_build/index.html")