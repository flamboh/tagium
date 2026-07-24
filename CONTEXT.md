# Tagium

Tagium lets people prepare album metadata locally and share that work without sharing the downloaded audio files themselves.

## Shared albums

**Shared album source**:
A local album created from another person's shared-album link. A shared album source is never eligible for its own share publication.
_Avoid_: Imported manifest, shared manifest

**Share publication**:
The single creator-owned shared-album link associated with a local album. An unchanged active publication cannot be replaced by a second publication, and a stopped or expired publication does not silently become a new one.
_Avoid_: Recipe, manifest

**Published snapshot**:
The exact shareable album metadata, ordered track metadata, and artwork represented by a share publication. A publication is unchanged when the local album matches this snapshot, changed when it differs, and unchanged again if those changes are reverted.
_Avoid_: Saved metadata

**Publication update**:
Replacement of a share publication's published snapshot while preserving the publication's link identity and expiration.
_Avoid_: Reshare, new share

**Publication capability**:
The authority granted when a share publication is created and required to update or stop it. Losing this authority does not make the album eligible for a replacement publication.
_Avoid_: Revocation token, owner session
