from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Boolean, Integer
from sqlalchemy.dialects.sqlite import TEXT
from database import Base
import uuid
import datetime


def gen_id():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id         = Column(TEXT, primary_key=True, default=gen_id)
    name       = Column(String, nullable=False)
    email      = Column(String, unique=True, nullable=False)
    password   = Column(String, nullable=False)
    role       = Column(String, nullable=False)   # "shipper" or "driver"
    phone      = Column(String)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Shipment(Base):
    __tablename__ = "shipments"

    id                 = Column(TEXT, primary_key=True, default=gen_id)
    shipper_id         = Column(TEXT, ForeignKey("users.id"), nullable=False)
    pickup_address     = Column(String, nullable=False)
    pickup_lat         = Column(Float, nullable=True)
    pickup_lng         = Column(Float, nullable=True)
    drop_address       = Column(String, nullable=True)
    goods_desc         = Column(String, nullable=True)
    weight_kg          = Column(Float, nullable=False, default=0)
    vehicle_type       = Column(String, default="Truck")
    deadline           = Column(DateTime, nullable=True)
    est_time_hours     = Column(Float, nullable=True)
    parent_shipment_id = Column(TEXT, nullable=True)

    # Status flow: open → assigned → in_transit → delivered
    status             = Column(String, default="open")
    assigned_driver_id = Column(TEXT, ForeignKey("users.id"), nullable=True)
    winning_bid_amount = Column(Float, nullable=True)

    created_at   = Column(DateTime, default=datetime.datetime.utcnow)
    started_at   = Column(DateTime, nullable=True)
    delivered_at = Column(DateTime, nullable=True)


class ShipmentDestination(Base):
    __tablename__ = "shipment_destinations"

    id          = Column(TEXT, primary_key=True, default=gen_id)
    shipment_id = Column(TEXT, ForeignKey("shipments.id"), nullable=False)
    address     = Column(String, nullable=False)
    lat         = Column(Float, default=0.0)
    lng         = Column(Float, default=0.0)
    order_index = Column(Integer, default=0)
    status      = Column(String, default="pending")  # pending / delivered

    # Acknowledgement flow:
    #   none              → driver has not arrived yet
    #   pending_approval  → driver clicked "I've Arrived", waiting for shipper
    #   approved          → shipper approved, driver can now mark delivered
    ack_status  = Column(String, default="none")


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

    id           = Column(TEXT, primary_key=True, default=gen_id)
    shipment_id  = Column(TEXT, ForeignKey("shipments.id"), nullable=False)
    image_url    = Column(String)
    geo_lat      = Column(Float)
    geo_lng      = Column(Float)
    delivered_at = Column(DateTime, default=datetime.datetime.utcnow)
    notes        = Column(String)


class Rating(Base):
    __tablename__ = "ratings"

    id          = Column(TEXT, primary_key=True, default=gen_id)
    shipment_id = Column(TEXT, ForeignKey("shipments.id"), nullable=False)
    driver_id   = Column(TEXT, ForeignKey("users.id"), nullable=False)
    shipper_id  = Column(TEXT, ForeignKey("users.id"), nullable=False)
    score       = Column(Float, nullable=False)  # 1 to 5
    created_at  = Column(DateTime, default=datetime.datetime.utcnow)