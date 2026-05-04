from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from database import get_db
from models import Shipment, User, Bid
from auth_utils import get_current_user
import datetime

router = APIRouter()


@router.post("/")
def create_shipment(
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Shipper creates a new shipment (load posting).
    Body: { pickup_address, drop_address, goods_desc, weight_kg, vehicle_type, deadline }
    """
    user = get_current_user(authorization)
    if user["role"] != "shipper":
        raise HTTPException(403, "Only shippers can post shipments")

    deadline = None
    if data.get("deadline"):
        try:
            deadline = datetime.datetime.fromisoformat(data["deadline"])
        except Exception:
            pass

    shipment = Shipment(
        shipper_id=user["sub"],
        pickup_address=data["pickup_address"],
        drop_address=data["drop_address"],
        goods_desc=data["goods_desc"],
        weight_kg=float(data["weight_kg"]),
        vehicle_type=data.get("vehicle_type", "Truck"),
        deadline=deadline,
        est_time_hours=data.get("est_time_hours"),
        status="open"
    )
    db.add(shipment)
    db.commit()
    db.refresh(shipment)

    return {"message": "Shipment posted successfully", "shipment_id": shipment.id}


@router.get("/open")
def get_open_shipments(
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Get all open shipments — drivers see this to place bids.
    """
    get_current_user(authorization)  # must be logged in

    shipments = db.query(Shipment).filter(Shipment.status == "open").all()
    result = []
    for s in shipments:
        bid_count = db.query(Bid).filter(Bid.shipment_id == s.id).count()
        lowest_bid = db.query(Bid).filter(Bid.shipment_id == s.id).order_by(Bid.amount).first()

        result.append({
            "id": s.id,
            "pickup_address": s.pickup_address,
            "drop_address": s.drop_address,
            "goods_desc": s.goods_desc,
            "weight_kg": s.weight_kg,
            "vehicle_type": s.vehicle_type,
            "est_time_hours": s.est_time_hours,
            "deadline": s.deadline.isoformat() if s.deadline else None,
            "created_at": s.created_at.isoformat(),
            "bid_count": bid_count,
            "lowest_bid": lowest_bid.amount if lowest_bid else None
        })

    return result


@router.get("/my")
def get_my_shipments(
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Shipper: see all shipments they posted.
    Driver: see all shipments they were assigned to.
    """
    user = get_current_user(authorization)

    if user["role"] == "shipper":
        shipments = db.query(Shipment).filter(Shipment.shipper_id == user["sub"]).all()
    else:
        shipments = db.query(Shipment).filter(Shipment.assigned_driver_id == user["sub"]).all()

    result = []
    for s in shipments:
        bids = db.query(Bid).filter(Bid.shipment_id == s.id).all()
        result.append({
            "id": s.id,
            "pickup_address": s.pickup_address,
            "drop_address": s.drop_address,
            "goods_desc": s.goods_desc,
            "weight_kg": s.weight_kg,
            "vehicle_type": s.vehicle_type,
            "status": s.status,
            "est_time_hours": s.est_time_hours,
            "deadline": s.deadline.isoformat() if s.deadline else None,
            "created_at": s.created_at.isoformat(),
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "delivered_at": s.delivered_at.isoformat() if s.delivered_at else None,
            "winning_bid_amount": s.winning_bid_amount,
            "bids": [
                {
                    "id": b.id,
                    "driver_id": b.driver_id,
                    "amount": b.amount,
                    "created_at": b.created_at.isoformat()
                }
                for b in bids
            ]
        })

    return result


@router.get("/{shipment_id}")
def get_shipment(
    shipment_id: str,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """Get a single shipment with all bids."""
    get_current_user(authorization)

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s:
        raise HTTPException(404, "Shipment not found")

    bids = db.query(Bid).filter(Bid.shipment_id == s.id).order_by(Bid.amount).all()
    driver = None
    if s.assigned_driver_id:
        d = db.query(User).filter(User.id == s.assigned_driver_id).first()
        if d:
            driver = {"name": d.name, "phone": d.phone}

    return {
        "id": s.id,
        "pickup_address": s.pickup_address,
        "drop_address": s.drop_address,
        "goods_desc": s.goods_desc,
        "weight_kg": s.weight_kg,
        "vehicle_type": s.vehicle_type,
        "status": s.status,
        "est_time_hours": s.est_time_hours,
        "deadline": s.deadline.isoformat() if s.deadline else None,
        "created_at": s.created_at.isoformat(),
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "delivered_at": s.delivered_at.isoformat() if s.delivered_at else None,
        "winning_bid_amount": s.winning_bid_amount,
        "assigned_driver": driver,
        "bids": [
            {
                "id": b.id,
                "driver_id": b.driver_id,
                "amount": b.amount,
                "is_winner": b.is_winner,
                "created_at": b.created_at.isoformat()
            }
            for b in bids
        ]
    }


@router.patch("/{shipment_id}/status")
def update_status(
    shipment_id: str,
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Driver updates shipment status (in_transit → delivered).
    Body: { status }
    """
    user = get_current_user(authorization)

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s:
        raise HTTPException(404, "Shipment not found")

    allowed_statuses = ["in_transit", "delivered"]
    if data["status"] not in allowed_statuses:
        raise HTTPException(400, f"Status must be one of: {allowed_statuses}")

    if user["role"] == "driver" and s.assigned_driver_id != user["sub"]:
        raise HTTPException(403, "You are not assigned to this shipment")

    s.status = data["status"]
    if data["status"] == "in_transit":
        s.started_at = datetime.datetime.utcnow()
    elif data["status"] == "delivered":
        s.delivered_at = datetime.datetime.utcnow()

    db.commit()

    return {"message": f"Status updated to {data['status']}"}