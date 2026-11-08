// Called inside the importer's transaction, after immutable Blob verification.
// Review takes this same item lock before it changes any client identity.
export async function finalizeClientFileImport(tx, { row, sourceCommunity, category, byteSize, sha256, containerName, blobKey }) {
  const current = (await tx`
    select version, match_status, imported_document_id
    from pipeline.client_file_import_items
    where import_item_id = ${row.import_item_id}::uuid
    for update
  `)[0];
  if (!current || Number(current.version) !== Number(row.version)
      || current.match_status !== "confirmed" || current.imported_document_id) return false;

  const inserted = await tx`
    insert into pipeline.documents (
      referral_id, person_id, canonical_client_id, client_display_name, client_community,
      category, file_name, content_type, byte_size, sha256,
      blob_container, blob_key, processing_status, uploaded_by,
      preview_status, malware_scan_status, retention_until,
      source_system, source_external_id, identity_status
    ) values (
      ${row.matched_referral_id}, ${row.matched_person_id}::uuid,
      ${row.matched_canonical_client_id}, ${row.source_client_name}, ${sourceCommunity},
      ${category}, ${row.source_file_name},
      ${row.source_content_type || "application/octet-stream"}, ${byteSize}, ${sha256},
      ${containerName}, ${blobKey}, 'quarantined', 'offline_import_tool',
      'pending', 'pending', now() + interval '7 years',
      ${row.source_system}, ${`${row.import_batch_id}:${row.source_item_id}`}, 'linked'
    )
    on conflict (source_system, source_external_id)
      where source_external_id is not null and deleted_at is null
    do nothing
    returning document_id
  `;
  const documentId = inserted[0]?.document_id ?? (await tx`
    select document_id from pipeline.documents
    where source_system = ${row.source_system}
      and source_external_id = ${`${row.import_batch_id}:${row.source_item_id}`}
      and deleted_at is null
      and person_id is not distinct from ${row.matched_person_id}::uuid
      and referral_id is not distinct from ${row.matched_referral_id}
      and canonical_client_id is not distinct from ${row.matched_canonical_client_id}
      and sha256 = ${sha256} and byte_size = ${byteSize}
      and blob_container = ${containerName} and blob_key = ${blobKey}
    limit 1
    for update
  `)[0]?.document_id;
  if (!documentId) throw new Error("document_identity_conflict");
  await tx`
    insert into pipeline.extraction_jobs (document_id, job_type, status)
    values (${documentId}::uuid, 'document_preview', 'queued')
    on conflict (document_id, job_type) where status in ('queued', 'running')
    do update set next_attempt_at = least(pipeline.extraction_jobs.next_attempt_at, now()), updated_at = now()
  `;
  const updated = await tx`
    update pipeline.client_file_import_items
    set match_status = 'imported', imported_document_id = ${documentId}::uuid,
        version = version + 1, updated_at = now()
    where import_item_id = ${row.import_item_id}::uuid
      and version = ${row.version}
      and match_status = 'confirmed'
      and imported_document_id is null
    returning import_item_id
  `;
  if (updated.length !== 1) throw new Error("import_item_changed");
  return true;
}
