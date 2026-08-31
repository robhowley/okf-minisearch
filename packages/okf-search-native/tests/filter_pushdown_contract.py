"""Property check for translating the former post-filter into Tantivy clauses.

This checks the logical contract independently of Tantivy's implementation:
values inside one filter dimension are ORed, dimensions are ANDed, and stale
classification keeps the original missing-value and inclusive-boundary rules.
The Rust unit tests exercise the same cases against the actual Tantivy query.
"""
from __future__ import annotations

from dataclasses import dataclass
from random import Random


@dataclass(frozen=True)
class Record:
    document_type: str
    tags: tuple[str, ...]
    status: str | None
    trust_tier: str | None
    conformance: str
    stale_after_epoch: int | None
    staleness_classified: bool


@dataclass(frozen=True)
class Filter:
    types: frozenset[str] | None = None
    tags_any: frozenset[str] | None = None
    statuses: frozenset[str] | None = None
    trust_tiers: frozenset[str] | None = None
    conformance: frozenset[str] | None = None
    stale: bool | None = None


def old_post_filter(record: Record, where: Filter, as_of_epoch: int) -> bool:
    if where.types is not None and record.document_type not in where.types:
        return False
    if where.tags_any is not None and not any(
        tag in where.tags_any for tag in record.tags
    ):
        return False
    if where.statuses is not None and record.status not in where.statuses:
        return False
    if where.trust_tiers is not None and record.trust_tier not in where.trust_tiers:
        return False
    if where.conformance is not None and record.conformance not in where.conformance:
        return False
    if where.stale is not None:
        if not record.staleness_classified:
            return False
        is_stale = (
            record.stale_after_epoch is not None
            and record.stale_after_epoch <= as_of_epoch
        )
        if is_stale != where.stale:
            return False
    return True


def pushed_query_predicate(record: Record, where: Filter, as_of_epoch: int) -> bool:
    """The document-set expression built by ``build_filter_query``."""
    clauses: list[bool] = []
    if where.types is not None:
        clauses.append(record.document_type in where.types)
    if where.tags_any is not None:
        clauses.append(bool(set(record.tags) & where.tags_any))
    if where.statuses is not None:
        clauses.append(record.status is not None and record.status in where.statuses)
    if where.trust_tiers is not None:
        clauses.append(
            record.trust_tier is not None and record.trust_tier in where.trust_tiers
        )
    if where.conformance is not None:
        clauses.append(record.conformance in where.conformance)
    if where.stale is not None:
        in_inclusive_range = (
            record.stale_after_epoch is not None
            and record.stale_after_epoch <= as_of_epoch
        )
        if where.stale:
            clauses.append(record.staleness_classified and in_inclusive_range)
        else:
            clauses.append(record.staleness_classified and not in_inclusive_range)
    return all(clauses)


def optional_subset(rng: Random, values: tuple[str, ...]) -> frozenset[str] | None:
    if rng.random() < 0.45:
        return None
    selected = frozenset(value for value in values if rng.random() < 0.5)
    # Empty public arrays are normalized to no filter before query construction.
    return selected or None


def main() -> None:
    rng = Random(0x0F17E2)
    types = ("Decision", "Reference", "Note", "Guide")
    tags = ("memory", "architecture", "docs", "search", "rust")
    statuses = ("draft", "stable", "deprecated")
    tiers = ("unverified", "machine-confirmed", "human-reviewed")
    conformance = ("strict", "degraded")
    epochs = (None, -1, 0, 999, 1_000, 1_001, 3_000)
    as_of_values = (-1, 0, 999, 1_000, 1_001, 3_000)

    checked = 0
    for _ in range(100_000):
        record = Record(
            document_type=rng.choice(types),
            tags=tuple(tag for tag in tags if rng.random() < 0.35),
            status=rng.choice((*statuses, None)),
            trust_tier=rng.choice((*tiers, None)),
            conformance=rng.choice(conformance),
            stale_after_epoch=rng.choice(epochs),
            staleness_classified=bool(rng.randrange(2)),
        )
        where = Filter(
            types=optional_subset(rng, types),
            tags_any=optional_subset(rng, tags),
            statuses=optional_subset(rng, statuses),
            trust_tiers=optional_subset(rng, tiers),
            conformance=optional_subset(rng, conformance),
            stale=rng.choice((None, False, True)),
        )
        as_of_epoch = rng.choice(as_of_values)
        expected = old_post_filter(record, where, as_of_epoch)
        actual = pushed_query_predicate(record, where, as_of_epoch)
        assert actual == expected, (record, where, as_of_epoch, actual, expected)
        checked += 1

    # Focused guardrails for the two easy-to-break stale semantics.
    classified_missing = Record(
        "Note", (), None, None, "strict", None, True
    )
    unclassified_stale = Record(
        "Note", (), None, None, "degraded", 1_000, False
    )
    at_boundary = Record(
        "Note", (), None, None, "strict", 1_000, True
    )
    assert old_post_filter(classified_missing, Filter(stale=False), 1_000)
    assert not old_post_filter(classified_missing, Filter(stale=True), 1_000)
    assert not old_post_filter(unclassified_stale, Filter(stale=False), 1_000)
    assert not old_post_filter(unclassified_stale, Filter(stale=True), 1_000)
    assert old_post_filter(at_boundary, Filter(stale=True), 1_000)
    assert not old_post_filter(at_boundary, Filter(stale=False), 1_000)

    print(f"metadata filter pushdown contract check: PASS ({checked:,} cases)")


if __name__ == "__main__":
    main()
