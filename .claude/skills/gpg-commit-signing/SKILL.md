---
name: gpg-commit-signing
description: Sign git commits with GPG in non-interactive environments. Use when committing code and the `GPG_PRIVATE_KEY_PASSPHRASE` environment variable is available. Triggers on "commit", "sign commit", "GPG", "git commit -S", or any git operation requiring signed commits.
---

# GPG Commit Signing

Sign commits in headless/non-interactive environments where `/dev/tty` is unavailable.

## Workflow

1. Check whether `GPG_PRIVATE_KEY_PASSPHRASE` is set:

   ```bash
   test -n "$GPG_PRIVATE_KEY_PASSPHRASE" && echo "available" || echo "not set"
   ```

   If not set, skip signing — commit without `-S`.

2. Try a direct signed commit first — the environment may already have loopback pinentry configured:

   ```bash
   git commit -S -m "message"
   ```

   If this succeeds, no further steps are needed.

3. If step 2 fails with a `/dev/tty` error, use `--pinentry-mode loopback` via a wrapper script:

   ```bash
   printf '#!/bin/sh\ngpg --batch --pinentry-mode loopback --passphrase "$GPG_PRIVATE_KEY_PASSPHRASE" "$@"\n' > /tmp/gpg-sign.sh
   chmod +x /tmp/gpg-sign.sh
   git -c gpg.program=/tmp/gpg-sign.sh commit -S -m "message"
   rm /tmp/gpg-sign.sh
   ```

   This passes the passphrase directly to gpg on each signing invocation, bypassing the need for a configured gpg-agent.

## Anti-patterns

- Do not echo or log `GPG_PRIVATE_KEY_PASSPHRASE`.
- Do not commit without `-S` when the passphrase is available — the project expects signed commits.
- Do not leave wrapper scripts on disk after committing.
