from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from sqlalchemy import text
from database import engine, Base
from routers import auth, shipments, bids, tracking, drivers, pod, payments

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
        conn.execute(text("ALTER TABLE shipments ADD COLUMN pickup_lat FLOAT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE shipments ADD COLUMN pickup_lng FLOAT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE shipments ADD COLUMN parent_shipment_id TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE shipment_destinations ADD COLUMN ack_status TEXT DEFAULT 'none'"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE shipments ADD COLUMN num_trucks INTEGER DEFAULT 1"))
    except Exception:
        pass
    # POD & proof request migrations
    try:
        conn.execute(text("ALTER TABLE pods ADD COLUMN dest_id TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE pods ADD COLUMN pod_type TEXT DEFAULT 'delivery'"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE pods ADD COLUMN ack_status TEXT DEFAULT 'pending'"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE pods ADD COLUMN ack_notes TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE pods ADD COLUMN ack_at DATETIME"))
    except Exception:
        pass
    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS proof_requests (
                id TEXT PRIMARY KEY,
                shipment_id TEXT NOT NULL,
                shipper_id TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                image_url TEXT,
                created_at DATETIME,
                fulfilled_at DATETIME
            )
        """))
    except Exception:
        pass
    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS complaints (
                id TEXT PRIMARY KEY,
                shipment_id TEXT NOT NULL,
                shipper_id TEXT NOT NULL,
                driver_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'open',
                created_at DATETIME,
                resolved_at DATETIME
            )
        """))
    except Exception:
        pass
    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS payments (
                id TEXT PRIMARY KEY,
                shipment_id TEXT NOT NULL,
                shipper_id TEXT NOT NULL,
                driver_id TEXT NOT NULL,
                amount FLOAT NOT NULL,
                currency TEXT DEFAULT 'inr',
                stripe_pi_id TEXT,
                stripe_pm_id TEXT,
                stripe_charge_id TEXT,
                status TEXT DEFAULT 'pending',
                card_last4 TEXT,
                card_brand TEXT,
                created_at DATETIME,
                paid_at DATETIME
            )
        """))
    except Exception:
        pass
    # Ensure payments table has the correct columns (migrate if old schema)
    try:
        conn.execute(text("ALTER TABLE payments ADD COLUMN shipper_id TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE payments ADD COLUMN driver_id TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE payments ADD COLUMN stripe_pi_id TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE payments ADD COLUMN stripe_pm_id TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE payments ADD COLUMN stripe_charge_id TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE payments ADD COLUMN card_last4 TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE payments ADD COLUMN card_brand TEXT"))
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE payments ADD COLUMN paid_at DATETIME"))
    except Exception:
        pass

# Fix old 'succeeded' payments on non-delivered shipments → escrow_held
with engine.begin() as conn:
    conn.execute(text("""
        UPDATE payments SET status = 'escrow_held'
        WHERE status = 'succeeded'
        AND shipment_id IN (
            SELECT id FROM shipments WHERE status NOT IN ('delivered')
        )
    """))

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
app.include_router(bids.router,      prefix="/api/shipments",  tags=["Bids"])
app.include_router(tracking.router,  prefix="/api/track",     tags=["Tracking"])
app.include_router(drivers.router,   prefix="/api/drivers",   tags=["Drivers"])
app.include_router(pod.router,       prefix="/api/pod",       tags=["POD"])
app.include_router(payments.router,  prefix="/api/payments",  tags=["Payments"])


@app.get("/api/health")
def health():
    return {"status": "ok", "message": "FreightBid API is running"}


# Absolute path — works no matter where uvicorn is run from
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
UPLOADS_DIR  = FRONTEND_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Serve uploaded images at /uploads/*
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# Serve frontend static files — MUST come last
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")