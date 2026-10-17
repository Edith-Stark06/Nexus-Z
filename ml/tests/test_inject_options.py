import pytest

from ml.bundle import inject_tag, parse_inject_options


def test_options_are_numbers_only_and_parsed_by_type():
    assert parse_inject_options(["aged_share=0.6", "n_rings=120"]) == {"aged_share": 0.6, "n_rings": 120}
    assert parse_inject_options([]) == {}
    with pytest.raises(ValueError):
        parse_inject_options(["kinds=__import__('os')"])   # anything that is not a number is refused


def test_different_generator_settings_never_share_a_snapshot_cache():
    assert inject_tag(0, None) == "-pig0"                 # the existing demo bundle's cache keeps its name
    assert inject_tag(0, {"aged_share": 0.6}) != inject_tag(0, None)
    assert inject_tag(0, {"a": 1, "b": 2}) == inject_tag(0, {"b": 2, "a": 1})
