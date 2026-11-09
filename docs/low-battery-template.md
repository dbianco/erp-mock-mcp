# Low Battery: example WhatsApp template

A marketing template for the demo tenant "Low Battery" (a phone store). It is an example definition: nothing here has been
created in Textra or submitted to Meta.

| Field | Value |
|---|---|
| Name | `low_battery_reservas_fiestas` |
| Language | `es_AR` |
| Category | `MARKETING` |
| Header | `IMAGE` (see below) |
| Body | `Ya estamos en noviembre y se vienen las fiestas, ¡andá reservando con anticipación tus regalos en *Low Battery*!` |
| Button | `QUICK_REPLY` "Más info" |

The body has no variables. `*Low Battery*` is WhatsApp bold. The wording is the owner's, with accents and the
rioplatense "andá" added; "noviembre" is lower-cased, as in any sentence.

## Meta payload (`components`)

```json
[
  { "type": "HEADER", "format": "IMAGE", "example": { "header_handle": ["<handle from the upload>"] } },
  {
    "type": "BODY",
    "text": "Ya estamos en noviembre y se vienen las fiestas, ¡andá reservando con anticipación tus regalos en *Low Battery*!"
  },
  { "type": "BUTTONS", "buttons": [{ "type": "QUICK_REPLY", "text": "Más info" }] }
]
```

## Header image

`https://www.muycomputer.com/wp-content/uploads/2025/12/iPhone-18-concepto-portada.jpg` (owner's choice, 2026-11-09).
Checked: it answers 200 `image/jpeg`, 101 KB, 1400 × 600, so it meets Textra's upload rule (JPEG or PNG, at most 5 MB,
`POST /templates/{templateId}/media`). It is wider than WhatsApp's usual 1.91:1 header, so the sides are cropped. It is a
press image of a concept device, not a Low Battery product, and it is not stored in this repository.
The first image proposed, a `.webp`, would have been refused by that route.

## Why a button needs Meta first

Textra's `POST /templates/{templateId}/submit` sends the BODY, an IMAGE header and a FOOTER only: a template with a
BUTTONS component is refused with `template_components_unsupported` (`platform-contracts/openapi/notifications-v1.yaml`,
`submitTemplateForProviderApproval`). The import side does carry buttons. So the path for this template is:

1. Create it in Meta's template manager for the WABA of the Low Battery channel, with the payload above.
2. Wait for `APPROVED`.
3. `POST /templates/import` with the channel id (tenant admin), which creates the local template `low_battery_reservas_fiestas.es_AR`.

Without the button, the same template can be created and submitted from Textra (`POST /templates`, upload the media,
`submit`).

## Prerequisites that do not exist yet

- A Textra tenant for Low Battery, a WhatsApp channel and an MCP registration pointing at
  `https://mcp.textra.com.ar/low-battery/mcp`.
- A decision on the button: "Más info" as a quick reply (assumed here, because Low Battery has no website) opens a
  conversation, where an agent with this MCP can answer. A `URL` button would need a real address.
