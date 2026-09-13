import type { NewTask } from "./api";

/**
 * A task being edited on the creation page. It mirrors NewTask plus a `key`:
 * subtasks can be added and removed in any order, so React needs an identity
 * that is stable across renders — an array index would shift on removal and
 * hand one subtask's input state to its neighbour.
 */
export type TaskDraft = {
  key: number;
  title: string;
  skillIds: number[];
  subtasks: TaskDraft[];
};

let nextKey = 0;

export const emptyDraft = (): TaskDraft => ({
  key: nextKey++,
  title: "",
  skillIds: [],
  subtasks: [],
});

/** Strips editor-only fields to produce the POST body. */
export const toNewTask = (draft: TaskDraft): NewTask => ({
  title: draft.title.trim(),
  skillIds: draft.skillIds,
  subtasks: draft.subtasks.map(toNewTask),
});

export const hasBlankTitle = (draft: TaskDraft): boolean =>
  !draft.title.trim() || draft.subtasks.some(hasBlankTitle);
