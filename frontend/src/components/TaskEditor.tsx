import type { Skill } from "../api";
import { emptyDraft, type TaskDraft } from "../taskDraft";
import SkillPicker from "./SkillPicker";

type Props = {
  draft: TaskDraft;
  skills: Skill[];
  /** 0 for the task itself, 1 for its subtasks, and so on. */
  depth: number;
  /** Flag blank titles; set once the user has tried to save. */
  showErrors: boolean;
  onChange: (draft: TaskDraft) => void;
  /** Absent for the top-level task, which cannot be removed. */
  onRemove?: () => void;
};

/**
 * Edits one task and renders an editor for each of its subtasks — itself,
 * recursively — so subtasks can nest to any depth.
 *
 * The component holds no state: the whole tree lives in the page, and each
 * editor reports its replacement upward through onChange.
 */
export default function TaskEditor({
  draft,
  skills,
  depth,
  showErrors,
  onChange,
  onRemove,
}: Props) {
  const isSubtask = depth > 0;
  const titleMissing = showErrors && !draft.title.trim();

  const update = (changes: Partial<TaskDraft>) => onChange({ ...draft, ...changes });

  const addSubtask = () => update({ subtasks: [...draft.subtasks, emptyDraft()] });

  const replaceSubtask = (next: TaskDraft) =>
    update({ subtasks: draft.subtasks.map((s) => (s.key === next.key ? next : s)) });

  const removeSubtask = (key: number) =>
    update({ subtasks: draft.subtasks.filter((s) => s.key !== key) });

  return (
    <div className={isSubtask ? "task-editor subtask" : "task-editor"}>
      {isSubtask && (
        <div className="subtask-header">
          <span className="subtask-label">Subtask</span>
          <button type="button" className="link-button" onClick={onRemove}>
            Remove
          </button>
        </div>
      )}

      <label className="field">
        <span className="label">Title</span>
        <input
          type="text"
          value={draft.title}
          // Fires on mount only, so each newly added subtask takes focus.
          autoFocus
          aria-invalid={titleMissing}
          placeholder={isSubtask ? "e.g. Write the API endpoint" : "e.g. Build the login page"}
          onChange={(e) => update({ title: e.target.value })}
        />
        {titleMissing && <span className="field-error">Title is required</span>}
      </label>

      <fieldset className="field">
        <legend className="label">Required skills</legend>
        <SkillPicker
          skills={skills}
          selected={draft.skillIds}
          onChange={(skillIds) => update({ skillIds })}
        />
      </fieldset>

      {draft.subtasks.length > 0 && (
        <div className="subtasks">
          {draft.subtasks.map((subtask) => (
            <TaskEditor
              key={subtask.key}
              draft={subtask}
              skills={skills}
              depth={depth + 1}
              showErrors={showErrors}
              onChange={replaceSubtask}
              onRemove={() => removeSubtask(subtask.key)}
            />
          ))}
        </div>
      )}

      <button type="button" className="button secondary small" onClick={addSubtask}>
        + Add subtask
      </button>
    </div>
  );
}
