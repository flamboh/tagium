export const enforceSameOrigin = (request: Request, allowedOrigin: string | undefined) => {
  const requestOrigin = request.headers.get("origin");

  if (!requestOrigin) {
    return new Response("Download requests require an Origin header.", { status: 403 });
  }

  if (requestOrigin !== (allowedOrigin ?? new URL(request.url, requestOrigin).origin)) {
    return new Response("Download origin is not allowed.", { status: 403 });
  }

  return undefined;
};
