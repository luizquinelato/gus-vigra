#!/usr/bin/env python3
"""
Migration 0016: Compras — Settings
===================================
Project : Vigra
Module  : compras
Seeds   : system_settings (purchase_*)

Settings seedados:
- purchase_approval_threshold              : "0" — total <= threshold nasce 'approved'; 0 = toda PO auto-aprovada (perfil MEI).
- purchase_po_number_prefix                : "PO" — formato {prefix}-{YYYY}-{NNNNNN}.
- purchase_auto_create_supplier_from_invoice : "true" — quick-entry com documento desconhecido cria fornecedor stub.
- purchase_default_payment_terms_days      : "30" — prazo padrão quando supplier não tem payment_terms_days.

Depende de 0013 (suppliers), 0015 (purchase_orders) — apenas para coerência da
sequência do módulo Compras.
"""
import logging

logger = logging.getLogger(__name__)

DEFAULT_SETTINGS = [
    ("purchase_approval_threshold",                "0",    "Valor (R$). PO com total <= threshold nasce 'approved'. 0 = toda PO auto-aprovada (MEI)."),
    ("purchase_po_number_prefix",                  "PO",   "Prefixo do po_number. Formato: {prefix}-{YYYY}-{NNNNNN}."),
    ("purchase_auto_create_supplier_from_invoice", "true", "Se 'true', quick-entry com documento desconhecido cria fornecedor stub."),
    ("purchase_default_payment_terms_days",        "30",   "Prazo padrão (dias) quando supplier não tem payment_terms_days."),
]


def apply(conn) -> None:
    logger.info("Applying 0016_compras_settings...")
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM tenants WHERE active = TRUE;")
        tenant_ids = [r["id"] for r in cur.fetchall()]
        for tid in tenant_ids:
            for key, val, desc in DEFAULT_SETTINGS:
                cur.execute(
                    """
                    INSERT INTO system_settings (setting_key, setting_value, description, tenant_id)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (tenant_id, setting_key) DO NOTHING;
                    """,
                    (key, val, desc, tid),
                )
        logger.info("  Settings de Compras seedados para %d tenant(s).", len(tenant_ids))

    logger.info("0016_compras_settings applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0016_compras_settings...")
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM system_settings
            WHERE setting_key IN (
                'purchase_approval_threshold',
                'purchase_po_number_prefix',
                'purchase_auto_create_supplier_from_invoice',
                'purchase_default_payment_terms_days'
            );
            """
        )
    logger.info("0016_compras_settings rolled back.")
