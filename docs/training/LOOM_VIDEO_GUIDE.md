# Loom videos in Pipeline training

Pipeline can place a Loom recording inside any Learning Center activity. Lessons without a configured recording remain unchanged.

## Recording rules

- Record only in the isolated synthetic demo environment.
- Do not display client names, packet text, DOBs, credentials, production identifiers, or real meeting links.
- Keep each recording focused on one workflow or judgment boundary.
- Turn on Loom captions and correct material caption errors before publishing.
- Use workspace-only sharing unless the training owner deliberately approves broader access.

## Add a recording

Add one entry to `lib/training/operator-training-video-catalog.ts`:

```ts
trainingVideo(
  "create-referral",
  "guided-practice",
  "Create a referral",
  "https://www.loom.com/share/LOOM_VIDEO_ID",
  "6 min",
  "Create one source-backed referral without guessing missing information.",
),
```

The module ID must exist in the operator curriculum. The activity ID must be one of `briefing`, `guided-practice`, `scenario`, or `knowledge-check`.

Pipeline accepts only HTTPS Loom share or embed URLs. It derives a canonical embed URL and rejects other hosts, malformed IDs, and arbitrary iframe code.

## Review checklist

1. Confirm the recording uses synthetic data.
2. Confirm its module and activity match the demonstrated workflow.
3. Confirm captions, audio, and cursor movement are understandable.
4. Open the lesson at desktop and mobile widths.
5. Run `npm run training:certify` before deployment.
