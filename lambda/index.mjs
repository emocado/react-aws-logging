import { RUMClient, PutRumEventsCommand } from '@aws-sdk/client-rum';
import { randomUUID } from 'crypto';

const region = process.env.AWS_REGION || 'ap-southeast-1';
const appMonitorId = process.env.RUM_APP_MONITOR_ID || '';
const appMonitorName = process.env.RUM_APP_MONITOR_NAME || 'react-aws-rum-poc-dev';

const rumClient = new RUMClient({ region });

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-amz-date',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  // Handle HTTP OPTIONS preflight
  const httpMethod = event.requestContext?.http?.method || event.httpMethod;
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'Preflight OK' }),
    };
  }

  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody || {};

    const batchId = payload.batchId || randomUUID();
    const sessionId = payload.sessionId || randomUUID();
    const userId = payload.userId || randomUUID();

    const domain = payload.domain || 'localhost';
    const pageId = payload.pageId || '/';

    // Map incoming events to AWS RUM event structure with valid UUIDs and required metadata
    const rumEvents = (payload.events || []).map((e) => {
      const metadataObj = {
        version: '1.0.0',
        domain: e.metadata?.domain || payload.domain || domain,
        pageId: e.metadata?.pageId || payload.pageId || pageId,
        browserName: e.metadata?.browserName || payload.browserName || 'Chrome',
        browserVersion: e.metadata?.browserVersion || payload.browserVersion || '120.0',
        osName: e.metadata?.osName || payload.osName || 'Generic',
        osVersion: e.metadata?.osVersion || payload.osVersion || '1.0',
        deviceType: e.metadata?.deviceType || payload.deviceType || 'desktop',
        platformType: e.metadata?.platformType || payload.platformType || 'web',
        'aws:client': 'custom-lambda-proxy',
        'aws:clientVersion': '1.0.0',
        ...(typeof e.metadata === 'object' && e.metadata !== null ? e.metadata : {}),
      };

      return {
        id: e.id && /^[a-f0-9-]{36}$/i.test(e.id) ? e.id : randomUUID(),
        timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
        type: e.type || 'com.amazon.rum.custom_event',
        metadata: JSON.stringify(metadataObj),
        details: typeof e.details === 'string' ? e.details : JSON.stringify(e.details || {}),
      };
    });

    if (rumEvents.length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'No events provided in payload' }),
      };
    }

    const command = new PutRumEventsCommand({
      Id: appMonitorId,
      BatchId: batchId,
      AppMonitorDetails: {
        id: appMonitorId,
        name: appMonitorName,
        version: payload.version || '1.0.0',
      },
      UserDetails: {
        userId: userId,
        sessionId: sessionId,
      },
      RumEvents: rumEvents,
    });

    const response = await rumClient.send(command);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        eventsForwarded: rumEvents.length,
        batchId,
        rumMetadata: response.$metadata,
      }),
    };
  } catch (error) {
    console.error('Error forwarding telemetry to CloudWatch RUM:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: error.message || 'Internal Server Error',
        stack: error.stack,
      }),
    };
  }
};
