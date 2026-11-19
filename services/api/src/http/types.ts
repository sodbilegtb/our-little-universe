/** A transport-neutral request, built from an API Gateway event or a Node request. */
export interface ApiRequest {
  method: string;
  path: string;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: string | null;
  sourceIp: string;
  requestId: string;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
