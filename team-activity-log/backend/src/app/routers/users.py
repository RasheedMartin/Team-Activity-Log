from fastapi import APIRouter

from app.models import Users

router = APIRouter()


@router.get("/users", response_model=list[Users])
async def get_users():
    return [
  {
    "id": 1,
    "name": "Maya Chen",
    "initials": "MC",
    "color": "#f59e0b",
    "role": "Frontend",
  },
  {
    "id": 2,
    "name": "Jake Rivera",
    "initials": "JR",
    "color": "#818cf8",
    "role": "Backend",
  },
  {
    "id": 3,
    "name": "Priya Nair",
    "initials": "PN",
    "color": "#34d399",
    "role": "Design",
  },
  {
    "id": 4,
    "name": "Tom Walsh",
    "initials": "TW",
    "color": "#f87171",
    "role": "DevOps",
  },
  { "id": 5, "name": "Sara Kim", "initials": "SK", "color": "#f472b6", "role": "PM" },
]
