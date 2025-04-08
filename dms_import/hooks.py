# Copyright 2016 Trobz
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

import logging

from odoo.tools import SQL, sql

logger = logging.getLogger(__name__)


def migrate_documents_tag_to_dms_tag(env):
    if not sql.table_exists(env.cr, "documents_tag"):
        return

    logger.info("Importing data from documents.tag to dms.tag")

    env.cr.execute(SQL("SELECT id, name, color FROM documents_tag"))
    document_tags = env.cr.dictfetchall()
    tag_mapping = {}
    for tag in document_tags:
        name_value = (
            tag["name"].get("en_US") if isinstance(tag["name"], dict) else tag["name"]
        )
        env.cr.execute(
            SQL(
                "SELECT id FROM dms_tag WHERE name->>'en_US' = %s LIMIT 1",
                (name_value,),
            )
        )
        result = env.cr.fetchone()
        if result:
            tag_mapping[tag["id"]] = result[0]
        else:
            new_tag = env["dms.tag"].create(
                {
                    "name": name_value,
                    "color": tag["color"],
                }
            )
            tag_mapping[tag["id"]] = new_tag.id
    return tag_mapping


def migrate_documents_folders_to_dms_directories(env):
    if not sql.table_exists(env.cr, "documents_document"):
        return

    logger.info("Importing folder structure from documents.document to dms.directory")
    env.cr.execute(
        SQL("SELECT id FROM dms_storage WHERE save_type = 'database' LIMIT 1")
    )
    db_storage = env.cr.fetchone()
    db_storage_id = db_storage[0] if db_storage else None
    env.cr.execute(
        SQL(
            """
                SELECT id, name, folder_id
                FROM documents_document
                WHERE type = 'folder' AND (active = TRUE OR active = FALSE)
                ORDER BY parent_path
            """
        )
    )
    folders = env.cr.dictfetchall()
    env.cr.execute(SQL("SELECT name FROM dms_directory WHERE is_root_directory = TRUE"))
    existing_root_dirs = set(row[0] for row in env.cr.fetchall())

    folder_mapping = {}
    created_root_count = 0
    dir_created = []
    for folder in folders:
        try:
            is_root = not folder["folder_id"]
            parent_id = (
                folder_mapping.get(folder["folder_id"]) if folder["folder_id"] else None
            )
            vals = {
                "name": folder["name"],
                "parent_id": parent_id,
                "is_root_directory": is_root,
            }
            if is_root and folder["name"] not in existing_root_dirs:
                vals.update(
                    {
                        "storage_id": db_storage_id,
                    }
                )
                created_root_count += 1
                existing_root_dirs.add(folder["name"])
            new_dir = env["dms.directory"].create(vals)
            dir_created.append(new_dir.name)
            folder_mapping[folder["id"]] = new_dir.id
        except Exception as e:
            logger.error(
                "Failed to migrate folder ID %d (%s): %s",
                folder["id"],
                folder["name"],
                str(e),
            )
            env.cr.rollback()
            continue
        logger.info(
            "Successfully migrated %d folders (%d new root directories created)",
            len(folder_mapping),
            created_root_count,
        )
    return folder_mapping


def migrate_documents_to_dms_files(env, folder_mapping, tag_mapping):
    if not sql.table_exists(env.cr, "documents_document"):
        return

    logger.info("Importing files from documents.document to dms.file")
    env.cr.execute(
        SQL(
            """
                SELECT id, name, folder_id, attachment_id
                FROM documents_document
                WHERE type = 'binary' AND active = TRUE
            """
        )
    )
    documents = env.cr.dictfetchall()
    for doc in documents:
        directory_id = (
            folder_mapping.get(doc["folder_id"]) if doc["folder_id"] else None
        )
        file_vals = {
            "name": doc["name"],
            "directory_id": directory_id,
        }
        tag_ids = []
        env.cr.execute(
            SQL(
                f"""
                    SELECT documents_document_id, documents_tag_id
                    FROM document_tag_rel
                    WHERE documents_document_id = {doc["id"]}
                """
            )
        )
        tag_rels = env.cr.fetchall()
        for _, tag_id in tag_rels:
            if tag_id in tag_mapping:
                tag_ids.append(tag_mapping[tag_id])
        if doc["attachment_id"]:
            file_vals.update(
                {
                    "attachment_id": doc["attachment_id"],
                }
            )
        dms_file = env["dms.file"].create(file_vals)
        for tag_id in tag_ids:
            env.cr.execute(
                SQL(
                    f"""
                    INSERT INTO dms_file_tag_rel (fid, tid)
                    VALUES ({dms_file.id}, {tag_id})
                    """,
                )
            )
        if doc["attachment_id"]:
            attachment = env["ir.attachment"].browse(doc["attachment_id"])
            attachment.write(
                {
                    "res_model": "dms.file",
                    "res_id": dms_file.id,
                }
            )


def pre_init_hook(env):
    tag_mapping = migrate_documents_tag_to_dms_tag(env)
    folder_mapping = migrate_documents_folders_to_dms_directories(env)
    migrate_documents_to_dms_files(env, folder_mapping, tag_mapping)
