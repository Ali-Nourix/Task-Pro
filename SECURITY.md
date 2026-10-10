# Security and privacy

## Sharing builds and diagnostics

Installable packages contain only `main.js`, `manifest.json` and `styles.css`. Do not distribute your vault, `.obsidian/`, plugin `data.json`, `.env` files, Supabase CLI state, database exports or deployment logs. The Telegram sync token is intentionally stored in local plugin settings; it is not encrypted by this plugin. Protect and redact that file before sharing.

Runtime console diagnostics contain fixed event messages only. Exception objects and provider error bodies may contain credentials, note paths or task text and must not be logged. The sync service reports locally generated messages, never arbitrary server/transport error strings. Command failures sent back to the bot use a fixed message. Task text and paths are still sent to your configured backend when Telegram sync is enabled: this is its intended function, not anonymous telemetry.

Use your own Supabase project. Link it locally with `supabase link --project-ref YOUR_PROJECT_REF` or set `SUPABASE_PROJECT_REF` for the Windows updater. Set backend secrets using your provider's secret store, never in committed scripts. When seeking help, redact project identifiers, credentials and personal task content.

## Before making an existing repository public

A clean working tree is not a clean history. Audit all Git refs and historical blobs, author/committer emails and commit messages, PR/issue descriptions and comments, tags, release assets, Actions logs/artifacts, screenshots and caches. Removing branches or adding `.gitignore` does not remove earlier commits or published assets.

Run a current secret scanner on both files and the complete authenticated Git history, with redacted reports. If a credential was committed, revoke/rotate it first; deletion or history rewriting is not revocation. Coordinate any destructive history cleanup with collaborators. Alternatively keep the original repository private and publish a separately audited source snapshot in a new public repository with no private history or artifacts.

Do not post credentials in public issues. Report a potential exposure privately to the repository owner and omit the secret itself from the report.
