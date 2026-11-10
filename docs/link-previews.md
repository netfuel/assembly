# Link previews

The Worker answers `/e/<id>`, `/a/<slug>`, `/v/<slug>`, `/o/<slug>`, `/c/<city>` and `/c/<city>/<scene>` with the app's
`index.html` and a page-specific head (`worker/ogHead.ts`, `worker/og.ts`, `worker/ogPages.ts`): title, description,
`og:*` tags with image width, height and alt, `twitter:card=summary_large_image` with title, description and image,
a canonical URL, and schema.org JSON-LD. Unknown, hidden or deleted pages get `<meta name="robots" content="noindex">`
and an `X-Robots-Tag: noindex` header and no page data.

Images: events use the designed card (`/api/og/e/<id>.png`, 1200 x 630). Artist, venue and organizer pages use their own
photo only when it is stored with us, at least 600 x 315, and its size could be read; otherwise the next show's designed
card, otherwise `/icons/og.png`. City and scene pages use the next matching show's card.

`/c/...` URLs open the map; the app does not yet apply the city or scene as a filter from the path.

## Automated check

`tests/previews.test.ts` (part of `npm test`) runs every route against a SQLite copy of the schema and asserts the tags,
absolute https URLs, canonical, image size, single copies of each tag, and noindex for hidden or unknown pages.

## Manual check (not automated: needs the deployed site)

Paste a live link into each tool's debugger or a real chat, after deploying:

- Facebook / Instagram / WhatsApp cache: https://developers.facebook.com/tools/debug/ (scrape again after edits)
- LinkedIn: https://www.linkedin.com/post-inspector/
- Discord: post the link in a test channel (no debugger; it caches per URL)
- Slack: post in a DM to yourself; unfurl cache clears if you add `?x=1`
- iMessage and Signal: send to yourself (no debugger)
- Google rich results: https://search.google.com/test/rich-results
- Bluesky or Mastodon card checks if relevant
