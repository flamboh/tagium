import { toast } from "sonner";

type DownloadErrorNotification = {
  id: string;
  title: string;
  description: string;
};

const getDownloadErrorNotification = (error: Error): DownloadErrorNotification | null => {
  if (error.message.includes("error.api.capacity_exceeded")) {
    return {
      id: "download-capacity-exceeded",
      title: "Downloads are busy",
      description: "Too many downloads are running right now. Try again in a moment.",
    };
  }

  if (error.message.includes("error.api.unreachable")) {
    return {
      id: "download-api-unreachable",
      title: "Downloads unavailable",
      description: "Tagium could not reach the audio download service. Try again soon.",
    };
  }

  if (error.message.includes("error.api.timed_out")) {
    return {
      id: "download-api-timed-out",
      title: "Download timed out",
      description: "The audio download service took too long to respond. Try again.",
    };
  }

  return null;
};

export const isCobaltCapacityError = (error: Error) =>
  error.message.includes("error.api.capacity_exceeded");

export const getDownloadErrorMessage = (error: Error) => {
  if (error.message.includes("COBALT_API_URL is not configured.")) {
    return "audio downloads are not configured on this server.";
  }

  if (isCobaltCapacityError(error)) {
    return "downloads are busy. try again in a moment.";
  }

  if (error.message.includes("error.api.unreachable")) {
    return "audio downloads are temporarily unavailable.";
  }

  if (error.message.includes("error.api.timed_out")) {
    return "audio download timed out.";
  }

  if (error.message.includes("error.tunnel.probe")) {
    return "audio download was not ready. try again.";
  }

  return error.message;
};

export const notifyDownloadError = (error: Error) => {
  const notification = getDownloadErrorNotification(error);
  if (!notification) return;

  toast.error(notification.title, {
    id: notification.id,
    description: notification.description,
  });
};
