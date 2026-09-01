"""Property check for adaptive TopDocs overfetch + document collapse.

Metadata filters are already part of the Tantivy query, so ``raw_topdocs`` is
the score-sorted stream of matching sections. This check compares the adaptive
answer with exhaustive tie-breaking and one-hit-per-document collapse.
"""
from __future__ import annotations

from dataclasses import dataclass
from random import Random


@dataclass(frozen=True)
class Hit:
    score: float
    document_id: str
    section_id: str
    strict: bool


def rank_key(hit: Hit) -> tuple[float, int, str]:
    return (-hit.score, 0 if hit.strict else 1, hit.section_id)


def collapse(hits: list[Hit]) -> list[Hit]:
    ranked = sorted(hits, key=rank_key)
    seen: set[str] = set()
    result: list[Hit] = []
    for hit in ranked:
        if hit.document_id in seen:
            continue
        seen.add(hit.document_id)
        result.append(hit)
    return result


def adaptive(raw_topdocs: list[Hit], limit: int) -> list[Hit]:
    live = len(raw_topdocs)
    if limit == 0 or live == 0:
        return []
    fetch = min(max(limit * 4, 32), live)

    while True:
        requested = min(fetch + 1, live)
        top = raw_topdocs[:requested]
        has_more = len(top) > fetch
        selected = collapse(top[:fetch])
        enough = len(selected) >= limit
        boundary = selected[limit - 1].score if enough else None
        next_score = top[fetch].score if len(top) > fetch else None
        closed = boundary is not None and (
            next_score is None or next_score < boundary
        )
        if not has_more or (enough and closed) or fetch >= live:
            return selected[:limit]
        next_fetch = min(fetch * 2, live)
        if next_fetch == fetch:
            return selected[:limit]
        fetch = next_fetch


def exhaustive(raw_topdocs: list[Hit], limit: int) -> list[Hit]:
    return collapse(raw_topdocs)[:limit]


def main() -> None:
    rng = Random(90210)
    for size in range(0, 240):
        for _ in range(25):
            # Deliberately low score cardinality creates large ties.
            hits = [
                Hit(
                    score=float(rng.randrange(0, 12)),
                    document_id=f"doc-{rng.randrange(0, max(1, size // 3 + 1))}",
                    section_id=f"section-{i:04d}",
                    strict=bool(rng.randrange(0, 2)),
                )
                for i in range(size)
            ]
            # Tantivy TopDocs guarantees score order, but not our secondary ties.
            raw = sorted(hits, key=lambda hit: -hit.score)
            for limit in (0, 1, 2, 5, 10, 50):
                got = adaptive(raw, limit)
                expected = exhaustive(raw, limit)
                assert got == expected, (size, limit, got, expected)
    print("adaptive collapse property check: PASS")


if __name__ == "__main__":
    main()
