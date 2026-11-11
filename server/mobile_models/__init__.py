"""Account-private API-key models for verified DeepTutor 1.7.1 and 1.7.2.

Install with ``mobile_models.install(app)`` after creating the FastAPI app.
No shared grants, accounts, workspaces, or upstream source files are rewritten.
Credentials live under data/system/user-secrets, outside the sandbox mounts.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import ipaddress
import socket
from urllib.parse import urlsplit
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field


class ProviderInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str | None = Field(default=None, max_length=100)
    name: str = Field(default="", max_length=160)
    binding: str = Field(max_length=80)
    base_url: str = Field(max_length=2048)
    api_format: str = Field(default="auto", max_length=40)
    api_key: str | None = Field(default=None, max_length=8192, repr=False)


class ProfileInput(ProviderInput):
    models: list[str] = Field(min_length=1, max_length=200)


class SelectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: str = Field(max_length=100)
    model_id: str = Field(max_length=200)


def store():
    from deeptutor.multi_user.paths import get_owner_secrets_dir
    from deeptutor.services.config.model_catalog import ModelCatalogService
    return ModelCatalogService.get_instance(get_owner_secrets_dir() / "mobile-models.json")


def personal_profiles():
    from deeptutor.multi_user.context import get_current_user_or_none
    user = get_current_user_or_none()
    if user is None or user.is_admin:
        return []
    service = store()
    return service.load()["services"]["llm"]["profiles"] if service.path.exists() else []


def provider_choices():
    from deeptutor.api.routers.settings import _provider_choices
    from deeptutor.multi_user.model_access import OWNER_BOUND_BINDINGS
    return [row for row in _provider_choices()["llm"]
            if row["value"] not in OWNER_BOUND_BINDINGS
            and row.get("status") != "legacy"
            and row.get("auth_mode") not in {"oauth", "session", "subscription"}]


def private_user():
    from deeptutor.multi_user.context import get_current_user
    user = get_current_user()
    if user.is_admin:
        raise HTTPException(409, "Use shared settings for a deployment administrator.")
    return user


def validate_url(raw: str):
    """Reject embedded credentials and local network targets for personal keys."""
    try:
        parsed = urlsplit(raw)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
            raise ValueError()
    except (ValueError, OSError):
        raise HTTPException(400, "Use a reachable public API base URL without credentials or query parameters.") from None


def prepare_provider(payload: ProviderInput, profiles: list[dict]):
    choice = next((row for row in provider_choices() if row["value"] == payload.binding), None)
    if not choice:
        raise HTTPException(400, "Unsupported API-key provider.")
    if payload.api_format != "auto" and payload.api_format not in choice.get("api_formats", []):
        raise HTTPException(400, "Unsupported API format for this provider.")
    old = next((p for p in profiles if p["id"] == payload.id), None)
    if payload.id and old is None:
        raise HTTPException(404, "Personal provider not found.")
    base = payload.base_url.strip().rstrip("/")
    key = (payload.api_key or "").strip()
    if key and (set(key) <= {"*", "•"} or "\n" in key or "\r" in key):
        raise HTTPException(400, "Enter an actual API key.")
    # Never send an existing secret to a newly entered origin or provider.
    if old and not key and (old.get("base_url") != base or old.get("binding") != payload.binding):
        raise HTTPException(400, "Enter a new API key when changing the API address or provider.")
    validate_url(base)
    return old, {"name": payload.name.strip(), "binding": payload.binding,
                 "base_url": base, "api_format": payload.api_format,
                 "api_key": key or (old or {}).get("api_key", "")}


def public_settings():
    service = store()
    catalog = service.load() if service.path.exists() else {"services": {"llm": {"profiles": []}}}
    bucket = catalog["services"]["llm"]
    # Explicit allowlist: never return keys, headers, paths, or unknown fields.
    profiles = [{**{k: p.get(k, "") for k in ("id", "name", "binding", "base_url", "api_format")},
                 "has_key": bool(p.get("api_key")),
                 "models": [{k: m[k] for k in ("id", "name", "model")} for m in p.get("models", [])]}
                for p in bucket["profiles"]]
    active = {"profile_id": bucket.get("active_profile_id"), "model_id": bucket.get("active_model_id")}
    return {"version": 1, "profiles": profiles, "providers": provider_choices(),
            "active": active if all(active.values()) else None}


def save_profile(payload: ProfileInput):
    user = private_user()
    service = store()
    # The shared service instance serializes the read/modify/write operation.
    with service._lock:
        catalog = service.load()
        bucket = catalog["services"]["llm"]
        profiles = bucket["profiles"]
        old, fields = prepare_provider(payload, profiles)
        names = list(dict.fromkeys(m.strip() for m in payload.models))
        if not fields["name"] or any(not m or len(m) > 300 for m in names):
            raise HTTPException(400, "A provider name and valid model IDs are required.")
        if not fields["api_key"]:
            raise HTTPException(400, "An API key is required.")
        owner = hashlib.sha256(user.id.encode()).hexdigest()[:16]
        profile_id = (old or {}).get("id") or f"mobile-{owner}-{uuid.uuid4().hex}"
        previous = {m["model"]: m for m in (old or {}).get("models", [])}
        models = [previous.get(name) or {"id": "model-" + hashlib.sha256(name.encode()).hexdigest()[:24], "model": name, "name": name} for name in names]
        profile = {**fields, "id": profile_id, "models": models}
        bucket["profiles"] = [profile if p["id"] == profile_id else p for p in profiles] if old else [*profiles, profile]
        if not bucket.get("active_profile_id") or (bucket["active_profile_id"] == profile_id and bucket.get("active_model_id") not in {m["id"] for m in models}):
            bucket.update(active_profile_id=profile_id, active_model_id=models[0]["id"])
        service.save(catalog)
    return public_settings()


def install_runtime():
    from deeptutor.multi_user import personal_models
    if getattr(personal_models._personal_catalog_profiles, "_mobile_models", False):
        return
    original = personal_models._personal_catalog_profiles

    def profiles():
        # Existing OAuth profiles keep their upstream ownership checks.
        own = deepcopy(personal_profiles())
        for profile in own:
            profile["owner_bound"] = True
        return original() + own

    profiles._mobile_models = True
    personal_models._personal_catalog_profiles = profiles


def install(app):
    if getattr(app.state, "mobile_models_installed", False):
        return
    from deeptutor.__version__ import __version__ as upstream_version
    if upstream_version not in {"1.7.1", "1.7.2"}:
        raise RuntimeError("mobile_models must be revalidated for this DeepTutor version")
    from deeptutor.api.routers.auth import require_auth
    from deeptutor.multi_user.model_access import allowed_llm_options
    from deeptutor.multi_user.context import get_current_user

    router = APIRouter(prefix="/api/mobile/models", dependencies=[Depends(require_auth)])

    @router.get("")
    async def settings(response: Response):
        private_user()
        response.headers["Cache-Control"] = "private, no-store"
        return public_settings()

    @router.get("/options")
    async def options(response: Response):
        response.headers["Cache-Control"] = "private, no-store"
        result = allowed_llm_options()
        if not get_current_user().is_admin:
            preferred = public_settings()["active"]
            if preferred and any(all(option.get(k) == v for k, v in preferred.items()) for option in result["options"]):
                result["active"] = preferred
                for option in result["options"]:
                    option["is_active_default"] = all(option.get(k) == v for k, v in preferred.items())
        return result

    @router.post("/discover")
    async def discover(payload: ProviderInput, response: Response):
        private_user()
        response.headers["Cache-Control"] = "private, no-store"
        from deeptutor.services.settings.provider_probe import probe_provider
        _, fields = prepare_provider(payload, personal_profiles())
        if not fields["api_key"]:
            raise HTTPException(400, "An API key is required.")
        result = await probe_provider(binding=fields["binding"], base_url=fields["base_url"],
                                      api_key=fields["api_key"], api_format=fields["api_format"])
        return {"status": result.get("status", "unavailable"),
                "models": [{"id": m["id"]} for m in result.get("models", []) if isinstance(m, dict) and isinstance(m.get("id"), str)]}

    @router.post("/profile")
    async def profile(payload: ProfileInput, response: Response):
        response.headers["Cache-Control"] = "private, no-store"
        return save_profile(payload)

    @router.post("/default")
    async def default(payload: SelectionInput):
        private_user()
        service = store()
        with service._lock:
            catalog = service.load()
            bucket = catalog["services"]["llm"]
            if not any(p["id"] == payload.profile_id and any(m["id"] == payload.model_id for m in p["models"]) for p in bucket["profiles"]):
                raise HTTPException(404, "Personal model not found.")
            bucket.update(active_profile_id=payload.profile_id, active_model_id=payload.model_id)
            service.save(catalog)
        return {"ok": True}

    @router.delete("/profile/{profile_id}")
    async def delete(profile_id: str):
        private_user()
        service = store()
        with service._lock:
            catalog = service.load()
            bucket = catalog["services"]["llm"]
            if not any(p["id"] == profile_id for p in bucket["profiles"]):
                raise HTTPException(404, "Personal provider not found.")
            bucket["profiles"] = [p for p in bucket["profiles"] if p["id"] != profile_id]
            if bucket.get("active_profile_id") == profile_id:
                first = next(iter(bucket["profiles"]), None)
                bucket.update(active_profile_id=first["id"] if first else None,
                              active_model_id=first["models"][0]["id"] if first else None)
            service.save(catalog)
        return {"ok": True}

    install_runtime()
    app.include_router(router)
    app.state.mobile_models_installed = True
