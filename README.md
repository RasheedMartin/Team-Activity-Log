# Team Activity Log

A real-time team activity feed for logging daily work — what you shipped, fixed, or learned. Built with React, TipTap, and MUI, backed by a FastAPI server.

![Stack](https://img.shields.io/badge/React-18-blue?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript) ![MUI](https://img.shields.io/badge/MUI-5-007FFF?logo=mui) ![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi)

---

## Features

**Post Composer**

- Rich text editor powered by TipTap with full formatting toolbar
  - Bold, italic, underline, strikethrough, inline code
  - Bullet lists, ordered lists, blockquotes, code blocks
  - Undo / redo
- Attach images via file picker or paste from clipboard
- Draw freehand annotations directly in the composer (blank canvas)
- Tag posts with color-coded labels
- Posts serialize to an ordered `blocks[]` array preserving text/image sequence

**Image Annotator**

- 8 drawing tools: Pen, Line, Rectangle, Ellipse, Arrow, Text, Highlighter, Eraser
- Keyboard shortcuts: `P` `L` `R` `E` `A` `T` `H` `X`
- Color palette + opacity + brush size controls
- Undo per stroke, clear all
- Click any image in the composer or feed to annotate it in place

**Feed**

- Sequential block rendering — text and images appear in the order they were written
- Collapse long posts with a smooth expand/collapse toggle
- Emoji reactions with per-user toggle state
- Threaded comments with infinite nesting and per-comment emoji reactions
- Filter feed by team member, tag, or full-text search
- Click a recent comment in the sidebar to filter and scroll to that post

**Layout**

- Three-column layout: team/tag filters → feed → composer/stats/comments
- All three columns sticky with independent scroll
- Right panel sections (composer, today's stats, recent comments) collapse with accordion — only one open at a time

---

## Tech Stack

| Layer                 | Library                                                     |
| --------------------- | ----------------------------------------------------------- |
| UI framework          | [MUI v5](https://mui.com)                                   |
| Rich text editor      | [TipTap](https://tiptap.dev) + StarterKit + Image extension |
| State / data fetching | [TanStack Query v5](https://tanstack.com/query)             |
| Backend               | [FastAPI](https://fastapi.tiangolo.com)                     |
| Language              | TypeScript + Python                                         |
| Fonts                 | IBM Plex Sans, IBM Plex Mono                                |

---

## Project Structure

```
src/
├── api/
│   └── client.ts                     # apiFetch wrapper
├── pages/
│   └── TeamActivityLog.tsx           # Main page, state, query hooks
├── components/
│   └── TeamLog/
│       ├── PostCard.tsx              # Feed post with reactions, comments, annotator
│       ├── PostComposer.tsx          # TipTap editor, image handling, tag picker
│       ├── LeftPanel.tsx             # Team member + tag filters
│       ├── RightPanel.tsx            # Accordion: composer, stats, recent comments
│       ├── EditorToolbar.tsx         # TipTap formatting toolbar
│       ├── ImageAnnotator.tsx        # Canvas annotation modal
│       ├── CommentNode.tsx           # Recursive threaded comment tree
│       ├── ReplyBox.tsx              # Inline reply composer
│       ├── AvatarComponent.tsx       # User avatar with initials + color
│       ├── ActionButton.tsx          # Reusable action button
│       └── Tags.tsx                  # Tag chip component
├── interfaces/
│   └── TeamActivityLogInterfaces.tsx # TypeScript types
└── utilities/
    └── TeamLogsUtilities.ts          # MUI theme, helpers, sBtn style
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+

### Frontend

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Runs on `http://localhost:5173`.

### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install fastapi uvicorn pydantic

# Start server
uvicorn app.main:app --reload
```

Runs on `http://127.0.0.1:8000`.

### Environment

Create a `.env` file in the project root:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Update `src/api/client.ts` to use `import.meta.env.VITE_API_BASE_URL`.

---

## Data Model

Posts use a sequential `blocks` array instead of separate `content` + `images` fields, preserving the order text and images were written:

```typescript
type Block =
  | { type: "text"; html: string; position: number }
  | { type: "image"; src: string; position: number; caption?: string };

interface Post {
  id: number;
  userId: number;
  timestamp: Date;
  tags: string[];
  reactions: Record<string, number[]>; // emoji → [userId]
  comments: Comment[];
  blocks: Block[];
}
```

### Backend (Pydantic)

```python
class TextBlock(BaseModel):
    type: Literal["text"]
    html: str
    position: int

class ImageBlock(BaseModel):
    type: Literal["image"]
    src: str
    position: int
    caption: str | None = None

Block = Annotated[Union[TextBlock, ImageBlock], Field(discriminator="type")]

class Post(BaseModel):
    id: int
    userId: int
    timestamp: datetime
    tags: list[str]
    reactions: dict[str, list[int]]
    comments: list[Comment]
    blocks: list[Block]
```

---

## API Endpoints

| Method | Path     | Description    |
| ------ | -------- | -------------- |
| `GET`  | `/posts` | List all posts |
| `GET`  | `/users` | List all users |
| `GET`  | `/tags`  | List all tags  |

---

## Keyboard Shortcuts

These apply when the image annotator is open:

| Key      | Tool             |
| -------- | ---------------- |
| `P`      | Pen              |
| `L`      | Line             |
| `R`      | Rectangle        |
| `E`      | Ellipse          |
| `A`      | Arrow            |
| `T`      | Text             |
| `H`      | Highlighter      |
| `X`      | Eraser           |
| `Ctrl+Z` | Undo last stroke |
