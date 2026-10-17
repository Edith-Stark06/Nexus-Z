"""Stable ring ids across rebuilds.

A ring's first id is a hash of its members (ml/service.py: ring_id), so the id of a ring that gains or loses an account would
change at every rebuild, and a dashboard that holds the old id gets a 404. Here a rebuilt ring keeps the id of the previous
ring it overlaps most, as long as the two share at least `min_shared` accounts and the shared accounts are at least
`min_overlap` of the smaller ring. Each id is used for at most one ring: when a ring splits, the larger part keeps the id and the
other part gets a new one; when rings merge, the best match keeps its id and the other id disappears.
"""


def stable_ids(new: dict[str, frozenset], previous: dict[str, frozenset], min_overlap: float = 0.5,
               min_shared: int = 2) -> dict[str, str]:
    """`new` maps a ring's hash id to its members and `previous` maps the ids served last time to theirs.
    Returns hash id -> the id to serve."""
    if not previous:
        return {h: h for h in new}
    owner: dict[str, list[str]] = {}          # account -> previous ids that contained it
    for pid, members in previous.items():
        for a in members:
            owner.setdefault(a, []).append(pid)
    pairs = []
    for h, members in new.items():
        shared: dict[str, int] = {}
        for a in members:
            for pid in owner.get(a, ()):
                shared[pid] = shared.get(pid, 0) + 1
        for pid, n in shared.items():
            union = len(members) + len(previous[pid]) - n
            if n >= min_shared and n / min(len(members), len(previous[pid])) >= min_overlap:
                pairs.append((n / union, pid, h))
    pairs.sort(key=lambda t: (-t[0], t[1], t[2]))   # best overlap first; ties broken by id so the result is deterministic
    served: dict[str, str] = {}
    used: set[str] = set()
    for _, pid, h in pairs:
        if h not in served and pid not in used:
            served[h] = pid
            used.add(pid)
    for h in new:
        if h not in served:  # no match: keep the hash id, unless an old ring is still using that very id
            served[h] = h if h not in used else h + "x"
    return served
