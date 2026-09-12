// Two-stack undo/redo history (Figma-style), shared by whiteboard.js + canvas.js.
// Session 27 extraction: both boards carried private undoStack/redoStack arrays with the
// same push/peek/upgrade/undo/redo dance inline (~15 call sites each). Single-sourced here
// so the undo logic is testable and identical across boards.
//
// An entry is { kind, data } — the kind names the action that HAPPENED ('add' | 'erase' |
// 'modify'); the consumer's apply callbacks know how to invert each kind.
//
// Semantics notes (behavior-preserving vs the pre-extraction boards):
//   - commit() clears the redo branch (the Figma rule — a new action forks history).
//   - log() records an entry WITHOUT clearing the redo branch: the boards' eraser paths
//     (swipe-erase, delete-selection, sticky-close ×) push per-object entries inside loops
//     and never cleared there — preserved exactly, since entries are self-contained
//     LIFO records and the stacks stay consistent.
//   - undo/redo take an apply(entry) callback that performs the inverse action and
//     RETURNS the record to push onto the opposite stack (return null/undefined to push
//     nothing). whiteboard.js returns the same entry; canvas.js returns kind-inverted
//     records — both conventions work unchanged.

window.hibanaHistory = (() => {
  class History {
    constructor() {
      this.undoStack = [] // { kind, data } — inverses let us undo/redo both ways
      this.redoStack = []
    }

    // Record a NEW user action: push onto the undo stack, clear the redo branch.
    commit(kind, data) {
      this.undoStack.push({ kind, data })
      this.redoStack.length = 0
    }

    // Record an inverse entry WITHOUT invalidating the redo branch (legacy eraser-path
    // semantics — see the header note).
    log(kind, data) {
      this.undoStack.push({ kind, data })
    }

    // Commit pattern for a just-edited 'add' entry: upgrade the top entry's data in
    // place (one undo step for create+edit) or push a fresh 'add' if none is live.
    // The redo branch is cleared either way.
    commitAdd(id, data) {
      const top = this.undoStack[this.undoStack.length - 1]
      if (top && top.kind === 'add' && top.data.id === id) top.data = data
      else this.commit('add', data)
    }

    // Discard pattern for a cancelled create: drop the top 'add' entry for id so no
    // phantom undo step stays behind (an emptied sticky is discarded, its fresh 'add'
    // entry must vanish with it). Returns true when an entry was dropped.
    dropLastAdd(id) {
      const top = this.undoStack[this.undoStack.length - 1]
      if (top && top.kind === 'add' && top.data.id === id) {
        this.undoStack.pop()
        return true
      }
      return false
    }

    canUndo() { return this.undoStack.length > 0 }
    canRedo() { return this.redoStack.length > 0 }

    // Drop the redo branch only (the paste/duplicate paths log N clone entries inside a
    // loop, then invalidate redo once after the loop — same net effect as commit()).
    clearRedo() {
      this.redoStack.length = 0
    }

    // Pop the undo stack, run entry through apply; whatever apply RETURNS is pushed onto
    // the redo stack. Returns the applied entry (or null when the stack was empty).
    undo(apply) {
      const entry = this.undoStack.pop()
      if (!entry) return null
      const inverse = apply(entry)
      if (inverse) this.redoStack.push(inverse)
      return entry
    }

    // Pop the redo stack, run entry through apply; whatever apply RETURNS is pushed back
    // onto the undo stack. Returns the applied entry (or null when the stack was empty).
    redo(apply) {
      const entry = this.redoStack.pop()
      if (!entry) return null
      const inverse = apply(entry)
      if (inverse) this.undoStack.push(inverse)
      return entry
    }

    clear() {
      this.undoStack.length = 0
      this.redoStack.length = 0
    }
  }

  return { History }
})()
