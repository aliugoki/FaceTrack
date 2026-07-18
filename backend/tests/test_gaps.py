"""Unit tests for the stream-gap detection state machine (GapDetector).

GapDetector is deliberately I/O-free (see gaps.py), so these tests need no DB or
network. Run under pytest (`python -m pytest backend/tests/test_gaps.py`) or
directly (`python backend/tests/test_gaps.py`).
"""
import datetime

from app.modules.pipeline.gaps import GapDetector

T0 = datetime.datetime(2026, 1, 1, 12, 0, 0)


def _at(sec):
    return T0 + datetime.timedelta(seconds=sec)


def test_opens_only_after_open_after_consecutive_stale():
    d = GapDetector(open_after=3, close_after=2)
    assert d.observe("cam", True, _at(0)) is None   # 1 stale
    assert d.observe("cam", True, _at(1)) is None    # 2 stale
    ev = d.observe("cam", True, _at(2))              # 3rd stale -> open
    assert ev is not None and ev[0] == "open"


def test_gap_start_is_the_first_stale_moment_not_the_confirming_poll():
    d = GapDetector(open_after=3, close_after=2)
    d.observe("cam", True, _at(10))   # first stale @10
    d.observe("cam", True, _at(20))
    ev = d.observe("cam", True, _at(30))   # confirmed @30
    assert ev == ("open", _at(10))          # backdated to the first stale moment


def test_closes_only_after_close_after_consecutive_healthy():
    d = GapDetector(open_after=3, close_after=2)
    for s in (0, 1, 2):
        d.observe("cam", True, _at(s))      # open
    assert d.observe("cam", False, _at(3)) is None   # 1 healthy — not yet
    ev = d.observe("cam", False, _at(4))             # 2nd healthy -> close
    assert ev == ("close", _at(0), _at(4))           # (start, end)


def test_single_healthy_poll_resets_stale_run_flapping_does_not_open():
    d = GapDetector(open_after=3, close_after=2)
    d.observe("cam", True, _at(0))
    d.observe("cam", True, _at(1))
    d.observe("cam", False, _at(2))         # recovers before confirming -> reset
    assert d.observe("cam", True, _at(3)) is None    # counter restarted
    assert d.observe("cam", True, _at(4)) is None
    ev = d.observe("cam", True, _at(5))              # needs 3 fresh stales
    assert ev == ("open", _at(3))


def test_keys_are_tracked_independently():
    d = GapDetector(open_after=2, close_after=2)
    assert d.observe("a", True, _at(0)) is None
    assert d.observe("b", True, _at(0)) is None
    assert d.observe("a", True, _at(1))[0] == "open"   # a opens
    assert d.observe("b", False, _at(1)) is None       # b unaffected, still closed


def test_no_close_event_without_a_prior_open():
    d = GapDetector(open_after=3, close_after=2)
    for s in range(5):
        assert d.observe("cam", False, _at(s)) is None   # healthy throughout


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
