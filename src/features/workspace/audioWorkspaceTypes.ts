import type { Dispatch, SetStateAction } from "react";

export type ActiveView = "editor" | "settings" | "listening-guide";
export type SetActiveView = Dispatch<SetStateAction<ActiveView>>;
