from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.reflector import router as reflector_router

app = FastAPI(title="ResilienceOS Reflector Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reflector_router, prefix="/reflector", tags=["reflector"])

@app.get("/")
def health_check():
    return {"status": "ok", "service": "reflector-agent"}
