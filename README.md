# HTX Assessment Application

Full-stack task management with nested subtasks, skill-based developer assignment, and automatic skill classification via LLM.

Built for the HTX xDigital AI Products Team take-home test.

## Quick Start

Requires Docker Desktop and a Google Gemini API key ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)).

```bash
git clone https://github.com/ivxnlee/HTX-Assessment
cd HTX-Assessment

cp .env.example .env
# set GEMINI_API_KEY in .env

docker compose up --build
```

| Service  | URL                   |
| -------- | --------------------- |
| Frontend | http://localhost:8080 |
| Backend  | http://localhost:3001 |
| Postgres | localhost:5432        |

The database is created and seeded automatically on first start.

To stop: `docker compose down`. To stop and wipe data: `docker compose down -v`.

## Configuration

| Variable            | Required | Default                 | Purpose                                  |
| ------------------- | -------- | ----------------------- | ---------------------------------------- |
| `GEMINI_API_KEY`    | Yes      |                         | API key for skill classification         |
| `GEMINI_MODEL`      | No       | `gemini-3.5-flash-lite` | Model used for classification            |
| `POSTGRES_USER`     | No       | `app`                   | Database user                            |
| `POSTGRES_PASSWORD` | No       | `app`                   | Database password                        |
| `POSTGRES_DB`       | No       | `taskdb`                | Database name                            |
| `VITE_API_URL`      | No       | `http://localhost:3001` | API base URL, baked in at frontend build |

`.env` is git-ignored. `.env.example` documents every key.

Vite substitutes `VITE_*` variables at build time. Changing `VITE_API_URL` requires `docker compose up --build`, not just a restart.

## Architecture

```
frontend (React + Vite, nginx)  →  backend (Express + Node)  →  db (PostgreSQL)
                                            ↓
                                      Gemini API
```

Three containers on a shared Compose network. The frontend is a static SPA. All business logic lives in the backend, which is the only writer to the database.

Two hostnames reach the backend, depending on the caller. The backend reaches Postgres at `db:5432`, since `localhost` inside a container refers to that container. Browser JavaScript reaches the backend at `localhost:3001`, since it runs on the host.

`depends_on` alone only waits for a container to start. The `db` service defines a `pg_isready` healthcheck and the backend waits on `condition: service_healthy`, so it never boots against a database that is not yet accepting connections.

Both application images are multi-stage. Dependencies install in a builder stage and only compiled output reaches the runtime image. `package*.json` is copied before source so the `npm ci` layer stays cached.

## Database Schema

| Table              | Purpose                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `skills`           | Reference data. Seeded with Frontend and Backend.                   |
| `developers`       | Seeded with Alice, Bob, Carol, Dave.                                |
| `developer_skills` | Many-to-many between developers and skills.                         |
| `tasks`            | Tasks and subtasks. `parent_id` self-references; `NULL` means root. |
| `task_skills`      | Many-to-many between tasks and skills.                              |

Seed data:

| Developer | Skills            |
| --------- | ----------------- |
| Alice     | Frontend          |
| Bob       | Backend           |
| Carol     | Frontend, Backend |
| Dave      | Backend           |

Constraints:

- `status` is limited by a `CHECK` constraint to `To-do`, `In-progress`, `Done`.
- `tasks.parent_id` cascades on delete, so removing a task removes its subtree.
- `tasks.assignee_id` sets null on delete, so removing a developer unassigns their tasks.
- Join tables use composite primary keys, preventing duplicate pairs.
- `idx_tasks_parent` supports the subtask lookups that run on every status change.

`db/init/01-schema.sql` and `02-seed.sql` are mounted into the Postgres container's `docker-entrypoint-initdb.d` and run in filename order on first startup. Postgres runs them only when the data volume is empty, so applying a schema change requires `docker compose down -v` followed by `docker compose up --build`.

## API Reference

Base URL `http://localhost:3001`. All bodies are JSON. Errors return `{ "error": string }`, with validation failures adding a `details` array of field paths.

### `GET /api/tasks`

Returns all tasks as a nested tree. Root tasks are top-level entries; subtasks appear in each node's `subtasks` array.

```json
[
  {
    "id": 1,
    "parent_id": null,
    "title": "As a logged-in user, I want to update my profile information...",
    "status": "To-do",
    "assignee_id": 3,
    "assignee_name": "Carol",
    "skills": [
      { "id": 1, "name": "Frontend" },
      { "id": 2, "name": "Backend" }
    ],
    "subtasks": [
      {
        "id": 2,
        "parent_id": 1,
        "title": "As a user, I want a form to edit my display name.",
        "status": "To-do",
        "assignee_id": null,
        "assignee_name": null,
        "skills": [{ "id": 1, "name": "Frontend" }],
        "subtasks": []
      }
    ]
  }
]
```

### `POST /api/tasks`

Creates a task and any nested subtasks in one transaction.

```json
{
  "title": "As a visitor, I want to see a responsive homepage.",
  "skillIds": [1],
  "subtasks": [
    { "title": "As a visitor, I want the navigation to collapse on mobile." }
  ]
}
```

| Field      | Type     | Required | Notes                                 |
| ---------- | -------- | -------- | ------------------------------------- |
| `title`    | string   | Yes      | Trimmed, must be non-empty            |
| `skillIds` | number[] | No       | Omit to trigger LLM classification    |
| `subtasks` | Task[]   | No       | Same shape, recursively, to any depth |

Any node omitting `skillIds` or supplying an empty array is classified by the LLM. Nodes with explicit skills are left alone.

Returns `201` with `{ "id": 1 }`, or `400` on validation failure.

### `PATCH /api/tasks/:id/assignee`

```json
{ "developerId": 3 }
```

Pass `null` to unassign. The developer must hold every skill the task requires. Extra skills are permitted, which is why Carol qualifies for a Frontend-only task. A task with no required skills can be assigned to anyone.

Returns `200` with `{ "success": true }`, `400` if the developer lacks a required skill, or `404` if the task does not exist.

### `PATCH /api/tasks/:id/status`

```json
{ "status": "Done" }
```

Accepts `To-do`, `In-progress`, `Done`.

Setting `Done` is rejected if any direct subtask is not `Done`. Setting a non-Done status demotes any ancestor currently marked `Done` back to `In-progress`.

Returns `200` with `{ "success": true }`, `400` on invalid status or unfinished subtasks, or `404` if the task does not exist.

### `GET /api/developers`

```json
[{ "id": 1, "name": "Alice", "skills": [{ "id": 1, "name": "Frontend" }] }]
```

### `GET /api/skills`

```json
[
  { "id": 2, "name": "Backend" },
  { "id": 1, "name": "Frontend" }
]
```

### Manual testing

`backend/requests.http` holds a runnable request collection covering every endpoint and the negative cases. Open it in VS Code with the [REST Client extension](https://marketplace.visualstudio.com/items?itemName=humao.rest-client).

## Frontend

Two routes.

**Task List (`/`)** lists all tasks with title, skills, status, and assignee. Subtasks render recursively beneath their parent, indented by depth. The status dropdown calls `PATCH /api/tasks/:id/status` and surfaces the API error when the change is rejected. The assignee dropdown lists only developers holding every required skill, computed client-side from `GET /api/developers`.

**Task Creation (`/create`)** captures title and skills. Skills are optional. "Add Subtask" appends a nested component, and each nested component carries its own button, so trees of any depth are built on one page. The whole tree is submitted as a single request.

## LLM Integration

When a task or subtask is created without specified skills, the backend infers them from the title. There is no user-facing trigger.

| Title                                                              | Result              |
| ------------------------------------------------------------------ | ------------------- |
| "...see a responsive homepage...desktop and mobile devices"        | `Frontend`          |
| "...audit logs of all data access and modifications..."            | `Backend`           |
| "...update my profile information and upload a profile picture..." | `Frontend, Backend` |

The request supplies a `responseSchema` with `responseMimeType: "application/json"` and an `enum` restricting values to `Frontend` and `Backend`. The model cannot return prose, markdown fences, or an unrecognised skill name, which removes a class of parsing failures.

All unclassified nodes in a submission are sent in one indexed request rather than one request per node. This keeps deeply nested submissions inside free-tier per-minute rate limits and cuts latency.

The call runs before `BEGIN`, not inside the transaction. Classification takes one to several seconds, and holding a pooled database connection for that long would exhaust the pool under concurrency.

Classification failure is logged and swallowed. The task is created without skills rather than failing the request. A task with no skills can be assigned to any developer, so it stays usable.

## Dependencies

### Backend

| Package   | Reason                                                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `express` | HTTP routing. Version 5 forwards rejected promises to error middleware natively, removing the wrapper Express 4 needed.                                                                                                                         |
| `pg`      | Postgres driver, used directly rather than through an ORM. The skill-matching predicate, completion check, and ancestor cascade read more clearly as SQL, and the schema stays visible in one file.                                             |
| `zod`     | Runtime validation with types derived from the same schemas via `z.infer`. The deciding factor is the recursive subtask payload: `z.lazy` validates a tree of any depth and produces precise error paths such as `subtasks.0.subtasks.1.title`. |
| `cors`    | The frontend is served from a different origin in development.                                                                                                                                                                                  |
| `dotenv`  | Loads `.env` locally. In Docker the values come from Compose.                                                                                                                                                                                   |
| `tsx`     | Dev only. Runs TypeScript with watch mode, removing a build step from the edit-test loop.                                                                                                                                                       |

Not used: no Gemini SDK, since the integration is one POST and `fetch` is built into Node; no ORM or query builder; no logging framework.

### Frontend

| Package              | Reason                                                    |
| -------------------- | --------------------------------------------------------- |
| `react`, `react-dom` | Required by the brief.                                    |
| `vite`               | Dev server and build tooling with no extra configuration. |
| `react-router-dom`   | The brief specifies an SPA with two pages.                |

Not used: no UI component library. The wireframes describe a table and a form, which hand-written CSS covers without adding a dependency and a theme system.

nginx serves the built frontend. Its config includes a `try_files` fallback to `index.html`, without which refreshing on a client-side route returns 404.

## Design Decisions

**Subtasks use an adjacency list.** A subtask has the same properties as a task, so both live in `tasks` with a nullable `parent_id`. This supports any nesting depth without schema changes and keeps every operation uniform across levels.

**The Done rule checks direct children only.** Enforcing it at every node makes the whole-subtree property hold by induction, since a child can only be Done if all of its own children were Done.

**Reopening a subtask demotes completed ancestors.** The brief does not say what happens when a subtask leaves `Done` while its parent is `Done`. Leaving the parent `Done` would violate the stated rule, so ancestors are demoted to `In-progress` via a recursive Common Table Expression.

**Multi-statement writes are transactional.** Creating a task tree, and changing a status with its ancestor cascade, each run inside one `BEGIN`/`COMMIT` on a single pooled connection.

**Status values are `To-do`, `In-progress`, `Done`.** The brief gives the first and last followed by "etc". `In-progress` is the natural intermediate and the state a task falls back to when a subtask reopens.

**An empty `skillIds` array means "not specified".** The API cannot distinguish "no skills required" from "please infer", so omitted and empty behave identically.

## Known Limitations

- Task deletion is not exposed. The brief specifies create, read, and update only. Cascade behaviour is defined in the schema and would work if an endpoint were added.
- The frontend refetches the full tree after each mutation rather than patching local state. Simpler and correct, worth revisiting at larger volumes.
- Classification quality is bounded by the title alone. The prompt instructs the model to return no skills when a title is not a recognisable task, but ambiguous or nonsense titles may still classify inconsistently. A task with no skills is assignable to any developer.
- Free-tier Gemini quotas are per-project and set by Google. A sustained burst of task creation could exhaust the daily allowance, after which tasks are created without skills.
