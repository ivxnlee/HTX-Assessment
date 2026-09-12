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
  const developerSkillIds = new Set(developer.skills.map((skill) => skill.id));

  // Returns true if every skill required by the task is in the developer's skill set
  // or skill array is empty (no skills required).
  return task.skills.every((requiredSkill) =>
    developerSkillIds.has(requiredSkill.id),
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
    let cancelled = false; // To avoid setting state on an unmounted component.

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
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...changes } : task)),
    );

  /**
   * Applies the change locally first so the dropdown reacts immediately, then
   * confirms it with the server and rolls back if the request fails.
   */
  async function save(
    task: Task,
    changes: Partial<Task>,
    send: () => Promise<unknown>,
  ) {
    // Save the previous values for any fields being changed. If the backend rejects
    // the update, we restore these values so the UI matches the last known good state.
    const rollback: Partial<Task> = {};

    if (changes.status !== undefined) {
      rollback.status = task.status;
    }

    if (changes.assignee_id !== undefined) {
      rollback.assignee_id = task.assignee_id;
    }

    if (changes.assignee_name !== undefined) {
      rollback.assignee_name = task.assignee_name;
    }

    // Update the local task immediately so the dropdown reflects the user's
    // change before the network request finishes.
    patchTask(task.id, changes);

    // Mark this row as busy so the dropdown is disabled while the save is in flight.
    setSaving((ids) => [...ids, task.id]);
    setError(null);

    try {
      // Send the actual update to the backend. If this succeeds, we keep the
      // optimistic UI change as the real state.
      await send();
    } catch (err) {
      // If the server rejects the change, revert the row back to its previous values
      // and show the error message returned by the backend.
      patchTask(task.id, rollback);
      setError(errorMessage(err));
    } finally {
      // Always clear the busy flag when the request settles, whether it succeeded
      // or failed.
      setSaving((ids) => ids.filter((id) => id !== task.id));
    }
  }

  const changeStatus = (task: Task, status: Status) =>
    save(task, { status }, () => updateTaskStatus(task.id, status));

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
            {tasks.map((task) => {
              const busy = saving.includes(task.id);
              const qualified = developers.filter((d) => isQualified(d, task));

              return (
                <tr key={task.id}>
                  <td>{task.title}</td>

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
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
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
