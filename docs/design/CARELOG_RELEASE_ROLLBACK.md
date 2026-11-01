# Carelog design release: Friday fallback

The owner authorized releasing the completed local redesign on October 31, 2026,
with the option to restore the production version assessors used on Friday,
October 30.

Friday's production build was verified against Azure and deployment history:

- Commit: `0e384174b006e44562676513102a4aca29bfe739`.
- Source tag: `rollback/friday-live-20261030` (pushed to origin).
- Image: `pipelineprodacra6qdvl6ebenac.azurecr.io/pipeline-app:0e384174b006e44562676513102a4aca29bfe739`.
- Digest: `sha256:8a09ffa8258ae14de5b98d242a1eea5e2ed241b7e4b63dca5ce7d0495ddbb6a7`.
- Successful deployment: GitHub Actions run `40362817367`.
- Original revision: `pipeline-prod-web--0e384174b0-r40362817367-1`.

The registry tag is protected against writing and deletion. No database migrations
are included in the redesign. The fallback is an application image rollback;
never restore an older database or remove newly entered client information.
New personal pins and email section ordering may not appear in the old interface.
Desktop launcher icons may remain cached by the operating system after rollback.

## Restoring Friday on the owner's request

1. Check the current release and stop if an unrelated newer release is serving.
   Verify the protected image still resolves to the digest above.
2. Record the current image and revision so the redesign can be restored again.
3. Update only the application image, preserving the current environment, secret
   references, domains, scale, storage, and database:

   ```sh
   az containerapp update --resource-group rg-pipeline-prod --name pipeline-prod-web \
     --image pipelineprodacra6qdvl6ebenac.azurecr.io/pipeline-app:0e384174b006e44562676513102a4aca29bfe739
   ```

4. Verify the latest ready revision serves that exact image, has healthy replicas,
   and receives 100% of traffic. Check `https://alamo-pipeline.com/api/health/live`
   and `https://alamo-pipeline.com/api/health`, and verify the restored interface.
5. Record the restored revision and time. Do not send test mail or alter patient
   records during verification.

Deployment input and safe configuration snapshots are in the release worktree's
ignored `.data/release-carelog-20261031/` directory. The production credentials
remain in Azure; this document contains none.

## Release validation

The October 31 release check passed the full local platform fast gate, production
build, assurance and enterprise gates. Personal pins were also exercised against
a disposable PostgreSQL 16 database, including concurrent updates and assessor
isolation (five tests, no skips).

The six existing visual reference screens were reviewed at their original desktop
and phone sizes: Home, workspaces, client profiles, and intake. Their new reference
images reflect the approved Carelog navigation, typography, colors, and intake
layout. Both macOS Chromium and Linux Chromium in the CI Playwright 1.61.1 image
passed all six comparisons after review. Screenshot assertions, masks, dimensions,
and the 0.002 pixel-difference limit were unchanged. This refresh does not waive
any functional, accessibility, security, or release check.
