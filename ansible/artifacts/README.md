# Deployment artifacts

`deploy.sh` expects two files in this directory, with these exact names:

| File | Where it comes from |
|---|---|
| `tl-commissioning-source.deb` | `./packaging/build-deb.sh` on an Ubuntu 24.04 machine (the bench works), then copy/rename from `dist/` |
| `openavc-state.tgz` | Captured from the reference bench: `sudo systemctl stop openavc && sudo tar czf openavc-state.tgz -C /var/lib openavc && sudo systemctl start openavc` |

Getting them here on the controller (Mac):

```bash
scp tl-demo-1@<bench-ip>:~/video1_content_role_software/dist/tl-commissioning-source_*_amd64.deb \
    ansible/artifacts/tl-commissioning-source.deb
scp tl-demo-1@<bench-ip>:~/openavc-state.tgz ansible/artifacts/openavc-state.tgz
```

Committing them to git: the snapshot is small and fine to commit (it
contains your Programmer password and the TL API token, so only in a
**private** repo). The deb bundles Chromium for PDF rendering and may
exceed GitHub's 100 MB file limit — if `git push` rejects it, attach the
deb to a GitHub Release instead (2 GB limit) and download it into this
directory on the controller, or just `scp` it as above.
