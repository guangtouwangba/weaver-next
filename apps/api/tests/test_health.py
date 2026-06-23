import json

from fastapi.testclient import TestClient

from weaver_api import main as api_main
from weaver_api.main import DraftCitation, DraftView, _citations_preserved, app
from weaver_core.model.provider import GenerateRequest, TokenEvent


client = TestClient(app)


def test_ping_and_healthz() -> None:
    assert client.get("/ping").json() == {
        "status": "ok",
        "service": "weaver-api",
    }
    assert client.get("/healthz").json() == {"status": "ok"}


def test_meta_and_projects_contract() -> None:
    meta = client.get("/api/v1/meta")
    assert meta.status_code == 200
    assert meta.json()["features"]["cli_agents"] is False

    projects = client.get("/api/v1/projects")
    assert projects.status_code == 200
    assert projects.json()[0]["branch_count"] == 3


def test_project_and_quicknote_mutations() -> None:
    project = client.post(
        "/api/v1/projects",
        json={"title": "Reader attention map"},
    )
    assert project.status_code == 201
    assert project.json()["title"] == "Reader attention map"
    assert project.json()["node_count"] == 1

    quicknote = client.post(
        "/api/v1/quicknotes",
        json={"text": "A quick branch seed"},
    )
    assert quicknote.status_code == 201
    note_id = quicknote.json()["id"]

    promoted = client.post(
        f"/api/v1/quicknotes/{note_id}/promote",
        json={},
    )
    assert promoted.status_code == 201
    assert promoted.json()["project"]["title"] == "A quick branch seed"
    assert promoted.json()["quicknote"]["promoted_project_id"] == promoted.json()["project"]["id"]

    missing = client.post(
        "/api/v1/quicknotes/note_missing/promote",
        json={},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "QUICKNOTE_NOT_FOUND"


def test_tree_forest_context_and_fork_flow() -> None:
    forest = client.get("/api/v1/projects/proj_subscription_fatigue/nodes")
    assert forest.status_code == 200
    node_ids = {node["id"] for node in forest.json()["nodes"]}
    assert {"node_root", "node_demand", "node_supply"}.issubset(node_ids)

    context = client.get("/api/v1/nodes/node_attention/context")
    assert context.status_code == 200
    assert [message["node_id"] for message in context.json()["chain"]] == [
        "node_root",
        "node_demand",
        "node_attention",
    ]
    assert "node_supply" not in [message["node_id"] for message in context.json()["chain"]]

    proposals = client.post("/api/v1/nodes/node_demand/fork/propose", json={})
    assert proposals.status_code == 200
    assert len(proposals.json()["proposals"]) == 2

    stream = client.post(
        "/api/v1/nodes/node_demand/fork/propose",
        json={},
        headers={"Accept": "application/x-ndjson"},
    )
    assert stream.status_code == 200
    events = [json.loads(line) for line in stream.text.splitlines() if line.strip()]
    assert [event["type"] for event in events] == ["message", "structured", "structured", "done"]
    assert events[-1]["structured"]["proposals"][0]["suggested_label"] == "COUNTERPOINT"

    sse = client.post(
        "/api/v1/nodes/node_demand/fork/propose",
        json={},
        headers={"Accept": "text/event-stream"},
    )
    assert sse.status_code == 200
    assert sse.text.startswith(": ping\n\n")
    assert "event: structured" in sse.text
    assert "event: done" in sse.text


def test_fork_proposals_only_receive_ancestor_chain(monkeypatch) -> None:
    captured: list[GenerateRequest] = []

    class SpyProvider:
        async def generate(self, request: GenerateRequest):
            captured.append(request)
            yield TokenEvent(
                type="done",
                seq=0,
                request_id=request.request_id or "spy",
                structured={
                    "proposals": [
                        {
                            "title": "Spy proposal",
                            "prompt": "Only ancestors were visible.",
                            "suggested_label": "SPY",
                        }
                    ]
                },
            )

    monkeypatch.setattr(api_main, "FakeProvider", SpyProvider)

    response = client.post(
        "/api/v1/nodes/node_attention/fork/propose",
        json={},
        headers={"Accept": "application/x-ndjson"},
    )

    assert response.status_code == 200
    seen_content = "\n".join(message.content for message in captured[0].messages)
    assert "Attention is zero-sum" in seen_content
    assert "Bundling could pool audiences" not in seen_content
    assert "Supply-side read" not in seen_content

    forked = client.post(
        "/api/v1/nodes/node_demand/fork",
        json={
            "branches": [
                {
                    "title": "Browser-level attention budget",
                    "body": "Test whether browsers or inboxes are the true bottleneck.",
                    "tag": "DEMAND-SIDE",
                }
            ]
        },
    )
    assert forked.status_code == 201
    assert forked.json()[0]["parent_id"] == "node_demand"

    missing_fork = client.post(
        "/api/v1/nodes/node_missing/fork",
        json={
            "branches": [
                {
                    "title": "Should not exist",
                    "body": "Missing parents must not fabricate children.",
                }
            ]
        },
    )
    assert missing_fork.status_code == 404
    assert missing_fork.json()["error"]["code"] == "NODE_NOT_FOUND"


def test_tree_node_create_backtrack_prune_and_patch_flow() -> None:
    root = client.post(
        "/api/v1/projects/proj_subscription_fatigue/nodes",
        json={
            "title": "Route-created root",
            "body": "A separate root for route tests.",
            "tag": "ROOT QUESTION",
        },
    )
    assert root.status_code == 201
    root_id = root.json()["id"]

    child = client.post(
        "/api/v1/projects/proj_subscription_fatigue/nodes",
        json={
            "parent_id": root_id,
            "title": "Route-created child",
            "body": "A child created through the generic node route.",
            "annotation": "Preserve the human caveat.",
        },
    )
    assert child.status_code == 201
    child_id = child.json()["id"]
    assert child.json()["parent_id"] == root_id
    assert child.json()["annotation"] == "Preserve the human caveat."

    before = client.get("/api/v1/projects/proj_subscription_fatigue/nodes").json()
    branch = client.post(f"/api/v1/nodes/{child_id}/backtrack")
    after = client.get("/api/v1/projects/proj_subscription_fatigue/nodes").json()
    assert branch.status_code == 200
    assert branch.json()["node_ids"] == [root_id, child_id]
    assert before == after

    patched = client.patch(f"/api/v1/nodes/{child_id}", json={"collapsed": True})
    assert patched.status_code == 200
    assert patched.json()["collapsed"] is True

    pruned = client.post(f"/api/v1/nodes/{root_id}/prune")
    assert pruned.status_code == 200
    assert pruned.json()["status"] == "dead_end"
    forest = client.get("/api/v1/projects/proj_subscription_fatigue/nodes").json()
    pruned_child = next(node for node in forest["nodes"] if node["id"] == child_id)
    assert pruned_child["status"] == "dead_end"
    assert pruned_child["collapsed"] is True

    illegal = client.patch(f"/api/v1/nodes/{root_id}", json={"status": "promising"})
    assert illegal.status_code == 409
    assert illegal.json()["error"]["code"] == "ILLEGAL_STATE_TRANSITION"


def test_error_envelope_for_api_errors() -> None:
    response = client.get("/api/v1/backends/backend_missing")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "BACKEND_NOT_FOUND",
            "message": "BACKEND_NOT_FOUND",
            "details": {},
        }
    }


def test_draft_generation_uses_branch_context_and_exports_markdown() -> None:
    draft = client.post(
        "/api/v1/projects/proj_subscription_fatigue/drafts",
        json={
            "source_branch_node_ids": ["node_attention", "node_bundle"],
            "outline_id": None,
            "voice": "Professional",
            "format": "Article",
        },
    )
    assert draft.status_code == 201
    data = draft.json()
    assert data["source_branch_node_ids"] == ["node_attention", "node_bundle"]
    assert data["voice"] == "Professional"
    assert data["grounded"] is False
    assert data["citations"] == []
    demand_paragraph = data["paragraphs"][1]
    assert "Attention is zero-sum" in demand_paragraph
    assert "Bundling could pool audiences" not in demand_paragraph

    export = client.post(
        f"/api/v1/drafts/{data['id']}/exports",
        json={"target": "markdown"},
    )
    assert export.status_code == 201
    assert export.json()["citations_preserved"] is True

    markdown = client.get(export.json()["download_url"])
    assert markdown.status_code == 200
    assert markdown.headers["content-type"].startswith("text/markdown")
    assert "weaver://source/node_attention" not in markdown.text
    assert "## Footnotes" not in markdown.text


def test_outline_draft_does_not_fallback_to_hardcoded_branch_ids() -> None:
    draft = client.post(
        "/api/v1/projects/proj_subscription_fatigue/drafts",
        json={
            "source_branch_node_ids": [],
            "outline_id": "outline_not_implemented_yet",
            "voice": "Academic",
            "format": "Article",
        },
    )

    assert draft.status_code == 201
    data = draft.json()
    assert data["source_branch_node_ids"] == []
    assert data["grounded"] is False
    assert data["citations"] == []
    assert "No branch material was available yet" in data["paragraphs"][1]


def test_export_citation_preservation_uses_rendered_refs_and_defs() -> None:
    draft = client.post(
        "/api/v1/projects/proj_subscription_fatigue/drafts",
        json={
            "source_branch_node_ids": ["node_attention"],
            "outline_id": None,
            "voice": "Professional",
            "format": "Article",
        },
    ).json()

    export = client.post(
        f"/api/v1/drafts/{draft['id']}/exports",
        json={"target": "markdown"},
    )

    assert export.status_code == 201
    assert export.json()["citations_preserved"] is True

    cited = DraftView(
        id="draft_unit",
        project_id="proj_subscription_fatigue",
        title="Unit",
        voice="Professional",
        format="Article",
        source_branch_node_ids=["node_attention"],
        paragraphs=["Intro", "Claim"],
        citations=[
            DraftCitation(
                id="c1",
                source_label="Branch context",
                quote="Evidence",
                source_node_id="node_attention",
                deep_link="weaver://source/node_attention#char=0-8",
            )
        ],
        grounded=True,
    )
    assert _citations_preserved(cited, "Claim [^1]\n\n[^1]: Branch context") is True
    assert _citations_preserved(cited, "Claim [^1]\n") is False


def test_backend_settings_crud_default_permissions_and_health() -> None:
    backends = client.get("/api/v1/backends")
    assert backends.status_code == 200
    assert all("api_key" not in backend for backend in backends.json())
    assert sum(1 for backend in backends.json() if backend["is_default"]) == 1

    created = client.post(
        "/api/v1/backends",
        json={
            "name": "Local test CLI",
            "kind": "cli_agent",
            "provider": "local",
            "model": "Default",
            "api_key": "secret-value",
            "is_default": True,
            "permissions": {
                "auto_run_readonly": True,
                "allow_file_edits": False,
                "network_access": True,
            },
        },
    )
    assert created.status_code == 201
    data = created.json()
    assert data["has_api_key"] is True
    assert "secret-value" not in str(data)
    assert data["is_default"] is True

    listed = client.get("/api/v1/backends").json()
    assert sum(1 for backend in listed if backend["is_default"]) == 1

    updated = client.patch(
        f"/api/v1/backends/{data['id']}",
        json={
            "permissions": {
                "auto_run_readonly": False,
                "allow_file_edits": True,
                "network_access": False,
            }
        },
    )
    assert updated.status_code == 200
    assert updated.json()["permissions"]["allow_file_edits"] is True

    health = client.post(f"/api/v1/backends/{data['id']}/health")
    assert health.status_code == 200
    assert health.json()["ok"] is True
