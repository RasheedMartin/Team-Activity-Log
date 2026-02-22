import { Avatar } from "@mui/material";
import type { UserData } from "../interfaces/TeamActivityLogInterfaces";

export interface AvatarProps {
  user?: UserData;
  size: number;
}

// Creation of Avatar
export const Av = ({ user, size = 32 }: AvatarProps) => (
  <Avatar
    sx={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: user?.color ?? null,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: size * 0.3,
      fontWeight: 700,
      color: "#000",
      flexShrink: 0,
      fontFamily: "monospace",
      userSelect: "none",
    }}
  >
    {user && user?.initials}
  </Avatar>
);
