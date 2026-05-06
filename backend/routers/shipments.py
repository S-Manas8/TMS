from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from database import get_db
from models import Shipment, User, Bid, Rating, ShipmentDestination
from auth_utils import get_current_user
import datetime
import math

def haversine_distance(lat1, lon1, lat2, lon2):
    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return 0.0
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

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
            now = datetime.datetime.utcnow()
            if deadline <= now:
                raise HTTPException(400, "Deadline must be in the future")
            if deadline > now + datetime.timedelta(days=365):
                raise HTTPException(400, "Deadline cannot be more than 1 year from today")
        except HTTPException:
            raise
        except Exception:
            pass

    shipment = Shipment(
        shipper_id=user["sub"],
        pickup_address=data.get("pickup_address", "Unknown"),
        pickup_lat=data.get("pickup_lat"),
        pickup_lng=data.get("pickup_lng"),
        drop_address=data.get("drop_address", ""),
        goods_desc=data.get("goods_desc"),
        weight_kg=float(data.get("weight_kg", 0)),
        vehicle_type=data.get("vehicle_type", "Truck"),
        deadline=deadline,
        est_time_hours=data.get("est_time_hours"),
        status="open"
    )
    destinations = data.get("destinations", [])
    if not destinations and not data.get("drop_address"):
        raise HTTPException(400, "Shipment must have at least one destination")

    db.add(shipment)
    db.flush()
    for idx, dest in enumerate(destinations):
        if not dest.get("address"):
            raise HTTPException(400, f"Destination {idx+1} address is required")
        d = ShipmentDestination(
            shipment_id=shipment.id,
            address=dest.get("address", f"Stop {idx+1}"),
            lat=dest.get("lat", 0.0),
            lng=dest.get("lng", 0.0),
            order_index=idx
        )
        db.add(d)

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
        dests = db.query(ShipmentDestination).filter(ShipmentDestination.shipment_id == s.id).order_by(ShipmentDestination.order_index).all()

        result.append({
            "id": s.id,
            "pickup_address": s.pickup_address,
            "pickup_lat": s.pickup_lat,
            "pickup_lng": s.pickup_lng,
            "drop_address": s.drop_address,
            "goods_desc": s.goods_desc,
            "weight_kg": s.weight_kg,
            "vehicle_type": s.vehicle_type,
            "est_time_hours": s.est_time_hours,
            "deadline": s.deadline.isoformat() if s.deadline else None,
            "created_at": s.created_at.isoformat(),
            "bid_count": bid_count,
            "lowest_bid": lowest_bid.amount if lowest_bid else None,
            "destinations": [{"id": d.id, "address": d.address, "lat": d.lat, "lng": d.lng, "status": d.status, "order_index": d.order_index, "ack_status": d.ack_status} for d in dests]
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
        dests = db.query(ShipmentDestination).filter(ShipmentDestination.shipment_id == s.id).order_by(ShipmentDestination.order_index).all()
        result.append({
            "id": s.id,
            "pickup_address": s.pickup_address,
            "pickup_lat": s.pickup_lat,
            "pickup_lng": s.pickup_lng,
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
            "destinations": [{"id": d.id, "address": d.address, "lat": d.lat, "lng": d.lng, "status": d.status, "order_index": d.order_index, "ack_status": d.ack_status} for d in dests],
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

    rating = db.query(Rating).filter(Rating.shipment_id == s.id).first()
    shipper_rating = rating.score if rating else None
    
    dests = db.query(ShipmentDestination).filter(ShipmentDestination.shipment_id == s.id).order_by(ShipmentDestination.order_index).all()

    return {
        "id": s.id,
        "pickup_address": s.pickup_address,
        "pickup_lat": s.pickup_lat,
        "pickup_lng": s.pickup_lng,
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
        "shipper_rating": shipper_rating,
        "destinations": [{"id": d.id, "address": d.address, "lat": d.lat, "lng": d.lng, "status": d.status, "order_index": d.order_index, "ack_status": d.ack_status} for d in dests],
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


@router.post("/{shipment_id}/rate")
def rate_driver(
    shipment_id: str,
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Shipper rates the assigned driver after delivery.
    Body: { score } (float 1-5)
    """
    user = get_current_user(authorization)

    if user["role"] != "shipper":
        raise HTTPException(403, "Only shippers can rate drivers")

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s:
        raise HTTPException(404, "Shipment not found")

    if s.shipper_id != user["sub"]:
        raise HTTPException(403, "You don't own this shipment")

    if s.status != "delivered":
        raise HTTPException(400, "You can only rate after shipment is delivered")

    # Check if already rated
    existing_rating = db.query(Rating).filter(Rating.shipment_id == shipment_id).first()
    if existing_rating:
        raise HTTPException(400, "You have already rated this shipment")

    score = float(data.get("score", 0))
    if score < 1 or score > 5:
        raise HTTPException(400, "Score must be between 1 and 5")

    rating = Rating(
        shipment_id=shipment_id,
        driver_id=s.assigned_driver_id,
        shipper_id=user["sub"],
        score=score
    )
    db.add(rating)
    db.commit()

    return {"message": "Rating submitted successfully", "score": score}


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


@router.post("/{shipment_id}/destinations/{dest_id}/arrive")
def driver_arrive_at_destination(
    shipment_id: str,
    dest_id: str,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Driver sends arrival acknowledgement at a stop.
    Sets ack_status = 'pending_approval'. Shipper must approve before
    driver can mark it delivered.
    """
    user = get_current_user(authorization)
    if user["role"] != "driver":
        raise HTTPException(403, "Only drivers can send arrival acknowledgements")

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s or s.assigned_driver_id != user["sub"]:
        raise HTTPException(403, "Not assigned to this shipment")

    if s.status != "in_transit":
        raise HTTPException(400, "Shipment is not in transit")

    dest = db.query(ShipmentDestination).filter(
        ShipmentDestination.id == dest_id,
        ShipmentDestination.shipment_id == shipment_id
    ).first()
    if not dest:
        raise HTTPException(404, "Destination not found")

    if dest.status == "delivered":
        raise HTTPException(400, "This stop is already delivered")

    if dest.ack_status == "pending_approval":
        raise HTTPException(400, "Arrival already sent — waiting for shipper approval")

    if dest.ack_status == "approved":
        raise HTTPException(400, "Arrival already approved — mark it delivered")

    # Enforce sequential order: previous stops must be delivered first
    all_dests = db.query(ShipmentDestination).filter(
        ShipmentDestination.shipment_id == shipment_id
    ).order_by(ShipmentDestination.order_index).all()

    for d in all_dests:
        if d.order_index < dest.order_index and d.status != "delivered":
            raise HTTPException(
                400,
                f"Complete stop #{d.order_index + 1} ({d.address}) before arriving at this one"
            )

    dest.ack_status = "pending_approval"
    db.commit()

    return {"message": "Arrival acknowledgement sent. Waiting for shipper approval."}


@router.post("/{shipment_id}/destinations/{dest_id}/approve")
def shipper_approve_arrival(
    shipment_id: str,
    dest_id: str,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Shipper approves the driver's arrival at a stop.
    Sets ack_status = 'approved'. Driver can now mark it delivered.
    """
    user = get_current_user(authorization)
    if user["role"] != "shipper":
        raise HTTPException(403, "Only shippers can approve arrivals")

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s:
        raise HTTPException(404, "Shipment not found")

    if s.shipper_id != user["sub"]:
        raise HTTPException(403, "You don't own this shipment")

    dest = db.query(ShipmentDestination).filter(
        ShipmentDestination.id == dest_id,
        ShipmentDestination.shipment_id == shipment_id
    ).first()
    if not dest:
        raise HTTPException(404, "Destination not found")

    if dest.ack_status not in ("pending_approval", "none"):
        raise HTTPException(400, "This stop is already approved or delivered")

    dest.ack_status = "approved"
    db.commit()

    return {"message": f"Arrival at stop approved. Driver can now mark it delivered."}


@router.patch("/{shipment_id}/destinations/{dest_id}")
def update_destination_status(
    shipment_id: str,
    dest_id: str,
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    user = get_current_user(authorization)
    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s or (user["role"] == "driver" and s.assigned_driver_id != user["sub"]):
        raise HTTPException(403, "Not authorized or not found")

    dest = db.query(ShipmentDestination).filter(
        ShipmentDestination.id == dest_id,
        ShipmentDestination.shipment_id == shipment_id
    ).first()
    if not dest:
        raise HTTPException(404, "Destination not found")

    if data.get("status") == "delivered":
        # Enforce that shipper has approved the arrival before allowing delivery mark
        if dest.ack_status != "approved":
            raise HTTPException(
                400,
                "Shipper must approve your arrival at this stop before you can mark it delivered"
            )

        # Enforce sequential order: every stop with a lower order_index must already be delivered
        all_dests = db.query(ShipmentDestination).filter(
            ShipmentDestination.shipment_id == shipment_id
        ).order_by(ShipmentDestination.order_index).all()

        for d in all_dests:
            if d.order_index < dest.order_index and d.status != "delivered":
                raise HTTPException(
                    400,
                    f"Complete stop #{d.order_index + 1} ({d.address}) before marking this one delivered"
                )

        dest.status = "delivered"
        dest.ack_status = "approved"  # keep it consistent
        db.commit()

        # Re-fetch to check if all are now delivered
        all_dests = db.query(ShipmentDestination).filter(
            ShipmentDestination.shipment_id == shipment_id
        ).all()
        if all(d.status == "delivered" for d in all_dests):
            s.status = "delivered"
            s.delivered_at = datetime.datetime.utcnow()
            db.commit()

    elif data.get("status") == "pending":
        dest.status = "pending"
        dest.ack_status = "none"
        db.commit()

    return {"message": "Destination updated"}


@router.post("/{shipment_id}/abandon")
def abandon_shipment(
    shipment_id: str,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Driver abandons trip early. Pays proportional to distance covered.
    Splits remaining destinations into a new shipment.
    """
    user = get_current_user(authorization)
    if user["role"] != "driver":
        raise HTTPException(403, "Only drivers can abandon trips")

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s or s.assigned_driver_id != user["sub"]:
        raise HTTPException(403, "Not assigned to this shipment")

    if s.status != "in_transit":
        raise HTTPException(400, "Can only abandon an in-transit shipment")

    dests = db.query(ShipmentDestination).filter(ShipmentDestination.shipment_id == s.id).order_by(ShipmentDestination.order_index).all()
    
    if not dests:
        raise HTTPException(400, "No destinations found to split")

    total_distance = 0.0
    covered_distance = 0.0
    
    last_lat = s.pickup_lat
    last_lng = s.pickup_lng
    
    last_completed_dest = None

    for d in dests:
        dist = haversine_distance(last_lat, last_lng, d.lat, d.lng)
        total_distance += dist
        if d.status == "delivered":
            covered_distance += dist
            last_completed_dest = d
        last_lat = d.lat
        last_lng = d.lng

    if total_distance > 0 and s.winning_bid_amount:
        proportion = covered_distance / total_distance
        s.winning_bid_amount = round(s.winning_bid_amount * proportion, 2)
    else:
        s.winning_bid_amount = 0

    s.status = "delivered" # Mark as delivered for the driver's portion
    s.delivered_at = datetime.datetime.utcnow()

    # Extract pending destinations
    pending_dests = [d for d in dests if d.status == "pending"]

    if pending_dests:
        new_shipment = Shipment(
            shipper_id=s.shipper_id,
            pickup_address=last_completed_dest.address if last_completed_dest else s.pickup_address,
            pickup_lat=last_completed_dest.lat if last_completed_dest else s.pickup_lat,
            pickup_lng=last_completed_dest.lng if last_completed_dest else s.pickup_lng,
            goods_desc=s.goods_desc,
            weight_kg=s.weight_kg,
            vehicle_type=s.vehicle_type,
            status="open",
            parent_shipment_id=s.id
        )
        db.add(new_shipment)
        db.flush()

        for idx, d in enumerate(pending_dests):
            new_dest = ShipmentDestination(
                shipment_id=new_shipment.id,
                address=d.address,
                lat=d.lat,
                lng=d.lng,
                status="pending",
                order_index=idx
            )
            db.add(new_dest)
            
            # Delete old pending destinations
            db.delete(d)

    db.commit()
    return {"message": "Shipment split successfully", "earned": s.winning_bid_amount}
