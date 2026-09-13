import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { validate } from "./validate.js";
import { classifyTitles } from "./llm.js";
import {
  idParam,
  createTaskBody,
  assigneeBody,
  statusBody,
  type IdParam,
  type CreateTaskBody,
  type AssigneeBody,
  type StatusBody,
  type TaskRow,
  type TaskNode,
} from "./schemas.js";
import type { ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";

const app = express();
app.use(cors());
app.use(express.json());

// Depth-first walk collecting nodes with no user-specified skills
function collectUnclassified(node: CreateTaskBody, acc: CreateTaskBody[] = []) {
  if (!node.skillIds || node.skillIds.length === 0) acc.push(node);
  for (const child of node.subtasks ?? []) collectUnclassified(child, acc);
  return acc;
}

// Build a tree of tasks from a flat list of rows.
function buildTree(rows: TaskRow[]): TaskNode[] {
  const byId = new Map(
    rows.map((r) => [r.id, { ...r, subtasks: [] as TaskNode[] }]),
  );
  const roots: TaskNode[] = [];

  for (const node of byId.values()) {
    if (node.parent_id === null) {
      roots.push(node);
    } else {
      byId.get(node.parent_id)?.subtasks.push(node);
    }
  }

  return roots;
}

// Read Tasks
app.get("/api/tasks", async (_req, res) => {
  const result = await pool.query<TaskRow>(`
    SELECT t.id, t.parent_id, t.title, t.status, t.assignee_id,
    d.name AS assignee_name,
    COALESCE(
      json_agg(json_build_object('id', s.id, 'name', s.name))
        FILTER (WHERE s.id IS NOT NULL),
      '[]'
    ) AS skills
    FROM tasks t
    LEFT JOIN developers d ON d.id = t.assignee_id
    LEFT JOIN task_skills ts ON ts.task_id = t.id
    LEFT JOIN skills s ON s.id = ts.skill_id
    GROUP BY t.id, d.name
    ORDER BY t.created_at, t.id
  `);
  res.json(buildTree(result.rows));
});

// Insert a task and its subtasks recursively, along with their associated skills.
async function insertTask(
  client: PoolClient,
  input: CreateTaskBody,
  parentId: number | null,
): Promise<number> {
  const { rows } = await client.query(
    "INSERT INTO tasks (title, parent_id) VALUES ($1, $2) RETURNING id",
    [input.title, parentId],
  );
  const taskId = rows[0].id;

  for (const skillId of input.skillIds) {
    await client.query(
      "INSERT INTO task_skills (task_id, skill_id) VALUES ($1, $2)",
      [taskId, skillId],
    );
  }

  for (const child of input.subtasks) {
    await insertTask(client, child, taskId);
  }

  return taskId;
}

// Create Task
app.post("/api/tasks", validate({ body: createTaskBody }), async (req, res) => {
  const input = req.body as CreateTaskBody;

  const pending = collectUnclassified(input);

  // If there are any tasks without user-specified skills, classify them using the LLM.
  if (pending.length > 0) {
    try {
      const { rows } = await pool.query<{ id: number; name: string }>(
        "SELECT id, name FROM skills",
      );
      const skillIdByName = new Map(rows.map((r) => [r.name, r.id]));

      const classified = await classifyTitles(pending.map((n) => n.title));

      for (const [index, names] of classified) {
        const node = pending[index];
        if (!node) continue;

        node.skillIds = names
          .map((n) => skillIdByName.get(n))
          .filter((id): id is number => id !== undefined);
      }
    } catch (err) {
      console.error(
        "Skill classification failed, creating without skills:",
        err,
      );
    }
  }

  const client = await pool.connect(); // Get a client from the pool for transaction
  try {
    await client.query("BEGIN"); // Start transaction
    const taskId = await insertTask(client, input, null);
    await client.query("COMMIT"); // Commit transaction

    res.status(201).json({ id: taskId });
  } catch (err) {
    await client.query("ROLLBACK"); // Rollback transaction on error
    throw err; // Let the error handling middleware handle the response
  } finally {
    client.release(); // Release the client back to the pool
  }
});

// Update Task - Assign Developer
app.patch(
  "/api/tasks/:id/assignee",
  validate({ params: idParam, body: assigneeBody }),
  async (req, res) => {
    const { id: taskId } = res.locals.params as IdParam;
    const { developerId } = req.body as AssigneeBody;

    // If developerId is null, unassign the task
    if (developerId === null) {
      const result = await pool.query(
        "UPDATE tasks SET assignee_id = NULL WHERE id = $1",
        [taskId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Task not found" });
      }
      return res.json({ success: true });
    }

    // Check if the developer has all the skills required by the task.
    // Selecting FROM tasks means no row comes back when the task does not exist.
    const { rows } = await pool.query(
      `SELECT NOT EXISTS (
         SELECT 1 FROM task_skills ts
         WHERE ts.task_id = t.id
           AND ts.skill_id NOT IN (
             SELECT skill_id FROM developer_skills WHERE developer_id = $2
           )
       ) AS qualified
       FROM tasks t
       WHERE t.id = $1`,
      [taskId, developerId],
    );

    // If no row came back, the task does not exist
    if (rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    // If the developer lacks any required skills, return an error
    if (!rows[0].qualified) {
      return res.status(400).json({
        error: "Developer lacks the skills required by this task",
      });
    }

    // If the developer has all required skills, assign them to the task
    const result = await pool.query(
      "UPDATE tasks SET assignee_id = $1 WHERE id = $2",
      [developerId, taskId],
    );

    // Catch if task was deleted between two queries
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    res.json({ success: true });
  },
);

// Update Task - Change Status
app.patch(
  "/api/tasks/:id/status",
  validate({ params: idParam, body: statusBody }),
  async (req, res) => {
    const { id: taskId } = res.locals.params as IdParam;
    const { status } = req.body as StatusBody;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (status === "Done") {
        // Lock the subtasks so none can change status until this transaction ends.
        const { rows: subtasks } = await client.query<{ status: string }>(
          "SELECT status FROM tasks WHERE parent_id = $1 FOR UPDATE",
          [taskId],
        );

        if (subtasks.some((s) => s.status !== "Done")) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: "All subtasks must be Done before this task can be Done",
          });
        }
      }

      const result = await client.query(
        "UPDATE tasks SET status = $1 WHERE id = $2",
        [status, taskId],
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Task not found" });
      }

      // Moving away from Done invalidates any completed ancestor
      if (status !== "Done") {
        await client.query(
          `WITH RECURSIVE ancestors AS (
             SELECT parent_id FROM tasks WHERE id = $1
             UNION
             SELECT t.parent_id FROM tasks t
             JOIN ancestors a ON t.id = a.parent_id
           )
           UPDATE tasks SET status = 'In-progress'
           WHERE id IN (SELECT parent_id FROM ancestors WHERE parent_id IS NOT NULL)
             AND status = 'Done'`,
          [taskId],
        );
      }

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
);

// Get Developer properties and aggregated skills for each developer using JSON aggregation functions in PostgreSQL.
app.get("/api/developers", async (_req, res) => {
  const result = await pool.query(`
    SELECT d.id, d.name,
           COALESCE(
             json_agg(json_build_object('id', s.id, 'name', s.name))
               FILTER (WHERE s.id IS NOT NULL),
             '[]'
           ) AS skills
    FROM developers d
    LEFT JOIN developer_skills ds ON ds.developer_id = d.id
    LEFT JOIN skills s ON s.id = ds.skill_id
    GROUP BY d.id
    ORDER BY d.name
  `);
  res.json(result.rows);
});

// Get Skills
app.get("/api/skills", async (_req, res) => {
  const result = await pool.query("SELECT id, name FROM skills ORDER BY name");
  res.json(result.rows);
});

// Error handling middleware
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Malformed JSON in request body" });
  }

  if (err.code === "23503") {
    return res.status(400).json({ error: "Referenced record does not exist" });
  }
  if (err.code === "23514") {
    return res
      .status(400)
      .json({ error: "Value violates a database constraint" });
  }

  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

const port = process.env.PORT ?? 3001;
app.listen(port, () => console.log(`API on http://localhost:${port}`));
