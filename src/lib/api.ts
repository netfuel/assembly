import type { AuthProviders, City, EventDetail, EventSummary, Me, RsvpStatus } from "../../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError("You're offline. Showing what we saved last time.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status}).`, res.status);
  return body;
}

export const api = {
  city: (slug: string) => request<City>(`/api/cities/${encodeURIComponent(slug)}`),
  events: (city: string) => request<{ events: EventSummary[] }>(`/api/events?city=${encodeURIComponent(city)}`).then((r) => r.events),
  event: (id: string) => request<EventDetail>(`/api/events/${encodeURIComponent(id)}`),
  me: () => request<{ user: Me | null }>("/api/me").then((r) => r.user),
  providers: () => request<AuthProviders>("/api/auth/providers"),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  rsvp: (id: string, status: RsvpStatus | null) =>
    status
      ? request<{ status: RsvpStatus }>(`/api/events/${encodeURIComponent(id)}/rsvp`, { method: "PUT", body: JSON.stringify({ status }) })
      : request<{ status: null }>(`/api/events/${encodeURIComponent(id)}/rsvp`, { method: "DELETE" }),
};

export function signInUrl(provider: "google" | "apple", returnTo: string) {
  return `/api/auth/${provider}?return_to=${encodeURIComponent(returnTo)}`;
}
