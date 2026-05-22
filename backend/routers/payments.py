"""
Payments router — integrates with localstripe (Stripe-compatible simulation).
Localstripe runs at http://localhost:8420.

NEW FLOW (escrow model):
  1. POST /api/payments/{shipment_id}/award-and-pay
     Shipper selects a bid AND pays in one step.
     - Charges shipper via localstripe (escrow held by platform)
     - Awards the bid (shipment → "assigned", driver notified)
     - Payment status = "escrow_held"
     Driver can now see the trip with "Payment Secured" badge.

  2. POST /api/payments/{shipment_id}/release
     Called automatically when shipment is delivered.
     - Marks payment status = "released_to_driver"
     - Driver's earnings are confirmed.

  3. GET /api/payments/{shipment_id}/status
     Returns payment status for shipper or driver.

LEGACY endpoints kept for backward compatibility:
  POST /create-intent  (now only used for already-delivered shipments)
  POST /pay
"""

import datetime
import requests as http
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Payment, Shipment, Bid, User
from ..auth_utils import get_current_user

router = APIRouter()

LOCALSTRIPE_URL = "http://localhost:8420"
STRIPE_KEY      = "sk_test_localstripe"
AUTH_HEADER     = {"Authorization": f"Bearer {STRIPE_KEY}"}


def _stripe_post(path: str, data: dict) -> dict:
    """POST to localstripe and return parsed JSON, raising on error."""
    try:
        resp = http.post(
            f"{LOCALSTRIPE_URL}{path}",
            data=data,
            headers=AUTH_HEADER,
            timeout=10
        )
    except http.exceptions.ConnectionError:
        raise HTTPException(
            503,
            "Payment service is unavailable. Make sure the localstripe Docker container "
            "is running: docker run -p 8420:8420 adrienverge/localstripe:latest"
        )
    except http.exceptions.Timeout:
        raise HTTPException(503, "Payment service timed out. Please try again.")

    body = resp.json()
    if not resp.ok:
        err = body.get("error", {})
        raise HTTPException(502, err.get("message", "Payment service error"))
    return body


# ─────────────────────────────────────────────────────────────
# 0. Get payment intent for award (step 1 of award-and-pay)
# POST /api/payments/{shipment_id}/award-intent
# Body: { bid_id } or {} for lowest bid
# Returns payment_intent_id + amount so frontend can show modal
# ─────────────────────────────────────────────────────────────
@router.post("/{shipment_id}/award-intent")
def create_award_intent(
    shipment_id: str,
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Step 1 of award flow: shipper selects a bid, we create a PaymentIntent.
    Shipment is NOT yet awarded — that happens only after payment succeeds.
    Returns: { payment_intent_id, amount, bid_id, driver_name }
    """
    user = get_current_user(authorization)
    if user["role"] != "shipper":
        raise HTTPException(403, "Only shippers can initiate payments")

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s:
        raise HTTPException(404, "Shipment not found")
    if s.shipper_id != user["sub"]:
        raise HTTPException(403, "Not your shipment")
    if s.status != "open":
        raise HTTPException(400, "Shipment is not open for bidding")

    # Resolve which bid to award
    bid_id = data.get("bid_id")
    if bid_id:
        winning_bid = db.query(Bid).filter(Bid.id == bid_id, Bid.shipment_id == shipment_id).first()
        if not winning_bid:
            raise HTTPException(404, "Bid not found for this shipment")
    else:
        winning_bid = db.query(Bid).filter(Bid.shipment_id == shipment_id).order_by(Bid.amount).first()
        if not winning_bid:
            raise HTTPException(400, "No bids placed yet")

    driver = db.query(User).filter(User.id == winning_bid.driver_id).first()
    amount_paise = max(50, int(winning_bid.amount * 100))

    intent = _stripe_post("/v1/payment_intents", {
        "amount":                    amount_paise,
        "currency":                  "inr",
        "payment_method_types[]":    "card",
        "metadata[shipment_id]":     shipment_id,
        "metadata[bid_id]":          winning_bid.id,
        "metadata[shipper_id]":      user["sub"],
    })

    # Save a pending payment record (not yet awarded)
    db.query(Payment).filter(
        Payment.shipment_id == shipment_id,
        Payment.status == "pending"
    ).delete()

    payment = Payment(
        shipment_id  = shipment_id,
        shipper_id   = user["sub"],
        driver_id    = winning_bid.driver_id,
        amount       = winning_bid.amount,
        currency     = "inr",
        stripe_pi_id = intent["id"],
        status       = "pending"
    )
    db.add(payment)
    db.commit()

    return {
        "payment_intent_id": intent["id"],
        "amount":            winning_bid.amount,
        "bid_id":            winning_bid.id,
        "driver_name":       driver.name if driver else "Unknown",
        "currency":          "inr"
    }


# ─────────────────────────────────────────────────────────────
# 1. Confirm payment + award shipment atomically
# POST /api/payments/{shipment_id}/award-and-pay
# Body: { payment_intent_id, bid_id, card_number, exp_month, exp_year, cvc }
# ─────────────────────────────────────────────────────────────
@router.post("/{shipment_id}/award-and-pay")
def award_and_pay(
    shipment_id: str,
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """
    Step 2: Shipper pays. On success, bid is awarded and shipment → 'assigned'.
    Driver can now see the trip with 'Payment Secured' badge.
    """
    user = get_current_user(authorization)
    if user["role"] != "shipper":
        raise HTTPException(403, "Only shippers can make payments")

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s or s.shipper_id != user["sub"]:
        raise HTTPException(403, "Not your shipment")
    if s.status != "open":
        raise HTTPException(400, "Shipment is no longer open")

    pi_id  = data.get("payment_intent_id", "").strip()
    bid_id = data.get("bid_id", "").strip()
    if not pi_id or not bid_id:
        raise HTTPException(400, "payment_intent_id and bid_id are required")

    card_number = str(data.get("card_number", "")).replace(" ", "")
    exp_month   = data.get("exp_month")
    exp_year    = data.get("exp_year")
    cvc         = str(data.get("cvc", "")).strip()

    if not all([card_number, exp_month, exp_year, cvc]):
        raise HTTPException(400, "Card details are required")

    # Find the pending payment record
    payment = db.query(Payment).filter(
        Payment.shipment_id  == shipment_id,
        Payment.stripe_pi_id == pi_id,
        Payment.status       == "pending"
    ).first()
    if not payment:
        raise HTTPException(404, "Payment record not found or already processed")

    # Find the bid
    winning_bid = db.query(Bid).filter(Bid.id == bid_id, Bid.shipment_id == shipment_id).first()
    if not winning_bid:
        raise HTTPException(404, "Bid not found")

    # Charge the shipper via localstripe
    pm = _stripe_post("/v1/payment_methods", {
        "type":              "card",
        "card[number]":      card_number,
        "card[exp_month]":   str(int(exp_month)),
        "card[exp_year]":    str(int(exp_year)),
        "card[cvc]":         cvc,
    })

    amount_paise = max(50, int(payment.amount * 100))
    intent = _stripe_post("/v1/payment_intents", {
        "amount":                 amount_paise,
        "currency":               "inr",
        "payment_method":         pm["id"],
        "confirm":                "true",
        "metadata[shipment_id]":  shipment_id,
        "metadata[bid_id]":       bid_id,
    })

    if intent.get("status") != "succeeded":
        payment.status = "failed"
        db.commit()
        raise HTTPException(402, f"Payment failed. Status: {intent.get('status', 'unknown')}")

    # Extract charge info
    charge_id = None
    latest = intent.get("latest_charge")
    if isinstance(latest, dict):
        charge_id = latest.get("id")
    elif isinstance(latest, str):
        charge_id = latest
    else:
        clist = intent.get("charges", {}).get("data", [])
        if clist:
            charge_id = clist[0].get("id")

    card_info = pm.get("card", {})

    # ── Payment succeeded — now award the bid atomically ──────
    winning_bid.is_winner           = True
    s.status                        = "assigned"
    s.assigned_driver_id            = winning_bid.driver_id
    s.winning_bid_amount            = winning_bid.amount

    # Update payment record — status = escrow_held (platform holds funds)
    payment.status           = "escrow_held"
    payment.stripe_pi_id     = intent["id"]
    payment.stripe_pm_id     = pm["id"]
    payment.stripe_charge_id = charge_id
    payment.card_last4       = card_info.get("last4")
    payment.card_brand       = card_info.get("brand")
    payment.paid_at          = datetime.datetime.utcnow()

    db.commit()

    driver = db.query(User).filter(User.id == winning_bid.driver_id).first()
    return {
        "message":      "Payment successful. Shipment awarded to driver.",
        "awarded_to":   driver.name if driver else "Unknown",
        "winning_amount": winning_bid.amount,
        "payment_id":   payment.id,
        "card_brand":   payment.card_brand,
        "card_last4":   payment.card_last4,
        "charge_id":    charge_id,
        "escrow_status": "held"
    }


# ─────────────────────────────────────────────────────────────
# 2. Release escrow to driver after delivery
# POST /api/payments/{shipment_id}/release
# Called automatically when shipment is delivered
# ─────────────────────────────────────────────────────────────
@router.post("/{shipment_id}/release")
def release_payment(
    shipment_id: str,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    """Mark escrow as released to driver after delivery confirmation."""
    user = get_current_user(authorization)

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s:
        raise HTTPException(404, "Shipment not found")
    if s.status != "delivered":
        raise HTTPException(400, "Shipment must be delivered before releasing payment")

    payment = db.query(Payment).filter(
        Payment.shipment_id == shipment_id,
        Payment.status == "escrow_held"
    ).first()
    if not payment:
        return {"message": "No escrow payment to release"}

    payment.status = "released_to_driver"
    db.commit()

    return {
        "message":  "Payment released to driver",
        "amount":   payment.amount,
        "driver_id": payment.driver_id
    }


# ─────────────────────────────────────────────────────────────
# 3. Get payment status
# GET /api/payments/{shipment_id}/status
# ─────────────────────────────────────────────────────────────
@router.get("/{shipment_id}/status")
def get_payment_status(
    shipment_id: str,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    user = get_current_user(authorization)

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s:
        raise HTTPException(404, "Shipment not found")

    if user["role"] == "shipper" and s.shipper_id != user["sub"]:
        raise HTTPException(403, "Not your shipment")
    if user["role"] == "driver" and s.assigned_driver_id != user["sub"]:
        raise HTTPException(403, "Not assigned to this shipment")
    payment = db.query(Payment).filter(
        Payment.shipment_id == shipment_id
    ).order_by(Payment.created_at.desc()).first()

    if not payment:
        return {"status": "not_initiated", "amount": s.winning_bid_amount}

    shipper = db.query(User).filter(User.id == payment.shipper_id).first()
    driver  = db.query(User).filter(User.id == payment.driver_id).first()

    return {
        "payment_id":    payment.id,
        "status":        payment.status,
        "amount":        payment.amount,
        "currency":      payment.currency,
        "card_brand":    payment.card_brand,
        "card_last4":    payment.card_last4,
        "charge_id":     payment.stripe_charge_id,
        "paid_at":       payment.paid_at.isoformat() if payment.paid_at else None,
        "created_at":    payment.created_at.isoformat(),
        "shipper_name":  shipper.name if shipper else None,
        "shipper_phone": shipper.phone if shipper else None,
        "driver_name":   driver.name if driver else None,
        "escrow_status": payment.status,
        "driver_fee":     payment.driver_fee,
        "shipper_refund": payment.shipper_refund,
    }


# ─────────────────────────────────────────────────────────────
# LEGACY: create-intent (kept for backward compat)
# ─────────────────────────────────────────────────────────────
@router.post("/{shipment_id}/create-intent")
def create_payment_intent(
    shipment_id: str,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    user = get_current_user(authorization)
    if user["role"] != "shipper":
        raise HTTPException(403, "Only shippers can initiate payments")

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s:
        raise HTTPException(404, "Shipment not found")
    if s.shipper_id != user["sub"]:
        raise HTTPException(403, "Not your shipment")
    if s.status not in ("delivered",):
        raise HTTPException(400, "Use /award-intent to pay at bid acceptance")
    if not s.winning_bid_amount:
        raise HTTPException(400, "No winning bid amount set")

    existing = db.query(Payment).filter(
        Payment.shipment_id == shipment_id,
        Payment.status.in_(["succeeded", "escrow_held", "released_to_driver"])
    ).first()
    if existing:
        raise HTTPException(400, "This shipment has already been paid")

    amount_paise = max(50, int(s.winning_bid_amount * 100))
    intent = _stripe_post("/v1/payment_intents", {
        "amount":                    amount_paise,
        "currency":                  "inr",
        "payment_method_types[]":    "card",
        "metadata[shipment_id]":     shipment_id,
        "metadata[shipper_id]":      user["sub"],
    })

    db.query(Payment).filter(
        Payment.shipment_id == shipment_id,
        Payment.status == "pending"
    ).delete()

    payment = Payment(
        shipment_id  = shipment_id,
        shipper_id   = user["sub"],
        driver_id    = s.assigned_driver_id,
        amount       = s.winning_bid_amount,
        currency     = "inr",
        stripe_pi_id = intent["id"],
        status       = "pending"
    )
    db.add(payment)
    db.commit()

    return {
        "payment_intent_id": intent["id"],
        "amount":            s.winning_bid_amount,
        "currency":          "inr",
        "status":            intent["status"]
    }


# ─────────────────────────────────────────────────────────────
# LEGACY: /pay (kept for backward compat)
# ─────────────────────────────────────────────────────────────
@router.post("/{shipment_id}/pay")
def confirm_payment(
    shipment_id: str,
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None)
):
    user = get_current_user(authorization)
    if user["role"] != "shipper":
        raise HTTPException(403, "Only shippers can make payments")

    s = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not s or s.shipper_id != user["sub"]:
        raise HTTPException(403, "Not your shipment")

    pi_id = data.get("payment_intent_id", "").strip()
    if not pi_id:
        raise HTTPException(400, "payment_intent_id is required")

    card_number = str(data.get("card_number", "")).replace(" ", "")
    exp_month   = data.get("exp_month")
    exp_year    = data.get("exp_year")
    cvc         = str(data.get("cvc", "")).strip()

    if not all([card_number, exp_month, exp_year, cvc]):
        raise HTTPException(400, "card_number, exp_month, exp_year and cvc are required")

    payment = db.query(Payment).filter(
        Payment.shipment_id  == shipment_id,
        Payment.stripe_pi_id == pi_id,
        Payment.status       == "pending"
    ).first()
    if not payment:
        raise HTTPException(404, "Payment record not found or already processed")

    pm = _stripe_post("/v1/payment_methods", {
        "type":              "card",
        "card[number]":      card_number,
        "card[exp_month]":   str(int(exp_month)),
        "card[exp_year]":    str(int(exp_year)),
        "card[cvc]":         cvc,
    })

    amount_paise = max(50, int(payment.amount * 100))
    intent = _stripe_post("/v1/payment_intents", {
        "amount":                 amount_paise,
        "currency":               "inr",
        "payment_method":         pm["id"],
        "confirm":                "true",
        "metadata[shipment_id]":  shipment_id,
    })

    if intent.get("status") != "succeeded":
        payment.status = "failed"
        db.commit()
        raise HTTPException(402, f"Payment not completed. Status: {intent.get('status', 'unknown')}")

    charge_id = None
    latest = intent.get("latest_charge")
    if isinstance(latest, dict):
        charge_id = latest.get("id")
    elif isinstance(latest, str):
        charge_id = latest
    else:
        clist = intent.get("charges", {}).get("data", [])
        if clist:
            charge_id = clist[0].get("id")

    card_info = pm.get("card", {})
    payment.status           = "succeeded"
    payment.stripe_pi_id     = intent["id"]
    payment.stripe_pm_id     = pm["id"]
    payment.stripe_charge_id = charge_id
    payment.card_last4       = card_info.get("last4")
    payment.card_brand       = card_info.get("brand")
    payment.paid_at          = datetime.datetime.utcnow()
    db.commit()

    return {
        "message":    "Payment successful",
        "payment_id": payment.id,
        "amount":     payment.amount,
        "currency":   "inr",
        "card_brand": payment.card_brand,
        "card_last4": payment.card_last4,
        "charge_id":  charge_id,
        "paid_at":    payment.paid_at.isoformat()
    }


