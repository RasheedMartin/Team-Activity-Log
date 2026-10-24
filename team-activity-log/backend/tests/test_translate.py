"""FilterSpec -> Elasticsearch translation, without a cluster."""

import datetime as dt
import json

from tal.search.translate import SearchCtx, effective_sort, translate

CTX = SearchCtx(org_id="org", workspace_ids=["ws"], me="me", can_see_hidden=False, today=dt.date(2026, 10, 24))


def dumps(x) -> str:
    return json.dumps(x, sort_keys=True)


def test_security_filters_always_on():
    t = translate({}, CTX)
    s = dumps(t.query())
    assert '{"term": {"org_id": "org"}}' in s and '{"terms": {"workspace_id": ["ws"]}}' in s and '"published"' in s
    assert '{"term": {"visibility": "visible"}}' in s and '"hidden"' not in s


def test_hidden_only_when_asked_and_only_own_for_members():
    t = translate({"all": [{"field": "visibility", "op": "in", "value": ["hidden"]}]}, CTX)
    s = dumps(t.security)
    assert '"hidden"' in s and '{"term": {"author_id": "me"}}' in s


def test_disjunctive_facets_exclude_their_own_group():
    spec = {"all": [{"field": "tag", "op": "in", "value": ["t1"]}, {"field": "author", "op": "in", "value": ["u1"]}, {"field": "workDate", "op": "between", "value": {"preset": "last_7_days"}}]}
    t = translate(spec, CTX)
    assert "t1" not in dumps(t.except_("tag")) and "u1" in dumps(t.except_("tag"))
    assert "u1" not in dumps(t.except_("author")) and "t1" in dumps(t.except_("author"))
    hist = dumps(t.except_("date"))
    assert "2026-10-18" not in hist and "t1" in hist
    assert '"gte": "2026-10-18"' in dumps(t.except_(None))  # post_filter has everything


def test_image_conditions_must_hold_for_the_same_image():
    spec = {"all": [{"field": "image.type", "op": "in", "value": ["chart"]}, {"field": "image.ocrText", "op": "contains", "value": "keV"}]}
    t = translate(spec, CTX)
    [other] = t.groups["other"]
    [typed] = t.groups["imageType"]
    assert other["nested"]["path"] == "images" and "*kev*" in dumps(other)
    # The type facet's group re-applies the text condition inside the same nested query.
    assert "chart" in dumps(typed) and "*kev*" in dumps(typed)


def test_none_any_and_where():
    spec = {
        "any": [{"field": "hasImages", "op": "eq", "value": True}, {"field": "mine", "op": "eq", "value": True}],
        "none": [{"field": "tag", "op": "in", "value": ["noise"]}],
        "where": {"op": "or", "items": [{"field": "unansweredQuestion", "op": "eq", "value": True}, {"op": "not", "items": [{"field": "hasComments", "op": "eq", "value": True}]}]},
    }
    t = translate(spec, CTX)
    assert '"must_not": [{"terms": {"tag_ids": ["noise"]}}]' in dumps(t.groups["tag"])
    other = dumps(t.groups["other"])
    assert '"minimum_should_match": 1' in other and "unanswered" in other and "comment_count" in other


def test_boolean_text_query():
    t = translate({"q": 'title:drift -pump "detector b"'}, CTX)
    s = dumps(t.text)
    assert '"title^4"' in s and '"must_not"' in s and '"type": "phrase"' in s
    assert t.needles == ["drift", "detector b"]
    assert effective_sort({"q": "x"}) == "relevance" and effective_sort({}) == "newest"


def test_wildcards_in_user_input_are_literal():
    t = translate({"all": [{"field": "image.filename", "op": "contains", "value": "a*b?"}]}, CTX)
    assert r"*a\\*b\\?*" in dumps(t.groups["other"])
