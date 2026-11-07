import { useState } from "react";
import { msg } from "gt-react";
import {
  SharedContentUnavailableError,
  SharedContentVersionError,
} from "@/features/share/shareClient";
import { InvalidShareLinkError, ShareLinksDisabledError } from "@/features/share/shareLink";
import type { MediaUrlEntryController } from "@/shared/media-url/MediaUrlEntry";
import {
  getSystemFailurePresentation,
  reportSystemFailure,
  type SystemFailureCode,
} from "@/shared/systemFailure";

const INLINE_FAILURE_MESSAGES: Partial<Record<SystemFailureCode, string>> = {
  unsupported_source: msg("paste a public soundcloud or youtube track, set, or playlist link"),
  private_or_missing: msg("check that the link is public and still available"),
  playlist_empty: msg(
    "none of this playlist's tracks can be saved. they may be private or removed",
  ),
  short_link_unresolved: msg("this soundcloud short link doesn't lead to a track or playlist"),
};

const validateMediaUrl = (value: string) => {
  if (!value) return msg("enter a media url");

  try {
    const url = new URL(value);

    if (url.protocol === "http:" || url.protocol === "https:") return null;
  } catch {
    // The local validation message below is intentionally more useful than URL's exception.
  }

  return msg("enter a complete http or https url");
};

/** Owns Tagium-specific URL import validation and failure presentation. */
export function useMediaUrlEntryController(
  onUrlImport: (sourceUrl: string) => void | Promise<void>,
): MediaUrlEntryController {
  const [sourceUrl, setSourceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return true;
    const trimmedUrl = sourceUrl.trim();
    const localError = validateMediaUrl(trimmedUrl);

    if (localError) {
      setValidationError(localError);

      return false;
    }

    setSubmitting(true);
    setValidationError(null);

    try {
      await onUrlImport(trimmedUrl);
      setSourceUrl("");

      return true;
    } catch (error) {
      if (
        error instanceof InvalidShareLinkError ||
        error instanceof ShareLinksDisabledError ||
        error instanceof SharedContentUnavailableError
      ) {
        setValidationError(error.message);

        return false;
      }

      if (error instanceof SharedContentVersionError) {
        setValidationError(msg("this link was made by a newer tagium version"));

        return false;
      }

      const inlineFailure =
        INLINE_FAILURE_MESSAGES[getSystemFailurePresentation(error, "import").code];

      if (inlineFailure) {
        setValidationError(inlineFailure);

        return false;
      }

      reportSystemFailure(error, "import");

      return true;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    sourceUrl,
    submitting,
    validationError,
    setSourceUrl: (nextSourceUrl) => {
      setSourceUrl(nextSourceUrl);
      setValidationError(null);
    },
    submit,
  };
}
