INSERT INTO skills (name) VALUES ('Frontend'), ('Backend');

INSERT INTO developers (name) VALUES ('Alice'), ('Bob'), ('Carol'), ('Dave');

INSERT INTO developer_skills (developer_id, skill_id)
SELECT d.id, s.id
FROM developers d
JOIN skills s ON (
     (d.name = 'Alice' AND s.name = 'Frontend')
  OR (d.name = 'Bob'   AND s.name = 'Backend')
  OR (d.name = 'Carol')
  OR (d.name = 'Dave'  AND s.name = 'Backend')
);