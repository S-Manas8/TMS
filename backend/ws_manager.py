import asyncio
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, Set

# Simple in-memory manager for WebSocket connections per shipment
class ShipmentWebSocketManager:
    def __init__(self) -> None:
        # Mapping of shipment_id -> set of active WebSocket connections
        self.connections: Dict[str, Set[WebSocket]] = {}
        # Lock to protect concurrent modifications
        self._lock = asyncio.Lock()

    async def connect(self, shipment_id: str, websocket: WebSocket) -> None:
        """Accept a WebSocket connection and register it for a shipment."""
        await websocket.accept()
        async with self._lock:
            if shipment_id not in self.connections:
                self.connections[shipment_id] = set()
            self.connections[shipment_id].add(websocket)

    async def disconnect(self, shipment_id: str, websocket: WebSocket) -> None:
        """Remove a WebSocket from the registry when the client disconnects."""
        async with self._lock:
            if shipment_id in self.connections:
                self.connections[shipment_id].discard(websocket)
                if not self.connections[shipment_id]:
                    # Clean up empty entry
                    del self.connections[shipment_id]

    async def broadcast(self, shipment_id: str, message: dict) -> None:
        """Send a JSON message to all clients listening to the given shipment.

        If a connection raises an exception (e.g., closed), it is removed.
        """
        async with self._lock:
            sockets = list(self.connections.get(shipment_id, []))
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception:
                # Remove problematic socket
                await self.disconnect(shipment_id, ws)

# Global manager instance used across the application
ws_manager = ShipmentWebSocketManager()

# Helper function used by the tracking router
async def broadcast_shipment(shipment_id: str, data: dict) -> None:
    """Public API for broadcasting shipment updates.

    The tracking router calls this after persisting a location event.
    """
    await ws_manager.broadcast(shipment_id, data)

# Optional WebSocket endpoint (can be mounted elsewhere if needed)
# Example usage in a FastAPI app:
#
# from fastapi import APIRouter
# router = APIRouter()
#
# @router.websocket("/ws/shipments/{shipment_id}")
# async def shipment_ws(websocket: WebSocket, shipment_id: str):
#     await ws_manager.connect(shipment_id, websocket)
#     try:
#         while True:
#             # Keep the connection open; optionally receive messages
#             await websocket.receive_text()
#     except WebSocketDisconnect:
#         await ws_manager.disconnect(shipment_id, websocket)
