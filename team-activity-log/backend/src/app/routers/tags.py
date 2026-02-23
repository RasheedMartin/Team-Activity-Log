from fastapi import APIRouter

from ..models import Tags

router = APIRouter()


@router.get("/tags", response_model=list[Tags])
async def get_tags():
    return [
  { "label": "frontend", "color": "#3b82f6" },
  { "label": "backend", "color": "#8b5cf6" },
  { "label": "design", "color": "#ec4899" },
  { "label": "bug", "color": "#ef4444" },
  { "label": "feature", "color": "#10b981" },
  { "label": "infra", "color": "#f59e0b" },
  { "label": "docs", "color": "#06b6d4" },
  { "label": "review", "color": "#f97316" },
  { "label": "deploy", "color": "#84cc16" },
  { "label": "urgent", "color": "#ef4444" },
]