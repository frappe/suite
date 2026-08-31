import frappe


def execute():
    if not frappe.db.table_exists("Meet Recording") or not frappe.db.has_column(
        "Meet Recording", "metadata_accepted_at"
    ):
        return

    frappe.db.sql(
        """
        UPDATE `tabMeet Recording`
        SET
            metadata_accepted_at = COALESCE(metadata_accepted_at, modified),
            finalization_deadline = COALESCE(
                finalization_deadline,
                DATE_ADD(COALESCE(metadata_accepted_at, modified), INTERVAL 24 HOUR)
            ),
            publication_key = COALESCE(publication_key, CONCAT('meet-recording-', name)),
            finalization_stage = COALESCE(
                NULLIF(finalization_stage, ''),
                CASE
                    WHEN upload_id IS NOT NULL AND upload_size > 0 AND upload_offset = upload_size
                    THEN 'Pending'
                    ELSE 'Awaiting Upload'
                END
            ),
            upload_completed_at = CASE
                WHEN upload_id IS NOT NULL AND upload_size > 0 AND upload_offset = upload_size
                THEN COALESCE(upload_completed_at, modified)
                ELSE upload_completed_at
            END,
            finalization_next_retry_at = CASE
                WHEN upload_id IS NOT NULL AND upload_size > 0 AND upload_offset = upload_size
                THEN COALESCE(finalization_next_retry_at, NOW(6))
                ELSE finalization_next_retry_at
            END
        WHERE status = 'Processing'
        """
    )
