# ircdocs parser-tests vectors

Vendored from <https://github.com/ircdocs/parser-tests>, converted from YAML to
JSON so the fixtures can be imported directly. `packages/protocol` declares no
dependencies, so it cannot pull in a YAML parser, and vendoring also keeps the
test suite working without network access.

Retrieved 2026-07-30 from `master`:

| File                  | Upstream                    |
| --------------------- | --------------------------- |
| `msg-split.json`      | `tests/msg-split.yaml`      |
| `msg-join.json`       | `tests/msg-join.yaml`       |
| `userhost-split.json` | `tests/userhost-split.yaml` |

The conversion is mechanical: `yaml.safe_load` followed by `json.dumps`. No
cases were added, removed, or edited.

`BUILD_PLAN.md` also lists a `mode-parsing` vector file. Upstream has no such
file — the repository ships `msg-split`, `msg-join`, `userhost-split`, and
`validate-hostname` only. Mode parsing is covered by hand-written tests in
`src/modes.test.ts` instead.

## Licence

The upstream vectors are dedicated to the public domain under CC0 1.0 by
Daniel Oaks. Individual cases originate from grawity's test vectors (WTFPL v2
at the time of retrieval), Mozilla's test vectors (public domain), and
SadieCat's ircparser-ruby tests, included upstream with permission.
