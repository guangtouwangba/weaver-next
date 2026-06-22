from fastapi.testclient import TestClient

from weaver_api.main import app


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
    assert meta.json()["features"]["cli_agents"] is True

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
    assert len(data["citations"]) == 2
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
    assert "weaver://source/node_attention" in markdown.text
    assert "## Footnotes" in markdown.text


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
