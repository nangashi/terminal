# Maintainability Review (SR-M)

ID prefix: **SR-M**

## Check Items

### Code Duplication
- Identical or near-identical logic repeated across files
- Copy-pasted mock definitions in test files
- Same magic values (strings, numbers, colors) hardcoded in multiple locations

### Coupling
- Components importing types/values from unexpected locations (wrong dependency direction)
- Module-scope side effects (API calls, mutable state) that complicate testing
- Tight coupling between layers that should be independent

### Dead Code
- Unused imports, variables, functions, or types
- Unreachable code branches
- Commented-out code blocks without explanation
- Unused dependencies in package.json or Cargo.toml

### Testability
- Code patterns that make unit testing unnecessarily difficult
- Global mutable state that leaks between tests
- Missing cleanup in test setup/teardown
