import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { validate } from "./validate.js";
import {
  idParam,
  createTaskBody,
  assigneeBody,
  statusBody,
  type IdParam,
  type CreateTaskBody,
  type AssigneeBody,
  type StatusBody,
} from "./schemas.js";
import type { ErrorRequestHandler } from "express";

const app = express();
app.use(cors());
app.use(express.json());

// Read Tasks
app.get("/api/tasks", async (_req, res) => {
  const result = await pool.query(`
    SELECT t.id, t.title, t.status, t.assignee_id,
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
    ORDER BY t.created_at
  `);
  res.json(result.rows);
});

// Create Task
app.post("/api/tasks", validate({ body: createTaskBody }), async (req, res) => {
  const { title, skillIds } = req.body as CreateTaskBody;

  const client = await pool.connect(); // Get a client from the pool for transaction
  try {
    await client.query("BEGIN"); // Start transaction

    const { rows } = await client.query(
      "INSERT INTO tasks (title) VALUES ($1) RETURNING id",
      [title],
    );
    const taskId = rows[0].id;

    for (const skillId of skillIds) {
      await client.query(
        "INSERT INTO task_skills (task_id, skill_id) VALUES ($1, $2)",
        [taskId, skillId],
      );
    }

    await client.query("COMMIT"); // Commit transaction
    res.status(201).json({ id: taskId });
  } catch (err) {
    console.error(err);
    await client.query("ROLLBACK"); // Rollback transaction on error
    res.status(500).json({ error: "Failed to create task" });
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

    const result = await pool.query(
      "UPDATE tasks SET status = $1 WHERE id = $2",
      [status, taskId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    res.json({ success: true });
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
