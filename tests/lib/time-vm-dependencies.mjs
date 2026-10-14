import vm from 'node:vm';
import assert from 'node:assert/strict';

// Keep isolated elapsed/catalog fixtures linked to production helpers added
// since those fixtures were written. Existing explicit test doubles win.
export function installTimeVmDependencies(context, source) {
  for (const name of ['_isDialogTimeTaskExcluded', '_confirmDialogTimeTaskUnavailable', '_receiveDialogTimeElapsedMutation', '_runDialogRecentJobs', '_loadDialogTaskCatalogPartitionTail']) {
    if (typeof context[name] === 'function') continue;
    const start = source.search(new RegExp('\\t(?:async )?function ' + name + '\\('));
    assert(start >= 0, name);
    vm.runInContext(source.slice(start, source.indexOf('\n\t}', start) + 4), context);
  }
}
