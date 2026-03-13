"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, getNote } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function NoteContent({ slug }: { slug: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["note", slug],
    queryFn: () => getNote(slug),
    retry: (_, error) => (error as ApiError).status !== 404,
    gcTime: 0,
  });

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <main className="w-full max-w-lg">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <main className="w-full max-w-lg space-y-4">
          <Alert variant="destructive">
            <AlertTitle>Note unavailable</AlertTitle>
            <AlertDescription>
              This note has expired or been consumed.
            </AlertDescription>
          </Alert>
          <Button variant="link" asChild className="w-full justify-center">
            <Link href="/">Create a new note</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <main className="w-full max-w-lg">
        <Card>
          <CardContent className="pt-6">
            <pre className="whitespace-pre-wrap rounded-md border bg-muted/50 p-4 text-sm font-mono">
              {data.content}
            </pre>
          </CardContent>
          <CardHeader className="pt-0">
            <CardDescription className="text-center">
              This note was displayed once and is no longer available.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    </div>
  );
}
