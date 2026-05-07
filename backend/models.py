from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Boolean, Integer
from sqlalchemy.dialects.sqlite import TEXT
from database import Base
import uuid
import datetime


def gen_id():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id       = Column(TEXT, primary_key=True, default=gen_id)
    name     = Column(String, nullable=False)
    email    = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)
    role     = Column(String, nullable=False)  # "shipper" or "driver"
    phone    = Column(String)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Shipment(Base):
    __tablename__ = "shipments"

    id             = Column(TEXT, primary_key=True, default=gen_id)
    shipper_id     = Column(TEXT, ForeignKey("users.id"), nullable=False)
    pickup_address = Column(String, nullable=False)
    drop_address   = Column(String, nullable=False)
    goods_desc     = Column(String, nullable=False)
    weight_kg      = Column(Float, nullable=False)
    vehicle_type   = Column(String, default="Truck")  # Truck, Mini Truck, Tempo
    trucks_required = Column(Integer, default=1)
    deadline       = Column(DateTime)
    est_time_hours = Column(Float, nullable=True)  # Shipper's approx time
    started_at     = Column(DateTime, nullable=True) # When status -> in_transit
    delivered_at   = Column(DateTime, nullable=True) # When status -> delivered
    # Status flow: open → assigned → in_transit → delivered
    status         = Column(String, default="open")
    assigned_driver_id = Column(TEXT, ForeignKey("users.id"), nullable=True)
    winning_bid_amount = Column(Float, nullable=True)
    created_at     = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class Bid(Base):
    __tablename__ = "bids"

    id          = Column(TEXT, primary_key=True, default=gen_id)
    shipment_id = Column(TEXT, ForeignKey("shipments.id"), nullable=False)
    driver_id   = Column(TEXT, ForeignKey("users.id"), nullable=False)
    amount      = Column(Float, nullable=False)
    is_winner   = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.datetime.utcnow)


class TrackingEvent(Base):
    __tablename__ = "tracking_events"

    id          = Column(TEXT, primary_key=True, default=gen_id)
    shipment_id = Column(TEXT, ForeignKey("shipments.id"), nullable=False)
    driver_id   = Column(TEXT, ForeignKey("users.id"), nullable=False)
    lat         = Column(Float, nullable=False)
    lng         = Column(Float, nullable=False)
    timestamp   = Column(DateTime, default=datetime.datetime.utcnow)


class POD(Base):
    __tablename__ = "pods"

    id          = Column(TEXT, primary_key=True, default=gen_id)
    shipment_id = Column(TEXT, ForeignKey("shipments.id"), nullable=False)
    image_url   = Column(String)
    geo_lat     = Column(Float)
    geo_lng     = Column(Float)
    delivered_at = Column(DateTime, default=datetime.datetime.utcnow)
    notes       = Column(String)
