# Public Contact Card

The homepage's Contact Me heading includes Share card, which navigates directly to
the standalone /card page on desktop and mobile. Its Share this card action opens
the Link & QR / Share image dialog. The header navigation is unchanged.

- QR codes and 1080 x 1350 PNGs are generated locally, without external APIs.
- The dialog and QR library load on demand. Poster fonts and canvas rendering wait
  until Share image is selected; downloads reuse the rendered canvas.
- /card is a public, cached page. It uses the existing public work-history reader
  for the current role and refreshes every five minutes (30 seconds on failure).
- Only name, role, portrait and public website/social links are included. The card
  and downloadable vCard contain no phone number or email.
- The card's QR embeds the public vCard. The share dialog and image QR open /card.
- No new database tables, admin permissions, tracking endpoints or paid services.
- Article sharing, answer publishing, company pages and private hand-over codes
  are not included in this release.

Run `npm run test:share` for the dialog, entry point and public-card checks.
