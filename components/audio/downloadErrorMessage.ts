export const getDownloadErrorMessage = (error: Error) => {
  if (error.message.includes("COBALT_API_URL is not configured.")) {
    return "Audio downloads are not configured on this server.";
  }

  if (error.message.includes("error.api.unreachable")) {
    return "Audio downloads are temporarily unavailable.";
  }

  if (error.message.includes("error.api.timed_out")) {
    return "Audio download timed out.";
  }

  if (error.message.includes("error.tunnel.probe")) {
    return "Audio download was not ready. Try again.";
  }

  return error.message;
};
