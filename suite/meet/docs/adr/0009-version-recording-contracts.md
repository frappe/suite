# Version recording contracts with shared semantic vectors

Recording-specific messages crossing process Seams use immutable, language-neutral JSON contract files containing finite vocabularies, exact message shapes, and accepted and rejected vectors. Python and TypeScript Adapters retain independent fail-closed validators and run the same vectors against their production parsers; generated validators and new runtime schema dependencies were rejected because shared behavior can be enforced without coupling security validation to one implementation toolchain.

## Consequences

- The contract covers Frappe-recorder commands and callbacks, recorder-browser lifecycle messages, and Recording Grant proof messages. General participant, media, chat, and signaling messages remain outside its scope.
- Every message carries an integer `protocol_version`. An Adapter emits its current version and accepts only the current and immediately previous versions during rolling deployment.
- A shipped version is immutable. Any changed field, meaning, state, reason, ordering rule, or error mode creates a new version.
- Authenticated commands, callbacks, Recording Grants, and lifecycle messages reject unknown fields before side effects.
- Frappe domain states and recorder implementation milestones use separate finite vocabularies with explicit tested mappings.
- Behavioral reasons use a finite `reason_code`; an optional bounded `diagnostic` may aid operations but never drives domain behavior.
- Lifecycle event timestamps use canonical UTC RFC 3339 with exactly millisecond precision and `Z`. JWT `iat` and `exp` remain integer epoch seconds.
- Every production Adapter parses the same vectors. Accepted vectors normalize to the same semantic JSON; rejected vectors fail with a contract-version or validation category before side effects; coverage verifies every finite state and reason appears in a vector.
