import { defineHandler } from "nitro";
import {
  admitShareRevoke,
  getShareStore,
  infrastructureFailure,
  noStore,
  unavailable,
} from "../../utils/share-manifest-request";

const MAX_REVOCATION_TOKEN_LENGTH = 128;

export default defineHandler(async (event) => {
  if (!(await admitShareRevoke(event.req)))
    return new Response(null, { status: 429, headers: noStore });
  const token = event.req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const store = getShareStore(event.req);
  if (!store) return infrastructureFailure();
  if (!token || token.length > MAX_REVOCATION_TOKEN_LENGTH) return unavailable();
  try {
    const result = await store.revoke(event.context.params?.slug ?? "", token);
    if (result === "revoked") return new Response(null, { status: 204, headers: noStore });
    return result === "unavailable" ? unavailable() : infrastructureFailure();
  } catch {
    return infrastructureFailure();
  }
});
