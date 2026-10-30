"""Per-feature pass-count floors for the pinned corpus.

``FLOORS[feature]`` is the minimum number of fixtures of that feature that must
pass on every run. Floors are **ratchets**: they start at the number of
fixtures that currently pass and may only rise. Lowering a floor requires a
human decision in review — the regen runner refuses to do it silently.

Keep this file hand-editable; ``python -m corpus.regen --update-floors`` rewrites
the ``FLOORS`` literal only when it can raise a floor.
"""

from __future__ import annotations

FLOORS: dict[str, int] = {
    "briefing-watch-item": 1,
    "dynamic-rules-prompt": 1,
    "error-script-exhaustion": 1,
    "multi-turn-context": 1,
    "persona-teacher": 1,
    "plain-reply": 2,
    "thread-title-generation": 2,
    "tool-call-single-turn": 2,
}


def check_floors(achieved: dict[str, int]) -> list[str]:
    """Return violation messages for features below their floor or unlisted."""
    problems: list[str] = []

    for feature, floor in sorted(FLOORS.items()):
        passed = achieved.get(feature, 0)
        if passed < floor:
            problems.append(f"{feature}: {passed} passing fixture(s) < floor {floor}")

    for feature in sorted(set(achieved) - set(FLOORS)):
        problems.append(f"{feature}: feature has fixtures but no entry in FLOORS")

    return problems


def reconcile(achieved: dict[str, int]) -> tuple[dict[str, int], list[str]]:
    """Ratchet floors up to the achieved counts.

    Returns ``(new_floors, report_lines)``.

    Raises:
        ValueError: if any feature achieved fewer passes than its current floor
            (a regression must be fixed, not papered over by lowering a floor).
    """
    regressions = [
        f"{feature}: achieved {achieved.get(feature, 0)} < current floor {floor}"
        for feature, floor in sorted(FLOORS.items())
        if achieved.get(feature, 0) < floor
    ]
    unknown = sorted(set(achieved) - set(FLOORS))
    if regressions or unknown:
        details = regressions + [f"{feature}: no FLOORS entry" for feature in unknown]
        raise ValueError("refusing to lower/patch floors silently:\n  - " + "\n  - ".join(details))

    new_floors = dict(FLOORS)
    report: list[str] = []
    for feature in sorted(achieved):
        old = FLOORS.get(feature, 0)
        new = max(old, achieved[feature])
        if new > old:
            new_floors[feature] = new
            report.append(f"{feature}: floor {old} -> {new}")
        else:
            report.append(f"{feature}: floor {old} (unchanged, achieved {achieved[feature]})")
    return new_floors, report


def render_floors(floors: dict[str, int]) -> str:
    """Render a ``FLOORS`` dict as a Python literal block."""
    lines = ["FLOORS: dict[str, int] = {"]
    lines.extend(f'    "{feature}": {floors[feature]},' for feature in sorted(floors))
    lines.append("}")
    return "\n".join(lines)
