from fastapi import FastAPI
from .api import recovery

app = FastAPI(title="ResilienceOS Recovery Optimizer")

app.include_router(recovery.router, prefix="/recovery", tags=["Recovery"])

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ResilienceOS Recovery Optimizer"}
