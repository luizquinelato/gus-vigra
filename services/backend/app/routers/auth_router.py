"""
auth_router.py
==============
POST /api/v1/auth/login        →  Proxy para o Auth Service + retorna cores do tenant.
POST /api/v1/auth/logout       →  Invalida sessão no Auth Service (stateful).
POST /api/v1/auth/ott          →  Gera One-Time Token para SSO → ETL (admin only).
POST /api/v1/auth/exchange-ott →  Troca OTT por JWT (ETL frontend, sem auth).
"""
import json
import logging
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.limiter import limiter
from app.dependencies.auth import require_authentication
from app.schemas.auth_schemas import (
    LoginRequest, LoginResponse, UserResponse, TenantColorsPayload, ColorSchemeResponse
)
from app.services.color_service import get_all_colors_unified, get_tenant_color_schema_mode
from app.services.user_service import get_user_by_id

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter()


@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/minute")
async def login(request: Request, credentials: LoginRequest, db: AsyncSession = Depends(get_db_session)):
    """Delega autenticação ao Auth Service e retorna token + cores do tenant."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{settings.AUTH_SERVICE_URL}/api/v1/auth/login",
                json={"email": credentials.email, "password": credentials.password},
            )
            if resp.status_code == 401:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha inválidos.")
            resp.raise_for_status()
        except httpx.RequestError as exc:
            logger.error("Auth service unreachable: %s", exc)
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Auth service indisponível.")

    data = resp.json()
    user = data["user"]
    tenant_id = user["tenant_id"]

    # Busca as cores do tenant
    all_colors = await get_all_colors_unified(db, tenant_id)
    schema_mode = await get_tenant_color_schema_mode(db, tenant_id)

    # Filtra apenas as cores do schema_mode ativo
    colors = [c for c in all_colors if c["color_schema_mode"] == schema_mode]

    return LoginResponse(
        access_token=data["access_token"],
        token_type="bearer",
        user=UserResponse(**user),
        tenant_colors=TenantColorsPayload(
            color_schema_mode=schema_mode,
            colors=[ColorSchemeResponse(**c) for c in colors],
        ),
    )


@router.post("/logout")
async def logout(request: Request):
    """Invalida a sessão no Auth Service.

    NÃO requer autenticação — logout deve funcionar mesmo com token expirado.
    O Auth Service valida a assinatura do JWT (sem verificar expiração) e
    invalida a sessão pelo `sid` embutido no payload.
    """
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.split(" ", 1)[-1] if auth_header.startswith("Bearer ") else ""

    if not token:
        return {"detail": "Logout realizado com sucesso."}

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{settings.AUTH_SERVICE_URL}/api/v1/auth/logout",
                json={"token": token},
                headers={"X-Internal-Key": settings.INTERNAL_API_KEY},
            )
            if resp.status_code != 200:
                logger.warning("Auth-service logout returned %s: %s", resp.status_code, resp.text)
        except Exception as exc:
            logger.warning("Could not reach auth-service on logout: %s", exc)

    return {"detail": "Logout realizado com sucesso."}



