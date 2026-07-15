# Changelog

## [Unreleased]

- Fix CI workflow duration counters so running checks update every second.
- Show referenced work items and cross-repository comment mentions in discussions.
- Preserve percent-encoded repository identifiers and the current relay hint in repository sub-page links.
- Resolve repository relay hints for localhost, including plaintext `ws://` local relays.

## [3.0.3]

- Visualize CI workflow queue, execution, and conclusion timing.

## [3.0.2]

- Fix Zapstore publishing by restoring the persistent bunker signing client key.

## [3.0.1]

- Show platform-aware release metadata alongside the build commit in the footer.
- Keep the ref selector in sync with live repository state events.
- Prevent duplicate CI workflow and job results from appearing in the checks display.
- Publish Android releases automatically to Zapstore.

## [3.0.0]

- Initial version.
