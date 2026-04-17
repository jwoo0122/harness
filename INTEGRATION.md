# Integration Guide

## Strategy: Layered architecture

```
┌──────────────────────────────────────────────────┐
│  @jwoo0122/harness (this package)                │
│  Generic: debate protocol, role verification,    │
│  tool enforcement, AC tracking, TUI              │
├──────────────────────────────────────────────────┤
│  Project .claude/skills/ (project-specific)      │
│  /verify-native, /verify-web, etc.               │
│  These call back into the generic harness         │
└──────────────────────────────────────────────────┘
```

The harness package provides the **thinking protocol**. 
The project provides the **verification implementation**.

## For the rust-sdui-test project

### Option A: Install as pi package (recommended)

```bash
cd /Users/jinwoo/repos/rust-sdui-test
pi install /path/to/harness
```

Or when published:
```bash
pi install git:github.com/jwoo0122/harness
# or
pi install npm:@jwoo0122/harness
```

The project keeps its own `/verify-native` and `/verify-web` skills. 
The harness's `/execute` mode will call those as part of VER's verification step.

### Option B: Symlink for development

```bash
cd /Users/jinwoo/repos/rust-sdui-test
echo '{ "packages": ["../harness"] }' > .pi/settings.json
```

### Option C: Global install (all projects)

```bash
pi install /path/to/harness
# Writes to ~/.pi/agent/settings.json
```

## Coexistence with project skills

The package skills (`explore`, `execute`) and project skills (`verify-native`, `verify-web`) 
have different names, so they coexist without collision.

The execute skill's VER role naturally invokes project-specific verification:
- "Based on what changed, invoke project-specific verification"
- VER will discover and use `/verify-native` and `/verify-web` when available

## Verification registry plumbing

Execute mode also includes cumulative verification registry plumbing for smoke-level workflow validation:
- registry file path: `.harness/verification-registry.json`
- schema marker: `harness-verification-registry-v1`
- register tool: `harness_verify_register`
- list tool: `harness_verify_list`

Expected smoke behavior for an integrated project:
1. VER baseline loads the registry if present, or the extension creates it on first registration.
2. After an AC is verified, VER records the reproducible method with `harness_verify_register`.
3. Before regression checks, VER calls `harness_verify_list` and re-runs each registered command.

This package provides the registry mechanism; the host project supplies the concrete verification commands worth registering.

## For Claude Code users (no pi)

Copy skills only:
```bash
cp -r /path/to/harness/skills/* /project/.claude/skills/
```

Skills work as-is. No extension enforcement, but the protocols are self-contained.
