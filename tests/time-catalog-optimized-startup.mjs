// Same production startup/input workload with the documented log aggregate
// field present. The existing suite also keeps the missing-field fallback arm.
process.env.PENA_STARTUP_LOG_METADATA = '1';
process.env.PENA_STARTUP_LABEL = 'optimized';
await import('./native-startup-time-contention.mjs');
