from fastapi import FastAPI

app = FastAPI(title="Vela Server")

@app.get("/health")
def health_check():
    return {"status": "ok"}
