from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.posts import router as posts_router
from app.routers.tags import router as tags_router
from app.routers.users import router as user_router

app = FastAPI(title="Team Activity Log API")

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(user_router)
app.include_router(tags_router)
app.include_router(posts_router)

@app.get("/")
def health_check():
    return {"status": "ok"}
