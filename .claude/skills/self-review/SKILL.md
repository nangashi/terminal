---
description: Run multi-perspective code review with severity filtering. Use /self-review for diff review, /self-review full for all files.
disable-model-invocation: true
allowed-tools: Bash, Glob, Read, Write, Agent
context: fork
agent: general-purpose
---

# Self-Review Orchestrator

You are a code review orchestrator. Execute the following phases in order.

## Phase 0: Initialize

### Determine scope

The user's arguments are: `$ARGUMENTS`

**Mode decision (CRITICAL — follow exactly):**
- If the arguments above contain the word `full` → mode = **full**. You MUST use Glob to collect files. Do NOT run `git diff`.
- Otherwise → mode = **diff**. You MUST use `git diff` to collect files. Do NOT use Glob for file collection.

### Get file list

**full mode — use Glob (NOT git diff):**
Use Glob to collect ALL files in `src/` and `src-tauri/src/`. This reviews the entire codebase regardless of git changes.
- `src/**/*` (exclude `*.md`, `*.test.ts`, `*.test.tsx`)
- `src-tauri/src/**/*` (exclude `*.md`)

**diff mode — use git diff (NOT Glob):**
Run `git diff --name-only main` via Bash to get changed files. Exclude `*.md` files and test files (`*.test.ts`, `*.test.tsx`).

### Validate

If the file list is empty, respond: "No files to review." and stop.
If the file list exceeds 30 files, respond: "Too many files ({count}). Narrow the scope or split into multiple reviews." and stop.

### Determine output number

Use Glob to find `.claude/tmp/review-*.md`. Determine the next sequential number (e.g., if `review-0002.md` exists, use `0003`). If none exist, use `0001`.

Store the file list, mode, and review number for subsequent phases.

## Phase 1: Parallel Review

### Discover perspectives and rules

1. Use Glob to find `${CLAUDE_SKILL_DIR}/references/*.md` — these are the review perspectives
2. Use Glob to find `.claude/rules/*.md` — these are the project rules

### Launch review agents

Launch ALL of the following Agent calls **in a single message** (parallel execution) using `subagent_type: "Explore"`:

**For each perspective file** (e.g., correctness.md, security.md, maintainability.md):
```
Read the file at {CLAUDE_SKILL_DIR}/agents/reviewer.md and follow its instructions exactly.

Perspective file to read: {perspective_path}
Files to review:
{file_list, one per line}
```

**For rules compliance** (one agent):
```
Read the file at {CLAUDE_SKILL_DIR}/agents/rules-checker.md and follow its instructions exactly.

Rule files to read:
{rule_file_list, one per line}

Files to review:
{file_list, one per line}
```

Wait for all agents to complete before proceeding.

## Phase 2: Judge

Collect all agent results from Phase 1. Launch a single Agent call with `subagent_type: "general-purpose"`:

```
Read the file at {CLAUDE_SKILL_DIR}/agents/judge.md and follow its instructions exactly.

Below are all findings from multiple reviewers. Deduplicate, re-assess severity, and produce the final report.

{all_findings_concatenated_with_section_separators}
```

Wait for the judge to complete.

## Phase 3: Output

### Format the report

Create the final report with this structure:

```markdown
# Code Review Result ({date})

## Review Scope
- Mode: {diff or full}
- Files: {count} files
- Perspectives: {list of perspective names}

## Review Process
1. {perspective_name} reviewer (Explore agent)
2. ... (one line per reviewer)
3. Rules compliance checker (Explore agent)
4. Judge (general-purpose agent)

---

{judge_output}
```

### Write and return

1. Use Write to save the report to `.claude/tmp/review-{NNNN}.md`
2. Return the full report content as the skill's response
