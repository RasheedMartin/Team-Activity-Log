import { createContext, useContext } from "react";

/** Show a quiet message, optionally with Undo (§A4 "undo instead of confirm"). */
export type Notify = (message: string, undo?: () => void) => void;
export const NotifyContext = createContext<Notify>(() => {});
export const useNotify = () => useContext(NotifyContext);
