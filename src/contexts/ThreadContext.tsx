/**
 * ThreadCtx — React context for the thread tree.
 *
 * Kept in its own file so that fast-refresh works correctly: a file that
 * exports both a context and components would trigger the
 * react-refresh/only-export-components warning.
 */
import { createContext } from "react";
import type { ThreadContext } from "@/components/EventThreadComponents";

export const ThreadCtx = createContext<ThreadContext | null>(null);
