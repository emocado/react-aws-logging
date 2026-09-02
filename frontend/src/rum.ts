export interface RumConfigInfo {
  applicationId: string;
  applicationVersion: string;
  applicationRegion: string;
  lambdaProxyUrl: string;
  cognitoDomain: string;
  cognitoClientId: string;
  isConfigured: boolean;
}

const APPLICATION_ID = import.meta.env.VITE_AWS_RUM_APPLICATION_ID || '26a9ea6f-15ed-4518-b3c6-0f0ebf65e07f';
const APPLICATION_VERSION = '1.0.0';
const APPLICATION_REGION = import.meta.env.VITE_AWS_REGION || 'ap-southeast-1';
const LAMBDA_PROXY_URL = import.meta.env.VITE_LAMBDA_PROXY_URL || '';
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN || '';
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || '';

export const rumConfigInfo: RumConfigInfo = {
  applicationId: APPLICATION_ID,
  applicationVersion: APPLICATION_VERSION,
  applicationRegion: APPLICATION_REGION,
  lambdaProxyUrl: LAMBDA_PROXY_URL,
  cognitoDomain: COGNITO_DOMAIN,
  cognitoClientId: COGNITO_CLIENT_ID,
  isConfigured: Boolean(LAMBDA_PROXY_URL),
};

export type TelemetryEvent = {
  id: string;
  timestamp: string;
  type: 'error' | 'http' | 'navigation' | 'custom' | 'performance' | 'breadcrumb';
  title: string;
  detail: Record<string, unknown> | string;
};

// Global log listener for in-app debug view
type LogListener = (event: TelemetryEvent) => void;
const listeners: Set<LogListener> = new Set();

export const subscribeToRumLogs = (listener: LogListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const broadcastTelemetry = (event: Omit<TelemetryEvent, 'id' | 'timestamp'>) => {
  const fullEvent: TelemetryEvent = {
    ...event,
    id: generateUUID(),
    timestamp: new Date().toLocaleTimeString(),
  };
  listeners.forEach((fn) => fn(fullEvent));
};

// Helper: UUID v4 generator
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// In-Memory Session ID (No Cookies used)
const memorySessionId = generateUUID();

// ==============================================================================
// 1. Breadcrumb Trail (Memory only)
// ==============================================================================
export interface Breadcrumb {
  timestamp: string;
  category: 'ui_click' | 'navigation' | 'network' | 'state_change' | 'user_action';
  message: string;
  data?: Record<string, unknown>;
}

const MAX_BREADCRUMBS = 15;
const breadcrumbTrail: Breadcrumb[] = [];

export const addBreadcrumb = (
  category: Breadcrumb['category'],
  message: string,
  data?: Record<string, unknown>
) => {
  const crumb: Breadcrumb = {
    timestamp: new Date().toISOString(),
    category,
    message,
    data,
  };

  breadcrumbTrail.push(crumb);
  if (breadcrumbTrail.length > MAX_BREADCRUMBS) {
    breadcrumbTrail.shift();
  }

  broadcastTelemetry({
    type: 'breadcrumb',
    title: `[Breadcrumb] ${message}`,
    detail: { category, data, timestamp: crumb.timestamp },
  });
};

export const getBreadcrumbs = (): Breadcrumb[] => [...breadcrumbTrail];

// ==============================================================================
// 2. User Identity & Authenticated Claims
// ==============================================================================
export interface UserProfile {
  userId: string;
  email: string;
  sub: string;
  tier: string;
  isAuthenticated: boolean;
  claims?: Record<string, unknown>;
}

let currentUserContext: UserProfile = {
  userId: 'guest-' + memorySessionId.slice(0, 8),
  email: 'anonymous@guest.io',
  sub: memorySessionId,
  tier: 'Free',
  isAuthenticated: false,
};

export const getCurrentUser = (): UserProfile => ({ ...currentUserContext });

export const setUserIdentity = (
  userId: string,
  email: string,
  sub: string,
  metadata: Record<string, unknown> = {}
) => {
  currentUserContext = {
    userId: userId || email || 'anonymous',
    email: email || 'anonymous@guest.io',
    sub: sub || generateUUID(),
    tier: (metadata.tier as string) || 'Enterprise',
    isAuthenticated: true,
    claims: metadata,
  };

  addBreadcrumb('user_action', `Authenticated via Cognito as ${email}`, {
    sub,
    email,
    claims: metadata,
  });

  broadcastTelemetry({
    type: 'custom',
    title: `User Logged In: ${email}`,
    detail: currentUserContext as unknown as Record<string, unknown>,
  });

  // Forward authentication event to Lambda
  forwardToLambdaProxy([
    {
      type: 'com.amazon.rum.custom_event',
      details: {
        eventType: 'user_authenticated',
        user: currentUserContext,
        timestamp: new Date().toISOString(),
      },
    },
  ]);
};

export const clearUserIdentity = () => {
  currentUserContext = {
    userId: 'guest-' + memorySessionId.slice(0, 8),
    email: 'anonymous@guest.io',
    sub: memorySessionId,
    tier: 'Free',
    isAuthenticated: false,
  };

  addBreadcrumb('user_action', 'User Logged Out', {});
  broadcastTelemetry({
    type: 'custom',
    title: 'User Logged Out',
    detail: 'Switched to anonymous session',
  });
};

// ==============================================================================
// 3. Lambda Telemetry Forwarding (Backend Proxy - No Cookies)
// ==============================================================================
export async function forwardToLambdaProxy(
  events: Array<{
    id?: string;
    timestamp?: string | Date;
    type: string;
    metadata?: Record<string, unknown>;
    details: Record<string, unknown> | string;
  }>
) {
  if (!LAMBDA_PROXY_URL) {
    console.warn('[RUM Proxy] VITE_LAMBDA_PROXY_URL not configured. Running in offline test mode.');
    return;
  }

  const payload = {
    batchId: generateUUID(),
    userId: currentUserContext.sub && /^[a-f0-9-]{36}$/i.test(currentUserContext.sub) ? currentUserContext.sub : generateUUID(),
    sessionId: memorySessionId,
    version: APPLICATION_VERSION,
    domain: window.location.hostname || 'localhost',
    pageId: window.location.pathname || '/',
    events: events.map((e) => ({
      id: e.id || generateUUID(),
      timestamp: e.timestamp || new Date().toISOString(),
      type: e.type,
      metadata: {
        domain: window.location.hostname || 'localhost',
        pageId: window.location.pathname || '/',
        url: window.location.href,
        user: currentUserContext.email,
        userId: currentUserContext.userId,
        sub: currentUserContext.sub,
        tier: currentUserContext.tier,
        ...e.metadata,
      },
      details: typeof e.details === 'string' ? e.details : JSON.stringify(e.details),
    })),
  };

  try {
    const res = await fetch(LAMBDA_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error('[RUM Proxy] Failed to forward telemetry:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[RUM Proxy] Network error forwarding telemetry to Lambda:', err);
  }
}

// ==============================================================================
// 4. HTTP Telemetry Logging
// ==============================================================================
export const recordHttpEvent = (
  url: string,
  method: string = 'GET',
  status?: number,
  statusText?: string,
  error?: Error | string,
  durationMs?: number
) => {
  const isError = error || (status && (status < 200 || status >= 400));

  const httpDetails: Record<string, unknown> = {
    version: '1.0.0',
    request: {
      method: method.toUpperCase(),
      url,
    },
  };

  if (status !== undefined) {
    httpDetails.response = {
      status,
      statusText: statusText || (status === 200 ? 'OK' : status === 404 ? 'Not Found' : status === 500 ? 'Internal Server Error' : String(status)),
    };
  }

  if (error) {
    const errObj = typeof error === 'string' ? new Error(error) : error;
    httpDetails.error = {
      version: '1.0.0',
      type: errObj.name || 'Error',
      message: errObj.message,
      stack: errObj.stack || '',
      filename: window.location.href,
      lineno: 1,
      colno: 1,
    };
  }

  // 1. Forward com.amazon.rum.http_event to Lambda Proxy
  forwardToLambdaProxy([
    {
      type: 'com.amazon.rum.http_event',
      details: httpDetails,
    },
    ...(isError
      ? [
          {
            type: 'com.amazon.rum.custom_event',
            details: {
              eventType: 'http_request_failure',
              url,
              method,
              status,
              durationMs,
              user: currentUserContext,
              breadcrumbs: getBreadcrumbs(),
            },
          },
        ]
      : []),
  ]);
};

// ==============================================================================
// 5. Enhanced Verbose Error Logging (Attached to Authenticated Claims)
// ==============================================================================
export const recordCustomError = (
  error: Error | string,
  context?: {
    componentStack?: string;
    customAttributes?: Record<string, unknown>;
  }
) => {
  const errObj = typeof error === 'string' ? new Error(error) : error;

  const fullDiagnosticPayload = {
    user: currentUserContext,
    componentStack: context?.componentStack || 'N/A',
    breadcrumbsLeadUp: getBreadcrumbs(),
    customContext: context?.customAttributes || {},
    url: window.location.href,
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    timestamp: new Date().toISOString(),
  };

  // 1. Broadcast to internal stream
  broadcastTelemetry({
    type: 'error',
    title: `Error: ${errObj.name} [User: ${currentUserContext.email}]`,
    detail: {
      message: errObj.message,
      stack: errObj.stack?.split('\n').slice(0, 4).join('\n'),
      ...fullDiagnosticPayload,
    },
  });

  // 2. Forward to Lambda Proxy (which forwards to CloudWatch RUM PutRumEvents)
  forwardToLambdaProxy([
    {
      type: 'com.amazon.rum.js_error_event',
      details: {
        version: '1.0.0',
        type: errObj.name,
        message: errObj.message,
        stack: errObj.stack || '',
        filename: window.location.href,
        lineno: 1,
        colno: 1,
      },
    },
    {
      type: 'com.amazon.rum.custom_event',
      details: {
        eventType: 'error_diagnostic_report',
        errorName: errObj.name,
        errorMessage: errObj.message,
        ...fullDiagnosticPayload,
      },
    },
  ]);
};

// Record route navigation with user attribution
export const recordPageView = (pageId: string) => {
  addBreadcrumb('navigation', `Navigated to ${pageId}`, {
    user: currentUserContext.email,
  });

  broadcastTelemetry({
    type: 'navigation',
    title: `Navigation: ${pageId} [User: ${currentUserContext.email}]`,
    detail: { path: pageId, user: currentUserContext.email, url: window.location.href },
  });

  forwardToLambdaProxy([
    {
      type: 'com.amazon.rum.page_view_event',
      details: {
        version: '1.0.0',
        pageId,
        pageInteractionId: `${pageId}-0`,
        interaction: 0,
        referrer: document.referrer || '',
      },
    },
  ]);
};

// Record custom business event
export const recordCustomEvent = (eventType: string, eventData: Record<string, unknown>) => {
  const enrichedData = {
    ...eventData,
    user: currentUserContext,
    timestamp: new Date().toISOString(),
  };

  addBreadcrumb('ui_click', `Action '${eventType}' triggered by ${currentUserContext.email}`, eventData);

  broadcastTelemetry({
    type: 'custom',
    title: `Event: ${eventType} [User: ${currentUserContext.email}]`,
    detail: enrichedData,
  });

  forwardToLambdaProxy([
    {
      type: 'com.amazon.rum.custom_event',
      details: {
        eventType,
        ...enrichedData,
      },
    },
  ]);
};

// Global error listener hook
export function initGlobalErrorListeners() {
  window.addEventListener('error', (event) => {
    recordCustomError(event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    recordCustomError(event.reason || 'Unhandled Promise Rejection');
  });
}
