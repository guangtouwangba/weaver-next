import { toApiError, WeaverApiError } from "@weaver/contracts";

export { WeaverApiError };

export async function errorFromResponse(response: Response): Promise<WeaverApiError> {
  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { detail: text };
    }
  }
  return toApiError(response.status, payload);
}
