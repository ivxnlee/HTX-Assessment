import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createTask, getSkills, type Skill } from "../api";
import TaskEditor from "../components/TaskEditor";
import { emptyDraft, hasBlankTitle, toNewTask, type TaskDraft } from "../taskDraft";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong";
}

export default function TaskCreate() {
  const navigate = useNavigate();

  const [skills, setSkills] = useState<Skill[]>([]);
  // The whole tree — the task and every nested subtask — lives in this one value.
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getSkills()
      .then((loaded) => {
        if (!cancelled) setSkills(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    // The backend rejects blank titles at any depth; catch them here too so the
    // offending fields can be highlighted without a round trip.
    if (hasBlankTitle(draft)) {
      setShowErrors(true);
      setError("Every task and subtask needs a title");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createTask(toNewTask(draft));
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <h2>New Task</h2>
        <Link className="button secondary" to="/">
          Back to Tasks
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <TaskEditor
          draft={draft}
          skills={skills}
          depth={0}
          showErrors={showErrors}
          onChange={setDraft}
        />

        <p className="hint">
          Only developers who hold every selected skill can be assigned to a task. A task can
          only be marked Done once all of its subtasks are Done.
        </p>

        <div className="actions">
          <button className="button" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </>
  );
}
