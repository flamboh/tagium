import type { Dispatch, SetStateAction } from "react";

export type ActiveView = "editor" | "settings";
export type SetActiveView = Dispatch<SetStateAction<ActiveView>>;
