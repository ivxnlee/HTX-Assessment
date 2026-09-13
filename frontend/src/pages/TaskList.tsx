import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  STATUSES,
  getDevelopers,
  getTasks,
  updateTaskAssignee,
  updateTaskStatus,
  type Developer,
  type Status,
  type Task,
} from "../api";

/**
 * A developer may take a task only if they hold *every* skill it requires.
 * This mirrors the rule the backend enforces, so the dropdown never offers a
 * choice the server would reject.
 */
function isQualified(developer: Developer, task: Task) {
  const held = new Set(developer.skills.map((skill) => skill.id));
  return task.skills.every((skill) => held.has(skill.id));
}

/**
 * A task can be Done only once all its subtasks are. Checking direct children
 * is enough: each of them was held to the same rule before it could be Done.
 */
function canBeDone(task: Task) {
  return task.subtasks.every((subtask) => subtask.status === "Done");
}

/** Lists the tree depth-first, so each subtask's row sits under its parent's. */
function flatten(tasks: Task[], depth = 0): { task: Task; depth: number }[] {
  return tasks.flatMap((task) => [
    { task, depth },
    ...flatten(task.subtasks, depth + 1),
  ]);
}

/** Returns the tree with one task, found at any depth, patched. */
function patchTree(tasks: Task[], id: number, changes: Partial<Task>): Task[] {
  return tasks.map((task) =>
    task.id === id
      ? { ...task, ...changes }
      : { ...task, subtasks: patchTree(task.subtasks, id, changes) },
  );
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong";
}

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ids of rows with a change in flight; their dropdowns are disabled.
  const [saving, setSaving] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([getTasks(), getDevelopers()])
      .then(([loadedTasks, loadedDevelopers]) => {
        if (cancelled) return;
        setTasks(loadedTasks);
        setDevelopers(loadedDevelopers);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const patchTask = (id: number, changes: Partial<Task>) =>
    setTasks((current) => patchTree(current, id, changes));

  /**
   * Applies the change locally first so the dropdown reacts immediately, then
   * confirms it with the server and rolls back if the request fails.
   * Resolves to whether the server accepted it.
   */
  async function save(
    task: Task,
    changes: Partial<Task>,
    send: () => Promise<unknown>,
  ): Promise<boolean> {
    const rollback: Partial<Task> = {};
    // Copy the original values of the changed fields so they can be restored if the request fails.
    for (const key of Object.keys(changes) as (keyof Task)[]) {
      (rollback[key] as Task[keyof Task]) = task[key];
    }

    patchTask(task.id, changes);
    setSaving((ids) => [...ids, task.id]);
    setError(null);

    try {
      await send();
      return true;
    } catch (err) {
      patchTask(task.id, rollback);
      setError(errorMessage(err));
      return false;
    } finally {
      setSaving((ids) => ids.filter((id) => id !== task.id));
    }
  }

  async function changeStatus(task: Task, status: Status) {
    const saved = await save(task, { status }, () =>
      updateTaskStatus(task.id, status),
    );

    // Moving a subtask off Done makes the server reopen any Done ancestors, so
    // re-read the tree rather than re-implement that cascade here.
    if (saved && task.parent_id !== null) {
      getTasks()
        .then(setTasks)
        .catch((err) => setError(errorMessage(err)));
    }
  }

  const changeAssignee = (task: Task, developerId: number | null) => {
    const developer = developers.find((d) => d.id === developerId) ?? null;
    return save(
      task,
      {
        assignee_id: developer?.id ?? null,
        assignee_name: developer?.name ?? null,
      },
      () => updateTaskAssignee(task.id, developerId),
    );
  };

  return (
    <>
      <div className="toolbar">
        <h2>Tasks</h2>
        <Link className="button" to="/tasks/new">
          New Task
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <p className="muted">No tasks yet. Create one to get started.</p>
      ) : (
        <table className="tasks">
          <thead>
            <tr>
              <th>Title</th>
              <th>Skills</th>
              <th>Status</th>
              <th>Assignee</th>
            </tr>
          </thead>
          <tbody>
            {flatten(tasks).map(({ task, depth }) => {
              const busy = saving.includes(task.id);
              const qualified = developers.filter((d) => isQualified(d, task));
              const doneCount = task.subtasks.filter(
                (s) => s.status === "Done",
              ).length;

              return (
                <tr
                  key={task.id}
                  className={depth > 0 ? "subtask-row" : undefined}
                >
                  <td>
                    <div
                      className="title-cell"
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                    >
                      {depth > 0 && (
                        <span className="subtask-marker" aria-hidden="true">
                          ↳
                        </span>
                      )}
                      <span>
                        {task.title}
                        {task.subtasks.length > 0 && (
                          <span className="subtask-count">
                            {doneCount}/{task.subtasks.length} subtasks done
                          </span>
                        )}
                      </span>
                    </div>
                  </td>

                  <td>
                    {task.skills.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className="chips">
                        {task.skills.map((skill) => (
                          <span className="chip" key={skill.id}>
                            {skill.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>

                  <td>
                    <select
                      aria-label={`Status of ${task.title}`}
                      value={task.status}
                      disabled={busy}
                      onChange={(e) =>
                        changeStatus(task, e.target.value as Status)
                      }
                    >
                      {STATUSES.map((status) => {
                        const blocked = status === "Done" && !canBeDone(task);
                        return (
                          <option
                            key={status}
                            value={status}
                            disabled={blocked}
                          >
                            {blocked ? "Done (finish subtasks first)" : status}
                          </option>
                        );
                      })}
                    </select>
                  </td>

                  <td>
                    <select
                      aria-label={`Assignee of ${task.title}`}
                      value={task.assignee_id ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        changeAssignee(
                          task,
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                    >
                      <option value="">Unassigned</option>
                      {qualified.map((developer) => (
                        <option key={developer.id} value={developer.id}>
                          {developer.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
