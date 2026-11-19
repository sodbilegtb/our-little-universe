import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createApp, type App } from '../app/createApp';
import { loadConfig } from '../config/config';
import type { ApiRequest } from '../http/types';

/*
 * Lambda entry point behind an API Gateway HTTP API (payload format 2.0).
 * The app (config, clients, cached secrets) is created once per container and
 * reused across invocations.
 */

let app: App | undefined;

export function toApiRequest(event: APIGatewayProxyEventV2): ApiRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) headers[name.toLowerCase()] = value;
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : null;
  return {
    method: event.requestContext.http.method,
    path: event.rawPath,
    headers,
    query: event.queryStringParameters ?? {},
    body,
    sourceIp: event.requestContext.http.sourceIp,
    requestId: event.requestContext.requestId,
  };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  app ??= createApp(loadConfig());
  const response = await app.route(toApiRequest(event));
  return { statusCode: response.status, headers: response.headers, body: response.body };
}
