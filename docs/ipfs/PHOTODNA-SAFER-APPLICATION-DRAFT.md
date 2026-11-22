# Gully IPFS: PhotoDNA / Thorn Safer application, DRAFT

Status: DRAFT. Not submitted. Counsel reviews it and the owner submits it, with the owner's own contact and
company details. Nothing in this file is published anywhere.

## Why we need it

Gully IPFS lets account holders pin and upload files that we then serve from a public gateway
(`ipfs.gullylabs.xyz`). Today every raster image up to 12 MB is scored by an open nudity classifier (OpenNSFW2),
low scores pass, and everything else (high scores, video, SVG, large images, anything the scanner could not score)
waits for a person in an admin queue. The classifier does not detect known child sexual abuse material (CSAM). A
hash-matching service for known material is the missing control, and it is the control a service that hosts
user-supplied images is expected to have before it opens to the public.

## What we are asking for

Access to one of:

1. Microsoft PhotoDNA Cloud Service (hash matching of images against known CSAM, with the reporting guidance that
   comes with it), or
2. Thorn Safer (hash matching, plus the reporting workflow to NCMEC).

We would use whichever approves us first and keep the integration behind one adapter so we can add the other.

## The organisation

- Legal entity: Gully Labs LLC (Oregon, USA). [Owner to confirm registered address, EIN and the named contact.]
- Service: Gully IPFS, a self-serve pinning service and read-only gateway. Public documentation:
  `https://docs.gullylabs.xyz/ipfs`. Terms: `https://gullylabs.xyz/terms` (an IPFS-specific addendum is a draft).
- Users: account holders who sign in with a wallet (Gully ID) and pin with API keys; uploads are limited per account
  (files, monthly transfer, pin count). Anonymous users can only read from the gateway.
- Scale today: early access. [Owner: insert pinned objects and active accounts at the time of application.]

## How the content flows

1. A customer uploads a file or pins a CID. Uploads are hashed (SHA-256) and added to our Kubo node. A pin by CID
   is fetched into our node and hashed.
2. Images are scored by the classifier. Anything not clearly low risk waits in a review queue.
3. **Where hash matching would go:** after the bytes are on our node and before the record reads `pinned`
   (`server/ipfs-pins.mjs`, the same place the classifier runs today). The file's hash (PhotoDNA hash or a Safer
   hash) is sent to the service. The raw image is not sent anywhere we do not control if the service allows hashing
   on our side; if the API needs the image, it goes over TLS and is not stored by us beyond the call.
4. A match is treated as confirmed content: the record is removed at once, the CID is unpinned from every node and
   purged, the CID and the file's SHA-256 go on the gateway and upload denylists (so the same bytes are refused under
   any CID), the account is suspended, and the matter is preserved and reported as the law requires.
5. A person reviews every non-match that the classifier flagged. Nothing is removed on a classifier score alone.

## Reports from the public

A public report form (`https://docs.gullylabs.xyz/ipfs#report`) takes a CID or gateway link and a category. Child
safety reports sort first in the admin queue. A report never removes content by itself; a person decides, using the
same takedown path described above.

## Legal reporting

[Counsel to complete.] We understand a US provider that obtains actual knowledge of apparent child sexual abuse
material must report it to NCMEC's CyberTipline (18 U.S.C. 2258A) and preserve the report's contents. We will
register for the CyberTipline, name the person who files, and keep an incident procedure. Counsel confirms the
retention period and our obligations as a provider whose users' files are addressed by content hash.

## Preservation, privacy and access

- Hash-matching requests carry the file hash only (or the image where the API requires it), no account details.
- Evidence of a confirmed match is held only as the law requires, access-controlled, with an audit log of who
  opened it. Reviewers are named people with the owner's approval.
- Reporter emails from the public form are kept only to answer the reporter and are visible only to admins.

## Technical contact and integration plan

[Owner to name the technical contact.] The adapter is small: one function called from the pin and upload paths,
failing closed (a file that cannot be checked waits for review, as the classifier already does). We would test in
the sandbox the service provides before going live.

## Open items for the owner and counsel

- Applicant details and the named contact; whether PhotoDNA, Safer or both.
- Whether to ship hash matching before opening public self-serve sign-up (our recommendation: yes).
- NCMEC registration and the incident and preservation procedure.
- Wording of the IPFS content policy and Terms addendum (both drafts).
