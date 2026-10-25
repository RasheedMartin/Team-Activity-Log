"""Testing mode (owner request): pricing hidden, no trials (Free's limits hold), and an optional
sign-up code so only invited testers can create accounts."""

import pytest

from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)


@pytest.fixture
def testing_mode(monkeypatch):
    from tal import config

    def apply(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        config.get_settings.cache_clear()

    yield apply
    config.get_settings.cache_clear()


async def test_pricing_hidden_means_no_trial_and_public_flags_say_so(client, testing_mode):
    testing_mode(PRICING_PUBLIC="false", TRIAL_DAYS="14")
    assert (await client.get("/v1/auth/providers")).json() == {"google": True, "pricing": False, "signupCode": False}
    me = await signup(client, "tester@example.test")
    plan = (await client.get(f"/v1/orgs/{me['orgs'][0]['org']['id']}/plan")).json()
    assert plan["plan"] == "free" and not plan.get("trial")  # Free's limits apply while testing


async def test_signup_code_gates_new_accounts(client, testing_mode):
    testing_mode(SIGNUP_CODE="lab-2026")
    body = {"name": "Tess", "email": "tess@example.test", "password": "correct-horse"}
    r = await client.post("/v1/auth/register", json=body)
    assert r.status_code == 403 and r.json()["code"] == "signup_code"
    assert (await client.post("/v1/auth/register", json={**body, "signupCode": "wrong"})).status_code == 403
    assert (await client.post("/v1/auth/register", json={**body, "signupCode": "lab-2026"})).status_code == 201
    assert (await client.get("/v1/auth/providers")).json()["signupCode"] is True
