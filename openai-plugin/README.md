# ChatGPT and Codex plugin package

LienDeadline's source package for OpenAI directory review: an Agent Plugins `plugin.json` with the `com.openai` listing, review and publication metadata, an `mcp.json` that points at the hosted endpoint, and the icons. It contains no skills and no credentials.

Build the ZIP from this folder:

```bash
cd openai-plugin && zip -r -X ../liendeadline-chatgpt-plugin.zip plugin.json mcp.json assets
```

**Submission is on hold.** These source corrections do not upload, submit, publish or deploy the
package. Positive review cases are expected behavior, not a current acceptance receipt; they were
not rerun against customer accounts or the hosted calculator for this documentation change. The
calculation cases require a dedicated customer key and available allowance. Discovery needs a
key but consumes no calculation allowance; guides require neither. The endpoint-only `mcp.json`
contains no credentials and does not by itself configure supplier access. Before submission,
verify the target client can securely supply the caller key and rerun approved review acceptance.

When submission is separately authorized, upload it at [platform.openai.com/plugins](https://platform.openai.com/plugins) with a verified developer identity. Before review, OpenAI also needs:

- **Domain verification:** set the token the portal shows as `OPENAI_APPS_CHALLENGE` on the hosted service and promote the new revision ([docs/HOSTED.md](../docs/HOSTED.md)).
- **Demo video:** add its URL as `review.demo_recording_url` in `plugin.json`, or enter it in the portal's review details.

Hosted tool changes are picked up by OpenAI's daily MCP scan. Changes to anything in this folder need a new ZIP with a higher `version`. [OpenAI's submission guide](https://developers.openai.com/plugins/deploy/submission) has the field reference.
