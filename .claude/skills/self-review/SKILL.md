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

Check `$ARGUMENTS`:
- If it contains `full`: full-file mode (review all source files)
- Otherwise: diff mode (review only changed files vs main branch)

### Get file list

**Diff mode:**
Run `git diff --name-only main` via Bash. Filter to only these extensions: `.ts`, `.tsx`, `.rs`, `.css`. Exclude test files (`*.test.ts`, `*.test.tsx`).

**Full mode:**
Use Glob to find:
- `src/**/*.ts` and `src/**/*.tsx` (exclude `*.test.ts`, `*.test.tsx`)
- `src-tauri/src/**/*.rs`

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
