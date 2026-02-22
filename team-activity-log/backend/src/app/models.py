from datetime import datetime
from typing import Annotated, Dict, List, Literal, Union

from pydantic import BaseModel, Field


class Users(BaseModel):
  id: int
  name: str
  initials: str
  color: str
  role: str

class Tags(BaseModel):
  label: str
  color: str


class Comments(BaseModel):
  id: int
  userId: int
  text: str
  time: datetime
  replies: List["Comments"] = []
  postId: int
  parentId: int | None = None

Comments.update_forward_refs()  # Required for recursive models
class TextBlock(BaseModel):
    type: Literal["text"]
    html: str
    position: int


class ImageBlock(BaseModel):
    type: Literal["image"]
    src: str
    caption: str | None = None
    position: int


Block = Annotated[
    Union[TextBlock, ImageBlock],
    Field(discriminator="type")
]

class Posts(BaseModel):
    id: int
    userId: int
    timestamp: datetime
    tags: List[str]
    reactions: Dict[str, List[int]]
    comments: List[Comments]
    blocks: List[Block]              

CommentReactions = Dict[int, Dict[int, Dict[str, List[int]]]]

class PostRequest(BaseModel):
    blocks: List[Block]         
    tags: List[str]


