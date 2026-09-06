import "server-only";

import { cookies, headers } from "next/headers";

export async function getServerComponentRequestHeaders() {
  const requestHeaders = new Headers(await headers());
  const cookieHeader = (await cookies()).toString();
  if (cookieHeader) requestHeaders.set("cookie", cookieHeader);
  return requestHeaders;
}
