"""
modules/cadastros/router.py
===========================
Endpoints REST do módulo Cadastros.

Convenções
----------
- Prefixo (ModuleRegistry): /api/v1/modules/cadastros
- Auth: todas as rotas exigem autenticação (require_authentication).
- Tenant é SEMPRE inferido do JWT — nunca aceito no payload.
- Soft delete via PATCH .../{id} { "active": false } — sem DELETE físico.
- Eventos best-effort emitidos após COMMIT (EventBus.emit), nunca em transação.

Estrutura
---------
  /categories                       GET POST          lista, cria
  /categories/{id}                  GET PATCH         detalhe, atualiza/soft-delete
  /tags                             GET POST          lista, cria
  /tags/{id}                        GET PATCH         detalhe, atualiza/soft-delete
  /product-families                 GET POST          lista, cria (catálogo)
  /product-families/{id}            PATCH             atualiza/soft-delete
  /product-characteristics          GET POST          lista, cria (catálogo)
  /product-characteristics/{id}     PATCH             atualiza (type imutável)
  /product-characteristics/{id}/values  GET POST      lista/cria valor
  /characteristic-values/{id}       PATCH             atualiza valor
  /products                         GET POST          lista, cria (modelo flat)
  /products/bulk                    POST              cria N produtos com mesmo family_id
  /products/{id}                    GET PATCH         detalhe, atualiza/soft-delete
  /products/{pid}/characteristics   GET PUT           lista links, substitui em lote
  /products/{pid}/tags              POST              vincula tag
  /products/{pid}/tags/{tid}        DELETE            desvincula
  /products/{kid}/kit-items         GET POST          lista/adiciona componente do kit
  /kit-items/{id}                   PATCH             atualiza componente
  /products/{pid}/images            GET POST          lista/anexa imagem (registra URL)
  /products/upload-image            POST (multipart)  upload + retorna URL p/ uso
  /images/{id}                      PATCH             atualiza imagem (alt, ordem, ativa)
  /price-tables                     GET POST          lista, cria
  /price-tables/{id}                GET PATCH         detalhe, atualiza
  /price-tables/{id}/items          GET POST          itens
  /price-table-items/{id}           PATCH             atualiza item
  /promotions                       GET POST          lista, cria
  /promotions/{id}                  GET PATCH         detalhe, atualiza
  /campaigns                        GET POST          lista, cria
  /campaigns/{id}                   GET PATCH         detalhe, atualiza
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.event_bus import EventBus
from app.dependencies.auth import require_authentication
from app.modules.cadastros import events as evt
from app.modules.cadastros.schemas import (
    CampaignCreate, CampaignOut, CampaignUpdate,
    CategoryCreate, CategoryOut, CategoryUpdate,
    CharacteristicCreate, CharacteristicLinkCreate, CharacteristicLinkOut,
    CharacteristicOut, CharacteristicUpdate,
    CharacteristicValueCreate, CharacteristicValueOut, CharacteristicValueUpdate,
    FamilyCreate, FamilyOut, FamilyUpdate,
    KitItemCreate, KitItemOut, KitItemUpdate,
    PriceTableCreate, PriceTableItemCreate, PriceTableItemOut,
    PriceTableItemUpdate, PriceTableOut, PriceTableUpdate,
    ProductBulkCreate, ProductCreate, ProductImageCreate, ProductImageOut,
    ProductImageUpdate, ProductOut, ProductUpdate,
    PromotionCreate, PromotionOut, PromotionUpdate,
    TagCreate, TagLinkCreate, TagLinkOut, TagOut, TagUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_set_clause(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Monta cláusula 'SET col=:col, ...' apenas com campos não-nulos. Inclui last_updated_at."""
    cols = [f"{k} = :{k}" for k in payload.keys()]
    cols.append("last_updated_at = NOW()")
    return ", ".join(cols), payload


async def _fetch_one(db: AsyncSession, sql: str, params: dict) -> dict | None:
    row = (await db.execute(text(sql), params)).fetchone()
    return dict(row._mapping) if row else None


async def _fetch_all(db: AsyncSession, sql: str, params: dict) -> list[dict]:
    rows = (await db.execute(text(sql), params)).fetchall()
    return [dict(r._mapping) for r in rows]


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    sql = """
        SELECT * FROM product_categories
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY name
    """
    return await _fetch_all(db, sql, {"tid": user["tenant_id"], "active_only": only_active})


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(
    body: CategoryCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO product_categories (name, slug, icon, parent_id, tenant_id)
            VALUES (:name, :slug, :icon, :parent_id, :tid)
            RETURNING *
            """,
            {**body.model_dump(), "tid": user["tenant_id"]},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Slug já existe ou parent_id inválido: {exc.orig}")


@router.get("/categories/{category_id}", response_model=CategoryOut)
async def get_category(
    category_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM product_categories WHERE id = :id AND tenant_id = :tid",
        {"id": category_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria não encontrada.")
    return row


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": category_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE product_categories SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria não encontrada.")
    await db.commit()
    return row



# ── Tags ──────────────────────────────────────────────────────────────────────

@router.get("/tags", response_model=list[TagOut])
async def list_tags(
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    sql = """
        SELECT * FROM product_tags
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY name
    """
    return await _fetch_all(db, sql, {"tid": user["tenant_id"], "active_only": only_active})


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
async def create_tag(
    body: TagCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO product_tags (name, slug, tenant_id)
            VALUES (:name, :slug, :tid)
            RETURNING *
            """,
            {**body.model_dump(), "tid": user["tenant_id"]},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Slug já existe: {exc.orig}")


@router.get("/tags/{tag_id}", response_model=TagOut)
async def get_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM product_tags WHERE id = :id AND tenant_id = :tid",
        {"id": tag_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag não encontrada.")
    return row


@router.patch("/tags/{tag_id}", response_model=TagOut)
async def update_tag(
    tag_id: int,
    body: TagUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": tag_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE product_tags SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag não encontrada.")
    await db.commit()
    return row


# ── Families ──────────────────────────────────────────────────────────────────

@router.get("/product-families", response_model=list[FamilyOut])
async def list_families(
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    sql = """
        SELECT * FROM product_families
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY sort_order, name
    """
    return await _fetch_all(db, sql, {"tid": user["tenant_id"], "active_only": only_active})


@router.post("/product-families", response_model=FamilyOut, status_code=status.HTTP_201_CREATED)
async def create_family(
    body: FamilyCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO product_families (name, sort_order, tenant_id)
            VALUES (:name, :sort_order, :tid)
            RETURNING *
            """,
            {**body.model_dump(), "tid": user["tenant_id"]},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Família já existe: {exc.orig}")


@router.patch("/product-families/{family_id}", response_model=FamilyOut)
async def update_family(
    family_id: int,
    body: FamilyUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": family_id, "tid": user["tenant_id"]})
    try:
        row = await _fetch_one(db,
            f"UPDATE product_families SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
            params,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Conflito ao atualizar família: {exc.orig}")
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Família não encontrada.")
    await db.commit()
    return row


# ── Characteristics & Values ──────────────────────────────────────────────────

@router.get("/product-characteristics", response_model=list[CharacteristicOut])
async def list_characteristics(
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    sql = """
        SELECT * FROM product_characteristics
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY sort_order, name
    """
    return await _fetch_all(db, sql, {"tid": user["tenant_id"], "active_only": only_active})


@router.post("/product-characteristics",
             response_model=CharacteristicOut, status_code=status.HTTP_201_CREATED)
async def create_characteristic(
    body: CharacteristicCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO product_characteristics (name, type, sort_order, tenant_id)
            VALUES (:name, :type, :sort_order, :tid)
            RETURNING *
            """,
            {**body.model_dump(), "tid": user["tenant_id"]},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Característica já existe: {exc.orig}")


@router.patch("/product-characteristics/{characteristic_id}", response_model=CharacteristicOut)
async def update_characteristic(
    characteristic_id: int,
    body: CharacteristicUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    # `type` é imutável após criação — schema já não expõe o campo no Update.
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": characteristic_id, "tid": user["tenant_id"]})
    try:
        row = await _fetch_one(db,
            f"UPDATE product_characteristics SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
            params,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Conflito ao atualizar característica: {exc.orig}")
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Característica não encontrada.")
    await db.commit()
    return row


@router.get("/product-characteristics/{characteristic_id}/values",
            response_model=list[CharacteristicValueOut])
async def list_characteristic_values(
    characteristic_id: int,
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    owner = await _fetch_one(db,
        "SELECT 1 FROM product_characteristics WHERE id = :id AND tenant_id = :tid",
        {"id": characteristic_id, "tid": user["tenant_id"]},
    )
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Característica não encontrada.")
    sql = """
        SELECT * FROM product_characteristic_values
        WHERE  characteristic_id = :cid
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY sort_order, value
    """
    return await _fetch_all(db, sql, {"cid": characteristic_id, "active_only": only_active})


@router.post("/product-characteristics/{characteristic_id}/values",
             response_model=CharacteristicValueOut, status_code=status.HTTP_201_CREATED)
async def create_characteristic_value(
    characteristic_id: int,
    body: CharacteristicValueCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    owner = await _fetch_one(db,
        "SELECT 1 FROM product_characteristics WHERE id = :id AND tenant_id = :tid",
        {"id": characteristic_id, "tid": user["tenant_id"]},
    )
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Característica não encontrada.")
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO product_characteristic_values
                   (value, hex_color, numeric_value, unit, sort_order, characteristic_id)
            VALUES (:value, :hex_color, :numeric_value, :unit, :sort_order, :cid)
            RETURNING *
            """,
            {**body.model_dump(), "cid": characteristic_id},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Valor já existe: {exc.orig}")


@router.patch("/characteristic-values/{value_id}", response_model=CharacteristicValueOut)
async def update_characteristic_value(
    value_id: int,
    body: CharacteristicValueUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": value_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"""
        UPDATE product_characteristic_values SET {set_clause}
        WHERE  id = :id
          AND  characteristic_id IN (SELECT id FROM product_characteristics WHERE tenant_id = :tid)
        RETURNING *
        """,
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Valor não encontrado.")
    await db.commit()
    return row


# ── Products (modelo flat) ────────────────────────────────────────────────────

_PRODUCT_INSERT_COLS = [
    "code", "name", "family_id", "barcode", "price", "cost",
    "unit", "type", "brand", "slug", "description", "short_description",
    "ncm", "weight_kg", "height_cm", "width_cm", "depth_cm",
    "meta_title", "meta_description", "category_id",
]


async def _assert_family_owned(db: AsyncSession, family_id: int | None, tenant_id: int) -> None:
    """Garante que a família (se informada) pertence ao tenant."""
    if family_id is None:
        return
    owner = await _fetch_one(db,
        "SELECT 1 FROM product_families WHERE id = :id AND tenant_id = :tid",
        {"id": family_id, "tid": tenant_id},
    )
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Família não encontrada.")


async def _insert_characteristic_links(
    db: AsyncSession, product_id: int, links: list[dict[str, int]], tenant_id: int,
) -> None:
    """Valida ownership de characteristic+value e insere os vínculos."""
    if not links:
        return
    for link in links:
        ok = await _fetch_one(db,
            """
            SELECT
                (SELECT 1 FROM product_characteristics       WHERE id = :cid AND tenant_id = :tid) AS c_ok,
                (SELECT 1 FROM product_characteristic_values WHERE id = :vid
                          AND characteristic_id = :cid)                                            AS v_ok
            """,
            {"cid": link["characteristic_id"], "vid": link["value_id"], "tid": tenant_id},
        )
        if not ok or not ok.get("c_ok") or not ok.get("v_ok"):
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                "Característica ou valor inválido para este tenant.")
        await db.execute(
            text("""
                INSERT INTO product_characteristic_links
                       (product_id, characteristic_id, value_id, tenant_id)
                VALUES (:pid, :cid, :vid, :tid)
            """),
            {"pid": product_id, "cid": link["characteristic_id"],
             "vid": link["value_id"], "tid": tenant_id},
        )


@router.get("/products", response_model=list[ProductOut])
async def list_products(
    only_active: bool = Query(default=True),
    category_id: int | None = Query(default=None),
    family_id: int | None = Query(default=None, description="Filtra por família exata"),
    search: str | None = Query(default=None, description="Busca em name/brand/code (ILIKE)"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    sql = """
        SELECT * FROM products
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
          AND  (CAST(:cat_id AS INTEGER) IS NULL OR category_id = CAST(:cat_id AS INTEGER))
          AND  (CAST(:fid    AS INTEGER) IS NULL OR family_id   = CAST(:fid    AS INTEGER))
          AND  (CAST(:q     AS TEXT)    IS NULL
                OR name  ILIKE CAST(:q AS TEXT)
                OR brand ILIKE CAST(:q AS TEXT)
                OR code  ILIKE CAST(:q AS TEXT))
        ORDER  BY family_id NULLS LAST, name
        LIMIT  :limit OFFSET :offset
    """
    return await _fetch_all(db, sql, {
        "tid": user["tenant_id"], "active_only": only_active, "cat_id": category_id,
        "fid": family_id, "q": f"%{search}%" if search else None,
        "limit": limit, "offset": offset,
    })


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: ProductCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    await _assert_family_owned(db, body.family_id, user["tenant_id"])
    cols = ", ".join(_PRODUCT_INSERT_COLS) + ", tenant_id"
    placeholders = ", ".join(f":{c}" for c in _PRODUCT_INSERT_COLS) + ", :tid"
    params = {**body.model_dump(), "tid": user["tenant_id"]}
    try:
        row = await _fetch_one(db,
            f"INSERT INTO products ({cols}) VALUES ({placeholders}) RETURNING *",
            params,
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Código/slug já existe ou categoria inválida: {exc.orig}")

    # Best-effort event AFTER commit.
    await EventBus.emit(evt.EVT_PRODUCT_CREATED, {
        "product_id": row["id"], "tenant_id": user["tenant_id"],
        "name": row["name"], "type": row["type"], "family_id": row["family_id"],
    })
    return row


@router.post("/products/bulk", response_model=list[ProductOut],
             status_code=status.HTTP_201_CREATED)
async def bulk_create_products(
    body: ProductBulkCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """Wizard de combinatória: cria N produtos atomicamente com mesmo `family_id`,
    aplicando opcionalmente characteristic links por item."""
    if not body.items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lista de produtos vazia.")

    await _assert_family_owned(db, body.family_id, user["tenant_id"])

    cols = ", ".join(_PRODUCT_INSERT_COLS) + ", tenant_id"
    placeholders = ", ".join(f":{c}" for c in _PRODUCT_INSERT_COLS) + ", :tid"
    sql = f"INSERT INTO products ({cols}) VALUES ({placeholders}) RETURNING *"

    created: list[dict] = []
    try:
        for item in body.items:
            payload = item.model_dump(exclude={"characteristics"})
            if body.family_id and not payload.get("family_id"):
                payload["family_id"] = body.family_id
            params = {**payload, "tid": user["tenant_id"]}
            row = await _fetch_one(db, sql, params)
            created.append(row)
            if item.characteristics:
                await _insert_characteristic_links(
                    db, row["id"],
                    [c.model_dump() for c in item.characteristics],
                    user["tenant_id"],
                )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Código/slug duplicado no lote: {exc.orig}")

    await EventBus.emit(evt.EVT_PRODUCT_BULK_CREATED, {
        "tenant_id": user["tenant_id"], "family_id": body.family_id,
        "product_ids": [r["id"] for r in created],
    })
    return created


@router.get("/products/{product_id}", response_model=ProductOut)
async def get_product(
    product_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM products WHERE id = :id AND tenant_id = :tid",
        {"id": product_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado.")
    return row


@router.patch("/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: int,
    body: ProductUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")

    if "family_id" in payload:
        await _assert_family_owned(db, payload["family_id"], user["tenant_id"])

    set_clause, params = _build_set_clause(payload)
    params.update({"id": product_id, "tid": user["tenant_id"]})

    try:
        row = await _fetch_one(db,
            f"UPDATE products SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
            params,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Conflito ao atualizar: {exc.orig}")
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado.")
    await db.commit()

    fields_changed = list(payload.keys())
    event_name = evt.EVT_PRODUCT_DELETED if payload.get("active") is False else evt.EVT_PRODUCT_UPDATED
    await EventBus.emit(event_name, {
        "product_id": product_id, "tenant_id": user["tenant_id"],
        "fields_changed": fields_changed,
    })
    return row


# ── Product ↔ Characteristic Links ────────────────────────────────────────────

@router.get("/products/{product_id}/characteristics",
            response_model=list[CharacteristicLinkOut])
async def list_product_characteristics(
    product_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    owner = await _fetch_one(db,
        "SELECT 1 FROM products WHERE id = :id AND tenant_id = :tid",
        {"id": product_id, "tid": user["tenant_id"]},
    )
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado.")
    return await _fetch_all(db,
        """
        SELECT * FROM product_characteristic_links
        WHERE  product_id = :pid AND tenant_id = :tid
        ORDER  BY characteristic_id
        """,
        {"pid": product_id, "tid": user["tenant_id"]},
    )


@router.put("/products/{product_id}/characteristics",
            response_model=list[CharacteristicLinkOut])
async def replace_product_characteristics(
    product_id: int,
    body: list[CharacteristicLinkCreate],
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """Substitui em lote todos os links de characteristics do produto.
    Implementação: DELETE + INSERT na mesma transação."""
    owner = await _fetch_one(db,
        "SELECT 1 FROM products WHERE id = :id AND tenant_id = :tid",
        {"id": product_id, "tid": user["tenant_id"]},
    )
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado.")
    try:
        await db.execute(
            text("DELETE FROM product_characteristic_links WHERE product_id = :pid AND tenant_id = :tid"),
            {"pid": product_id, "tid": user["tenant_id"]},
        )
        await _insert_characteristic_links(
            db, product_id, [b.model_dump() for b in body], user["tenant_id"],
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail=f"Característica duplicada para o produto: {exc.orig}")
    return await _fetch_all(db,
        """
        SELECT * FROM product_characteristic_links
        WHERE  product_id = :pid AND tenant_id = :tid
        ORDER  BY characteristic_id
        """,
        {"pid": product_id, "tid": user["tenant_id"]},
    )



# ── Kit Items (composição quando type='kit') ──────────────────────────────────

@router.get("/products/{kit_id}/kit-items", response_model=list[KitItemOut])
async def list_kit_items(
    kit_id: int,
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    owner = await _fetch_one(db,
        "SELECT 1 FROM products WHERE id = :id AND tenant_id = :tid",
        {"id": kit_id, "tid": user["tenant_id"]},
    )
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado.")
    sql = """
        SELECT ki.*
        FROM   product_kit_items ki
        WHERE  ki.kit_id = :kid
          AND  (:active_only = FALSE OR ki.active = TRUE)
        ORDER  BY ki.id
    """
    return await _fetch_all(db, sql, {"kid": kit_id, "active_only": only_active})


@router.post("/products/{kit_id}/kit-items",
             response_model=KitItemOut, status_code=status.HTTP_201_CREATED)
async def add_kit_item(
    kit_id: int,
    body: KitItemCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    if kit_id == body.component_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kit não pode conter ele mesmo.")
    # Confere ownership do kit e do componente dentro do tenant.
    ok = await _fetch_one(db,
        """
        SELECT
            (SELECT type FROM products WHERE id = :kid AND tenant_id = :tid) AS kit_type,
            (SELECT 1    FROM products WHERE id = :cid AND tenant_id = :tid) AS comp_ok
        """,
        {"kid": kit_id, "cid": body.component_id, "tid": user["tenant_id"]},
    )
    if not ok or not ok.get("kit_type") or not ok.get("comp_ok"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kit ou componente não encontrados.")
    if ok["kit_type"] != "kit":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Produto pai não está marcado como kit.")
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO product_kit_items (quantity, kit_id, component_id)
            VALUES (:qty, :kid, :cid)
            RETURNING *
            """,
            {"qty": body.quantity, "kid": kit_id, "cid": body.component_id},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Componente já vinculado: {exc.orig}")


@router.patch("/kit-items/{item_id}", response_model=KitItemOut)
async def update_kit_item(
    item_id: int,
    body: KitItemUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": item_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"""
        UPDATE product_kit_items SET {set_clause}
        WHERE  id = :id
          AND  kit_id IN (SELECT id FROM products WHERE tenant_id = :tid)
        RETURNING *
        """,
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item de kit não encontrado.")
    await db.commit()
    return row


# ── Product Images (upload + registro + edição) ───────────────────────────────

PRODUCT_IMAGES_BASE_DIR  = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads", "products")
PRODUCT_IMAGES_URL_PREFIX = "/static/products"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_SIZE_MB   = 5


@router.post("/products/upload-image")
async def upload_product_image(
    file: UploadFile = File(...),
    user: dict = Depends(require_authentication),
):
    """Upload binário (multipart). Retorna { url } para uso em ProductImageCreate."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "Formato inválido. Use JPEG, PNG, WebP ou GIF.")
    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Arquivo muito grande. Limite: {MAX_IMAGE_SIZE_MB}MB.")

    tenant_id = user["tenant_id"]
    tenant_dir = os.path.join(PRODUCT_IMAGES_BASE_DIR, str(tenant_id))
    os.makedirs(tenant_dir, exist_ok=True)

    ext = (file.filename or "image").rsplit(".", 1)[-1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(tenant_dir, filename)
    with open(filepath, "wb") as f:
        f.write(contents)

    url = f"{PRODUCT_IMAGES_URL_PREFIX}/{tenant_id}/{filename}"
    return {"url": url}


@router.get("/products/{product_id}/images", response_model=list[ProductImageOut])
async def list_product_images(
    product_id: int,
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """Lista imagens vinculadas direto ao produto OU à sua família."""
    owner = await _fetch_one(db,
        "SELECT family_id FROM products WHERE id = :id AND tenant_id = :tid",
        {"id": product_id, "tid": user["tenant_id"]},
    )
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado.")
    sql = """
        SELECT * FROM product_images
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
          AND  (product_id = :pid
                OR (CAST(:fid AS INTEGER) IS NOT NULL AND family_id = CAST(:fid AS INTEGER)))
        ORDER  BY sort_order, id
    """
    return await _fetch_all(db, sql, {
        "tid": user["tenant_id"], "pid": product_id,
        "fid": owner.get("family_id"), "active_only": only_active,
    })


@router.post("/products/{product_id}/images",
             response_model=ProductImageOut, status_code=status.HTTP_201_CREATED)
async def attach_product_image(
    product_id: int,
    body: ProductImageCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """Registra uma imagem (já enviada via upload-image) vinculada ao produto OU à família."""
    owner = await _fetch_one(db,
        "SELECT family_id FROM products WHERE id = :id AND tenant_id = :tid",
        {"id": product_id, "tid": user["tenant_id"]},
    )
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado.")

    # Default: vincula ao produto. Se body.family_id vier, vincula à família
    # (compartilhada por todos os produtos daquela família).
    pid = None if body.family_id else product_id
    fid = body.family_id
    if fid is not None:
        await _assert_family_owned(db, fid, user["tenant_id"])
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO product_images (url, alt_text, family_id, sort_order, product_id, tenant_id)
            VALUES (:url, :alt, :fid, :sort, :pid, :tid)
            RETURNING *
            """,
            {"url": body.url, "alt": body.alt_text, "fid": fid,
             "sort": body.sort_order, "pid": pid, "tid": user["tenant_id"]},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Conflito ao salvar imagem: {exc.orig}")


@router.patch("/images/{image_id}", response_model=ProductImageOut)
async def update_product_image(
    image_id: int,
    body: ProductImageUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": image_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE product_images SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagem não encontrada.")
    await db.commit()
    return row


# ── Tag Links (M:N product ↔ tag) ─────────────────────────────────────────────

@router.post("/products/{product_id}/tags",
             response_model=TagLinkOut, status_code=status.HTTP_201_CREATED)
async def link_tag(
    product_id: int,
    body: TagLinkCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    if body.product_id != product_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "product_id no payload diverge da rota.")

    # Confere ownership do product e da tag dentro do tenant.
    ok = await _fetch_one(db,
        """
        SELECT
            (SELECT 1 FROM products      WHERE id = :pid AND tenant_id = :tid) AS prod_ok,
            (SELECT 1 FROM product_tags  WHERE id = :tag AND tenant_id = :tid) AS tag_ok
        """,
        {"pid": product_id, "tag": body.tag_id, "tid": user["tenant_id"]},
    )
    if not ok or not ok.get("prod_ok") or not ok.get("tag_ok"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto ou tag não encontrados.")

    try:
        row = await _fetch_one(db,
            """
            INSERT INTO product_tag_links (product_id, tag_id)
            VALUES (:pid, :tag)
            RETURNING *
            """,
            {"pid": product_id, "tag": body.tag_id},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Vínculo já existe: {exc.orig}")


@router.delete("/products/{product_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_tag(
    product_id: int,
    tag_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    # Hard-delete intencional aqui — vínculo M:N não tem soft-delete útil.
    result = await db.execute(
        text("""
            DELETE FROM product_tag_links
            WHERE  product_id = :pid AND tag_id = :tag
              AND  product_id IN (SELECT id FROM products WHERE tenant_id = :tid)
        """),
        {"pid": product_id, "tag": tag_id, "tid": user["tenant_id"]},
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vínculo não encontrado.")
    return None



# ── Price Tables ──────────────────────────────────────────────────────────────

@router.get("/price-tables", response_model=list[PriceTableOut])
async def list_price_tables(
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    sql = """
        SELECT * FROM price_tables
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY is_default DESC, name
    """
    return await _fetch_all(db, sql, {"tid": user["tenant_id"], "active_only": only_active})


@router.post("/price-tables", response_model=PriceTableOut, status_code=status.HTTP_201_CREATED)
async def create_price_table(
    body: PriceTableCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    params = {**body.model_dump(), "tid": user["tenant_id"]}
    # Garante apenas uma is_default por tenant: desmarca as anteriores se a nova for default.
    if body.is_default:
        await db.execute(
            text("UPDATE price_tables SET is_default = FALSE WHERE tenant_id = :tid AND is_default = TRUE"),
            {"tid": user["tenant_id"]},
        )
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO price_tables (name, type, discount_pct, is_default, tenant_id)
            VALUES (:name, :type, :discount_pct, :is_default, :tid)
            RETURNING *
            """,
            params,
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Já existe uma tabela padrão ativa para este tenant: {exc.orig}")
    return row


@router.get("/price-tables/{table_id}", response_model=PriceTableOut)
async def get_price_table(
    table_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM price_tables WHERE id = :id AND tenant_id = :tid",
        {"id": table_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tabela de preço não encontrada.")
    return row


@router.patch("/price-tables/{table_id}", response_model=PriceTableOut)
async def update_price_table(
    table_id: int,
    body: PriceTableUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    if payload.get("is_default") is True:
        await db.execute(
            text("""
                UPDATE price_tables SET is_default = FALSE
                WHERE  tenant_id = :tid AND is_default = TRUE AND id <> :id
            """),
            {"tid": user["tenant_id"], "id": table_id},
        )
    set_clause, params = _build_set_clause(payload)
    params.update({"id": table_id, "tid": user["tenant_id"]})
    try:
        row = await _fetch_one(db,
            f"UPDATE price_tables SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
            params,
        )
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Tabela de preço não encontrada.")
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Já existe uma tabela padrão ativa para este tenant: {exc.orig}")
    return row


@router.get("/price-tables/{table_id}/items", response_model=list[PriceTableItemOut])
async def list_price_table_items(
    table_id: int,
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    owner = await _fetch_one(db,
        "SELECT 1 FROM price_tables WHERE id = :id AND tenant_id = :tid",
        {"id": table_id, "tid": user["tenant_id"]},
    )
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tabela de preço não encontrada.")
    sql = """
        SELECT * FROM price_table_items
        WHERE  price_table_id = :tid_pt
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY id
    """
    return await _fetch_all(db, sql, {"tid_pt": table_id, "active_only": only_active})


@router.post("/price-tables/{table_id}/items",
             response_model=PriceTableItemOut, status_code=status.HTTP_201_CREATED)
async def create_price_table_item(
    table_id: int,
    body: PriceTableItemCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    if body.price_table_id != table_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "price_table_id no payload diverge da rota.")
    # Confere ownership da tabela e do produto no mesmo tenant.
    ok = await _fetch_one(db,
        """
        SELECT
            (SELECT 1 FROM price_tables WHERE id = :pt  AND tenant_id = :tid) AS pt_ok,
            (SELECT 1 FROM products     WHERE id = :pid AND tenant_id = :tid) AS prod_ok
        """,
        {"pt": table_id, "pid": body.product_id, "tid": user["tenant_id"]},
    )
    if not ok or not ok.get("pt_ok") or not ok.get("prod_ok"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tabela ou produto não encontrados.")
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO price_table_items (price, price_table_id, product_id)
            VALUES (:price, :pt, :pid)
            RETURNING *
            """,
            {"price": body.price, "pt": table_id, "pid": body.product_id},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Item já existe: {exc.orig}")


@router.patch("/price-table-items/{item_id}", response_model=PriceTableItemOut)
async def update_price_table_item(
    item_id: int,
    body: PriceTableItemUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": item_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"""
        UPDATE price_table_items SET {set_clause}
        WHERE  id = :id
          AND  price_table_id IN (SELECT id FROM price_tables WHERE tenant_id = :tid)
        RETURNING *
        """,
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item não encontrado.")
    await db.commit()
    return row



# ── Promotions ────────────────────────────────────────────────────────────────

_PROMO_INSERT_COLS = [
    "name", "type", "value", "min_order_amount", "min_quantity",
    "applies_to", "target_ids", "coupon_code", "max_uses",
    "max_uses_per_client", "stackable", "starts_at", "ends_at",
]


@router.get("/promotions", response_model=list[PromotionOut])
async def list_promotions(
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    sql = """
        SELECT * FROM promotions
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY id DESC
    """
    return await _fetch_all(db, sql, {"tid": user["tenant_id"], "active_only": only_active})


@router.post("/promotions", response_model=PromotionOut, status_code=status.HTTP_201_CREATED)
async def create_promotion(
    body: PromotionCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    cols = ", ".join(_PROMO_INSERT_COLS) + ", tenant_id"
    placeholders = ", ".join(f":{c}" for c in _PROMO_INSERT_COLS) + ", :tid"
    params = body.model_dump()
    params["tid"] = user["tenant_id"]
    try:
        row = await _fetch_one(db,
            f"INSERT INTO promotions ({cols}) VALUES ({placeholders}) RETURNING *",
            params,
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Cupom duplicado ou dado inválido: {exc.orig}")

    await EventBus.emit(evt.EVT_PROMOTION_CREATED, {
        "promotion_id": row["id"], "tenant_id": user["tenant_id"],
        "type": row["type"], "coupon_code": row["coupon_code"],
    })
    return row


@router.get("/promotions/{promo_id}", response_model=PromotionOut)
async def get_promotion(
    promo_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM promotions WHERE id = :id AND tenant_id = :tid",
        {"id": promo_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Promoção não encontrada.")
    return row


@router.patch("/promotions/{promo_id}", response_model=PromotionOut)
async def update_promotion(
    promo_id: int,
    body: PromotionUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": promo_id, "tid": user["tenant_id"]})
    try:
        row = await _fetch_one(db,
            f"UPDATE promotions SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
            params,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Conflito ao atualizar: {exc.orig}")
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Promoção não encontrada.")
    await db.commit()

    if "active" in payload:
        evt_name = evt.EVT_PROMOTION_ACTIVATED if payload["active"] else evt.EVT_PROMOTION_DEACTIVATED
        await EventBus.emit(evt_name, {"promotion_id": promo_id, "tenant_id": user["tenant_id"]})
    return row


# ── Campaigns ─────────────────────────────────────────────────────────────────

_CAMPAIGN_INSERT_COLS = [
    "name", "type", "channel", "status", "scheduled_at",
    "promotion_id", "segment_id", "created_by_agent",
]


@router.get("/campaigns", response_model=list[CampaignOut])
async def list_campaigns(
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    sql = """
        SELECT * FROM campaigns
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY id DESC
    """
    return await _fetch_all(db, sql, {"tid": user["tenant_id"], "active_only": only_active})


@router.post("/campaigns", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    body: CampaignCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    # Se promotion_id informado, valida que pertence ao mesmo tenant.
    if body.promotion_id is not None:
        owner = await _fetch_one(db,
            "SELECT 1 FROM promotions WHERE id = :id AND tenant_id = :tid",
            {"id": body.promotion_id, "tid": user["tenant_id"]},
        )
        if not owner:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Promoção informada não encontrada.")

    cols = ", ".join(_CAMPAIGN_INSERT_COLS) + ", tenant_id"
    placeholders = ", ".join(f":{c}" for c in _CAMPAIGN_INSERT_COLS) + ", :tid"
    params = body.model_dump()
    params["tid"] = user["tenant_id"]
    row = await _fetch_one(db,
        f"INSERT INTO campaigns ({cols}) VALUES ({placeholders}) RETURNING *",
        params,
    )
    await db.commit()

    await EventBus.emit(evt.EVT_CAMPAIGN_CREATED, {
        "campaign_id": row["id"], "tenant_id": user["tenant_id"],
        "channel": row["channel"], "type": row["type"],
    })
    if row["status"] == "scheduled" and row["scheduled_at"] is not None:
        await EventBus.emit(evt.EVT_CAMPAIGN_SCHEDULED, {
            "campaign_id": row["id"], "tenant_id": user["tenant_id"],
            "scheduled_at": row["scheduled_at"],
        })
    return row


@router.get("/campaigns/{campaign_id}", response_model=CampaignOut)
async def get_campaign(
    campaign_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM campaigns WHERE id = :id AND tenant_id = :tid",
        {"id": campaign_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
    return row


@router.patch("/campaigns/{campaign_id}", response_model=CampaignOut)
async def update_campaign(
    campaign_id: int,
    body: CampaignUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    if payload.get("promotion_id") is not None:
        owner = await _fetch_one(db,
            "SELECT 1 FROM promotions WHERE id = :id AND tenant_id = :tid",
            {"id": payload["promotion_id"], "tid": user["tenant_id"]},
        )
        if not owner:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Promoção informada não encontrada.")

    set_clause, params = _build_set_clause(payload)
    params.update({"id": campaign_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE campaigns SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
    await db.commit()

    if payload.get("status") == "scheduled" and row["scheduled_at"] is not None:
        await EventBus.emit(evt.EVT_CAMPAIGN_SCHEDULED, {
            "campaign_id": campaign_id, "tenant_id": user["tenant_id"],
            "scheduled_at": row["scheduled_at"],
        })
    return row
