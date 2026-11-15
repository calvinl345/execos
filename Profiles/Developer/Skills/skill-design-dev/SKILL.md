---
name: "skill-design-dev"
description: "Use when creating, editing, reviewing, or restructuring ExecOS skill files. Maintains skills under both Profiles/Developer/Skills and Profiles/Production/Skills, validates SKILL.md metadata, updates agents/openai.yaml when present, and materializes the selected profile into .agents/skills and .claude/skills. Does not edit generated live skill folders directly."
---

# Context

ExecOS skills are profile-source files first. The canonical skill
copies live under `Profiles/Developer/Skills/{base-skill-name}-dev/` and
`Profiles/Production/Skills/{base-skill-name}-prod/`; `.agents/skills/` and
`.claude/skills/` are generated outputs from `node scripts/installer/materialize.mjs apply-profile`.

Design skills with the same methodology as any good context artifact: clear
trigger metadata, a short operational spine, low constraint count, and concrete
final verification. Adapt logistics to this repo by updating both profile
sources by default, then materializing the active profile.

# Workflow

Track progress through this workflow for every skill-design task.

1. **Identify the task type.**
   - New skill: create a new skill folder in both profile sources.
   - Skill edit: update both profile copies of the existing skill.
   - Skill review: compare both profile copies and report defects, then edit if the user asked for changes.
2. **Inspect the profile sources.**
   - Read `Profiles/Developer/Skills/{base-skill-name}-dev/` and `Profiles/Production/Skills/{base-skill-name}-prod/` when the skill already exists.
   - Do not use `.agents/skills/` or `.claude/skills/` as the source of truth.
3. **Design or revise the skill content.**
   - Use [Skill Structure](#skill-structure) for the SKILL.md layout.
   - Use [Profile Rules](#profile-rules) for dev/prod differences.
   - Keep extra reference files only when they prevent SKILL.md from becoming too long.
4. **Write both profile copies.**
   - New skill: create `Profiles/Developer/Skills/{base-skill-name}-dev/SKILL.md` and `Profiles/Production/Skills/{base-skill-name}-prod/SKILL.md`.
   - Existing skill: edit both copies unless the user explicitly says the skill belongs to only one profile.
   - If `agents/openai.yaml` is useful for discovery, create or update it in both profile copies.
5. **Validate.**
   - Run the validator in [Validation Commands](#validation-commands) against every changed profile skill directory.
   - Fix any metadata or structure failures before stopping.
6. **Materialize the active profile.**
   - Run `node scripts/installer/materialize.mjs apply-profile --profile developer` when the checkout is currently in Developer mode.
   - Use `-Profile production` only when the user is switching/testing Production; restore Developer afterward if that was the starting state.
7. **Verify generated outputs.**
   - Confirm `.agents/skills/{profile-suffixed-skill-name}/` and `.claude/skills/{profile-suffixed-skill-name}/` match the selected profile source.
   - Confirm no edits are stranded only in generated folders.
8. **Report precisely.**
   - State which profile source folders changed, which profile was materialized, and which validations passed.

# Skill Structure

Use this default structure for new SKILL.md files. Omit sections that do not
apply, but keep `Context`, `Workflow`, and `Final Verification` unless the skill
is extremely small.

```markdown
---
name: skill-name
description: "Use when ... Does not ..."
---

# Context

One to three paragraphs explaining when the skill applies and the most important
constraint.

# Workflow

Track progress through this workflow.

1. Recognize the user intent.
2. Do the pre-flight check.
3. Run the command or perform the work.
4. Verify the result.
5. Report what happened.

# Gotchas

- Concrete mistakes this repo has seen before, with the correction.

# Final Verification

Before replying, confirm:

- The correct command/path/profile was used.
- The operation was verified from source or tool output.
```

# Profile Rules

- **Both profiles by default.** A new skill must exist in both
  `Profiles/Developer/Skills` and `Profiles/Production/Skills` unless the user
  explicitly says it is profile-specific. This prevents one agent surface from
  silently missing a workflow.
- **Folder and skill names carry the profile suffix.** Developer skill folders
  and frontmatter names end in `-dev`; Production skill folders and frontmatter
  names end in `-prod`. For example: `dashboard-dev` and `dashboard-prod`.
- **Generated folders are not source.** Never make final edits only under
  `.agents/skills` or `.claude/skills`; those are overwritten by
  the profile materializer.
- **Developer commands use development data.** Developer skills should use
  `execos ...` for ExecOS CLI operations.
- **Production commands use production data.** Production skills should use
  `execos ...` for normal Jordan operations.
- **Keep profiles parallel.** The two SKILL.md files should be identical except
  where the command target, database environment, or profile purpose must differ.
- **Keep Codex and Claude outputs identical.** The profile materializer copies the
  same selected profile skill folder into both `.agents/skills` and
  `.claude/skills`; do not create separate source trees for those agent surfaces.

# Validation Commands

Run from the repo root.

```powershell
$validator = "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py"
python $validator 'Profiles\Developer\Skills\{base-skill-name}-dev'
python $validator 'Profiles\Production\Skills\{base-skill-name}-prod'
```

For all profile skills:

```powershell
$validator = "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py"
foreach ($dir in Get-ChildItem -Directory Profiles\Developer\Skills,Profiles\Production\Skills) {
  python $validator $dir.FullName
}
```

# Quality Criteria

- The frontmatter has only supported keys, valid YAML, a hyphen-case `name`,
  and a trigger-focused `description` under 1024 characters.
- The description contains no angle-bracket placeholders such as `<name>`.
- The skill has a numbered workflow the agent can follow without inventing the
  process.
- The active behavioral constraint count stays under 15.
- The skill can begin useful work after reading at most one extra file.
- `agents/openai.yaml`, when present, matches the SKILL.md trigger and command
  behavior.
- Any command examples match the profile: Developer uses `execos`;
  Production uses `execos`.

# Final Verification

Before finishing a skill-design change, confirm:

1. The skill exists in both `Profiles/Developer/Skills` and
   `Profiles/Production/Skills`, or the user explicitly approved a
   profile-specific exception.
2. Both profile copies validate with `quick_validate.py`.
3. Developer copy has no accidental `execos ...` production command
   for routine Jordan operations.
4. Production copy has no accidental `execos ...` development
   command for routine Jordan operations.
5. The selected profile was materialized with `node scripts/installer/materialize.mjs apply-profile`.
6. The generated `.agents/skills` and `.claude/skills` copies match the selected
   profile source.
