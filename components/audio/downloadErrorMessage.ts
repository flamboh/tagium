export const getDownloadErrorMessage = (error: Error) => {
  if (error.message.includes("COBALT_API_URL is not configured.")) {
    return "audio downloads are not configured on this server.";
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
