import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createTask, getSkills, type Skill } from "../api";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong";
}

export default function TaskCreate() {
  const navigate = useNavigate();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [title, setTitle] = useState("");
  const [skillIds, setSkillIds] = useState<number[]>([]);
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

  const toggleSkill = (id: number) =>
    setSkillIds((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    // The backend trims and rejects an empty title; catch it here too so the
    // user gets the message without a round trip.
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createTask(title.trim(), skillIds);
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

      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="label">Title</span>
          <input
            type="text"
            value={title}
            autoFocus
            placeholder="e.g. Build the login page"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <fieldset className="field">
          <legend className="label">Required skills</legend>
          {skills.length === 0 ? (
            <p className="muted">No skills available.</p>
          ) : (
            <div className="checkboxes">
              {skills.map((skill) => (
                <label className="checkbox" key={skill.id}>
                  <input
                    type="checkbox"
                    checked={skillIds.includes(skill.id)}
                    onChange={() => toggleSkill(skill.id)}
                  />
                  {skill.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="actions">
          <button className="button" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </>
  );
}
