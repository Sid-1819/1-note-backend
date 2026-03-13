"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { createNote } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const EXPIRY_PRESETS = [
  { value: "", label: "Never" },
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "custom", label: "Custom date & time" },
] as const;

function getExpiresAtIso(
  preset: string,
  customDateTime: string
): string | undefined {
  if (!preset) return undefined;
  if (preset === "custom") {
    if (!customDateTime.trim()) return undefined;
    const date = new Date(customDateTime);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const now = Date.now();
  const ms =
    preset === "1h"
      ? 60 * 60 * 1000
      : preset === "24h"
        ? 24 * 60 * 60 * 1000
        : preset === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : 0;
  if (!ms) return undefined;
  return new Date(now + ms).toISOString();
}

export default function Home() {
  const [content, setContent] = useState("");
  const [maxViews, setMaxViews] = useState("");
  const [expiryPreset, setExpiryPreset] = useState("");
  const [expiryCustom, setExpiryCustom] = useState("");
  const [created, setCreated] = useState<{
    slug: string;
    maxViews: number | undefined;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      const expiresAt = getExpiresAtIso(expiryPreset, expiryCustom);
      return createNote({
        content: content.trim(),
        maxViews: maxViews ? Number(maxViews) : undefined,
        expiresAt: expiresAt ?? undefined,
      });
    },
    onSuccess: (data) => {
      setCreated({
        slug: data.slug,
        maxViews: maxViews ? Number(maxViews) : undefined,
      });
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!content.trim()) return;
    mutation.mutate();
  }

  function handleCreateAnother() {
    setCreated(null);
    setContent("");
    setMaxViews("");
    setExpiryPreset("");
    setExpiryCustom("");
    setCopied(false);
  }

  const noteLink =
    typeof window !== "undefined" && created
      ? `${window.location.origin}/s/${created.slug}`
      : "";

  function handleCopyLink() {
    if (!noteLink) return;
    navigator.clipboard.writeText(noteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (created) {
    const viewMessage =
      created.maxViews === 1
        ? "Share this link; it can only be viewed once."
        : created.maxViews != null && created.maxViews > 1
          ? `Share this link; it can be viewed up to ${created.maxViews} times.`
          : "Share this link. Anyone with the link can view the note.";

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <main className="w-full max-w-lg">
          <Card>
            <CardHeader>
              <CardTitle>Note created</CardTitle>
              <CardDescription>{viewMessage}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="text"
                  readOnly
                  value={noteLink}
                  aria-label="Note link"
                  className="flex-1 font-mono text-sm"
                />
                <Button type="button" onClick={handleCopyLink}>
                  {copied ? "Copied!" : "Copy link"}
                </Button>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" onClick={handleCreateAnother}>
                Create another note
              </Button>
            </CardFooter>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <main className="w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Create secure note</CardTitle>
            <CardDescription>
              Paste or type your secret. Set optional expiry and view limits.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="content">Secret content</Label>
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Paste or type your secret..."
                  rows={6}
                  required
                  disabled={mutation.isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expiryPreset">Expires at (optional)</Label>
                <Select
                  value={expiryPreset || "none"}
                  onValueChange={(v) => setExpiryPreset(v === "none" ? "" : v)}
                  disabled={mutation.isPending}
                >
                  <SelectTrigger id="expiryPreset" className="w-full">
                    <SelectValue placeholder="Never" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_PRESETS.map((p) => (
                      <SelectItem
                        key={p.value || "none"}
                        value={p.value || "none"}
                      >
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {expiryPreset === "custom" && (
                  <Input
                    type="datetime-local"
                    id="expiryCustom"
                    value={expiryCustom}
                    onChange={(e) => setExpiryCustom(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    disabled={mutation.isPending}
                    className="mt-2"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxViews">Max views (optional)</Label>
                <Input
                  id="maxViews"
                  type="number"
                  min={1}
                  max={1000}
                  value={maxViews}
                  onChange={(e) => setMaxViews(e.target.value)}
                  placeholder="Unlimited"
                  disabled={mutation.isPending}
                />
              </div>

              {mutation.isError && (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>
                    {mutation.error instanceof Error
                      ? mutation.error.message
                      : "Creation failed"}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                disabled={mutation.isPending || !content.trim()}
              >
                {mutation.isPending ? "Creating…" : "Create secure note"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </main>
    </div>
  );
}
