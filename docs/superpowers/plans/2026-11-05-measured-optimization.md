# Measured 8.0.66 optimization plan

Goal: reduce repeated synchronous work without changing filtering, counts, row order or scope.
Architecture: build temporary indexes within one render/filter pass; no persistent cache, new observer or polling. Compare against frozen original 8.0.66 source 5b7bcc8 using identical data and source hashes.

- [x] Benchmark 1,000/5,000/10,000 dialogs with many folders/groups, unread/reminder/mention, unique and normal placement. Assert exact output equality and count metadata reads.
- [x] Replace repeated group scans and repeated live metadata resolution with one render-local projection; reuse metadata for filter + counters.
- [x] Read filter preferences once per synchronous row batch; retain fresh reads for standalone rows and later batches.
- [x] Precompute sort metadata and folder ranks once; preserve date/color order and stable ties.
- [x] Run focused tests and exact 16-suite gate; render the existing promotional banners as additional 1280×800 store screenshots.
- [x] User explicitly requires version 8.0.66 and replacing the pending Chrome package. Cancel unpublished 8.0.67; retain original 8.0.66 source as history before replacing delivery. Keep one final tested source for all installers and publish Store update, desktop channel and Disk.
