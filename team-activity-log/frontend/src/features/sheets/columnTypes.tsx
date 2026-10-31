import { CalendarTodayOutlined, CategoryOutlined, NumbersRounded, SubjectRounded } from "@mui/icons-material";
import type { ReactNode } from "react";
import type { SheetColumn } from "../../api/contract";

// How each column type looks in the grid and its menus.

export const WIDTH: Record<SheetColumn["type"], number> = { number: 130, date: 130, category: 170, text: 240 };
export const TYPE_ICON: Record<SheetColumn["type"], ReactNode> = {
  number: <NumbersRounded sx={{ fontSize: 14 }} />,
  date: <CalendarTodayOutlined sx={{ fontSize: 13 }} />,
  category: <CategoryOutlined sx={{ fontSize: 14 }} />,
  text: <SubjectRounded sx={{ fontSize: 14 }} />,
};
export const TYPE_NAME: Record<SheetColumn["type"], string> = { number: "Numbers", date: "Dates", category: "Categories", text: "Text" };

