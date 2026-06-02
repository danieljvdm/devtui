# devtui UI Follow-Up Spec

This document captures the next polish and interaction work for devtui. Screenshots/design references can be attached later under each section.

## 1. Sidebar Header And Merged State

### Problem

The current process sidebar puts the `merged` row above the table headers. That makes the sidebar read oddly: the primary "all logs" state is visually outside the table structure, while individual process rows are inside it.

### Goal

Rework the sidebar header/merged layout so the merged state, table headers, and process rows feel like one coherent surface.

### Design Reference

https://shots.danvdm.com/2026/06/02/1b1523f3-5774-4cd3-b1e9-08410615cfc4.jpg

### Implementation Notes

- Treat this primarily as presentation polish in the TUI layer.
- Keep process data and selection state in the existing UI model/reducer path.
- Avoid adding React-owned runtime state for what is already represented by `viewId`, process snapshots, and derived view models.

### Acceptance Criteria

- The merged state no longer appears awkwardly above the process table headers.
- Sidebar hierarchy is visually clear at small and wide terminal sizes.
- Keyboard behavior for selecting merged/process views remains unchanged unless explicitly updated.

## 2. Quit Confirmation

### Problem

Pressing `q` should require confirmation before quitting.

### Goal

Restore/ensure the behavior where pressing `q` shows a confirmation state like `press q again to quit`, and only a second `q` within the confirmation window exits.

### Priority

Important.

### Implementation Notes

- Keep `ctrl-c` as the deliberate immediate quit path if that is still the intended behavior.
- The confirmation UI can live in React as transient UI affordance, but quitting itself should still route through the existing command/reducer/runtime path.
- Confirm current behavior before changing; this may already exist but may have regressed in a specific state/overlay.

### Acceptance Criteria

- First `q` does not quit.
- Footer/status area clearly shows the confirmation prompt.
- Second `q` within the confirmation window quits.
- Any unrelated key cancels the armed confirmation.

## 3. Copy Process URL From Left Pane

### Problem

When focused on a process in the left pane, it should be easy to copy the process URL, especially for localhost and Portless-backed processes.

### Goal

When the process pane is focused and a process is selected, pressing `c` should copy the best detected URL for that process.

### Desired Behavior

- If a selected process has a detected local URL, copy it.
- If a selected process has a Portless URL, copy it.
- If both exist, decide and document precedence. Suggested precedence: externally useful URL first, then localhost.
- Reuse the same style of copy feedback used for copied log rows where practical.

### Architecture Notes

This should mostly live in Effect/core/data-model logic, not React:

- Endpoint/URL detection should be represented in the process runtime/domain model.
- Portless vs localhost URL selection should be a pure helper or service-level derived value.
- React should render the current snapshot and dispatch a typed command; it should not inspect logs/process output ad hoc to discover URLs.
- Clipboard write can continue through the existing clipboard runtime command path.

### Acceptance Criteria

- `c` in the log pane still copies logs as before.
- `c` in the process pane copies the selected process URL when one is available.
- If no URL is available, the UI should avoid a confusing no-op where possible.
- Tests cover URL selection precedence and keyboard routing.

## 4. Filtering And Searching Logs

### Problem

Filtering/searching logs needs a more polished interaction model and UI state display.

### Goal

Implement polished designs for both active filters and active search state.

### Design Reference

Filtering - https://shots.danvdm.com/2026/06/02/2c63a3d5-3c41-4981-b7fd-a0275b379dc6.jpg
Filtered - https://shots.danvdm.com/2026/06/02/40a8c5a8-7a64-4587-8cd2-32d161eec30d.jpg

Take note of the yellow highlight

Search - https://shots.danvdm.com/2026/06/02/25b79bd9-0718-4c81-8aa8-a28bf3d6efd2.jpg

### Open Questions

- Should filtering and searching be separate modes or one command palette-like input with different modes?
- Should search highlight matches in-place while filter hides non-matching rows?
- What keyboard shortcuts should distinguish filter vs search?

### Implementation Notes

- Filtering/searching should be reflected in the UI state/model, not ad hoc component state.
- Log querying/filtering should stay compatible with the `LogStore` direction.
- For richer querying later, prefer shaping this around domain/query primitives rather than string-only UI hacks.

### Acceptance Criteria

- Active filter state is visibly represented.
- Active search state is visibly represented.
- Search/filter UI behaves well on narrow and wide terminals.
- Reducer/model tests cover mode transitions and displayed row behavior.

## 5. Dynamic Window Sizes

### Problem

The TUI needs better behavior across different terminal/window sizes.

### Goal

Implement and polish responsive layouts for multiple terminal dimensions.

### Scope Ideas

- Very narrow terminal.
- Medium single-column layout.
- Wide layout with process sidebar.
- Short terminal heights where modals/lists need careful clipping.

### Reference

https://shots.danvdm.com/2026/06/02/56a259aa-dad1-408f-bea6-13b34432a49d.jpg
https://shots.danvdm.com/2026/06/02/35b14394-e555-4933-938d-bde87c74b3d7.jpg

### Implementation Notes

- Prefer deriving layout from the view model where possible.
- Keep fixed-format UI elements stable with explicit dimensions.
- Avoid text overlap, clipped controls, or layout jumps when terminal size changes.

### Acceptance Criteria

- Process list, log rows, footer, filter/search UI, help modal, and theme selector behave across representative sizes.
- Tests or screenshot checks cover key size classes where practical.
- No visible overlap or incoherent truncation in common sizes.
