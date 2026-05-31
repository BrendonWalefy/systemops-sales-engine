# Agent Skill Rules

These rules apply to project skills under `ai-agents/skills`.

- Treat these folders as the versioned source for project-local agent skills.
- Mirror a skill into `.claude/skills` only when a local tool needs that runtime location.
- Keep each skill minimal: `SKILL.md`, optional `agents/openai.yaml`, and direct child resource folders.
- Put detailed guidance in `references/*.md`; keep `SKILL.md` focused on triggers and workflow.
- Do not add README, changelog, installation notes, or duplicated docs inside a skill folder.
- When real work exposes friction, update the smallest relevant skill file with one practical rule.
- Validate after edits when tooling is available; otherwise manually check frontmatter, naming, references, and stale TODOs.
