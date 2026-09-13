import { z } from "zod";

// Route params arrive as strings, so coerce then validate. This makes
// /api/tasks/abc fail at the schema instead of reaching Postgres as NaN.
export const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const createTaskBody: z.ZodType<CreateTaskBody> = z.lazy(() =>
  z.object({
    title: z.string().trim().min(1, "Title is required"),
    skillIds: z.array(z.number().int().positive()).default([]),
    subtasks: z.array(createTaskBody).default([]),
  }),
);

export const assigneeBody = z.object({
  // null means "unassign"
  developerId: z.number().int().positive().nullable(),
});

export const statusBody = z.object({
  status: z.enum(["To-do", "In-progress", "Done"]),
});

// One definition, both jobs: the types come from the schemas, so validation
// and types cannot drift apart.
export type IdParam = z.infer<typeof idParam>;
export type CreateTaskBody = {
  title: string;
  skillIds: number[];
  subtasks: CreateTaskBody[];
};
export type AssigneeBody = z.infer<typeof assigneeBody>;
export type StatusBody = z.infer<typeof statusBody>;
type Skill = { id: number; name: string };
export type TaskRow = {
  id: number;
  parent_id: number | null;
  title: string;
  status: string;
  assignee_id: number | null;
  assignee_name: string | null;
  skills: Skill[];
};
export type TaskNode = TaskRow & { subtasks: TaskNode[] };
