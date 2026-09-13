CREATE TABLE skills (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE developers (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE developer_skills (
  developer_id INT NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  skill_id     INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (developer_id, skill_id)
);

CREATE TABLE tasks (
  id          SERIAL PRIMARY KEY,
  parent_id   INT REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'To-do'
              CHECK (status IN ('To-do', 'In-progress', 'Done')),
  assignee_id INT REFERENCES developers(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_parent ON tasks(parent_id);

CREATE TABLE task_skills (
  task_id  INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, skill_id)
);