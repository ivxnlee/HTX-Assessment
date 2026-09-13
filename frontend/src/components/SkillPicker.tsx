import type { Skill } from "../api";

type Props = {
  skills: Skill[];
  selected: number[];
  onChange: (skillIds: number[]) => void;
};

export default function SkillPicker({ skills, selected, onChange }: Props) {
  if (skills.length === 0) {
    return <p className="muted">No skills available.</p>;
  }

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div className="checkboxes">
      {skills.map((skill) => (
        <label className="checkbox" key={skill.id}>
          <input
            type="checkbox"
            checked={selected.includes(skill.id)}
            onChange={() => toggle(skill.id)}
          />
          {skill.name}
        </label>
      ))}
    </div>
  );
}
