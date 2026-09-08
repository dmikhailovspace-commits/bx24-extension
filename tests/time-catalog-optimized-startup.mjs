// Same production startup/input workload with log metadata present. Both field
// shapes use the validated global journal; the imported suite separately proves
// the task-by-task fallback on a portal that rejects the global sentinel.
process.env.PENA_STARTUP_LOG_METADATA = '1';
process.env.PENA_STARTUP_LABEL = 'optimized';
await import('./native-startup-time-contention.mjs');
