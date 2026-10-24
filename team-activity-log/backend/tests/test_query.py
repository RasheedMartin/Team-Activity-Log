"""Same cases as frontend/src/lib/query.test.ts: the two parsers must agree."""

from tal.query import parse_boolean, positive_needles, print_query


def p(q: str) -> str:
    return print_query(parse_boolean(q).ast)


def test_implicit_and_last_word_prefix():
    assert p("drift cooldown") == "drift cooldown*"


def test_or_binds_looser():
    assert p("drift noise OR pump") == "drift noise OR pump*"
    ast = parse_boolean("a b OR c").ast
    assert ast["type"] == "or" and ast["children"][0]["type"] == "and" and ast["children"][1]["value"] == "c"


def test_not_and_minus():
    assert p("drift NOT pump") == "drift NOT pump"
    assert p("drift -pump") == "drift NOT pump"
    assert p("signal-to-noise") == "signal-to-noise*"


def test_parens_and_phrases():
    assert p('(drift OR noise) AND "detector b"') == '(drift OR noise) "detector b"'


def test_field_scopes():
    assert p("title:drift comment:(pump OR valve)") == "title:drift (comment:pump OR comment:valve*)"
    assert p('image:"energy (kev)"') == 'image:"energy (kev)"'


def test_explicit_prefix():
    ast = parse_boolean("calib* run").ast
    assert ast["children"][0] == {"type": "term", "value": "calib", "prefix": True}
    assert ast["children"][1]["value"] == "run"


def test_lowercase_operators_are_words():
    assert p("salt and pepper") == "salt and pepper*"


def test_never_raises():
    r = parse_boolean('(drift OR "unclosed')
    assert r.ast is not None
    assert {"Unclosed quote", "Missing )"} <= set(r.errors)
    assert "Unexpected )" in parse_boolean("drift )").errors
    assert parse_boolean("OR").ast is None
    assert parse_boolean("").ast is None


def test_positive_needles():
    assert positive_needles(parse_boolean('drift -pump "detector b" NOT (valve OR leak)').ast) == ["drift", "detector b"]
