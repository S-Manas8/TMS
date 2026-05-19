content = open('backend/routers/shipments.py', encoding='utf-8').read()

# Remove ws_manager import
content = content.replace('from ws_manager import broadcast_shipment\n', '', 1)

# Remove background_tasks parameter and broadcast call from update_status
# Find and fix the update_status function signature
content = content.replace(
    'def update_status(\n    shipment_id: str,\n    data: dict,\n    background_tasks: BackgroundTasks,\n    db: Session = Depends(get_db),',
    'def update_status(\n    shipment_id: str,\n    data: dict,\n    db: Session = Depends(get_db),',
    1
)

# Remove BackgroundTasks import if present
content = content.replace('from fastapi import APIRouter, Depends, HTTPException, Header, BackgroundTasks\n',
                          'from fastapi import APIRouter, Depends, HTTPException, Header\n', 1)

# Remove broadcast_tasks call block
import re
content = re.sub(
    r'\s*background_tasks\.add_task\(\s*broadcast_shipment,\s*[^)]+\)',
    '',
    content
)

open('backend/routers/shipments.py', 'w', encoding='utf-8').write(content)
print("Fixed shipments.py")

# Verify syntax
import ast
try:
    ast.parse(content)
    print("Syntax OK")
except SyntaxError as e:
    print("Syntax ERROR:", e)
