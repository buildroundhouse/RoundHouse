# Phone preview without keeping a terminal tab open

In the repository root, run `node scripts/preview.cjs start`.
The runner launches Expo with its tunnel detached from the terminal. Closing Expo
Go on the phone or closing the terminal tab does not send a shutdown signal to it.
Start is safe to repeat: it reports the existing runner rather than launching a second one.

If an old Expo process already occupies port 8081, the runner leaves it alone.
Stop that old terminal with Ctrl+C, then run `node scripts/preview.cjs stop`
and `node scripts/preview.cjs start`.

- `node scripts/preview.cjs logs`: last 80 log lines, including Expo's current link.
- `node scripts/preview.cjs status`: runner status; this is not an end-to-end health check.
- `node scripts/preview.cjs stop`: stop only this runner and its Expo process group.

The API engine must still be running with its existing configuration. This command
does not change credentials, authentication, backend configuration or onboarding.
Use the latest Expo link shown in logs; a restarted tunnel can have a different URL.
Rapid process failures are retried with backoff and stop retrying after five attempts.
A tunnel failure that leaves Expo alive is not automatically detected.

This is for Linux Codespaces with Node, pnpm and the project dependencies installed.
Logs and the control socket are kept in a private temporary directory outside git.
Logs may contain app diagnostics; review before sharing them.

## Codespace lifetime

Detached processes still stop when the Codespace stops, is deleted, or its host restarts.
There is no keep-awake loop or change to billing or idle policies in this script.
GitHub supports idle timeouts up to 240 minutes, subject to organization policy.
Changing the default applies to new Codespaces. For an existing Codespace, use its
supported timeout setting rather than assuming the default changed it.
See https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces.

For previews that remain available without a running Codespace or ngrok, the next
step is a standalone phone build plus a hosted backend. This runner is not permanent hosting.
