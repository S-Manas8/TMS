from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import bcrypt
from database import get_db
from models import User
from auth_utils import create_token

router = APIRouter()

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))


def validate_phone(phone: str):
    if not phone:
        return
    if len(phone) != 10:
        raise HTTPException(400, "not a valid number,phone number must contain 10 digits")
    if not phone.isdigit():
        raise HTTPException(400, "not a valid number,phone number must contain digits only")
    if phone[0] in "012345":
        raise HTTPException(400, "not a valid number,phone number should not start with 0-5")

import re

def validate_email(email: str):
    if not email:
        raise HTTPException(400, "Email is required")
    if len(email) > 320:
        raise HTTPException(400, "Email must not exceed 320 characters")
    
    parts = email.split('@')
    if len(parts) != 2:
        raise HTTPException(400, "Email must contain exactly one @ symbol")
    
    local, domain = parts
    if not (1 <= len(local) <= 64):
        raise HTTPException(400, "Local part must be 1-64 characters")
    if not (1 <= len(domain) <= 255):
        raise HTTPException(400, "Domain part must be 1-255 characters")
    
    # Character restrictions: alphanumeric and specific symbols (., -, _)
    if not re.match(r"^[a-zA-Z0-9._-]+$", local):
        raise HTTPException(400, "Email contains invalid characters")
    if not re.match(r"^[a-zA-Z0-9.-]+$", domain):
        raise HTTPException(400, "Domain contains invalid characters")
    
    # Dot rules
    if local.startswith('.') or local.endswith('.'):
        raise HTTPException(400, "Email cannot start or end with a dot")
    if '..' in local:
        raise HTTPException(400, "Email cannot contain consecutive dots")
    
    # Domain TLD check
    if '.' not in domain or not re.search(r"\.[a-zA-Z]{2,}$", domain):
        raise HTTPException(400, "Domain must have a valid Top-Level Domain (e.g., .com)")

@router.post("/register")
def register(data: dict, db: Session = Depends(get_db)):
    """
    Register a new user.
    Body: { name, email, password, role, phone }
    role must be "shipper" or "driver"
    """
    if data.get("role") not in ["shipper", "driver"]:
        raise HTTPException(400, "role must be 'shipper' or 'driver'")

    email = data.get("email", "").strip().lower()
    validate_email(email)
    phone = data.get("phone", "").strip()
    validate_phone(phone)

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "Email already registered")

    user = User(
        name=data["name"].strip(),
        email=email,
        password=hash_password(data["password"]),
        role=data["role"],
        phone=phone
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_token(user.id, user.role)
    return {
        "message": "Registered successfully",
        "token": token,
        "role": user.role,
        "name": user.name,
        "id": user.id
    }


@router.post("/login")
def login(data: dict, db: Session = Depends(get_db)):
    """
    Login with email + password.
    Body: { email, password }
    Returns JWT token + role for frontend routing.
    """
    identifier = data.get("email", "").strip()
    password = data.get("password")

    # If identifier looks like a phone number, try to find by phone
    user = None
    if identifier.isdigit() and len(identifier) == 10:
        validate_phone(identifier)
        user = db.query(User).filter(User.phone == identifier).first()
    
    if not user:
        # Fallback to email (case-insensitive)
        email_to_check = identifier.lower()
        if not email_to_check.isdigit():
            try:
                validate_email(email_to_check)
            except:
                pass # allow partial match if it doesn't look like email but was stored as one
        user = db.query(User).filter(User.email == email_to_check).first()

    if not user or not verify_password(password, user.password):
        raise HTTPException(401, "Invalid email, phone or password")

    token = create_token(user.id, user.role)
    return {
        "token": token,
        "role": user.role,
        "name": user.name,
        "id": user.id
    }