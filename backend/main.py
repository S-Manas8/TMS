from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from sqlalchemy import text
from database import engine, Base, SessionLocal
from routers import auth, shipments, bids, tracking

# Perform safe schema migrations (Option 1: keep data)
with engine.begin() as conn:
    try:
        conn.execute(text("ALTER TABLE shipments ADD COLUMN est_time_hours FLOAT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE shipments ADD COLUMN started_at DATETIME"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE shipments ADD COLUMN delivered_at DATETIME"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE shipments ADD COLUMN trucks_required INTEGER DEFAULT 1"))
    except Exception:
        pass

# Create all database tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="FreightBid — Logistics Platform",
    description="Shipper-Driver bidding and shipment tracking platform",
    version="1.0.0"
)

# Allow frontend to call backend (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
app.include_router(auth.router,      prefix="/api/auth",      tags=["Auth"])
app.include_router(shipments.router, prefix="/api/shipments", tags=["Shipments"])
app.include_router(bids.router,      prefix="/api",           tags=["Bids"])
app.include_router(tracking.router,  prefix="/api/track",     tags=["Tracking"])


@app.post("/api/admin/reset-db")
def reset_db():
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    return {"message": "System reset: All data cleared successfully"}


@app.get("/api/health")
def health():
    return {"status": "ok", "message": "FreightBid API is running"}


@app.get("/test-db")
def test_db():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "Connected to SQLite ✅"}
    except Exception as e:
        return {"status": "Connection failed ❌", "error": str(e)}


# Absolute path — works no matter where uvicorn is run from
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

# Serve frontend static files — MUST come last
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")