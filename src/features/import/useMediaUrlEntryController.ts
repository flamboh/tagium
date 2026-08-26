import { useState } from "react";
import {
  SharedContentUnavailableError,
  SharedContentVersionError,
} from "@/features/share/shareClient";
import { InvalidShareLinkError, ShareLinksDisabledError } from "@/features/share/shareLink";
import type { MediaUrlEntryController } from "@/shared/media-url/MediaUrlEntry";
import { getSystemFailurePresentation, reportSystemFailure } from "@/shared/systemFailure";

const validateMediaUrl = (value: string) => {
  if (!value) return "enter a media url";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return null;
  } catch {
    // The local validation message below is intentionally more useful than URL's exception.
  }
  return "enter a complete http or https url";
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
        setValidationError("this link was made by a newer tagium version");
        return false;
      }

      const presentation = getSystemFailurePresentation(error, "import");
      if (
        presentation.code === "unsupported_source" ||
        presentation.code === "private_or_missing"
      ) {
        setValidationError(presentation.description.toLowerCase().replace(/\.$/, ""));
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
