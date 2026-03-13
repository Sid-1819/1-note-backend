// Use /api when unset so same-origin requests hit the proxy (avoids conflict with page route /s/[slug]).
const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export type CreateNoteBody = {
  content: string;
  maxViews?: number;
  expiresAt?: string;
};

export type CreateNoteResponse = { slug: string };

export type GetNoteResponse = { content: string };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function createNote(
  body: CreateNoteBody,
): Promise<CreateNoteResponse> {
  const res = await fetch(`${baseUrl}/s`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || "Creation failed", res.status);
  }

  return res.json();
}

export async function getNote(slug: string): Promise<GetNoteResponse> {
  const res = await fetch(`${baseUrl}/s/${encodeURIComponent(slug)}`);

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || "Failed to load note", res.status);
  }

  return res.json();
}
