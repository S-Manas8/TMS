from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from database import get_db
from models import Bid, Shipment, User
from auth_utils import get_current_user

router = APIRouter()


@router.post("/{shipment_id}/bid")
def place_bid(
    shipment_id: str,
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Driver places a bid on an open shipment.
    Body: { amount }
    - Only drivers can bid
    - Shipment must be 'open'
    - Driver cannot bid twice on same shipment
    """
    user = get_current_user(authorization)

    if user["role"] != "driver":
        raise HTTPException(403, "Only drivers can place bids")

    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not shipment:
        raise HTTPException(404, "Shipment not found")

    if shipment.status != "open":
        raise HTTPException(400, f"Shipment is not open for bidding (status: {shipment.status})")

    # Check if driver already bid on this shipment
    existing_bid = db.query(Bid).filter(
        Bid.shipment_id == shipment_id,
        Bid.driver_id == user["sub"]
    ).first()

    if existing_bid:
        # Allow updating bid instead of blocking
        existing_bid.amount = float(data["amount"])
        db.commit()
        return {"message": "Bid updated successfully", "bid_amount": existing_bid.amount}

    bid = Bid(
        shipment_id=shipment_id,
        driver_id=user["sub"],
        amount=float(data["amount"])
    )
    db.add(bid)
    db.commit()
    db.refresh(bid)

    return {
        "message": "Bid placed successfully",
        "bid_id": bid.id,
        "bid_amount": bid.amount
    }


@router.get("/{shipment_id}/bids")
def get_bids_for_shipment(
    shipment_id: str,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Get all bids for a shipment — shipper sees this to pick the winner.
    Sorted by amount (lowest first).
    """
    user = get_current_user(authorization)

    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not shipment:
        raise HTTPException(404, "Shipment not found")

    # Shippers see all bids, drivers only see their own
    if user["role"] == "shipper":
        bids = db.query(Bid).filter(Bid.shipment_id == shipment_id).order_by(Bid.amount).all()
    else:
        bids = db.query(Bid).filter(
            Bid.shipment_id == shipment_id,
            Bid.driver_id == user["sub"]
        ).all()

    result = []
    for b in bids:
        driver = db.query(User).filter(User.id == b.driver_id).first()
        result.append({
            "bid_id": b.id,
            "driver_name": driver.name if driver else "Unknown",
            "driver_phone": driver.phone if driver else None,
            "amount": b.amount,
            "is_winner": b.is_winner,
            "created_at": b.created_at.isoformat()
        })

    return result


@router.post("/{shipment_id}/award")
def award_shipment(
    shipment_id: str,
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Shipper awards the shipment to a specific bid (or auto-awards to lowest).
    Body: { bid_id } OR {} for auto-award to lowest bid
    """
    user = get_current_user(authorization)

    if user["role"] != "shipper":
        raise HTTPException(403, "Only shippers can award shipments")

    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not shipment:
        raise HTTPException(404, "Shipment not found")

    if shipment.status != "open":
        raise HTTPException(400, "Shipment is already assigned or closed")

    if shipment.shipper_id != user["sub"]:
        raise HTTPException(403, "You don't own this shipment")

    # Auto-award to lowest bid if no bid_id given
    if data.get("bid_id"):
        winning_bid = db.query(Bid).filter(Bid.id == data["bid_id"]).first()
        if not winning_bid or winning_bid.shipment_id != shipment_id:
            raise HTTPException(404, "Bid not found for this shipment")
    else:
        # Find the lowest bid automatically
        winning_bid = db.query(Bid).filter(
            Bid.shipment_id == shipment_id
        ).order_by(Bid.amount).first()

        if not winning_bid:
            raise HTTPException(400, "No bids placed yet — cannot award")

    # Mark winner
    winning_bid.is_winner = True

    # Update shipment
    shipment.status = "assigned"
    shipment.assigned_driver_id = winning_bid.driver_id
    shipment.winning_bid_amount = winning_bid.amount

    db.commit()

    # Get driver info for response
    driver = db.query(User).filter(User.id == winning_bid.driver_id).first()

    return {
        "message": "Shipment awarded successfully",
        "awarded_to": driver.name if driver else "Unknown",
        "winning_amount": winning_bid.amount
    }