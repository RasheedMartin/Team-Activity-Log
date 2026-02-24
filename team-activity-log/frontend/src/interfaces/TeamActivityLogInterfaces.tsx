export interface UserData {
  id: number;
  name: string;
  initials: string;
  color: string;
  role: string;
}

export interface TagsType {
  label: string;
  color: string;
}

export interface CommentType {
  id: number;
  userId: number;
  postId: number;
  text: string;
  time: Date;
  parentId: number | null;
  replies: CommentType[];
}

export interface CommentRequestType {
  id: number;
  userId: number;
  postId: number;
  parentId: number;
  text: string;
  minsAgo: number;
  replies: CommentType[];
}

export type PartialComment = Partial<
  Omit<CommentRequestType, "id" | "userId" | "postId" | "text" | "parentId">
> & {
  id: number;
  userId: number;
  postId: number;
  parentId: number | null;
  text: string;
};

export type BlockType =
  | { type: "text"; html: string; position: number }
  | { type: "image"; src: string; caption?: string; position: number };

export interface PostType {
  id: number;
  userId: number;
  timestamp: Date;
  tags: string[];
  comments: CommentType[];
  blocks: BlockType[];
  title: string;
}

export interface PostRequest {
  title: string;
  blocks: BlockType[];
  tags: string[];
}

export type ComposerBlock =
  | { id: string; type: "text"; content: string }
  | { id: string; type: "image"; src: string };

export type OpenPanel =
  | "composer"
  | "stats"
  | "comments"
  | "posts"
  | "fullpost"
  | null;
