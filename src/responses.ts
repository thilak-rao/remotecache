export function accessForbidden() {
  return new Response('Access forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export function badRequest(message: string) {
  return new Response(message, {
    status: 400,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export function conflictError(message: string) {
  return new Response(message, {
    status: 409,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export function internalServerError(message: string) {
  return new Response(message, {
    status: 500,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export function payloadTooLargeError(message: string) {
  return new Response(message, {
    status: 413,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export function noContentResponse() {
  return new Response(null, { status: 204 });
}

export function okResponse({
  message,
  contentType,
  contentLength,
}: {
  message: string | ReadableStream<unknown> | null;
  contentType?: string;
  contentLength?: number;
}): Response {
  return new Response(message, {
    status: 200,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(contentLength ? { 'Content-Length': contentLength.toString() } : {}),
    },
  });
}

export function notFoundError(message: string) {
  return new Response(message, {
    status: 404,
    headers: { 'Content-Type': 'text/plain' },
  });
}
