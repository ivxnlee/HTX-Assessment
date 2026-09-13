const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/* ---------------------------------------------------------------- types --- */

export const STATUSES = ["To-do", "In-progress", "Done"] as const;
export type Status = (typeof STATUSES)[number];

export type Skill = {
  id: number;
  name: string;
};

export type Developer = {
  id: number;
  name: string;
  skills: Skill[];
};

/** GET /api/tasks returns top-level tasks, each nesting its subtasks. */
export type Task = {
  id: number;
  parent_id: number | null;
  title: string;
  status: Status;
  assignee_id: number | null;
  assignee_name: string | null;
  skills: Skill[];
  subtasks: Task[];
};

/** POST /api/tasks body: a task and, recursively, the subtasks to create with it. */
export type NewTask = {
  title: string;
  skillIds: number[];
  subtasks: NewTask[];
};

/* --------------------------------------------------------------- errors --- */

/** The backend's error body: { error } plus { details } on validation failures. */
type ApiErrorBody = {
  error?: string;
  details?: { path: string; message: string }[];
};

/**
 * Thrown for any non-2xx response, with the HTTP status attached
 * so callers can tell a client error from a server error.
 */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message); // hands the message to Error's constructor, which sets .message and captures the stack.
    this.name = "ApiError";
    this.status = status;
  }
}

/* -------------------------------------------------------------- request --- */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    // fetch only rejects when the request never reached the server.
    throw new ApiError("Cannot reach the server", 0);
  }

  if (!response.ok) {
    // An error response should be JSON, but a crash or a proxy can return HTML,
    // so a failed parse must not mask the real status code.
    const body: ApiErrorBody = await response.json().catch(() => ({}));
    const detail = body.details?.map((d) => d.message).join(", ");
    throw new ApiError(
      detail || body.error || `Request failed (${response.status})`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

/* ------------------------------------------------------------ endpoints --- */

export const getTasks = () => request<Task[]>("/api/tasks");

export const getDevelopers = () => request<Developer[]>("/api/developers");

export const getSkills = () => request<Skill[]>("/api/skills");

/** Creates the whole tree in one transaction; resolves to the top-level task's id. */
export const createTask = (task: NewTask) =>
  request<{ id: number }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });

export const updateTaskStatus = (taskId: number, status: Status) =>
  request<{ success: true }>(`/api/tasks/${taskId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

/** `developerId: null` unassigns the task. */
export const updateTaskAssignee = (
  taskId: number,
  developerId: number | null,
) =>
  request<{ success: true }>(`/api/tasks/${taskId}/assignee`, {
    method: "PATCH",
    body: JSON.stringify({ developerId }),
  });
